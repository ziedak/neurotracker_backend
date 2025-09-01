/**
 * Elysia WebSocket Rate Limiting - Usage Examples
 * Proper integration with Elysia's built-in WebSocket support
 */

// Note: In a real implementation, these imports would resolve properly
// This demonstrates the pattern for Elysia WebSocket integration
interface ElysiaWebSocket {
  data: {
    connectionId?: string;
    messageCount?: number;
    clientIp?: string;
    userAgent?: string;
    userId?: string;
    userRoles?: string[];
    deviceId?: string;
    headers?: Record<string, any>;
    query?: Record<string, any>;
    connectedAt?: Date;
    [key: string]: any;
  };
  send(message: string): void;
  close(): void;
  publish?(topic: string, message: string): void;
  subscribe?(topic: string): void;
  unsubscribe?(topic: string): void;
}

interface ElysiaWebSocketHandler {
  message?: (
    ws: ElysiaWebSocket,
    message: string | Buffer | ArrayBuffer
  ) => void | Promise<void>;
  open?: (ws: ElysiaWebSocket) => void | Promise<void>;
  close?: (
    ws: ElysiaWebSocket,
    code?: number,
    reason?: string
  ) => void | Promise<void>;
  error?: (ws: ElysiaWebSocket, error: Error) => void | Promise<void>;
  upgrade?: (request: Request, server: any) => void | Promise<void>;
}

// Mock Elysia class for demonstration
class MockElysia {
  ws(path: string, handler: ElysiaWebSocketHandler): this {
    console.log(`Setting up WebSocket at ${path}`, handler);
    return this;
  }
}

import {
  ElysiaWebSocketRateLimiter,
  createElysiaWebSocketRateLimitMiddleware,
  ElysiaWebSocketRateLimitPresets,
  type ElysiaWebSocketContext,
  type ElysiaWebSocketRateLimitConfig,
} from "./ElysiaWebSocketRateLimiter";
import { type ILogger, type IMetricsCollector } from "@libs/monitoring";
import { type RedisClient } from "@libs/database";
import { inject, injectable } from "@libs/utils";
import { Elysia } from "@libs/elysia-server";

// ===================================================================
// Example 1: Basic Elysia WebSocket with Rate Limiting
// ===================================================================

@injectable()
export class BasicWebSocketService {
  private rateLimiter: ElysiaWebSocketRateLimiter;

  constructor(
    @inject("ILogger") private logger: ILogger,
    @inject("IMetricsCollector") private metrics: IMetricsCollector,
    @inject("RedisClient") private redisClient: RedisClient
  ) {
    this.rateLimiter = new ElysiaWebSocketRateLimiter(
      logger,
      metrics,
      redisClient
    );
  }

  createApp(): MockElysia {
    // Create rate limiting middleware
    const rateLimitMiddleware = createElysiaWebSocketRateLimitMiddleware(
      this.rateLimiter,
      ElysiaWebSocketRateLimitPresets.general({ maxMessagesPerMinute: 30 })
    );

    return new MockElysia().ws("/ws", {
      message: async (
        ws: ElysiaWebSocket,
        message: string | Buffer | ArrayBuffer
      ) => {
        // Parse message safely
        let parsedMessage: any;
        try {
          const messageStr =
            typeof message === "string"
              ? message
              : Buffer.from(message as ArrayBuffer).toString();
          parsedMessage = JSON.parse(messageStr);
        } catch (error) {
          this.logger.warn("Invalid message format", { error });
          return;
        }

        // Create context for middleware
        const context: ElysiaWebSocketContext = {
          ws,
          connectionId: ws.data.connectionId || this.generateConnectionId(),
          message: parsedMessage,
          metadata: {
            connectedAt: ws.data.connectedAt || new Date(),
            lastActivity: new Date(),
            messageCount: (ws.data.messageCount || 0) + 1,
            clientIp: ws.data.clientIp || "unknown",
            userAgent: ws.data.headers?.["user-agent"] || "unknown",
            headers: Object.fromEntries(
              Object.entries(ws.data.headers || {}).filter(
                ([, value]) => typeof value === "string"
              )
            ) as Record<string, string>,
            query: ws.data.query || {},
          },
          authenticated: !!ws.data.userId,
          userId: ws.data.userId,
          userRoles: ws.data.userRoles,
          rooms: ["general"],
        };

        // Update message count
        (ws.data as any).messageCount = context.metadata.messageCount;

        // Apply rate limiting middleware
        await rateLimitMiddleware(context, async () => {
          // Your actual message handling logic here
          await this.handleMessage(context);
        });
      },

      open: (ws: ElysiaWebSocket) => {
        const connectionId = this.generateConnectionId();
        ws.data.connectionId = connectionId;
        ws.data.connectedAt = new Date();
        ws.data.messageCount = 0;

        this.logger.info("WebSocket connection opened", { connectionId });

        ws.send(
          JSON.stringify({
            type: "connection_ack",
            payload: { connectionId, status: "connected" },
            timestamp: new Date().toISOString(),
          })
        );
      },

      close: (ws: ElysiaWebSocket, code?: number, reason?: string) => {
        const connectionId = ws.data.connectionId;
        this.logger.info("WebSocket connection closed", {
          connectionId,
          code,
          reason,
        });

        // Cleanup rate limiting tracking
        if (connectionId) {
          const rateLimitKey = ws.data.userId
            ? `elysia_ws_rate_limit:elysia_ws_user:${ws.data.userId}`
            : `elysia_ws_rate_limit:elysia_ws_ip:${ws.data.clientIp}`;

          this.rateLimiter.cleanupConnection(connectionId, rateLimitKey);
        }
      },

      error: (ws: ElysiaWebSocket, error: Error) => {
        this.logger.error("WebSocket error", {
          connectionId: ws.data.connectionId ?? `conn_${Date.now()}`,
          error: error.message,
          stack: error.stack,
        });
      },
    });
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private async handleMessage(context: ElysiaWebSocketContext): Promise<void> {
    const { message, ws, connectionId } = context;

    this.logger.debug("Processing WebSocket message", {
      connectionId,
      messageType: message.type,
      userId: context.userId,
    });

    switch (message.type) {
      case "echo":
        ws.send(
          JSON.stringify({
            type: "echo_response",
            payload: message.payload,
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case "status":
        ws.send(
          JSON.stringify({
            type: "status_response",
            payload: {
              connectionId,
              authenticated: context.authenticated,
              uptime: process.uptime(),
            },
            timestamp: new Date().toISOString(),
          })
        );
        break;

      default:
        ws.send(
          JSON.stringify({
            type: "error",
            error: {
              code: "UNKNOWN_MESSAGE_TYPE",
              message: `Unknown message type: ${message.type}`,
            },
            timestamp: new Date().toISOString(),
          })
        );
    }
  }
}

// ===================================================================
// Example 2: Multi-Application WebSocket Server
// ===================================================================

@injectable()
export class MultiAppWebSocketService {
  private rateLimiter: ElysiaWebSocketRateLimiter;

  constructor(
    @inject("ILogger") private logger: ILogger,
    @inject("IMetricsCollector") private metrics: IMetricsCollector,
    @inject("RedisClient") private redisClient: RedisClient
  ) {
    this.rateLimiter = new ElysiaWebSocketRateLimiter(
      logger,
      metrics,
      redisClient
    );
  }

  createApp(): Elysia {
    const app = new Elysia();

    // Chat WebSocket endpoint with chat-specific rate limiting
    app.ws("/ws/chat", {
      message: async (ws, message) => {
        const context = this.createContext(ws, message, "chat");

        const chatRateLimit = createElysiaWebSocketRateLimitMiddleware(
          this.rateLimiter,
          ElysiaWebSocketRateLimitPresets.chat({
            maxMessagesPerMinute: 25,
            skipMessageTypes: ["typing", "read_receipt", "presence"],
          })
        );

        await chatRateLimit(context, async () => {
          await this.handleChatMessage(context);
        });
      },
      open: (ws) => this.handleOpen(ws, "chat"),
      close: (ws) => this.handleClose(ws, "chat"),
    });

    // Game WebSocket endpoint with high-frequency rate limiting
    app.ws("/ws/game", {
      message: async (ws, message) => {
        const context = this.createContext(ws, message, "game");

        const gameRateLimit = createElysiaWebSocketRateLimitMiddleware(
          this.rateLimiter,
          ElysiaWebSocketRateLimitPresets.game({
            maxMessagesPerMinute: 200, // High frequency for games
            skipMessageTypes: ["player_position", "heartbeat", "input"],
          })
        );

        await gameRateLimit(context, async () => {
          await this.handleGameMessage(context);
        });
      },
      open: (ws) => this.handleOpen(ws, "game"),
      close: (ws) => this.handleClose(ws, "game"),
    });

    // API WebSocket endpoint with API-specific rate limiting
    app.ws("/ws/api", {
      message: async (ws, message) => {
        const context = this.createContext(ws, message, "api");

        const apiRateLimit = createElysiaWebSocketRateLimitMiddleware(
          this.rateLimiter,
          ElysiaWebSocketRateLimitPresets.api({
            // Custom key generator for API keys
            keyGenerator: (context) => {
              const apiKey = context.metadata.headers["x-api-key"];
              return apiKey
                ? `elysia_ws_api_key:${apiKey}`
                : `elysia_ws_ip:${context.metadata.clientIp}`;
            },
          })
        );

        await apiRateLimit(context, async () => {
          await this.handleApiMessage(context);
        });
      },
      open: (ws) => this.handleOpen(ws, "api"),
      close: (ws) => this.handleClose(ws, "api"),
    });

    return app;
  }

  private createContext(
    ws: any,
    message: any,
    appType: string
  ): ElysiaWebSocketContext {
    return {
      ws,
      connectionId: ws.data.connectionId || this.generateConnectionId(),
      message: typeof message === "string" ? JSON.parse(message) : message,
      metadata: {
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: ws.data.messageCount || 1,
        clientIp: ws.data.clientIp || "unknown",
        userAgent: ws.data.headers?.["user-agent"] || "unknown",
        headers: ws.data.headers || {},
        query: ws.data.query || {},
      },
      authenticated: !!ws.data.userId,
      userId: ws.data.userId,
      userRoles: ws.data.userRoles,
      rooms: [appType],
      appType, // Add app type to context
    };
  }

  private handleOpen(ws: any, appType: string): void {
    const connectionId = this.generateConnectionId();
    ws.data.connectionId = connectionId;
    ws.data.messageCount = 0;

    this.logger.info(`${appType} WebSocket connection opened`, {
      connectionId,
    });

    ws.send(
      JSON.stringify({
        type: "connection_ack",
        payload: { connectionId, appType, status: "connected" },
        timestamp: new Date().toISOString(),
      })
    );
  }

  private handleClose(ws: any, appType: string): void {
    const connectionId = ws.data.connectionId;
    this.logger.info(`${appType} WebSocket connection closed`, {
      connectionId,
    });

    // Cleanup rate limiting tracking
    if (connectionId) {
      const rateLimitKey = this.generateRateLimitKey(ws.data, appType);
      this.rateLimiter.cleanupConnection(connectionId, rateLimitKey);
    }
  }

  private generateRateLimitKey(wsData: any, appType: string): string {
    if (wsData.userId) {
      return `elysia_ws_rate_limit:elysia_ws_user:${wsData.userId}:${appType}`;
    }
    return `elysia_ws_rate_limit:elysia_ws_ip:${wsData.clientIp}:${appType}`;
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private async handleChatMessage(
    context: ElysiaWebSocketContext
  ): Promise<void> {
    const { message, ws } = context;

    switch (message.type) {
      case "chat_message":
        // Broadcast to chat room
        ws.send(
          JSON.stringify({
            type: "chat_message_ack",
            payload: { messageId: message.payload.id, status: "sent" },
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case "typing":
        // Handle typing indicators
        break;
    }
  }

  private async handleGameMessage(
    context: ElysiaWebSocketContext
  ): Promise<void> {
    const { message, ws } = context;

    switch (message.type) {
      case "player_action":
        // Process game action
        ws.send(
          JSON.stringify({
            type: "action_result",
            payload: { success: true, actionId: message.payload.id },
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case "game_state_request":
        // Send game state
        break;
    }
  }

  private async handleApiMessage(
    context: ElysiaWebSocketContext
  ): Promise<void> {
    const { message, ws } = context;

    switch (message.type) {
      case "api_request":
        // Process API request
        ws.send(
          JSON.stringify({
            type: "api_response",
            payload: { data: "processed", requestId: message.payload.id },
            timestamp: new Date().toISOString(),
          })
        );
        break;
    }
  }
}

// ===================================================================
// Example 3: Custom Rate Limiting Configuration
// ===================================================================

@injectable()
export class CustomRateLimitWebSocketService {
  private rateLimiter: ElysiaWebSocketRateLimiter;

  constructor(
    @inject("ILogger") private logger: ILogger,
    @inject("IMetricsCollector") private metrics: IMetricsCollector,
    @inject("RedisClient") private redisClient: RedisClient
  ) {
    this.rateLimiter = new ElysiaWebSocketRateLimiter(
      logger,
      metrics,
      redisClient
    );
  }

  createApp(): Elysia {
    // Custom configuration for IoT device management
    const iotRateLimitConfig: ElysiaWebSocketRateLimitConfig = {
      name: "elysia-ws-iot-rate-limit",
      enabled: true,
      maxConnections: 10000, // Many IoT devices
      maxMessagesPerMinute: 5, // Low frequency per device
      maxMessagesPerHour: 100,
      skipMessageTypes: ["device_status", "heartbeat", "ping", "pong"],

      // Device-specific key generation
      keyGenerator: (context: ElysiaWebSocketContext) => {
        const deviceId = context.metadata.headers["x-device-id"];
        return deviceId
          ? `elysia_ws_device:${deviceId}`
          : `elysia_ws_ip:${context.metadata.clientIp}`;
      },

      // Custom rate limit exceeded handler
      onLimitExceeded: (context: ElysiaWebSocketContext, limit: string) => {
        this.logger.warn("IoT device rate limit exceeded", {
          deviceId: context.metadata.headers["x-device-id"],
          connectionId: context.connectionId,
          limit,
        });

        // Send device-specific error
        context.ws.send(
          JSON.stringify({
            type: "device_rate_limit_error",
            error: {
              code: "DEVICE_RATE_LIMIT_EXCEEDED",
              message: `Device rate limit exceeded: ${limit}`,
              recommendation: "Reduce message frequency",
              retryAfter: 60,
            },
            timestamp: new Date().toISOString(),
          })
        );
      },

      redis: {
        keyPrefix: "iot_ws_rate_limit",
      },
    };

    const iotRateLimit = createElysiaWebSocketRateLimitMiddleware(
      this.rateLimiter,
      iotRateLimitConfig
    );

    return new Elysia().ws("/ws/iot", {
      message: async (ws, message) => {
        // Ensure ws.data has the expected structure
        if (!("connectionId" in ws.data)) {
          (ws.data as any).connectionId = this.generateConnectionId();
        }
        const context: ElysiaWebSocketContext = {
          ws,
          connectionId: (ws.data as any).connectionId,
          message: typeof message === "string" ? JSON.parse(message) : message,
          metadata: {
            connectedAt: new Date(),
            lastActivity: new Date(),
            messageCount: ((ws.data as any).messageCount || 0) + 1,
            clientIp: (ws.data as any).clientIp || "unknown",
            userAgent: (ws.data as any).userAgent,
            headers: (ws.data as any).headers || {},
            query: (ws.data as any).query || {},
          },
          authenticated: !!(ws.data as any).deviceId,
          userId: (ws.data as any).deviceId, // Use device ID as user ID
        };

        // Update message count
        (ws.data as any).messageCount = context.metadata.messageCount;

        // Apply IoT-specific rate limiting
        await iotRateLimit(context, async () => {
          await this.handleIoTMessage(context);
        });
      },

      open: (ws) => {
        const connectionId = this.generateConnectionId();
        const deviceId = ws.data.headers?.["x-device-id"];

        (ws.data as any).connectionId = connectionId;
        (ws.data as any).deviceId = deviceId;
        (ws.data as any).messageCount = 0;

        this.logger.info("IoT device connected", { connectionId, deviceId });

        ws.send(
          JSON.stringify({
            type: "device_connection_ack",
            payload: { connectionId, deviceId, status: "connected" },
            timestamp: new Date().toISOString(),
          })
        );
      },

      close: (ws: ElysiaWebSocket) => {
        const connectionId = (ws.data as any).connectionId;
        const deviceId = (ws.data as any).deviceId;

        this.logger.info("IoT device disconnected", { connectionId, deviceId });

        // Cleanup rate limiting
        if (connectionId && deviceId) {
          const rateLimitKey = `iot_ws_rate_limit:elysia_ws_device:${deviceId}`;
          this.rateLimiter.cleanupConnection(connectionId, rateLimitKey);
        }
      },
    });
  }

  private generateConnectionId(): string {
    return `iot_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private async handleIoTMessage(
    context: ElysiaWebSocketContext
  ): Promise<void> {
    const { message, ws } = context;
    const deviceId = context.metadata.headers["x-device-id"];

    this.logger.debug("Processing IoT message", {
      deviceId,
      messageType: message.type,
      connectionId: context.connectionId,
    });

    switch (message.type) {
      case "sensor_data":
        // Store sensor data
        ws.send(
          JSON.stringify({
            type: "sensor_data_ack",
            payload: { messageId: message.payload.id, status: "received" },
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case "device_config_request":
        // Send device configuration
        ws.send(
          JSON.stringify({
            type: "device_config",
            payload: {
              config: { sampleRate: 1000, enabled: true },
              version: "1.0.0",
            },
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case "alert":
        // Handle device alert
        this.logger.warn("Device alert received", {
          deviceId,
          alert: message.payload,
        });

        ws.send(
          JSON.stringify({
            type: "alert_ack",
            payload: { alertId: message.payload.id, status: "acknowledged" },
            timestamp: new Date().toISOString(),
          })
        );
        break;

      default:
        ws.send(
          JSON.stringify({
            type: "error",
            error: {
              code: "UNKNOWN_MESSAGE_TYPE",
              message: `Unknown message type: ${message.type}`,
            },
            timestamp: new Date().toISOString(),
          })
        );
    }
  }
}

// ===================================================================
// Example 4: Testing Utilities
// ===================================================================

export class ElysiaWebSocketRateLimitTestUtils {
  /**
   * Create mock Elysia WebSocket context for testing
   */
  static createMockContext(
    overrides: Partial<ElysiaWebSocketContext> = {}
  ): ElysiaWebSocketContext {
    return {
      ws: {
        send: jest.fn(),
        close: jest.fn(),
        data: {},
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
    rateLimiter: ElysiaWebSocketRateLimiter;
    mocks: {
      logger: jest.Mocked<ILogger>;
      metrics: jest.Mocked<IMetricsCollector>;
      redisClient: jest.Mocked<RedisClient>;
    };
  } {
    const mockLogger = {
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

    const rateLimiter = new ElysiaWebSocketRateLimiter(
      mockLogger,
      mockMetrics,
      mockRedisClient
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
// Example 5: Complete Application Example
// ===================================================================

export function createCompleteElysiaWebSocketApp(): {
  app: Elysia;
  services: any;
} {
  // This would typically be handled by your DI container
  const services = {
    logger: console, // Replace with actual logger
    metrics: { recordCounter: () => {}, recordTimer: () => {} }, // Replace with actual metrics
    redisClient: { getRedis: () => ({}) }, // Replace with actual Redis client
  };

  const rateLimiter = new ElysiaWebSocketRateLimiter(
    services.logger as any,
    services.metrics as any,
    services.redisClient as any
  );

  const app = new Elysia()
    // General WebSocket with basic rate limiting
    .ws("/ws", {
      message: async (ws, message) => {
        const context: ElysiaWebSocketContext = {
          ws,
          connectionId: (ws.data as any).connectionId ?? `conn_${Date.now()}`,
          message: typeof message === "string" ? JSON.parse(message) : message,
          metadata: {
            connectedAt: (ws.data as any).connectedAt || new Date(),
            lastActivity: new Date(),
            messageCount: ((ws.data as any).messageCount || 0) + 1,
            clientIp: "127.0.0.1",
            headers: {},
            query: {},
          },
          authenticated: false,
        };

        const rateLimitMiddleware = createElysiaWebSocketRateLimitMiddleware(
          rateLimiter,
          ElysiaWebSocketRateLimitPresets.general()
        );

        await rateLimitMiddleware(context, async () => {
          // Echo the message back
          ws.send(
            JSON.stringify({
              type: "echo",
              payload: context.message.payload,
              timestamp: new Date().toISOString(),
            })
          );
        });
      },

      open: (ws) => {
        if (!("connectionId" in ws.data)) {
          (ws.data as any).connectionId = `conn_${Date.now()}`;
        }
        (ws.data as any).connectedAt = new Date();
        (ws.data as any).messageCount = 0;

        ws.send(
          JSON.stringify({
            type: "connected",
            payload: { connectionId: (ws.data as any).connectionId },
            timestamp: new Date().toISOString(),
          })
        );
      },

      close: (ws) => {
        console.log(`Connection ${(ws.data as any).connectionId} closed`);
      },
    });

  return { app, services };
}
