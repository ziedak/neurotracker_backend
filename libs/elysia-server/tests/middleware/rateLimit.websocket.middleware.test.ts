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
import { RateLimitWebSocketMiddleware } from "../../src/middleware/websocket/rateLimit.websocket.middleware";
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
      windowMs: 60000, // 1 minute
      maxConnections: 10,
      maxMessages: 100,
      maxMessageSize: 1024,
      burstLimit: 20,
      sustainedRate: 10,
      connectionRate: 5,
      messageRate: 50,
      cleanupInterval: 300000, // 5 minutes
      excludePaths: ["/health-ws", "/public-ws"],
      customHeaders: {
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "99",
        "x-ratelimit-reset": "60",
      },
      whitelist: ["admin-user-123"],
      blacklist: ["banned-user-456"],
      ipWhitelist: ["127.0.0.1", "192.168.1.0/24"],
      ipBlacklist: ["10.0.0.1"],
      userAgentFilter: ["bot", "crawler"],
      customLabels: {
        environment: "test",
        service: "websocket",
      },
    });

    // Create mock WebSocket context
    mockContext = {
      requestId: "ws-rl-test-123",
      connectionId: "ws-conn-456",
      request: {
        method: "GET",
        url: "/ws/chat",
        headers: {
          upgrade: "websocket",
          connection: "upgrade",
          "sec-websocket-key": "test-key",
          "user-agent": "Mozilla/5.0 (compatible)",
          origin: "http://localhost:3000",
        },
        query: { room: "general" },
        params: {},
        ip: "192.168.1.1",
      },
      response: {
        status: 101,
        headers: { upgrade: "websocket" },
      },
      set: {
        status: 101,
        headers: {
          upgrade: "websocket",
          connection: "upgrade",
          "sec-websocket-accept": "test-accept-key",
        },
      },
      user: {
        userId: "user-123",
        role: "user",
        permissions: ["read", "write"],
      },
      session: {
        sessionId: "session-789",
        userId: "user-123",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
        data: {},
      },
      validated: {},
      path: "/ws/chat",
      websocket: {
        send: jest.fn(),
        close: jest.fn(),
        ping: jest.fn(),
        pong: jest.fn(),
        data: {},
        isAlive: true,
        readyState: 1,
      },
      message: undefined,
      isBinary: false,
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
      expect(defaultMiddleware["config"].name).toBe("ws-ratelimit");
      expect(defaultMiddleware["config"].algorithm).toBe("fixed-window");
      expect(defaultMiddleware["config"].windowMs).toBe(60000);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-ws-ratelimit");
      expect(middleware["config"].algorithm).toBe("sliding-window");
      expect(middleware["config"].maxConnections).toBe(10);
      expect(middleware["config"].maxMessages).toBe(100);
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
      const checkConnectionRateSpy = jest
        .spyOn(middleware as any, "checkConnectionRate")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(checkConnectionRateSpy).toHaveBeenCalledWith(mockContext);
      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject connections exceeding rate limit", async () => {
      const checkConnectionRateSpy = jest
        .spyOn(middleware as any, "checkConnectionRate")
        .mockRejectedValue(new Error("Connection rate limit exceeded"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Connection rate limit exceeded");

      expect(mockContext.set.status).toBe(429);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4004,
        "Connection rate limit exceeded"
      );
    });

    it("should enforce maximum concurrent connections per user", async () => {
      const checkConcurrentConnectionsSpy = jest
        .spyOn(middleware as any, "checkConcurrentConnections")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(checkConcurrentConnectionsSpy).toHaveBeenCalledWith(
        "user-123",
        mockContext
      );
    });

    it("should reject connections exceeding concurrent limit", async () => {
      const checkConcurrentConnectionsSpy = jest
        .spyOn(middleware as any, "checkConcurrentConnections")
        .mockRejectedValue(
          new Error("Maximum concurrent connections exceeded")
        );

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Maximum concurrent connections exceeded");

      expect(mockContext.set.status).toBe(429);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4004,
        "Maximum concurrent connections exceeded"
      );
    });
  });

  describe("Message Rate Limiting", () => {
    it("should allow messages within rate limit", async () => {
      const checkMessageRateSpy = jest
        .spyOn(middleware as any, "checkMessageRate")
        .mockResolvedValue(true);

      mockContext.message = "test message";

      await middleware["execute"](mockContext, nextFunction);

      expect(checkMessageRateSpy).toHaveBeenCalledWith("user-123", mockContext);
    });

    it("should reject messages exceeding rate limit", async () => {
      const checkMessageRateSpy = jest
        .spyOn(middleware as any, "checkMessageRate")
        .mockRejectedValue(new Error("Message rate limit exceeded"));

      mockContext.message = "test message";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Message rate limit exceeded");

      expect(mockContext.set.status).toBe(429);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4004,
        "Message rate limit exceeded"
      );
    });

    it("should handle different message sizes", async () => {
      const checkMessageSizeSpy = jest
        .spyOn(middleware as any, "checkMessageSize")
        .mockResolvedValue(true);

      mockContext.message = "x".repeat(500); // 500 bytes

      await middleware["execute"](mockContext, nextFunction);

      expect(checkMessageSizeSpy).toHaveBeenCalledWith(500, mockContext);
    });

    it("should reject messages exceeding size limit", async () => {
      const checkMessageSizeSpy = jest
        .spyOn(middleware as any, "checkMessageSize")
        .mockRejectedValue(new Error("Message size limit exceeded"));

      mockContext.message = "x".repeat(2000); // 2000 bytes

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Message size limit exceeded");

      expect(mockContext.set.status).toBe(413);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4005,
        "Message size limit exceeded"
      );
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

      const checkFixedWindowSpy = jest
        .spyOn(fixedWindowMiddleware as any, "checkFixedWindow")
        .mockResolvedValue(true);

      await fixedWindowMiddleware["execute"](mockContext, nextFunction);

      expect(checkFixedWindowSpy).toHaveBeenCalled();
    });

    it("should apply sliding-window algorithm", async () => {
      const slidingWindowMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          algorithm: "sliding-window",
        }
      );

      const checkSlidingWindowSpy = jest
        .spyOn(slidingWindowMiddleware as any, "checkSlidingWindow")
        .mockResolvedValue(true);

      await slidingWindowMiddleware["execute"](mockContext, nextFunction);

      expect(checkSlidingWindowSpy).toHaveBeenCalled();
    });

    it("should apply token-bucket algorithm", async () => {
      const tokenBucketMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          algorithm: "token-bucket",
        }
      );

      const checkTokenBucketSpy = jest
        .spyOn(tokenBucketMiddleware as any, "checkTokenBucket")
        .mockResolvedValue(true);

      await tokenBucketMiddleware["execute"](mockContext, nextFunction);

      expect(checkTokenBucketSpy).toHaveBeenCalled();
    });

    it("should apply leaky-bucket algorithm", async () => {
      const leakyBucketMiddleware = new RateLimitWebSocketMiddleware(
        mockMetricsCollector,
        {
          algorithm: "leaky-bucket",
        }
      );

      const checkLeakyBucketSpy = jest
        .spyOn(leakyBucketMiddleware as any, "checkLeakyBucket")
        .mockResolvedValue(true);

      await leakyBucketMiddleware["execute"](mockContext, nextFunction);

      expect(checkLeakyBucketSpy).toHaveBeenCalled();
    });
  });

  describe("User and IP Filtering", () => {
    it("should allow whitelisted users", async () => {
      mockContext.user!.userId = "admin-user-123";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject blacklisted users", async () => {
      mockContext.user!.userId = "banned-user-456";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("User is blacklisted");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "User is blacklisted"
      );
    });

    it("should allow whitelisted IPs", async () => {
      mockContext.request.ip = "127.0.0.1";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject blacklisted IPs", async () => {
      mockContext.request.ip = "10.0.0.1";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("IP is blacklisted");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "IP is blacklisted"
      );
    });

    it("should filter by user agent", async () => {
      mockContext.request.headers["user-agent"] = "Googlebot/2.1";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("User agent is filtered");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "User agent is filtered"
      );
    });
  });

  describe("Path Exclusion", () => {
    it("should skip rate limiting for excluded paths", async () => {
      mockContext.path = "/health-ws";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      // Should not check rate limits for excluded paths
    });

    it("should apply rate limiting for non-excluded paths", async () => {
      mockContext.path = "/ws/chat";

      const checkConnectionRateSpy = jest
        .spyOn(middleware as any, "checkConnectionRate")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(checkConnectionRateSpy).toHaveBeenCalled();
    });
  });

  describe("Custom Headers", () => {
    it("should add rate limit headers to response", async () => {
      const checkConnectionRateSpy = jest
        .spyOn(middleware as any, "checkConnectionRate")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["x-ratelimit-limit"]).toBe("100");
      expect(mockContext.set.headers["x-ratelimit-remaining"]).toBe("99");
      expect(mockContext.set.headers["x-ratelimit-reset"]).toBe("60");
    });

    it("should update remaining count headers", async () => {
      const checkConnectionRateSpy = jest
        .spyOn(middleware as any, "checkConnectionRate")
        .mockResolvedValue(true);

      // Simulate multiple requests
      await middleware["execute"](mockContext, nextFunction);
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["x-ratelimit-remaining"]).toBe("98");
    });
  });

  describe("Burst and Sustained Rate Limiting", () => {
    it("should handle burst traffic", async () => {
      const checkBurstRateSpy = jest
        .spyOn(middleware as any, "checkBurstRate")
        .mockResolvedValue(true);

      // Simulate burst of messages
      const promises = Array(15)
        .fill(null)
        .map(() =>
          middleware["execute"](
            { ...mockContext, message: "burst message" },
            nextFunction
          )
        );

      await expect(Promise.all(promises)).resolves.not.toThrow();

      expect(checkBurstRateSpy).toHaveBeenCalled();
    });

    it("should enforce sustained rate limits", async () => {
      const checkSustainedRateSpy = jest
        .spyOn(middleware as any, "checkSustainedRate")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(checkSustainedRateSpy).toHaveBeenCalled();
    });

    it("should reject burst traffic exceeding limit", async () => {
      const checkBurstRateSpy = jest
        .spyOn(middleware as any, "checkBurstRate")
        .mockRejectedValue(new Error("Burst rate limit exceeded"));

      mockContext.message = "burst message";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Burst rate limit exceeded");
    });
  });

  describe("Cleanup and Maintenance", () => {
    it("should cleanup expired rate limit data", async () => {
      const cleanupSpy = jest
        .spyOn(middleware as any, "cleanupExpiredData")
        .mockResolvedValue(undefined);

      await middleware["execute"](mockContext, nextFunction);

      expect(cleanupSpy).toHaveBeenCalled();
    });

    it("should handle cleanup interval", () => {
      jest.useFakeTimers();

      const cleanupSpy = jest.spyOn(middleware as any, "cleanupExpiredData");

      // Fast-forward time to trigger cleanup
      jest.advanceTimersByTime(300000); // 5 minutes

      expect(cleanupSpy).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe("Performance Monitoring", () => {
    it("should record rate limit metrics", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_ratelimit_check",
        1,
        expect.any(Object)
      );
    });

    it("should record rate limit violations", async () => {
      const checkConnectionRateSpy = jest
        .spyOn(middleware as any, "checkConnectionRate")
        .mockRejectedValue(new Error("Rate limit exceeded"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_ratelimit_violation",
        1,
        expect.any(Object)
      );
    });

    it("should record rate limit duration", async () => {
      await middleware["execute"](mockContext, nextFunction);

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
      }).toThrow("WebSocket RateLimit windowMs must be a positive number");
    });

    it("should reject invalid maxConnections", () => {
      expect(() => {
        new RateLimitWebSocketMiddleware(mockMetricsCollector, {
          maxConnections: -1,
        });
      }).toThrow(
        "WebSocket RateLimit maxConnections must be a positive integer"
      );
    });

    it("should reject invalid maxMessages", () => {
      expect(() => {
        new RateLimitWebSocketMiddleware(mockMetricsCollector, {
          maxMessages: 0,
        });
      }).toThrow("WebSocket RateLimit maxMessages must be a positive integer");
    });

    it("should reject invalid algorithm", () => {
      expect(() => {
        new RateLimitWebSocketMiddleware(mockMetricsCollector, {
          algorithm: "invalid" as any,
        });
      }).toThrow(
        "WebSocket RateLimit algorithm must be one of: fixed-window, sliding-window, token-bucket, leaky-bucket"
      );
    });

    it("should reject invalid excludePaths", () => {
      expect(() => {
        new RateLimitWebSocketMiddleware(mockMetricsCollector, {
          excludePaths: ["invalid-path"],
        });
      }).toThrow("WebSocket RateLimit excludePaths must start with '/'");
    });
  });

  describe("Configuration Presets", () => {
    it("should create development configuration", () => {
      const devConfig = RateLimitWebSocketMiddleware.createDevelopmentConfig();

      expect(devConfig.maxConnections).toBe(100);
      expect(devConfig.maxMessages).toBe(1000);
      expect(devConfig.algorithm).toBe("fixed-window");
    });

    it("should create production configuration", () => {
      const prodConfig = RateLimitWebSocketMiddleware.createProductionConfig();

      expect(prodConfig.maxConnections).toBe(10);
      expect(prodConfig.maxMessages).toBe(100);
      expect(prodConfig.algorithm).toBe("sliding-window");
    });

    it("should create strict configuration", () => {
      const strictConfig = RateLimitWebSocketMiddleware.createStrictConfig();

      expect(strictConfig.maxConnections).toBe(5);
      expect(strictConfig.maxMessages).toBe(50);
      expect(strictConfig.algorithm).toBe("token-bucket");
    });

    it("should create lenient configuration", () => {
      const lenientConfig = RateLimitWebSocketMiddleware.createLenientConfig();

      expect(lenientConfig.maxConnections).toBe(50);
      expect(lenientConfig.maxMessages).toBe(500);
      expect(lenientConfig.algorithm).toBe("leaky-bucket");
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      const checkConnectionRateSpy = jest
        .spyOn(middleware as any, "checkConnectionRate")
        .mockResolvedValue(true);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(35);
    });

    it("should preserve WebSocket context", async () => {
      const checkConnectionRateSpy = jest
        .spyOn(middleware as any, "checkConnectionRate")
        .mockResolvedValue(true);

      const originalConnectionId = mockContext.connectionId;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.connectionId).toBe(originalConnectionId);
      expect(mockContext.websocket).toBeDefined();
    });

    it("should handle concurrent WebSocket operations", async () => {
      const checkConnectionRateSpy = jest
        .spyOn(middleware as any, "checkConnectionRate")
        .mockResolvedValue(true);

      const promises = Array(5)
        .fill(null)
        .map(() => middleware["execute"]({ ...mockContext }, nextFunction));

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });
});
