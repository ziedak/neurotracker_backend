import {
  ClickHouseClient,
  PostgreSQLClient,
  RedisClient,
  DatabaseUtils,
  ClickHouseQueryBuilder,
} from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";

export interface ReportRequest {
  type: "conversion" | "revenue" | "performance" | "overview" | "custom";
  dateFrom?: string;
  dateTo?: string;
  filters?: Record<string, any>;
  aggregation?: "daily" | "weekly" | "monthly";
}

export interface ReportResult {
  reportId: string;
  status: "pending" | "processing" | "ready" | "failed";
  data?: any;
  url?: string;
  generatedAt?: string;
  error?: string;
}

/**
 * Business Intelligence Service
 * Handles analytics, reporting, and dashboard data generation
 */
export class BusinessIntelligenceService {
  private readonly clickhouse: ClickHouseClient;
  private readonly postgres: PostgreSQLClient;
  private readonly redis: RedisClient;
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  constructor(
    clickhouse: ClickHouseClient,
    postgres: PostgreSQLClient,
    redis: RedisClient,
    logger: ILogger,
    metrics: MetricsCollector
  ) {
    this.clickhouse = clickhouse;
    this.postgres = postgres;
    this.redis = redis;
    this.logger = logger;
    this.metrics = metrics;
  }

  // Enhanced caching configuration for performance optimization
  private readonly CACHE_CONFIG = {
    REPORT_TTL: 3600, // 1 hour for reports
    DASHBOARD_TTL: 300, // 5 minutes for dashboard data
    CUSTOM_REPORT_TTL: 1800, // 30 minutes for custom reports
    PERFORMANCE_TTL: 600, // 10 minutes for performance metrics
    CACHE_PREFIX: "bi:",
    CACHE_VERSION: "v1:",
  };

  // Performance monitoring targets
  private readonly PERFORMANCE_TARGETS = {
    REPORT_GENERATION_MAX_MS: 5000,
    CACHE_HIT_RATIO_TARGET: 0.85,
    QUERY_TIMEOUT_MS: 30000,
  };

  /**
   * Enhanced caching utility with performance monitoring
   */
  private async getCachedData<T>(
    key: string,
    ttl: number,
    generator: () => Promise<T>
  ): Promise<T> {
    const cacheKey = `${this.CACHE_CONFIG.CACHE_PREFIX}${this.CACHE_CONFIG.CACHE_VERSION}${key}`;
    const startTime = performance.now();

    try {
      // Get Redis instance from injected client
      const redisInstance = RedisClient.getInstance();

      // Try cache first
      const cached = await redisInstance.get(cacheKey);
      if (cached) {
        await this.metrics.recordCounter("bi_cache_hit");
        this.logger.debug("Cache hit", { key: cacheKey });
        return JSON.parse(cached);
      }

      // Cache miss - generate data
      await this.metrics.recordCounter("bi_cache_miss");
      this.logger.debug("Cache miss", { key: cacheKey });

      const data = await generator();

      // Cache the result
      await redisInstance.setex(cacheKey, ttl, JSON.stringify(data));

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("bi_cache_generation_time", duration);

      return data;
    } catch (error) {
      this.logger.error("Cache operation failed", error as Error, {
        key: cacheKey,
      });
      // Fallback to direct generation
      return await generator();
    }
  }

  /**
   * Generate comprehensive report based on type using enhanced caching
   */
  async generateReport(request: ReportRequest): Promise<ReportResult> {
    const startTime = performance.now();
    const reportId = `report-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    try {
      this.logger.info("Generating report", { reportId, type: request.type });

      // Create cache key based on request parameters
      const cacheKey = `report:${request.type}:${JSON.stringify({
        filters: request.filters,
        dateFrom: request.dateFrom,
        dateTo: request.dateTo,
        aggregation: request.aggregation,
      })}`;

      // Use enhanced caching for report generation
      const data = await this.getCachedData(
        cacheKey,
        this.CACHE_CONFIG.REPORT_TTL,
        async () => {
          return await DatabaseUtils.generateReport(
            request.type as any,
            request.filters || {},
            {
              dateFrom: request.dateFrom,
              dateTo: request.dateTo,
              groupBy: request.aggregation,
            }
          );
        }
      );

      const result: ReportResult = {
        reportId,
        status: "ready",
        data,
        url: `/reports/${reportId}`,
        generatedAt: new Date().toISOString(),
      };

      // Store specific report result for direct retrieval
      await this.cacheReport(reportId, result);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("report_generation_duration", duration, {
        type: request.type,
      });
      await this.metrics.recordCounter("reports_generated", 1, {
        type: request.type,
      });

      // Performance monitoring
      if (duration > this.PERFORMANCE_TARGETS.REPORT_GENERATION_MAX_MS) {
        this.logger.warn("Report generation exceeded target time", {
          reportId,
          duration,
          target: this.PERFORMANCE_TARGETS.REPORT_GENERATION_MAX_MS,
        });
      }

      this.logger.info("Report generated successfully", {
        reportId,
        type: request.type,
        duration: Math.round(duration),
      });

      return result;
    } catch (error) {
      this.logger.error("Report generation failed", error as Error, {
        reportId,
        type: request.type,
      });
      await this.metrics.recordCounter("report_generation_error", 1, {
        type: request.type,
      });

      return {
        reportId,
        status: "failed",
        error: (error as Error).message,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Get existing report by ID
   */
  async getReport(reportId: string): Promise<ReportResult | null> {
    try {
      // Try cache first
      const cached = await RedisClient.getInstance().get(`report:${reportId}`);
      if (cached) {
        return JSON.parse(cached);
      }

      // If not in cache, return not found
      return {
        reportId,
        status: "failed",
        error: "Report not found or expired",
      };
    } catch (error) {
      this.logger.error("Failed to retrieve report", error as Error, {
        reportId,
      });
      return null;
    }
  }

  /**
   * Generate custom report with secure query building
   */
  async generateCustomReport(
    table: string,
    aggregations: Array<{
      field: string;
      function: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";
      alias?: string;
    }>,
    filters: Record<string, any> = {},
    options: {
      dateFrom?: string;
      dateTo?: string;
      groupBy?: string[];
      limit?: number;
    } = {}
  ): Promise<any[]> {
    try {
      this.logger.info("Generating custom report", {
        table,
        aggregations: aggregations.length,
      });

      // Use secure DatabaseUtils for custom analytics
      const data = await DatabaseUtils.getAnalyticsData(
        table,
        aggregations,
        filters,
        {
          groupBy: options.groupBy,
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
          limit: options.limit || 10000,
        }
      );

      await this.metrics.recordCounter("custom_reports_generated");

      return data;
    } catch (error) {
      this.logger.error("Custom report generation failed", error as Error, {
        table,
      });
      throw error;
    }
  }

  /**
   * Get dashboard metrics with enhanced caching and secure aggregations
   */
  async getDashboardMetrics(
    dateFrom?: string,
    dateTo?: string
  ): Promise<Record<string, any>> {
    try {
      // Create cache key based on date range
      const cacheKey = `dashboard:metrics:${dateFrom || "all"}:${
        dateTo || "all"
      }`;

      // Use enhanced caching for dashboard data
      return await this.getCachedData(
        cacheKey,
        this.CACHE_CONFIG.DASHBOARD_TTL,
        async () => {
          const filters: Record<string, any> = {};

          // Use secure aggregation queries
          const [userMetrics, cartMetrics, eventMetrics] = await Promise.all([
            DatabaseUtils.getAnalyticsData(
              "users",
              [{ field: "id", function: "COUNT", alias: "total_users" }],
              filters,
              { dateFrom, dateTo }
            ),

            DatabaseUtils.getAnalyticsData(
              "carts",
              [
                { field: "id", function: "COUNT", alias: "total_carts" },
                { field: "total", function: "SUM", alias: "total_revenue" },
                { field: "total", function: "AVG", alias: "avg_cart_value" },
              ],
              filters,
              { dateFrom, dateTo }
            ),

            DatabaseUtils.getAnalyticsData(
              "user_events",
              [
                { field: "id", function: "COUNT", alias: "total_events" },
                { field: "userId", function: "COUNT", alias: "unique_users" },
              ],
              filters,
              { dateFrom, dateTo, groupBy: ["eventType"] }
            ),
          ]);

          return {
            users: userMetrics[0] || { total_users: 0 },
            carts: cartMetrics[0] || {
              total_carts: 0,
              total_revenue: 0,
              avg_cart_value: 0,
            },
            events: eventMetrics || [],
            generatedAt: new Date().toISOString(),
          };
        }
      );
    } catch (error) {
      this.logger.error("Dashboard metrics generation failed", error as Error);
      throw error;
    }
  }

  /**
   * Generate conversion funnel report
   */
  private async generateConversionReport(request: ReportRequest): Promise<any> {
    const { dateFrom, dateTo } = request;

    let whereClause = "1=1";
    const params: any = {};

    if (dateFrom) {
      whereClause += " AND timestamp >= {dateFrom:String}";
      params.dateFrom = dateFrom;
    }

    if (dateTo) {
      whereClause += " AND timestamp <= {dateTo:String}";
      params.dateTo = dateTo;
    }

    const query = `
      SELECT 
        step,
        count(*) as users,
        count(*) * 100.0 / (SELECT count(*) FROM events WHERE ${whereClause} AND step = 1) as percentage
      FROM conversion_funnel 
      WHERE ${whereClause}
      GROUP BY step 
      ORDER BY step
    `;

    const results = await ClickHouseClient.execute(query, params);
    return { funnel: results };
  }

  /**
   * Generate revenue attribution report
   */
  private async generateRevenueReport(request: ReportRequest): Promise<any> {
    const { dateFrom, dateTo, aggregation = "daily" } = request;

    let whereClause = "1=1";
    let groupBy = "";
    const params: any = {};

    if (dateFrom) {
      whereClause += " AND timestamp >= {dateFrom:String}";
      params.dateFrom = dateFrom;
    }

    if (dateTo) {
      whereClause += " AND timestamp <= {dateTo:String}";
      params.dateTo = dateTo;
    }

    switch (aggregation) {
      case "daily":
        groupBy = "toDate(timestamp)";
        break;
      case "weekly":
        groupBy = "toStartOfWeek(timestamp)";
        break;
      case "monthly":
        groupBy = "toStartOfMonth(timestamp)";
        break;
    }

    const queries = {
      bySource: `
        SELECT source, sum(revenue) as total 
        FROM revenue_attribution 
        WHERE ${whereClause}
        GROUP BY source 
        ORDER BY total DESC
      `,
      byTime: `
        SELECT ${groupBy} as period, sum(revenue) as total 
        FROM revenue_attribution 
        WHERE ${whereClause}
        GROUP BY period 
        ORDER BY period
      `,
    };

    const [bySource, byTime] = await Promise.all([
      ClickHouseClient.execute(queries.bySource, params),
      ClickHouseClient.execute(queries.byTime, params),
    ]);

    return { bySource, byTime };
  }

  /**
   * Generate model performance report
   */
  private async generatePerformanceReport(
    request: ReportRequest
  ): Promise<any> {
    const { dateFrom, dateTo } = request;

    let whereClause = "1=1";
    const params: any = {};

    if (dateFrom) {
      whereClause += " AND timestamp >= {dateFrom:String}";
      params.dateFrom = dateFrom;
    }

    if (dateTo) {
      whereClause += " AND timestamp <= {dateTo:String}";
      params.dateTo = dateTo;
    }

    const query = `
      SELECT 
        model,
        avg(accuracy) as avgAccuracy,
        avg(precision) as avgPrecision,
        avg(recall) as avgRecall,
        count(*) as predictionCount
      FROM model_performance 
      WHERE ${whereClause}
      GROUP BY model 
      ORDER BY avgAccuracy DESC
    `;

    const results = await ClickHouseClient.execute(query, params);
    return { models: results };
  }

  /**
   * Cache report for retrieval
   */
  private async cacheReport(
    reportId: string,
    report: ReportResult
  ): Promise<void> {
    try {
      await RedisClient.getInstance().setex(
        `report:${reportId}`,
        3600, // 1 hour TTL
        JSON.stringify(report)
      );
    } catch (error) {
      this.logger.warn("Failed to cache report", {
        reportId,
        error: (error as Error).message,
      });
    }
  }
}
