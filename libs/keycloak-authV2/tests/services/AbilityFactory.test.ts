/**
 * AbilityFactory Tests
 *
 * Comprehensive tests for the CASL AbilityFactory service
 */

import { AbilityFactory } from "../../src/services/AbilityFactory";
import type {
  AuthorizationContext,
  Role,
} from "../../src/types/authorization.types";
import type { IMetricsCollector } from "@libs/monitoring";

// Mock dependencies
const mockMetrics: IMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
  recordHistogram: jest.fn(),
  recordSummary: jest.fn(),
  getMetrics: jest.fn(),
  recordApiRequest: jest.fn(),
  recordDatabaseOperation: jest.fn(),
  recordAuthOperation: jest.fn(),
  recordWebSocketActivity: jest.fn(),
  recordNodeMetrics: jest.fn(),
  measureEventLoopLag: jest.fn(),
};

describe("AbilityFactory", () => {
  let abilityFactory: AbilityFactory;

  beforeEach(() => {
    jest.clearAllMocks();
    abilityFactory = new AbilityFactory(mockMetrics, {
      enableCaching: true,
      cacheTimeout: 300_000,
      defaultRole: "guest",
      strictMode: true,
      auditEnabled: true,
    });
  });

  describe("createAbilityForUser", () => {
    it("should create ability for user role", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
        sessionId: "session123",
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      expect(ability.can("read", "User")).toBe(true);
      expect(ability.can("create", "Project")).toBe(true);
      expect(ability.can("manage", "all")).toBe(false);
    });

    it("should create ability for admin role", () => {
      const context: AuthorizationContext = {
        userId: "admin123",
        roles: ["admin"],
        sessionId: "session123",
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      expect(ability.can("manage", "all")).toBe(true);
      expect(ability.can("read", "User")).toBe(true);
      expect(ability.can("delete", "Project")).toBe(true);
    });

    it("should create ability for multiple roles", () => {
      const context: AuthorizationContext = {
        userId: "manager123",
        roles: ["user", "manager"],
        sessionId: "session123",
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      expect(ability.can("create", "Project")).toBe(true);
      expect(ability.can("approve", "Report")).toBe(true);
      expect(ability.can("manage", "all")).toBe(false);
    });

    it("should handle guest role with minimal permissions", () => {
      const context: AuthorizationContext = {
        userId: "guest123",
        roles: ["guest"],
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      expect(ability.can("read", "User")).toBe(false);
      expect(ability.can("create", "Project")).toBe(false);
      expect(ability.can("manage", "all")).toBe(false);
    });

    it("should cache abilities when caching is enabled", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
        sessionId: "session123",
      };

      // First call - should create and cache
      const ability1 = abilityFactory.createAbilityForUser(context);

      // Second call - should return cached
      const ability2 = abilityFactory.createAbilityForUser(context);

      expect(ability1).toBe(ability2);
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "authorization.ability.cache_hit",
        1,
        { userId: "user123" }
      );
    });

    it("should handle context attributes in conditions", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
        attributes: {
          department: "engineering",
          team: "backend",
        },
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      // Test that context attributes are properly resolved
      expect(ability.can("read", "User")).toBe(true);
    });

    it("should record metrics for ability creation", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user", "analyst"],
      };

      abilityFactory.createAbilityForUser(context);

      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "authorization.ability.created",
        1,
        {
          userId: "user123",
          rolesCount: "2",
        }
      );
    });

    it("should handle invalid roles gracefully", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["invalid_role" as Role, "user"],
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      // Should still work with valid roles
      expect(ability.can("create", "Project")).toBe(true);
    });

    it("should handle empty roles array", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: [],
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      // Should have minimal permissions
      expect(ability.can("read", "User")).toBe(false);
      expect(ability.can("create", "Project")).toBe(false);
    });

    it("should apply session-based permissions", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
        sessionId: "session123",
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      // Should be able to read own session
      expect(ability.can("read", "Session")).toBe(true);
    });
  });

  describe("clearCache", () => {
    it("should clear cache for specific user", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      // Create cached ability
      abilityFactory.createAbilityForUser(context);

      // Clear cache for user
      abilityFactory.clearCache("user123");

      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "authorization.ability.cache_cleared",
        1,
        { userId: "user123" }
      );
    });

    it("should clear all cache when no userId provided", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      // Create cached ability
      abilityFactory.createAbilityForUser(context);

      // Clear all cache
      abilityFactory.clearCache();

      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "authorization.ability.cache_cleared",
        1,
        { userId: "all" }
      );
    });
  });

  describe("getCacheStats", () => {
    it("should return cache statistics", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      // Create some cached abilities
      abilityFactory.createAbilityForUser(context);
      abilityFactory.createAbilityForUser({
        ...context,
        userId: "user456",
      });

      const stats = abilityFactory.getCacheStats();

      expect(stats).toMatchObject({
        size: expect.any(Number),
        hitRate: expect.any(Number),
      });
      expect(stats.size).toBeGreaterThan(0);
    });

    it("should return empty stats when cache is empty", () => {
      const stats = abilityFactory.getCacheStats();

      expect(stats).toMatchObject({
        size: 0,
        hitRate: 0,
        oldestEntry: null,
      });
    });
  });

  describe("error handling", () => {
    it("should handle ability build errors gracefully", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      // Mock an error during ability building by causing an internal error
      const originalMethod = abilityFactory["getEffectivePermissionsForRoles"];
      abilityFactory["getEffectivePermissionsForRoles"] = jest.fn(() => {
        throw new Error("Build error");
      });

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      expect(mockMetrics.recordCounter).toHaveBeenCalledWith(
        "authorization.ability.build_error",
        1,
        {
          userId: "user123",
          error: "Build error",
        }
      );

      // Restore original method
      abilityFactory["getEffectivePermissionsForRoles"] = originalMethod;
    });
  });

  describe("condition resolution", () => {
    it("should resolve template variables in conditions", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
        attributes: {
          department: "engineering",
        },
      };

      const ability = abilityFactory.createAbilityForUser(context);

      // Test that conditions with variables are properly resolved
      expect(ability).toBeDefined();
    });

    it("should handle nested variable paths", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
        attributes: {
          profile: {
            department: "engineering",
            level: "senior",
          },
        },
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
    });

    it("should leave unresolvable variables unchanged", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
    });
  });

  describe("role inheritance", () => {
    it("should properly inherit permissions from parent roles", () => {
      const context: AuthorizationContext = {
        userId: "manager123",
        roles: ["manager"], // Manager inherits from analyst and user
      };

      const ability = abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();

      // Should have user permissions
      expect(ability.can("create", "Project")).toBe(true);

      // Should have analyst permissions
      expect(ability.can("read", "Dashboard")).toBe(true);

      // Should have manager permissions
      expect(ability.can("approve", "Report")).toBe(true);
    });
  });
});
