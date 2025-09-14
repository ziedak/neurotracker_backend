/**
 * @fileoverview Comprehensive unit tests for SecurityWebSocketMiddleware
 * @description Tests WebSocket security headers, origin validation, and attack prevention
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { SecurityWebSocketMiddleware } from "../../src/middleware/websocket/security.websocket.middleware";
import { WebSocketContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("SecurityWebSocketMiddleware", () => {
  let middleware: SecurityWebSocketMiddleware;
  let mockContext: WebSocketContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance with comprehensive configuration
    middleware = new SecurityWebSocketMiddleware(mockMetricsCollector, {
      name: "test-ws-security",
      enabled: true,
      priority: 25,
      allowedOrigins: ["localhost:3000", "example.com", "*.trusted.com"],
      blockedOrigins: ["malicious.com", "*.bad.com"],
      allowedUserAgents: ["Mozilla/5.0", "Chrome/91.0"],
      blockedUserAgents: ["bot", "crawler", "scanner"],
      maxConnectionTime: 3600000, // 1 hour
      maxIdleTime: 300000, // 5 minutes
      maxMessageSize: 1024,
      rateLimitWindow: 60000, // 1 minute
      rateLimitMax: 100,
      enableOriginValidation: true,
      enableUserAgentValidation: true,
      enableRateLimiting: true,
      enableConnectionTimeout: true,
      enableMessageValidation: true,
      customSecurityHeaders: {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "x-xss-protection": "1; mode=block",
      },
      excludePaths: ["/health-ws", "/public-ws"],
      ipWhitelist: ["127.0.0.1", "192.168.1.0/24"],
      ipBlacklist: ["10.0.0.1", "172.16.0.0/16"],
      allowedProtocols: ["ws", "wss"],
      blockedPorts: [80, 8080, 9000],
      customLabels: {
        environment: "test",
        service: "websocket",
      },
    });

    // Create mock WebSocket context
    mockContext = {
      requestId: "ws-sec-test-123",
      connectionId: "ws-conn-456",
      request: {
        method: "GET",
        url: "/ws/chat",
        headers: {
          upgrade: "websocket",
          connection: "upgrade",
          "sec-websocket-key": "test-key",
          "sec-websocket-version": "13",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          origin: "http://localhost:3000",
          "sec-websocket-protocol": "chat",
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
      const defaultMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {}
      );

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("ws-security");
      expect(defaultMiddleware["config"].enableOriginValidation).toBe(true);
      expect(defaultMiddleware["config"].enableUserAgentValidation).toBe(true);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-ws-security");
      expect(middleware["config"].allowedOrigins).toEqual([
        "localhost:3000",
        "example.com",
        "*.trusted.com",
      ]);
      expect(middleware["config"].maxConnectionTime).toBe(3600000);
      expect(middleware["config"].maxMessageSize).toBe(1024);
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new SecurityWebSocketMiddleware(mockMetricsCollector, {
          maxConnectionTime: -1,
        });
      }).toThrow(
        "WebSocket Security maxConnectionTime must be a positive number"
      );
    });
  });

  describe("Origin Validation", () => {
    it("should accept allowed origins", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should accept wildcard origins", async () => {
      mockContext.request.headers.origin = "http://api.trusted.com";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject blocked origins", async () => {
      mockContext.request.headers.origin = "http://malicious.com";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Origin not allowed");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "Origin not allowed"
      );
    });

    it("should reject wildcard blocked origins", async () => {
      mockContext.request.headers.origin = "http://evil.bad.com";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Origin not allowed");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "Origin not allowed"
      );
    });

    it("should handle missing origin header", async () => {
      delete mockContext.request.headers.origin;

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Origin header required");

      expect(mockContext.set.status).toBe(400);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4000,
        "Origin header required"
      );
    });

    it("should skip origin validation when disabled", async () => {
      const noOriginValidationMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          enableOriginValidation: false,
        }
      );

      mockContext.request.headers.origin = "http://malicious.com";

      await noOriginValidationMiddleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("User Agent Validation", () => {
    it("should accept allowed user agents", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject blocked user agents", async () => {
      mockContext.request.headers["user-agent"] = "MaliciousBot/1.0";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("User agent not allowed");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "User agent not allowed"
      );
    });

    it("should handle missing user agent header", async () => {
      delete mockContext.request.headers["user-agent"];

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("User agent header required");

      expect(mockContext.set.status).toBe(400);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4000,
        "User agent header required"
      );
    });

    it("should skip user agent validation when disabled", async () => {
      const noUAValidationMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          enableUserAgentValidation: false,
        }
      );

      mockContext.request.headers["user-agent"] = "MaliciousBot/1.0";

      await noUAValidationMiddleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("IP Filtering", () => {
    it("should accept whitelisted IPs", async () => {
      mockContext.request.ip = "127.0.0.1";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should accept CIDR range IPs", async () => {
      mockContext.request.ip = "192.168.1.50";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject blacklisted IPs", async () => {
      mockContext.request.ip = "10.0.0.1";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("IP address blocked");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "IP address blocked"
      );
    });

    it("should reject CIDR range blacklisted IPs", async () => {
      mockContext.request.ip = "172.16.5.10";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("IP address blocked");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "IP address blocked"
      );
    });
  });

  describe("Protocol and Port Validation", () => {
    it("should accept allowed protocols", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject blocked ports", async () => {
      mockContext.request.url = "ws://example.com:8080/ws/chat";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Port not allowed");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "Port not allowed"
      );
    });

    it("should handle secure WebSocket connections", async () => {
      mockContext.request.url = "wss://example.com/ws/chat";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("Message Validation", () => {
    it("should accept messages within size limit", async () => {
      mockContext.message = "Valid message within size limit";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject messages exceeding size limit", async () => {
      mockContext.message = "x".repeat(2000); // Exceeds 1024 byte limit

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Message size exceeds limit");

      expect(mockContext.set.status).toBe(413);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4005,
        "Message size exceeds limit"
      );
    });

    it("should validate message content", async () => {
      const validateMessageSpy = jest
        .spyOn(middleware as any, "validateMessageContent")
        .mockResolvedValue(true);

      mockContext.message = JSON.stringify({ type: "chat", content: "Hello" });

      await middleware["execute"](mockContext, nextFunction);

      expect(validateMessageSpy).toHaveBeenCalledWith(
        mockContext.message,
        mockContext
      );
    });

    it("should reject malicious message content", async () => {
      const validateMessageSpy = jest
        .spyOn(middleware as any, "validateMessageContent")
        .mockRejectedValue(new Error("Malicious content detected"));

      mockContext.message = "<script>alert('xss')</script>";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Malicious content detected");

      expect(mockContext.set.status).toBe(400);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4000,
        "Malicious content detected"
      );
    });

    it("should skip message validation when disabled", async () => {
      const noMessageValidationMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          enableMessageValidation: false,
        }
      );

      mockContext.message = "x".repeat(2000);

      await noMessageValidationMiddleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce rate limits", async () => {
      const checkRateLimitSpy = jest
        .spyOn(middleware as any, "checkRateLimit")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(checkRateLimitSpy).toHaveBeenCalledWith(mockContext);
    });

    it("should reject requests exceeding rate limit", async () => {
      const checkRateLimitSpy = jest
        .spyOn(middleware as any, "checkRateLimit")
        .mockRejectedValue(new Error("Rate limit exceeded"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Rate limit exceeded");

      expect(mockContext.set.status).toBe(429);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4004,
        "Rate limit exceeded"
      );
    });

    it("should skip rate limiting when disabled", async () => {
      const noRateLimitMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          enableRateLimiting: false,
        }
      );

      await noRateLimitMiddleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("Connection Timeout", () => {
    it("should enforce connection time limits", async () => {
      const checkConnectionTimeoutSpy = jest
        .spyOn(middleware as any, "checkConnectionTimeout")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(checkConnectionTimeoutSpy).toHaveBeenCalledWith(mockContext);
    });

    it("should close connections exceeding time limit", async () => {
      const checkConnectionTimeoutSpy = jest
        .spyOn(middleware as any, "checkConnectionTimeout")
        .mockRejectedValue(new Error("Connection timeout exceeded"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Connection timeout exceeded");

      expect(mockContext.set.status).toBe(408);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4008,
        "Connection timeout exceeded"
      );
    });

    it("should enforce idle time limits", async () => {
      const checkIdleTimeoutSpy = jest
        .spyOn(middleware as any, "checkIdleTimeout")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(checkIdleTimeoutSpy).toHaveBeenCalledWith(mockContext);
    });

    it("should skip timeout checks when disabled", async () => {
      const noTimeoutMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          enableConnectionTimeout: false,
        }
      );

      await noTimeoutMiddleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("Security Headers", () => {
    it("should add custom security headers", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["x-content-type-options"]).toBe("nosniff");
      expect(mockContext.set.headers["x-frame-options"]).toBe("DENY");
      expect(mockContext.set.headers["x-xss-protection"]).toBe("1; mode=block");
    });

    it("should add WebSocket-specific security headers", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["sec-websocket-accept"]).toBeDefined();
      expect(mockContext.set.headers["connection"]).toBe("upgrade");
      expect(mockContext.set.headers["upgrade"]).toBe("websocket");
    });
  });

  describe("Path Exclusion", () => {
    it("should skip security checks for excluded paths", async () => {
      mockContext.path = "/health-ws";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should apply security checks for non-excluded paths", async () => {
      mockContext.path = "/ws/chat";

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe("WebSocket Upgrade Validation", () => {
    it("should validate WebSocket upgrade request", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it("should reject invalid WebSocket version", async () => {
      mockContext.request.headers["sec-websocket-version"] = "12";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Unsupported WebSocket version");

      expect(mockContext.set.status).toBe(400);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4000,
        "Unsupported WebSocket version"
      );
    });

    it("should reject missing WebSocket key", async () => {
      delete mockContext.request.headers["sec-websocket-key"];

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("WebSocket key required");

      expect(mockContext.set.status).toBe(400);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4000,
        "WebSocket key required"
      );
    });
  });

  describe("Attack Prevention", () => {
    it("should prevent WebSocket hijacking attempts", async () => {
      mockContext.request.headers["sec-websocket-protocol"] = "http";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Invalid WebSocket protocol");

      expect(mockContext.set.status).toBe(400);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4000,
        "Invalid WebSocket protocol"
      );
    });

    it("should prevent cross-site WebSocket hijacking", async () => {
      mockContext.request.headers.origin = "http://evil.com";
      mockContext.request.headers.referer = "http://evil.com/malicious";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Cross-site WebSocket hijacking detected");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "Cross-site WebSocket hijacking detected"
      );
    });

    it("should detect and prevent WebSocket injection attacks", async () => {
      mockContext.message = "\x00\x01\x02INJECTION_PAYLOAD\x03\x04";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("WebSocket injection detected");

      expect(mockContext.set.status).toBe(400);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4000,
        "WebSocket injection detected"
      );
    });
  });

  describe("Performance Monitoring", () => {
    it("should record security check metrics", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_security_check",
        1,
        expect.any(Object)
      );
    });

    it("should record security violations", async () => {
      mockContext.request.headers.origin = "http://malicious.com";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_security_violation",
        1,
        expect.any(Object)
      );
    });

    it("should record security check duration", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "ws_security_duration",
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid maxConnectionTime", () => {
      expect(() => {
        new SecurityWebSocketMiddleware(mockMetricsCollector, {
          maxConnectionTime: 0,
        });
      }).toThrow(
        "WebSocket Security maxConnectionTime must be a positive number"
      );
    });

    it("should reject invalid maxMessageSize", () => {
      expect(() => {
        new SecurityWebSocketMiddleware(mockMetricsCollector, {
          maxMessageSize: -1,
        });
      }).toThrow(
        "WebSocket Security maxMessageSize must be a positive integer"
      );
    });

    it("should reject invalid rateLimitWindow", () => {
      expect(() => {
        new SecurityWebSocketMiddleware(mockMetricsCollector, {
          rateLimitWindow: 0,
        });
      }).toThrow(
        "WebSocket Security rateLimitWindow must be a positive number"
      );
    });

    it("should reject invalid excludePaths", () => {
      expect(() => {
        new SecurityWebSocketMiddleware(mockMetricsCollector, {
          excludePaths: ["invalid-path"],
        });
      }).toThrow("WebSocket Security excludePaths must start with '/'");
    });
  });

  describe("Configuration Presets", () => {
    it("should create development configuration", () => {
      const devConfig = SecurityWebSocketMiddleware.createDevelopmentConfig();

      expect(devConfig.enableOriginValidation).toBe(false);
      expect(devConfig.enableUserAgentValidation).toBe(false);
      expect(devConfig.maxConnectionTime).toBe(86400000); // 24 hours
    });

    it("should create production configuration", () => {
      const prodConfig = SecurityWebSocketMiddleware.createProductionConfig();

      expect(prodConfig.enableOriginValidation).toBe(true);
      expect(prodConfig.enableUserAgentValidation).toBe(true);
      expect(prodConfig.enableRateLimiting).toBe(true);
      expect(prodConfig.maxConnectionTime).toBe(3600000); // 1 hour
    });

    it("should create strict configuration", () => {
      const strictConfig = SecurityWebSocketMiddleware.createStrictConfig();

      expect(strictConfig.maxMessageSize).toBe(512);
      expect(strictConfig.rateLimitMax).toBe(50);
      expect(strictConfig.maxConnectionTime).toBe(1800000); // 30 minutes
    });

    it("should create minimal configuration", () => {
      const minimalConfig = SecurityWebSocketMiddleware.createMinimalConfig();

      expect(minimalConfig.enableOriginValidation).toBe(true);
      expect(minimalConfig.enableUserAgentValidation).toBe(false);
      expect(minimalConfig.enableRateLimiting).toBe(false);
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(25);
    });

    it("should preserve WebSocket context", async () => {
      const originalConnectionId = mockContext.connectionId;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.connectionId).toBe(originalConnectionId);
      expect(mockContext.websocket).toBeDefined();
    });

    it("should handle concurrent WebSocket operations", async () => {
      const promises = Array(5)
        .fill(null)
        .map(() => middleware["execute"]({ ...mockContext }, nextFunction));

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });
});
