import { RedisClient } from "@libs/database";
import { ILogger } from "@libs/monitoring";
import { OptimizedRedisRateLimit, RateLimitConfig } from "./redisRateLimit";

/**
 * Distributed rate limiting configuration
 */
export interface DistributedRateLimitConfig extends RateLimitConfig {
  distributed?: {
    enabled: boolean;
    instanceId: string;
    syncInterval?: number; // How often to sync with other instances
    maxDrift?: number; // Maximum allowed time drift between instances
  };
}

/**
 * Distributed rate limiter that coordinates across multiple instances
 * Uses Redis pub/sub for cross-instance communication
 */
export class DistributedRateLimit extends OptimizedRedisRateLimit {
  private readonly instanceId: string;
  private readonly syncInterval: number;
  private readonly maxDrift: number;
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncTime = 0;

  constructor(
    config: DistributedRateLimitConfig,
    redisClient: RedisClient,
    logger: ILogger
  ) {
    super(config, redisClient, logger);

    if (!config.distributed?.enabled) {
      throw new Error("Distributed rate limiting must be enabled in config");
    }

    this.instanceId = config.distributed.instanceId;
    this.syncInterval = config.distributed.syncInterval || 30000; // 30 seconds
    this.maxDrift = config.distributed.maxDrift || 5000; // 5 seconds

    this.initializeDistributedFeatures();
  }

  /**
   * Initialize distributed features
   */
  private initializeDistributedFeatures(): void {
    // Start periodic sync
    this.startPeriodicSync();

    // Subscribe to distributed events
    this.subscribeToDistributedEvents();

    this.logger.info("Distributed rate limiting initialized", {
      instanceId: this.instanceId,
      syncInterval: this.syncInterval,
    });
  }

  /**
   * Start periodic synchronization with other instances
   */
  private startPeriodicSync(): void {
    this.syncTimer = setInterval(() => {
      this.performSync();
    }, this.syncInterval);
  }

  /**
   * Perform synchronization with other instances
   */
  private async performSync(): Promise<void> {
    try {
      const now = Date.now();
      const redis = this.redisClient.getRedis();

      // Publish heartbeat
      await redis.publish(
        "rate_limit:sync",
        JSON.stringify({
          instanceId: this.instanceId,
          timestamp: now,
          type: "heartbeat",
        })
      );

      // Check for time drift
      const drift = Math.abs(now - this.lastSyncTime);
      if (drift > this.maxDrift) {
        this.logger.warn("Time drift detected", {
          drift,
          maxDrift: this.maxDrift,
          instanceId: this.instanceId,
        });
      }

      this.lastSyncTime = now;
    } catch (error) {
      this.logger.error("Distributed sync failed", error as Error, {
        instanceId: this.instanceId,
      });
    }
  }

  /**
   * Subscribe to distributed events
   */
  private subscribeToDistributedEvents(): void {
    // Create a separate Redis client for pub/sub
    const subscriber = this.redisClient.getRedis();

    subscriber.subscribe(
      "rate_limit:sync",
      "rate_limit:reset",
      "rate_limit:alert"
    );

    subscriber.on("message", (channel, message) => {
      try {
        const event = JSON.parse(message);

        // Ignore our own messages
        if (event.instanceId === this.instanceId) {
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
   * Handle distributed events from other instances
   */
  private handleDistributedEvent(channel: string, event: any): void {
    switch (channel) {
      case "rate_limit:sync":
        this.handleSyncEvent(event);
        break;

      case "rate_limit:reset":
        this.handleResetEvent(event);
        break;

      case "rate_limit:alert":
        this.handleAlertEvent(event);
        break;

      default:
        this.logger.debug("Unknown distributed event", { channel, event });
    }
  }

  /**
   * Handle synchronization events
   */
  private handleSyncEvent(event: any): void {
    // Update last seen time for this instance
    this.logger.debug("Received sync from instance", {
      fromInstance: event.instanceId,
      timestamp: event.timestamp,
    });
  }

  /**
   * Handle reset events from other instances
   */
  private handleResetEvent(event: any): void {
    this.logger.info("Received reset event from other instance", {
      fromInstance: event.instanceId,
      key: event.key,
      reason: event.reason,
    });

    // Could implement local cache invalidation here
  }

  /**
   * Handle alert events from other instances
   */
  private handleAlertEvent(event: any): void {
    this.logger.warn("Received alert from other instance", {
      fromInstance: event.instanceId,
      alertType: event.alertType,
      message: event.message,
    });
  }

  /**
   * Override checkRateLimit to add distributed coordination
   */
  override async checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<any> {
    const result = await super.checkRateLimit(key, maxRequests, windowMs);

    // Publish rate limit event for other instances to track
    if (!result.allowed) {
      this.publishRateLimitEvent("denied", {
        key,
        maxRequests,
        windowMs,
        remaining: result.remaining,
        retryAfter: result.retryAfter,
      });
    }

    return result;
  }

  /**
   * Override reset to notify other instances
   */
  override async reset(key: string): Promise<void> {
    await super.reset(key);

    // Notify other instances about the reset
    this.publishRateLimitEvent("reset", {
      key,
      reason: "manual_reset",
      timestamp: Date.now(),
    });
  }

  /**
   * Publish rate limit event to other instances
   */
  private async publishRateLimitEvent(
    eventType: string,
    data: any
  ): Promise<void> {
    try {
      const redis = this.redisClient.getRedis();
      const event = {
        instanceId: this.instanceId,
        type: eventType,
        timestamp: Date.now(),
        ...data,
      };

      await redis.publish("rate_limit:events", JSON.stringify(event));
    } catch (error) {
      this.logger.error("Failed to publish rate limit event", error as Error, {
        eventType,
        data,
      });
    }
  }

  /**
   * Get distributed health status
   */
  async getDistributedHealth(): Promise<any> {
    const baseHealth = await this.getHealth();

    return {
      ...baseHealth,
      distributed: {
        enabled: true,
        instanceId: this.instanceId,
        syncInterval: this.syncInterval,
        lastSyncTime: this.lastSyncTime,
        timeSinceLastSync: Date.now() - this.lastSyncTime,
      },
    };
  }

  /**
   * Clean up distributed resources
   */
  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    this.logger.info("Distributed rate limiter destroyed", {
      instanceId: this.instanceId,
    });
  }

  /**
   * Get active instances (for monitoring)
   */
  async getActiveInstances(): Promise<string[]> {
    try {
      const instances: string[] = [];

      // This would require maintaining a registry of active instances
      // For now, return just this instance
      instances.push(this.instanceId);

      return instances;
    } catch (error) {
      this.logger.error("Failed to get active instances", error as Error);
      return [this.instanceId];
    }
  }
}
