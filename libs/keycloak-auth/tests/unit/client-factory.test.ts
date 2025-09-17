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

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDiscovery),
      });

      const discovery = await clientFactory.getDiscoveryDocument("test");

      expect(discovery).toEqual(mockDiscovery);
      expect(global.fetch).toHaveBeenCalledWith(
        "https://keycloak.example.com/realms/test/.well-known/openid_connect_configuration",
        expect.any(Object)
      );
    });

    it("should return cached discovery document on second call", async () => {
      const mockDiscovery = (
        global as any
      ).testUtils.createMockDiscoveryDocument();

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDiscovery),
      });

      // First call
      await clientFactory.getDiscoveryDocument("test");

      // Second call should use cache
      const discovery = await clientFactory.getDiscoveryDocument("test");

      expect(discovery).toEqual(mockDiscovery);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure", async () => {
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve(
              (global as any).testUtils.createMockDiscoveryDocument()
            ),
        });

      const discovery = await clientFactory.getDiscoveryDocument("test");

      expect(discovery).toBeDefined();
      expect(global.fetch).toHaveBeenCalledTimes(3);
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
