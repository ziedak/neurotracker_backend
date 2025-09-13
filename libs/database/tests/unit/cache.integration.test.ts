import { CacheService } from "../../src/cache/cache.service";
import { MemoryCache } from "../../src/cache/strategies/MemoryCache";
import { RedisCache } from "../../src/cache/strategies/RedisCache";
import type { RedisClient } from "../../src/redis/redisClient";

describe("CacheService Integration", () => {
  let cacheService: CacheService;
  // Import the RedisClient type from the correct location

  let mockRedisClient: {
    isHealthy: jest.Mock<Promise<boolean>, []>;
    ping: jest.Mock<Promise<string>, []>;
    safeGet: jest.Mock<
      Promise<string | null>,
      [key: string, defaultValue?: string]
    >;
    safeSetEx: jest.Mock<
      Promise<boolean>,
      [key: string, ttl: number, value: string]
    >;
    safeDel: jest.Mock<Promise<number>, [key: string]>;
    safeKeys: jest.Mock<Promise<string[]>, [pattern: string]>;
    safeIncrBy: jest.Mock<Promise<number>, [key: string, increment: number]>;
    safeExpire: jest.Mock<Promise<boolean>, [key: string, ttl: number]>;
    safeExists: jest.Mock<Promise<number>, [key: string]>;
    safeMget: jest.Mock<Promise<(string | null)[]>, [keys: string[]]>;
    pipeline: jest.Mock;
    disconnect: jest.Mock<Promise<void>, []>;
  };

  beforeEach(() => {
    // Mock Redis client for RedisCache
    mockRedisClient = {
      isHealthy: jest.fn().mockResolvedValue(true),
      ping: jest.fn().mockResolvedValue("PONG"),
      safeGet: jest.fn(),
      safeSetEx: jest.fn(),
      safeDel: jest.fn(),
      safeKeys: jest.fn(),
      safeIncrBy: jest.fn(),
      safeExpire: jest.fn(),
      safeExists: jest.fn(),
      safeMget: jest.fn(),
      pipeline: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue([]),
      })),
      disconnect: jest.fn(),
    };

    // Create cache service with real implementations
    const memoryCache = new MemoryCache();
    // Cast mockRedisClient to the expected RedisClient type
    const redisCache = new RedisCache(
      mockRedisClient as unknown as RedisClient
    );
    cacheService = new CacheService(undefined, [memoryCache, redisCache]);
  });

  afterEach(async () => {
    await cacheService.dispose();
    jest.clearAllMocks();
  });

  describe("multi-level caching", () => {
    it("should cache data in memory first", async () => {
      const testKey = "integration-test-key";
      const testData = {
        message: "Hello from integration test",
        timestamp: Date.now(),
      };

      // Set data
      await cacheService.set(testKey, testData, 300);

      // Get data - should come from memory (L1)
      const result = await cacheService.get(testKey);

      expect(result.data).toEqual(testData);
      expect(result.source).toBe("l1");
      expect(result.latency).toBeGreaterThan(0);
      expect(result.compressed).toBe(false);
    });

    it("should fallback to Redis when memory misses", async () => {
      const testKey = "redis-fallback-key";
      const testData = { message: "From Redis cache", value: 42 };

      // Mock Redis to return data
      mockRedisClient.safeGet.mockResolvedValue(
        JSON.stringify({
          data: testData,
          timestamp: Date.now(),
          ttl: 300,
          hits: 1,
          compressed: false,
        })
      );

      // Memory cache miss, Redis cache hit
      const result = await cacheService.get(testKey);

      expect(result.data).toEqual(testData);
      expect(result.source).toBe("l2");
      expect(mockRedisClient.safeGet).toHaveBeenCalled();
    });

    it("should write to all levels", async () => {
      const testKey = "multi-level-write";
      const testData = { level: "all", data: "test" };

      await cacheService.set(testKey, testData, 600);

      // Verify data is in memory cache
      const memoryResult = await cacheService.get(testKey);
      expect(memoryResult.data).toEqual(testData);
      expect(memoryResult.source).toBe("l1");

      // Verify Redis was called to set data
      expect(mockRedisClient.safeSetEx).toHaveBeenCalled();
    });

    it("should handle Redis failures gracefully", async () => {
      const testKey = "redis-failure-key";
      const testData = { resilient: true };

      // Make Redis operations fail
      mockRedisClient.safeSetEx.mockRejectedValue(
        new Error("Redis connection failed")
      );
      mockRedisClient.safeGet.mockRejectedValue(
        new Error("Redis connection failed")
      );

      // Should still work with memory cache
      await cacheService.set(testKey, testData);
      const result = await cacheService.get(testKey);

      expect(result.data).toEqual(testData);
      expect(result.source).toBe("l1");
    });
  });

  describe("cache invalidation", () => {
    it("should invalidate across all levels", async () => {
      const testKey = "invalidate-test";
      const testData = { toBeInvalidated: true };

      // Set data
      await cacheService.set(testKey, testData);

      // Verify it's cached
      const beforeResult = await cacheService.get(testKey);
      expect(beforeResult.data).toEqual(testData);

      // Invalidate
      await cacheService.invalidate(testKey);

      // Verify it's gone
      const afterResult = await cacheService.get(testKey);
      expect(afterResult.data).toBeNull();
      expect(afterResult.source).toBe("miss");

      // Verify Redis was called to delete
      expect(mockRedisClient.safeDel).toHaveBeenCalled();
    });

    it("should handle pattern invalidation", async () => {
      const keys = [
        "user:1:profile",
        "user:1:settings",
        "user:2:profile",
        "post:1",
      ];
      const testData = { data: "test" };

      // Set multiple keys
      for (const key of keys) {
        await cacheService.set(key, testData);
      }

      // Invalidate user:1:* pattern
      const invalidatedCount = await cacheService.invalidatePattern("user:1:*");

      expect(invalidatedCount).toBe(2); // user:1:profile and user:1:settings

      // Verify user:1 keys are gone
      const user1Profile = await cacheService.get("user:1:profile");
      const user1Settings = await cacheService.get("user:1:settings");
      expect(user1Profile.data).toBeNull();
      expect(user1Settings.data).toBeNull();

      // Verify other keys still exist
      const user2Profile = await cacheService.get("user:2:profile");
      const post1 = await cacheService.get("post:1");
      expect(user2Profile.data).toEqual(testData);
      expect(post1.data).toEqual(testData);
    });
  });

  describe("health monitoring", () => {
    it("should aggregate health from all cache layers", async () => {
      const health = await cacheService.healthCheck();

      expect(health).toHaveProperty("status");
      expect(health).toHaveProperty("capacity");
      expect(health).toHaveProperty("hitRate");
      expect(health).toHaveProperty("entryCount");
      expect(["healthy", "degraded", "critical"]).toContain(health.status);
    });

    it("should handle partial failures", async () => {
      // Make Redis unhealthy
      mockRedisClient.isHealthy.mockResolvedValue(false);

      const health = await cacheService.healthCheck();

      // Should still be operational with memory cache
      expect(["healthy", "degraded"]).toContain(health.status);
    });
  });

  describe("statistics aggregation", () => {
    it("should aggregate stats from all layers", async () => {
      // Perform some operations to generate stats
      await cacheService.set("stat-test-1", { data: 1 });
      await cacheService.set("stat-test-2", { data: 2 });
      await cacheService.get("stat-test-1"); // hit
      await cacheService.get("non-existent"); // miss

      const stats = cacheService.getStats();

      expect(stats.totalRequests).toBeGreaterThan(0);
      expect(stats.Hits).toBeGreaterThanOrEqual(0);
      expect(stats.Misses).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeLessThanOrEqual(1);
    });
  });

  describe("compression integration", () => {
    it("should compress large objects when enabled", async () => {
      const largeData = {
        data: "x".repeat(2048), // Large string > 1KB threshold
        metadata: { size: "large", compressed: true },
      };

      // Create cache with compression enabled
      const compressingCache = new CacheService(undefined, [
        new MemoryCache({
          compressionConfig: { enableCompression: true, thresholdBytes: 1024 },
        }),
        new RedisCache(mockRedisClient as unknown as RedisClient, {
          compressionConfig: { enableCompression: true, thresholdBytes: 1024 },
        }),
      ]);

      await compressingCache.set("compressed-key", largeData);

      const result = await compressingCache.get("compressed-key");

      expect(result.data).toEqual(largeData);
      expect(result.compressed).toBe(true);

      await compressingCache.dispose();
    });
  });

  describe("concurrent operations", () => {
    it("should handle concurrent reads and writes", async () => {
      const concurrentOps = 50;
      const testData = { concurrent: true, id: 0 };

      // Concurrent writes
      const writePromises = Array(concurrentOps)
        .fill(null)
        .map((_, i) =>
          cacheService.set(`concurrent-key-${i}`, { ...testData, id: i })
        );

      await Promise.all(writePromises);

      // Concurrent reads
      const readPromises = Array(concurrentOps)
        .fill(null)
        .map((_, i) => cacheService.get(`concurrent-key-${i}`));

      const results = await Promise.all(readPromises);

      results.forEach((result: unknown, i: number) => {
        expect((result as { data: unknown; source: string }).data).toEqual({
          ...testData,
          id: i,
        });
        expect((result as { data: unknown; source: string }).source).toBe("l1");
      });
    });

    it("should handle mixed concurrent operations", async () => {
      const operations = [];

      // Mix of reads, writes, and invalidations
      for (let i = 0; i < 20; i++) {
        operations.push(cacheService.set(`mixed-key-${i}`, { data: i }));
        operations.push(cacheService.get(`mixed-key-${Math.floor(i / 2)}`));
        if (i % 5 === 0) {
          operations.push(cacheService.invalidate(`mixed-key-${i - 1}`));
        }
      }

      await Promise.all(operations);

      // Verify final state
      const finalResult = await cacheService.get("mixed-key-19");
      expect(finalResult.data).toEqual({ data: 19 });
    });
  });

  describe("resource cleanup", () => {
    it("should properly dispose all resources", async () => {
      // Set some data first
      await cacheService.set("dispose-test", { cleanup: true });

      // Verify it's cached
      const beforeDispose = await cacheService.get("dispose-test");
      expect(beforeDispose.data).toEqual({ cleanup: true });

      // Dispose
      await cacheService.dispose();

      // Verify Redis disconnect was called
      expect(mockRedisClient.disconnect).toHaveBeenCalled();
    });
  });

  describe("error recovery", () => {
    it("should recover from transient Redis failures", async () => {
      const testKey = "recovery-test";
      const testData = { recovered: true };

      // First make Redis fail
      mockRedisClient.safeSetEx.mockRejectedValueOnce(
        new Error("Temporary failure")
      );
      mockRedisClient.safeGet.mockRejectedValueOnce(
        new Error("Temporary failure")
      );

      // Set should still work (memory only)
      await cacheService.set(testKey, testData);

      // Get should work from memory
      const result = await cacheService.get(testKey);
      expect(result.data).toEqual(testData);
      expect(result.source).toBe("l1");

      // Now make Redis work again
      mockRedisClient.safeSetEx.mockResolvedValue(true);
      mockRedisClient.safeGet.mockResolvedValue(
        JSON.stringify({
          data: testData,
          timestamp: Date.now(),
          ttl: 300,
          hits: 1,
          compressed: false,
        })
      );

      // Next set should work on both levels
      await cacheService.set(`${testKey}-2`, testData);
      expect(mockRedisClient.safeSetEx).toHaveBeenCalled();
    });
  });

  describe("performance under load", () => {
    it("should maintain performance with high load", async () => {
      const numOperations = 100;
      const testData = { load: "test", size: 100 };

      const startTime = Date.now();

      // High volume of operations
      const operations = [];
      for (let i = 0; i < numOperations; i++) {
        operations.push(
          cacheService.set(`load-test-${i}`, { ...testData, id: i })
        );
        operations.push(cacheService.get(`load-test-${i % 10}`)); // Some hits, some misses
      }

      await Promise.all(operations);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should complete within reasonable time (adjust threshold as needed)
      expect(totalTime).toBeLessThan(5000); // 5 seconds max

      // Verify some data integrity
      const sampleResult = await cacheService.get("load-test-50");
      expect(sampleResult.data).toEqual({ ...testData, id: 50 });
    });
  });
});
