import { RedisClient } from "@libs/database";
import { createLogger } from "@libs/utils";
import type { RateLimitResult } from "../types";

/**
 * Performance optimized rate limiter
 * Provides high-throughput rate limiting with local caching
 */
export class PerformanceOptimizedRateLimit {
  private readonly logger = createLogger("PerformanceOptimizedRateLimit");
  private localCache = new Map<string, { count: number; resetTime: number }>();

  constructor(
    private readonly redisClient: RedisClient,
    private readonly config: {
      algorithm: string;
      maxRequests: number;
      windowMs: number;
      localCacheSize: number;
    }
  ) {}

  /**
   * Check rate limit with local cache optimization
   */
  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const cacheKey = `${key}:${Math.floor(now / windowMs)}`;

    // Check local cache first
    const cached = this.localCache.get(cacheKey);
    if (cached && cached.resetTime > now) {
      if (cached.count >= maxRequests) {
        return {
          allowed: false,
          totalHits: cached.count,
          remaining: 0,
          resetTime: cached.resetTime,
          windowStart: now - windowMs,
          windowEnd: cached.resetTime,
          limit: maxRequests,
          retryAfter: Math.ceil((cached.resetTime - now) / 1000),
          algorithm: this.config.algorithm as any,
          cached: true,
          responseTime: 0,
        };
      }
    }

    // Fallback to Redis
    try {
      const redis = this.redisClient.getRedis();
      const redisKey = `rate_limit:${key}`;

      // Remove expired entries
      await redis.zremrangebyscore(redisKey, 0, now - windowMs);

      // Count current requests
      const currentCount = await redis.zcard(redisKey);

      if (currentCount >= maxRequests) {
        // Update local cache
        this.localCache.set(cacheKey, {
          count: currentCount,
          resetTime: now + windowMs,
        });

        return {
          allowed: false,
          totalHits: currentCount,
          remaining: 0,
          resetTime: now + windowMs,
          windowStart: now - windowMs,
          windowEnd: now + windowMs,
          limit: maxRequests,
          retryAfter: Math.ceil(windowMs / 1000),
          algorithm: this.config.algorithm as any,
          cached: false,
          responseTime: Date.now() - now,
        };
      }

      // Add current request
      await redis.zadd(redisKey, now, `${now}_${Math.random()}`);
      await redis.expire(redisKey, Math.ceil(windowMs / 1000));

      const newCount = await redis.zcard(redisKey);

      // Update local cache
      this.localCache.set(cacheKey, {
        count: newCount,
        resetTime: now + windowMs,
      });

      // Clean up old cache entries
      if (this.localCache.size > this.config.localCacheSize) {
        const oldestKey = this.localCache.keys().next().value;
        if (oldestKey) {
          this.localCache.delete(oldestKey);
        }
      }

      return {
        allowed: true,
        totalHits: newCount,
        remaining: Math.max(0, maxRequests - newCount),
        resetTime: now + windowMs,
        windowStart: now - windowMs,
        windowEnd: now + windowMs,
        limit: maxRequests,
        retryAfter: 0,
        algorithm: this.config.algorithm as any,
        cached: false,
        responseTime: Date.now() - now,
      };
    } catch (error) {
      this.logger.error(
        "Performance optimized rate limit check failed",
        error as Error,
        { key }
      );
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

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    try {
      const redisKey = `rate_limit:${key}`;
      await this.redisClient.getRedis().del(redisKey);

      // Clear local cache for this key
      for (const [cacheKey] of this.localCache) {
        if (cacheKey.startsWith(`${key}:`)) {
          this.localCache.delete(cacheKey);
        }
      }

      this.logger.info("Performance optimized rate limit reset", { key });
    } catch (error) {
      this.logger.error(
        "Failed to reset performance optimized rate limit",
        error as Error,
        { key }
      );
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.localCache.size,
      maxSize: this.config.localCacheSize,
      utilization: (this.localCache.size / this.config.localCacheSize) * 100,
    };
  }
}
