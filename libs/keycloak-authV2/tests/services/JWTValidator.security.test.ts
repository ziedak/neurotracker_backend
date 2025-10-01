/**
 * JWT Validator Security Tests
 * Tests for replay protection and other security features
 */

import { JWTValidator } from "../../src/services/token/JWTValidator";

// Mock jose library
jest.mock("jose", () => ({
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(() => ({})),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe("JWTValidator Security", () => {
  let jwtValidator: JWTValidator;
  const mockJwtVerify = require("jose").jwtVerify as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jwtValidator = new JWTValidator(
      "https://test.keycloak.com/auth/realms/test/protocol/openid_connect/certs",
      "https://test.keycloak.com/auth/realms/test",
      "test-client"
    );
  });

  describe("Token Replay Protection", () => {
    it("should allow token with jti and iat on first use", async () => {
      const mockPayload = {
        sub: "user123",
        jti: "token-id-123",
        iat: 1234567890,
        exp: 1234571490, // 1 hour later
        preferred_username: "testuser",
        email: "test@example.com",
      };

      mockJwtVerify.mockResolvedValue({ payload: mockPayload });

      const result = await jwtValidator.validateJWT("valid.jwt.token");

      expect(result.success).toBe(true);
      expect(result.user?.id).toBe("user123");
    });

    it("should reject replayed token with same jti and iat", async () => {
      const mockPayload = {
        sub: "user123",
        jti: "token-id-123",
        iat: 1234567890,
        exp: 1234571490,
        preferred_username: "testuser",
        email: "test@example.com",
      };

      mockJwtVerify.mockResolvedValue({ payload: mockPayload });

      // First call should succeed
      const firstResult = await jwtValidator.validateJWT("valid.jwt.token");
      expect(firstResult.success).toBe(true);

      // Second call with same token should be rejected
      const secondResult = await jwtValidator.validateJWT("valid.jwt.token");
      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toBe("Token replay detected");
    });

    it("should allow tokens without jti/iat for backward compatibility", async () => {
      const mockPayload = {
        sub: "user123",
        exp: 1234571490,
        preferred_username: "testuser",
        email: "test@example.com",
      };

      mockJwtVerify.mockResolvedValue({ payload: mockPayload });

      const result = await jwtValidator.validateJWT("valid.jwt.token");

      expect(result.success).toBe(true);
      expect(result.user?.id).toBe("user123");
    });

    it("should allow different tokens with different jti", async () => {
      const mockPayload1 = {
        sub: "user123",
        jti: "token-id-123",
        iat: 1234567890,
        exp: 1234571490,
        preferred_username: "testuser",
        email: "test1@example.com",
      };

      const mockPayload2 = {
        sub: "user456",
        jti: "token-id-456", // Different jti
        iat: 1234567890,
        exp: 1234571490,
        preferred_username: "testuser2",
        email: "test2@example.com",
      };

      mockJwtVerify
        .mockResolvedValueOnce({ payload: mockPayload1 })
        .mockResolvedValueOnce({ payload: mockPayload2 });

      // Use proper JWT format for testing
      const validJwtFormat1 =
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIn0.signature1";
      const validJwtFormat2 =
        "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyNDU2In0.signature2";

      const firstResult = await jwtValidator.validateJWT(validJwtFormat1);
      const secondResult = await jwtValidator.validateJWT(validJwtFormat2);

      expect(firstResult.success).toBe(true);
      expect(firstResult.user?.id).toBe("user123");
      expect(secondResult.success).toBe(true);
      expect(secondResult.user?.id).toBe("user456");
    });
  });
});
