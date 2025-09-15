/**
 * @fileoverview WebSocket Middleware Chain Integration Tests
 * @description Tests multiple WebSocket middleware working together in realistic scenarios
 */

import { WebSocketMiddlewareChain } from "../../src/middleware/base/middlewareChain/WebSocketMiddlewareChain";
import { AuthWebSocketMiddleware } from "../../src/middleware/auth/auth.websocket.middleware";
import { LoggingWebSocketMiddleware } from "../../src/middleware/logging/logging.websocket.middleware";
import { SecurityWebSocketMiddleware } from "../../src/middleware/security/security.websocket.middleware";
import { RateLimitWebSocketMiddleware } from "../../src/middleware/rateLimit/rateLimit.websocket.middleware";
import { WebSocketContext, WebSocketMessage } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

// Mock external dependencies
jest.mock("@libs/monitoring");
jest.mock("@libs/auth");

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

const mockAuthService = {
  verifyToken: jest.fn(),
  getUserById: jest.fn(),
  can: jest.fn(),
  getJWTService: jest.fn().mockReturnValue({
    extractTokenFromHeader: jest.fn().mockReturnValue("test-token"),
  }),
  getApiKeyService: jest.fn().mockReturnValue({
    validateApiKey: jest.fn().mockResolvedValue({
      id: "api_key_123",
      userId: "user_123",
      permissions: ["ws:connect", "chat:send"],
    }),
  }),
  getPermissionService: jest.fn().mockReturnValue({
    createAuthContext: jest.fn().mockReturnValue({
      user: {
        id: "user_123",
        roles: ["user"],
        permissions: ["ws:connect", "chat:send"],
      },
      permissions: ["ws:connect", "chat:send"],
      roles: ["user"],
    }),
  }),
};

describe("WebSocket Middleware Chain Integration Tests", () => {
  let mockContext: WebSocketContext;
  let mockWebSocket: {
    send: jest.MockedFunction<(data: string) => void>;
    close: jest.MockedFunction<() => void>;
    readyState: number;
  };
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockWebSocket = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1, // WebSocket.OPEN
    };

    mockContext = {
      ws: mockWebSocket,
      connectionId: "conn_123",
      message: {
        type: "chat_message",
        payload: {
          text: "Hello, World!",
          channel: "general",
        },
      },
      timestamp: new Date().toISOString(),
      authenticated: false,
      metadata: {
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 5,
        clientIp: "192.168.1.100",
        userAgent: "Mozilla/5.0 WebSocket Client",
        headers: {
          authorization: "Bearer test-token",
          origin: "https://chat.example.com",
          "user-agent": "Mozilla/5.0 WebSocket Client",
        },
        query: {
          channel: "general",
          version: "1.0",
        },
      },
    };

    nextFunction = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("Auth + Security + Rate Limiting Chain", () => {
    it("should handle successful WebSocket message through complete middleware chain", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "ws-integration-test"
      );

      // Create middleware instances
      const authMiddleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "ws-auth",
          requireAuth: true,
          closeOnAuthFailure: false,
          jwtAuth: true,
          messagePermissions: {
            chat_message: ["chat:send"],
            admin_action: ["admin:manage"],
          },
          messageRoles: {
            chat_message: ["user", "admin"],
            admin_action: ["admin"],
          },
          enableCleanupTimer: false,
        }
      );

      const securityMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-security",
          enabled: true,
          priority: 80,
          maxConnectionsPerIP: 10,
          maxMessageSize: 1000,
          messageTypeWhitelist: ["chat_message", "ping", "pong"],
          rateLimitMax: 100,
        }
      );

      const rateLimitMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-rateLimit",
          enabled: true,
          priority: 70,
          windowMs: 60000,
          maxMessageSize: 50,
          customKeyGenerator: (context) => context.connectionId,
        }
      );

      // Register middleware in chain
      chain.register(
        { name: "ws-auth", priority: 90 },
        authMiddleware.middleware()
      );
      chain.register(
        { name: "ws-security", priority: 80 },
        securityMiddleware.middleware()
      );
      chain.register(
        { name: "ws-rateLimit", priority: 70 },
        rateLimitMiddleware.middleware()
      );

      // Mock successful authentication
      mockAuthService.verifyToken.mockResolvedValue({
        id: "user_123",
        roles: ["user"],
        permissions: ["chat:send"],
      });

      // Execute the chain
      await chain.execute(mockContext);

      // Verify authentication was successful
      expect(mockContext.authenticated).toBe(true);

      // Verify metrics were recorded for each middleware
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_message_processed",
        1,
        expect.objectContaining({ middleware: "ws-auth" })
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_message_processed",
        1,
        expect.objectContaining({ middleware: "ws-security" })
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_message_processed",
        1,
        expect.objectContaining({ middleware: "ws-rateLimit" })
      );
    });

    it("should handle authentication failure and prevent further processing", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "auth-fail-test"
      );

      const authMiddleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "ws-auth",
          requireAuth: true,
          closeOnAuthFailure: true,
          jwtAuth: true,
          messagePermissions: {
            chat_message: ["chat:send"],
          },
          enableCleanupTimer: false,
        }
      );

      const securityMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-security",
          enabled: true,
          priority: 80,
        }
      );

      chain.register(
        { name: "ws-auth", priority: 90 },
        authMiddleware.middleware()
      );
      chain.register(
        { name: "ws-security", priority: 80 },
        securityMiddleware.middleware()
      );

      // Mock authentication failure
      mockAuthService.verifyToken.mockRejectedValue(new Error("Invalid token"));

      // Execute the chain
      await expect(chain.execute(mockContext)).resolves.not.toThrow();

      // Verify connection was closed due to auth failure
      expect(mockWebSocket.close).toHaveBeenCalled();

      // Verify authentication failed
      expect(mockContext.authenticated).toBe(false);

      // Verify error metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_auth_failed",
        1,
        expect.any(Object)
      );
    });

    it("should handle rate limiting and block excessive messages", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "rate-limit-test"
      );

      const rateLimitMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-rateLimit",
          enabled: true,
          priority: 90,
          windowMs: 1000, // 1 second window
          maxMessagesPerMinute: 2, // Only 2 messages allowed
          customKeyGenerator: (context) => context.connectionId,
        }
      );

      chain.register(
        { name: "ws-rateLimit", priority: 90 },
        rateLimitMiddleware.middleware()
      );

      // Send first message - should pass
      await chain.execute({
        ...mockContext,
        message: { type: "msg1", payload: {} },
      });
      expect(mockWebSocket.close).not.toHaveBeenCalled();

      // Send second message - should pass
      await chain.execute({
        ...mockContext,
        message: { type: "msg2", payload: {} },
      });
      expect(mockWebSocket.close).not.toHaveBeenCalled();

      // Send third message - should be rate limited
      await chain.execute({
        ...mockContext,
        message: { type: "msg3", payload: {} },
      });
      expect(mockWebSocket.close).toHaveBeenCalled();

      // Verify rate limit metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_rate_limited",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Logging + Security Message Validation", () => {
    it("should log all WebSocket activity and validate message structure", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "logging-security-test"
      );

      const loggingMiddleware = new LoggingWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-logging",
          enabled: true,
          priority: 100,
          logLevel: "info",
          redactPayload: true,
          maxMessageSize: 200,
        }
      );

      const securityMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-security",
          enabled: true,
          priority: 90,
          maxMessageSize: 1000,
          messageTypeWhitelist: ["chat_message", "ping"],
        }
      );

      chain.register(
        { name: "ws-logging", priority: 100 },
        loggingMiddleware.middleware()
      );
      chain.register(
        { name: "ws-security", priority: 90 },
        securityMiddleware.middleware()
      );

      // Execute with valid message
      await chain.execute(mockContext);

      // Verify logging metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_message_logged",
        1,
        expect.objectContaining({ type: "chat_message" })
      );

      // Verify security validation passed
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_message_validated",
        1,
        expect.any(Object)
      );
    });

    it("should block messages with invalid structure", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "invalid-message-test"
      );

      const securityMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-security",
          enabled: true,
          priority: 90,
          messageTypeWhitelist: ["chat_message"],
        }
      );

      chain.register(
        { name: "ws-security", priority: 90 },
        securityMiddleware.middleware()
      );

      // Test with invalid message type
      const invalidContext = {
        ...mockContext,
        message: {
          type: "malicious_script",
          payload: { script: "alert('xss')" },
        },
      };

      await chain.execute(invalidContext);

      // Should have blocked the message
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_message_blocked",
        1,
        expect.objectContaining({ reason: "invalid_message_type" })
      );
    });
  });

  describe("Complete Real-Time Chat Middleware Stack", () => {
    it("should handle complete chat message flow with all middleware", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "chat-stack"
      );

      // Create complete middleware stack for chat application
      const loggingMiddleware = new LoggingWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-logging",
          enabled: true,
          priority: 100,
          logLevel: "info",
          redactPayload: true,
        }
      );

      const authMiddleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "ws-auth",
          requireAuth: true,
          closeOnAuthFailure: false,
          messagePermissions: {
            chat_message: ["chat:send"],
            typing_indicator: ["chat:interact"],
            join_room: ["chat:join"],
          },
          messageRoles: {
            chat_message: ["user", "moderator", "admin"],
            admin_command: ["admin"],
          },
          enableCleanupTimer: false,
        }
      );

      const securityMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-security",
          enabled: true,
          priority: 80,
          maxMessageSize: 2000,
          messageTypeWhitelist: [
            "chat_message",
            "typing_indicator",
            "join_room",
          ],
          blockSuspiciousConnections: true,
        }
      );

      const rateLimitMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-rateLimit",
          enabled: true,
          priority: 70,
          windowMs: 60000, // 1 minute window
          maxMessagesPerMinute: 30, // 30 messages per minute
          customKeyGenerator: (context) =>
            `${context.connectionId}:${context.message.type}`,
        }
      );

      // Register all middleware
      chain.register(
        { name: "ws-logging", priority: 100 },
        loggingMiddleware.middleware()
      );
      chain.register(
        { name: "ws-auth", priority: 90 },
        authMiddleware.middleware()
      );
      chain.register(
        { name: "ws-security", priority: 80 },
        securityMiddleware.middleware()
      );
      chain.register(
        { name: "ws-rateLimit", priority: 70 },
        rateLimitMiddleware.middleware()
      );

      // Mock successful authentication
      mockAuthService.verifyToken.mockResolvedValue({
        id: "user_123",
        roles: ["user"],
        permissions: ["chat:send", "chat:interact", "chat:join"],
      });

      // Test different message types
      const messageTypes: Array<{
        type: string;
        payload: Record<string, unknown>;
        shouldPass: boolean;
      }> = [
        {
          type: "chat_message",
          payload: { text: "Hello everyone!", channel: "general" },
          shouldPass: true,
        },
        {
          type: "typing_indicator",
          payload: { channel: "general", typing: true },
          shouldPass: true,
        },
        {
          type: "join_room",
          payload: { room: "general" },
          shouldPass: true,
        },
        {
          type: "admin_command",
          payload: { command: "ban_user", target: "user_456" },
          shouldPass: false, // User doesn't have admin role
        },
      ];

      for (const messageTest of messageTypes) {
        const testContext = {
          ...mockContext,
          message: messageTest as WebSocketMessage,
        };

        await chain.execute(testContext);

        if (messageTest.shouldPass) {
          // Should have processed successfully
          expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
            "websocket_message_processed",
            1,
            expect.objectContaining({ type: messageTest.type })
          );
        } else {
          // Should have been blocked due to permissions
          expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
            "websocket_auth_failed",
            1,
            expect.any(Object)
          );
        }
      }
    });

    it("should maintain connection state across message processing", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "connection-state"
      );

      const authMiddleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "ws-auth",
          requireAuth: true,
          closeOnAuthFailure: false,
          enableCleanupTimer: false,
        }
      );

      chain.register(
        { name: "ws-auth", priority: 90 },
        authMiddleware.middleware()
      );

      // Mock successful authentication
      mockAuthService.verifyToken.mockResolvedValue({
        id: "user_123",
        roles: ["user"],
        permissions: ["chat:send"],
      });

      // Process first message - should authenticate
      await chain.execute(mockContext);
      expect(mockContext.authenticated).toBe(true);

      // Process second message - should remain authenticated
      const secondMessage = {
        ...mockContext,
        message: { type: "chat_message", payload: { text: "Second message" } },
        authenticated: true, // Preserve authentication from first message
      };

      await chain.execute(secondMessage);
      expect(secondMessage.authenticated).toBe(true);

      // Verify token verification was only called once (cached)
      expect(mockAuthService.verifyToken).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling and Recovery", () => {
    it("should handle middleware errors gracefully without breaking the chain", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "error-handling"
      );

      // Create a middleware that throws an error
      const faultyMiddleware = {
        execute: jest.fn().mockRejectedValue(new Error("Middleware error")),
      };

      const workingMiddleware = {
        execute: jest.fn().mockResolvedValue(undefined),
      };

      chain.register(
        { name: "faulty", priority: 90 },
        faultyMiddleware.execute
      );
      chain.register(
        { name: "working", priority: 80 },
        workingMiddleware.execute
      );

      // Execute chain - should not throw
      await expect(chain.execute(mockContext)).resolves.not.toThrow();

      // Verify error metrics were recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_middleware_error",
        1,
        expect.objectContaining({ middleware: "faulty" })
      );

      // Working middleware should still be called
      expect(workingMiddleware.execute).toHaveBeenCalled();
    });

    it("should handle connection cleanup on errors", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "cleanup-test"
      );

      const authMiddleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "ws-auth",
          requireAuth: true,
          closeOnAuthFailure: true,
          enableCleanupTimer: false,
        }
      );

      chain.register(
        { name: "ws-auth", priority: 90 },
        authMiddleware.middleware()
      );

      // Mock authentication failure
      mockAuthService.verifyToken.mockRejectedValue(new Error("Token expired"));

      await chain.execute(mockContext);

      // Connection should be closed
      expect(mockWebSocket.close).toHaveBeenCalled();

      // Cleanup metrics should be recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_connection_closed",
        1,
        expect.objectContaining({ reason: "auth_failure" })
      );
    });
  });

  describe("Performance and Scalability", () => {
    it("should handle high message throughput efficiently", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "performance-test"
      );

      const lightweightMiddleware = {
        execute: jest.fn().mockResolvedValue(undefined),
      };

      chain.register(
        { name: "lightweight", priority: 90 },
        lightweightMiddleware.execute
      );

      const startTime = Date.now();
      const messageCount = 100;

      // Process many messages quickly
      const promises = Array(messageCount)
        .fill(null)
        .map((_, index) =>
          chain.execute({
            ...mockContext,
            message: { type: "test_message", payload: { index } },
          })
        );

      await Promise.all(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should process all messages in reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);
      expect(lightweightMiddleware.execute).toHaveBeenCalledTimes(messageCount);

      // Verify performance metrics
      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "websocket_middleware_execution_time",
        expect.any(Number),
        expect.any(Object)
      );
    });

    it("should support concurrent message processing from multiple connections", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "concurrent-test"
      );

      const processingMiddleware = {
        execute: jest.fn().mockImplementation(async (context) => {
          // Simulate some processing time
          await new Promise((resolve) => setTimeout(resolve, 10));
        }),
      };

      chain.register(
        { name: "processor", priority: 90 },
        processingMiddleware.execute
      );

      const connectionCount = 10;
      const messagesPerConnection = 5;

      // Create multiple concurrent contexts (simulating different connections)
      const concurrentPromises = Array(connectionCount)
        .fill(null)
        .flatMap((_, connIndex) =>
          Array(messagesPerConnection)
            .fill(null)
            .map((_, msgIndex) =>
              chain.execute({
                ...mockContext,
                connectionId: `conn_${connIndex}`,
                message: {
                  type: "concurrent_test",
                  payload: { connIndex, msgIndex },
                },
              })
            )
        );

      const startTime = Date.now();
      await Promise.all(concurrentPromises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should handle concurrent processing efficiently
      expect(duration).toBeLessThan(200); // Should be much faster than sequential processing
      expect(processingMiddleware.execute).toHaveBeenCalledTimes(
        connectionCount * messagesPerConnection
      );
    });
  });
});
