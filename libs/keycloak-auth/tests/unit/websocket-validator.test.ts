import {
  WebSocketTokenValidator,
  createWebSocketTokenValidator,
} from "../../src/index";

describe("WebSocketTokenValidator", () => {
  let validator: WebSocketTokenValidator;
  let mockTokenService: any;
  let mockCacheService: any;

  beforeEach(() => {
    mockTokenService = (
      global as any
    ).testUtils.createMockTokenIntrospectionService();
    mockCacheService = (global as any).testUtils.createMockCacheService();

    validator = createWebSocketTokenValidator(
      mockTokenService,
      mockCacheService
    );
  });

  describe("extractToken", () => {
    it("should extract token from Authorization header", () => {
      const headers = { authorization: "Bearer valid.jwt.token" };

      const result = validator.extractToken(headers, {});

      expect(result).toEqual({
        token: "valid.jwt.token",
        method: "jwt_token",
      });
    });

    it("should extract token from query parameter", () => {
      const query = { token: "query.access.token" };

      const result = validator.extractToken({}, query);

      expect(result).toEqual({
        token: "query.access.token",
        method: "jwt_token",
      });
    });

    it("should extract API key from headers", () => {
      const headers = { "x-api-key": "api.key.value" };

      const result = validator.extractToken(headers, {});

      expect(result).toEqual({
        token: "api.key.value",
        method: "api_key",
      });
    });

    it("should extract token from cookies", () => {
      const cookies = { access_token: "cookie.token.value" };

      const result = validator.extractToken({}, {}, cookies);

      expect(result).toEqual({
        token: "cookie.token.value",
        method: "jwt_token",
      });
    });

    it("should return null when no token found", () => {
      const result = validator.extractToken({}, {});

      expect(result).toBeNull();
    });
  });

  describe("validateConnectionToken", () => {
    it("should validate JWT token and create auth context", async () => {
      const token = "valid.jwt.token";
      const connectionId = "conn_123";
      const mockValidationResult = {
        valid: true,
        claims: { sub: "user123", azp: "test-client", scope: "openid profile" },
        cached: false,
      };

      mockCacheService.get.mockResolvedValueOnce({ data: null });
      mockTokenService.validateJWT.mockResolvedValueOnce(mockValidationResult);
      mockCacheService.set.mockResolvedValueOnce(true);

      const result = await validator.validateConnectionToken(
        token,
        "jwt_token",
        connectionId
      );

      expect(result).toEqual(
        expect.objectContaining({
          method: "jwt_token",
          userId: "user123",
          clientId: "test-client",
          connectionId: "conn_123",
          scopes: ["openid", "profile"],
        })
      );
    });

    it("should use cached validation result", async () => {
      const token = "cached.jwt.token";
      const connectionId = "conn_456";
      const cachedResult = {
        valid: true,
        claims: { sub: "user456", azp: "cached-client" },
        cached: true,
      };

      mockCacheService.get.mockResolvedValueOnce({ data: cachedResult });

      const result = await validator.validateConnectionToken(
        token,
        "jwt_token",
        connectionId
      );

      expect(result.userId).toBe("user456");
      expect(mockTokenService.validateJWT).not.toHaveBeenCalled();
    });

    it("should throw error for invalid token", async () => {
      const token = "invalid.token";
      const connectionId = "conn_invalid";
      const mockValidationResult = {
        valid: false,
        error: "Token expired",
        cached: false,
      };

      mockCacheService.get.mockResolvedValueOnce({ data: null });
      mockTokenService.validateJWT.mockResolvedValueOnce(mockValidationResult);

      await expect(
        validator.validateConnectionToken(token, "jwt_token", connectionId)
      ).rejects.toThrow("Token validation failed");
    });
  });

  describe("hasPermission", () => {
    const authContext = {
      method: "jwt_token" as const,
      claims: {
        sub: "user123",
        iss: "https://keycloak.example.com/realms/test",
        aud: "test-client",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        scope: "openid profile websocket:connect",
      },
      clientId: "test-client",
      userId: "user123",
      scopes: ["openid", "profile", "websocket:connect"],
      permissions: ["realm:user", "test-client:websocket"],
      connectionId: "conn_123",
      connectedAt: new Date(),
      lastValidated: new Date(),
    };

    it("should allow access with sufficient scopes", () => {
      const result = validator.hasPermission(authContext, [
        "openid",
        "profile",
      ]);

      expect(result).toBe(true);
    });

    it("should deny access with insufficient scopes", () => {
      const result = validator.hasPermission(authContext, ["admin"]);

      expect(result).toBe(false);
    });

    it("should allow access with sufficient permissions", () => {
      const result = validator.hasPermission(authContext, undefined, [
        "realm:user",
      ]);

      expect(result).toBe(true);
    });

    it("should deny access with insufficient permissions", () => {
      const result = validator.hasPermission(authContext, undefined, [
        "admin:manage",
      ]);

      expect(result).toBe(false);
    });
  });

  describe("refreshAuthContext", () => {
    it("should refresh auth context for valid connection", async () => {
      const mockWs = {
        data: {
          auth: {
            method: "jwt_token" as const,
            claims: {
              sub: "user123",
              exp: Math.floor(Date.now() / 1000) + 3600,
            },
            connectionId: "conn_refresh",
            connectedAt: new Date(Date.now() - 1000),
            lastValidated: new Date(Date.now() - 1000),
          },
        },
      } as any;

      const result = await validator.refreshAuthContext(mockWs);

      expect(result.connectionId).toBe("conn_refresh");
      expect(result.lastValidated.getTime()).toBeGreaterThan(
        mockWs.data.auth.lastValidated.getTime()
      );
    });
  });

  describe("cleanupExpiredAuth", () => {
    it("should cleanup expired auth contexts", async () => {
      mockCacheService.invalidatePattern.mockResolvedValueOnce(5);

      await validator.cleanupExpiredAuth();

      expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith(
        "ws:auth:*"
      );
    });
  });
});
