import { RedisClient } from "@libs/database";
import { createLogger } from "@libs/utils";
import { RateLimitResult, RateLimitConfig } from "./types";

/**
 * Configuration for distributed rate limiting
 */
export interface DistributedRateLimitConfig extends RateLimitConfig {
  distributed: {
    enabled: boolean;
    instanceId: string;
    syncInterval: number;
    maxDrift: number;
  };
  redis: {
    keyPrefix: string;
    ttlBuffer: number;
  };
  circuitBreaker: {
    enabled: boolean;
    failureThreshold: number;
    recoveryTimeout: number;
  };
}

/**
 * Distributed rate limiter with instance synchronization
 * Provides coordinated rate limiting across multiple instances
 */
export class DistributedRateLimit {
  private readonly logger = createLogger("DistributedRateLimit");
  private syncTimer?: NodeJS.Timeout;
  private lastSyncTime = Date.now();
  private instanceRegistry = new Set<string>();
  private circuitBreakerState: "closed" | "open" | "half-open" = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly config: DistributedRateLimitConfig,
    private readonly redisClient: RedisClient
  ) {
    if (!this.config.distributed.enabled) {
      throw new Error("Distributed rate limiting must be enabled in config");
    }

    this.instanceRegistry.add(this.config.distributed.instanceId);
    this.setupDistributedSync();
    this.setupEventHandlers();

    this.logger.info("Distributed rate limiting initialized", {
      instanceId: this.config.distributed.instanceId,
      syncInterval: this.config.distributed.syncInterval,
    });
  }

  /**
   * Check rate limit with distributed coordination
   */
  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    // Check circuit breaker
    if (this.circuitBreakerState === "open") {
      if (
        Date.now() - this.lastFailureTime <
        this.config.circuitBreaker.recoveryTimeout
      ) {
        return this.createBlockedResult(maxRequests, windowMs);
      } else {
        this.circuitBreakerState = "half-open";
      }
    }

    try {
      const distributedKey = `distributed:${this.config.distributed.instanceId}:${key}`;
      const globalKey = `global:${key}`;

      const redis = this.redisClient.getRedis();
      const now = Date.now();
      const windowStart = now - windowMs;

      // Check global limit first
      await redis.zremrangebyscore(globalKey, 0, windowStart);
      const globalCount = await redis.zcard(globalKey);

      if (globalCount >= maxRequests) {
        this.recordFailure();
        await this.publishEvent("denied", { key, globalCount, maxRequests });
        return this.createBlockedResult(maxRequests, windowMs);
      }

      // Check instance-specific limit
      await redis.zremrangebyscore(distributedKey, 0, windowStart);
      const instanceCount = await redis.zcard(distributedKey);

      if (
        instanceCount >= Math.ceil(maxRequests / this.instanceRegistry.size)
      ) {
        this.recordFailure();
        await this.publishEvent("denied", { key, instanceCount, maxRequests });
        return this.createBlockedResult(maxRequests, windowMs);
      }

      // Add to both global and instance counters
      const requestId = `${now}_${this.config.distributed.instanceId}`;
      await redis.zadd(globalKey, now, requestId);
      await redis.zadd(distributedKey, now, requestId);

      const ttl = Math.ceil((windowMs + this.config.redis.ttlBuffer) / 1000);
      await redis.expire(globalKey, ttl);
      await redis.expire(distributedKey, ttl);

      // Reset circuit breaker on success
      if (this.circuitBreakerState === "half-open") {
        this.circuitBreakerState = "closed";
        this.failureCount = 0;
      }

      const newGlobalCount = await redis.zcard(globalKey);

      return {
        allowed: true,
        totalHits: newGlobalCount,
        remaining: Math.max(0, maxRequests - newGlobalCount),
        resetTime: now + windowMs,
        windowStart,
        windowEnd: now + windowMs,
        limit: maxRequests,
        retryAfter: 0,
        algorithm: this.config.algorithm as any,
        cached: false,
        responseTime: Date.now() - now,
      };
    } catch (error) {
      this.recordFailure();
      this.logger.error("Distributed rate limit check failed", error as Error, {
        key,
      });
      return this.createBlockedResult(maxRequests, windowMs);
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    try {
      const distributedKey = `distributed:${this.config.distributed.instanceId}:${key}`;
      const globalKey = `global:${key}`;

      const redis = this.redisClient.getRedis();
      await redis.del(distributedKey);
      await redis.del(globalKey);

      await this.publishEvent("reset", { key });
      this.logger.info("Distributed rate limit reset", { key });
    } catch (error) {
      this.logger.error(
        "Failed to reset distributed rate limit",
        error as Error,
        { key }
      );
      throw error;
    }
  }

  /**
   * Get distributed health status
   */
  async getDistributedHealth(): Promise<{
    distributed: {
      enabled: boolean;
      instanceId: string;
      syncInterval: number;
      lastSyncTime: number;
      timeSinceLastSync: number;
    };
    circuitBreaker: any;
    instances: string[];
  }> {
    const now = Date.now();

    return {
      distributed: {
        enabled: this.config.distributed.enabled,
        instanceId: this.config.distributed.instanceId,
        syncInterval: this.config.distributed.syncInterval,
        lastSyncTime: this.lastSyncTime,
        timeSinceLastSync: now - this.lastSyncTime,
      },
      circuitBreaker: {
        enabled: this.config.circuitBreaker.enabled,
        state: this.circuitBreakerState,
        failureCount: this.failureCount,
        lastFailureTime: this.lastFailureTime,
      },
      instances: Array.from(this.instanceRegistry),
    };
  }

  /**
   * Get active instances
   */
  async getActiveInstances(): Promise<string[]> {
    // In a real implementation, this would query Redis for active instances
    return Array.from(this.instanceRegistry);
  }

  /**
   * Destroy the distributed limiter
   */
  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.logger.info("Distributed rate limiter destroyed", {
      instanceId: this.config.distributed.instanceId,
    });
  }

  /**
   * Setup periodic sync with other instances
   */
  private setupDistributedSync(): void {
    this.syncTimer = setInterval(() => {
      this.performSync();
    }, this.config.distributed.syncInterval);
  }

  /**
   * Perform synchronization with other instances
   */
  private async performSync(): Promise<void> {
    try {
      const now = Date.now();
      const timeSinceLastSync = now - this.lastSyncTime;

      // Check for time drift
      if (timeSinceLastSync > this.config.distributed.maxDrift) {
        this.logger.warn("Time drift detected", {
          drift: timeSinceLastSync,
          maxDrift: this.config.distributed.maxDrift,
          instanceId: this.config.distributed.instanceId,
        });
      }

      await this.publishEvent("heartbeat", {
        timestamp: now,
        instanceId: this.config.distributed.instanceId,
      });

      this.lastSyncTime = now;
    } catch (error) {
      this.logger.error("Distributed sync failed", error as Error, {
        instanceId: this.config.distributed.instanceId,
      });
    }
  }

  /**
   * Setup Redis pub/sub event handlers
   */
  private setupEventHandlers(): void {
    const redis = this.redisClient.getRedis();

    redis.subscribe("rate_limit:sync", "rate_limit:reset", "rate_limit:events");

    redis.on("message", (channel: string, message: string) => {
      try {
        const event = JSON.parse(message);

        // Ignore our own messages
        if (event.instanceId === this.config.distributed.instanceId) {
          return;
        }

        this.handleDistributedEvent(channel, event);
      } catch (error) {
        this.logger.error(
          "Failed to handle distributed event",
          error as Error,
          {
            channel,
            message,
          }
        );
      }
    });
  }

  /**
   * Handle incoming distributed events
   */
  private handleDistributedEvent(channel: string, event: any): void {
    switch (channel) {
      case "rate_limit:sync":
        this.handleSyncEvent(event);
        break;
      case "rate_limit:reset":
        this.handleResetEvent(event);
        break;
      case "rate_limit:events":
        this.handleRateLimitEvent(event);
        break;
    }
  }

  /**
   * Handle sync events from other instances
   */
  private handleSyncEvent(event: any): void {
    this.instanceRegistry.add(event.instanceId);
    this.logger.debug("Received sync from instance", {
      fromInstance: event.instanceId,
      instanceId: this.config.distributed.instanceId,
    });
  }

  /**
   * Handle reset events from other instances
   */
  private handleResetEvent(event: any): void {
    this.logger.info("Received reset event from instance", {
      fromInstance: event.instanceId,
      key: event.key,
    });
  }

  /**
   * Handle rate limit events from other instances
   */
  private handleRateLimitEvent(event: any): void {
    this.logger.debug("Received rate limit event", {
      type: event.type,
      fromInstance: event.instanceId,
      key: event.key,
    });
  }

  /**
   * Publish event to other instances
   */
  private async publishEvent(type: string, data: any): Promise<void> {
    try {
      const event = {
        ...data,
        instanceId: this.config.distributed.instanceId,
        timestamp: Date.now(),
        type,
      };

      await this.redisClient
        .getRedis()
        .publish("rate_limit:events", JSON.stringify(event));
    } catch (error) {
      this.logger.error("Failed to publish distributed event", error as Error, {
        type,
        data,
      });
    }
  }

  /**
   * Record a failure for circuit breaker
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.config.circuitBreaker.failureThreshold) {
      this.circuitBreakerState = "open";
      this.logger.warn("Circuit breaker opened", {
        failureCount: this.failureCount,
        threshold: this.config.circuitBreaker.failureThreshold,
      });
    }
  }

  /**
   * Create a blocked result
   */
  private createBlockedResult(
    maxRequests: number,
    windowMs: number
  ): RateLimitResult {
    const now = Date.now();
    return {
      allowed: false,
      totalHits: maxRequests,
      remaining: 0,
      resetTime: now + windowMs,
      windowStart: now - windowMs,
      windowEnd: now + windowMs,
      limit: maxRequests,
      retryAfter: Math.ceil(windowMs / 1000),
      algorithm: this.config.algorithm as any,
      cached: false,
      responseTime: 0,
    };
  }
}
