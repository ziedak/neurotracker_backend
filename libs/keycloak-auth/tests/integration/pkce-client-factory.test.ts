/**
 * PKCE Integration Test with Keycloak Client Factory
 * Tests PKCE-enhanced authorization code flow methods
 */

import { KeycloakClientFactory } from "../../src/client/keycloak-client-factory";
import { EnvironmentConfig } from "../../src/types";

describe("PKCE Integration with Client Factory", () => {
  let clientFactory: KeycloakClientFactory;

  // Mock environment configuration for testing
  const mockEnvConfig: EnvironmentConfig = {
    KEYCLOAK_SERVER_URL: "https://keycloak.example.com",
    KEYCLOAK_REALM: "test-realm",
    KEYCLOAK_FRONTEND_CLIENT_ID: "frontend-client",
    KEYCLOAK_SERVICE_CLIENT_ID: "service-client",
    KEYCLOAK_SERVICE_CLIENT_SECRET: "service-secret",
    KEYCLOAK_TRACKER_CLIENT_ID: "tracker-client",
    KEYCLOAK_TRACKER_CLIENT_SECRET: "tracker-secret",
    KEYCLOAK_WEBSOCKET_CLIENT_ID: "websocket-client",
    REDIS_URL: "redis://localhost:6379",
    AUTH_CACHE_TTL: "3600",
    AUTH_INTROSPECTION_TTL: "300",
  };

  beforeEach(() => {
    clientFactory = new KeycloakClientFactory(mockEnvConfig);
  });

  describe("PKCE-Enhanced Authorization URL", () => {
    it("should create PKCE authorization URL with all required parameters", async () => {
      const state = "test-state-123";
      const nonce = "test-nonce-456";

      // Mock discovery document
      jest.spyOn(clientFactory, "getDiscoveryDocument").mockResolvedValue({
        authorization_endpoint:
          "https://keycloak.example.com/auth/realms/test-realm/protocol/openid-connect/auth",
        token_endpoint:
          "https://keycloak.example.com/auth/realms/test-realm/protocol/openid-connect/token",
      });

      const result = await clientFactory.createPKCEAuthorizationUrl(
        state,
        nonce
      );

      // Verify the result structure
      expect(result).toHaveProperty("authorizationUrl");
      expect(result).toHaveProperty("codeVerifier");
      expect(result).toHaveProperty("codeChallenge");

      // Verify URL contains PKCE parameters
      const url = new URL(result.authorizationUrl);
      expect(url.searchParams.get("code_challenge")).toBe(result.codeChallenge);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("state")).toBe(state);
      expect(url.searchParams.get("nonce")).toBe(nonce);

      // Verify PKCE parameters format
      expect(result.codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(result.codeChallenge.length).toBe(43);
      expect(/^[A-Za-z0-9\-\._~]+$/.test(result.codeVerifier)).toBe(true);
      expect(/^[A-Za-z0-9\-_]+$/.test(result.codeChallenge)).toBe(true);
    });

    it("should include all standard authorization parameters", async () => {
      const state = "test-state-456";
      const nonce = "test-nonce-789";

      jest.spyOn(clientFactory, "getDiscoveryDocument").mockResolvedValue({
        authorization_endpoint:
          "https://keycloak.example.com/auth/realms/test-realm/protocol/openid-connect/auth",
      });

      const result = await clientFactory.createPKCEAuthorizationUrl(
        state,
        nonce
      );
      const url = new URL(result.authorizationUrl);

      // Standard OAuth parameters
      expect(url.searchParams.get("client_id")).toBe("frontend-client");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("redirect_uri")).toBeDefined();
      expect(url.searchParams.get("scope")).toContain("openid");

      // PKCE parameters
      expect(url.searchParams.get("code_challenge")).toBeDefined();
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    });
  });

  describe("PKCE-Enhanced Token Exchange", () => {
    it("should exchange code with stored PKCE verifier", async () => {
      const state = "test-state-exchange";
      const nonce = "test-nonce-exchange";
      const code = "test-authorization-code";

      // Mock discovery and token exchange response
      jest.spyOn(clientFactory, "getDiscoveryDocument").mockResolvedValue({
        authorization_endpoint:
          "https://keycloak.example.com/auth/realms/test-realm/protocol/openid-connect/auth",
        token_endpoint:
          "https://keycloak.example.com/auth/realms/test-realm/protocol/openid-connect/token",
      });

      const mockTokenResponse = {
        access_token: "mock-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "mock-refresh-token",
        scope: "openid profile",
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      // First create PKCE authorization URL to store the verifier
      const authResult = await clientFactory.createPKCEAuthorizationUrl(
        state,
        nonce
      );
      expect(authResult.codeVerifier).toBeDefined();

      // Then exchange the code using PKCE
      const tokenResult = await clientFactory.exchangePKCECodeForToken(
        code,
        state
      );

      expect(tokenResult).toEqual(mockTokenResponse);

      // Verify the request contained the code verifier
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("code_verifier="),
        })
      );
    });

    it("should throw error if PKCE verifier not found", async () => {
      const state = "non-existent-state";
      const code = "test-code";

      await expect(
        clientFactory.exchangePKCECodeForToken(code, state)
      ).rejects.toThrow("PKCE code verifier not found");
    });

    it("should clean up verifier after successful exchange", async () => {
      const state = "test-cleanup-state";
      const nonce = "test-cleanup-nonce";
      const code = "test-code";

      jest.spyOn(clientFactory, "getDiscoveryDocument").mockResolvedValue({
        authorization_endpoint: "https://keycloak.example.com/auth",
        token_endpoint: "https://keycloak.example.com/token",
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
      });

      // Create and store PKCE parameters
      await clientFactory.createPKCEAuthorizationUrl(state, nonce);

      // Exchange code (should remove the stored verifier)
      await clientFactory.exchangePKCECodeForToken(code, state);

      // Attempting to exchange again should fail
      await expect(
        clientFactory.exchangePKCECodeForToken(code, state)
      ).rejects.toThrow("PKCE code verifier not found");
    });
  });

  describe("PKCE Security Features", () => {
    it("should generate unique PKCE parameters for different states", async () => {
      const state1 = "state-1";
      const state2 = "state-2";
      const nonce = "test-nonce";

      jest.spyOn(clientFactory, "getDiscoveryDocument").mockResolvedValue({
        authorization_endpoint: "https://keycloak.example.com/auth",
      });

      const result1 = await clientFactory.createPKCEAuthorizationUrl(
        state1,
        nonce
      );
      const result2 = await clientFactory.createPKCEAuthorizationUrl(
        state2,
        nonce
      );

      // PKCE parameters should be unique
      expect(result1.codeVerifier).not.toBe(result2.codeVerifier);
      expect(result1.codeChallenge).not.toBe(result2.codeChallenge);
    });

    it("should handle concurrent PKCE flows", async () => {
      const states = ["concurrent-1", "concurrent-2", "concurrent-3"];
      const nonce = "concurrent-nonce";

      jest.spyOn(clientFactory, "getDiscoveryDocument").mockResolvedValue({
        authorization_endpoint: "https://keycloak.example.com/auth",
      });

      // Create multiple concurrent PKCE flows
      const promises = states.map((state) =>
        clientFactory.createPKCEAuthorizationUrl(state, nonce)
      );

      const results = await Promise.all(promises);

      // All should succeed with unique parameters
      expect(results).toHaveLength(3);
      results.forEach((result, index) => {
        expect(result.codeVerifier).toBeDefined();
        expect(result.codeChallenge).toBeDefined();

        // Ensure uniqueness
        results.forEach((other, otherIndex) => {
          if (index !== otherIndex) {
            expect(result.codeVerifier).not.toBe(other.codeVerifier);
            expect(result.codeChallenge).not.toBe(other.codeChallenge);
          }
        });
      });
    });
  });
});
