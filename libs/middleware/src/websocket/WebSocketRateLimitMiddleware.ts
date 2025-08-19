import {
  WebSocketContext,
  WebSocketMiddlewareFunction,
  WebSocketRateLimitConfig,
} from "../types";
import { BaseWebSocketMiddleware } from "./BaseWebSocketMiddleware";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
import type Redis from "ioredis";

/**
 * Production-grade WebSocket Rate Limiting Middleware
 * Implements connection-based and message-based rate limiting with Redis backend
 */
export class WebSocketRateLimitMiddleware extends BaseWebSocketMiddleware<WebSocketRateLimitConfig> {
  private readonly redis: Redis;
  private readonly connectionCounts: Map<string, number> = new Map();

  constructor(
    config: WebSocketRateLimitConfig,
    logger: Logger,
    metrics?: MetricsCollector
  ) {
    super("ws-rate-limit", config, logger, metrics);
    this.redis = RedisClient.getInstance();
  }

  /**
   * Execute rate limiting checks for WebSocket connections and messages
   */
  async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // Generate rate limiting key
      const rateLimitKey = this.generateRateLimitKey(context);

      // Check connection limits first
      if (this.config.maxConnections) {
        await this.checkConnectionLimit(context, rateLimitKey);
      }

      // Check message rate limits
      if (this.config.maxMessagesPerMinute || this.config.maxMessagesPerHour) {
        await this.checkMessageRateLimit(context, rateLimitKey);
      }

      // Update connection tracking
      await this.updateConnectionTracking(context, rateLimitKey);

      // Proceed to next middleware
      await next();
      await this.recordMetric("ws_rate_limit_allowed");
    } catch (error) {
      this.logger.warn("WebSocket rate limit exceeded", {
        connectionId: context.connectionId,
        userId: context.userId,
        messageType: context.message.type,
        error: (error as Error).message,
      });

      await this.recordMetric("ws_rate_limit_exceeded");
      await this.handleRateLimitExceeded(context, error as Error);
    } finally {
      const duration = performance.now() - startTime;
      await this.recordTimer("ws_rate_limit_duration", duration);
    }
  }

  /**
   * Generate rate limiting key based on configured strategy
   */
  private generateRateLimitKey(context: WebSocketContext): string {
    if (this.config.keyGenerator) {
      return this.config.keyGenerator(context);
    }

    // Default key generation strategy
    if (context.authenticated && context.userId) {
      return `ws_user:${context.userId}`;
    }

    // Fall back to IP-based limiting for unauthenticated connections
    return `ws_ip:${context.metadata.clientIp}`;
  }

  /**
   * Check connection limits
   */
  private async checkConnectionLimit(
    context: WebSocketContext,
    rateLimitKey: string
  ): Promise<void> {
    const maxConnections = this.config.maxConnections!;
    const connectionKey = `${rateLimitKey}:connections`;

    try {
      // Get current connection count
      const currentConnections = await this.redis.get(connectionKey);
      const connectionCount = currentConnections
        ? parseInt(currentConnections, 10)
        : 0;

      if (connectionCount >= maxConnections) {
        throw new Error(
          `Connection limit exceeded: ${connectionCount}/${maxConnections}`
        );
      }

      // Track this connection
      await this.redis.setex(
        connectionKey,
        3600,
        (connectionCount + 1).toString()
      );
      this.connectionCounts.set(context.connectionId, connectionCount + 1);

      this.logger.debug("Connection limit check passed", {
        connectionId: context.connectionId,
        currentConnections: connectionCount + 1,
        maxConnections,
        key: connectionKey,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Connection limit")
      ) {
        throw error;
      }

      this.logger.error("Error checking connection limit", error as Error, {
        connectionId: context.connectionId,
        key: connectionKey,
      });

      // Allow connection on Redis errors to avoid blocking legitimate traffic
    }
  }

  /**
   * Check message rate limits using sliding window
   */
  private async checkMessageRateLimit(
    context: WebSocketContext,
    rateLimitKey: string
  ): Promise<void> {
    const now = Date.now();

    // Check minute-based rate limit
    if (this.config.maxMessagesPerMinute) {
      await this.checkSlidingWindowRateLimit(
        context,
        rateLimitKey,
        this.config.maxMessagesPerMinute,
        60000, // 1 minute in ms
        "minute"
      );
    }

    // Check hour-based rate limit
    if (this.config.maxMessagesPerHour) {
      await this.checkSlidingWindowRateLimit(
        context,
        rateLimitKey,
        this.config.maxMessagesPerHour,
        3600000, // 1 hour in ms
        "hour"
      );
    }
  }

  /**
   * Implement sliding window rate limiting algorithm
   */
  private async checkSlidingWindowRateLimit(
    context: WebSocketContext,
    rateLimitKey: string,
    maxMessages: number,
    windowMs: number,
    windowName: string
  ): Promise<void> {
    const now = Date.now();
    const windowKey = `${rateLimitKey}:${windowName}:${Math.floor(
      now / windowMs
    )}`;
    const previousWindowKey = `${rateLimitKey}:${windowName}:${Math.floor(
      (now - windowMs) / windowMs
    )}`;

    try {
      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();

      // Get current and previous window counts
      pipeline.get(windowKey);
      pipeline.get(previousWindowKey);

      const results = await pipeline.exec();

      if (!results) {
        throw new Error("Redis pipeline execution failed");
      }

      const [currentWindowResult, previousWindowResult] = results;
      const currentCount = currentWindowResult[1]
        ? parseInt(currentWindowResult[1] as string, 10)
        : 0;
      const previousCount = previousWindowResult[1]
        ? parseInt(previousWindowResult[1] as string, 10)
        : 0;

      // Calculate sliding window count
      const timeIntoCurrentWindow = now % windowMs;
      const weightedPreviousCount =
        previousCount * (1 - timeIntoCurrentWindow / windowMs);
      const totalCount = Math.floor(currentCount + weightedPreviousCount);

      if (totalCount >= maxMessages) {
        throw new Error(
          `Rate limit exceeded for ${windowName}: ${totalCount}/${maxMessages} messages`
        );
      }

      // Increment current window counter
      const incrementPipeline = this.redis.pipeline();
      incrementPipeline.incr(windowKey);
      incrementPipeline.expire(windowKey, Math.ceil(windowMs / 1000) * 2); // Expire after 2 windows
      await incrementPipeline.exec();

      this.logger.debug(`Rate limit check passed for ${windowName}`, {
        connectionId: context.connectionId,
        currentCount: currentCount + 1,
        totalCount: totalCount + 1,
        maxMessages,
        windowKey,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Rate limit exceeded")
      ) {
        throw error;
      }

      this.logger.error(
        `Error checking ${windowName} rate limit`,
        error as Error,
        {
          connectionId: context.connectionId,
          windowKey,
        }
      );

      // Allow message on Redis errors to avoid blocking legitimate traffic
    }
  }

  /**
   * Update connection tracking and metadata
   */
  private async updateConnectionTracking(
    context: WebSocketContext,
    rateLimitKey: string
  ): Promise<void> {
    try {
      const trackingKey = `${rateLimitKey}:tracking`;
      const trackingData = {
        lastMessageAt: new Date().toISOString(),
        messageCount: context.metadata.messageCount,
        connectionId: context.connectionId,
        messageType: context.message.type,
      };

      await this.redis.setex(trackingKey, 3600, JSON.stringify(trackingData));
    } catch (error) {
      this.logger.warn("Failed to update connection tracking", {
        connectionId: context.connectionId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Handle rate limit exceeded scenarios
   */
  private async handleRateLimitExceeded(
    context: WebSocketContext,
    error: Error
  ): Promise<void> {
    const errorMessage = error.message;

    // Call custom handler if provided
    if (this.config.onLimitExceeded) {
      this.config.onLimitExceeded(context, errorMessage);
    }

    // Send rate limit error response
    this.sendResponse(context, {
      type: "rate_limit_error",
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: errorMessage,
        timestamp: new Date().toISOString(),
        retryAfter: this.getRetryAfterSeconds(errorMessage),
      },
      connectionId: context.connectionId,
    });

    // Log rate limit violation
    this.logger.warn("WebSocket rate limit exceeded", {
      connectionId: context.connectionId,
      userId: context.userId,
      clientIp: context.metadata.clientIp,
      messageType: context.message.type,
      error: errorMessage,
    });

    // Don't close the connection for rate limits, just drop the message
    // This allows clients to recover without reconnecting
  }

  /**
   * Extract retry-after time from error message
   */
  private getRetryAfterSeconds(errorMessage: string): number {
    if (errorMessage.includes("minute")) {
      return 60;
    }
    if (errorMessage.includes("hour")) {
      return 3600;
    }
    if (errorMessage.includes("Connection limit")) {
      return 300; // 5 minutes for connection limits
    }
    return 30; // Default retry after 30 seconds
  }

  /**
   * Cleanup connection tracking when connection closes
   */
  async cleanupConnection(
    connectionId: string,
    userId?: string,
    clientIp?: string
  ): Promise<void> {
    try {
      const rateLimitKey = userId ? `ws_user:${userId}` : `ws_ip:${clientIp}`;
      const connectionKey = `${rateLimitKey}:connections`;

      // Decrement connection count
      const currentCount = this.connectionCounts.get(connectionId);
      if (currentCount) {
        const newCount = Math.max(0, currentCount - 1);
        if (newCount === 0) {
          await this.redis.del(connectionKey);
        } else {
          await this.redis.setex(connectionKey, 3600, newCount.toString());
        }

        this.connectionCounts.delete(connectionId);
      }

      this.logger.debug("Connection cleanup completed", {
        connectionId,
        userId,
        rateLimitKey,
      });
    } catch (error) {
      this.logger.error(
        "Failed to cleanup connection tracking",
        error as Error,
        {
          connectionId,
          userId,
        }
      );
    }
  }

  /**
   * Create factory function for easy instantiation
   */
  static create(
    config: WebSocketRateLimitConfig,
    logger: Logger,
    metrics?: MetricsCollector
  ): WebSocketMiddlewareFunction {
    const middleware = new WebSocketRateLimitMiddleware(
      config,
      logger,
      metrics
    );
    return middleware.middleware();
  }
}
