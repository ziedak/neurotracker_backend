/**
 * Elysia WebSocket Rate Limiting Middleware
 * Production-grade rate limiting for Elysia's built-in WebSocket support
 */

import { type ILogger, type IMetricsCollector } from "@libs/monitoring";
import { type Redis, type RedisClient } from "@libs/database";
import { inject, injectable } from "@libs/utils";

/**
 * WebSocket context interface for Elysia WebSocket handlers
 */
export interface ElysiaWebSocketContext {
  ws: any; // Elysia WebSocket instance
  connectionId: string;
  message: any;
  metadata: {
    connectedAt: Date;
    lastActivity: Date;
    messageCount: number;
    clientIp: string;
    userAgent?: string | undefined;
    headers: Record<string, string>;
    query: Record<string, string>;
  };
  authenticated: boolean;
  userId?: string | undefined;
  userRoles?: string[] | undefined;
  rooms?: string[] | undefined;
  [key: string]: any;
}

/**
 * WebSocket rate limiting configuration for Elysia
 */
export interface ElysiaWebSocketRateLimitConfig {
  name: string;
  enabled?: boolean;

  // Connection limits
  maxConnections?: number;

  // Message rate limits
  maxMessagesPerMinute?: number;
  maxMessagesPerHour?: number;

  // Advanced configuration
  keyGenerator?: (context: ElysiaWebSocketContext) => string;
  skipMessageTypes?: string[];
  onLimitExceeded?: (context: ElysiaWebSocketContext, limit: string) => void;

  // Redis configuration
  redis?: {
    keyPrefix?: string;
  };
}

/**
 * Elysia WebSocket Rate Limiting Service
 * Provides rate limiting functionality for Elysia WebSocket handlers
 */
@injectable()
export class ElysiaWebSocketRateLimiter {
  private readonly redis: Redis;
  private readonly connectionCounts: Map<string, number> = new Map();

  constructor(
    @inject("ILogger") private logger: ILogger,
    @inject("IMetricsCollector") private metrics: IMetricsCollector,
    @inject("RedisClient") redisClient: RedisClient
  ) {
    this.redis = redisClient.getRedis();
  }

  /**
   * Create rate limiting middleware function for Elysia WebSocket
   */
  createMiddleware(config: ElysiaWebSocketRateLimitConfig) {
    return async (
      context: ElysiaWebSocketContext,
      next: () => Promise<void>
    ) => {
      // Skip if disabled
      if (config.enabled === false) {
        return next();
      }

      // Skip certain message types
      if (this.shouldSkipMessage(context, config)) {
        return next();
      }

      const startTime = performance.now();

      try {
        // Generate rate limiting key
        const rateLimitKey = this.generateRateLimitKey(context, config);

        // Check connection limits
        if (config.maxConnections) {
          await this.checkConnectionLimit(context, rateLimitKey, config);
        }

        // Check message rate limits
        if (config.maxMessagesPerMinute || config.maxMessagesPerHour) {
          await this.checkMessageRateLimit(context, rateLimitKey, config);
        }

        // Update connection tracking
        await this.updateConnectionTracking(context, rateLimitKey);

        // Proceed to next middleware or handler
        await next();

        await this.recordMetric("elysia_ws_rate_limit_allowed", 1, {
          rateLimiter: config.name,
          messageType: context.message.type || "unknown",
        });
      } catch (error) {
        this.logger.warn("Elysia WebSocket rate limit exceeded", {
          rateLimiter: config.name,
          connectionId: context.connectionId,
          userId: context.userId,
          messageType: context.message.type,
          error: (error as Error).message,
        });

        await this.recordMetric("elysia_ws_rate_limit_exceeded", 1, {
          rateLimiter: config.name,
          messageType: context.message.type || "unknown",
        });

        await this.handleRateLimitExceeded(context, error as Error, config);

        // Don't call next() - block the message
        return;
      } finally {
        await this.recordTimer(
          "elysia_ws_rate_limit_duration",
          performance.now() - startTime,
          {
            rateLimiter: config.name,
          }
        );
      }
    };
  }

  /**
   * Generate rate limiting key
   */
  private generateRateLimitKey(
    context: ElysiaWebSocketContext,
    config: ElysiaWebSocketRateLimitConfig
  ): string {
    let baseKey: string;

    if (config.keyGenerator) {
      baseKey = config.keyGenerator(context);
    } else {
      // Default key generation strategy
      if (context.authenticated && context.userId) {
        baseKey = `elysia_ws_user:${context.userId}`;
      } else {
        baseKey = `elysia_ws_ip:${context.metadata.clientIp}`;
      }
    }

    const prefix = config.redis?.keyPrefix || "elysia_ws_rate_limit";
    return `${prefix}:${baseKey}`;
  }

  /**
   * Check if message should skip rate limiting
   */
  private shouldSkipMessage(
    context: ElysiaWebSocketContext,
    config: ElysiaWebSocketRateLimitConfig
  ): boolean {
    const messageType = context.message.type;
    if (!messageType) return false;

    return config.skipMessageTypes?.includes(messageType) || false;
  }

  /**
   * Check connection limits
   */
  private async checkConnectionLimit(
    context: ElysiaWebSocketContext,
    rateLimitKey: string,
    config: ElysiaWebSocketRateLimitConfig
  ): Promise<void> {
    const maxConnections = config.maxConnections!;
    const connectionKey = `${rateLimitKey}:connections`;

    try {
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
    context: ElysiaWebSocketContext,
    rateLimitKey: string,
    config: ElysiaWebSocketRateLimitConfig
  ): Promise<void> {
    // Check minute-based rate limit
    if (config.maxMessagesPerMinute) {
      await this.checkSlidingWindowRateLimit(
        context,
        rateLimitKey,
        config.maxMessagesPerMinute,
        60000, // 1 minute in ms
        "minute"
      );
    }

    // Check hour-based rate limit
    if (config.maxMessagesPerHour) {
      await this.checkSlidingWindowRateLimit(
        context,
        rateLimitKey,
        config.maxMessagesPerHour,
        3600000, // 1 hour in ms
        "hour"
      );
    }
  }

  /**
   * Sliding window rate limiting algorithm
   */
  private async checkSlidingWindowRateLimit(
    context: ElysiaWebSocketContext,
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
      pipeline.get(windowKey);
      pipeline.get(previousWindowKey);

      const results = await pipeline.exec();

      if (!results) {
        throw new Error("Redis pipeline execution failed");
      }

      const [currentWindowResult, previousWindowResult] = results;
      const currentCount = currentWindowResult?.[1]
        ? parseInt(currentWindowResult[1] as string, 10)
        : 0;
      const previousCount = previousWindowResult?.[1]
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
   * Update connection tracking
   */
  private async updateConnectionTracking(
    context: ElysiaWebSocketContext,
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
    context: ElysiaWebSocketContext,
    error: Error,
    config: ElysiaWebSocketRateLimitConfig
  ): Promise<void> {
    const errorMessage = error.message;

    // Call custom handler if provided
    if (config.onLimitExceeded) {
      config.onLimitExceeded(context, errorMessage);
    }

    // Send rate limit error response using Elysia WebSocket
    try {
      context.ws.send(
        JSON.stringify({
          type: "rate_limit_error",
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: errorMessage,
            timestamp: new Date().toISOString(),
            retryAfter: this.getRetryAfterSeconds(errorMessage),
          },
          connectionId: context.connectionId,
        })
      );
    } catch (sendError) {
      this.logger.error(
        "Failed to send rate limit error message",
        sendError as Error,
        {
          connectionId: context.connectionId,
        }
      );
    }

    // Log rate limit violation
    this.logger.warn("Elysia WebSocket rate limit exceeded", {
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
    rateLimitKey: string
  ): Promise<void> {
    try {
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
        rateLimitKey,
      });
    } catch (error) {
      this.logger.error(
        "Failed to cleanup connection tracking",
        error as Error,
        {
          connectionId,
        }
      );
    }
  }

  /**
   * Record metric with error handling
   */
  private async recordMetric(
    name: string,
    value: number,
    tags: Record<string, string>
  ): Promise<void> {
    try {
      await this.metrics.recordCounter(name, value, {
        type: "websocket",
        ...tags,
      });
    } catch (error) {
      this.logger.error("Failed to record metric", error as Error, {
        metric: name,
      });
    }
  }

  /**
   * Record timer metric with error handling
   */
  private async recordTimer(
    name: string,
    duration: number,
    tags: Record<string, string>
  ): Promise<void> {
    try {
      await this.metrics.recordTimer(name, duration, {
        type: "websocket",
        ...tags,
      });
    } catch (error) {
      this.logger.error("Failed to record timer", error as Error, {
        timer: name,
      });
    }
  }
}

/**
 * Factory function to create Elysia WebSocket rate limiting middleware
 */
export function createElysiaWebSocketRateLimitMiddleware(
  rateLimiter: ElysiaWebSocketRateLimiter,
  config: ElysiaWebSocketRateLimitConfig
) {
  return rateLimiter.createMiddleware(config);
}

/**
 * Predefined configurations for common use cases
 */
export const ElysiaWebSocketRateLimitPresets = {
  /**
   * General purpose WebSocket rate limiting
   */
  general: (
    customConfig?: Partial<ElysiaWebSocketRateLimitConfig>
  ): ElysiaWebSocketRateLimitConfig => ({
    name: "elysia-ws-rate-limit-general",
    enabled: true,
    maxConnections: 1000,
    maxMessagesPerMinute: 60,
    maxMessagesPerHour: 1000,
    skipMessageTypes: ["ping", "pong", "heartbeat"],
    ...customConfig,
  }),

  /**
   * Strict rate limiting for sensitive operations
   */
  strict: (
    customConfig?: Partial<ElysiaWebSocketRateLimitConfig>
  ): ElysiaWebSocketRateLimitConfig => ({
    name: "elysia-ws-rate-limit-strict",
    enabled: true,
    maxConnections: 100,
    maxMessagesPerMinute: 10,
    maxMessagesPerHour: 200,
    skipMessageTypes: ["ping", "pong", "heartbeat"],
    ...customConfig,
  }),

  /**
   * High-frequency rate limiting for real-time games
   */
  game: (
    customConfig?: Partial<ElysiaWebSocketRateLimitConfig>
  ): ElysiaWebSocketRateLimitConfig => ({
    name: "elysia-ws-rate-limit-game",
    enabled: true,
    maxConnections: 500,
    maxMessagesPerMinute: 120, // Fast-paced games need higher limits
    maxMessagesPerHour: 3000,
    skipMessageTypes: ["ping", "pong", "heartbeat", "player_position"],
    ...customConfig,
  }),

  /**
   * Chat application rate limiting
   */
  chat: (
    customConfig?: Partial<ElysiaWebSocketRateLimitConfig>
  ): ElysiaWebSocketRateLimitConfig => ({
    name: "elysia-ws-rate-limit-chat",
    enabled: true,
    maxConnections: 200,
    maxMessagesPerMinute: 30,
    maxMessagesPerHour: 500,
    skipMessageTypes: [
      "ping",
      "pong",
      "heartbeat",
      "typing_indicator",
      "read_receipt",
    ],
    ...customConfig,
  }),

  /**
   * API WebSocket rate limiting
   */
  api: (
    customConfig?: Partial<ElysiaWebSocketRateLimitConfig>
  ): ElysiaWebSocketRateLimitConfig => ({
    name: "elysia-ws-rate-limit-api",
    enabled: true,
    maxConnections: 2000,
    maxMessagesPerMinute: 100,
    maxMessagesPerHour: 2000,
    skipMessageTypes: ["ping", "pong", "heartbeat"],
    ...customConfig,
  }),

  /**
   * Data streaming rate limiting
   */
  dataStream: (
    customConfig?: Partial<ElysiaWebSocketRateLimitConfig>
  ): ElysiaWebSocketRateLimitConfig => ({
    name: "elysia-ws-rate-limit-data-stream",
    enabled: true,
    maxConnections: 50,
    maxMessagesPerMinute: 300, // High frequency data streams
    maxMessagesPerHour: 10000,
    skipMessageTypes: ["ping", "pong", "heartbeat"],
    ...customConfig,
  }),
};
