/**
 * AbilityFactory Security Tests
 * Tests the security fixes and vulnerability patches
 */

import { AbilityCacheError } from "../../src/services/ability/AbilityFactoryErrors";
import {
  AbilityFactory,
  
} from "../../src/services/ability/AbilityFactory";
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

describe("AbilityFactory - Security Tests", () => {
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

  describe("Input Validation Security", () => {
    it("should handle malicious context gracefully", async () => {
      const maliciousContext = {
        userId: "<script>alert('xss')</script>",
        roles: ["user"],
        sessionId: "'; DROP TABLE users; --",
      } as AuthorizationContext;

      // Should not throw and return restrictive ability
      const ability = await abilityFactory.createAbilityForUser(
        maliciousContext
      );
      expect(ability).toBeDefined();
      expect(typeof ability.can).toBe("function");
    });

    it("should reject null/undefined contexts", async () => {
      const nullContext = null as any;
      const undefinedContext = undefined as any;

      const nullResult = await abilityFactory.createAbilityForUser(nullContext);
      const undefinedResult = await abilityFactory.createAbilityForUser(
        undefinedContext
      );

      // Should return restrictive abilities
      expect(nullResult.can("read", "User")).toBe(false);
      expect(undefinedResult.can("read", "User")).toBe(false);
    });

    it("should handle malformed roles array", async () => {
      const malformedContext = {
        userId: "user123",
        roles: ["user", null, undefined, 123, {}] as any,
        sessionId: "session123",
      };

      // Should handle gracefully without crashing
      const ability = await abilityFactory.createAbilityForUser(
        malformedContext
      );
      expect(ability).toBeDefined();
    });
  });

  describe("Cache Key Security", () => {
    it("should generate different keys for different contexts", () => {
      const context1: AuthorizationContext = {
        userId: "user1",
        roles: ["admin"],
        sessionId: "session1",
      };

      const context2: AuthorizationContext = {
        userId: "user1", // Same user
        roles: ["admin"], // Same roles
        sessionId: "session2", // Different session
      };

      // Use reflection to access private method for testing
      const getCacheKey = (abilityFactory as any).getCacheKey.bind(
        abilityFactory
      );

      const key1 = getCacheKey(context1);
      const key2 = getCacheKey(context2);

      expect(key1).not.toBe(key2);
      expect(key1).toMatch(/^ability:[a-f0-9]{16}$/);
      expect(key2).toMatch(/^ability:[a-f0-9]{16}$/);
    });

    it("should generate non-predictable cache keys", () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      const getCacheKey = (abilityFactory as any).getCacheKey.bind(
        abilityFactory
      );
      const key = getCacheKey(context);

      // Should not be base64 of predictable string
      expect(key).not.toContain("user123");
      expect(key).not.toContain("dXNlcjEyMw"); // base64 of "user123"
      expect(key).toMatch(/^ability:[a-f0-9]{16}$/);
    });
  });

  describe("Template Injection Protection", () => {
    it("should prevent template injection attacks", () => {
      const interpolateVariables = (
        abilityFactory as any
      ).interpolateVariables.bind(abilityFactory);

      // Test malicious template patterns
      const maliciousTemplates = [
        "${constructor.constructor('return process')().exit()}",
        "${__proto__.toString.constructor('return process')()}",
        "${global.process.exit}",
        "${''.constructor.constructor('return process')()}",
        "${this.constructor.constructor('return process')()}",
      ];

      const variables = { user: { id: "user123" } };

      maliciousTemplates.forEach((template) => {
        const result = interpolateVariables(template, variables);
        // Should return the original template without executing
        expect(result).toBe(template);
      });
    });

    it("should limit template path depth", () => {
      const interpolateVariables = (
        abilityFactory as any
      ).interpolateVariables.bind(abilityFactory);

      // Test deep path access
      const deepPath = "${a.b.c.d.e.f.g.h.i.j.k}"; // 11 levels deep
      const variables = {
        a: { b: { c: { d: { e: { f: { value: "secret" } } } } } },
      };

      const result = interpolateVariables(deepPath, variables);
      // Should not resolve deep paths
      expect(result).toBe(deepPath);
    });

    it("should only allow safe path characters", () => {
      const interpolateVariables = (
        abilityFactory as any
      ).interpolateVariables.bind(abilityFactory);

      // Test dangerous characters
      const dangerousPaths = [
        "${user[constructor]}",
        "${user.__proto__}",
        "${user['admin']}",
        "${user;admin}",
        "${user=admin}",
      ];

      const variables = { user: { id: "user123" } };

      dangerousPaths.forEach((path) => {
        const result = interpolateVariables(path, variables);
        // Should not resolve dangerous paths
        expect(result).toBe(path);
      });
    });
  });

  describe("Serialization Security", () => {
    it("should handle malformed serialization data", () => {
      const malformedData = [
        "invalid json",
        '{"malformed": }',
        '{"__proto__": {"admin": true}}',
        '{"constructor": {"constructor": "return process"}}',
      ];

      malformedData.forEach((data) => {
        const result = abilityFactory.deserializeAbility(data);
        // Should return restrictive ability
        expect(result.can("manage", "all")).toBe(false);
      });
    });

    it("should validate ability structure before serialization", () => {
      const malformedAbilities = [
        null,
        undefined,
        {},
        { rules: null },
        { rules: "invalid" },
      ];

      malformedAbilities.forEach((ability) => {
        const result = abilityFactory.serializeAbility(ability as any);
        // Should return empty array or handle gracefully
        expect(typeof result).toBe("string");
      });
    });
  });

  describe("Error Handling Security", () => {
    it("should not expose sensitive information in errors", async () => {
      // Mock a cache service that throws
      const mockCacheService = {
        get: jest
          .fn()
          .mockRejectedValue(
            new Error("Database connection failed: password=secret123")
          ),
        set: jest.fn(),
        invalidatePattern: jest.fn(),
        healthCheck: jest.fn(),
        getStats: jest.fn(),
      };

      const factoryWithCache = new AbilityFactory(
        undefined,
        mockCacheService as any,
        { enableCaching: true }
      );

      try {
        const context: AuthorizationContext = {
          userId: "user123",
          roles: ["user"],
        };

        await factoryWithCache.createAbilityForUser(context);
        // Should not throw due to our error handling
      } catch (error) {
        if (error instanceof AbilityCacheError) {
          // Error should not contain sensitive database details
          expect(error.message).not.toContain("password=secret123");
        }
      } finally {
        await factoryWithCache.cleanup();
      }
    });

    it("should properly handle cache validation errors", () => {
      const isValidCachedAbility = (
        abilityFactory as any
      ).isValidCachedAbility.bind(abilityFactory);

      const invalidCacheData = [
        null,
        undefined,
        {},
        { timestamp: "invalid" },
        { timestamp: 123, userId: null },
        { timestamp: 123, userId: "", roles: "invalid" },
        { timestamp: 123, userId: "user", roles: [], rules: "invalid" },
        { timestamp: -1, userId: "user", roles: ["user"], rules: [] },
      ];

      invalidCacheData.forEach((data) => {
        const result = isValidCachedAbility(data);
        expect(result).toBe(false);
      });
    });
  });

  describe("Memory Management Security", () => {
    it("should prevent memory exhaustion from pending computations", async () => {
      // Simulate many concurrent requests
      const contexts: AuthorizationContext[] = Array.from(
        { length: 150 },
        (_, i) => ({
          userId: `user${i}`,
          roles: ["user"],
        })
      );

      const promises = contexts.map((context) =>
        abilityFactory.createAbilityForUser(context)
      );

      // Should handle all requests without memory issues
      const results = await Promise.all(promises);

      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(typeof result.can).toBe("function");
      });

      // Check that pending computations were cleaned up
      const stats = abilityFactory.getCacheStats();
      expect(stats.pendingComputations).toBe(0);
    });

    it("should clean up timeouts properly", async () => {
      const context: AuthorizationContext = {
        userId: "user123",
        roles: ["user"],
      };

      // Create and immediately resolve ability
      await abilityFactory.createAbilityForUser(context);

      // Verify cleanup happened
      const stats = abilityFactory.getCacheStats();
      expect(stats.pendingComputations).toBe(0);
    });
  });

  describe("Configuration Security", () => {
    it("should enforce minimum and maximum cache timeouts", () => {
      const factoryWithInvalidConfig = new AbilityFactory(
        undefined,
        undefined,
        {
          cacheTimeout: 30_000, // Below minimum
        }
      );

      // Should enforce minimum timeout
      const config = (factoryWithInvalidConfig as any).config;
      expect(config.cacheTimeout).toBeGreaterThanOrEqual(60_000);

      factoryWithInvalidConfig.cleanup();
    });

    it("should enforce maximum cache timeout", () => {
      const factoryWithInvalidConfig = new AbilityFactory(
        undefined,
        undefined,
        {
          cacheTimeout: 7_200_000, // Above maximum (2 hours)
        }
      );

      // Should enforce maximum timeout
      const config = (factoryWithInvalidConfig as any).config;
      expect(config.cacheTimeout).toBeLessThanOrEqual(3_600_000);

      factoryWithInvalidConfig.cleanup();
    });
  });
});
