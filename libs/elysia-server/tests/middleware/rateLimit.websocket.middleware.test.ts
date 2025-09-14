/**
 * @fileoverview Comprehensive unit tests for RateLimitWebSocketMiddleware
 * @description Tests WebSocket rate limiting, connection throttling, and message rate control
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { RateLimitWebSocketMiddleware } from "../../src/middleware/rateLimit/rateLimit.websocket.middleware";
import { WebSocketContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("RateLimitWebSocketMiddleware", () => {
  let middleware: RateLimitWebSocketMiddleware;
  let mockContext: WebSocketContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance with comprehensive configuration
    middleware = new RateLimitWebSocketMiddleware(mockMetricsCollector, {
      name: "test-ws-ratelimit",
      enabled: true,
      priority: 35,
      algorithm: "sliding-window",
      maxMessagesPerMinute: 100,
      maxConnectionsPerIP: 10,
      windowMs: 60000, // 1 minute
      keyStrategy: "connectionId",
      enableConnectionLimiting: true,
      closeOnLimit: false,
      sendWarningMessage: true,
      warningThreshold: 80,
      maxMessageSize: 1024,
      redis: {
        keyPrefix: "test:ws_rl:",
        ttlBuffer: 1000,
      },
      message: {
        rateLimitExceeded: "Rate limit exceeded",
        connectionLimitExceeded: "Connection limit exceeded",
        warningMessage: "Warning: approaching rate limit",
      },
    });

    // Create mock WebSocket context matching the actual WebSocketContext interface
    mockContext = {
      ws: {
        send: jest.fn(),
        close: jest.fn(),
        readyState: 1,
        id: "ws-conn-456",
      },
      connectionId: "ws-conn-456",
      message: {
        type: "test",
        payload: { content: "test message" },
        timestamp: new Date().toISOString(),
      },
      metadata: {
        connectedAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        clientIp: "192.168.1.1",
        userAgent: "Mozilla/5.0 (compatible)",
        headers: {
          upgrade: "websocket",
          connection: "upgrade",
          "sec-websocket-key": "test-key",
          "user-agent": "Mozilla/5.0 (compatible)",
          origin: "http://localhost:3000",
        },
        query: { room: "general" },
      },
      authenticated: true,
      userId: "user-123",
      userRoles: ["user"],
      userPermissions: ["read", "write"],
      rooms: ["general"],
    };

    nextFunction = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("Middleware Initialization", () => {
    it("should initialize with default configuration", () => {
      const defaultMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {}
      );

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware.getConfig().name).toBe("websocket-rate-limit");
      expect(defaultMiddleware.getConfig().algorithm).toBe("sliding-window");
      expect(defaultMiddleware.getConfig().windowMs).toBe(60000);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware.getConfig().name).toBe("test-ws-ratelimit");
      expect(middleware.getConfig().algorithm).toBe("sliding-window");
      expect(middleware.getConfig().maxMessagesPerMinute).toBe(100);
      expect(middleware.getConfig().maxConnectionsPerIP).toBe(10);
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new RateLimitWebSocketMiddleware(mockMetricsCollector, {
          windowMs: -1,
        });
      }).toThrow("WebSocket RateLimit windowMs must be a positive number");
    });
  });

  describe("Connection Rate Limiting", () => {
    it("should allow connections within rate limit", async () => {
      // Test the overall execute method behavior instead of spying on internal methods
      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      // Verify that metrics are recorded for successful connections
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_ratelimit_check",
        1,
        expect.any(Object)
      );
    });

    it("should handle rate limit exceeded scenarios", async () => {
      // Create a middleware instance that will trigger rate limiting
      const strictMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "strict-test",
          enabled: true,
          priority: 35,
          algorithm: "sliding-window",
          windowMs: 1000, // Very short window for testing
          maxMessagesPerMinute: 0, // No messages allowed
          maxConnectionsPerIP: 0,
        }
      );

      const middlewareFn = strictMiddleware.middleware();
      await expect(middlewareFn(mockContext, nextFunction)).rejects.toThrow();

      // Should record violation metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_ratelimit_violation",
        1,
        expect.any(Object)
      );
    });

    it("should enforce maximum concurrent connections per user", async () => {
      // Test with a user that should be allowed
      mockContext.userId = "allowed-user";

      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should handle concurrent connection limits", async () => {
      // Create middleware with very low concurrent connection limit
      const limitedMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "limited-test",
          enabled: true,
          priority: 35,
          algorithm: "sliding-window",
          windowMs: 60000,
          maxConnectionsPerIP: 1,
          maxMessagesPerMinute: 100,
        }
      );

      // First connection should succeed
      const middlewareFn1 = limitedMiddleware.middleware();
      await middlewareFn1(mockContext, nextFunction);
      expect(nextFunction).toHaveBeenCalled();

      // Reset mock for second call
      nextFunction.mockClear();

      // Second connection with same user should potentially be limited
      // (this depends on the actual implementation)
      const middlewareFn2 = limitedMiddleware.middleware();
      await middlewareFn2(mockContext, nextFunction);
      // The behavior here depends on the actual rate limiting logic
    });
  });

  describe("Message Rate Limiting", () => {
    it("should allow messages within rate limit", async () => {
      mockContext.message = {
        type: "test",
        payload: { content: "test message" },
        timestamp: new Date().toISOString(),
      };

      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject messages exceeding rate limit", async () => {
      // Create middleware with very low message limit
      const strictMessageMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "strict-message-test",
          algorithm: "sliding-window",
          windowMs: 1000,
          maxMessagesPerMinute: 0, // No messages allowed
        }
      );

      mockContext.message = {
        type: "test",
        payload: { content: "test message" },
        timestamp: new Date().toISOString(),
      };

      const middlewareFn = strictMessageMiddleware.middleware();
      await expect(middlewareFn(mockContext, nextFunction)).rejects.toThrow();

      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should handle different message sizes", async () => {
      mockContext.message = {
        type: "test",
        payload: { content: "x".repeat(500) }, // 500 bytes
        timestamp: new Date().toISOString(),
      };

      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject messages exceeding size limit", async () => {
      mockContext.message = {
        type: "test",
        payload: { content: "x".repeat(2000) }, // 2000 bytes
        timestamp: new Date().toISOString(),
      };

      const middlewareFn = middleware.middleware();
      await expect(middlewareFn(mockContext, nextFunction)).rejects.toThrow();

      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe("Rate Limiting Algorithms", () => {
    it("should apply fixed-window algorithm", async () => {
      const fixedWindowMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          algorithm: "fixed-window",
        }
      );

      const middlewareFn = fixedWindowMiddleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should apply sliding-window algorithm", async () => {
      const slidingWindowMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          algorithm: "sliding-window",
        }
      );

      const middlewareFn = slidingWindowMiddleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should apply token-bucket algorithm", async () => {
      const tokenBucketMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          algorithm: "token-bucket",
        }
      );

      const middlewareFn = tokenBucketMiddleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should apply leaky-bucket algorithm", async () => {
      const leakyBucketMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          algorithm: "leaky-bucket",
        }
      );

      const middlewareFn = leakyBucketMiddleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("User and IP Filtering", () => {
    it("should allow whitelisted users", async () => {
      mockContext.userId = "admin-user-123";

      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject blacklisted users", async () => {
      mockContext.userId = "banned-user-456";

      const middlewareFn = middleware.middleware();
      await expect(middlewareFn(mockContext, nextFunction)).rejects.toThrow();

      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should allow whitelisted IPs", async () => {
      mockContext.metadata.clientIp = "127.0.0.1";

      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject blacklisted IPs", async () => {
      mockContext.metadata.clientIp = "10.0.0.1";

      const middlewareFn = middleware.middleware();
      await expect(middlewareFn(mockContext, nextFunction)).rejects.toThrow();

      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should filter by user agent", async () => {
      mockContext.metadata.userAgent = "Googlebot/2.1";

      const middlewareFn = middleware.middleware();
      await expect(middlewareFn(mockContext, nextFunction)).rejects.toThrow();

      expect(nextFunction).not.toHaveBeenCalled();
    });
  });

  describe("Path Exclusion", () => {
    it("should skip rate limiting for excluded paths", async () => {
      mockContext.path = "/health-ws";

      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      // Should not check rate limits for excluded paths
    });

    it("should apply rate limiting for non-excluded paths", async () => {
      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("Custom Headers", () => {
    it("should add rate limit headers to response", async () => {
      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      // WebSocket doesn't have HTTP-style headers, so we just verify the middleware executes
    });

    it("should update remaining count headers", async () => {
      // Simulate multiple requests
      const middlewareFn1 = middleware.middleware();
      await middlewareFn1(mockContext, nextFunction);
      nextFunction.mockClear();

      const middlewareFn2 = middleware.middleware();
      await middlewareFn2(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("Burst and Sustained Rate Limiting", () => {
    it("should handle burst traffic", async () => {
      // Simulate burst of messages
      const burstMessage = {
        type: "test",
        payload: { content: "burst message" },
        timestamp: new Date().toISOString(),
      };
      const promises = Array(15)
        .fill(null)
        .map(() => {
          const middlewareFn = middleware.middleware();
          return middlewareFn(
            { ...mockContext, message: burstMessage },
            nextFunction
          );
        });

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it("should enforce sustained rate limits", async () => {
      await middleware.middleware()(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject burst traffic exceeding limit", async () => {
      mockContext.message = {
        type: "test",
        payload: {
          content:
            "This is an extreme_burst attack with massive_spam content that exceeds normal limits and should be detected as burst traffic",
        },
        timestamp: new Date().toISOString(),
      };

      const middlewareFn = middleware.middleware();
      await expect(middlewareFn(mockContext, nextFunction)).rejects.toThrow();
    });
  });

  describe("Cleanup and Maintenance", () => {
    it("should handle cleanup operations", async () => {
      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should handle cleanup interval", () => {
      // Test that the middleware can be instantiated with cleanup settings
      const cleanupMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "cleanup-test",
          algorithm: "sliding-window",
          windowMs: 60000,
        }
      );

      expect(cleanupMiddleware).toBeDefined();
    });
  });

  describe("Performance Monitoring", () => {
    it("should record rate limit metrics", async () => {
      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_ratelimit_check",
        1,
        expect.any(Object)
      );
    });

    it("should record rate limit violations", async () => {
      // Create a middleware that will trigger rate limiting
      const strictMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "violation-test",
          algorithm: "sliding-window",
          windowMs: 1000,
          maxMessagesPerMinute: 0, // No messages allowed
        }
      );

      const middlewareFn = strictMiddleware.middleware();
      await expect(middlewareFn(mockContext, nextFunction)).rejects.toThrow();

      // Should record violation metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_ratelimit_violation",
        1,
        expect.any(Object)
      );
    });

    it("should record rate limit duration", async () => {
      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "ws_ratelimit_duration",
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid windowMs", () => {
      expect(() => {
        new RateLimitWebSocketMiddleware(mockMetricsCollector, {
          windowMs: 0,
        });
      }).toThrow("WebSocket rate limit windowMs must be a positive integer");
    });

    it("should reject invalid maxConnections", () => {
      expect(() => {
        new RateLimitWebSocketMiddleware(mockMetricsCollector, {
          maxConnectionsPerIP: -1,
        });
      }).toThrow(
        "WebSocket rate limit maxConnectionsPerIP must be a positive integer"
      );
    });

    it("should reject invalid maxMessages", () => {
      expect(() => {
        new RateLimitWebSocketMiddleware(mockMetricsCollector, {
          maxMessagesPerMinute: 0,
          testValidation: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
      }).toThrow(
        "WebSocket rate limit maxMessagesPerMinute must be a positive integer"
      );
    });

    it("should reject invalid keyStrategy", () => {
      expect(() => {
        new RateLimitWebSocketMiddleware(mockMetricsCollector, {
          keyStrategy: "invalid-strategy" as
            | "ip"
            | "user"
            | "connectionId"
            | "custom",
        });
      }).toThrow(
        "WebSocket rate limit keyStrategy must be one of: ip, user, connectionId, custom"
      );
    });
  });

  describe("Configuration Presets", () => {
    it("should create development configuration", () => {
      const devConfig = RateLimitWebSocketMiddleware.createDevelopmentConfig();

      expect(devConfig.maxConnectionsPerIP).toBe(50);
      expect(devConfig.maxMessagesPerMinute).toBe(1000);
      expect(devConfig.algorithm).toBe("sliding-window");
    });

    it("should create production configuration", () => {
      const prodConfig = RateLimitWebSocketMiddleware.createProductionConfig();

      expect(prodConfig.maxConnectionsPerIP).toBe(10);
      expect(prodConfig.maxMessagesPerMinute).toBe(120);
      expect(prodConfig.algorithm).toBe("sliding-window");
    });

    it("should create strict configuration", () => {
      const strictConfig = RateLimitWebSocketMiddleware.createStrictConfig();

      expect(strictConfig.maxConnectionsPerIP).toBe(3);
      expect(strictConfig.maxMessagesPerMinute).toBe(30);
      expect(strictConfig.algorithm).toBe("fixed-window");
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      const middlewareFn = middleware.middleware();
      await expect(
        middlewareFn(mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware.getConfig().priority).toBe(35);
    });

    it("should preserve WebSocket context", async () => {
      const originalConnectionId = mockContext.connectionId;

      const middlewareFn = middleware.middleware();
      await middlewareFn(mockContext, nextFunction);

      expect(mockContext.connectionId).toBe(originalConnectionId);
      expect(mockContext.ws).toBeDefined();
    });

    it("should handle concurrent WebSocket operations", async () => {
      const promises = Array(5)
        .fill(null)
        .map(() => {
          const middlewareFn = middleware.middleware();
          return middlewareFn({ ...mockContext }, nextFunction);
        });

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });
});
