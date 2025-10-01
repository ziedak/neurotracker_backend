/**
 * Basic AbilityFactory Tests
 * Tests the core functionality of the optimized AbilityFactory
 */

import { AbilityFactory } from "../../src/services/ability/AbilityFactory";
import type { AuthorizationContext } from "../../src/types/authorization.types";

// Mock @libs/monitoring
jest.mock("@libs/monitoring", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// Mock @libs/utils
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe("AbilityFactory - Basic Tests", () => {
  let abilityFactory: AbilityFactory;

  beforeEach(() => {
    jest.clearAllMocks();
    abilityFactory = new AbilityFactory(undefined, undefined, {
      enableCaching: true,
      cacheTimeout: 300_000,
      defaultRole: "guest",
      strictMode: true,
      auditEnabled: true,
    });
  });

  afterEach(async () => {
    await abilityFactory.cleanup();
  });

  describe("createAbilityForUser", () => {
    it("should create ability for user role", async () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
        sessionId: "session123",
      };

      const ability = await abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      expect(typeof ability.can).toBe("function");
      expect(ability.can("read", "User")).toBe(true);
      expect(ability.can("create", "Project")).toBe(true);
      expect(ability.can("manage", "all")).toBe(false);
    });

    it("should create ability for admin role", async () => {
      const context: AuthorizationContext = {
        userId: "admin123",
        roles: ["admin"],
        sessionId: "session123",
      };

      const ability = await abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      expect(ability.can("manage", "all")).toBe(true);
      expect(ability.can("read", "User")).toBe(true);
      expect(ability.can("delete", "Project")).toBe(true);
    });

    it("should handle invalid context gracefully", async () => {
      const invalidContext: any = {
        userId: null,
        roles: null,
      };

      const ability = await abilityFactory.createAbilityForUser(invalidContext);

      expect(ability).toBeDefined();
      // Should return restrictive ability
      expect(ability.can("read", "User")).toBe(false);
      expect(ability.can("manage", "all")).toBe(false);
    });

    it("should apply session-based permissions", async () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
        sessionId: "session123",
      };

      const ability = await abilityFactory.createAbilityForUser(context);

      expect(ability).toBeDefined();
      // Should be able to read own session
      expect(ability.can("read", "Session")).toBe(true);
    });
  });

  describe("cache operations", () => {
    it("should clear cache for specific user", async () => {
      const userId = "user123";

      await abilityFactory.clearCache(userId);

      // Test passes if no error thrown
      expect(true).toBe(true);
    });

    it("should clear all cache", async () => {
      await abilityFactory.clearCache();

      // Test passes if no error thrown
      expect(true).toBe(true);
    });

    it("should return cache statistics", () => {
      const stats = abilityFactory.getCacheStats();

      expect(stats).toBeDefined();
      expect(stats.enabled).toBe(true);
      expect(stats.hasCacheService).toBe(false);
      expect(stats.pendingComputations).toBe(0);
    });
  });

  describe("serialization", () => {
    it("should serialize ability rules", async () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      const ability = await abilityFactory.createAbilityForUser(context);
      const serialized = abilityFactory.serializeAbility(ability);

      expect(typeof serialized).toBe("string");
      expect(serialized).not.toBe("[]"); // Should have rules
    });

    it("should deserialize ability rules", () => {
      const rulesJson = '[{"action": "read", "subject": "User"}]';
      const ability = abilityFactory.deserializeAbility(rulesJson);

      expect(ability).toBeDefined();
      expect(typeof ability.can).toBe("function");
    });
  });

  describe("health check", () => {
    it("should return healthy status", async () => {
      const health = await abilityFactory.healthCheck();

      expect(health).toBeDefined();
      expect(health.status).toBe("healthy");
      expect(health.details.caching).toBe(true);
      expect(health.details.pendingComputations).toBe(0);
    });
  });

  describe("permission changes", () => {
    it("should detect permission changes", () => {
      const oldPermissions = [
        { id: "read_User", action: "read" as const, subject: "User" as const },
      ];
      const newPermissions = [
        { id: "read_User", action: "read" as const, subject: "User" as const },
        {
          id: "create_Project",
          action: "create" as const,
          subject: "Project" as const,
        },
      ];

      const changes = abilityFactory.getPermissionChanges(
        oldPermissions,
        newPermissions
      );

      expect(changes.added).toHaveLength(1);
      expect(changes.added[0]?.id).toBe("create_Project");
      expect(changes.removed).toHaveLength(0);
      expect(changes.modified).toHaveLength(0);
    });
  });
});
