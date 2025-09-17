import {
  createKeycloakClientFactory,
  KeycloakClientFactory,
} from "../../src/index";

describe("KeycloakClientFactory", () => {
  let clientFactory: KeycloakClientFactory;

  beforeEach(() => {
    const envConfig = (global as any).testUtils.createMockEnvironmentConfig();
    clientFactory = createKeycloakClientFactory(envConfig);
  });

  describe("getClient", () => {
    it("should return frontend client configuration", () => {
      const client = clientFactory.getClient("frontend");

      expect(client).toEqual({
        realm: "test",
        serverUrl: "https://keycloak.example.com",
        clientId: "frontend-client",
        flow: "authorization_code",
        type: "frontend",
        scopes: ["openid", "profile", "email"],
        redirectUri: "http://localhost:3000/auth/callback",
      });
    });

    it("should return service client configuration", () => {
      const client = clientFactory.getClient("service");

      expect(client).toEqual({
        realm: "test",
        serverUrl: "https://keycloak.example.com",
        clientId: "service-client",
        clientSecret: "service-secret",
        flow: "client_credentials",
        type: "service",
        scopes: ["service:read", "service:write", "service:admin"],
      });
    });

    it("should throw error for unknown client type", () => {
      expect(() => {
        clientFactory.getClient("unknown" as any);
      }).toThrow("Unknown client type: unknown");
    });
  });

  describe("getDiscoveryDocument", () => {
    it("should fetch and cache discovery document", async () => {
      const mockDiscovery = (
        global as any
      ).testUtils.createMockDiscoveryDocument();

      // Mock the circuit breaker's fire method
      const mockCircuitBreaker = {
        fire: jest.fn().mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscovery),
        }),
      };

      // Replace the circuit breaker instance with our mock
      const originalCircuitBreaker = (clientFactory as any).httpCircuitBreaker;
      (clientFactory as any).httpCircuitBreaker = mockCircuitBreaker;

      const discovery = await clientFactory.getDiscoveryDocument("test");

      expect(discovery).toEqual(mockDiscovery);
      expect(mockCircuitBreaker.fire).toHaveBeenCalledWith(
        "https://keycloak.example.com/realms/test/.well-known/openid_connect_configuration",
        expect.any(Object)
      );

      // Restore original circuit breaker
      (clientFactory as any).httpCircuitBreaker = originalCircuitBreaker;
    });

    it("should return cached discovery document on second call", async () => {
      const mockDiscovery = (
        global as any
      ).testUtils.createMockDiscoveryDocument();

      // Mock the circuit breaker's fire method
      const mockCircuitBreaker = {
        fire: jest.fn().mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDiscovery),
        }),
      };

      // Replace the circuit breaker instance with our mock
      const originalCircuitBreaker = (clientFactory as any).httpCircuitBreaker;
      (clientFactory as any).httpCircuitBreaker = originalCircuitBreaker;

      // Temporarily replace for first call
      (clientFactory as any).httpCircuitBreaker = mockCircuitBreaker;

      // First call
      await clientFactory.getDiscoveryDocument("test");

      // Restore original and second call should use cache
      (clientFactory as any).httpCircuitBreaker = originalCircuitBreaker;
      const discovery = await clientFactory.getDiscoveryDocument("test");

      expect(discovery).toEqual(mockDiscovery);
      expect(mockCircuitBreaker.fire).toHaveBeenCalledTimes(1);
    });

    it("should use circuit breaker for HTTP requests", async () => {
      // Mock fetch to return a successful response
      const originalFetch = global.fetch;
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve(
            (global as any).testUtils.createMockDiscoveryDocument()
          ),
      });

      const discovery = await clientFactory.getDiscoveryDocument("test");

      expect(discovery).toBeDefined();
      expect((global as any).fetch).toHaveBeenCalledTimes(1);
      expect((global as any).fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "/realms/test/.well-known/openid_connect_configuration"
        ),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Accept: "application/json",
            "User-Agent": "keycloak-auth-lib/1.0.0",
          }),
        })
      );

      // Restore original fetch
      global.fetch = originalFetch;
    });
  });

  describe("configuration validation", () => {
    it("should validate environment configuration", () => {
      const validConfig = (
        global as any
      ).testUtils.createMockEnvironmentConfig();

      expect(() => {
        createKeycloakClientFactory(validConfig);
      }).not.toThrow();
    });

    it("should throw on invalid configuration", () => {
      const invalidConfig = {
        KEYCLOAK_SERVER_URL: "invalid-url",
        KEYCLOAK_REALM: "",
        // Missing required fields
      };

      expect(() => {
        createKeycloakClientFactory(invalidConfig as any);
      }).toThrow();
    });
  });
});
