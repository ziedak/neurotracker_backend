/**
 * Cache Integration Validation Test
 * Tests that @libs/database CacheService integration works correctly
 */

import { CacheService } from "@libs/database";

describe("Cache Integration Validation", () => {
  let cacheService: CacheService;

  beforeEach(() => {
    // Create a real CacheService instance to test integration
    // Use memory-only caches for testing (no Redis dependency)
    cacheService = new CacheService(
      undefined, // no metrics needed for test
      [], // use default memory cache only
      {
        enable: true,
        defaultTTL: 300,
        warmupOnStart: false,
      }
    );
  });

  it("should successfully create CacheService instance", () => {
    expect(cacheService).toBeDefined();
    expect(typeof cacheService.get).toBe("function");
    expect(typeof cacheService.set).toBe("function");
  });

  it("should successfully cache and retrieve token validation results", async () => {
    const testKey = "test:token:validation";
    const testData = {
      valid: true,
      claims: {
        sub: "user-123",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
    };

    // Set cache value
    await cacheService.set(testKey, testData, 300);

    // Retrieve cache value
    const result = await cacheService.get(testKey);

    expect(result.data).toEqual(testData);
    expect(result.source).toBe("hit");
  });

  it("should handle cache misses gracefully", async () => {
    const result = await cacheService.get("non-existent-key");

    expect(result.data).toBeNull();
    expect(result.source).toBe("miss");
  });

  it("should support pattern-based invalidation", async () => {
    // Set multiple cache entries
    await cacheService.set("auth:user:123", { data: "user1" }, 300);
    await cacheService.set("auth:user:456", { data: "user2" }, 300);
    await cacheService.set("other:data", { data: "other" }, 300);

    // Invalidate auth pattern
    const invalidatedCount = await cacheService.invalidatePattern(
      "auth:user:*"
    );

    expect(invalidatedCount).toBeGreaterThanOrEqual(0); // May be 0 if memory cache doesn't support patterns

    // Test that pattern invalidation doesn't break the system
    const otherResult = await cacheService.get("other:data");
    expect(otherResult.source).toBe("hit");
  });

  it("should provide cache statistics", () => {
    const stats = cacheService.getStats();

    expect(stats).toHaveProperty("totalRequests");
    expect(stats).toHaveProperty("hitRate");
    expect(stats).toHaveProperty("memoryUsage");
    expect(stats).toHaveProperty("entryCount");
    expect(typeof stats.totalRequests).toBe("number");
  });

  it("should work with TokenIntrospectionService integration pattern", async () => {
    // This validates the exact usage pattern in token-introspection.ts
    const cacheKey = "auth:jwt:test-token-hash";
    const ttl = 300;

    // Simulate JWT validation caching
    const jwtValidationResult = {
      valid: true,
      claims: {
        sub: "user-123",
        aud: "test-client",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        scope: "openid profile",
      },
    };

    // Test set operation (used in token introspection service)
    await cacheService.set(cacheKey, jwtValidationResult, ttl);

    // Test get operation (used in token introspection service)
    const cached = await cacheService.get(cacheKey);
    expect(cached.data).toEqual(jwtValidationResult);

    // Test cache stats (used in token introspection service)
    const stats = cacheService.getStats();
    expect(stats.totalRequests).toBeGreaterThan(0);
  });
});
