import { RedisClient } from "@libs/database";
import { createLogger } from "@libs/utils";
import { RateLimitResult, RateLimitConfig } from "./types";

/**
 * Configuration for optimized Redis rate limiting
 */
export interface OptimizedRedisRateLimitConfig extends RateLimitConfig {
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
 * Optimized Redis-based rate limiter with circuit breaker pattern
 * Provides high-performance rate limiting with fault tolerance
 */
export class OptimizedRedisRateLimit {
  private readonly logger = createLogger("OptimizedRedisRateLimit");
  private circuitBreakerState: "closed" | "open" | "half-open" = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly config: OptimizedRedisRateLimitConfig,
    private readonly redisClient: RedisClient
  ) {
    // Logger is initialized in the class property
  }

  /**
   * Check rate limit with circuit breaker protection
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
      const redisKey = `${this.config.redis.keyPrefix}${key}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Use Redis sorted set for sliding window
      const redis = this.redisClient.getRedis();

      // Remove expired entries
      await redis.zremrangebyscore(redisKey, 0, windowStart);

      // Count current requests
      const currentCount = await redis.zcard(redisKey);

      if (currentCount >= maxRequests) {
        this.recordFailure();
        return this.createBlockedResult(maxRequests, windowMs);
      }

      // Add current request
      await redis.zadd(redisKey, now, `${now}_${Math.random()}`);
      await redis.expire(
        redisKey,
        Math.ceil((windowMs + this.config.redis.ttlBuffer) / 1000)
      );

      // Get updated count
      const newCount = await redis.zcard(redisKey);

      // Reset circuit breaker on success
      if (this.circuitBreakerState === "half-open") {
        this.circuitBreakerState = "closed";
        this.failureCount = 0;
      }

      return {
        allowed: true,
        totalHits: newCount,
        remaining: Math.max(0, maxRequests - newCount),
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
      this.logger.error("Rate limit check failed", error as Error, { key });
      return this.createBlockedResult(maxRequests, windowMs);
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  async reset(key: string): Promise<void> {
    try {
      const redisKey = `${this.config.redis.keyPrefix}${key}`;
      await this.redisClient.getRedis().del(redisKey);
      this.logger.info("Rate limit reset", { key });
    } catch (error) {
      this.logger.error("Failed to reset rate limit", error as Error, { key });
      throw error;
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return {
      enabled: this.config.circuitBreaker.enabled,
      state: this.circuitBreakerState,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Get health status
   */
  async getHealth(): Promise<{
    redis: any;
    circuitBreaker: any;
    algorithm: string;
  }> {
    const redisHealth = await this.redisClient.getRedis().ping();

    return {
      redis: { status: redisHealth === "PONG" ? "healthy" : "unhealthy" },
      circuitBreaker: this.getCircuitBreakerStatus(),
      algorithm: this.config.algorithm as any,
    };
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
