/**
 * Unit Tests for TokenManagementService
 * Tests JWT token lifecycle operations
 */

// Mock JWT service before any imports
jest.mock("../src/services/jwt-service", () => ({
  JWTService: jest.fn().mockImplementation(() => ({
    generateTokens: jest.fn(),
    verifyToken: jest.fn(),
    refreshToken: jest.fn(),
    revokeToken: jest.fn(),
    revokeAllUserTokens: jest.fn(),
    validateTokenFormat: jest.fn(),
  })),
}));

import { TokenManagementService } from "../src/services/token-management-service";
import { JWTService } from "../src/services/jwt-service";
import { ServiceDependencies, User } from "../src/types";

describe("TokenManagementService", () => {
  let tokenService: TokenManagementService;
  let mockJwtService: jest.Mocked<JWTService>;
  let mockDeps: ServiceDependencies;

  const mockUser: User = {
    id: "test-user-id",
    email: "test@example.com",
    name: "Test User",
    roles: ["user"],
    permissions: ["read:own-data"],
    metadata: {},
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockTokens = {
    accessToken: "mock-access-token",
    refreshToken: "mock-refresh-token",
    expiresIn: 3600,
    tokenType: "Bearer" as const,
  };

  beforeEach(() => {
    // Create mock dependencies
    mockDeps = (global as any).testUtils.createMockDeps();

    // Create mock JWT service instance
    mockJwtService = {
      generateTokens: jest.fn(),
      verifyToken: jest.fn(),
      refreshToken: jest.fn(),
      revokeToken: jest.fn(),
      revokeAllUserTokens: jest.fn(),
      validateTokenFormat: jest.fn(),
      extractTokenFromHeader: jest.fn(),
    } as unknown as jest.Mocked<JWTService>;

    // Mock the JWTService constructor to return our mock instance
    (JWTService as jest.MockedClass<typeof JWTService>).mockImplementation(
      () => mockJwtService
    );

    // Setup service mocks with default successful responses
    mockJwtService.generateTokens.mockResolvedValue(mockTokens);
    mockJwtService.verifyToken.mockResolvedValue(mockUser);
    mockJwtService.refreshToken.mockResolvedValue(mockTokens);
    mockJwtService.revokeToken.mockResolvedValue(undefined);
    mockJwtService.revokeAllUserTokens.mockResolvedValue(undefined);
    mockJwtService.validateTokenFormat.mockReturnValue(true);

    // Create service instance
    tokenService = new TokenManagementService(mockDeps, {
      jwtService: mockJwtService,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("generateTokens", () => {
    it("should successfully generate tokens for user", async () => {
      const result = await tokenService.generateTokens(mockUser);

      expect(result).toEqual(mockTokens);
      expect(mockJwtService.generateTokens).toHaveBeenCalledWith(mockUser);
    });

    it("should handle token generation failure", async () => {
      mockJwtService.generateTokens.mockRejectedValue(
        new Error("Token generation failed")
      );

      await expect(tokenService.generateTokens(mockUser)).rejects.toThrow(
        "Failed to generate authentication tokens"
      );
      expect(mockDeps.monitoring.logger.error).toHaveBeenCalled();
    });
  });

  describe("verifyToken", () => {
    it("should successfully verify valid token", async () => {
      const result = await tokenService.verifyToken("valid-token");

      expect(result).toEqual(mockUser);
      expect(mockJwtService.verifyToken).toHaveBeenCalledWith("valid-token");
    });

    it("should return null for invalid token", async () => {
      mockJwtService.verifyToken.mockRejectedValue(new Error("Invalid token"));

      const result = await tokenService.verifyToken("invalid-token");

      expect(result).toBeNull();
      expect(mockDeps.monitoring.logger.warn).toHaveBeenCalled();
    });
  });

  describe("refreshToken", () => {
    it("should successfully refresh valid token", async () => {
      const result = await tokenService.refreshToken("valid-refresh-token");

      expect(result.success).toBe(true);
      expect(result.user).toEqual(mockUser);
      expect(result.tokens).toEqual(mockTokens);
      expect(mockJwtService.refreshToken).toHaveBeenCalledWith(
        "valid-refresh-token"
      );
      expect(mockJwtService.verifyToken).toHaveBeenCalledWith(
        mockTokens.accessToken
      );
    });

    it("should handle refresh token failure", async () => {
      mockJwtService.refreshToken.mockRejectedValue(
        new Error("Invalid refresh token")
      );

      const result = await tokenService.refreshToken("invalid-token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Token refresh failed");
      expect(result.code).toBe("REFRESH_FAILED");
      expect(mockDeps.monitoring.logger.error).toHaveBeenCalled();
    });
  });

  describe("revokeToken", () => {
    it("should successfully revoke token", async () => {
      const result = await tokenService.revokeToken("token-to-revoke");

      expect(result).toBe(true);
      expect(mockJwtService.revokeToken).toHaveBeenCalledWith(
        "token-to-revoke"
      );
    });

    it("should handle revoke failure", async () => {
      mockJwtService.revokeToken.mockRejectedValue(new Error("Revoke failed"));

      const result = await tokenService.revokeToken("token");

      expect(result).toBe(false);
      expect(mockDeps.monitoring.logger.error).toHaveBeenCalled();
    });
  });

  describe("revokeAllUserTokens", () => {
    it("should successfully revoke all user tokens", async () => {
      const result = await tokenService.revokeAllUserTokens("user-id");

      expect(result).toBe(true);
      expect(mockJwtService.revokeAllUserTokens).toHaveBeenCalledWith(
        "user-id"
      );
      expect(mockDeps.monitoring.logger.info).toHaveBeenCalled();
    });

    it("should handle revoke all failure", async () => {
      mockJwtService.revokeAllUserTokens.mockRejectedValue(
        new Error("Revoke all failed")
      );

      const result = await tokenService.revokeAllUserTokens("user-id");

      expect(result).toBe(false);
      expect(mockDeps.monitoring.logger.error).toHaveBeenCalled();
    });
  });

  describe("validateTokenFormat", () => {
    it("should validate correct token format", () => {
      mockJwtService.validateTokenFormat.mockReturnValue(true);

      const result = tokenService.validateTokenFormat("valid.jwt.token");

      expect(result).toBe(true);
      expect(mockJwtService.validateTokenFormat).toHaveBeenCalledWith(
        "valid.jwt.token"
      );
    });

    it("should reject invalid token format", () => {
      mockJwtService.validateTokenFormat.mockReturnValue(false);

      const result = tokenService.validateTokenFormat("invalid-token");

      expect(result).toBe(false);
    });

    it("should handle validation errors gracefully", () => {
      mockJwtService.validateTokenFormat.mockImplementation(() => {
        throw new Error("Validation error");
      });

      const result = tokenService.validateTokenFormat("token");

      expect(result).toBe(false);
    });
  });

  describe("getTokenExpiration", () => {
    it("should extract expiration from valid JWT", () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const payload = btoa(JSON.stringify({ exp: futureTime, sub: "test" }));
      const signature = "signature";
      const token = `${header}.${payload}.${signature}`;

      const result = tokenService.getTokenExpiration(token);

      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBe(futureTime * 1000);
    });

    it("should return null for token without expiration", () => {
      const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
      const payload = btoa(JSON.stringify({ sub: "test" })); // No exp
      const signature = "signature";
      const token = `${header}.${payload}.${signature}`;

      const result = tokenService.getTokenExpiration(token);

      expect(result).toBeNull();
    });

    it("should return null for malformed token", () => {
      const result = tokenService.getTokenExpiration("malformed-token");

      expect(result).toBeNull();
    });
  });

  describe("isTokenBlacklisted", () => {
    it("should return false for valid token", async () => {
      const result = await tokenService.isTokenBlacklisted("valid-token");

      expect(result).toBe(false);
      expect(mockJwtService.verifyToken).toHaveBeenCalledWith("valid-token");
    });

    it("should return true for invalid/expired/blacklisted token", async () => {
      mockJwtService.verifyToken.mockRejectedValue(new Error("Token invalid"));

      const result = await tokenService.isTokenBlacklisted("invalid-token");

      expect(result).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should handle service unavailability in token generation", async () => {
      mockJwtService.generateTokens.mockRejectedValue(
        new Error("Service unavailable")
      );

      await expect(tokenService.generateTokens(mockUser)).rejects.toThrow(
        "Failed to generate authentication tokens"
      );
    });

    it("should handle malformed tokens gracefully", async () => {
      mockJwtService.verifyToken.mockRejectedValue(
        new Error("Malformed token")
      );

      const result = await tokenService.verifyToken("malformed-token");

      expect(result).toBeNull();
    });
  });
});
