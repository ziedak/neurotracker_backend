import Redis from "ioredis";
import { Logger, MetricsCollector } from "@libs/monitoring";

export interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyGenerator?: (context: any) => string; // Custom key generation
  skipSuccessfulRequests?: boolean; // Only count failed requests
  skipFailedRequests?: boolean; // Only count successful requests
  message?: string; // Custom error message
  standardHeaders?: boolean; // Return rate limit info in headers
}

export interface RateLimitResult {
  totalHits: number;
  totalWins: number;
  resetTime: Date;
  remaining: number;
}

/**
 * Rate limiting middleware for AI Engine Service
 * Optimized for high-throughput ML prediction workloads
 */
export class RateLimitMiddleware {
  /**
   * Extract client IP from context/request headers
   */
  private static extractClientIp(context: any): string {
    const req = context.request;
    return (
      req?.headers["x-forwarded-for"] ||
      req?.headers["x-real-ip"] ||
      context.ip ||
      "unknown"
    );
  }

  /**
   * Set standard rate limit headers
   */
  private static setRateLimitHeaders(
    set: any,
    maxRequests: number,
    remaining: number,
    resetTime: Date,
    windowMs: number
  ): void {
    set.headers["X-RateLimit-Limit"] = maxRequests.toString();
    set.headers["X-RateLimit-Remaining"] = remaining.toString();
    set.headers["X-RateLimit-Reset"] = resetTime.toISOString();
    set.headers["X-RateLimit-Window"] = windowMs.toString();
  }

  /**
   * Standardize error response for rate limit exceeded
   */
  private static rateLimitErrorResponse(
    set: any,
    message: string,
    resetTime: Date,
    maxRequests: number,
    remaining: number
  ): any {
    set.status = 429;
    set.headers["Retry-After"] = Math.ceil(
      (resetTime.getTime() - Date.now()) / 1000
    ).toString();
    return {
      error: "Rate limit exceeded",
      message,
      retryAfter: resetTime.toISOString(),
      code: "RATE_LIMIT_EXCEEDED",
      type: "ai_engine_rate_limit",
      maxRequests,
      remaining,
    };
  }
  private readonly redis: Redis;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(redis: Redis, logger: Logger, metrics: MetricsCollector) {
    this.redis = redis;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Create rate limiting middleware
   */
  rateLimit(options: RateLimitOptions) {
    const {
      windowMs,
      maxRequests,
      keyGenerator = this.defaultKeyGenerator,
      skipSuccessfulRequests = false,
      skipFailedRequests = false,
      message = "Too many requests, please try again later.",
      standardHeaders = true,
    } = options;

    return async (context: any, next: () => Promise<void>) => {
      const { request, set } = context;
      try {
        // Generate rate limit key
        const key = keyGenerator(context);
        const redisKey = `ai_rate_limit:${key}`;
        // Get current window
        const now = Date.now();
        const window = Math.floor(now / windowMs);
        const windowKey = `${redisKey}:${window}`;
        // Get current count
        const current = await this.redis.get(windowKey);
        const count = current ? parseInt(current) : 0;
        // Calculate reset time
        const resetTime = new Date((window + 1) * windowMs);
        const remaining = Math.max(0, maxRequests - count - 1);
        // Add standard headers if enabled
        if (standardHeaders) {
          RateLimitMiddleware.setRateLimitHeaders(
            set,
            maxRequests,
            remaining,
            resetTime,
            windowMs
          );
        }
        // Check if limit exceeded
        if (count >= maxRequests) {
          await this.metrics.recordCounter("ai_rate_limit_exceeded");
          this.logger.warn("AI Engine rate limit exceeded", {
            key,
            count,
            maxRequests,
            window,
            ip: RateLimitMiddleware.extractClientIp(context),
            userAgent: request.headers["user-agent"] || "unknown",
            endpoint: request.url,
          });
          return RateLimitMiddleware.rateLimitErrorResponse(
            set,
            message,
            resetTime,
            maxRequests,
            remaining
          );
        }
        // Execute the request
        let requestSuccessful = true;
        let statusCode = 200;
        try {
          await next();
          statusCode = set.status || 200;
        } catch (error) {
          requestSuccessful = false;
          statusCode = set.status || 500;
          throw error;
        } finally {
          // Determine if we should count this request
          const shouldCount = this.shouldCountRequest(
            requestSuccessful,
            statusCode,
            skipSuccessfulRequests,
            skipFailedRequests
          );
          if (shouldCount) {
            // Increment counter
            const newCount = await this.redis.incr(windowKey);
            // Set expiration for the key (window duration + some buffer)
            if (newCount === 1) {
              await this.redis.expire(
                windowKey,
                Math.ceil(windowMs / 1000) + 10
              );
            }
            // Update headers with actual count
            if (standardHeaders) {
              set.headers["X-RateLimit-Remaining"] = Math.max(
                0,
                maxRequests - newCount
              ).toString();
            }
            // Record metrics
            await this.metrics.recordCounter("ai_rate_limit_requests");
            if (newCount > maxRequests * 0.8) {
              await this.metrics.recordCounter("ai_rate_limit_warning");
            }
          }
        }
      } catch (error) {
        this.logger.error(
          "AI Engine rate limit middleware error",
          error as Error,
          {
            url: request?.url,
            method: request?.method,
          }
        );
        // On error, allow the request (fail open for availability)
        await next();
      }
    };
  }

  /**
   * Default key generator (uses IP + user ID if available)
   */
  private defaultKeyGenerator(context: any): string {
    const ip = RateLimitMiddleware.extractClientIp(context);
    const userId = context.user?.id || "anonymous";
    return `${ip}:${userId}`;
  }

  /**
   * IP-based key generator
   */
  private ipKeyGenerator(context: any): string {
    return RateLimitMiddleware.extractClientIp(context);
  }

  /**
   * User-based key generator
   */
  private userKeyGenerator(context: any): string {
    const userId = context.user?.id;
    if (!userId) {
      return this.ipKeyGenerator(context);
    }
    return `user:${userId}`;
  }

  /**
   * API key-based generator
   */
  private apiKeyGenerator(context: any): string {
    const apiKey = context.request?.headers["x-api-key"];
    if (!apiKey) {
      return RateLimitMiddleware.extractClientIp(context);
    }
    return `api:${apiKey.substring(0, 10)}`;
  }

  /**
   * Model-specific key generator for prediction endpoints
   */
  private modelKeyGenerator(context: any): string {
    const { request } = context;
    const modelVersion = request.body?.modelVersion || "default";
    const userId = context.user?.id || "anonymous";
    return `model:${modelVersion}:${userId}`;
  }

  /**
   * Determine if request should be counted
   */
  private shouldCountRequest(
    successful: boolean,
    statusCode: number,
    skipSuccessful: boolean,
    skipFailed: boolean
  ): boolean {
    if (skipSuccessful && successful && statusCode < 400) {
      return false;
    }

    if (skipFailed && (!successful || statusCode >= 400)) {
      return false;
    }

    return true;
  }

  /**
   * Pre-configured rate limiters for AI Engine endpoints
   */

  // General prediction rate limit (per user)
  predictionLimit(maxRequests: number = 1000, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message:
        "Prediction rate limit exceeded. Please reduce request frequency.",
    });
  }

  // Batch prediction rate limit (stricter)
  batchPredictionLimit(maxRequests: number = 50, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message:
        "Batch prediction rate limit exceeded. Please wait before submitting more batches.",
    });
  }

  // Feature computation rate limit
  featureLimit(maxRequests: number = 500, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message: "Feature computation rate limit exceeded.",
    });
  }

  // Model management rate limit (very strict)
  modelManagementLimit(maxRequests: number = 10, windowMs: number = 300000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message:
        "Model management rate limit exceeded. Please wait before making changes.",
    });
  }

  // API key rate limit for external integrations
  apiKeyLimit(maxRequests: number = 5000, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.apiKeyGenerator.bind(this),
      message:
        "API key rate limit exceeded. Please contact support to increase limits.",
    });
  }

  // Burst limit for high-frequency trading scenarios
  burstLimit(maxRequests: number = 100, windowMs: number = 10000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message: "Burst rate limit exceeded. Please pace your requests.",
    });
  }

  // Health check limit (lenient)
  healthCheckLimit(maxRequests: number = 60, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.ipKeyGenerator.bind(this),
      message: "Health check rate limit exceeded.",
    });
  }

  // Model-specific limits (prevents model overload)
  modelSpecificLimit(maxRequests: number = 200, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.modelKeyGenerator.bind(this),
      message:
        "Model-specific rate limit exceeded. Try using a different model version.",
    });
  }

  /**
   * Get rate limit status for a key
   */
  async getRateLimitStatus(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    try {
      const now = Date.now();
      const window = Math.floor(now / windowMs);
      const windowKey = `ai_rate_limit:${key}:${window}`;

      const current = await this.redis.get(windowKey);
      const count = current ? parseInt(current) : 0;

      const resetTime = new Date((window + 1) * windowMs);
      const remaining = Math.max(0, maxRequests - count);

      return {
        totalHits: count,
        totalWins: 1,
        resetTime,
        remaining,
      };
    } catch (error) {
      this.logger.error(
        "Failed to get AI Engine rate limit status",
        error as Error,
        {
          key,
        }
      );
      throw error;
    }
  }

  /**
   * Reset rate limit for a key
   */
  async resetRateLimit(key: string): Promise<void> {
    try {
      const keys = await this.redis.keys(`ai_rate_limit:${key}:*`);

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      this.logger.info("AI Engine rate limit reset", {
        key,
        keysDeleted: keys.length,
      });
    } catch (error) {
      this.logger.error(
        "Failed to reset AI Engine rate limit",
        error as Error,
        { key }
      );
      throw error;
    }
  }

  /**
   * Get rate limit statistics
   */
  async getRateLimitStats(): Promise<any> {
    try {
      const keys = await this.redis.keys("ai_rate_limit:*");
      const pipeline = this.redis.pipeline();

      keys.forEach((key) => pipeline.get(key));
      const results = await pipeline.exec();

      const stats = {
        totalKeys: keys.length,
        totalRequests: 0,
        activeWindows: 0,
      };

      results?.forEach((result) => {
        if (result && result[1]) {
          const count = parseInt(result[1] as string);
          stats.totalRequests += count;
          stats.activeWindows++;
        }
      });

      return stats;
    } catch (error) {
      this.logger.error("Failed to get rate limit stats", error as Error);
      return { totalKeys: 0, totalRequests: 0, activeWindows: 0 };
    }
  }

  // Add the missing checkRateLimit method
  async checkRateLimit(context: any): Promise<void> {
    const options: RateLimitOptions = {
      windowMs: 60000, // 1 minute
      maxRequests: 100, // 100 requests per minute
    };

    // Generate rate limit key
    const ip = RateLimitMiddleware.extractClientIp(context);
    const key = `ai_rate_limit:${ip}`;

    // Check current count
    const now = Date.now();
    const window = Math.floor(now / options.windowMs);
    const windowKey = `${key}:${window}`;

    try {
      const count = await this.redis.incr(windowKey);

      if (count === 1) {
        await this.redis.expire(windowKey, Math.ceil(options.windowMs / 1000));
      }

      if (count > options.maxRequests) {
        const resetTime = (window + 1) * options.windowMs;
        const error = new Error(options.message || "Rate limit exceeded");
        (error as any).statusCode = 429;
        (error as any).headers = {
          "X-RateLimit-Limit": options.maxRequests,
          "X-RateLimit-Remaining": Math.max(0, options.maxRequests - count),
          "X-RateLimit-Reset": new Date(resetTime).toISOString(),
        };
        throw error;
      }
    } catch (error) {
      // If Redis fails, allow the request but log the error
      this.logger.error("Rate limit check failed", error as Error);
    }
  }
}
