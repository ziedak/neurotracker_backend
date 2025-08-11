import { Logger, MetricsCollector } from "@libs/monitoring";
import { PostgreSQLClient } from "@libs/database";
import { CacheService } from "./CacheService";
import { APIGatewayService } from "./APIGatewayService";

export interface MetricPoint {
  timestamp: Date;
  value: number;
  labels?: Record<string, string>;
}

export interface TimeSeriesData {
  metric: string;
  points: MetricPoint[];
  aggregation?: "sum" | "avg" | "min" | "max" | "count";
}

export interface DashboardMetrics {
  overview: {
    totalUsers: number;
    totalCarts: number;
    totalProducts: number;
    conversionRate: number;
    totalRevenue: number;
  };
  timeSeries: {
    userGrowth: TimeSeriesData;
    cartCreation: TimeSeriesData;
    conversionTrend: TimeSeriesData;
    revenueTrend: TimeSeriesData;
  };
  performance: {
    apiLatency: number;
    errorRate: number;
    throughput: number;
    uptime: number;
  };
}

export interface MetricFilter {
  dateFrom: Date;
  dateTo: Date;
  interval?: "hour" | "day" | "week" | "month";
  labels?: Record<string, string>;
}

/**
 * Metrics Service for Dashboard
 * Handles metrics collection, aggregation, and reporting
 */
export class MetricsService {
  private readonly db = PostgreSQLClient.getInstance();
  private readonly cache: CacheService;
  private readonly gateway: APIGatewayService;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(
    cache: CacheService,
    gateway: APIGatewayService,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.cache = cache;
    this.gateway = gateway;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Get comprehensive dashboard metrics
   */
  async getDashboardMetrics(filter: MetricFilter): Promise<DashboardMetrics> {
    try {
      await this.metrics.recordCounter("metrics_service_dashboard_requests");

      // Check cache first
      const cacheKey = `dashboard_metrics:${filter.dateFrom.getTime()}:${filter.dateTo.getTime()}:${
        filter.interval || "day"
      }`;
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        await this.metrics.recordCounter("metrics_service_cache_hits");
        return cached as DashboardMetrics;
      }

      const [overview, timeSeries, performance] = await Promise.all([
        this.getOverviewMetrics(filter),
        this.getTimeSeriesMetrics(filter),
        this.getPerformanceMetrics(),
      ]);

      const dashboardMetrics: DashboardMetrics = {
        overview,
        timeSeries,
        performance,
      };

      // Cache for 5 minutes
      await this.cache.set(cacheKey, dashboardMetrics, 300);

      return dashboardMetrics;
    } catch (error) {
      this.logger.error("Failed to get dashboard metrics", error as Error, {
        filter,
      });
      await this.metrics.recordCounter("metrics_service_errors");
      throw error;
    }
  }

  /**
   * Get overview metrics
   */
  private async getOverviewMetrics(
    filter: MetricFilter
  ): Promise<DashboardMetrics["overview"]> {
    const [
      totalUsers,
      totalCarts,
      totalProducts,
      convertedCarts,
      totalRevenue,
    ] = await Promise.all([
      this.db.user.count({
        where: {
          createdAt: {
            gte: filter.dateFrom,
            lte: filter.dateTo,
          },
        },
      }),
      this.db.cart.count({
        where: {
          createdAt: {
            gte: filter.dateFrom,
            lte: filter.dateTo,
          },
        },
      }),
      this.db.product.count(),
      this.db.cart.count({
        where: {
          status: "CONVERTED",
          createdAt: {
            gte: filter.dateFrom,
            lte: filter.dateTo,
          },
        },
      }),
      this.db.cart.aggregate({
        where: {
          status: "CONVERTED",
          createdAt: {
            gte: filter.dateFrom,
            lte: filter.dateTo,
          },
        },
        _sum: {
          total: true,
        },
      }),
    ]);

    const conversionRate =
      totalCarts > 0 ? (convertedCarts / totalCarts) * 100 : 0;
    const revenue = Number(totalRevenue._sum.total) || 0;

    return {
      totalUsers,
      totalCarts,
      totalProducts,
      conversionRate,
      totalRevenue: revenue,
    };
  }

  /**
   * Get time series metrics
   */
  private async getTimeSeriesMetrics(
    filter: MetricFilter
  ): Promise<DashboardMetrics["timeSeries"]> {
    const interval = filter.interval || "day";
    const dateFormat = this.getDateFormat(interval);

    const [userGrowthData, cartCreationData, conversionData, revenueData] =
      await Promise.all([
        this.getUserGrowthTimeSeries(filter, dateFormat),
        this.getCartCreationTimeSeries(filter, dateFormat),
        this.getConversionTimeSeries(filter, dateFormat),
        this.getRevenueTimeSeries(filter, dateFormat),
      ]);

    return {
      userGrowth: {
        metric: "user_growth",
        points: userGrowthData,
        aggregation: "count",
      },
      cartCreation: {
        metric: "cart_creation",
        points: cartCreationData,
        aggregation: "count",
      },
      conversionTrend: {
        metric: "conversion_rate",
        points: conversionData,
        aggregation: "avg",
      },
      revenueTrend: {
        metric: "revenue",
        points: revenueData,
        aggregation: "sum",
      },
    };
  }

  /**
   * Get performance metrics
   */
  private async getPerformanceMetrics(): Promise<
    DashboardMetrics["performance"]
  > {
    try {
      // Get API Gateway health
      const gatewayHealth = await this.gateway.healthCheck();

      // Calculate basic performance metrics
      const apiLatency = gatewayHealth.latency || 0;
      const uptime = gatewayHealth.status === "healthy" ? 100 : 0;

      // For now, return mock data for error rate and throughput
      // In production, these would come from monitoring systems
      const errorRate = 0.5; // 0.5%
      const throughput = 1000; // requests per minute

      return {
        apiLatency,
        errorRate,
        throughput,
        uptime,
      };
    } catch (error) {
      this.logger.error("Failed to get performance metrics", error as Error);

      return {
        apiLatency: 0,
        errorRate: 100,
        throughput: 0,
        uptime: 0,
      };
    }
  }

  /**
   * Get user growth time series
   */
  private async getUserGrowthTimeSeries(
    filter: MetricFilter,
    dateFormat: string
  ): Promise<MetricPoint[]> {
    const result = await this.db.$queryRaw<
      Array<{ date: string; count: bigint }>
    >`
      SELECT 
        DATE_TRUNC(${dateFormat}, "createdAt") as date,
        COUNT(*) as count
      FROM "users"
      WHERE "createdAt" >= ${filter.dateFrom} AND "createdAt" <= ${filter.dateTo}
      GROUP BY DATE_TRUNC(${dateFormat}, "createdAt")
      ORDER BY date ASC
    `;

    return result.map((row) => ({
      timestamp: new Date(row.date),
      value: Number(row.count),
    }));
  }

  /**
   * Get cart creation time series
   */
  private async getCartCreationTimeSeries(
    filter: MetricFilter,
    dateFormat: string
  ): Promise<MetricPoint[]> {
    const result = await this.db.$queryRaw<
      Array<{ date: string; count: bigint }>
    >`
      SELECT 
        DATE_TRUNC(${dateFormat}, "createdAt") as date,
        COUNT(*) as count
      FROM "carts"
      WHERE "createdAt" >= ${filter.dateFrom} AND "createdAt" <= ${filter.dateTo}
      GROUP BY DATE_TRUNC(${dateFormat}, "createdAt")
      ORDER BY date ASC
    `;

    return result.map((row) => ({
      timestamp: new Date(row.date),
      value: Number(row.count),
    }));
  }

  /**
   * Get conversion time series
   */
  private async getConversionTimeSeries(
    filter: MetricFilter,
    dateFormat: string
  ): Promise<MetricPoint[]> {
    const result = await this.db.$queryRaw<
      Array<{
        date: string;
        total_carts: bigint;
        converted_carts: bigint;
      }>
    >`
      SELECT 
        DATE_TRUNC(${dateFormat}, "createdAt") as date,
        COUNT(*) as total_carts,
        COUNT(CASE WHEN status = 'CONVERTED' THEN 1 END) as converted_carts
      FROM "carts"
      WHERE "createdAt" >= ${filter.dateFrom} AND "createdAt" <= ${filter.dateTo}
      GROUP BY DATE_TRUNC(${dateFormat}, "createdAt")
      ORDER BY date ASC
    `;

    return result.map((row) => {
      const totalCarts = Number(row.total_carts);
      const convertedCarts = Number(row.converted_carts);
      const conversionRate =
        totalCarts > 0 ? (convertedCarts / totalCarts) * 100 : 0;

      return {
        timestamp: new Date(row.date),
        value: conversionRate,
      };
    });
  }

  /**
   * Get revenue time series
   */
  private async getRevenueTimeSeries(
    filter: MetricFilter,
    dateFormat: string
  ): Promise<MetricPoint[]> {
    const result = await this.db.$queryRaw<
      Array<{ date: string; revenue: string }>
    >`
      SELECT 
        DATE_TRUNC(${dateFormat}, "createdAt") as date,
        COALESCE(SUM(total), 0) as revenue
      FROM "carts"
      WHERE "createdAt" >= ${filter.dateFrom} 
        AND "createdAt" <= ${filter.dateTo}
        AND status = 'CONVERTED'
      GROUP BY DATE_TRUNC(${dateFormat}, "createdAt")
      ORDER BY date ASC
    `;

    return result.map((row) => ({
      timestamp: new Date(row.date),
      value: Number(row.revenue),
    }));
  }

  /**
   * Get real-time metrics
   */
  async getRealTimeMetrics(): Promise<{
    activeUsers: number;
    activeCarts: number;
    currentConversions: number;
    revenueToday: number;
  }> {
    try {
      await this.metrics.recordCounter("metrics_service_realtime_requests");

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [activeUsers, activeCarts, todayConversions, todayRevenue] =
        await Promise.all([
          // Active users: users with sessions in last 30 minutes
          this.db.user.count({
            where: {
              sessions: {
                some: {
                  createdAt: {
                    gte: new Date(Date.now() - 30 * 60 * 1000),
                  },
                },
              },
            },
          }),
          this.db.cart.count({
            where: { status: "ACTIVE" },
          }),
          this.db.cart.count({
            where: {
              status: "CONVERTED",
              updatedAt: {
                gte: today,
                lt: tomorrow,
              },
            },
          }),
          this.db.cart.aggregate({
            where: {
              status: "CONVERTED",
              updatedAt: {
                gte: today,
                lt: tomorrow,
              },
            },
            _sum: {
              total: true,
            },
          }),
        ]);

      return {
        activeUsers,
        activeCarts,
        currentConversions: todayConversions,
        revenueToday: Number(todayRevenue._sum.total) || 0,
      };
    } catch (error) {
      this.logger.error("Failed to get real-time metrics", error as Error);
      await this.metrics.recordCounter("metrics_service_errors");
      throw error;
    }
  }

  /**
   * Get custom metric by name
   */
  async getCustomMetric(
    metricName: string,
    filter: MetricFilter
  ): Promise<TimeSeriesData> {
    try {
      await this.metrics.recordCounter("metrics_service_custom_requests");

      // This would typically query a metrics database like InfluxDB or Prometheus
      // For now, return mock data
      const points: MetricPoint[] = [];
      const interval = filter.interval || "day";
      const step = this.getStepSize(interval);

      for (
        let time = filter.dateFrom.getTime();
        time <= filter.dateTo.getTime();
        time += step
      ) {
        points.push({
          timestamp: new Date(time),
          value: Math.random() * 100,
          labels: filter.labels,
        });
      }

      return {
        metric: metricName,
        points,
        aggregation: "avg",
      };
    } catch (error) {
      this.logger.error("Failed to get custom metric", error as Error, {
        metricName,
        filter,
      });
      await this.metrics.recordCounter("metrics_service_errors");
      throw error;
    }
  }

  /**
   * Export metrics data
   */
  async exportMetrics(
    format: "csv" | "json" | "excel",
    filter: MetricFilter
  ): Promise<{ data: string; filename: string; mimeType: string }> {
    try {
      await this.metrics.recordCounter("metrics_service_export_requests");

      const dashboardMetrics = await this.getDashboardMetrics(filter);

      const filename = `metrics_${
        filter.dateFrom.toISOString().split("T")[0]
      }_to_${filter.dateTo.toISOString().split("T")[0]}`;

      switch (format) {
        case "json":
          return {
            data: JSON.stringify(dashboardMetrics, null, 2),
            filename: `${filename}.json`,
            mimeType: "application/json",
          };

        case "csv":
          const csvData = this.convertToCsv(dashboardMetrics);
          return {
            data: csvData,
            filename: `${filename}.csv`,
            mimeType: "text/csv",
          };

        case "excel":
          // For Excel, return JSON and let client handle conversion
          return {
            data: JSON.stringify(dashboardMetrics),
            filename: `${filename}.xlsx`,
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          };

        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      this.logger.error("Failed to export metrics", error as Error, {
        format,
        filter,
      });
      await this.metrics.recordCounter("metrics_service_errors");
      throw error;
    }
  }

  /**
   * Clear metrics cache
   */
  async clearMetricsCache(): Promise<void> {
    try {
      await this.cache.deletePattern("dashboard_metrics:*");
      await this.cache.deletePattern("realtime_metrics:*");

      this.logger.info("Metrics cache cleared");
    } catch (error) {
      this.logger.error("Failed to clear metrics cache", error as Error);
    }
  }

  /**
   * Helper: Get date format for PostgreSQL DATE_TRUNC
   */
  private getDateFormat(interval: string): string {
    switch (interval) {
      case "hour":
        return "hour";
      case "day":
        return "day";
      case "week":
        return "week";
      case "month":
        return "month";
      default:
        return "day";
    }
  }

  /**
   * Helper: Get step size in milliseconds
   */
  private getStepSize(interval: string): number {
    switch (interval) {
      case "hour":
        return 60 * 60 * 1000;
      case "day":
        return 24 * 60 * 60 * 1000;
      case "week":
        return 7 * 24 * 60 * 60 * 1000;
      case "month":
        return 30 * 24 * 60 * 60 * 1000;
      default:
        return 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Helper: Convert metrics to CSV format
   */
  private convertToCsv(metrics: DashboardMetrics): string {
    const lines = [];

    // Header
    lines.push("Metric,Timestamp,Value,Type");

    // Overview metrics
    const overview = metrics.overview;
    const now = new Date().toISOString();
    lines.push(`Total Users,${now},${overview.totalUsers},overview`);
    lines.push(`Total Carts,${now},${overview.totalCarts},overview`);
    lines.push(`Total Products,${now},${overview.totalProducts},overview`);
    lines.push(`Conversion Rate,${now},${overview.conversionRate},overview`);
    lines.push(`Total Revenue,${now},${overview.totalRevenue},overview`);

    // Time series data
    Object.entries(metrics.timeSeries).forEach(([key, series]) => {
      series.points.forEach((point) => {
        lines.push(
          `${key},${point.timestamp.toISOString()},${point.value},timeseries`
        );
      });
    });

    // Performance metrics
    const perf = metrics.performance;
    lines.push(`API Latency,${now},${perf.apiLatency},performance`);
    lines.push(`Error Rate,${now},${perf.errorRate},performance`);
    lines.push(`Throughput,${now},${perf.throughput},performance`);
    lines.push(`Uptime,${now},${perf.uptime},performance`);

    return lines.join("\n");
  }
}
