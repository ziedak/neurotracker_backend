import { CacheService } from "../../../src/cache/cache.service";
import type { ICache } from "../../../src/cache/interfaces/ICache";

// Mock RedisClient to prevent real connections in tests
jest.mock("../../../src/redis/redisClient", () => ({
  RedisClient: {
    create: jest.fn().mockReturnValue({
      disconnect: jest.fn().mockResolvedValue(undefined),
      isHealthy: jest.fn().mockResolvedValue(true),
      ping: jest.fn().mockResolvedValue(undefined),
      safeGet: jest.fn().mockResolvedValue(null),
      safeSet: jest.fn().mockResolvedValue(true),
      safeSetEx: jest.fn().mockResolvedValue(true),
      safeDel: jest.fn().mockResolvedValue(1),
      safeKeys: jest.fn().mockResolvedValue([]),
      safePublish: jest.fn().mockResolvedValue(1),
      safePipeline: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
      healthCheck: jest.fn().mockResolvedValue({
        status: "healthy",
        latency: 10,
      }),
    }),
  },
}));

describe("CacheService", () => {
  let cacheService: CacheService;
  let mockMemoryCache: jest.Mocked<ICache>;
  let mockRedisCache: jest.Mocked<ICache>;
  let mockMetrics: any;

  beforeEach(() => {
    mockMemoryCache = {
      isEnabled: jest.fn().mockResolvedValue(true),
      get: jest.fn(),
      set: jest.fn(),
      invalidate: jest.fn(),
      invalidatePattern: jest.fn(),
      getStats: jest.fn().mockReturnValue({
        Hits: 0,
        Misses: 0,
        totalRequests: 0,
        hitRate: 0,
        memoryUsage: 0,
        entryCount: 0,
        invalidations: 0,
        compressions: 0,
      }),
      healthCheck: jest.fn().mockResolvedValue({
        status: "healthy",
        capacity: "ok",
        hitRate: 0,
        entryCount: 0,
      }),
      dispose: jest.fn(),
    };

    mockRedisCache = {
      isEnabled: jest.fn().mockResolvedValue(true),
      get: jest.fn(),
      set: jest.fn(),
      invalidate: jest.fn(),
      invalidatePattern: jest.fn(),
      getStats: jest.fn().mockReturnValue({
        Hits: 0,
        Misses: 0,
        totalRequests: 0,
        hitRate: 0,
        memoryUsage: 0,
        entryCount: 0,
        invalidations: 0,
        compressions: 0,
      }),
      healthCheck: jest.fn().mockResolvedValue({
        status: "healthy",
        capacity: "ok",
        hitRate: 0,
        entryCount: 0,
      }),
      dispose: jest.fn(),
    };

    mockMetrics = {};
    cacheService = new CacheService(mockMetrics, [
      mockMemoryCache,
      mockRedisCache,
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with provided caches", () => {
      expect(cacheService).toBeDefined();
    });

    it("should create default caches when none provided", async () => {
      const defaultService = new CacheService(mockMetrics);
      expect(defaultService).toBeDefined();
      await defaultService.dispose(); // Clean up Redis connections
    });
  });

  describe("get", () => {
    it("should return data from first cache layer that has it", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };
      const expectedResult = {
        data: testData,
        source: "l1",
        latency: expect.any(Number),
        compressed: false,
      };

      mockMemoryCache.get.mockResolvedValue({
        data: testData,
        source: "l1",
        latency: 10,
        compressed: false,
      });

      const result = await cacheService.get(testKey);

      expect(result).toEqual(expectedResult);
      expect(mockMemoryCache.get).toHaveBeenCalledWith(testKey);
      expect(mockRedisCache.get).not.toHaveBeenCalled();
    });

    it("should fallback to next cache layer when first misses", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };

      mockMemoryCache.get.mockResolvedValue({
        data: null,
        source: "miss",
        latency: 5,
        compressed: false,
      });

      mockRedisCache.get.mockResolvedValue({
        data: testData,
        source: "l2",
        latency: 15,
        compressed: false,
      });

      const result = await cacheService.get(testKey);

      expect(result.data).toEqual(testData);
      expect(result.source).toBe("l2");
      expect(mockMemoryCache.get).toHaveBeenCalledWith(testKey);
      expect(mockRedisCache.get).toHaveBeenCalledWith(testKey);
    });

    it("should return miss when all layers miss", async () => {
      const testKey = "test-key";

      mockMemoryCache.get.mockResolvedValue({
        data: null,
        source: "miss",
        latency: 5,
        compressed: false,
      });

      mockRedisCache.get.mockResolvedValue({
        data: null,
        source: "miss",
        latency: 10,
        compressed: false,
      });

      const result = await cacheService.get(testKey);

      expect(result.data).toBeNull();
      expect(result.source).toBe("miss");
      expect(result.latency).toBeGreaterThan(0);
    });

    it("should validate input key", async () => {
      const invalidKeys = [null, undefined, "", "a".repeat(513)];

      for (const invalidKey of invalidKeys) {
        const result = await cacheService.get(invalidKey as string);
        expect(result.data).toBeNull();
        expect(result.source).toBe("miss");
      }

      expect(mockMemoryCache.get).not.toHaveBeenCalled();
      expect(mockRedisCache.get).not.toHaveBeenCalled();
    });

    it("should handle cache layer errors gracefully", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };

      mockMemoryCache.get.mockRejectedValue(new Error("Memory cache error"));
      mockRedisCache.get.mockResolvedValue({
        data: testData,
        source: "l2",
        latency: 15,
        compressed: false,
      });

      const result = await cacheService.get(testKey);

      expect(result.data).toEqual(testData);
      expect(result.source).toBe("l2");
    });
  });

  describe("set", () => {
    it("should set data in all enabled cache layers", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };
      const ttl = 3600;

      await cacheService.set(testKey, testData, ttl);

      expect(mockMemoryCache.set).toHaveBeenCalledWith(testKey, testData, ttl);
      expect(mockRedisCache.set).toHaveBeenCalledWith(testKey, testData, ttl);
    });

    it("should validate input key", async () => {
      const invalidKeys = [null, undefined, "", "a".repeat(513)];

      for (const invalidKey of invalidKeys) {
        await expect(
          cacheService.set(invalidKey as string, { data: "test" })
        ).resolves.toBeUndefined();
      }

      expect(mockMemoryCache.set).not.toHaveBeenCalled();
      expect(mockRedisCache.set).not.toHaveBeenCalled();
    });

    it("should validate TTL bounds", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };

      // Test negative TTL
      await cacheService.set(testKey, testData, -1);
      expect(mockMemoryCache.set).toHaveBeenCalledWith(testKey, testData, 3600); // default TTL

      // Test extremely large TTL
      await cacheService.set(testKey, testData, 400 * 24 * 60 * 60); // > 1 year
      expect(mockMemoryCache.set).toHaveBeenCalledWith(testKey, testData, 3600); // default TTL
    });

    it("should handle cache layer errors gracefully", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };

      mockMemoryCache.set.mockRejectedValue(new Error("Memory cache error"));

      // Should not throw, should continue to Redis
      await expect(
        cacheService.set(testKey, testData)
      ).resolves.toBeUndefined();
      expect(mockRedisCache.set).toHaveBeenCalledWith(testKey, testData, 3600);
    });

    it("should reject undefined data", async () => {
      const testKey = "test-key";

      await cacheService.set(testKey, undefined as any);

      expect(mockMemoryCache.set).not.toHaveBeenCalled();
      expect(mockRedisCache.set).not.toHaveBeenCalled();
    });
  });

  describe("invalidate", () => {
    it("should invalidate key in all enabled cache layers", async () => {
      const testKey = "test-key";

      await cacheService.invalidate(testKey);

      expect(mockMemoryCache.invalidate).toHaveBeenCalledWith(testKey);
      expect(mockRedisCache.invalidate).toHaveBeenCalledWith(testKey);
    });

    it("should validate input key", async () => {
      const invalidKeys = [null, undefined, "", "a".repeat(513)];

      for (const invalidKey of invalidKeys) {
        await expect(
          cacheService.invalidate(invalidKey as string)
        ).resolves.toBeUndefined();
      }

      expect(mockMemoryCache.invalidate).not.toHaveBeenCalled();
      expect(mockRedisCache.invalidate).not.toHaveBeenCalled();
    });

    it("should handle cache layer errors gracefully", async () => {
      const testKey = "test-key";

      mockMemoryCache.invalidate.mockRejectedValue(
        new Error("Memory cache error")
      );

      await expect(cacheService.invalidate(testKey)).resolves.toBeUndefined();
      expect(mockRedisCache.invalidate).toHaveBeenCalledWith(testKey);
    });
  });

  describe("invalidatePattern", () => {
    it("should invalidate pattern in all enabled cache layers", async () => {
      const pattern = "user:*";
      mockMemoryCache.invalidatePattern.mockResolvedValue(5);
      mockRedisCache.invalidatePattern.mockResolvedValue(3);

      const result = await cacheService.invalidatePattern(pattern);

      expect(result).toBe(8); // 5 + 3
      expect(mockMemoryCache.invalidatePattern).toHaveBeenCalledWith(pattern);
      expect(mockRedisCache.invalidatePattern).toHaveBeenCalledWith(pattern);
    });

    it("should block dangerous patterns", async () => {
      const dangerousPatterns = ["*", "*:*", ""];

      for (const pattern of dangerousPatterns) {
        const result = await cacheService.invalidatePattern(pattern);
        expect(result).toBe(0);
      }

      expect(mockMemoryCache.invalidatePattern).not.toHaveBeenCalled();
      expect(mockRedisCache.invalidatePattern).not.toHaveBeenCalled();
    });

    it("should validate pattern length", async () => {
      const longPattern = "a".repeat(257);

      const result = await cacheService.invalidatePattern(longPattern);
      expect(result).toBe(0);

      expect(mockMemoryCache.invalidatePattern).not.toHaveBeenCalled();
      expect(mockRedisCache.invalidatePattern).not.toHaveBeenCalled();
    });

    it("should handle cache layer errors gracefully", async () => {
      const pattern = "user:*";

      mockMemoryCache.invalidatePattern.mockRejectedValue(
        new Error("Memory cache error")
      );
      mockRedisCache.invalidatePattern.mockResolvedValue(5);

      const result = await cacheService.invalidatePattern(pattern);

      expect(result).toBe(5);
    });
  });

  describe("healthCheck", () => {
    it("should aggregate health from all cache layers", async () => {
      mockMemoryCache.healthCheck.mockResolvedValue({
        status: "healthy",
        capacity: "ok",
        hitRate: 0.95,
        entryCount: 100,
      });

      mockRedisCache.healthCheck.mockResolvedValue({
        status: "healthy",
        capacity: "ok",
        hitRate: 0.9,
        entryCount: 200,
      });

      const health = await cacheService.healthCheck();

      expect(health.status).toBe("healthy");
      expect(health.capacity).toBe("ok");
      expect(health.hitRate).toBe(0.925); // average
      expect(health.entryCount).toBe(300); // sum
    });

    it("should return critical status when any layer is critical", async () => {
      mockMemoryCache.healthCheck.mockResolvedValue({
        status: "critical",
        capacity: "error",
        hitRate: 0,
        entryCount: 0,
      });

      mockRedisCache.healthCheck.mockResolvedValue({
        status: "healthy",
        capacity: "ok",
        hitRate: 0.9,
        entryCount: 200,
      });

      const health = await cacheService.healthCheck();

      expect(health.status).toBe("critical");
      expect(health.capacity).toBe("error");
    });

    it("should return degraded status when any layer is degraded", async () => {
      mockMemoryCache.healthCheck.mockResolvedValue({
        status: "degraded",
        capacity: "full",
        hitRate: 0.5,
        entryCount: 50,
      });

      mockRedisCache.healthCheck.mockResolvedValue({
        status: "healthy",
        capacity: "ok",
        hitRate: 0.9,
        entryCount: 200,
      });

      const health = await cacheService.healthCheck();

      expect(health.status).toBe("degraded");
      expect(health.capacity).toBe("full");
    });

    it("should handle no caches available", async () => {
      const emptyService = new CacheService(mockMetrics, []);

      const health = await emptyService.healthCheck();

      expect(health.status).toBe("critical");
      expect(health.capacity).toBe("error");
      expect(health.hitRate).toBe(0);
      expect(health.entryCount).toBe(0);
    });
  });

  describe("dispose", () => {
    it("should dispose all cache layers", async () => {
      await cacheService.dispose();

      expect(mockMemoryCache.dispose).toHaveBeenCalled();
      expect(mockRedisCache.dispose).toHaveBeenCalled();
    });

    it("should handle dispose errors gracefully", async () => {
      const mockDispose = jest
        .fn()
        .mockRejectedValue(new Error("Dispose error"));
      mockMemoryCache.dispose = mockDispose;

      await expect(cacheService.dispose()).resolves.toBeUndefined();
      expect(mockDispose).toHaveBeenCalled();
      expect(mockRedisCache.dispose).toHaveBeenCalled();
    });
  });

  describe("isEnabled", () => {
    it("should return true when cache is enabled", async () => {
      const result = await cacheService.isEnabled();
      expect(result).toBe(true);
    });

    it("should return false when cache is disabled", async () => {
      const disabledService = new CacheService(
        mockMetrics,
        [mockMemoryCache, mockRedisCache],
        {
          enable: false,
        }
      );

      const result = await disabledService.isEnabled();
      expect(result).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return aggregated statistics", () => {
      // Update mock stats to have non-zero values
      mockMemoryCache.getStats.mockReturnValue({
        Hits: 10,
        Misses: 5,
        totalRequests: 15,
        hitRate: 0.67,
        memoryUsage: 1024,
        entryCount: 50,
        invalidations: 2,
        compressions: 3,
      });

      mockRedisCache.getStats.mockReturnValue({
        Hits: 20,
        Misses: 10,
        totalRequests: 30,
        hitRate: 0.67,
        memoryUsage: 2048,
        entryCount: 100,
        invalidations: 4,
        compressions: 6,
      });

      const stats = cacheService.getStats();

      expect(stats.Hits).toBe(30);
      expect(stats.Misses).toBe(15);
      expect(stats.totalRequests).toBe(45);
      expect(stats.hitRate).toBeCloseTo(0.67, 2); // Allow for floating point precision
    });
  });
});
