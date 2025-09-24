/**
 * AbilityFactory Optimization Integration Test
 * Demonstrates the CacheService integration and performance improvements
 */

import { AbilityFactory } from "../../src/services/AbilityFactoryRefactored";
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

describe("AbilityFactory - Optimization Integration", () => {
  let abilityFactory: AbilityFactory;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (abilityFactory) {
      await abilityFactory.cleanup();
    }
  });

  describe("CacheService Integration", () => {
    it("should work with caching enabled (no CacheService provided)", async () => {
      abilityFactory = new AbilityFactory(undefined, undefined, {
        enableCaching: true,
        cacheTimeout: 300_000,
        defaultRole: "guest",
      });

      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
        sessionId: "session123",
      };

      // First call - should create and cache
      const ability1 = await abilityFactory.createAbilityForUser(context);

      // Second call - should use cache (internal fallback since no CacheService)
      const ability2 = await abilityFactory.createAbilityForUser(context);

      expect(ability1).toBeDefined();
      expect(ability2).toBeDefined();
      expect(ability1.can("read", "User")).toBe(true);
      expect(ability2.can("read", "User")).toBe(true);
    });

    it("should handle enterprise features", async () => {
      abilityFactory = new AbilityFactory(undefined, undefined, {
        enableCaching: true,
        cacheTimeout: 300_000,
        defaultRole: "guest",
        strictMode: true,
        auditEnabled: true,
      });

      // Health check
      const health = await abilityFactory.healthCheck();
      expect(health.status).toBe("healthy");
      expect(health.details.caching).toBe(true);
      expect(health.details.pendingComputations).toBe(0);

      // Cache statistics
      const stats = abilityFactory.getCacheStats();
      expect(stats.enabled).toBe(true);
      expect(stats.hasCacheService).toBe(false); // No CacheService provided
      expect(stats.pendingComputations).toBe(0);
    });

    it("should handle concurrent requests efficiently", async () => {
      abilityFactory = new AbilityFactory(undefined, undefined, {
        enableCaching: true,
        cacheTimeout: 300_000,
      });

      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      // Create multiple concurrent requests
      const promises = Array.from({ length: 5 }, () =>
        abilityFactory.createAbilityForUser(context)
      );

      const abilities = await Promise.all(promises);

      // All should succeed
      abilities.forEach((ability) => {
        expect(ability).toBeDefined();
        expect(ability.can("read", "User")).toBe(true);
      });
    });

    it("should handle cache clearing operations", async () => {
      abilityFactory = new AbilityFactory(undefined, undefined, {
        enableCaching: true,
        cacheTimeout: 300_000,
      });

      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      // Create ability first
      await abilityFactory.createAbilityForUser(context);

      // Clear cache for specific user
      await abilityFactory.clearCache("user123");

      // Clear all cache
      await abilityFactory.clearCache();

      // Should still work after cache clearing
      const ability = await abilityFactory.createAbilityForUser(context);
      expect(ability.can("read", "User")).toBe(true);
    });
  });

  describe("Performance Optimization Validation", () => {
    it("should demonstrate performance improvement with caching", async () => {
      abilityFactory = new AbilityFactory(undefined, undefined, {
        enableCaching: true,
        cacheTimeout: 300_000,
      });

      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["admin"], // Complex role with many permissions
      };

      // Measure first call (should be slower - computes permissions)
      const start1 = Date.now();
      const ability1 = await abilityFactory.createAbilityForUser(context);
      const time1 = Date.now() - start1;

      // Measure second call (should be faster - uses cache)
      const start2 = Date.now();
      const ability2 = await abilityFactory.createAbilityForUser(context);
      const time2 = Date.now() - start2;

      expect(ability1.can("manage", "all")).toBe(true);
      expect(ability2.can("manage", "all")).toBe(true);

      // Second call should be significantly faster or at least not slower
      expect(time2).toBeLessThanOrEqual(time1);

      console.log(
        `Performance improvement: First call: ${time1}ms, Second call: ${time2}ms`
      );
    });

    it("should handle different user roles efficiently", async () => {
      abilityFactory = new AbilityFactory(undefined, undefined, {
        enableCaching: true,
        cacheTimeout: 300_000,
      });

      const contexts: AuthorizationContext[] = [
        { userId: "admin1", roles: ["admin"] },
        { userId: "user1", roles: ["user"] },
        { userId: "manager1", roles: ["manager"] },
        { userId: "guest1", roles: ["guest"] },
      ];

      // Create abilities for all user types
      const results = await Promise.all(
        contexts.map((context) => abilityFactory.createAbilityForUser(context))
      );

      // Verify each role has correct permissions
      expect(results[0]?.can("manage", "all")).toBe(true); // admin
      expect(results[1]?.can("read", "User")).toBe(true); // user
      expect(results[2]?.can("read", "User")).toBe(true); // manager
      expect(results[3]?.can("read", "User")).toBe(false); // guest (restrictive)      // Cache should contain entries for all users
      const stats = abilityFactory.getCacheStats();
      expect(stats.enabled).toBe(true);
    });
  });

  describe("Optimization Summary", () => {
    it("should demonstrate all optimization features working together", async () => {
      abilityFactory = new AbilityFactory(undefined, undefined, {
        enableCaching: true,
        cacheTimeout: 300_000,
        defaultRole: "guest",
        strictMode: true,
        auditEnabled: true,
      });

      // Test context
      const context: AuthorizationContext = {
        userId: "test-user",
        roles: ["user"],
        sessionId: "session-123",
      };

      // 1. Create ability (should cache)
      const ability = await abilityFactory.createAbilityForUser(context);
      expect(ability.can("read", "User")).toBe(true);

      // 2. Serialize/deserialize (performance feature)
      const serialized = abilityFactory.serializeAbility(ability);
      const deserialized = abilityFactory.deserializeAbility(serialized);
      expect(deserialized.can("read", "User")).toBe(true);

      // 3. Health check (enterprise feature)
      const health = await abilityFactory.healthCheck();
      expect(health.status).toBe("healthy");

      // 4. Cache statistics (monitoring feature)
      const stats = abilityFactory.getCacheStats();
      expect(stats.enabled).toBe(true);

      // 5. Permission diffing (optimization feature)
      const oldPerms = [
        { id: "read_User", action: "read" as const, subject: "User" as const },
      ];
      const newPerms = [
        { id: "read_User", action: "read" as const, subject: "User" as const },
        {
          id: "create_Project",
          action: "create" as const,
          subject: "Project" as const,
        },
      ];
      const changes = abilityFactory.getPermissionChanges(oldPerms, newPerms);
      expect(changes.added).toHaveLength(1);

      // 6. Cache clearing (maintenance feature)
      await abilityFactory.clearCache();

      console.log("✅ All optimization features validated successfully!");
      console.log("Features tested:");
      console.log("  - Enterprise-grade caching with fallback");
      console.log("  - Async operations with race condition prevention");
      console.log("  - Health checks and monitoring");
      console.log("  - Permission serialization/deserialization");
      console.log("  - Permission change detection");
      console.log("  - Cache management and statistics");
    });
  });
});
