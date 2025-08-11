import {
  ClickHouseClient,
  PostgreSQLClient,
  RedisClient,
  DatabaseUtils,
  ClickHouseQueryBuilder,
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
 * Data Export Service using secure database utilities
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
   * Export events from ClickHouse using secure DatabaseUtils
   */
  async exportEvents(options: ExportOptions = {}): Promise<any[]> {
    const startTime = performance.now();
    const {
      limit = 10000,
      offset = 0,
      dateFrom,
      dateTo,
      filters = {},
    } = options;

    try {
      this.logger.info("Starting events export", { limit, offset });

      // Add date filters to the filters object
      if (dateFrom || dateTo) {
        if (dateFrom) filters.dateFrom = dateFrom;
        if (dateTo) filters.dateTo = dateTo;
      }

      // Use secure DatabaseUtils for export
      const results = await DatabaseUtils.exportData("user_events", filters, {
        select: [
          "id",
          "userId",
          "eventType",
          "timestamp",
          "metadata",
          "pageUrl",
        ],
        limit: Math.min(limit, 100000), // Max 100k records
        offset,
        orderBy: [{ field: "timestamp", direction: "DESC" }],
        format: "json",
      });

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
      throw error;
    }
  }

  /**
   * Export predictions from ClickHouse using secure DatabaseUtils
   */
  async exportPredictions(options: ExportOptions = {}): Promise<any[]> {
    const startTime = performance.now();
    const {
      limit = 10000,
      offset = 0,
      dateFrom,
      dateTo,
      filters = {},
    } = options;

    try {
      this.logger.info("Starting predictions export", { limit, offset });

      // Add date filters to the filters object
      if (dateFrom || dateTo) {
        if (dateFrom) filters.dateFrom = dateFrom;
        if (dateTo) filters.dateTo = dateTo;
      }

      // Use secure DatabaseUtils for export
      const results = await DatabaseUtils.exportData("predictions", filters, {
        select: ["id", "modelId", "input", "output", "confidence", "createdAt"],
        limit: Math.min(limit, 100000), // Max 100k records
        offset,
        orderBy: [{ field: "createdAt", direction: "DESC" }],
        format: "json",
      });

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
   * Custom export with flexible query building using secure DatabaseUtils
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

      // Parse order by clause safely
      const orderByParts = orderBy.split(" ");
      const orderByField = orderByParts[0] || "createdAt";
      const orderByDirection =
        orderByParts[1]?.toUpperCase() === "ASC" ? "ASC" : "DESC";

      // Use secure DatabaseUtils for custom export
      const results = await DatabaseUtils.exportData(table, filters, {
        select: columns,
        limit: Math.min(limit, 100000), // Max 100k records
        offset,
        orderBy: [
          {
            field: orderByField,
            direction: orderByDirection as "ASC" | "DESC",
          },
        ],
        format: "json",
      });

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
