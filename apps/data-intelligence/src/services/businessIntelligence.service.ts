import {
  ClickHouseClient,
  PostgreSQLClient,
  RedisClient,
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
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(
    clickhouse: ClickHouseClient,
    postgres: PostgreSQLClient,
    redis: RedisClient,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.clickhouse = clickhouse;
    this.postgres = postgres;
    this.redis = redis;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Generate comprehensive report based on type
   */
  async generateReport(request: ReportRequest): Promise<ReportResult> {
    const startTime = performance.now();
    const reportId = `report-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    try {
      this.logger.info("Generating report", { reportId, type: request.type });

      let data: any;

      switch (request.type) {
        case "overview":
          data = await this.generateOverviewReport(request);
          break;
        case "conversion":
          data = await this.generateConversionReport(request);
          break;
        case "revenue":
          data = await this.generateRevenueReport(request);
          break;
        case "performance":
          data = await this.generatePerformanceReport(request);
          break;
        case "custom":
          data = await this.generateCustomReport(request);
          break;
        default:
          throw new Error(`Unsupported report type: ${request.type}`);
      }

      const result: ReportResult = {
        reportId,
        status: "ready",
        data,
        url: `/reports/${reportId}`,
        generatedAt: new Date().toISOString(),
      };

      // Cache the report for future retrieval
      await this.cacheReport(reportId, result);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("report_generation_duration", duration, {
        type: request.type,
      });
      await this.metrics.recordCounter("reports_generated", 1, {
        type: request.type,
      });

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
   * Generate overview analytics report
   */
  private async generateOverviewReport(request: ReportRequest): Promise<any> {
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

    const queries = {
      totalEvents: `SELECT count(*) as count FROM events WHERE ${whereClause}`,
      totalRevenue: `SELECT sum(revenue) as total FROM events WHERE ${whereClause} AND revenue > 0`,
      uniqueUsers: `SELECT uniq(userId) as count FROM events WHERE ${whereClause}`,
      conversionRate: `
        SELECT 
          countIf(eventType = 'purchase') * 100.0 / count(*) as rate 
        FROM events 
        WHERE ${whereClause}
      `,
    };

    const [totalEvents, totalRevenue, uniqueUsers, conversionRate] =
      await Promise.all([
        ClickHouseClient.execute(queries.totalEvents, params),
        ClickHouseClient.execute(queries.totalRevenue, params),
        ClickHouseClient.execute(queries.uniqueUsers, params),
        ClickHouseClient.execute(queries.conversionRate, params),
      ]);

    return {
      totalEvents: totalEvents[0]?.count || 0,
      totalRevenue: totalRevenue[0]?.total || 0,
      uniqueUsers: uniqueUsers[0]?.count || 0,
      conversionRate: conversionRate[0]?.rate || 0,
    };
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
   * Generate custom report based on filters
   */
  private async generateCustomReport(request: ReportRequest): Promise<any> {
    // This would implement custom query building based on request.filters
    // For now, return a placeholder
    return {
      message: "Custom report generation not yet implemented",
      filters: request.filters,
    };
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
