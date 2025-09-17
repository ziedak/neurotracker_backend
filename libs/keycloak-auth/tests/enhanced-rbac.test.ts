/**
 * Enhanced RBAC Service Tests
 * Comprehensive test suite for role hierarchy, permission evaluation, and policy synchronization
 */

import { jest } from "@jest/globals";
import { EnhancedRBACService } from "../src/services/enhanced-rbac";
import { KeycloakAuthorizationServicesClient } from "../src/services/keycloak-authorization-services";
import type {
  RoleHierarchy,
  PermissionScope,
  RBACDecision,
  RBACConfiguration,
  IKeycloakClientFactory,
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

jest.mock("../src/services/keycloak-authorization-services");

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("EnhancedRBACService", () => {
  let rbacService: EnhancedRBACService;
  let mockAuthzClient: jest.Mocked<KeycloakAuthorizationServicesClient>;
  let mockClientFactory: jest.Mocked<IKeycloakClientFactory>;

  const mockRoleHierarchy: RoleHierarchy = {
    "super-admin": {
      inherits: ["admin"],
      permissions: ["*"],
      description: "Super administrator with all permissions",
    },
    admin: {
      inherits: ["manager"],
      permissions: ["user_management", "system_config", "audit_read"],
      description: "System administrator",
    },
    manager: {
      inherits: ["user"],
      permissions: ["team_management", "reports_read", "analytics_read"],
      description: "Team manager",
    },
    user: {
      inherits: [],
      permissions: ["profile_read", "profile_write", "documents_read"],
      description: "Regular user",
    },
  };

  const mockPermissionScopes: PermissionScope[] = [
    {
      name: "user_management",
      description: "Manage users and roles",
      category: "administration",
      resources: ["users", "roles"],
    },
    {
      name: "documents_read",
      description: "Read documents",
      category: "documents",
      resources: ["documents"],
    },
    {
      name: "profile_write",
      description: "Edit own profile",
      category: "profile",
      resources: ["profile"],
    },
  ];

  const mockConfiguration: RBACConfiguration = {
    roleHierarchy: mockRoleHierarchy,
    permissionScopes: mockPermissionScopes,
    enableCaching: true,
    cacheTTL: 300,
    enablePolicySync: true,
    policySyncInterval: 3600,
  };

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

    // Create mock authorization services client
    mockAuthzClient = {
      checkAuthorization: jest.fn(),
      registerResource: jest.fn(),
      getResource: jest.fn(),
      listResources: jest.fn(),
      updateResource: jest.fn(),
      deleteResource: jest.fn(),
      createPolicy: jest.fn(),
      getPolicy: jest.fn(),
      listPolicies: jest.fn(),
      updatePolicy: jest.fn(),
      deletePolicy: jest.fn(),
      requestPermissionTicket: jest.fn(),
    } as any;

    // Mock the KeycloakAuthorizationServicesClient constructor
    const MockedAuthzClient = jest.mocked(KeycloakAuthorizationServicesClient);
    MockedAuthzClient.mockImplementation(() => mockAuthzClient);

    rbacService = new EnhancedRBACService({
      realm: "test-realm",
      authServerUrl: "https://keycloak.example.com",
      clientFactory: mockClientFactory,
      clientId: "test-client",
      clientSecret: "test-secret",
      configuration: mockConfiguration,
    });
  });

  describe("Initialization and Configuration", () => {
    it("should initialize with valid configuration", () => {
      expect(rbacService).toBeInstanceOf(EnhancedRBACService);
    });

    it("should validate role hierarchy on initialization", () => {
      const invalidHierarchy: RoleHierarchy = {
        "role-a": { inherits: ["role-b"], permissions: [] },
        "role-b": { inherits: ["role-a"], permissions: [] }, // Circular dependency
      };

      expect(() => {
        new EnhancedRBACService({
          realm: "test-realm",
          authServerUrl: "https://keycloak.example.com",
          clientFactory: mockClientFactory,
          clientId: "test-client",
          clientSecret: "test-secret",
          configuration: {
            ...mockConfiguration,
            roleHierarchy: invalidHierarchy,
          },
        });
      }).toThrow("Circular dependency detected in role hierarchy");
    });

    it("should handle empty role hierarchy", () => {
      expect(() => {
        new EnhancedRBACService({
          realm: "test-realm",
          authServerUrl: "https://keycloak.example.com",
          clientFactory: mockClientFactory,
          clientId: "test-client",
          clientSecret: "test-secret",
          configuration: {
            ...mockConfiguration,
            roleHierarchy: {},
          },
        });
      }).not.toThrow();
    });
  });

  describe("Role Hierarchy Management", () => {
    it("should expand roles with inheritance", () => {
      const userRoles = ["manager"];
      const expandedRoles = rbacService.expandRoles(userRoles);

      expect(expandedRoles).toContain("manager");
      expect(expandedRoles).toContain("user"); // Inherited
      expect(expandedRoles).not.toContain("admin"); // Not inherited
    });

    it("should handle multiple role expansion", () => {
      const userRoles = ["admin", "user"];
      const expandedRoles = rbacService.expandRoles(userRoles);

      expect(expandedRoles).toContain("admin");
      expect(expandedRoles).toContain("manager"); // From admin inheritance
      expect(expandedRoles).toContain("user"); // Both direct and inherited
    });

    it("should handle roles not in hierarchy", () => {
      const userRoles = ["external-role", "user"];
      const expandedRoles = rbacService.expandRoles(userRoles);

      expect(expandedRoles).toContain("external-role"); // Kept as-is
      expect(expandedRoles).toContain("user");
    });

    it("should detect circular dependencies in role hierarchy", () => {
      // This should be caught during initialization, but test the method directly
      const circularHierarchy: RoleHierarchy = {
        "role-a": { inherits: ["role-b"], permissions: [] },
        "role-b": { inherits: ["role-c"], permissions: [] },
        "role-c": { inherits: ["role-a"], permissions: [] },
      };

      expect(() => {
        rbacService["detectCircularDependency"](circularHierarchy);
      }).toThrow("Circular dependency detected");
    });

    it("should calculate effective permissions from roles", () => {
      const userRoles = ["admin"];
      const permissions = rbacService.getEffectivePermissions(userRoles);

      expect(permissions).toContain("user_management");
      expect(permissions).toContain("system_config");
      expect(permissions).toContain("audit_read");
      // Should also include inherited permissions
      expect(permissions).toContain("team_management");
      expect(permissions).toContain("profile_read");
    });

    it("should handle wildcard permissions", () => {
      const userRoles = ["super-admin"];
      const permissions = rbacService.getEffectivePermissions(userRoles);

      expect(permissions).toContain("*");
    });
  });

  describe("Permission Evaluation", () => {
    it("should allow access with direct permission", async () => {
      const mockJWT = createMockJWT({ roles: ["user"] });
      const result = await rbacService.checkPermission(
        mockJWT,
        "documents_read",
        "document-123"
      );

      expect(result.allowed).toBe(true);
      expect(result.effectiveRoles).toContain("user");
      expect(result.effectivePermissions).toContain("documents_read");
    });

    it("should allow access with inherited permission", async () => {
      const mockJWT = createMockJWT({ roles: ["manager"] });
      const result = await rbacService.checkPermission(
        mockJWT,
        "documents_read",
        "document-123"
      );

      expect(result.allowed).toBe(true);
      expect(result.effectiveRoles).toContain("manager");
      expect(result.effectiveRoles).toContain("user"); // Inherited
    });

    it("should deny access without permission", async () => {
      const mockJWT = createMockJWT({ roles: ["user"] });
      const result = await rbacService.checkPermission(
        mockJWT,
        "user_management",
        "users"
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("insufficient permissions");
    });

    it("should allow access with wildcard permission", async () => {
      const mockJWT = createMockJWT({ roles: ["super-admin"] });
      const result = await rbacService.checkPermission(
        mockJWT,
        "any_permission",
        "any-resource"
      );

      expect(result.allowed).toBe(true);
      expect(result.effectivePermissions).toContain("*");
    });

    it("should integrate with Keycloak authorization services", async () => {
      mockAuthzClient.checkAuthorization.mockResolvedValue({
        granted: true,
        scopes: ["read"],
      });

      const mockJWT = createMockJWT({ roles: ["user"] });
      const result = await rbacService.checkPermission(
        mockJWT,
        "documents_read",
        "document-123"
      );

      expect(result.allowed).toBe(true);
      expect(mockAuthzClient.checkAuthorization).toHaveBeenCalledWith(
        "document-123",
        ["read"],
        expect.any(Object)
      );
    });

    it("should handle Keycloak authorization denial", async () => {
      mockAuthzClient.checkAuthorization.mockResolvedValue({
        granted: false,
        reason: "Resource access denied",
      });

      const mockJWT = createMockJWT({ roles: ["user"] });
      const result = await rbacService.checkPermission(
        mockJWT,
        "documents_read",
        "document-123"
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Resource access denied");
    });
  });

  describe("JWT Token Handling", () => {
    it("should extract roles from JWT token", () => {
      const token = createMockJWT({
        roles: ["admin", "user"],
        resource_access: {
          "test-client": { roles: ["client-role"] },
        },
      });

      const roles = rbacService["extractUserRoles"](token);

      expect(roles).toContain("admin");
      expect(roles).toContain("user");
      expect(roles).toContain("client-role");
    });

    it("should handle malformed JWT tokens safely", () => {
      const invalidToken = "invalid.jwt.token";
      const roles = rbacService["extractUserRoles"](invalidToken);

      expect(roles).toEqual([]);
    });

    it("should handle JWT without roles", () => {
      const token = createMockJWT({ sub: "user-123" }); // No roles
      const roles = rbacService["extractUserRoles"](token);

      expect(roles).toEqual([]);
    });

    it("should extract roles from both realm and resource access", () => {
      const token = createMockJWT({
        realm_access: { roles: ["realm-admin"] },
        resource_access: {
          "test-client": { roles: ["client-user"] },
          "other-client": { roles: ["other-role"] },
        },
      });

      const roles = rbacService["extractUserRoles"](token);

      expect(roles).toContain("realm-admin");
      expect(roles).toContain("client-user");
      expect(roles).not.toContain("other-role"); // Different client
    });
  });

  describe("Policy Synchronization", () => {
    it("should sync policies to Keycloak", async () => {
      mockAuthzClient.createPolicy.mockResolvedValue({
        id: "policy-123",
        name: "role-admin-policy",
      });

      await rbacService.syncPoliciesToKeycloak();

      expect(mockAuthzClient.createPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringMatching(/role-.+-policy/),
          type: "role",
        })
      );
    });

    it("should handle policy sync errors gracefully", async () => {
      mockAuthzClient.createPolicy.mockRejectedValue(
        new Error("Policy already exists")
      );

      // Should not throw, but log the error
      await expect(
        rbacService.syncPoliciesToKeycloak()
      ).resolves.toBeUndefined();
    });

    it("should create permission policies for scopes", async () => {
      mockAuthzClient.createPolicy.mockResolvedValue({ id: "policy-123" });

      await rbacService.syncPoliciesToKeycloak();

      // Should create policies for each permission scope
      expect(mockAuthzClient.createPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.stringContaining("permission"),
          type: "role",
        })
      );
    });
  });

  describe("Caching and Performance", () => {
    it("should cache permission decisions", async () => {
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

      const mockJWT = createMockJWT({ roles: ["user"] });
      await rbacService.checkPermission(
        mockJWT,
        "documents_read",
        "document-123"
      );

      expect(mockSet).toHaveBeenCalled();

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

      const result = await rbacService.checkPermission(
        mockJWT,
        "documents_read",
        "document-123"
      );

      expect(result.allowed).toBe(true);
    });

    it("should generate secure cache keys", () => {
      const token = "sample-jwt-token";
      const permission = "documents_read";
      const resource = "document-123";

      const cacheKey = rbacService["buildCacheKey"](
        token,
        permission,
        resource
      );

      expect(cacheKey).toContain("rbac:");
      expect(cacheKey).toContain(permission);
      expect(cacheKey).toContain(resource);
      // Should contain hash of token for security
      expect(cacheKey.length).toBeGreaterThan(50);
    });

    it("should invalidate cache on role hierarchy changes", async () => {
      const { CacheService } = await import("@libs/database");
      const mockInvalidate = jest.mocked(CacheService.invalidate);

      await rbacService.updateRoleHierarchy({
        "new-role": { inherits: [], permissions: ["new-permission"] },
      });

      expect(mockInvalidate).toHaveBeenCalledWith("rbac:*");
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("should handle empty JWT token", async () => {
      const result = await rbacService.checkPermission(
        "",
        "documents_read",
        "document-123"
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Invalid or missing token");
    });

    it("should handle undefined permission", async () => {
      const mockJWT = createMockJWT({ roles: ["user"] });
      const result = await rbacService.checkPermission(
        mockJWT,
        "",
        "document-123"
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Permission is required");
    });

    it("should handle network errors in authorization check", async () => {
      mockAuthzClient.checkAuthorization.mockRejectedValue(
        new Error("Network timeout")
      );

      const mockJWT = createMockJWT({ roles: ["user"] });
      const result = await rbacService.checkPermission(
        mockJWT,
        "documents_read",
        "document-123"
      );

      // Should fall back to role-based check only
      expect(result.allowed).toBe(true); // User has documents_read permission
    });

    it("should validate role hierarchy updates", () => {
      const invalidHierarchy: RoleHierarchy = {
        "role-a": { inherits: ["role-b"], permissions: [] },
        "role-b": { inherits: ["role-a"], permissions: [] },
      };

      expect(() => {
        rbacService.updateRoleHierarchy(invalidHierarchy);
      }).toThrow("Circular dependency detected");
    });
  });

  describe("Advanced Permission Scenarios", () => {
    it("should handle complex role inheritance chains", () => {
      // Test deep inheritance chain
      const userRoles = ["super-admin"];
      const expandedRoles = rbacService.expandRoles(userRoles);

      expect(expandedRoles).toContain("super-admin");
      expect(expandedRoles).toContain("admin");
      expect(expandedRoles).toContain("manager");
      expect(expandedRoles).toContain("user");
    });

    it("should handle permission context in decisions", async () => {
      mockAuthzClient.checkAuthorization.mockResolvedValue({
        granted: true,
        context: { owner: "user-123" },
      });

      const mockJWT = createMockJWT({
        roles: ["user"],
        sub: "user-123",
      });

      const result = await rbacService.checkPermission(
        mockJWT,
        "documents_read",
        "document-123",
        { owner: "user-123" }
      );

      expect(result.allowed).toBe(true);
      expect(result.context).toEqual({ owner: "user-123" });
    });

    it("should provide detailed decision information", async () => {
      const mockJWT = createMockJWT({ roles: ["admin"] });
      const result = await rbacService.checkPermission(
        mockJWT,
        "user_management",
        "users"
      );

      expect(result).toMatchObject({
        allowed: true,
        effectiveRoles: expect.arrayContaining(["admin", "manager", "user"]),
        effectivePermissions: expect.arrayContaining(["user_management"]),
        matchedPolicies: expect.any(Array),
      });
    });
  });

  // Helper function to create mock JWT tokens
  function createMockJWT(payload: any): string {
    const header = { alg: "HS256", typ: "JWT" };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
      "base64"
    );
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64"
    );
    const signature = "mock-signature";

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }
});
