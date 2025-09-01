import { BaseMiddleware } from "../base";
import { MiddlewareContext } from "../types";
import { type ILogger, type IMetricsCollector } from "@libs/monitoring";
import {
  RedisRateLimit,
  IpStrategy,
  UserStrategy,
  ApiKeyStrategy,
  RateLimitConfig,
  RateLimitResult,
} from "@libs/ratelimit";
import { inject } from "@libs/utils";
import type { RedisClient } from "@libs/database";

/**
 * Rate limit result interface
 */

/**
 * Rate limiting strategy interface
 */
export interface RateLimitStrategy {
  generateKey(context: MiddlewareContext): string;
}

/**
 * Main rate limiting middleware
 * Supports Redis-based rate limiting with multiple key strategies
 */
export class RateLimitMiddleware extends BaseMiddleware<RateLimitConfig> {
  private readonly redisRateLimit: RedisRateLimit;
  private readonly strategies: Map<string, RateLimitStrategy>;
  private readonly redisClient: RedisClient;

  constructor(
    @inject("ILogger") logger: ILogger,
    @inject("IMetricsCollector") metrics: IMetricsCollector,
    @inject("RedisClient") redisClient: RedisClient,
    config: RateLimitConfig
  ) {
    super(logger, metrics, config, "rateLimit");

    this.redisClient = redisClient;
    this.redisRateLimit = new RedisRateLimit(config, redisClient, logger);
    this.strategies = new Map<string, RateLimitStrategy>();
    this.strategies.set("ip", new IpStrategy());
    this.strategies.set("user", new UserStrategy());
    this.strategies.set("apiKey", new ApiKeyStrategy());

    // Add custom strategy if provided
    if (config.keyStrategy === "custom" && config.customKeyGenerator) {
      this.strategies.set("custom", {
        generateKey: config.customKeyGenerator,
      });
    }
  }

  protected override async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = performance.now();
    const requestId = this.getRequestId(context);

    try {
      // Generate rate limit key
      const key = this.generateKey(context);

      // Check rate limit
      const result = await this.checkRateLimit(key);

      // Add standard headers if enabled
      if (this.config.standardHeaders) {
        this.setRateLimitHeaders(context, result);
      }

      // Check if limit exceeded
      if (!result.allowed) {
        context.set.status = 429;
        if (result.retryAfter) {
          context.set.headers["Retry-After"] = result.retryAfter.toString();
        }

        await this.recordMetric("rate_limit_exceeded");
        this.logger.warn("Rate limit exceeded", {
          key,
          totalHits: result.totalHits,
          maxRequests: this.config.maxRequests,
          clientIp: this.getClientIp(context),
          userAgent: context.request.headers["user-agent"],
          requestId,
        });

        // Set error response in context - the framework will handle the response
        context.set.status = 429;
        (context as any).error = {
          error: "Rate limit exceeded",
          message:
            this.config.message || "Too many requests, please try again later.",
          retryAfter: result.resetTime.toISOString(),
          code: "RATE_LIMIT_EXCEEDED",
          maxRequests: this.config.maxRequests,
          remaining: result.remaining,
          requestId,
        };
        return;
      }

      // Execute request
      let requestSuccessful = true;
      let statusCode = 200;

      try {
        await next();
        statusCode = context.set?.status || 200;
      } catch (error) {
        requestSuccessful = false;
        statusCode = context.set?.status || 500;
        throw error;
      } finally {
        // Update count based on success/failure rules
        await this.updateRateLimit(key, requestSuccessful, statusCode);

        // Update headers with final count
        if (this.config.standardHeaders) {
          const updatedResult = await this.getRateLimitStatus(key);
          this.setRateLimitHeaders(context, updatedResult);
        }

        await this.recordMetric("rate_limit_allowed");
      }
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.recordTimer("rate_limit_error_duration", duration);

      this.logger.error("Rate limit middleware error", error as Error, {
        requestId,
        duration: Math.round(duration),
      });

      // Fail open - allow request on error
      await next();
    } finally {
      await this.recordTimer(
        "rate_limit_duration",
        performance.now() - startTime
      );
    }
  }

  /**
   * Create new instance of this middleware with different config
   */
  protected override createInstance(
    config: RateLimitConfig
  ): RateLimitMiddleware {
    return new RateLimitMiddleware(
      this.logger,
      this.metrics,
      this.redisClient,
      config
    );
  }

  /**
   * Generate rate limit key using configured strategy
   */
  private generateKey(context: MiddlewareContext): string {
    const strategy = this.strategies.get(this.config.keyStrategy);
    if (!strategy) {
      this.logger.warn("Unknown rate limit strategy, falling back to IP", {
        strategy: this.config.keyStrategy,
      });
      return this.strategies.get("ip")!.generateKey(context);
    }

    const baseKey = strategy.generateKey(context);
    const prefix = this.config.redis?.keyPrefix || "rate_limit";
    return `${prefix}:${baseKey}`;
  }

  /**
   * Check current rate limit status
   */
  private async checkRateLimit(key: string): Promise<RateLimitResult> {
    return this.redisRateLimit.checkLimit(
      key,
      this.config.maxRequests,
      this.config.windowMs
    );
  }

  /**
   * Update rate limit count
   */
  private async updateRateLimit(
    key: string,
    successful: boolean,
    statusCode: number
  ): Promise<void> {
    // Determine if we should count this request
    const shouldCount = this.shouldCountRequest(successful, statusCode);

    if (shouldCount) {
      await this.redisRateLimit.increment(key, this.config.windowMs);

      // Record metrics
      await this.recordMetric("rate_limit_requests");

      // Warning if approaching limit
      const status = await this.getRateLimitStatus(key);
      if (status.remaining < this.config.maxRequests * 0.2) {
        await this.recordMetric("rate_limit_warning");
      }
    }
  }

  /**
   * Get current rate limit status
   */
  private async getRateLimitStatus(key: string): Promise<RateLimitResult> {
    return this.redisRateLimit.getStatus(
      key,
      this.config.maxRequests,
      this.config.windowMs
    );
  }

  /**
   * Set standard rate limit headers
   */
  private setRateLimitHeaders(
    context: MiddlewareContext,
    result: RateLimitResult
  ): void {
    context.set.headers["X-RateLimit-Limit"] =
      this.config.maxRequests.toString();
    context.set.headers["X-RateLimit-Remaining"] = Math.max(
      0,
      result.remaining
    ).toString();
    context.set.headers["X-RateLimit-Reset"] = result.resetTime.toISOString();
    context.set.headers["X-RateLimit-Window"] = this.config.windowMs.toString();
  }

  /**
   * Determine if request should be counted towards rate limit
   */
  private shouldCountRequest(successful: boolean, statusCode: number): boolean {
    if (this.config.skipSuccessfulRequests && successful && statusCode < 400) {
      return false;
    }

    if (this.config.skipFailedRequests && (!successful || statusCode >= 400)) {
      return false;
    }

    return true;
  }

  /**
   * Reset rate limit for a key
   */
  public async resetRateLimit(key: string): Promise<void> {
    const fullKey = this.generateKeyFromBase(key);
    await this.redisRateLimit.reset(fullKey);

    this.logger.info("Rate limit reset", { key: fullKey });
  }

  /**
   * Get rate limit statistics
   */
  public async getRateLimitStats(): Promise<any> {
    return this.redisRateLimit.getStats();
  }

  /**
   * Generate full key from base key
   */
  private generateKeyFromBase(baseKey: string): string {
    const prefix = this.config.redis?.keyPrefix || "rate_limit";
    return `${prefix}:${baseKey}`;
  }

  /**
   * Factory method for common rate limit configurations
   * NOTE: DI-friendly version. Use DI container to inject dependencies.
   */
  public static create(
    type:
      | "general"
      | "strict"
      | "api"
      | "burst"
      | "ai-prediction"
      | "data-export",
    logger: ILogger,
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    rateLimitConfig?: Partial<RateLimitConfig>
  ): RateLimitMiddleware {
    const configs = {
      general: {
        windowMs: 60000, // 1 minute
        maxRequests: 1000,
        keyStrategy: "ip" as const,
        message: "Too many requests from this IP, please try again later.",
      },
      strict: {
        windowMs: 60000, // 1 minute
        maxRequests: 100,
        keyStrategy: "user" as const,
        message: "Rate limit exceeded, please reduce request frequency.",
      },
      api: {
        windowMs: 60000, // 1 minute
        maxRequests: 5000,
        keyStrategy: "apiKey" as const,
        message: "API key rate limit exceeded, please contact support.",
      },
      burst: {
        windowMs: 10000, // 10 seconds
        maxRequests: 100,
        keyStrategy: "user" as const,
        message: "Burst rate limit exceeded, please pace your requests.",
      },
      "ai-prediction": {
        windowMs: 60000, // 1 minute
        maxRequests: 1000,
        keyStrategy: "user" as const,
        message: "Prediction rate limit exceeded, please reduce frequency.",
        skipFailedRequests: true, // Don't count failed predictions
      },
      "data-export": {
        windowMs: 300000, // 5 minutes
        maxRequests: 50,
        keyStrategy: "user" as const,
        message:
          "Export rate limit exceeded, please wait before requesting more.",
      },
    };

    const config = {
      ...configs[type],
      standardHeaders: true,
      ...rateLimitConfig,
    };

    return new RateLimitMiddleware(logger, metrics, redisClient, config);
  }
}
