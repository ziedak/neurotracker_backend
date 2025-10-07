/**
 * SyncQueue - Redis-backed Queue with Retry Mechanism
 *
 * Purpose: Manage async sync operations with automatic retry
 *
 * Architecture:
 * - Redis-backed for persistence
 * - Exponential backoff for retries
 * - Dead letter queue for permanent failures
 * - Priority support
 *
 * Redis Keys:
 * - sync:queue:pending - List of pending operations
 * - sync:queue:processing - Set of in-progress operations
 * - sync:queue:retry - Sorted set of retry operations (by scheduled time)
 * - sync:queue:failed - Dead letter queue
 * - sync:operation:{id} - Operation details (hash)
 * - sync:stats - Queue statistics (hash)
 */

import type { RedisClient } from "@libs/database";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  SyncOperation,
  SyncConfig,
  QueueStats,
  SyncOperationType,
} from "./sync-types";
import {
  generateOperationId,
  calculateRetryDelay,
  DEFAULT_SYNC_CONFIG,
} from "./sync-types";
import type { UserCreateInput, UserUpdateInput } from "@libs/database";

/**
 * SyncQueue
 * Manages queue operations with Redis persistence
 */
export class SyncQueue {
  private readonly redis: RedisClient;
  private readonly config: SyncConfig;
  private readonly logger: ILogger;
  private readonly metrics: IMetricsCollector;
  private readonly keyPrefix: string;

  constructor(
    redis: RedisClient,
    config: Partial<SyncConfig>,
    logger: ILogger,
    metrics: IMetricsCollector
  ) {
    this.redis = redis;
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    this.logger = logger;
    this.metrics = metrics;
    this.keyPrefix = this.config.redisKeyPrefix;
  }

  /**
   * Enqueue a sync operation
   * Returns operation ID
   */
  async enqueue(
    userId: string,
    type: SyncOperationType,
    data: UserCreateInput | UserUpdateInput | null,
    priority: number = 0
  ): Promise<string> {
    const startTime = Date.now();

    try {
      // Check queue size
      const queueSize = await this.getQueueSize();
      if (queueSize >= this.config.maxQueueSize) {
        throw new Error(
          `Queue size limit reached: ${this.config.maxQueueSize}`
        );
      }

      // Create operation
      const operation: SyncOperation = {
        id: generateOperationId(),
        userId,
        type,
        data,
        attempt: 0,
        maxAttempts: this.config.maxRetries,
        createdAt: new Date(),
        scheduledFor: new Date(),
        status: "PENDING",
        priority,
      };

      // Store operation details
      await this.storeOperation(operation);

      // Add to pending queue (with priority if specified)
      if (priority > 0) {
        // Use sorted set for priority queue
        await this.redis.safeZadd(
          `${this.keyPrefix}queue:pending`,
          priority,
          operation.id
        );
      } else {
        // Use list for FIFO queue
        await this.redis.safeRpush(
          `${this.keyPrefix}queue:pending`,
          operation.id
        );
      }

      // Update stats
      await this.incrementStat("total");

      // Metrics
      const duration = Date.now() - startTime;
      this.metrics.recordTimer("sync.queue.enqueue", duration);
      this.metrics.recordCounter("sync.operations.enqueued", 1);

      this.logger.info("Operation enqueued", {
        operationId: operation.id,
        userId,
        type,
        priority,
      });

      return operation.id;
    } catch (error) {
      this.metrics.recordCounter("sync.queue.enqueue.error", 1);
      this.logger.error("Failed to enqueue operation", {
        userId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Dequeue next operation
   * Returns null if queue is empty
   */
  async dequeue(): Promise<SyncOperation | null> {
    try {
      // Check retry queue first (for scheduled retries)
      const retryOp = await this.dequeueRetry();
      if (retryOp) {
        return retryOp;
      }

      // Try priority queue (sorted set)
      let operationId = await this.redis.safeZpopmax(
        `${this.keyPrefix}queue:pending`,
        1
      );

      // Fall back to FIFO queue (list)
      if (!operationId || operationId.length === 0) {
        const id = await this.redis.safeLpop(`${this.keyPrefix}queue:pending`);
        if (!id) {
          return null;
        }
        operationId = [id, "0"];
      }

      const id = operationId[0];
      if (!id) {
        return null;
      }

      // Get operation details
      const operation = await this.getOperation(id);
      if (!operation) {
        this.logger.warn("Operation not found", { operationId: id });
        return null;
      }

      // Mark as processing
      operation.status = "PROCESSING";
      await this.storeOperation(operation);
      const redis = this.redis.getRedis();
      await redis.sadd(`${this.keyPrefix}queue:processing`, id);

      this.metrics.recordGauge(
        "sync.queue.processing",
        await this.getProcessingCount()
      );

      return operation;
    } catch (error) {
      this.logger.error("Failed to dequeue operation", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Dequeue operation from retry queue
   * Returns null if no operations are ready
   */
  private async dequeueRetry(): Promise<SyncOperation | null> {
    const now = Date.now();

    // Get operations that are ready to retry (score <= now)
    const redis = this.redis.getRedis();
    const results = await redis.zrangebyscore(
      `${this.keyPrefix}queue:retry`,
      0,
      now,
      "LIMIT",
      0,
      1
    );

    if (!results || results.length === 0) {
      return null;
    }

    const operationId = results[0];
    if (!operationId) {
      return null;
    }

    // Remove from retry queue
    await redis.zrem(`${this.keyPrefix}queue:retry`, operationId);

    // Get operation
    const operation = await this.getOperation(operationId);
    if (!operation) {
      return null;
    }

    // Mark as processing
    operation.status = "PROCESSING";
    await this.storeOperation(operation);
    await redis.sadd(`${this.keyPrefix}queue:processing`, operationId);

    return operation;
  }

  /**
   * Mark operation as completed successfully
   */
  async complete(operationId: string): Promise<void> {
    try {
      // Remove from processing
      await this.redis.safeSrem(
        `${this.keyPrefix}queue:processing`,
        operationId
      );

      // Update operation
      const operation = await this.getOperation(operationId);
      if (operation) {
        operation.status = "COMPLETED";
        await this.storeOperation(operation);

        // Update user sync status
        await this.updateUserSyncStatus(operation.userId, operation.type);
      }

      // Update stats
      await this.incrementStat("successful");

      // Delete operation after success (optional: keep for audit)
      await this.redis.safeDel(`${this.keyPrefix}operation:${operationId}`);

      this.metrics.recordCounter("sync.operations.completed", 1);
      this.metrics.recordGauge(
        "sync.queue.processing",
        await this.getProcessingCount()
      );

      this.logger.info("Operation completed", { operationId });
    } catch (error) {
      this.logger.error("Failed to complete operation", {
        operationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Mark operation as failed and schedule retry or move to dead letter queue
   */
  async fail(
    operationId: string,
    error: Error,
    recoverable: boolean
  ): Promise<void> {
    try {
      // Remove from processing
      await this.redis.safeSrem(
        `${this.keyPrefix}queue:processing`,
        operationId
      );

      // Get operation
      const operation = await this.getOperation(operationId);
      if (!operation) {
        this.logger.warn("Operation not found for failure", { operationId });
        return;
      }

      // Update operation
      operation.lastError = error.message;
      operation.attempt++;

      // Decide whether to retry
      const shouldRetry =
        recoverable && operation.attempt < operation.maxAttempts;

      if (shouldRetry) {
        // Schedule retry
        await this.scheduleRetry(operation);
        this.metrics.recordCounter("sync.operations.retry", 1);
      } else {
        // Move to dead letter queue
        operation.status = "FAILED";
        await this.storeOperation(operation);
        await this.redis.safeRpush(
          `${this.keyPrefix}queue:failed`,
          operationId
        );

        // Update stats
        await this.incrementStat("failed");

        this.metrics.recordCounter("sync.operations.failed", 1);

        this.logger.error("Operation failed permanently", {
          operationId,
          userId: operation.userId,
          type: operation.type,
          attempts: operation.attempt,
          error: error.message,
        });
      }

      this.metrics.recordGauge(
        "sync.queue.processing",
        await this.getProcessingCount()
      );
    } catch (err) {
      this.logger.error("Failed to handle operation failure", {
        operationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Schedule operation for retry with exponential backoff
   */
  private async scheduleRetry(operation: SyncOperation): Promise<void> {
    const delay = calculateRetryDelay(operation.attempt, this.config);
    const scheduledFor = new Date(Date.now() + delay);

    operation.scheduledFor = scheduledFor;
    operation.status = "RETRYING";

    await this.storeOperation(operation);

    // Add to retry queue (sorted set with scheduled time as score)
    await this.redis.safeZadd(
      `${this.keyPrefix}queue:retry`,
      scheduledFor.getTime(),
      operation.id
    );

    this.logger.info("Operation scheduled for retry", {
      operationId: operation.id,
      userId: operation.userId,
      attempt: operation.attempt,
      maxAttempts: operation.maxAttempts,
      delay,
      scheduledFor,
    });
  }

  /**
   * Store operation in Redis
   */
  private async storeOperation(operation: SyncOperation): Promise<void> {
    const key = `${this.keyPrefix}operation:${operation.id}`;
    const value = JSON.stringify(operation);
    await this.redis.safeSet(key, value);

    // Set TTL (7 days)
    await this.redis.safeExpire(key, 7 * 24 * 60 * 60);
  }

  /**
   * Get operation from Redis
   */
  private async getOperation(
    operationId: string
  ): Promise<SyncOperation | null> {
    const key = `${this.keyPrefix}operation:${operationId}`;
    const value = await this.redis.safeGet(key);

    if (!value) {
      return null;
    }

    const operation = JSON.parse(value) as SyncOperation;

    // Convert date strings back to Date objects
    operation.createdAt = new Date(operation.createdAt);
    operation.scheduledFor = new Date(operation.scheduledFor);

    return operation;
  }

  /**
   * Update user sync status
   */
  private async updateUserSyncStatus(
    userId: string,
    type: SyncOperationType
  ): Promise<void> {
    const key = `${this.keyPrefix}status:${userId}`;
    await this.redis.safeHset(
      key,
      "lastSyncAt",
      new Date().toISOString(),
      "lastSyncType",
      type,
      "status",
      "SYNCED"
    );

    // Set TTL (30 days)
    await this.redis.safeExpire(key, 30 * 24 * 60 * 60);
  }

  /**
   * Increment stat counter
   */
  private async incrementStat(stat: string): Promise<void> {
    await this.redis.safeHincrby(`${this.keyPrefix}stats`, stat, 1);
  }

  /**
   * Get queue size (pending + retrying)
   */
  async getQueueSize(): Promise<number> {
    const pending = await this.redis.safeLlen(`${this.keyPrefix}queue:pending`);
    const priorityPending = await this.redis.safeZcard(
      `${this.keyPrefix}queue:pending`
    );
    const retrying = await this.redis.safeZcard(`${this.keyPrefix}queue:retry`);

    return pending + priorityPending + retrying;
  }

  /**
   * Get processing count
   */
  private async getProcessingCount(): Promise<number> {
    return await this.redis.safeScard(`${this.keyPrefix}queue:processing`);
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const [pending, processing, retrying, failed, stats, oldestRetry] =
      await Promise.all([
        this.getQueueSize(),
        this.getProcessingCount(),
        this.redis.safeZcard(`${this.keyPrefix}queue:retry`),
        this.redis.safeLlen(`${this.keyPrefix}queue:failed`),
        this.redis.safeHgetall(`${this.keyPrefix}stats`),
        this.redis.safeZrange(
          `${this.keyPrefix}queue:retry`,
          0,
          0,
          "WITHSCORES"
        ),
      ]);

    const totalProcessed = parseInt(stats["total"] || "0", 10);
    const totalSuccessful = parseInt(stats["successful"] || "0", 10);
    const totalFailed = parseInt(stats["failed"] || "0", 10);
    const avgDuration = parseFloat(stats["avgDuration"] || "0");

    let oldestPendingAge: number | undefined;
    if (oldestRetry.length >= 2 && oldestRetry[1]) {
      const scheduledTime = parseInt(oldestRetry[1], 10);
      oldestPendingAge = Date.now() - scheduledTime;
    }

    const result: QueueStats = {
      pending,
      processing,
      retrying,
      failed,
      totalProcessed,
      totalSuccessful,
      totalFailed,
      avgDuration,
    };

    // Add optional property only if defined
    if (oldestPendingAge !== undefined) {
      result.oldestPendingAge = oldestPendingAge;
    }

    return result;
  }

  /**
   * Get pending operations
   */
  async getPendingOperations(limit: number = 10): Promise<SyncOperation[]> {
    const operationIds = await this.redis.safeLrange(
      `${this.keyPrefix}queue:pending`,
      0,
      limit - 1
    );

    const operations: SyncOperation[] = [];
    for (const id of operationIds) {
      const op = await this.getOperation(id);
      if (op) {
        operations.push(op);
      }
    }

    return operations;
  }

  /**
   * Get failed operations
   */
  async getFailedOperations(limit: number = 10): Promise<SyncOperation[]> {
    const operationIds = await this.redis.safeLrange(
      `${this.keyPrefix}queue:failed`,
      0,
      limit - 1
    );

    const operations: SyncOperation[] = [];
    for (const id of operationIds) {
      const op = await this.getOperation(id);
      if (op) {
        operations.push(op);
      }
    }

    return operations;
  }

  /**
   * Clear all queues (for testing/maintenance)
   */
  async clear(): Promise<void> {
    await this.redis.safeDel(
      `${this.keyPrefix}queue:pending`,
      `${this.keyPrefix}queue:processing`,
      `${this.keyPrefix}queue:retry`,
      `${this.keyPrefix}queue:failed`,
      `${this.keyPrefix}stats`
    );

    this.logger.info("Queue cleared");
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      const stats = await this.getStats();

      // Check queue size
      if (stats.pending > this.config.queueSizeThreshold) {
        return {
          healthy: false,
          message: `Queue size (${stats.pending}) exceeds threshold (${this.config.queueSizeThreshold})`,
        };
      }

      // Check oldest operation age
      if (
        stats.oldestPendingAge &&
        stats.oldestPendingAge > this.config.operationAgeThreshold
      ) {
        return {
          healthy: false,
          message: `Oldest operation age (${stats.oldestPendingAge}ms) exceeds threshold (${this.config.operationAgeThreshold}ms)`,
        };
      }

      return {
        healthy: true,
        message: "Queue is healthy",
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Health check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}
