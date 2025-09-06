/**
 * WebSocket Rate Limit Middleware - Usage Examples
 * Updated to use dependency injection patterns consistent with HTTP middlewares
 */

import { WebSocketRateLimitMiddleware } from "./WebSocketRateLimitMiddleware";
import { type ILogger, type IMetricsCollector } from "@libs/monitoring";
import { type RedisClient } from "@libs/database";
import { inject, injectable } from "@libs/utils";
import type { WebSocketContext, WebSocketRateLimitConfig } from "../../types";

// ===================================================================
// Example 1: Basic DI Container Usage
// ===================================================================

@injectable()
export class WebSocketService {
  constructor(
    ,
    @inject("IMetricsCollector") private metrics: IMetricsCollector,
    @inject("RedisClient") private redisClient: RedisClient
  ) {}

  /**
   * Create rate limiting middleware for chat application
   */
  createChatRateLimiter(): WebSocketRateLimitMiddleware {
    return WebSocketRateLimitMiddleware.createTyped(
      "chat",
      
      this.metrics,
      this.redisClient,
      {
        // Custom overrides for chat app
        maxMessagesPerMinute: 25,
        skipMessageTypes: ["typing_indicator", "read_receipt"],
      }
    );
  }

  /**
   * Create rate limiting middleware for real-time game
   */
  createGameRateLimiter(): WebSocketRateLimitMiddleware {
    return WebSocketRateLimitMiddleware.createTyped(
      "game",
      
      this.metrics,
      this.redisClient,
      {
        // High-frequency game actions
        maxMessagesPerMinute: 200,
        skipMessageTypes: ["player_position", "heartbeat"],
      }
    );
  }

  /**
   * Create custom rate limiting middleware
   */
  createCustomRateLimiter(): WebSocketRateLimitMiddleware {
    const config: WebSocketRateLimitConfig = {
      name: "custom-websocket-rate-limit",
      enabled: true,
      priority: 100,
      maxConnections: 500,
      maxMessagesPerMinute: 60,
      maxMessagesPerHour: 1000,
      skipMessageTypes: ["ping", "pong", "heartbeat"],

      // Custom key generation for multi-tenant app
      keyGenerator: (context: WebSocketContext) => {
        const tenantId = context.metadata.headers["x-tenant-id"] || "default";
        return context.userId
          ? `ws:${tenantId}:user:${context.userId}`
          : `ws:${tenantId}:ip:${context.metadata.clientIp}`;
      },

      // Custom limit exceeded handler
      onLimitExceeded: (context: WebSocketContext, limit: string) => {
        this.logger.warn("WebSocket rate limit exceeded", {
          connectionId: context.connectionId,
          userId: context.userId,
          limit,
          tenantId: context.metadata.headers["x-tenant-id"],
        });

        // Send custom error message
        context.ws.send(
          JSON.stringify({
            type: "rate_limit_error",
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: `Rate limit exceeded: ${limit}`,
              retryAfter: 60,
              timestamp: new Date().toISOString(),
            },
          })
        );
      },
    };

    return new WebSocketRateLimitMiddleware(
      
      this.metrics,
      this.redisClient,
      config
    );
  }
}

// ===================================================================
// Example 2: Factory Method Usage
// ===================================================================

export class WebSocketRateLimitFactory {
  static createForEnvironment(
    environment: "development" | "staging" | "production",
    logger: ILogger,
    metrics: IMetricsCollector,
    redisClient: RedisClient
  ): WebSocketRateLimitMiddleware {
    const baseConfig = {
      enabled: true,
      priority: 100,
      skipMessageTypes: ["ping", "pong", "heartbeat"],
    };

    switch (environment) {
      case "development":
        return WebSocketRateLimitMiddleware.createTyped(
          "general",
          logger,
          metrics,
          redisClient,
          {
            ...baseConfig,
            maxConnections: 10000, // Higher limits for dev
            maxMessagesPerMinute: 500,
            maxMessagesPerHour: 10000,
          }
        );

      case "staging":
        return WebSocketRateLimitMiddleware.createTyped(
          "general",
          logger,
          metrics,
          redisClient,
          {
            ...baseConfig,
            maxConnections: 5000,
            maxMessagesPerMinute: 200,
            maxMessagesPerHour: 5000,
          }
        );

      case "production":
        return WebSocketRateLimitMiddleware.createTyped(
          "strict",
          logger,
          metrics,
          redisClient,
          baseConfig
        );

      default:
        throw new Error(`Unsupported environment: ${environment}`);
    }
  }
}

// ===================================================================
// Example 3: WebSocket Server Integration
// ===================================================================

@injectable()
export class WebSocketServer {
  private rateLimitMiddleware: WebSocketRateLimitMiddleware;

  constructor(
    ,
    @inject("IMetricsCollector") private metrics: IMetricsCollector,
    @inject("RedisClient") private redisClient: RedisClient
  ) {
    this.rateLimitMiddleware = WebSocketRateLimitMiddleware.createTyped(
      "api",
      
      this.metrics,
      this.redisClient
    );
  }

  /**
   * Setup WebSocket message handling with rate limiting
   */
  setupMessageHandler(ws: any, connectionId: string, userId?: string) {
    ws.on("message", async (data: string) => {
      try {
        const message = JSON.parse(data);

        // Create WebSocket context
        const context: WebSocketContext = {
          ws,
          connectionId,
          message,
          metadata: {
            connectedAt: new Date(),
            lastActivity: new Date(),
            messageCount: 0,
            clientIp: "127.0.0.1", // Extract from real connection
            headers: {},
            query: {},
          },
          authenticated: !!userId,
          ...(userId && { userId }), // Only add userId if it exists
        };

        // Apply rate limiting middleware
        await this.rateLimitMiddleware.execute(context, async () => {
          // Process message after rate limiting passes
          await this.handleMessage(context);
        });
      } catch (error) {
        this.logger.error("WebSocket message handling error", error as Error, {
          connectionId,
          userId,
        });
      }
    });

    // Setup connection cleanup
    ws.on("close", async () => {
      await this.rateLimitMiddleware.cleanupConnection(
        connectionId,
        userId,
        "127.0.0.1" // Real client IP
      );
    });
  }

  private async handleMessage(context: WebSocketContext): Promise<void> {
    // Your message processing logic here
    this.logger.debug("Processing WebSocket message", {
      connectionId: context.connectionId,
      messageType: context.message.type,
      userId: context.userId,
    });

    // Send response
    context.ws.send(
      JSON.stringify({
        type: "response",
        data: { status: "processed" },
        timestamp: new Date().toISOString(),
      })
    );
  }
}

// ===================================================================
// Example 4: Multi-Application Rate Limiting
// ===================================================================

export class MultiAppWebSocketRateLimiter {
  private rateLimiters: Map<string, WebSocketRateLimitMiddleware> = new Map();

  constructor(
    private logger: ILogger,
    private metrics: IMetricsCollector,
    private redisClient: RedisClient
  ) {
    this.initializeRateLimiters();
  }

  private initializeRateLimiters(): void {
    // Chat application
    this.rateLimiters.set(
      "chat",
      WebSocketRateLimitMiddleware.createTyped(
        "chat",
        
        this.metrics,
        this.redisClient,
        {
          skipMessageTypes: ["typing", "presence", "read_receipt"],
        }
      )
    );

    // Live trading platform
    this.rateLimiters.set(
      "trading",
      WebSocketRateLimitMiddleware.createTyped(
        "api",
        
        this.metrics,
        this.redisClient,
        {
          maxMessagesPerMinute: 300, // High frequency for trading
          maxMessagesPerHour: 5000,
          skipMessageTypes: ["price_update", "heartbeat"],
        }
      )
    );

    // Data streaming service
    this.rateLimiters.set(
      "data-stream",
      WebSocketRateLimitMiddleware.createTyped(
        "data-stream",
        
        this.metrics,
        this.redisClient,
        {
          maxConnections: 100,
          maxMessagesPerMinute: 500, // Very high frequency
          maxMessagesPerHour: 20000,
        }
      )
    );

    // IoT device management
    this.rateLimiters.set(
      "iot",
      new WebSocketRateLimitMiddleware(
        
        this.metrics,
        this.redisClient,
        {
          name: "iot-websocket-rate-limit",
          enabled: true,
          priority: 100,
          maxConnections: 10000, // Many IoT devices
          maxMessagesPerMinute: 10, // Low frequency per device
          maxMessagesPerHour: 200,
          skipMessageTypes: ["device_status", "heartbeat"],

          // Device-specific key generation
          keyGenerator: (context: WebSocketContext) => {
            const deviceId = context.metadata.headers["x-device-id"];
            return deviceId
              ? `ws:iot:device:${deviceId}`
              : `ws:iot:ip:${context.metadata.clientIp}`;
          },
        }
      )
    );
  }

  /**
   * Get rate limiter for specific application
   */
  getRateLimiter(appType: string): WebSocketRateLimitMiddleware | undefined {
    return this.rateLimiters.get(appType);
  }

  /**
   * Apply rate limiting based on application type
   */
  async applyRateLimit(
    appType: string,
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    const rateLimiter = this.getRateLimiter(appType);

    if (!rateLimiter) {
      this.logger.warn("No rate limiter found for app type", { appType });
      return next();
    }

    return rateLimiter.execute(context, next);
  }
}

// ===================================================================
// Example 5: Testing Utilities
// ===================================================================

export class WebSocketRateLimitTestUtils {
  /**
   * Create mock WebSocket context for testing
   */
  static createMockContext(
    overrides: Partial<WebSocketContext> = {}
  ): WebSocketContext {
    return {
      ws: {
        send: jest.fn(),
        close: jest.fn(),
      },
      connectionId: "test-connection-123",
      message: {
        type: "test_message",
        payload: { data: "test" },
      },
      metadata: {
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 1,
        clientIp: "127.0.0.1",
        headers: {},
        query: {},
      },
      authenticated: false,
      ...overrides,
    };
  }

  /**
   * Create test rate limiter with mock dependencies
   */
  static createTestRateLimiter(): {
    rateLimiter: WebSocketRateLimitMiddleware;
    mocks: {
      logger: jest.Mocked<ILogger>;
      metrics: jest.Mocked<IMetricsCollector>;
      redisClient: jest.Mocked<RedisClient>;
    };
  } {
    const mockLogger = {
      child: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    const mockMetrics = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
    } as any;

    const mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      pipeline: jest.fn().mockReturnValue({
        get: jest.fn(),
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([]),
      }),
    };

    const mockRedisClient = {
      getRedis: jest.fn().mockReturnValue(mockRedis),
    } as any;

    const rateLimiter = new WebSocketRateLimitMiddleware(
      mockLogger,
      mockMetrics,
      mockRedisClient,
      {
        name: "test-rate-limiter",
        enabled: true,
        priority: 100,
        maxConnections: 100,
        maxMessagesPerMinute: 60,
        maxMessagesPerHour: 1000,
      }
    );

    return {
      rateLimiter,
      mocks: {
        logger: mockLogger,
        metrics: mockMetrics,
        redisClient: mockRedisClient,
      },
    };
  }
}

// ===================================================================
// Example 6: Performance Monitoring Integration
// ===================================================================

@injectable()
export class WebSocketPerformanceMonitor {
  private rateLimiters: Map<string, WebSocketRateLimitMiddleware> = new Map();

  constructor(
    ,
    @inject("IMetricsCollector") private metrics: IMetricsCollector,
    @inject("RedisClient") private redisClient: RedisClient
  ) {}

  /**
   * Create monitored rate limiter with performance tracking
   */
  createMonitoredRateLimiter(
    name: string,
    config: WebSocketRateLimitConfig
  ): WebSocketRateLimitMiddleware {
    const enhancedConfig = {
      ...config,
      onLimitExceeded: (context: WebSocketContext, limit: string) => {
        // Record rate limit violations
        this.metrics.recordCounter("websocket_rate_limit_violated", 1, {
          limiterName: name,
          limitType: limit,
          userId: context.userId || "anonymous",
          messageType: context.message.type,
        });

        // Call original handler if provided
        if (config.onLimitExceeded) {
          config.onLimitExceeded(context, limit);
        }
      },
    };

    const rateLimiter = new WebSocketRateLimitMiddleware(
      
      this.metrics,
      this.redisClient,
      enhancedConfig
    );

    this.rateLimiters.set(name, rateLimiter);
    return rateLimiter;
  }

  /**
   * Get performance statistics for all rate limiters
   */
  async getPerformanceStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    for (const [name] of this.rateLimiters) {
      try {
        // Get rate limiter stats if available
        stats[name] = {
          name,
          active: true,
          // Add custom performance metrics here
        };
      } catch (error) {
        this.logger.error(`Failed to get stats for ${name}`, error as Error);
        stats[name] = { name, active: false, error: (error as Error).message };
      }
    }

    return stats;
  }
}
