import { RedisClient } from "@libs/database";
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
 * Rate limiting middleware for data intelligence service
 */
export class RateLimitMiddleware {
  private readonly redis: RedisClient;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(redis: RedisClient, logger: Logger, metrics: MetricsCollector) {
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
        const redisKey = `rate_limit:${key}`;

        // Get current window
        const now = Date.now();
        const window = Math.floor(now / windowMs);
        const windowKey = `${redisKey}:${window}`;

        // Get current count
        const redisClient = RedisClient.getInstance();
        const current = await redisClient.get(windowKey);
        const count = current ? parseInt(current) : 0;

        // Calculate reset time
        const resetTime = new Date((window + 1) * windowMs);
        const remaining = Math.max(0, maxRequests - count - 1);

        // Add standard headers if enabled
        if (standardHeaders) {
          set.headers["X-RateLimit-Limit"] = maxRequests.toString();
          set.headers["X-RateLimit-Remaining"] = remaining.toString();
          set.headers["X-RateLimit-Reset"] = resetTime.toISOString();
          set.headers["X-RateLimit-Window"] = windowMs.toString();
        }

        // Check if limit exceeded
        if (count >= maxRequests) {
          await this.metrics.recordCounter("rate_limit_exceeded");

          set.status = 429;
          set.headers["Retry-After"] = Math.ceil(
            (resetTime.getTime() - now) / 1000
          ).toString();

          this.logger.warn("Rate limit exceeded", {
            key,
            count,
            maxRequests,
            window,
            ip: request.ip || "unknown",
            userAgent: request.headers["user-agent"] || "unknown",
          });

          return {
            error: "Rate limit exceeded",
            message,
            retryAfter: resetTime.toISOString(),
            code: "RATE_LIMIT_EXCEEDED",
          };
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
            const newCount = await redisClient.incr(windowKey);

            // Set expiration for the key (window duration + some buffer)
            if (newCount === 1) {
              await redisClient.expire(
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
            await this.metrics.recordCounter("rate_limit_requests");

            if (newCount > maxRequests * 0.8) {
              await this.metrics.recordCounter("rate_limit_warning");
            }
          }
        }
      } catch (error) {
        this.logger.error("Rate limit middleware error", error as Error, {
          url: request.url,
          method: request.method,
        });

        // On error, allow the request (fail open for availability)
        await next();
      }
    };
  }

  /**
   * Default key generator (uses IP + user ID if available)
   */
  private defaultKeyGenerator(context: any): string {
    const { request } = context;
    const ip = request.ip || "unknown";
    const userId = context.user?.id || "anonymous";
    return `${ip}:${userId}`;
  }

  /**
   * IP-based key generator
   */
  private ipKeyGenerator(context: any): string {
    const { request } = context;
    return request.ip || "unknown";
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
    const { request } = context;
    const apiKey = request.headers["x-api-key"];
    if (!apiKey) {
      return this.ipKeyGenerator(context);
    }
    return `api:${apiKey.substring(0, 10)}`;
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
   * Pre-configured rate limiters
   */

  // General API rate limit (per IP)
  generalLimit(maxRequests: number = 1000, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.ipKeyGenerator.bind(this),
      message: "Too many requests from this IP, please try again later.",
    });
  }

  // User-specific rate limit
  userLimit(maxRequests: number = 500, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message: "Too many requests for this user, please try again later.",
    });
  }

  // API key rate limit
  apiKeyLimit(maxRequests: number = 2000, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.apiKeyGenerator.bind(this),
      message: "API key rate limit exceeded, please try again later.",
    });
  }

  // Strict limits for sensitive endpoints
  strictLimit(maxRequests: number = 10, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message: "Rate limit for sensitive operations exceeded.",
    });
  }

  // Export rate limits (lower limits for resource-intensive operations)
  exportLimit(maxRequests: number = 50, windowMs: number = 300000) {
    // 5 minutes
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message:
        "Export rate limit exceeded. Please wait before requesting more exports.",
    });
  }

  // GDPR operation limits (very strict)
  gdprLimit(maxRequests: number = 5, windowMs: number = 300000) {
    // 5 minutes
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message:
        "GDPR operation rate limit exceeded. Please wait before making more requests.",
    });
  }

  // Analytics rate limits
  analyticsLimit(maxRequests: number = 200, windowMs: number = 60000) {
    return this.rateLimit({
      windowMs,
      maxRequests,
      keyGenerator: this.userKeyGenerator.bind(this),
      message:
        "Analytics rate limit exceeded. Please reduce request frequency.",
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
      const redisClient = RedisClient.getInstance();
      const now = Date.now();
      const window = Math.floor(now / windowMs);
      const windowKey = `rate_limit:${key}:${window}`;

      const current = await redisClient.get(windowKey);
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
      this.logger.error("Failed to get rate limit status", error as Error, {
        key,
      });
      throw error;
    }
  }

  /**
   * Reset rate limit for a key
   */
  async resetRateLimit(key: string): Promise<void> {
    try {
      const redisClient = RedisClient.getInstance();
      const keys = await redisClient.keys(`rate_limit:${key}:*`);

      if (keys.length > 0) {
        await redisClient.del(...keys);
      }

      this.logger.info("Rate limit reset", { key, keysDeleted: keys.length });
    } catch (error) {
      this.logger.error("Failed to reset rate limit", error as Error, { key });
      throw error;
    }
  }
}
