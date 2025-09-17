/**
 * Simplified Authorization Services Tests
 * Focus on core functionality with minimal mocking complexity
 */

import { createKeycloakAuthorizationServicesClient } from "../src/services/keycloak-authorization-services";
import type { IKeycloakClientFactory } from "../src/types";

// Simple mocks - just what we need
jest.mock("@libs/utils", () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock("@libs/database", () => ({
  CacheService: class MockCacheService {
    async get() {
      return { data: null, source: "miss", latency: 0, compressed: false };
    }
    async set() {
      return undefined;
    }
    async invalidate() {
      return undefined;
    }
    async invalidatePattern() {
      return 0;
    }
  },
}));

// Global fetch mock
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("Authorization Services - Simple Tests", () => {
  let client: ReturnType<typeof createKeycloakAuthorizationServicesClient>;

  // Simple client factory mock
  const mockClientFactory: IKeycloakClientFactory = {
    getAccessToken: jest.fn().mockResolvedValue("test-token"),
    getClientCredentialsToken: jest.fn().mockResolvedValue({
      access_token: "service-token",
      token_type: "Bearer",
      expires_in: 3600,
    }),
    getClient: jest.fn().mockReturnValue({ client_id: "test-client" }),
    refreshToken: jest.fn(),
    introspectToken: jest.fn(),
    getUserInfo: jest.fn(),
    logout: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default successful response
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    client = createKeycloakAuthorizationServicesClient(
      mockClientFactory,
      "https://keycloak.test/realms/test"
    );
  });

  // Simple focused tests
  test("creates client successfully", () => {
    expect(client).toBeDefined();
    expect(client.checkAuthorization).toBeInstanceOf(Function);
    expect(client.registerResource).toBeInstanceOf(Function);
    expect(client.createPolicy).toBeInstanceOf(Function);
  });

  test("registers resource", async () => {
    const mockResource = { id: "res-123", name: "test-resource" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve(mockResource),
    });

    const result = await client.registerResource({
      name: "test-resource",
      scopes: ["read"],
    });

    expect(result).toEqual(mockResource);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/authz/admin/resources"),
      expect.objectContaining({ method: "POST" })
    );
  });

  test("gets resources list", async () => {
    const mockResources = [{ id: "1", name: "Resource 1" }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResources),
    });

    const result = await client.getResources();
    expect(result).toEqual(mockResources);
  });

  test("creates policy", async () => {
    const mockPolicy = { id: "pol-123", name: "test-policy" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve(mockPolicy),
    });

    const result = await client.createPolicy({
      name: "test-policy",
      type: "role" as const,
      logic: "POSITIVE" as const,
      decisionStrategy: "UNANIMOUS" as const,
      config: { roles: '["user"]' },
    });

    expect(result).toEqual(mockPolicy);
  });

  test("checks authorization - granted", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: "rpt-token" }),
    });

    const result = await client.checkAuthorization(
      "user-token",
      "resource-123",
      ["read"]
    );

    expect(result.granted).toBe(true);
    expect(result.scopes).toEqual(["read"]);
  });

  test("checks authorization - denied", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () =>
        Promise.resolve({
          error: "access_denied",
          error_description: "Insufficient permissions",
        }),
    });

    const result = await client.checkAuthorization(
      "user-token",
      "resource-123",
      ["write"]
    );

    expect(result.granted).toBe(false);
    expect(result.reason).toBe("access_denied");
  });

  test("requests permission ticket", async () => {
    const mockTicket = "ticket-123";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ticket: mockTicket }),
    });

    const result = await client.requestPermissionTicket([
      { resource: "resource-123", scope: "read" },
    ]);

    expect(result).toBe(mockTicket);
  });

  test("handles network errors", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failed"));

    await expect(
      client.registerResource({ name: "test", scopes: ["read"] })
    ).rejects.toThrow("Network failed");
  });

  test("handles API errors", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          error: "invalid_request",
          error_description: "Invalid input",
        }),
    });

    await expect(
      client.registerResource({ name: "", scopes: [] })
    ).rejects.toThrow("Invalid input");
  });
});
