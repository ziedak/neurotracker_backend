/**
 * KeycloakTokenManager Unit Tests
 */

// Mock dependencies
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("@libs/database", () => ({
  CacheService: {
    create: jest.fn(() => ({
      get: jest.fn(() => ({ data: null, source: "miss" })),
      set: jest.fn(),
      invalidate: jest.fn(),
    })),
  },
}));

jest.mock("@libs/messaging", () => ({
  createHttpClient: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  })),
  HttpStatus: {
    isSuccess: jest.fn((status: number) => status >= 200 && status < 300),
  },
}));

// Import after mocks
import { TokenManager as KeycloakTokenManager } from "../../src/services/token/TokenManager";
import type { AuthV2Config } from "../../src/services/token/config";
import { KeycloakClient } from "../../src/client/KeycloakClient";
import type { AuthResult } from "../../src/types";

// Define local IMetricsCollector interface for testing
interface IMetricsCollector {
  recordCounter(
    name: string,
    value?: number,
    labels?: Record<string, string>
  ): Promise<void>;
  recordTimer(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;
  recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;
  recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
    buckets?: number[]
  ): Promise<void>;
  recordSummary(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;
  getMetrics(): Promise<string>;
  recordApiRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    service?: string
  ): Promise<void>;
  recordDatabaseOperation(
    clientType: "redis" | "postgres" | "clickhouse",
    operation: string,
    duration: number,
    success: boolean,
    service?: string
  ): Promise<void>;
  recordAuthOperation(
    operation: "login" | "register" | "refresh" | "logout",
    result: "success" | "failure" | "error",
    userRole?: string
  ): Promise<void>;
  recordWebSocketActivity(
    service: string,
    messageType: string,
    direction: "inbound" | "outbound",
    connectionCount?: number
  ): Promise<void>;
  recordNodeMetrics(service: string): Promise<void>;
  measureEventLoopLag(service: string): Promise<void>;
}

describe("KeycloakTokenManager", () => {
  let mockKeycloakClient: jest.Mocked<KeycloakClient>;
  let mockConfig: AuthV2Config;
  let mockMetrics: jest.Mocked<IMetricsCollector>;
  let tokenManager: KeycloakTokenManager;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mocks
    mockKeycloakClient = {
      validateToken: jest.fn(),
      introspectToken: jest.fn(),
    } as any;

    mockConfig = {
      jwt: {
        issuer: "https://test-keycloak.example.com/auth/realms/test",
        audience: "test-client",
        clockTolerance: 60,
      },
      cache: {
        enabled: true,
        ttl: { jwt: 300, apiKey: 600, session: 3600, userInfo: 1800 },
      },
      security: {
        constantTimeComparison: true,
        apiKeyHashRounds: 12,
        sessionRotationInterval: 86400,
      },
      session: {
        maxConcurrentSessions: 10,
        enforceIpConsistency: false,
        enforceUserAgentConsistency: false,
        tokenEncryption: true,
      },
      encryption: { key: "test-key-that-is-at-least-32-chars-long" },
    } as AuthV2Config;

    mockMetrics = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
      recordGauge: jest.fn(),
      recordHistogram: jest.fn(),
      recordSummary: jest.fn(),
      getMetrics: jest.fn(),
      recordApiRequest: jest.fn(),
      recordDatabaseOperation: jest.fn(),
      recordAuthOperation: jest.fn(),
      recordWebSocketActivity: jest.fn(),
      recordNodeMetrics: jest.fn(),
      measureEventLoopLag: jest.fn(),
    };

    // Create instance
    tokenManager = new KeycloakTokenManager(
      mockKeycloakClient,
      mockConfig,
      mockMetrics
    );

    // Initialize the token manager
    await tokenManager.initialize();
  });

  describe("constructor", () => {
    it("should initialize with cache when enabled", () => {
      const { CacheService } = require("@libs/database");
      expect(CacheService.create).toHaveBeenCalledWith(mockMetrics);
    });

    it("should initialize without cache when disabled", () => {
      const configWithoutCache = {
        ...mockConfig,
        cache: {
          enabled: false,
          ttl: { jwt: 300, apiKey: 600, session: 3600, userInfo: 1800 },
        },
      };
      // Reset mocks before this specific test
      jest.clearAllMocks();

      new KeycloakTokenManager(
        mockKeycloakClient,
        configWithoutCache,
        mockMetrics
      );

      const { CacheService } = require("@libs/database");
      expect(CacheService.create).not.toHaveBeenCalled();
    });
  });

  describe("validateJwt", () => {
    const validToken = "valid.jwt.token";
    const mockAuthResult: AuthResult = {
      success: true,
      user: {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        name: "Test User",
        roles: ["user"],
        permissions: ["read"],
      },
      token: validToken,
      scopes: ["openid", "profile"],
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    };

    beforeEach(() => {
      mockKeycloakClient.validateToken.mockResolvedValue(mockAuthResult);
    });

    it("should validate JWT successfully", async () => {
      const result = await tokenManager.validateJwt(validToken);

      expect(mockKeycloakClient.validateToken).toHaveBeenCalledWith(validToken);
      expect(result).toEqual(mockAuthResult);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.jwt_validation",
        1
      );
      expect(mockMetrics.recordTimer).toHaveBeenCalled();
    });

    it("should return cached result if available", async () => {
      const { CacheService } = require("@libs/database");
      const mockCache = CacheService.create.mock.results[0].value;
      mockCache.get.mockResolvedValue({ data: mockAuthResult, source: "hit" });

      const result = await tokenManager.validateJwt(validToken);

      expect(mockCache.get).toHaveBeenCalledWith(
        "jwt:valid.jwt.token:validation"
      );
      expect(mockKeycloakClient.validateToken).not.toHaveBeenCalled();
      expect(result).toEqual(mockAuthResult);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.jwt_validation_cache_hit",
        1
      );
    });

    it("should cache successful validation results", async () => {
      const { CacheService } = require("@libs/database");
      const mockCache = CacheService.create.mock.results[0].value;

      await tokenManager.validateJwt(validToken);

      expect(mockCache.set).toHaveBeenCalledWith(
        "jwt:valid.jwt.token:validation",
        mockAuthResult,
        300
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.jwt_validation_cache_set",
        1
      );
    });

    it("should handle validation errors", async () => {
      const error = new Error("Invalid token");
      mockKeycloakClient.validateToken.mockRejectedValue(error);

      const result = await tokenManager.validateJwt("invalid.token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid token");
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.jwt_validation_error",
        1
      );
    });
  });

  describe("introspectToken", () => {
    const validToken = "valid.opaque.token";
    const mockAuthResult: AuthResult = {
      success: true,
      user: {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        roles: ["user"],
        permissions: ["read"],
        name: undefined,
      },
      token: validToken,
      scopes: ["openid", "profile"],
      expiresAt: new Date(Date.now() + 3600000),
    };

    beforeEach(() => {
      mockKeycloakClient.introspectToken.mockResolvedValue(mockAuthResult);
    });

    it("should introspect token successfully", async () => {
      const result = await tokenManager.introspectToken(validToken);

      expect(mockKeycloakClient.introspectToken).toHaveBeenCalledWith(
        validToken
      );
      expect(result).toEqual(mockAuthResult);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.introspection",
        1
      );
      expect(mockMetrics.recordTimer).toHaveBeenCalled();
    });

    it("should return cached result if available", async () => {
      const { CacheService } = require("@libs/database");
      const mockCache = CacheService.create.mock.results[0].value;
      mockCache.get.mockResolvedValue({ data: mockAuthResult, source: "hit" });

      const result = await tokenManager.introspectToken(validToken);

      expect(mockCache.get).toHaveBeenCalledWith(
        "introspect:valid.opaque.tok:validation"
      );
      expect(mockKeycloakClient.introspectToken).not.toHaveBeenCalled();
      expect(result).toEqual(mockAuthResult);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.introspection_cache_hit",
        1
      );
    });

    it("should cache successful introspection results", async () => {
      const { CacheService } = require("@libs/database");
      const mockCache = CacheService.create.mock.results[0].value;

      await tokenManager.introspectToken(validToken);

      expect(mockCache.set).toHaveBeenCalledWith(
        "introspect:valid.opaque.tok:validation",
        mockAuthResult,
        60
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.introspection_cache_set",
        1
      );
    });

    it("should handle introspection errors", async () => {
      const error = new Error("Introspection failed");
      mockKeycloakClient.introspectToken.mockRejectedValue(error);

      const result = await tokenManager.introspectToken("invalid.token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Introspection failed");
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.introspection_error",
        1
      );
    });
  });

  describe("validateToken", () => {
    const validToken = "valid.jwt.token";
    const mockAuthResult: AuthResult = {
      success: true,
      user: {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        roles: ["user"],
        permissions: ["read"],
        name: undefined,
      },
      token: validToken,
      scopes: ["openid", "profile"],
      expiresAt: new Date(Date.now() + 3600000),
    };

    beforeEach(() => {
      mockKeycloakClient.validateToken.mockResolvedValue(mockAuthResult);
      mockKeycloakClient.introspectToken.mockResolvedValue(mockAuthResult);
    });

    it("should validate token using JWT first by default", async () => {
      const result = await tokenManager.validateToken(validToken);

      expect(mockKeycloakClient.validateToken).toHaveBeenCalledWith(validToken);
      expect(mockKeycloakClient.introspectToken).not.toHaveBeenCalled();
      expect(result).toEqual(mockAuthResult);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.validation",
        1
      );
    });

    it("should use introspection first when specified", async () => {
      const result = await tokenManager.validateToken(validToken, true);

      expect(mockKeycloakClient.introspectToken).toHaveBeenCalledWith(
        validToken
      );
      expect(mockKeycloakClient.validateToken).not.toHaveBeenCalled();
      expect(result).toEqual(mockAuthResult);
    });

    it("should fallback to introspection when JWT validation fails", async () => {
      const jwtError: AuthResult = {
        success: false,
        error: "JWT validation failed",
      };
      mockKeycloakClient.validateToken.mockResolvedValue(jwtError);

      const result = await tokenManager.validateToken(validToken);

      expect(mockKeycloakClient.validateToken).toHaveBeenCalledWith(validToken);
      expect(mockKeycloakClient.introspectToken).toHaveBeenCalledWith(
        validToken
      );
      expect(result).toEqual(mockAuthResult);
    });

    it("should fallback to JWT when introspection fails", async () => {
      const introspectionError: AuthResult = {
        success: false,
        error: "Introspection failed",
      };
      mockKeycloakClient.introspectToken.mockResolvedValue(introspectionError);

      const result = await tokenManager.validateToken(validToken, true);

      expect(mockKeycloakClient.introspectToken).toHaveBeenCalledWith(
        validToken
      );
      expect(mockKeycloakClient.validateToken).toHaveBeenCalledWith(validToken);
      expect(result).toEqual(mockAuthResult);
    });

    it("should handle validation errors", async () => {
      const error = new Error("Validation failed");
      mockKeycloakClient.validateToken.mockRejectedValue(error);
      mockKeycloakClient.introspectToken.mockRejectedValue(error);

      const result = await tokenManager.validateToken("invalid.token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Validation failed");
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.validation",
        1
      );
      // Also expect the individual method errors
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.jwt_validation_error",
        1
      );
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "keycloak.token_manager.introspection_error",
        1
      );
    });
  });

  describe("extractBearerToken", () => {
    it("should extract token from valid Bearer header", () => {
      const header = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const result = tokenManager.extractBearerToken(header);

      expect(result).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    });

    it("should return null for invalid header format", () => {
      expect(tokenManager.extractBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
      expect(tokenManager.extractBearerToken("Bearer")).toBeNull();
      expect(tokenManager.extractBearerToken("Bearer ")).toBeNull();
      expect(tokenManager.extractBearerToken("")).toBeNull();
      expect(tokenManager.extractBearerToken(undefined)).toBeNull();
    });

    it("should handle case sensitivity", () => {
      const header = "bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      const result = tokenManager.extractBearerToken(header);

      expect(result).toBeNull(); // Should be case sensitive
    });
  });

  describe("hasRole", () => {
    const authResult: AuthResult = {
      success: true,
      user: {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        roles: ["realm:user", "client:read"],
        permissions: ["read"],
        name: undefined,
      },
      token: "token",
      scopes: ["openid"],
    };

    it("should return true for existing role", () => {
      expect(tokenManager.hasRole(authResult, "user")).toBe(true);
      expect(tokenManager.hasRole(authResult, "realm:user")).toBe(true);
      expect(tokenManager.hasRole(authResult, "client:read")).toBe(true);
    });

    it("should return false for non-existing role", () => {
      expect(tokenManager.hasRole(authResult, "admin")).toBe(false);
      expect(tokenManager.hasRole(authResult, "realm:admin")).toBe(false);
    });

    it("should return false for failed auth result", () => {
      const failedResult: AuthResult = {
        success: false,
        error: "Invalid token",
      };
      expect(tokenManager.hasRole(failedResult, "user")).toBe(false);
    });

    it("should return false for auth result without user", () => {
      const noUserResult: AuthResult = { success: true, token: "token" };
      expect(tokenManager.hasRole(noUserResult, "user")).toBe(false);
    });
  });

  describe("hasAnyRole", () => {
    const authResult: AuthResult = {
      success: true,
      user: {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        roles: ["realm:user", "client:read"],
        permissions: ["read"],
        name: undefined,
      },
      token: "token",
      scopes: ["openid"],
    };

    it("should return true if any required role exists", () => {
      expect(tokenManager.hasAnyRole(authResult, ["user", "admin"])).toBe(true);
      expect(tokenManager.hasAnyRole(authResult, ["admin", "user"])).toBe(true);
    });

    it("should return false if none of the required roles exist", () => {
      expect(tokenManager.hasAnyRole(authResult, ["admin", "manager"])).toBe(
        false
      );
    });

    it("should return false for empty required roles array", () => {
      expect(tokenManager.hasAnyRole(authResult, [])).toBe(false);
    });
  });

  describe("hasPermission", () => {
    const authResult: AuthResult = {
      success: true,
      user: {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        roles: ["user"],
        permissions: ["read", "write"],
        name: undefined,
      },
      token: "token",
      scopes: ["openid"],
    };

    it("should return true for existing permission", () => {
      expect(tokenManager.hasPermission(authResult, "read")).toBe(true);
      expect(tokenManager.hasPermission(authResult, "write")).toBe(true);
    });

    it("should return false for non-existing permission", () => {
      expect(tokenManager.hasPermission(authResult, "delete")).toBe(false);
    });

    it("should return false for failed auth result", () => {
      const failedResult: AuthResult = {
        success: false,
        error: "Invalid token",
      };
      expect(tokenManager.hasPermission(failedResult, "read")).toBe(false);
    });

    it("should return false for auth result without user", () => {
      const noUserResult: AuthResult = { success: true, token: "token" };
      expect(tokenManager.hasPermission(noUserResult, "read")).toBe(false);
    });
  });

  describe("hasAnyPermission", () => {
    const authResult: AuthResult = {
      success: true,
      user: {
        id: "user1",
        username: "testuser",
        email: "test@example.com",
        roles: ["user"],
        permissions: ["read", "write"],
        name: undefined,
      },
      token: "token",
      scopes: ["openid"],
    };

    it("should return true if any required permission exists", () => {
      expect(
        tokenManager.hasAnyPermission(authResult, ["read", "delete"])
      ).toBe(true);
      expect(
        tokenManager.hasAnyPermission(authResult, ["delete", "read"])
      ).toBe(true);
    });

    it("should return false if none of the required permissions exist", () => {
      expect(
        tokenManager.hasAnyPermission(authResult, ["delete", "admin"])
      ).toBe(false);
    });

    it("should return false for empty required permissions array", () => {
      expect(tokenManager.hasAnyPermission(authResult, [])).toBe(false);
    });
  });

  describe("isTokenExpired", () => {
    it("should return true for expired token", () => {
      const expiredResult: AuthResult = {
        success: true,
        token: "token",
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      };

      expect(tokenManager.isTokenExpired(expiredResult)).toBe(true);
    });

    it("should return false for valid token", () => {
      const validResult: AuthResult = {
        success: true,
        token: "token",
        expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      };

      expect(tokenManager.isTokenExpired(validResult)).toBe(false);
    });

    it("should return true for failed auth result", () => {
      const failedResult: AuthResult = {
        success: false,
        error: "Invalid token",
      };
      expect(tokenManager.isTokenExpired(failedResult)).toBe(true);
    });

    it("should return true for auth result without expiresAt", () => {
      const noExpiryResult: AuthResult = { success: true, token: "token" };
      expect(tokenManager.isTokenExpired(noExpiryResult)).toBe(true);
    });
  });

  describe("getTokenLifetime", () => {
    it("should return remaining lifetime in seconds", () => {
      const futureExpiry = new Date(Date.now() + 3600000); // 1 hour from now
      const result: AuthResult = {
        success: true,
        token: "token",
        expiresAt: futureExpiry,
      };

      const lifetime = tokenManager.getTokenLifetime(result);
      expect(lifetime).toBeGreaterThan(3500); // Should be close to 3600
      expect(lifetime).toBeLessThanOrEqual(3600);
    });

    it("should return 0 for expired token", () => {
      const expiredResult: AuthResult = {
        success: true,
        token: "token",
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      };

      expect(tokenManager.getTokenLifetime(expiredResult)).toBe(0);
    });

    it("should return 0 for failed auth result", () => {
      const failedResult: AuthResult = {
        success: false,
        error: "Invalid token",
      };
      expect(tokenManager.getTokenLifetime(failedResult)).toBe(0);
    });

    it("should return 0 for auth result without expiresAt", () => {
      const noExpiryResult: AuthResult = { success: true, token: "token" };
      expect(tokenManager.getTokenLifetime(noExpiryResult)).toBe(0);
    });
  });
});
