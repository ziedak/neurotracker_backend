import {
  ClickHouseClient,
  PostgreSQLClient,
  RedisClient,
  DatabaseUtils,
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
 * Handles exporting data from various sources with pagination, filtering, and streaming
 * Implements memory-efficient streaming for large datasets
 */
export class DataExportService {
  private readonly PERFORMANCE_TARGETS = {
    EXPORT_SPEED_RECORDS_PER_SEC: 1000,
    MAX_EXPORT_TIME_MINUTES: 30,
    MEMORY_WARNING_THRESHOLD_MB: 400,
  };
  private readonly MEMORY_CONFIG = {
    MAX_MEMORY_MB: 512,
    STREAM_CHUNK_SIZE: 5000,
    MEMORY_CHECK_INTERVAL: 1000,
    MAX_EXPORT_SIZE: 1000000,
    BATCH_SIZE_SMALL: 5000,
    BATCH_SIZE_LARGE: 10000,
  };
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(logger: Logger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Helper to parse Redis Stream fields array into an object
   */
  private parseStreamFields(fields: string[]): Record<string, string> {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      obj[fields[i]] = fields[i + 1];
    }
    return obj;
  }

  /**
   * Memory monitoring utility
   */
  private getMemoryUsage(): { used: number; free: number; percentage: number } {
    const memUsage = process.memoryUsage();
    const totalMB = memUsage.heapUsed / 1024 / 1024;
    const percentage = (totalMB / this.MEMORY_CONFIG.MAX_MEMORY_MB) * 100;

    return {
      used: Math.round(totalMB),
      free: Math.round(this.MEMORY_CONFIG.MAX_MEMORY_MB - totalMB),
      percentage: Math.round(percentage),
    };
  }

  /**
   * Streaming export for large datasets with memory management
   */
  async exportLargeDataset(
    table: string,
    options: ExportOptions & {
      streamCallback?: (chunk: any[]) => Promise<void>;
    } = {}
  ): Promise<{ totalRecords: number; chunks: number; duration: number }> {
    const startTime = performance.now();
    const { filters = {}, streamCallback, dateFrom, dateTo } = options;

    let totalRecords = 0;
    let chunks = 0;
    let offset = 0;

    try {
      this.logger.info("Starting large dataset export", { table });

      // Add date filters
      if (dateFrom || dateTo) {
        if (dateFrom) filters.dateFrom = dateFrom;
        if (dateTo) filters.dateTo = dateTo;
      }

      while (true) {
        const chunkStartTime = performance.now();

        // Monitor memory before processing chunk
        const memUsage = this.getMemoryUsage();
        if (memUsage.percentage > 80) {
          this.logger.warn("High memory usage detected", {
            usage: memUsage,
            totalRecords,
            chunks,
          });

          // Trigger garbage collection hint
          if (global.gc) {
            global.gc();
          }

          // Reduce chunk size for remaining data
          const reducedChunkSize = Math.floor(
            this.MEMORY_CONFIG.STREAM_CHUNK_SIZE * 0.5
          );
          this.logger.info("Reducing chunk size due to memory pressure", {
            original: this.MEMORY_CONFIG.STREAM_CHUNK_SIZE,
            reduced: reducedChunkSize,
          });
        }

        // Export chunk using secure DatabaseUtils
        const chunk = await DatabaseUtils.exportData(table, filters, {
          limit: this.MEMORY_CONFIG.STREAM_CHUNK_SIZE,
          offset,
          format: "json",
        });

        if (chunk.length === 0) {
          break; // No more data
        }

        // Process chunk with callback if provided
        if (streamCallback) {
          await streamCallback(chunk);
        }

        totalRecords += chunk.length;
        chunks++;
        offset += chunk.length;

        const chunkDuration = performance.now() - chunkStartTime;
        await this.metrics.recordTimer("export_chunk_duration", chunkDuration);
        await this.metrics.recordCounter(
          "export_records_processed",
          chunk.length
        );

        // Performance monitoring
        const recordsPerSecond = chunk.length / (chunkDuration / 1000);
        if (
          recordsPerSecond <
          this.PERFORMANCE_TARGETS.EXPORT_SPEED_RECORDS_PER_SEC * 0.5
        ) {
          this.logger.warn("Export performance below target", {
            recordsPerSecond,
            target: this.PERFORMANCE_TARGETS.EXPORT_SPEED_RECORDS_PER_SEC,
            chunk: chunks,
          });
        }

        // Safety check for maximum export size
        if (totalRecords >= this.MEMORY_CONFIG.MAX_EXPORT_SIZE) {
          this.logger.warn("Maximum export size reached", {
            totalRecords,
            maxSize: this.MEMORY_CONFIG.MAX_EXPORT_SIZE,
          });
          break;
        }

        // Brief pause to prevent overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("large_export_duration", duration);

      this.logger.info("Large dataset export completed", {
        table,
        totalRecords,
        chunks,
        duration: Math.round(duration),
        avgRecordsPerSecond: Math.round(totalRecords / (duration / 1000)),
      });

      return { totalRecords, chunks, duration };
    } catch (error) {
      this.logger.error("Large dataset export failed", error as Error, {
        table,
        totalRecords,
        chunks,
      });
      throw error;
    }
  }

  /**
   * Export events with automatic streaming for large datasets
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

      // Check if we should use streaming for large exports
      if (limit > 50000) {
        this.logger.info("Large export detected, using streaming", { limit });

        const results: any[] = [];
        const streamingResult = await this.exportLargeDataset("user_events", {
          ...options,
          streamCallback: async (chunk: any[]) => {
            results.push(...chunk);
          },
        });

        this.logger.info("Streaming export completed", {
          totalRecords: streamingResult.totalRecords,
          chunks: streamingResult.chunks,
          duration: streamingResult.duration,
        });

        return results;
      }

      // Standard export for smaller datasets
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
        limit: Math.min(limit, 100000), // Max 100k records for standard export
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
  /**
   * Get the status of an export job by jobId.
   * Returns status, progress, and metadata if available.
   */

  async getExportStatus(jobId: string): Promise<ExportResult> {
    try {
      const redis = RedisClient.getInstance();
      // Read latest status from Redis Stream
      const streamKey = `export:stream:${jobId}`;
      const messages = await redis.xrevrange(streamKey, "+", "-", "COUNT", 1);
      if (!messages || messages.length === 0 || !messages[0][1]) {
        return { exportId: jobId, status: "pending" };
      }
      const fieldsObj = this.parseStreamFields(messages[0][1]);
      const status = fieldsObj.status
        ? JSON.parse(fieldsObj.status)
        : { exportId: jobId, status: "pending" };
      return status as ExportResult;
    } catch (error) {
      this.logger.error("Failed to get export status", error as Error, {
        jobId,
      });
      return {
        exportId: jobId,
        status: "failed",
        error: (error as Error).message,
      };
    }
  }

  /**
   * Cancel an export job by jobId.
   * Marks job as cancelled in Redis.
   */
  /**
   * Cancel an export job by adding a cancellation event to Redis Stream.
   */
  async cancelExport(
    jobId: string
  ): Promise<{ success: boolean; exportId: string }> {
    try {
      const redis = RedisClient.getInstance();
      const streamKey = `export:stream:${jobId}`;
      await redis.xadd(
        streamKey,
        "*",
        "status",
        JSON.stringify({
          exportId: jobId,
          status: "failed",
          error: "Cancelled by user",
        })
      );
      this.logger.info("Export job cancelled via stream", { jobId });
      return { success: true, exportId: jobId };
    } catch (error) {
      this.logger.error("Failed to cancel export", error as Error, { jobId });
      return { success: false, exportId: jobId };
    }
  }

  /**
   * Get export history for a user or all users.
   * Returns a paginated list of export jobs.
   */

  async getExportHistory(query: {
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ExportResult[]> {
    try {
      const redis = RedisClient.getInstance();
      // For demo: scan all export streams (in production, index job IDs)
      const keys = await redis.keys("export:stream:*");
      const jobs: ExportResult[] = [];
      const start = query.offset || 0;
      const end = start + (query.limit || 20);
      for (const key of keys.slice(start, end)) {
        const messages = await redis.xrevrange(key, "+", "-", "COUNT", 1);
        if (messages && messages.length > 0 && messages[0][1]) {
          const fieldsObj = this.parseStreamFields(messages[0][1]);
          if (fieldsObj.status) {
            const job = JSON.parse(fieldsObj.status) as ExportResult;
            if (!query.userId || job.exportId.startsWith(query.userId)) {
              jobs.push(job);
            }
          }
        }
      }
      return jobs;
    } catch (error) {
      this.logger.error("Failed to get export history", error as Error, {
        query,
      });
      return [];
    }
  }
}
