/**
 * UserSyncService - Async Keycloak Synchronization Orchestration
 *
 * Purpose: Coordinate async sync operations between local DB and Keycloak
 *
 * Architecture:
 * - Non-blocking: Queue operations return immediately
 * - Background worker: Processes queue operations
 * - Automatic retry: Failed operations retry with exponential backoff
 * - Health monitoring: Track sync status and system health
 *
 * Usage:
 * ```typescript
 * // Queue operations (returns immediately)
 * await syncService.queueUserCreate(userId, userData);
 * await syncService.queueUserUpdate(userId, updateData);
 * await syncService.queueUserDelete(userId);
 *
 * // Check status
 * const status = await syncService.getUserSyncStatus(userId);
 * const health = await syncService.getHealthStatus();
 * ```
 */

import type { RedisClient } from "@libs/database";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { UserCreateInput, UserUpdateInput } from "@libs/database";
import type { KeycloakUserClient } from "../KeycloakUserClient";
import { KeycloakConverter } from "../converters";
import { SyncQueue } from "./SyncQueue";
import { SyncMonitor } from "./SyncMonitor";
import type {
  SyncConfig,
  SyncOperation,
  SyncResult,
  SyncStatus,
  HealthStatus,
  QueueStats,
} from "./sync-types";
import { isRecoverableError, DEFAULT_SYNC_CONFIG } from "./sync-types";

/**
 * UserSyncService
 * Main orchestration service for async Keycloak sync
 */
export class UserSyncService {
  private readonly redis: RedisClient;
  private readonly keycloakClient: KeycloakUserClient;
  private readonly config: SyncConfig;
  private readonly logger: ILogger;
  private readonly metrics: IMetricsCollector;

  private readonly syncQueue: SyncQueue;
  private readonly syncMonitor: SyncMonitor;

  private workerInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  constructor(
    redis: RedisClient,
    keycloakClient: KeycloakUserClient,
    config: Partial<SyncConfig>,
    logger: ILogger,
    metrics: IMetricsCollector
  ) {
    this.redis = redis;
    this.keycloakClient = keycloakClient;
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    this.logger = logger;
    this.metrics = metrics;

    // Initialize queue and monitor
    this.syncQueue = new SyncQueue(redis, this.config, logger, metrics);
    this.syncMonitor = new SyncMonitor(
      this.syncQueue,
      this.config,
      logger,
      metrics
    );

    this.logger.info("UserSyncService initialized", {
      config: {
        maxRetries: this.config.maxRetries,
        workerConcurrency: this.config.workerConcurrency,
        workerPollInterval: this.config.workerPollInterval,
      },
    });
  }

  /**
   * Queue user creation sync
   * Returns immediately after queueing
   */
  async queueUserCreate(
    userId: string,
    userData: UserCreateInput
  ): Promise<void> {
    try {
      const operationId = await this.syncQueue.enqueue(
        userId,
        "CREATE",
        userData,
        1 // Higher priority for creates
      );

      this.logger.info("User create queued", {
        userId,
        operationId,
      });

      this.metrics.recordCounter("sync.user.create.queued", 1);
    } catch (error) {
      this.logger.error("Failed to queue user create", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Queue user update sync
   * Returns immediately after queueing
   */
  async queueUserUpdate(
    userId: string,
    userData: UserUpdateInput
  ): Promise<void> {
    try {
      const operationId = await this.syncQueue.enqueue(
        userId,
        "UPDATE",
        userData,
        0 // Normal priority
      );

      this.logger.info("User update queued", {
        userId,
        operationId,
      });

      this.metrics.recordCounter("sync.user.update.queued", 1);
    } catch (error) {
      this.logger.error("Failed to queue user update", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Queue user deletion sync
   * Returns immediately after queueing
   */
  async queueUserDelete(userId: string): Promise<void> {
    try {
      const operationId = await this.syncQueue.enqueue(
        userId,
        "DELETE",
        null,
        2 // Highest priority for deletes
      );

      this.logger.info("User delete queued", {
        userId,
        operationId,
      });

      this.metrics.recordCounter("sync.user.delete.queued", 1);
    } catch (error) {
      this.logger.error("Failed to queue user delete", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute user create sync
   * Called by background worker
   */
  private async syncUserCreate(
    userId: string,
    userData: UserCreateInput
  ): Promise<void> {
    // Convert to Keycloak format using KeycloakConverter
    const keycloakUser = KeycloakConverter.toKeycloakCreate(userData);

    // Set user ID to match local DB
    keycloakUser.id = userId;

    // Create in Keycloak (cast to CreateUserOptions for API compatibility)
    await this.keycloakClient.createUser(
      keycloakUser as import("../interfaces").CreateUserOptions
    );

    this.logger.info("User created in Keycloak", {
      userId,
      username: userData.username,
    });
  }
  /**
   * Execute user update sync
   * Called by background worker
   */
  private async syncUserUpdate(
    userId: string,
    userData: UserUpdateInput
  ): Promise<void> {
    // Convert to Keycloak format using KeycloakConverter
    const keycloakUpdate = KeycloakConverter.toKeycloakUpdate(userData);

    // Update in Keycloak (cast to UpdateUserOptions for API compatibility)
    await this.keycloakClient.updateUser(
      userId,
      keycloakUpdate as import("../interfaces").UpdateUserOptions
    );

    this.logger.info("User updated in Keycloak", {
      userId,
    });
  }

  /**
   * Execute user delete sync
   * Called by background worker
   */
  private async syncUserDelete(userId: string): Promise<void> {
    // Delete from Keycloak
    await this.keycloakClient.deleteUser(userId);

    this.logger.info("User deleted from Keycloak", {
      userId,
    });
  }

  /**
   * Process a single sync operation
   * Called by background worker
   */
  private async processOperation(
    operation: SyncOperation
  ): Promise<SyncResult> {
    const startTime = Date.now();

    try {
      // Execute based on operation type
      switch (operation.type) {
        case "CREATE":
          if (!operation.data) {
            throw new Error("CREATE operation missing data");
          }
          await this.syncUserCreate(
            operation.userId,
            operation.data as UserCreateInput
          );
          break;

        case "UPDATE":
          if (!operation.data) {
            throw new Error("UPDATE operation missing data");
          }
          await this.syncUserUpdate(
            operation.userId,
            operation.data as UserUpdateInput
          );
          break;

        case "DELETE":
          await this.syncUserDelete(operation.userId);
          break;

        default:
          throw new Error(`Unknown operation type: ${operation.type}`);
      }

      const duration = Date.now() - startTime;

      // Mark as successful
      await this.syncQueue.complete(operation.id);

      // Record metrics
      this.syncMonitor.recordSyncSuccess(operation, duration);

      return {
        success: true,
        operation,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error instanceof Error ? error : new Error(String(error));

      // Determine if error is recoverable
      const recoverable = isRecoverableError(err);

      // Mark as failed (will retry if recoverable)
      await this.syncQueue.fail(operation.id, err, recoverable);

      // Record metrics
      this.syncMonitor.recordSyncFailure(operation, err, duration);

      return {
        success: false,
        operation,
        error: err,
        duration,
        recoverable,
      };
    }
  }

  /**
   * Start background worker
   * Processes queue operations with configurable concurrency
   */
  startWorker(): void {
    if (this.workerInterval) {
      this.logger.warn("Worker already running");
      return;
    }

    this.logger.info("Starting sync worker", {
      concurrency: this.config.workerConcurrency,
      pollInterval: this.config.workerPollInterval,
    });

    // Start periodic queue processing
    this.workerInterval = setInterval(async () => {
      if (this.isShuttingDown) {
        return;
      }

      try {
        // Process operations with concurrency
        const promises: Promise<SyncResult>[] = [];

        for (let i = 0; i < this.config.workerConcurrency; i++) {
          const operation = await this.syncQueue.dequeue();

          if (!operation) {
            break; // Queue empty
          }

          // Process operation (don't await, allow concurrency)
          promises.push(this.processOperation(operation));
        }

        // Wait for all operations to complete
        if (promises.length > 0) {
          const results = await Promise.allSettled(promises);

          const successful = results.filter(
            (r) => r.status === "fulfilled" && r.value.success
          ).length;

          this.logger.debug("Worker batch completed", {
            total: promises.length,
            successful,
            failed: promises.length - successful,
          });
        }
      } catch (error) {
        this.logger.error("Worker error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.config.workerPollInterval);

    // Start health checks
    this.healthCheckInterval = this.syncMonitor.startHealthChecks();

    this.metrics.recordGauge("sync.worker.running", 1);
  }

  /**
   * Stop background worker
   * Graceful shutdown - waits for in-progress operations
   */
  async stopWorker(): Promise<void> {
    this.logger.info("Stopping sync worker");
    this.isShuttingDown = true;

    // Stop accepting new work
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }

    if (this.healthCheckInterval) {
      this.syncMonitor.stopHealthChecks(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Wait for in-progress operations (simple approach)
    // In production, you might want more sophisticated tracking
    await new Promise((resolve) => setTimeout(resolve, 5000));

    this.isShuttingDown = false;
    this.metrics.recordGauge("sync.worker.running", 0);

    this.logger.info("Sync worker stopped");
  }

  /**
   * Get sync status for a specific user
   */
  async getUserSyncStatus(userId: string): Promise<SyncStatus> {
    try {
      // Get status from Redis using raw client
      const key = `${this.config.redisKeyPrefix}status:${userId}`;
      const redis = this.redis.getRedis();
      const status = await redis.hgetall(key);

      if (!status || Object.keys(status).length === 0) {
        // No sync status yet
        return {
          userId,
          status: "SYNCED",
          pendingOperations: 0,
          failedOperations: 0,
        };
      }

      // Parse status with explicit undefined for optional properties
      const lastSyncAt = status["lastSyncAt"]
        ? new Date(status["lastSyncAt"])
        : undefined;
      const lastSyncType = status["lastSyncType"] as
        | "CREATE"
        | "UPDATE"
        | "DELETE"
        | undefined;
      const lastError = status["lastError"];

      return {
        userId,
        ...(lastSyncAt !== undefined && { lastSyncAt }),
        ...(lastSyncType !== undefined && { lastSyncType }),
        status:
          (status["status"] as "SYNCED" | "PENDING" | "FAILED" | "RETRYING") ||
          "SYNCED",
        pendingOperations: 0, // TODO: Track per-user pending count
        failedOperations: 0, // TODO: Track per-user failed count
        ...(lastError !== undefined && { lastError }),
      };
    } catch (error) {
      this.logger.error("Failed to get user sync status", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return safe default
      return {
        userId,
        status: "SYNCED",
        pendingOperations: 0,
        failedOperations: 0,
      };
    }
  }

  /**
   * Get overall sync system health
   */
  async getHealthStatus(): Promise<HealthStatus> {
    return await this.syncMonitor.getOverallHealth();
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    return await this.syncQueue.getStats();
  }

  /**
   * Check if system should alert
   */
  async shouldAlert(): Promise<boolean> {
    return await this.syncMonitor.shouldAlert();
  }

  /**
   * Get alert details
   */
  async getAlertDetails(): Promise<string> {
    return await this.syncMonitor.getAlertDetails();
  }

  /**
   * Get sync metrics summary
   */
  getMetricsSummary(): string {
    return this.syncMonitor.getMetricsSummary();
  }

  /**
   * Manually retry failed operations
   * Useful for administrative actions
   */
  async retryFailedOperations(limit: number = 10): Promise<number> {
    try {
      const failedOps = await this.syncQueue.getFailedOperations(limit);

      if (failedOps.length === 0) {
        return 0;
      }

      this.logger.info("Retrying failed operations", {
        count: failedOps.length,
      });

      // Re-queue failed operations
      for (const op of failedOps) {
        // Reset attempt counter for manual retry
        op.attempt = 0;
        op.status = "PENDING";

        await this.syncQueue.enqueue(op.userId, op.type, op.data, op.priority);
      }

      return failedOps.length;
    } catch (error) {
      this.logger.error("Failed to retry operations", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Clear failed operations queue
   * Use with caution - permanently discards failed operations
   */
  async clearFailedOperations(): Promise<number> {
    try {
      const failedOps = await this.syncQueue.getFailedOperations(1000);
      const count = failedOps.length;

      await this.redis.safeDel(`${this.config.redisKeyPrefix}queue:failed`);

      this.logger.warn("Failed operations cleared", { count });

      return count;
    } catch (error) {
      this.logger.error("Failed to clear operations", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Health check for service
   */
  async isHealthy(): Promise<boolean> {
    const health = await this.getHealthStatus();
    return health.overall !== "UNHEALTHY";
  }

  /**
   * Dispose resources and cleanup
   * Should be called when shutting down the service
   */
  async dispose(): Promise<void> {
    this.logger.info("Disposing UserSyncService");

    // Stop worker and health checks
    await this.stopWorker();

    // Clear any remaining intervals (defensive programming)
    if (this.workerInterval) {
      clearInterval(this.workerInterval);
      this.workerInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    this.logger.info("UserSyncService disposed");
  }
}
