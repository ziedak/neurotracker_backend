import { type ILogger } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyStrategy: "ip" | "user" | "apiKey" | "custom";
  customKeyGenerator?: (context: any) => string;
  redis?: {
    enabled: boolean;
    keyPrefix?: string;
  };
  standardHeaders?: boolean;
  message?: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

/**
 * Redis-based rate limiting implementation
 * Uses sliding window approach with atomic operations
 */
export interface RateLimitResult {
  allowed: boolean;
  totalHits: number;
  remaining: number;
  resetTime: Date;
  retryAfter?: number;
}

export class RedisRateLimit {
  constructor(
    private config: RateLimitConfig,
    private redisClient: RedisClient,
    private readonly logger: ILogger
  ) {
    // Ensure logger.child() is type-safe and compatible with the new Logger signature
    this.logger = logger.child({ component: "RedisRateLimit" });
  }

  /**
   * Check rate limit for a key
   */
  async checkLimit(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    if (!this.redisClient) {
      // If Redis is not available, allow all requests
      return {
        allowed: true,
        totalHits: 0,
        remaining: maxRequests,
        resetTime: new Date(Date.now() + windowMs),
      };
    }

    try {
      const now = Date.now();
      const window = Math.floor(now / windowMs);
      const windowKey = `${key}:${window}`;

      // Get current count
      const current = await this.redisClient.safeGet(windowKey);
      const count = current ? parseInt(current, 10) : 0;

      // Calculate reset time
      const resetTime = new Date((window + 1) * windowMs);
      const remaining = Math.max(0, maxRequests - count);
      const allowed = count < maxRequests;

      // Calculate retry after if limit exceeded
      let retryAfter: number = 0;
      if (!allowed) {
        retryAfter = Math.ceil((resetTime.getTime() - now) / 1000);
      }

      return {
        allowed,
        totalHits: count,
        remaining,
        resetTime,
        retryAfter,
      };
    } catch (error) {
      this.logger.error("Rate limit check failed", error as Error, { key });

      // Fail open - allow request if Redis fails
      return {
        allowed: true,
        totalHits: 0,
        remaining: maxRequests,
        resetTime: new Date(Date.now() + windowMs),
      };
    }
  }

  /**
   * Increment rate limit counter
   */
  async increment(key: string, windowMs: number): Promise<number> {
    if (!this.redisClient) {
      return 0;
    }

    try {
      const now = Date.now();
      const window = Math.floor(now / windowMs);
      const windowKey = `${key}:${window}`;

      // Use Redis pipeline for atomic operations
      const pipeline = await this.redisClient.safePipeline();
      pipeline.incr(windowKey);
      pipeline.expire(windowKey, Math.ceil(windowMs / 1000) + 10); // Add buffer to expiration

      const results = await pipeline.exec();

      if (results && results[0] && !results[0][0]) {
        return parseInt(results[0][1] as string, 10); // Return new count
      }

      return 0;
    } catch (error) {
      this.logger.error("Rate limit increment failed", error as Error, { key });
      return 0;
    }
  }

  /**
   * Get current status for a key
   */
  async getStatus(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    return this.checkLimit(key, maxRequests, windowMs);
  }

  /**
   * Reset rate limit for a key
   */
  async reset(key: string): Promise<void> {
    if (!this.redisClient) {
      return;
    }

    try {
      // Delete all windows for this key
      const pattern = `${key}:*`;
      const keys = await this.redisClient.safeKeys(pattern);

      if (keys.length > 0) {
        await this.redisClient.safeDel(...keys);
        this.logger.debug("Rate limit reset", {
          key,
          keysDeleted: keys.length,
        });
      }
    } catch (error) {
      this.logger.error("Rate limit reset failed", error as Error, { key });
      throw error;
    }
  }

  /**
   * Get rate limiting statistics
   */
  async getStats(): Promise<any> {
    if (!this.redisClient) {
      return {
        available: false,
        totalKeys: 0,
        activeWindows: 0,
      };
    }

    try {
      const prefix = this.config.redis?.keyPrefix || "rate_limit";
      const pattern = `${prefix}:*`;
      const keys = await this.redisClient.safeKeys(pattern);

      let activeWindows = 0;
      let totalRequests = 0;

      // Sample some keys to get stats
      const sampleSize = Math.min(keys.length, 100);
      if (sampleSize > 0) {
        const sampleKeys = keys.slice(0, sampleSize);
        const pipeline = await this.redisClient.safePipeline();

        sampleKeys.forEach((key: string) => pipeline.get(key));
        const results = await pipeline.exec();

        (results as [Error | null, unknown][] | undefined)?.forEach(
          (result: [Error | null, unknown]) => {
            if (result && !result[0] && result[1]) {
              const count = parseInt(result[1] as string, 10);
              if (count > 0) {
                activeWindows++;
                totalRequests += count;
              }
            }
          }
        );
      }

      return {
        available: true,
        totalKeys: keys.length,
        activeWindows,
        totalRequests,
        estimatedActiveWindows: Math.round(
          (activeWindows / sampleSize) * keys.length
        ),
        estimatedTotalRequests: Math.round(
          (totalRequests / sampleSize) * keys.length
        ),
      };
    } catch (error) {
      this.logger.error("Failed to get rate limit stats", error as Error);
      return {
        available: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Clean up expired keys (maintenance operation)
   */
  async cleanup(): Promise<number> {
    if (!this.redisClient) {
      return 0;
    }

    try {
      const prefix = this.config.redis?.keyPrefix || "rate_limit";
      const pattern = `${prefix}:*`;
      const keys = await this.redisClient.safeKeys(pattern);

      let deletedKeys = 0;
      const batchSize = 100;

      // Process keys in batches
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        const pipeline = await this.redisClient.safePipeline();

        // Check TTL for each key
        batch.forEach((key: string) => pipeline.ttl(key));
        const ttlResults = await pipeline.exec();

        // Delete keys with no TTL (shouldn't happen) or very short TTL
        const keysToDelete: string[] = [];
        (ttlResults as [Error | null, unknown][] | undefined)?.forEach(
          (result: [Error | null, unknown], index: number) => {
            if (result && !result[0]) {
              const ttl = result[1] as number;
              const key = batch[index];
              if ((ttl === -1 || ttl < 10) && key !== undefined) {
                // No TTL or less than 10 seconds
                keysToDelete.push(key);
              }
            }
          }
        );

        if (keysToDelete.length > 0) {
          await this.redisClient.safeDel(...keysToDelete);
          deletedKeys += keysToDelete.length;
        }
      }

      this.logger.info("Rate limit cleanup completed", {
        totalKeys: keys.length,
        deletedKeys,
      });

      return deletedKeys;
    } catch (error) {
      this.logger.error("Rate limit cleanup failed", error as Error);
      return 0;
    }
  }

  /**
   * Get health status
   */
  async getHealth(): Promise<any> {
    const isAvailable = await this.redisClient.isAvailable();
    const stats = await this.getStats();

    return {
      redis: {
        available: isAvailable,
        config: {
          enabled: this.config.redis?.enabled !== false,
          keyPrefix: this.config.redis?.keyPrefix || "rate_limit",
        },
      },
      stats,
    };
  }
}
