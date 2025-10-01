/**
 * Configuration Security Tests
 * Tests for cross-field validation and security features
 */

import {
  createAuthV2Config,
  loadConfigFromEnv,
} from "../../src/services/token/config";
import type { AuthV2Config } from "../../src/services/token/config";

describe("Configuration Security", () => {
  describe("JWT Cross-Field Validation", () => {
    it("should reject JWKS URL from different domain than issuer", () => {
      const config: Partial<AuthV2Config> = {
        jwt: {
          issuer: "https://auth.example.com/realms/test",
          jwksUrl: "https://malicious.com/jwks", // Different domain
        },
      };

      expect(() => createAuthV2Config(config)).toThrow(
        "JWKS URL must be from the same domain as issuer for security"
      );
    });

    it("should accept JWKS URL from same domain as issuer", () => {
      const config: Partial<AuthV2Config> = {
        jwt: {
          issuer: "https://auth.example.com/realms/test",
          jwksUrl:
            "https://auth.example.com/realms/test/protocol/openid_connect/certs",
        },
      };

      expect(() => createAuthV2Config(config)).not.toThrow();
    });

    it("should accept configuration with only issuer (no jwksUrl)", () => {
      const config: Partial<AuthV2Config> = {
        jwt: {
          issuer: "https://auth.example.com/realms/test",
        },
      };

      expect(() => createAuthV2Config(config)).not.toThrow();
    });

    it("should accept configuration with only jwksUrl (no issuer)", () => {
      const config: Partial<AuthV2Config> = {
        jwt: {
          jwksUrl:
            "https://auth.example.com/realms/test/protocol/openid_connect/certs",
        },
      };

      expect(() => createAuthV2Config(config)).not.toThrow();
    });

    it("should handle invalid URLs gracefully", () => {
      const config: Partial<AuthV2Config> = {
        jwt: {
          issuer: "not-a-valid-url",
          jwksUrl: "also-not-valid",
        },
      };

      // Should fail on URL validation, not cross-field validation
      expect(() => createAuthV2Config(config)).toThrow();
    });
  });

  describe("Safe Integer Parsing", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should handle invalid integer environment variables", () => {
      process.env["KEYCLOAK_CACHE_JWT_TTL"] = "not-a-number";
      process.env["KEYCLOAK_API_KEY_HASH_ROUNDS"] = "invalid";
      process.env["KEYCLOAK_MAX_CONCURRENT_SESSIONS"] = "abc";

      const config = loadConfigFromEnv();

      // Should use default values when parsing fails
      expect(config.cache.ttl.jwt).toBe(300); // Default
      expect(config.security.apiKeyHashRounds).toBe(12); // Default
      expect(config.session.maxConcurrentSessions).toBe(5); // Default
    });

    it("should parse valid integer environment variables", () => {
      process.env["KEYCLOAK_CACHE_JWT_TTL"] = "600";
      process.env["KEYCLOAK_API_KEY_HASH_ROUNDS"] = "14";
      process.env["KEYCLOAK_MAX_CONCURRENT_SESSIONS"] = "10";

      const config = loadConfigFromEnv();

      expect(config.cache.ttl.jwt).toBe(600);
      expect(config.security.apiKeyHashRounds).toBe(14);
      expect(config.session.maxConcurrentSessions).toBe(10);
    });

    it("should handle empty environment variables", () => {
      process.env["KEYCLOAK_CACHE_JWT_TTL"] = "";
      process.env["KEYCLOAK_API_KEY_HASH_ROUNDS"] = "";

      const config = loadConfigFromEnv();

      // Should use default values for empty strings
      expect(config.cache.ttl.jwt).toBe(300);
      expect(config.security.apiKeyHashRounds).toBe(12);
    });
  });
});
