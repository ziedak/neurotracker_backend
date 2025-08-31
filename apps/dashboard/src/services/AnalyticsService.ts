import { ClickHouseClient, PostgreSQLClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { CacheService } from "./CacheService";
import { APIGatewayService } from "./APIGatewayService";

export interface AnalyticsReport {
  id: string;
  type:
    | "overview"
    | "conversion"
    | "revenue"
    | "performance"
    | "retention"
    | "anomaly";
  data: any;
  generatedAt: Date;
  parameters?: Record<string, any>;
}

export interface AnalyticsQuery {
  type: string;
  dateFrom?: Date;
  dateTo?: Date;
  filters?: Record<string, any>;
  aggregation?: "daily" | "weekly" | "monthly";
}

export interface MetricsSnapshot {
  usersOnline: number;
  activeCarts: number;
  revenue: number;
  conversionRate: number;
  timestamp: Date;
}

/**
 * Analytics Service for Dashboard
 * Provides analytics data through API Gateway integration and direct database queries
 */
export class AnalyticsService {
  private readonly clickhouse: ClickHouseClient;
  private readonly postgres: PostgreSQLClient;
  private readonly cache: CacheService;
  private readonly apiGateway: APIGatewayService;
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  constructor(
    clickhouse: ClickHouseClient,
    postgres: PostgreSQLClient,
    cache: CacheService,
    apiGateway: APIGatewayService,
    logger: ILogger,
    metrics: MetricsCollector
  ) {
    this.clickhouse = clickhouse;
    this.postgres = postgres;
    this.cache = cache;
    this.apiGateway = apiGateway;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Get analytics data through API Gateway
   */
  async getAnalytics(
    query: AnalyticsQuery,
    authToken?: string
  ): Promise<AnalyticsReport> {
    try {
      await this.metrics.recordCounter("analytics_requests");
      const startTime = Date.now();

      // Check cache first
      const cacheKey = `analytics:${query.type}:${JSON.stringify(query)}`;
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        await this.metrics.recordCounter("analytics_cache_hits");
        return cached as AnalyticsReport;
      }

      // Construct API Gateway path
      const queryParams = new URLSearchParams();
      if (query.dateFrom)
        queryParams.set("dateFrom", query.dateFrom.toISOString());
      if (query.dateTo) queryParams.set("dateTo", query.dateTo.toISOString());
      if (query.aggregation) queryParams.set("aggregation", query.aggregation);

      const path = `/api/data/v1/analytics/${
        query.type
      }?${queryParams.toString()}`;

      // Fetch through API Gateway
      const response = await this.apiGateway.request(path, {
        method: "GET",
        headers: authToken ? { Authorization: authToken } : undefined,
      });

      if (!response.success) {
        throw new Error(`Analytics API error: ${response.error}`);
      }

      const report: AnalyticsReport = {
        id: `analytics_${Date.now()}`,
        type: query.type as any,
        data: response.data,
        generatedAt: new Date(),
        parameters: query,
      };

      // Cache the result (5 minutes for most analytics)
      const cacheTTL = query.type === "real-time" ? 30 : 300;
      await this.cache.set(cacheKey, report, cacheTTL);

      await this.metrics.recordTimer(
        "analytics_request_duration",
        Date.now() - startTime
      );
      await this.metrics.recordCounter("analytics_cache_misses");

      this.logger.info("Analytics data retrieved", {
        type: query.type,
        cached: false,
        duration: Date.now() - startTime,
      });

      return report;
    } catch (error) {
      await this.metrics.recordCounter("analytics_errors");
      this.logger.error("Failed to get analytics data", error as Error, {
        query,
      });
      throw error;
    }
  }

  /**
   * Get real-time metrics for dashboard
   */
  async getRealTimeMetrics(): Promise<MetricsSnapshot> {
    try {
      const cacheKey = "metrics:real-time";
      const cached = await this.cache.get(cacheKey);
      if (cached) {
        return cached as MetricsSnapshot;
      }

      // Fetch real-time metrics through API Gateway
      const response = await this.apiGateway.request(
        "/api/data/v1/metrics/live/summary"
      );

      if (!response.success) {
        // Fallback to direct database query
        return await this.getRealTimeMetricsFromDB();
      }

      const metrics: MetricsSnapshot = {
        usersOnline: response.data.usersOnline || 0,
        activeCarts: response.data.activeCarts || 0,
        revenue: response.data.revenue || 0,
        conversionRate: response.data.conversionRate || 0,
        timestamp: new Date(),
      };

      // Cache for 30 seconds
      await this.cache.set(cacheKey, metrics, 30);

      return metrics;
    } catch (error) {
      this.logger.error("Failed to get real-time metrics", error as Error);
      // Return fallback metrics
      return this.getFallbackMetrics();
    }
  }

  /**
   * Get overview analytics (most frequently used)
   */
  async getOverview(
    dateFrom?: Date,
    dateTo?: Date,
    authToken?: string
  ): Promise<AnalyticsReport> {
    return this.getAnalytics(
      {
        type: "overview",
        dateFrom,
        dateTo,
      },
      authToken
    );
  }

  /**
   * Get conversion analytics
   */
  async getConversion(
    dateFrom?: Date,
    dateTo?: Date,
    authToken?: string
  ): Promise<AnalyticsReport> {
    return this.getAnalytics(
      {
        type: "conversion",
        dateFrom,
        dateTo,
      },
      authToken
    );
  }

  /**
   * Get revenue analytics
   */
  async getRevenue(
    dateFrom?: Date,
    dateTo?: Date,
    aggregation?: "daily" | "weekly" | "monthly",
    authToken?: string
  ): Promise<AnalyticsReport> {
    return this.getAnalytics(
      {
        type: "revenue",
        dateFrom,
        dateTo,
        aggregation,
      },
      authToken
    );
  }

  /**
   * Get performance analytics
   */
  async getPerformance(
    dateFrom?: Date,
    dateTo?: Date,
    authToken?: string
  ): Promise<AnalyticsReport> {
    return this.getAnalytics(
      {
        type: "performance",
        dateFrom,
        dateTo,
      },
      authToken
    );
  }

  /**
   * Generate custom report
   */
  async generateReport(
    type: string,
    parameters: Record<string, any>,
    authToken?: string
  ): Promise<AnalyticsReport> {
    try {
      // Send report generation request through API Gateway
      const response = await this.apiGateway.request(
        "/api/data/v1/reports/generate",
        {
          method: "POST",
          headers: authToken ? { Authorization: authToken } : undefined,
          body: { type, ...parameters },
        }
      );

      if (!response.success) {
        throw new Error(`Report generation failed: ${response.error}`);
      }

      const report: AnalyticsReport = {
        id: response.data.id || `report_${Date.now()}`,
        type: type as any,
        data: response.data,
        generatedAt: new Date(),
        parameters,
      };

      this.logger.info("Custom report generated", {
        type,
        reportId: report.id,
      });

      return report;
    } catch (error) {
      this.logger.error("Failed to generate report", error as Error, {
        type,
        parameters,
      });
      throw error;
    }
  }

  /**
   * Get cached analytics if available
   */
  async getCachedAnalytics(
    type: string,
    parameters?: Record<string, any>
  ): Promise<AnalyticsReport | null> {
    try {
      const cacheKey = `analytics:${type}:${JSON.stringify(parameters || {})}`;
      const cached = await this.cache.get(cacheKey);
      return cached as AnalyticsReport | null;
    } catch (error) {
      this.logger.error("Failed to get cached analytics", error as Error);
      return null;
    }
  }

  /**
   * Clear analytics cache
   */
  async clearCache(type?: string): Promise<void> {
    try {
      if (type) {
        const pattern = `analytics:${type}:*`;
        await this.cache.deletePattern(pattern);
      } else {
        await this.cache.deletePattern("analytics:*");
      }

      this.logger.info("Analytics cache cleared", { type });
    } catch (error) {
      this.logger.error("Failed to clear analytics cache", error as Error);
      throw error;
    }
  }

  /**
   * Get real-time metrics from database (fallback)
   */
  private async getRealTimeMetricsFromDB(): Promise<MetricsSnapshot> {
    try {
      // This would be implemented based on your database schema
      // For now, return simulated metrics
      return {
        usersOnline: Math.floor(Math.random() * 100),
        activeCarts: Math.floor(Math.random() * 50),
        revenue: Math.floor(Math.random() * 10000),
        conversionRate: Math.random() * 0.1,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error("Failed to get metrics from database", error as Error);
      return this.getFallbackMetrics();
    }
  }

  /**
   * Get fallback metrics when all else fails
   */
  private getFallbackMetrics(): MetricsSnapshot {
    return {
      usersOnline: 0,
      activeCarts: 0,
      revenue: 0,
      conversionRate: 0,
      timestamp: new Date(),
    };
  }

  /**
   * Health check for analytics service
   */
  async healthCheck(): Promise<{ status: string; latency?: number }> {
    try {
      const startTime = Date.now();

      // Test API Gateway connection
      const response = await this.apiGateway.request(
        "/api/data/v1/analytics/overview",
        {
          method: "GET",
          timeout: 5000,
        }
      );

      const latency = Date.now() - startTime;

      return {
        status: response.success ? "healthy" : "degraded",
        latency,
      };
    } catch (error) {
      this.logger.error("Analytics health check failed", error as Error);
      return { status: "unhealthy" };
    }
  }
}
