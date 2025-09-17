/**
 * Integration Tests for Authorization Services and Enhanced RBAC
 * Tests the complete authorization flow with UMA 2.0 and role hierarchy
 */

import { jest } from "@jest/globals";
import { KeycloakAuthorizationServicesClient } from "../src/services/keycloak-authorization-services";
import { EnhancedRBACService } from "../src/services/enhanced-rbac";
import type {
  IKeycloakClientFactory,
  RoleHierarchy,
  RBACConfiguration,
} from "../src/types";

// Mock dependencies
jest.mock("@libs/utils");
jest.mock("@libs/database");

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("Authorization Services Integration", () => {
  let authzClient: KeycloakAuthorizationServicesClient;
  let rbacService: EnhancedRBACService;
  let mockClientFactory: jest.Mocked<IKeycloakClientFactory>;

  const mockRoleHierarchy: RoleHierarchy =
    global.testUtils.createMockRoleHierarchy();

  const mockConfiguration: RBACConfiguration = {
    roleHierarchy: mockRoleHierarchy,
    permissionScopes: global.testUtils.createMockPermissionScopes(),
    enableCaching: true,
    cacheTTL: 300,
    enablePolicySync: true,
    policySyncInterval: 3600,
  };

  beforeEach(() => {
    jest.clearAllMocks();

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

    // Initialize services
    authzClient = new KeycloakAuthorizationServicesClient({
      realm: "test-realm",
      authServerUrl: "https://keycloak.example.com",
      clientFactory: mockClientFactory,
      clientId: "test-client",
      clientSecret: "test-secret",
    });

    rbacService = new EnhancedRBACService({
      realm: "test-realm",
      authServerUrl: "https://keycloak.example.com",
      clientFactory: mockClientFactory,
      clientId: "test-client",
      clientSecret: "test-secret",
      configuration: mockConfiguration,
    });
  });

  describe("Complete Authorization Flow", () => {
    it("should perform end-to-end authorization with role hierarchy", async () => {
      // Setup: Register a resource
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue({
          id: "resource-123",
          name: "user-management-resource",
          scopes: ["read", "write", "delete"],
        }),
      });

      const resource = await authzClient.registerResource({
        name: "user-management-resource",
        type: "api",
        scopes: ["read", "write", "delete"],
      });

      expect(resource.id).toBe("resource-123");

      // Setup: Create a policy for the resource
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue({
          id: "policy-123",
          name: "admin-access-policy",
          type: "role",
        }),
      });

      const policy = await authzClient.createPolicy({
        name: "admin-access-policy",
        type: "role",
        logic: "POSITIVE",
        decisionStrategy: "UNANIMOUS",
        config: {
          roles: '["admin"]',
        },
      });

      expect(policy.id).toBe("policy-123");

      // Test: Check permission with role hierarchy
      const userToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["manager"] }, // Manager inherits from user
        sub: "user-123",
      });

      // Mock Keycloak authorization response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          access_token: "rpt-token",
          token_type: "Bearer",
        }),
      });

      const decision = await rbacService.checkPermission(
        userToken,
        "user_management", // This permission is available to admin role
        "user-management-resource"
      );

      // Manager inherits from user but doesn't have user_management permission
      expect(decision.allowed).toBe(false);
      expect(decision.effectiveRoles).toContain("manager");
      expect(decision.effectiveRoles).toContain("user");
    });

    it("should allow access with proper role inheritance", async () => {
      const adminToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["admin"] },
        sub: "admin-123",
      });

      // Mock successful Keycloak authorization
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          access_token: "rpt-token",
          token_type: "Bearer",
        }),
      });

      const decision = await rbacService.checkPermission(
        adminToken,
        "user_management",
        "user-management-resource"
      );

      expect(decision.allowed).toBe(true);
      expect(decision.effectiveRoles).toContain("admin");
      expect(decision.effectiveRoles).toContain("manager");
      expect(decision.effectiveRoles).toContain("user");
      expect(decision.effectivePermissions).toContain("user_management");
    });

    it("should handle super-admin wildcard permissions", async () => {
      const superAdminToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["super-admin"] },
        sub: "super-admin-123",
      });

      const decision = await rbacService.checkPermission(
        superAdminToken,
        "any_permission", // Should be allowed due to wildcard
        "any-resource"
      );

      expect(decision.allowed).toBe(true);
      expect(decision.effectivePermissions).toContain("*");
      expect(decision.effectiveRoles).toContain("super-admin");
    });
  });

  describe("Policy Synchronization Integration", () => {
    it("should sync RBAC policies to Keycloak Authorization Services", async () => {
      // Mock policy creation responses
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue({
            id: "role-admin-policy",
            name: "role-admin-policy",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: jest.fn().mockResolvedValue({
            id: "role-manager-policy",
            name: "role-manager-policy",
          }),
        });

      await rbacService.syncPoliciesToKeycloak();

      // Verify policies were created
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/authz/protection/policy"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("role-admin-policy"),
        })
      );
    });

    it("should handle policy sync conflicts gracefully", async () => {
      // Mock conflict response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: jest.fn().mockResolvedValue({
          error: "conflict",
          error_description: "Policy already exists",
        }),
      });

      // Should not throw error but log warning
      await expect(
        rbacService.syncPoliciesToKeycloak()
      ).resolves.toBeUndefined();
    });
  });

  describe("Resource-Based Authorization", () => {
    it("should check authorization for specific resource instances", async () => {
      // Register a document resource
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue({
          id: "document-123",
          name: "confidential-document",
          scopes: ["read", "write"],
          attributes: { confidentiality: ["high"] },
        }),
      });

      const document = await authzClient.registerResource({
        name: "confidential-document",
        type: "document",
        scopes: ["read", "write"],
        attributes: { confidentiality: ["high"] },
      });

      // User with regular role tries to access
      const userToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["user"] },
        sub: "user-123",
      });

      // Mock Keycloak denial for confidential resource
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: jest.fn().mockResolvedValue({
          error: "access_denied",
          error_description:
            "Insufficient permissions for confidential resource",
        }),
      });

      const decision = await rbacService.checkPermission(
        userToken,
        "documents_read",
        "confidential-document"
      );

      // User has documents_read permission but Keycloak denies based on resource attributes
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("Insufficient permissions");
    });

    it("should allow access with proper resource permissions", async () => {
      const adminToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["admin"] },
        sub: "admin-123",
      });

      // Mock Keycloak approval
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          access_token: "rpt-token",
          token_type: "Bearer",
        }),
      });

      const decision = await rbacService.checkPermission(
        adminToken,
        "documents_read",
        "confidential-document"
      );

      expect(decision.allowed).toBe(true);
    });
  });

  describe("Caching and Performance Integration", () => {
    it("should cache authorization decisions across services", async () => {
      const { CacheService } = await import("@libs/database");
      const mockGet = jest.mocked(CacheService.get);
      const mockSet = jest.mocked(CacheService.set);

      // First call - cache miss
      mockGet.mockResolvedValueOnce({
        data: null,
        source: "cache",
        latency: 0,
        compressed: false,
      });

      const userToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["user"] },
        sub: "user-123",
      });

      await rbacService.checkPermission(
        userToken,
        "documents_read",
        "document-123"
      );

      expect(mockSet).toHaveBeenCalledWith(
        expect.stringContaining("rbac:"),
        expect.any(Object),
        300 // Cache TTL
      );

      // Second call - cache hit
      mockGet.mockResolvedValueOnce({
        data: {
          allowed: true,
          effectiveRoles: ["user"],
          effectivePermissions: ["documents_read"],
          matchedPolicies: [],
        },
        source: "cache",
        latency: 1,
        compressed: false,
      });

      const cachedDecision = await rbacService.checkPermission(
        userToken,
        "documents_read",
        "document-123"
      );

      expect(cachedDecision.allowed).toBe(true);
      // Should not call Keycloak again
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/protocol/openid-connect/token")
      );
    });
  });

  describe("Error Handling Integration", () => {
    it("should gracefully degrade when Keycloak is unavailable", async () => {
      // Simulate network error
      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const userToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["user"] },
        sub: "user-123",
      });

      const decision = await rbacService.checkPermission(
        userToken,
        "documents_read",
        "document-123"
      );

      // Should fall back to role-based authorization only
      expect(decision.allowed).toBe(true); // User has documents_read permission
      expect(decision.reason).not.toContain("Network timeout");
    });

    it("should handle malformed tokens gracefully", async () => {
      const invalidToken = "invalid.jwt.token";

      const decision = await rbacService.checkPermission(
        invalidToken,
        "documents_read",
        "document-123"
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("Invalid or missing token");
    });

    it("should validate resource and permission parameters", async () => {
      const userToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["user"] },
        sub: "user-123",
      });

      // Test empty permission
      const emptyPermissionDecision = await rbacService.checkPermission(
        userToken,
        "",
        "document-123"
      );

      expect(emptyPermissionDecision.allowed).toBe(false);
      expect(emptyPermissionDecision.reason).toContain(
        "Permission is required"
      );

      // Test invalid resource registration
      await expect(
        authzClient.registerResource({
          name: "",
          scopes: ["read"],
        })
      ).rejects.toThrow("Resource name is required");
    });
  });

  describe("Advanced Authorization Scenarios", () => {
    it("should handle context-based authorization", async () => {
      const userToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["user"] },
        sub: "user-123",
      });

      // Mock Keycloak response with context
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          access_token: "rpt-token",
          token_type: "Bearer",
        }),
      });

      const decision = await rbacService.checkPermission(
        userToken,
        "documents_read",
        "user-document-123",
        { owner: "user-123", department: "engineering" }
      );

      expect(decision.allowed).toBe(true);
      expect(decision.context).toBeDefined();
    });

    it("should handle permission tickets for UMA 2.0 flow", async () => {
      // Request permission ticket
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: jest.fn().mockResolvedValue({
          ticket: "permission-ticket-123",
        }),
      });

      const ticket = await authzClient.requestPermissionTicket([
        {
          resource_id: "protected-resource",
          resource_scopes: ["read", "write"],
        },
      ]);

      expect(ticket).toBe("permission-ticket-123");

      // Use ticket for authorization
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          access_token: "rpt-token",
          token_type: "Bearer",
        }),
      });

      const decision = await authzClient.checkAuthorization(
        "protected-resource",
        ["read", "write"]
      );

      expect(decision.granted).toBe(true);
    });
  });

  describe("Performance and Scalability", () => {
    it("should handle concurrent authorization requests", async () => {
      const userToken = global.testUtils.createMockJWT({
        realm_access: { roles: ["user"] },
        sub: "user-123",
      });

      // Mock successful responses for all requests
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
          access_token: "rpt-token",
          token_type: "Bearer",
        }),
      });

      // Make 10 concurrent requests
      const promises = Array.from({ length: 10 }, (_, i) =>
        rbacService.checkPermission(
          userToken,
          "documents_read",
          `document-${i}`
        )
      );

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((result) => {
        expect(result.allowed).toBe(true);
      });

      // Should not cause race conditions
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should efficiently manage token caching", async () => {
      const { CacheService } = await import("@libs/database");
      const mockGet = jest.mocked(CacheService.get);

      // Multiple requests with same token should use cached admin token
      mockGet.mockResolvedValue({
        data: "cached-service-token",
        source: "cache",
        latency: 1,
        compressed: false,
      });

      await authzClient.registerResource({
        name: "resource-1",
        scopes: ["read"],
      });

      await authzClient.registerResource({
        name: "resource-2",
        scopes: ["read"],
      });

      // Should reuse cached service token
      expect(mockClientFactory.getClientCredentialsToken).toHaveBeenCalledTimes(
        1
      );
    });
  });
});
