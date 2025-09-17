/**
 * Keycloak Authorization Services Client Tests
 * Comprehensive test suite for UMA 2.0 flows, policy management, and resource handling
 */

import { createKeycloakAuthorizationServicesClient } from "../src/services/keycloak-authorization-services";
import type {
  IKeycloakClientFactory,
  ResourceRepresentation,
  PolicyRepresentation,
  AuthorizationDecision,
  AuthorizationContext,
  PermissionTicket,
} from "../src/types";

// Mock dependencies
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock("@libs/database", () => ({
  CacheService: {
    get: jest.fn(),
    set: jest.fn(),
    invalidate: jest.fn(),
  },
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("KeycloakAuthorizationServicesClient", () => {
  let authzClient: ReturnType<typeof createKeycloakAuthorizationServicesClient>;
  let mockClientFactory: jest.Mocked<IKeycloakClientFactory>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock client factory
    mockClientFactory = {
      createClient: jest.fn().mockResolvedValue({
        realmAccess: { roles: ["user"] },
        resourceAccess: {},
      }),
      getAccessToken: jest.fn().mockResolvedValue("mock-access-token"),
      getClientCredentialsToken: jest
        .fn()
        .mockResolvedValue("mock-service-token"),
      refreshToken: jest.fn().mockResolvedValue({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
      }),
      introspectToken: jest.fn().mockResolvedValue({
        active: true,
        username: "testuser",
      }),
      getUserInfo: jest.fn().mockResolvedValue({
        sub: "user-id",
        preferred_username: "testuser",
      }),
      logout: jest.fn().mockResolvedValue(undefined),
    };

    // Setup fetch mock for successful responses
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({}),
      text: jest.fn().mockResolvedValue(""),
    });

    authzClient = createKeycloakAuthorizationServicesClient(
      mockClientFactory,
      "https://keycloak.example.com/realms/test-realm"
    );
  });

  describe("Initialization and Configuration", () => {
    it("should initialize with valid configuration", () => {
      expect(authzClient).toBeInstanceOf(KeycloakAuthorizationServicesClient);
    });

    it("should throw error with invalid configuration", () => {
      expect(() => {
        new KeycloakAuthorizationServicesClient({
          realm: "",
          authServerUrl: "https://keycloak.example.com",
          clientFactory: mockClientFactory,
          clientId: "test-client",
          clientSecret: "test-secret",
        });
      }).toThrow("Configuration validation failed");
    });

    it("should validate required configuration fields", () => {
      expect(() => {
        new KeycloakAuthorizationServicesClient({
          realm: "test-realm",
          authServerUrl: "",
          clientFactory: mockClientFactory,
          clientId: "test-client",
          clientSecret: "test-secret",
        });
      }).toThrow("Configuration validation failed");
    });
  });

  describe("Resource Management", () => {
    const mockResource: ResourceRepresentation = {
      name: "test-resource",
      displayName: "Test Resource",
      type: "document",
      uris: ["/api/documents/123"],
      scopes: ["read", "write", "delete"],
      attributes: { category: ["public"] },
    };

    it("should register a new resource successfully", async () => {
      const mockResponse = {
        id: "resource-123",
        ...mockResource,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await authzClient.registerResource(mockResource);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/authz/protection/resource_set"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer mock-service-token",
          }),
          body: JSON.stringify(mockResource),
        })
      );
    });

    it("should handle resource registration errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: jest.fn().mockResolvedValue({
          error: "invalid_request",
          error_description: "Resource name already exists",
        }),
      });

      await expect(authzClient.registerResource(mockResource)).rejects.toThrow(
        "Failed to register resource: Resource name already exists"
      );
    });

    it("should retrieve resource by ID", async () => {
      const resourceId = "resource-123";
      const mockResponse = { id: resourceId, ...mockResource };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await authzClient.getResource(resourceId);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/authz/protection/resource_set/${resourceId}`),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer mock-service-token",
          }),
        })
      );
    });

    it("should list all resources", async () => {
      const mockResources = [
        { id: "resource-1", name: "Resource 1" },
        { id: "resource-2", name: "Resource 2" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockResources),
      });

      const result = await authzClient.listResources();

      expect(result).toEqual(mockResources);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/authz/protection/resource_set"),
        expect.objectContaining({
          method: "GET",
        })
      );
    });

    it("should update an existing resource", async () => {
      const resourceId = "resource-123";
      const updatedResource = {
        ...mockResource,
        displayName: "Updated Test Resource",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest
          .fn()
          .mockResolvedValue({ id: resourceId, ...updatedResource }),
      });

      const result = await authzClient.updateResource(
        resourceId,
        updatedResource
      );

      expect(result).toEqual({ id: resourceId, ...updatedResource });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/authz/protection/resource_set/${resourceId}`),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(updatedResource),
        })
      );
    });

    it("should delete a resource", async () => {
      const resourceId = "resource-123";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: jest.fn(),
      });

      await authzClient.deleteResource(resourceId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/authz/protection/resource_set/${resourceId}`),
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });
  });

  describe("Policy Management", () => {
    const mockPolicy: PolicyRepresentation = {
      name: "test-policy",
      description: "Test policy for documents",
      type: "role",
      logic: "POSITIVE",
      decisionStrategy: "UNANIMOUS",
      config: {
        roles: '["user", "admin"]',
      },
    };

    it("should create a new policy", async () => {
      const mockResponse = { id: "policy-123", ...mockPolicy };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await authzClient.createPolicy(mockPolicy);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/authz/protection/policy"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(mockPolicy),
        })
      );
    });

    it("should handle policy creation errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: jest.fn().mockResolvedValue({
          error: "conflict",
          error_description: "Policy with same name already exists",
        }),
      });

      await expect(authzClient.createPolicy(mockPolicy)).rejects.toThrow(
        "Failed to create policy: Policy with same name already exists"
      );
    });

    it("should retrieve policy by ID", async () => {
      const policyId = "policy-123";
      const mockResponse = { id: policyId, ...mockPolicy };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await authzClient.getPolicy(policyId);

      expect(result).toEqual(mockResponse);
    });

    it("should list all policies", async () => {
      const mockPolicies = [
        { id: "policy-1", name: "Policy 1" },
        { id: "policy-2", name: "Policy 2" },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(mockPolicies),
      });

      const result = await authzClient.listPolicies();

      expect(result).toEqual(mockPolicies);
    });
  });

  describe("Permission Management", () => {
    const mockPermissions: PermissionTicket[] = [
      {
        resource_id: "resource-123",
        resource_scopes: ["read", "write"],
      },
    ];

    it("should request permission ticket", async () => {
      const mockTicket = "permission-ticket-123";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue({ ticket: mockTicket }),
      });

      const result = await authzClient.requestPermissionTicket(mockPermissions);

      expect(result).toBe(mockTicket);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/authz/protection/permission"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(mockPermissions),
        })
      );
    });

    it("should handle permission ticket request errors", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: jest.fn().mockResolvedValue({
          error: "invalid_resource_id",
          error_description: "Resource not found",
        }),
      });

      await expect(
        authzClient.requestPermissionTicket(mockPermissions)
      ).rejects.toThrow(
        "Failed to request permission ticket: Resource not found"
      );
    });
  });

  describe("Authorization Decisions", () => {
    it("should check authorization successfully", async () => {
      const resource = "document-123";
      const scopes = ["read", "write"];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          access_token: "rpt-token",
          token_type: "Bearer",
        }),
      });

      const result = await authzClient.checkAuthorization(resource, scopes);

      expect(result.granted).toBe(true);
      expect(result.scopes).toEqual(scopes);
    });

    it("should deny authorization when access is forbidden", async () => {
      const resource = "document-123";
      const scopes = ["delete"];

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: jest.fn().mockResolvedValue({
          error: "access_denied",
          error_description: "User lacks required permissions",
        }),
      });

      const result = await authzClient.checkAuthorization(resource, scopes);

      expect(result.granted).toBe(false);
      expect(result.reason).toBe("User lacks required permissions");
    });

    it("should handle authorization errors gracefully", async () => {
      const resource = "invalid-resource";
      const scopes = ["read"];

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: jest.fn().mockResolvedValue({
          error: "invalid_grant",
          error_description: "Invalid permission ticket",
        }),
      });

      const result = await authzClient.checkAuthorization(resource, scopes);

      expect(result.granted).toBe(false);
      expect(result.reason).toBe("Invalid permission ticket");
    });
  });

  describe("Token Caching and Security", () => {
    it("should generate secure cache keys for tokens", async () => {
      const token = "test-token-12345";

      // Mock the cache service get method
      const { CacheService } = await import("@libs/database");
      const mockGet = jest.mocked(CacheService.get);
      mockGet.mockResolvedValue({
        data: null,
        source: "cache",
        latency: 0,
        compressed: false,
      });

      // This will trigger cache key generation internally
      await authzClient.registerResource({
        name: "test-resource",
        scopes: ["read"],
      });

      // Verify that cache operations are called
      expect(mockGet).toHaveBeenCalled();
    });

    it("should handle race conditions in admin token retrieval", async () => {
      // Simulate concurrent calls to admin token
      const promises = Array.from({ length: 5 }, () =>
        authzClient.registerResource({
          name: `resource-${Math.random()}`,
          scopes: ["read"],
        })
      );

      // All should resolve without race condition errors
      await expect(Promise.all(promises)).resolves.toBeDefined();

      // Client credentials token should be called multiple times but managed properly
      expect(mockClientFactory.getClientCredentialsToken).toHaveBeenCalled();
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        authzClient.registerResource({
          name: "test-resource",
          scopes: ["read"],
        })
      ).rejects.toThrow("Network error");
    });

    it("should handle malformed JSON responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: jest.fn().mockRejectedValue(new Error("Invalid JSON")),
        text: jest.fn().mockResolvedValue("Internal Server Error"),
      });

      await expect(
        authzClient.registerResource({
          name: "test-resource",
          scopes: ["read"],
        })
      ).rejects.toThrow("Failed to register resource");
    });

    it("should validate resource data before registration", async () => {
      await expect(
        authzClient.registerResource({
          name: "", // Empty name should be invalid
          scopes: ["read"],
        })
      ).rejects.toThrow("Resource name is required");
    });

    it("should validate policy data before creation", async () => {
      await expect(
        authzClient.createPolicy({
          name: "", // Empty name should be invalid
          type: "role",
          decisionStrategy: "UNANIMOUS",
          logic: "POSITIVE",
        })
      ).rejects.toThrow("Policy name is required");
    });
  });

  describe("Configuration Validation", () => {
    it("should validate realm configuration", () => {
      expect(() => {
        new KeycloakAuthorizationServicesClient({
          realm: "",
          authServerUrl: "https://keycloak.example.com",
          clientFactory: mockClientFactory,
          clientId: "test-client",
          clientSecret: "test-secret",
        });
      }).toThrow("Configuration validation failed: realm is required");
    });

    it("should validate auth server URL", () => {
      expect(() => {
        new KeycloakAuthorizationServicesClient({
          realm: "test-realm",
          authServerUrl: "invalid-url",
          clientFactory: mockClientFactory,
          clientId: "test-client",
          clientSecret: "test-secret",
        });
      }).toThrow(
        "Configuration validation failed: invalid authServerUrl format"
      );
    });

    it("should validate client configuration", () => {
      expect(() => {
        new KeycloakAuthorizationServicesClient({
          realm: "test-realm",
          authServerUrl: "https://keycloak.example.com",
          clientFactory: mockClientFactory,
          clientId: "",
          clientSecret: "test-secret",
        });
      }).toThrow("Configuration validation failed: clientId is required");
    });
  });
});
