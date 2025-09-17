import {
  KeycloakClientFactory,
  createKeycloakClientFactory,
} from "../../src/index.simple";

describe("KeycloakClientFactory Integration", () => {
  let clientFactory: KeycloakClientFactory;

  // Mock environment configuration that matches the expected types
  const mockEnvConfig = {
    KEYCLOAK_SERVER_URL: "https://keycloak.example.com",
    KEYCLOAK_REALM: "test",
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
    // Mock fetch for discovery document requests
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("should create client factory with valid configuration", () => {
    expect(() => {
      clientFactory = createKeycloakClientFactory(mockEnvConfig);
    }).not.toThrow();

    expect(clientFactory).toBeDefined();
  });

  it("should have basic functionality", () => {
    clientFactory = createKeycloakClientFactory(mockEnvConfig);

    // Just test that the factory exists and has the expected structure
    expect(typeof clientFactory.getClient).toBe("function");
    expect(typeof clientFactory.getDiscoveryDocument).toBe("function");
  });
});
