/**
 * @fileoverview Comprehensive unit tests for AuthWebSocketMiddleware
 * @description Tests WebSocket authentication, token validation, and session management
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { AuthWebSocketMiddleware } from "../../src/middleware/auth/auth.websocket.middleware";
import { WebSocketContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("AuthWebSocketMiddleware", () => {
  let middleware: AuthWebSocketMiddleware;
  let mockContext: WebSocketContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance with comprehensive configuration
    middleware = new AuthWebSocketMiddleware(mockMetricsCollector, {
      name: "test-ws-auth",
      enabled: true,
      priority: 30,
      requireAuth: true,
      tokenTypes: ["bearer", "api-key"],
      validateToken: true,
      validatePermissions: true,
      sessionTimeout: 3600000, // 1 hour
      maxConcurrentConnections: 100,
      rateLimitPerUser: 100,
      rateLimitWindow: 60000, // 1 minute
      allowedOrigins: ["localhost:3000", "example.com"],
      excludePaths: ["/health-ws", "/public-ws"],
      customHeaders: {
        "x-api-version": "1.0",
      },
    });

    // Create mock WebSocket context
    mockContext = {
      requestId: "ws-test-request-123",
      connectionId: "ws-conn-456",
      request: {
        method: "GET",
        url: "/ws/chat",
        headers: {
          upgrade: "websocket",
          connection: "upgrade",
          "sec-websocket-key": "test-key",
          "sec-websocket-version": "13",
          authorization: "Bearer valid-jwt-token",
          "x-api-key": "valid-api-key",
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
      user: undefined,
      session: undefined,
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
      const defaultMiddleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        {}
      );

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("ws-auth");
      expect(defaultMiddleware["config"].requireAuth).toBe(true);
      expect(defaultMiddleware["config"].tokenTypes).toEqual(["bearer"]);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-ws-auth");
      expect(middleware["config"].requireAuth).toBe(true);
      expect(middleware["config"].tokenTypes).toEqual(["bearer", "api-key"]);
      expect(middleware["config"].sessionTimeout).toBe(3600000);
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new AuthWebSocketMiddleware(mockMetricsCollector, {
          sessionTimeout: -1,
        });
      }).toThrow("WebSocket Auth sessionTimeout must be a positive number");
    });
  });

  describe("Token Validation", () => {
    it("should validate Bearer token successfully", async () => {
      // Mock successful token validation
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({
          userId: "user-123",
          role: "user",
          permissions: ["read", "write"],
        });

      await middleware["execute"](mockContext, nextFunction);

      expect(validateTokenSpy).toHaveBeenCalledWith("valid-jwt-token");
      expect(mockContext.user).toEqual({
        userId: "user-123",
        role: "user",
        permissions: ["read", "write"],
      });
    });

    it("should validate API key successfully", async () => {
      // Remove Bearer token, keep API key
      delete mockContext.request.headers.authorization;
      mockContext.request.headers["x-api-key"] = "valid-api-key";

      const validateApiKeySpy = jest
        .spyOn(middleware as any, "validateApiKey")
        .mockResolvedValue({
          userId: "api-user-456",
          role: "service",
          permissions: ["read"],
        });

      await middleware["execute"](mockContext, nextFunction);

      expect(validateApiKeySpy).toHaveBeenCalledWith("valid-api-key");
      expect(mockContext.user).toEqual({
        userId: "api-user-456",
        role: "service",
        permissions: ["read"],
      });
    });

    it("should reject invalid Bearer token", async () => {
      mockContext.request.headers.authorization = "Bearer invalid-token";

      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockRejectedValue(new Error("Invalid token"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Invalid token");

      expect(mockContext.set.status).toBe(401);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4001,
        "Authentication failed"
      );
    });

    it("should reject invalid API key", async () => {
      delete mockContext.request.headers.authorization;
      mockContext.request.headers["x-api-key"] = "invalid-key";

      const validateApiKeySpy = jest
        .spyOn(middleware as any, "validateApiKey")
        .mockRejectedValue(new Error("Invalid API key"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Invalid API key");

      expect(mockContext.set.status).toBe(401);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4001,
        "Authentication failed"
      );
    });

    it("should handle missing authentication", async () => {
      delete mockContext.request.headers.authorization;
      delete mockContext.request.headers["x-api-key"];

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Authentication required");

      expect(mockContext.set.status).toBe(401);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4001,
        "Authentication required"
      );
    });
  });

  describe("Origin Validation", () => {
    it("should accept allowed origin", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      await middleware["execute"](mockContext, nextFunction);

      expect(validateTokenSpy).toHaveBeenCalled();
    });

    it("should reject disallowed origin", async () => {
      mockContext.request.headers.origin = "http://malicious-site.com";

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

      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      await middleware["execute"](mockContext, nextFunction);

      expect(validateTokenSpy).toHaveBeenCalled();
    });
  });

  describe("Path Exclusion", () => {
    it("should skip authentication for excluded paths", async () => {
      mockContext.path = "/health-ws";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.user).toBeUndefined();
      expect(nextFunction).toHaveBeenCalled();
    });

    it("should require authentication for non-excluded paths", async () => {
      mockContext.path = "/ws/chat";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Authentication required");
    });
  });

  describe("Session Management", () => {
    it("should create session on successful authentication", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({
          userId: "user-123",
          role: "user",
        });

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.session).toBeDefined();
      expect(mockContext.session?.userId).toBe("user-123");
      expect(mockContext.session?.createdAt).toBeInstanceOf(Date);
      expect(mockContext.session?.expiresAt).toBeInstanceOf(Date);
    });

    it("should validate session timeout", async () => {
      const pastDate = new Date(Date.now() - 7200000); // 2 hours ago
      mockContext.session = {
        sessionId: "expired-session",
        userId: "user-123",
        createdAt: pastDate,
        expiresAt: pastDate,
        data: {},
      };

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Session expired");

      expect(mockContext.set.status).toBe(401);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4001,
        "Session expired"
      );
    });

    it("should handle session refresh", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      mockContext.session = {
        sessionId: "valid-session",
        userId: "user-123",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 1800000), // 30 minutes from now
        data: { lastActivity: new Date() },
      };

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.session?.data.lastActivity).toBeInstanceOf(Date);
    });
  });

  describe("Permission Validation", () => {
    it("should validate user permissions", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({
          userId: "user-123",
          role: "user",
          permissions: ["read"],
        });

      const validatePermissionsSpy = jest
        .spyOn(middleware as any, "validatePermissions")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(validatePermissionsSpy).toHaveBeenCalledWith(
        { userId: "user-123", role: "user", permissions: ["read"] },
        mockContext
      );
    });

    it("should reject insufficient permissions", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({
          userId: "user-123",
          role: "user",
          permissions: ["read"],
        });

      const validatePermissionsSpy = jest
        .spyOn(middleware as any, "validatePermissions")
        .mockRejectedValue(new Error("Insufficient permissions"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Insufficient permissions");

      expect(mockContext.set.status).toBe(403);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4003,
        "Insufficient permissions"
      );
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce per-user rate limits", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      // Mock rate limit check
      const checkRateLimitSpy = jest
        .spyOn(middleware as any, "checkRateLimit")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(checkRateLimitSpy).toHaveBeenCalledWith("user-123", mockContext);
    });

    it("should reject rate limited requests", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

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
  });

  describe("Concurrent Connection Limits", () => {
    it("should enforce maximum concurrent connections per user", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      const checkConcurrentConnectionsSpy = jest
        .spyOn(middleware as any, "checkConcurrentConnections")
        .mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(checkConcurrentConnectionsSpy).toHaveBeenCalledWith(
        "user-123",
        mockContext
      );
    });

    it("should reject connections exceeding limit", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      const checkConcurrentConnectionsSpy = jest
        .spyOn(middleware as any, "checkConcurrentConnections")
        .mockRejectedValue(new Error("Maximum connections exceeded"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Maximum connections exceeded");

      expect(mockContext.set.status).toBe(429);
      expect(mockContext.websocket.close).toHaveBeenCalledWith(
        4004,
        "Maximum connections exceeded"
      );
    });
  });

  describe("Custom Headers", () => {
    it("should add custom headers to response", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["x-api-version"]).toBe("1.0");
    });

    it("should handle empty custom headers", async () => {
      const noHeadersMiddleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        {
          customHeaders: {},
        }
      );

      const validateTokenSpy = jest
        .spyOn(noHeadersMiddleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      await noHeadersMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["x-api-version"]).toBeUndefined();
    });
  });

  describe("WebSocket Upgrade Handling", () => {
    it("should handle WebSocket upgrade request", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.status).toBe(101);
      expect(mockContext.set.headers.upgrade).toBe("websocket");
      expect(mockContext.set.headers.connection).toBe("upgrade");
    });

    it("should reject non-WebSocket upgrade requests", async () => {
      mockContext.request.headers.upgrade = "http";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("WebSocket upgrade required");

      expect(mockContext.set.status).toBe(400);
    });

    it("should validate WebSocket version", async () => {
      mockContext.request.headers["sec-websocket-version"] = "12";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Unsupported WebSocket version");

      expect(mockContext.set.status).toBe(400);
    });
  });

  describe("Performance Monitoring", () => {
    it("should record authentication metrics", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_auth_success",
        1,
        expect.any(Object)
      );
    });

    it("should record authentication failure metrics", async () => {
      mockContext.request.headers.authorization = "Bearer invalid-token";

      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockRejectedValue(new Error("Invalid token"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "ws_auth_failure",
        1,
        expect.any(Object)
      );
    });

    it("should record authentication duration", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "ws_auth_duration",
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid sessionTimeout", () => {
      expect(() => {
        new AuthWebSocketMiddleware(mockMetricsCollector, {
          sessionTimeout: 0,
        });
      }).toThrow("WebSocket Auth sessionTimeout must be a positive number");
    });

    it("should reject invalid maxConcurrentConnections", () => {
      expect(() => {
        new AuthWebSocketMiddleware(mockMetricsCollector, {
          maxConcurrentConnections: -1,
        });
      }).toThrow(
        "WebSocket Auth maxConcurrentConnections must be a positive integer"
      );
    });

    it("should reject invalid rateLimitPerUser", () => {
      expect(() => {
        new AuthWebSocketMiddleware(mockMetricsCollector, {
          rateLimitPerUser: 0,
        });
      }).toThrow("WebSocket Auth rateLimitPerUser must be a positive integer");
    });

    it("should reject invalid excludePaths", () => {
      expect(() => {
        new AuthWebSocketMiddleware(mockMetricsCollector, {
          excludePaths: ["invalid-path"],
        });
      }).toThrow("WebSocket Auth excludePaths must start with '/'");
    });
  });

  describe("Configuration Presets", () => {
    it("should create development configuration", () => {
      const devConfig = AuthWebSocketMiddleware.createDevelopmentConfig();

      expect(devConfig.requireAuth).toBe(false);
      expect(devConfig.validateToken).toBe(false);
      expect(devConfig.sessionTimeout).toBe(86400000); // 24 hours
    });

    it("should create production configuration", () => {
      const prodConfig = AuthWebSocketMiddleware.createProductionConfig();

      expect(prodConfig.requireAuth).toBe(true);
      expect(prodConfig.validateToken).toBe(true);
      expect(prodConfig.validatePermissions).toBe(true);
      expect(prodConfig.sessionTimeout).toBe(3600000); // 1 hour
    });

    it("should create minimal configuration", () => {
      const minimalConfig = AuthWebSocketMiddleware.createMinimalConfig();

      expect(minimalConfig.requireAuth).toBe(true);
      expect(minimalConfig.validateToken).toBe(true);
      expect(minimalConfig.validatePermissions).toBe(false);
      expect(minimalConfig.maxConcurrentConnections).toBe(10);
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(30);
    });

    it("should preserve WebSocket context", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      const originalConnectionId = mockContext.connectionId;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.connectionId).toBe(originalConnectionId);
      expect(mockContext.websocket).toBeDefined();
    });

    it("should handle concurrent WebSocket connections", async () => {
      const validateTokenSpy = jest
        .spyOn(middleware as any, "validateBearerToken")
        .mockResolvedValue({ userId: "user-123" });

      const promises = Array(5)
        .fill(null)
        .map(() => middleware["execute"]({ ...mockContext }, nextFunction));

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });
});
