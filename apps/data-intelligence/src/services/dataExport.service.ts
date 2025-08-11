import {
  ClickHouseClient,
  PostgreSQLClient,
  RedisClient,
} from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";

export interface ExportOptions {
  format?: "json" | "csv" | "parquet";
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
  filters?: Record<string, any>;
}

export interface ExportResult {
  exportId: string;
  status: "pending" | "processing" | "completed" | "failed";
  recordCount?: number;
  downloadUrl?: string;
  error?: string;
}

/**
 * Data Export Service
 * Handles exporting data from various sources with pagination and filtering
 */
export class DataExportService {
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
   * Export events from ClickHouse
   */
  async exportEvents(options: ExportOptions = {}): Promise<any[]> {
    const startTime = performance.now();
    const { limit = 10000, offset = 0, dateFrom, dateTo } = options;

    try {
      this.logger.info("Starting events export", { limit, offset });

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
        SELECT * FROM events 
        WHERE ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const results = await ClickHouseClient.execute(query, params);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("events_export_duration", duration);
      await this.metrics.recordCounter("events_exported", results.length);

      this.logger.info("Events export completed", {
        recordCount: results.length,
        duration: Math.round(duration),
      });

      return results;
    } catch (error) {
      this.logger.error("Events export failed", error as Error);
      await this.metrics.recordCounter("events_export_error");
      throw error;
    }
  }

  /**
   * Export predictions from ClickHouse
   */
  async exportPredictions(options: ExportOptions = {}): Promise<any[]> {
    const startTime = performance.now();
    const { limit = 10000, offset = 0, dateFrom, dateTo } = options;

    try {
      this.logger.info("Starting predictions export", { limit, offset });

      let whereClause = "1=1";
      const params: any = {};

      if (dateFrom) {
        whereClause += " AND createdAt >= {dateFrom:String}";
        params.dateFrom = dateFrom;
      }

      if (dateTo) {
        whereClause += " AND createdAt <= {dateTo:String}";
        params.dateTo = dateTo;
      }

      const query = `
        SELECT * FROM predictions 
        WHERE ${whereClause}
        ORDER BY createdAt DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const results = await ClickHouseClient.execute(query, params);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("predictions_export_duration", duration);
      await this.metrics.recordCounter("predictions_exported", results.length);

      this.logger.info("Predictions export completed", {
        recordCount: results.length,
        duration: Math.round(duration),
      });

      return results;
    } catch (error) {
      this.logger.error("Predictions export failed", error as Error);
      await this.metrics.recordCounter("predictions_export_error");
      throw error;
    }
  }

  /**
   * Custom export with flexible query building
   */
  async exportCustom(request: {
    table: string;
    columns?: string[];
    filters?: Record<string, any>;
    orderBy?: string;
    options?: ExportOptions;
  }): Promise<any[]> {
    const startTime = performance.now();
    const {
      table,
      columns = ["*"],
      filters = {},
      orderBy = "createdAt DESC",
      options = {},
    } = request;
    const { limit = 10000, offset = 0 } = options;

    try {
      this.logger.info("Starting custom export", { table, limit, offset });

      // Build SELECT clause
      const selectClause = columns.join(", ");

      // Build WHERE clause from filters
      const whereConditions: string[] = [];
      const params: any = {};

      Object.entries(filters).forEach(([key, value], index) => {
        const paramName = `filter_${index}`;
        whereConditions.push(`${key} = {${paramName}:String}`);
        params[paramName] = value;
      });

      const whereClause =
        whereConditions.length > 0 ? whereConditions.join(" AND ") : "1=1";

      const query = `
        SELECT ${selectClause} FROM ${table} 
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `;

      const results = await ClickHouseClient.execute(query, params);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("custom_export_duration", duration);
      await this.metrics.recordCounter("custom_exported", results.length);

      this.logger.info("Custom export completed", {
        table,
        recordCount: results.length,
        duration: Math.round(duration),
      });

      return results;
    } catch (error) {
      this.logger.error("Custom export failed", error as Error, { table });
      await this.metrics.recordCounter("custom_export_error");
      throw error;
    }
  }

  /**
   * Generate export report with metadata
   */
  async generateExportReport(
    exportId: string,
    data: any[]
  ): Promise<ExportResult> {
    try {
      const result: ExportResult = {
        exportId,
        status: "completed",
        recordCount: data.length,
        downloadUrl: `/exports/${exportId}/download`,
      };

      // Cache the export result for later retrieval
      await RedisClient.getInstance().setex(
        `export:${exportId}`,
        3600, // 1 hour TTL
        JSON.stringify({ data, metadata: result })
      );

      this.logger.info("Export report generated", {
        exportId,
        recordCount: data.length,
      });

      return result;
    } catch (error) {
      this.logger.error("Export report generation failed", error as Error, {
        exportId,
      });
      return {
        exportId,
        status: "failed",
        error: (error as Error).message,
      };
    }
  }
}
