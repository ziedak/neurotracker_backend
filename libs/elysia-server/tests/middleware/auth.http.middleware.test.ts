/**
 * @fileoverview Comprehensive unit tests for AuthHttpMiddleware
 * @description Tests authentication, authorization, and session management
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { AuthenticationService, User } from "@libs/auth";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";
import { AuthHttpMiddleware } from "../../src/middleware/auth/auth.http.middleware";

// Mock dependencies
const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

const mockAuthService = {
  verifyToken: jest.fn(),
  refreshToken: jest.fn(),
  getUserById: jest.fn(),
  can: jest.fn(),
  getUserPermissions: jest.fn(),
  getJWTService: jest.fn(),
  getSessionService: jest.fn(),
  getApiKeyService: jest.fn(),
  getPermissionService: jest.fn(),
  getKeycloakService: jest.fn(),
  healthCheck: jest.fn(),
} as jest.Mocked<AuthenticationService>;

const mockRedisClient = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  keys: jest.fn(),
  flush: jest.fn(),
  ping: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  isConnected: jest.fn(),
  getStats: jest.fn(),
};

// Mock the auth service
jest.mock("@libs/auth", () => ({
  AuthService: jest.fn().mockImplementation(() => mockAuthService),
}));

// Mock the database clients
jest.mock("@libs/database", () => ({
  RedisClient: jest.fn().mockImplementation(() => mockRedisClient),
}));

describe("AuthHttpMiddleware", () => {
  let middleware: AuthHttpMiddleware;
  let mockContext: MiddlewareContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance
    middleware = new AuthHttpMiddleware(mockMetricsCollector, mockAuthService, {
      name: "test-auth",
      enabled: true,
      priority: 5,
      requireAuth: true,
      bypassRoutes: ["/health", "/login", "/register"],
      jwtAuth: true,
      apiKeyAuth: true,
      sessionAuth: false,
      allowAnonymous: false,
      strictMode: false,
      extractUserInfo: true,
    });

    // Create mock context
    mockContext = {
      requestId: "test-request-123",
      request: {
        method: "GET",
        url: "/api/users",
        headers: {
          authorization: "Bearer valid-jwt-token",
          "user-agent": "test-agent",
          "x-forwarded-for": "192.168.1.1",
        },
        body: {},
        query: {},
        params: {},
        ip: "192.168.1.1",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { message: "success" },
      },
      set: {
        status: 200,
        headers: { "content-type": "application/json" },
      },
      user: undefined,
      session: undefined,
      validated: {},
      path: "/api/users",
    };

    nextFunction = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("Middleware Initialization", () => {
    it("should initialize with default configuration", () => {
      const defaultMiddleware = new AuthHttpMiddleware(
        mockMetricsCollector,
        mockAuthService
      );

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("auth");
      expect(defaultMiddleware["config"].requireAuth).toBe(true);
      expect(defaultMiddleware["config"].bypassRoutes).toEqual([
        "/health",
        "/login",
        "/register",
      ]);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-auth");
      expect(middleware["config"].requireAuth).toBe(true);
      expect(middleware["config"].jwtAuth).toBe(true);
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new AuthHttpMiddleware(mockMetricsCollector, mockAuthService, {
          jwtAuth: false,
          apiKeyAuth: false,
          sessionAuth: false, // Invalid - no auth method enabled
        });
      }).toThrow("At least one authentication method must be enabled");
    });
  });

  describe("Token Authentication", () => {
    it("should authenticate valid JWT token", async () => {
      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      mockAuthService.verifyToken.mockResolvedValue(mockUser);

      await middleware["execute"](mockContext, nextFunction);

      expect(mockAuthService.verifyToken).toHaveBeenCalledWith(
        "valid-jwt-token"
      );
      expect(mockContext.user).toEqual(mockUser);
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_token_valid",
        1,
        expect.any(Object)
      );
    });

    it("should handle missing authorization header", async () => {
      delete mockContext.request.headers.authorization;

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Missing authorization header");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_missing_token",
        1,
        expect.any(Object)
      );
    });

    it("should handle invalid token format", async () => {
      mockContext.request.headers.authorization = "InvalidFormat token";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Invalid token format");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_invalid_token_format",
        1,
        expect.any(Object)
      );
    });

    it("should handle expired tokens", async () => {
      mockAuthService.verifyToken.mockRejectedValue(
        new Error("Token expired")
      );

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Token expired");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_token_expired",
        1,
        expect.any(Object)
      );
    });

    it("should handle invalid tokens", async () => {
      mockAuthService.verifyToken.mockRejectedValue(
        new Error("Invalid token")
      );

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Invalid token");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_token_invalid",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Public Path Handling", () => {
    it("should allow access to public paths without authentication", async () => {
      mockContext.path = "/health";
      delete mockContext.request.headers.authorization;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockAuthService.verifyToken).not.toHaveBeenCalled();
      expect(mockContext.user).toBeUndefined();
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_public_path_access",
        1,
        expect.any(Object)
      );
    });

    it("should allow access to login endpoint", async () => {
      mockContext.path = "/login";
      mockContext.request.method = "POST";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockAuthService.verifyToken).not.toHaveBeenCalled();
    });

    it("should allow access to register endpoint", async () => {
      mockContext.path = "/register";
      mockContext.request.method = "POST";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockAuthService.verifyToken).not.toHaveBeenCalled();
    });
  });

  describe("Session Management", () => {
    it("should create session for authenticated user", async () => {
      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      const mockSession = {
        id: "session-123",
        userId: "user-123",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockAuthService.verifyToken.mockResolvedValue(mockUser);
      mockAuthService.getSessionService().createSession?.mockResolvedValue(mockSession);

      await middleware["execute"](mockContext, nextFunction);

      expect(mockAuthService.getSessionService().createSession).toHaveBeenCalledWith(
        mockUser,
        expect.any(Number)
      );
      expect(mockContext.session).toEqual(mockSession);
    });

    it("should validate existing session", async () => {
      const mockSession = {
        id: "session-123",
        userId: "user-123",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      };

      mockAuthService.validateSession.mockResolvedValue(mockSession);

      await middleware["execute"](mockContext, nextFunction);

      expect(mockAuthService.validateSession).toHaveBeenCalledWith(
        "session-123"
      );
    });

    it("should handle session expiration", async () => {
      mockAuthService.validateSession.mockRejectedValue(
        new Error("Session expired")
      );

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Session expired");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_session_expired",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Permission Validation", () => {
    it("should validate user permissions for protected resources", async () => {
      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      mockAuthService.validateToken.mockResolvedValue(mockUser);
      mockAuthService.validatePermissions.mockResolvedValue(true);

      await middleware["execute"](mockContext, nextFunction);

      expect(mockAuthService.validatePermissions).toHaveBeenCalledWith(
        mockUser,
        "GET",
        "/api/users"
      );
    });

    it("should deny access for insufficient permissions", async () => {
      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:profile"],
        authenticated: true,
        anonymous: false,
      };

      mockAuthService.validateToken.mockResolvedValue(mockUser);
      mockAuthService.validatePermissions.mockResolvedValue(false);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Insufficient permissions");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_insufficient_permissions",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce rate limits when enabled", async () => {
      // Mock rate limit exceeded
      mockRedisClient.get.mockResolvedValue("101"); // Over the limit

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Rate limit exceeded");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_rate_limit_exceeded",
        1,
        expect.any(Object)
      );
    });

    it("should allow requests within rate limit", async () => {
      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      mockAuthService.validateToken.mockResolvedValue(mockUser);
      mockRedisClient.get.mockResolvedValue("50"); // Under the limit

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_rate_limit_allowed",
        1,
        expect.any(Object)
      );
    });

    it("should skip rate limiting when disabled", async () => {
      const noRateLimitMiddleware = new AuthHttpMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          rateLimitEnabled: false,
        }
      );

      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      mockAuthService.validateToken.mockResolvedValue(mockUser);

      await noRateLimitMiddleware["execute"](mockContext, nextFunction);

      expect(mockRedisClient.get).not.toHaveBeenCalled();
    });
  });

  describe("Token Refresh", () => {
    it("should refresh tokens when enabled and nearing expiration", async () => {
      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      const newToken = "new-refreshed-token";

      mockAuthService.validateToken.mockResolvedValue(mockUser);
      mockAuthService.refreshToken.mockResolvedValue(newToken);

      // Mock token nearing expiration (less than 5 minutes)
      mockAuthService.verifyToken.mockImplementation(() => {
        const error = new Error("Token expiring soon");
        (error as Error & { expiresIn: number }).expiresIn = 240; // 4 minutes
        throw error;
      });

      await middleware["execute"](mockContext, nextFunction);

      expect(mockAuthService.refreshToken).toHaveBeenCalledWith(
        "valid-jwt-token"
      );
    });

    it("should skip token refresh when disabled", async () => {
      const noRefreshMiddleware = new AuthHttpMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          refreshTokenEnabled: false,
        }
      );

      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      mockAuthService.validateToken.mockResolvedValue(mockUser);

      await noRefreshMiddleware["execute"](mockContext, nextFunction);

      expect(mockAuthService.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("should handle authentication service failures", async () => {
      mockAuthService.verifyToken.mockRejectedValue(
        new Error("Auth service unavailable")
      );

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Auth service unavailable");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_service_error",
        1,
        expect.any(Object)
      );
    });

    it("should handle Redis connection failures", async () => {
      mockRedisClient.get.mockRejectedValue(
        new Error("Redis connection failed")
      );

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Redis connection failed");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_redis_error",
        1,
        expect.any(Object)
      );
    });

    it("should handle malformed user data", async () => {
      mockAuthService.verifyToken.mockResolvedValue(null as User | null);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Invalid user data");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_invalid_user_data",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Performance Monitoring", () => {
    it("should record authentication duration", async () => {
      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      mockAuthService.validateToken.mockResolvedValue(mockUser);

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "auth_request_duration",
        expect.any(Number),
        expect.any(Object)
      );
    });

    it("should record successful authentications", async () => {
      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      mockAuthService.validateToken.mockResolvedValue(mockUser);

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_success",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid session timeout", () => {
      expect(() => {
        new AuthHttpMiddleware(mockMetricsCollector, mockAuthService, {
          sessionTimeout: 0,
        });
      }).toThrow("Auth sessionTimeout must be a positive integer");
    });

    it("should reject invalid rate limit window", () => {
      expect(() => {
        new AuthHttpMiddleware(mockMetricsCollector, mockAuthService, {
          rateLimitWindow: -1,
        });
      }).toThrow("Auth rateLimitWindow must be a positive integer");
    });

    it("should reject invalid rate limit max", () => {
      expect(() => {
        new AuthHttpMiddleware(mockMetricsCollector, mockAuthService, {
          rateLimitMax: 0,
        });
      }).toThrow("Auth rateLimitMax must be a positive integer");
    });

    it("should reject empty token header", () => {
      expect(() => {
        new AuthHttpMiddleware(mockMetricsCollector, mockAuthService, {
          tokenHeader: "",
        });
      }).toThrow("Auth tokenHeader cannot be empty");
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      const mockUser = {
        id: "user-123",
        email: "user@example.com",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      };

      mockAuthService.validateToken.mockResolvedValue(mockUser);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(5);
    });
  });
});
