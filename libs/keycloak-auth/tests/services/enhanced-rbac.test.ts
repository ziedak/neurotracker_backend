/**
 * Enhanced RBAC Service Test Suite
 */

import {
  EnhancedRBACService,
  createEnhancedRBACService,
  RBACHelpers,
  type RoleHierarchy,
  type RBACDecision,
} from "../../src/services/enhanced-rbac";
import {
  KeycloakAuthorizationServicesClient,
  type AuthorizationDecision,
} from "../../src/services/keycloak-authorization-services";
import { CacheService } from "@libs/database";

// Mock dependencies
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// Mock the database module
jest.mock("@libs/database", () => ({
  CacheService: jest.fn(),
}));

describe("EnhancedRBACService", () => {
  let rbacService: EnhancedRBACService;
  let mockAuthzClient: jest.Mocked<KeycloakAuthorizationServicesClient>;
  let mockCacheService: jest.Mocked<CacheService>;

  const MOCK_ACCESS_TOKEN =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsidXNlciJdfSwicmVzb3VyY2VfYWNjZXNzIjp7InRlc3QtY2xpZW50Ijp7InJvbGVzIjpbImFwcF91c2VyIl19fX0.signature";

  const MOCK_ADMIN_TOKEN =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyZWFsbV9hY2Nlc3MiOnsicm9sZXMiOlsiYWRtaW4iXX0sInJlc291cmNlX2FjY2VzcyI6eyJ0ZXN0LWNsaWVudCI6eyJyb2xlcyI6WyJhcHBfYWRtaW4iXX19fQ.signature";

  const mockHierarchy: RoleHierarchy = {
    admin: {
      inherits: ["user"],
      permissions: ["resource:*", "user:manage"],
      description: "Administrator",
    },
    user: {
      inherits: [],
      permissions: ["resource:read", "profile:update"],
      description: "Standard user",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock authorization client
    mockAuthzClient = {
      checkAuthorization: jest.fn(),
      createPolicy: jest.fn(),
    } as any;

    // Setup mock cache service
    mockCacheService = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      invalidate: jest.fn(),
      invalidatePattern: jest.fn(),
      clear: jest.fn(),
      getStats: jest.fn(),
      isEnabled: jest.fn(),
      healthCheck: jest.fn(),
      dispose: jest.fn(),
      warmup: jest.fn(),
      warmupAll: jest.fn(),
      startBackgroundWarming: jest.fn(),
      stopBackgroundWarming: jest.fn(),
      getWarmingStats: jest.fn(),
      getRecommendedKeys: jest.fn(),
    } as any;
    mockCacheService.get.mockResolvedValue({
      data: null,
      source: "miss",
      latency: 0,
      compressed: false,
    });
    mockCacheService.set.mockResolvedValue(undefined);
    mockCacheService.invalidate.mockResolvedValue(undefined);
    mockCacheService.invalidatePattern.mockResolvedValue(3);
    mockCacheService.isEnabled.mockResolvedValue(true);
    mockCacheService.healthCheck.mockResolvedValue({
      status: "healthy",
      capacity: "ok",
      hitRate: 0.95,
      entryCount: 10,
    });
    mockCacheService.getStats.mockReturnValue({
      Hits: 95,
      Misses: 5,
      totalRequests: 100,
      hitRate: 0.95,
      memoryUsage: 1024,
      entryCount: 10,
      invalidations: 2,
      compressions: 0,
    });

    // Create RBAC service
    rbacService = new EnhancedRBACService(
      mockAuthzClient,
      mockHierarchy,
      mockCacheService,
      {
        enableRoleHierarchy: true,
        enableDynamicPermissions: true,
        enablePolicyCaching: true,
      }
    );
  });

  describe("Constructor and Initialization", () => {
    it("should initialize with default configuration", () => {
      const service = new EnhancedRBACService(mockAuthzClient);
      expect(service).toBeInstanceOf(EnhancedRBACService);
    });

    it("should initialize with custom configuration", () => {
      const service = new EnhancedRBACService(
        mockAuthzClient,
        mockHierarchy,
        mockCacheService,
        {
          enableRoleHierarchy: false,
          enableDynamicPermissions: false,
        }
      );
      expect(service).toBeInstanceOf(EnhancedRBACService);
    });

    it("should setup default role hierarchy", () => {
      rbacService.setupDefaultRoleHierarchy();
      // Should complete without errors
      expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith(
        "role_expansion:*"
      );
    });
  });

  describe("Permission Checking", () => {
    it("should allow access when Keycloak authorization grants permission", async () => {
      const mockAuthzDecision: AuthorizationDecision = {
        granted: true,
        scopes: ["read"],
      };

      mockAuthzClient.checkAuthorization.mockResolvedValueOnce(
        mockAuthzDecision
      );

      const decision = await rbacService.checkPermission(
        MOCK_ACCESS_TOKEN,
        "document",
        "read"
      );

      expect(decision.allowed).toBe(true);
      expect(decision.effectiveRoles).toContain("user");
      expect(decision.effectiveRoles).toContain("app_user");
      expect(decision.matchedPolicies).toContain("keycloak_authz");
    });

    it("should allow access through role hierarchy when Keycloak denies", async () => {
      const mockAuthzDecision: AuthorizationDecision = {
        granted: false,
        reason: "access_denied",
      };

      mockAuthzClient.checkAuthorization.mockResolvedValueOnce(
        mockAuthzDecision
      );

      const decision = await rbacService.checkPermission(
        MOCK_ADMIN_TOKEN,
        "resource",
        "read"
      );

      expect(decision.allowed).toBe(true); // Should be allowed through hierarchy
      expect(decision.effectiveRoles).toContain("admin");
      expect(decision.effectiveRoles).toContain("user"); // Inherited
      expect(decision.effectivePermissions).toContain("resource:*");
    });

    it("should deny access when no permissions match", async () => {
      const mockAuthzDecision: AuthorizationDecision = {
        granted: false,
        reason: "insufficient_permissions",
      };

      mockAuthzClient.checkAuthorization.mockResolvedValueOnce(
        mockAuthzDecision
      );

      const decision = await rbacService.checkPermission(
        MOCK_ACCESS_TOKEN,
        "admin_panel",
        "access"
      );

      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("insufficient permissions");
    });

    it("should use cached decisions", async () => {
      const cachedDecision: RBACDecision = {
        allowed: true,
        effectiveRoles: ["user"],
        effectivePermissions: ["resource:read"],
        matchedPolicies: ["cached"],
      };

      mockCacheService.get.mockResolvedValueOnce({
        data: cachedDecision,
        source: "cache",
        latency: 1,
        compressed: false,
      });

      const decision = await rbacService.checkPermission(
        MOCK_ACCESS_TOKEN,
        "resource",
        "read"
      );

      expect(decision).toEqual(cachedDecision);
      expect(mockAuthzClient.checkAuthorization).not.toHaveBeenCalled();
    });

    it("should cache permission decisions", async () => {
      const mockAuthzDecision: AuthorizationDecision = {
        granted: true,
        scopes: ["read"],
      };

      mockAuthzClient.checkAuthorization.mockResolvedValueOnce(
        mockAuthzDecision
      );

      await rbacService.checkPermission(MOCK_ACCESS_TOKEN, "resource", "read");

      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining("rbac:"),
        expect.objectContaining({ allowed: true }),
        300
      );
    });

    it("should handle permission check errors gracefully", async () => {
      mockAuthzClient.checkAuthorization.mockRejectedValueOnce(
        new Error("Network error")
      );

      const decision = await rbacService.checkPermission(
        MOCK_ACCESS_TOKEN,
        "resource",
        "read"
      );

      expect(decision.allowed).toBe(true); // Should fall back to role-based check
      expect(decision.reason).toBe("authorized_via_fallback");
      expect(decision.context?.["error"]).toContain("Network error");
    });
  });

  describe("Multiple Permission Checking", () => {
    it("should check multiple permissions in parallel", async () => {
      const mockDecisions: AuthorizationDecision[] = [
        { granted: true, scopes: ["read"] },
        { granted: false, reason: "access_denied" },
        { granted: true, scopes: ["write"] },
      ];

      mockAuthzClient.checkAuthorization
        .mockResolvedValueOnce(mockDecisions[0]!)
        .mockResolvedValueOnce(mockDecisions[1]!)
        .mockResolvedValueOnce(mockDecisions[2]!);

      const checks = [
        { resource: "doc1", action: "read" },
        { resource: "doc2", action: "delete" },
        { resource: "doc3", action: "write" },
      ];

      const results = await rbacService.checkMultiplePermissions(
        MOCK_ADMIN_TOKEN,
        checks
      );

      expect(results.size).toBe(3);
      expect(results.get("doc1:read")?.allowed).toBe(true);
      expect(results.get("doc2:delete")?.allowed).toBe(true); // Through hierarchy
      expect(results.get("doc3:write")?.allowed).toBe(true);
    });
  });

  describe("Role Hierarchy Management", () => {
    it("should expand roles based on hierarchy", async () => {
      const effectiveRoles = await rbacService.getUserEffectiveRoles(
        MOCK_ADMIN_TOKEN
      );

      expect(effectiveRoles).toContain("admin");
      expect(effectiveRoles).toContain("user"); // Inherited
      expect(effectiveRoles).toContain("app_admin");
    });

    it("should detect circular dependencies", () => {
      const circularHierarchy: RoleHierarchy = {
        role_a: {
          inherits: ["role_b"],
          permissions: [],
        },
        role_b: {
          inherits: ["role_a"], // Circular!
          permissions: [],
        },
      };

      const validation = RBACHelpers.validateHierarchy(circularHierarchy);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain(
        "Circular dependency detected: role_a"
      );
    });

    it("should update role hierarchy and clear cache", () => {
      const newHierarchy: RoleHierarchy = {
        super_admin: {
          inherits: ["admin"],
          permissions: ["system:*"],
        },
      };

      rbacService.updateRoleHierarchy(newHierarchy);

      expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith(
        "role_expansion:*"
      );
    });
  });

  describe("Permission Scope Management", () => {
    it("should register permission scopes", () => {
      const scope = {
        name: "document:read",
        description: "Read document permissions",
        category: "document",
        resources: ["document", "file"],
      };

      rbacService.registerPermissionScope(scope);

      // Should complete without errors
      expect(true).toBe(true);
    });
  });

  describe("Policy Synchronization", () => {
    it("should sync policies to Keycloak", async () => {
      mockAuthzClient.createPolicy.mockResolvedValue({
        id: "policy-123",
        name: "test-policy",
        type: "role",
      });

      await rbacService.syncPoliciesToKeycloak();

      expect(mockAuthzClient.createPolicy).toHaveBeenCalledTimes(3); // 2 roles + 1 inheritance policy
    });

    it("should handle policy sync failures gracefully", async () => {
      mockAuthzClient.createPolicy.mockRejectedValue(
        new Error("Policy exists")
      );

      await rbacService.syncPoliciesToKeycloak();

      // Should complete without throwing
      expect(mockAuthzClient.createPolicy).toHaveBeenCalled();
    });
  });

  describe("Context and Audit Logging", () => {
    it("should include authorization context in permission checks", async () => {
      const context = {
        userId: "test-user",
        clientId: "test-client",
        ipAddress: "127.0.0.1",
      };

      mockAuthzClient.checkAuthorization.mockResolvedValueOnce({
        granted: true,
        scopes: ["read"],
      });

      await rbacService.checkPermission(
        MOCK_ACCESS_TOKEN,
        "resource",
        "read",
        context
      );

      expect(mockAuthzClient.checkAuthorization).toHaveBeenCalledWith(
        MOCK_ACCESS_TOKEN,
        "resource",
        ["read"],
        context
      );
    });

    it("should provide detailed decision context", async () => {
      mockAuthzClient.checkAuthorization.mockResolvedValueOnce({
        granted: false,
        reason: "access_denied",
      });

      const decision = await rbacService.checkPermission(
        MOCK_ADMIN_TOKEN,
        "resource",
        "read"
      );

      expect(decision.context).toEqual(
        expect.objectContaining({
          originalAuthzDecision: expect.any(Object),
          userRoles: expect.any(Array),
          expandedRoles: expect.any(Boolean),
        })
      );
    });
  });

  describe("Factory Function", () => {
    it("should create RBAC service with factory function", () => {
      const service = createEnhancedRBACService(
        mockAuthzClient,
        mockHierarchy,
        mockCacheService
      );

      expect(service).toBeInstanceOf(EnhancedRBACService);
    });
  });

  describe("Configuration Handling", () => {
    it("should work without role hierarchy when disabled", async () => {
      const noHierarchyService = new EnhancedRBACService(
        mockAuthzClient,
        mockHierarchy,
        mockCacheService,
        {
          enableRoleHierarchy: false,
          enableDynamicPermissions: false,
        }
      );

      mockAuthzClient.checkAuthorization.mockResolvedValueOnce({
        granted: false,
        reason: "access_denied",
      });

      const decision = await noHierarchyService.checkPermission(
        MOCK_ACCESS_TOKEN,
        "resource",
        "admin"
      );

      expect(decision.allowed).toBe(false);
      expect(decision.effectiveRoles).toEqual([]);
    });

    it("should work without cache service", async () => {
      const noCacheService = new EnhancedRBACService(
        mockAuthzClient,
        mockHierarchy
      );

      mockAuthzClient.checkAuthorization.mockResolvedValueOnce({
        granted: true,
        scopes: ["read"],
      });

      const decision = await noCacheService.checkPermission(
        MOCK_ACCESS_TOKEN,
        "resource",
        "read"
      );

      expect(decision.allowed).toBe(true);
    });
  });
});

describe("RBACHelpers", () => {
  describe("Hierarchy Creation", () => {
    it("should create simple hierarchy", () => {
      const hierarchy = RBACHelpers.createSimpleHierarchy();

      expect(hierarchy?.["admin"]?.inherits).toContain("user");
      expect(hierarchy?.["admin"]?.permissions).toContain("*:*");
      expect(hierarchy?.["user"]?.permissions).toContain("resource:read");
    });

    it("should create enterprise hierarchy", () => {
      const hierarchy = RBACHelpers.createEnterpriseHierarchy();

      expect(hierarchy?.["global_admin"]?.inherits).toContain("tenant_admin");
      expect(hierarchy?.["tenant_admin"]?.inherits).toContain(
        "department_manager"
      );
      expect(hierarchy?.["department_manager"]?.inherits).toContain(
        "team_lead"
      );
      expect(hierarchy?.["team_lead"]?.inherits).toContain("employee");
      expect(hierarchy?.["employee"]?.inherits).toContain("guest");
    });
  });

  describe("Hierarchy Validation", () => {
    it("should validate correct hierarchy", () => {
      const validHierarchy: RoleHierarchy = {
        admin: {
          inherits: ["user"],
          permissions: ["admin:*"],
        },
        user: {
          inherits: [],
          permissions: ["user:read"],
        },
      };

      const validation = RBACHelpers.validateHierarchy(validHierarchy);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should detect undefined role inheritance", () => {
      const invalidHierarchy: RoleHierarchy = {
        admin: {
          inherits: ["undefined_role"],
          permissions: [],
        },
      };

      const validation = RBACHelpers.validateHierarchy(invalidHierarchy);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain(
        "Role admin inherits from undefined role: undefined_role"
      );
    });

    it("should handle empty hierarchy", () => {
      const validation = RBACHelpers.validateHierarchy({});

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe("RBACHelpers", () => {
    describe("Hierarchy Creation", () => {
      it("should create simple hierarchy", () => {
        const hierarchy = RBACHelpers.createSimpleHierarchy();

        expect(hierarchy?.["admin"]?.inherits).toContain("user");
        expect(hierarchy?.["admin"]?.permissions).toContain("*:*");
        expect(hierarchy?.["user"]?.permissions).toContain("resource:read");
      });

      it("should create enterprise hierarchy", () => {
        const hierarchy = RBACHelpers.createEnterpriseHierarchy();

        expect(hierarchy?.["global_admin"]?.inherits).toContain("tenant_admin");
        expect(hierarchy?.["tenant_admin"]?.inherits).toContain(
          "department_manager"
        );
        expect(hierarchy?.["department_manager"]?.inherits).toContain(
          "team_lead"
        );
        expect(hierarchy?.["team_lead"]?.inherits).toContain("employee");
        expect(hierarchy?.["employee"]?.inherits).toContain("guest");
      });
    });

    describe("Hierarchy Validation", () => {
      it("should validate correct hierarchy", () => {
        const validHierarchy: RoleHierarchy = {
          admin: {
            inherits: ["user"],
            permissions: ["admin:*"],
          },
          user: {
            inherits: [],
            permissions: ["user:read"],
          },
        };

        const validation = RBACHelpers.validateHierarchy(validHierarchy);

        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      });

      it("should detect undefined role inheritance", () => {
        const invalidHierarchy: RoleHierarchy = {
          admin: {
            inherits: ["undefined_role"],
            permissions: [],
          },
        };

        const validation = RBACHelpers.validateHierarchy(invalidHierarchy);

        expect(validation.valid).toBe(false);
        expect(validation.errors).toContain(
          "Role admin inherits from undefined role: undefined_role"
        );
      });

      it("should handle empty hierarchy", () => {
        const validation = RBACHelpers.validateHierarchy({});

        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      });
    });
  });
});
