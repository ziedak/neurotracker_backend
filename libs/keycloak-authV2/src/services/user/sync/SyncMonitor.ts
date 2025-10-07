/**
 * SyncMonitor - Health Tracking and Monitoring
 *
 * Purpose: Monitor sync operations health and metrics
 *
 * Responsibilities:
 * - Track sync metrics (success/failure rates, durations)
 * - Monitor queue health
 * - Check system health
 * - Alert on issues
 */

import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  SyncConfig,
  HealthStatus,
  HealthCheck,
  HealthLevel,
  SyncMetrics,
  SyncOperation,
  SyncOperationType,
} from "./sync-types";
import { DEFAULT_SYNC_CONFIG } from "./sync-types";
import type { SyncQueue } from "./SyncQueue";

/**
 * SyncMonitor
 * Monitors sync operations and provides health status
 */
export class SyncMonitor {
  private readonly config: SyncConfig;
  private readonly logger: ILogger;
  private readonly metrics: IMetricsCollector;
  private readonly syncQueue: SyncQueue;

  // In-memory metrics tracking
  private successCount: number = 0;
  private failureCount: number = 0;
  private totalDuration: number = 0;
  private operationCount: number = 0;
  private errorsByType: Map<string, number> = new Map();
  private operationsByType: Map<SyncOperationType, number> = new Map();

  constructor(
    syncQueue: SyncQueue,
    config: Partial<SyncConfig>,
    logger: ILogger,
    metrics: IMetricsCollector
  ) {
    this.syncQueue = syncQueue;
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Record successful sync operation
   */
  recordSyncSuccess(operation: SyncOperation, duration: number): void {
    this.successCount++;
    this.totalDuration += duration;
    this.operationCount++;

    // Track by type
    const typeCount = this.operationsByType.get(operation.type) || 0;
    this.operationsByType.set(operation.type, typeCount + 1);

    // Update metrics
    this.metrics.recordCounter("sync.operations.success", 1);
    this.metrics.recordTimer("sync.operation.duration", duration);
    this.metrics.recordTimer(
      `sync.operation.${operation.type.toLowerCase()}.duration`,
      duration
    );

    this.logger.debug("Sync operation successful", {
      operationId: operation.id,
      userId: operation.userId,
      type: operation.type,
      duration,
      attempt: operation.attempt,
    });
  }

  /**
   * Record failed sync operation
   */
  recordSyncFailure(
    operation: SyncOperation,
    error: Error,
    duration: number
  ): void {
    this.failureCount++;
    this.totalDuration += duration;
    this.operationCount++;

    // Track error type
    const errorType = error.name || "Unknown";
    const errorCount = this.errorsByType.get(errorType) || 0;
    this.errorsByType.set(errorType, errorCount + 1);

    // Track by type
    const typeCount = this.operationsByType.get(operation.type) || 0;
    this.operationsByType.set(operation.type, typeCount + 1);

    // Update metrics
    this.metrics.recordCounter("sync.operations.failure", 1);
    this.metrics.recordCounter(`sync.operations.failure.${errorType}`, 1);
    this.metrics.recordTimer("sync.operation.duration", duration);

    this.logger.warn("Sync operation failed", {
      operationId: operation.id,
      userId: operation.userId,
      type: operation.type,
      duration,
      attempt: operation.attempt,
      error: error.message,
      errorType,
    });
  }

  /**
   * Check queue health
   */
  async checkQueueHealth(): Promise<HealthCheck> {
    try {
      const stats = await this.syncQueue.getStats();
      const queueHealth = await this.syncQueue.healthCheck();

      let status: HealthLevel = "HEALTHY";
      let message = "Queue is healthy";

      // Check queue size
      if (stats.pending > this.config.queueSizeThreshold * 5) {
        status = "UNHEALTHY";
        message = `Queue size critical: ${stats.pending} operations`;
      } else if (stats.pending > this.config.queueSizeThreshold) {
        status = "DEGRADED";
        message = `Queue size elevated: ${stats.pending} operations`;
      }

      // Check oldest operation age
      if (stats.oldestPendingAge) {
        const ageMinutes = stats.oldestPendingAge / 60000;
        if (ageMinutes > 30) {
          status = "UNHEALTHY";
          message = `Oldest operation is ${ageMinutes.toFixed(1)} minutes old`;
        } else if (ageMinutes > 10) {
          status = "DEGRADED";
          message = `Oldest operation is ${ageMinutes.toFixed(1)} minutes old`;
        }
      }

      // Check failed operations
      if (stats.failed > 100) {
        status = "UNHEALTHY";
        message = `${stats.failed} operations in dead letter queue`;
      } else if (stats.failed > 20) {
        if (status === "HEALTHY") {
          status = "DEGRADED";
        }
        message += ` (${stats.failed} failed operations)`;
      }

      return {
        status,
        message: queueHealth.healthy ? message : queueHealth.message,
        metrics: {
          pending: stats.pending,
          processing: stats.processing,
          retrying: stats.retrying,
          failed: stats.failed,
          oldestPendingAge: stats.oldestPendingAge || 0,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        status: "UNHEALTHY",
        message: `Queue health check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        metrics: {},
        timestamp: new Date(),
      };
    }
  }

  /**
   * Check sync operations health
   */
  async checkSyncHealth(): Promise<HealthCheck> {
    const successRate = this.getSuccessRate();
    const avgDuration = this.getAverageDuration();

    let status: HealthLevel = "HEALTHY";
    let message = "Sync operations are healthy";

    // Check success rate
    if (this.operationCount > 10) {
      // Only check if we have enough samples
      if (successRate < 0.8) {
        status = "UNHEALTHY";
        message = `Low success rate: ${(successRate * 100).toFixed(1)}%`;
      } else if (successRate < this.config.successRateThreshold) {
        status = "DEGRADED";
        message = `Success rate below threshold: ${(successRate * 100).toFixed(
          1
        )}%`;
      }
    }

    // Check average duration (warn if > 5 seconds)
    if (avgDuration > 10000) {
      status = "UNHEALTHY";
      message = `High average duration: ${(avgDuration / 1000).toFixed(1)}s`;
    } else if (avgDuration > 5000) {
      if (status === "HEALTHY") {
        status = "DEGRADED";
      }
      message += ` (avg duration: ${(avgDuration / 1000).toFixed(1)}s)`;
    }

    return {
      status,
      message,
      metrics: {
        successRate,
        avgDuration,
        totalOperations: this.operationCount,
        successCount: this.successCount,
        failureCount: this.failureCount,
      },
      timestamp: new Date(),
    };
  }

  /**
   * Get overall health status
   */
  async getOverallHealth(): Promise<HealthStatus> {
    const [queueHealth, syncHealth] = await Promise.all([
      this.checkQueueHealth(),
      this.checkSyncHealth(),
    ]);

    // Determine overall status (worst of the two)
    let overall: HealthLevel = "HEALTHY";
    if (
      queueHealth.status === "UNHEALTHY" ||
      syncHealth.status === "UNHEALTHY"
    ) {
      overall = "UNHEALTHY";
    } else if (
      queueHealth.status === "DEGRADED" ||
      syncHealth.status === "DEGRADED"
    ) {
      overall = "DEGRADED";
    }

    const health: HealthStatus = {
      overall,
      queue: queueHealth,
      sync: syncHealth,
      timestamp: new Date(),
    };

    // Log if unhealthy
    if (overall === "UNHEALTHY") {
      this.logger.error("Sync system unhealthy", {
        queue: queueHealth.message,
        sync: syncHealth.message,
      });
    } else if (overall === "DEGRADED") {
      this.logger.warn("Sync system degraded", {
        queue: queueHealth.message,
        sync: syncHealth.message,
      });
    }

    // Update gauge metrics
    this.metrics.recordGauge(
      "sync.health.overall",
      overall === "HEALTHY" ? 1 : overall === "DEGRADED" ? 0.5 : 0
    );
    this.metrics.recordGauge(
      "sync.health.queue",
      queueHealth.status === "HEALTHY"
        ? 1
        : queueHealth.status === "DEGRADED"
        ? 0.5
        : 0
    );
    this.metrics.recordGauge(
      "sync.health.sync",
      syncHealth.status === "HEALTHY"
        ? 1
        : syncHealth.status === "DEGRADED"
        ? 0.5
        : 0
    );

    return health;
  }

  /**
   * Should alert based on health status
   */
  async shouldAlert(): Promise<boolean> {
    const health = await this.getOverallHealth();
    return health.overall === "UNHEALTHY";
  }

  /**
   * Get alert details
   */
  async getAlertDetails(): Promise<string> {
    const health = await this.getOverallHealth();

    if (health.overall === "HEALTHY") {
      return "System is healthy";
    }

    const details: string[] = [];

    if (health.queue.status !== "HEALTHY") {
      details.push(`Queue: ${health.queue.message}`);
    }

    if (health.sync.status !== "HEALTHY") {
      details.push(`Sync: ${health.sync.message}`);
    }

    return details.join("; ");
  }

  /**
   * Get sync metrics
   */
  getSyncMetrics(): SyncMetrics {
    const successRate = this.getSuccessRate();
    const avgDuration = this.getAverageDuration();

    const byType: Record<SyncOperationType, number> = {
      CREATE: this.operationsByType.get("CREATE") || 0,
      UPDATE: this.operationsByType.get("UPDATE") || 0,
      DELETE: this.operationsByType.get("DELETE") || 0,
    };

    const errorsByType: Record<string, number> = {};
    this.errorsByType.forEach((count, type) => {
      errorsByType[type] = count;
    });

    return {
      total: this.operationCount,
      success: this.successCount,
      failed: this.failureCount,
      retries: this.operationCount - this.successCount - this.failureCount,
      avgDuration,
      successRate,
      byType,
      errorsByType,
    };
  }

  /**
   * Get success rate
   */
  private getSuccessRate(): number {
    if (this.operationCount === 0) {
      return 1.0;
    }
    return this.successCount / this.operationCount;
  }

  /**
   * Get average duration
   */
  private getAverageDuration(): number {
    if (this.operationCount === 0) {
      return 0;
    }
    return this.totalDuration / this.operationCount;
  }

  /**
   * Reset metrics (for testing or periodic reset)
   */
  resetMetrics(): void {
    this.successCount = 0;
    this.failureCount = 0;
    this.totalDuration = 0;
    this.operationCount = 0;
    this.errorsByType.clear();
    this.operationsByType.clear();

    this.logger.info("Metrics reset");
  }

  /**
   * Get metrics summary for logging
   */
  getMetricsSummary(): string {
    const metrics = this.getSyncMetrics();
    return [
      `Total: ${metrics.total}`,
      `Success: ${metrics.success} (${(metrics.successRate * 100).toFixed(
        1
      )}%)`,
      `Failed: ${metrics.failed}`,
      `Avg Duration: ${(metrics.avgDuration / 1000).toFixed(2)}s`,
    ].join(", ");
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(): NodeJS.Timeout {
    const interval = setInterval(async () => {
      try {
        await this.getOverallHealth();
      } catch (error) {
        this.logger.error("Health check failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.healthCheckInterval);

    this.logger.info("Health checks started", {
      interval: this.config.healthCheckInterval,
    });

    return interval;
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(interval: NodeJS.Timeout): void {
    clearInterval(interval);
    this.logger.info("Health checks stopped");
  }
}
