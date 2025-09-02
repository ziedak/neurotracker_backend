import "reflect-metadata";
import { PerformanceOptimizedRateLimit } from "../src/performance/optimizedRateLimit";
import { SharedScriptManager } from "../src/performance/scriptManager";
import { LocalRateLimitCache } from "../src/performance/localCache";

// Mock the dependencies manually to avoid module resolution issues
interface MockRedisClient {
  getRedis(): {
    script: jest.Mock;
    evalsha: jest.Mock;
    getRedis: jest.Mock;
    pipeline: jest.Mock;
  };
}

interface MockLogger {
  child: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
}

// Mock dependencies
const mockRedis = {
  script: jest.fn(),
  evalsha: jest.fn(),
  getRedis: jest.fn(),
  pipeline: jest.fn(() => ({
    evalsha: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  })),
};

const mockRedisClient = {
  getRedis: () => mockRedis,
} as unknown as MockRedisClient;

const mockLogger = {
  child: jest.fn(() => mockLogger),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as MockLogger;

describe("Performance Optimizations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SharedScriptManager.getInstance().reset();
  });

  describe("SharedScriptManager", () => {
    it("should be a singleton", () => {
      const instance1 = SharedScriptManager.getInstance();
      const instance2 = SharedScriptManager.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should initialize scripts once", async () => {
      mockRedis.script.mockResolvedValue("mock-sha");

      const manager = SharedScriptManager.getInstance();

      await manager.initialize(mockRedisClient as any, mockLogger as any);
      expect(manager.isInitialized()).toBe(true);

      // Second call should not reload scripts
      await manager.initialize(mockRedisClient as any, mockLogger as any);
      expect(mockRedis.script).toHaveBeenCalledTimes(4); // 4 scripts total
    });

    it("should provide script SHAs", async () => {
      mockRedis.script.mockResolvedValue("test-sha");

      const manager = SharedScriptManager.getInstance();
      await manager.initialize(mockRedisClient as any, mockLogger as any);

      expect(manager.getScriptSha("SLIDING_WINDOW")).toBe("test-sha");
      expect(manager.getAvailableScripts()).toHaveLength(4);
    });
  });

  describe("LocalRateLimitCache", () => {
    let cache: LocalRateLimitCache<any>;

    beforeEach(() => {
      cache = new LocalRateLimitCache(3, 1000, mockLogger as any); // Small cache for testing
    });

    it("should store and retrieve values", () => {
      const testValue = { test: "data" };
      cache.set("key1", testValue);

      expect(cache.get("key1")).toEqual(testValue);
      expect(cache.has("key1")).toBe(true);
    });

    it("should expire entries after TTL", (done) => {
      const testValue = { test: "data" };
      cache.set("key1", testValue, 100); // 100ms TTL

      expect(cache.get("key1")).toEqual(testValue);

      setTimeout(() => {
        expect(cache.get("key1")).toBeUndefined();
        expect(cache.has("key1")).toBe(false);
        done();
      }, 150);
    });

    it("should evict oldest entries when full", () => {
      cache.set("key1", { value: 1 });
      cache.set("key2", { value: 2 });
      cache.set("key3", { value: 3 });

      // Cache is now full (maxSize = 3)
      cache.set("key4", { value: 4 }); // Should evict key1

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(true);
      expect(cache.has("key3")).toBe(true);
      expect(cache.has("key4")).toBe(true);
    });

    it("should track statistics", () => {
      cache.set("key1", { value: 1 });

      // Hit
      cache.get("key1");

      // Miss
      cache.get("nonexistent");

      const stats = cache.getStats();
      expect(stats.totalHits).toBe(1);
      expect(stats.totalMisses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.size).toBe(1);
    });

    it("should cleanup expired entries", (done) => {
      cache.set("key1", { value: 1 }, 100);
      cache.set("key2", { value: 2 }, 500);

      setTimeout(() => {
        const removed = cache.cleanup();
        expect(removed).toBe(1); // key1 should be expired
        expect(cache.has("key1")).toBe(false);
        expect(cache.has("key2")).toBe(true);
        done();
      }, 150);
    });
  });

  describe("PerformanceOptimizedRateLimit", () => {
    let rateLimiter: PerformanceOptimizedRateLimit;

    beforeEach(() => {
      const config = {
        algorithm: "sliding-window" as const,
        redis: { keyPrefix: "test" },
      };

      rateLimiter = new PerformanceOptimizedRateLimit(
        config,
        mockRedisClient as any,
        mockLogger as any,
        true, // Enable caching
        10, // Small cache size
        1000 // Cache TTL
      );
    });

    afterEach(() => {
      rateLimiter.destroy();
    });

    it("should cache successful rate limit results", async () => {
      // Mock successful rate limit result
      const mockResult = {
        allowed: true,
        totalHits: 1,
        remaining: 4,
        resetTime: new Date(Date.now() + 60000),
        algorithm: "sliding-window",
      };

      // Mock the parent class method by spying on the prototype
      const superCheckRateLimit = jest
        .spyOn(
          Object.getPrototypeOf(Object.getPrototypeOf(rateLimiter)),
          "checkRateLimit"
        )
        .mockResolvedValue(mockResult);

      // First call should hit Redis
      const result1 = await rateLimiter.checkRateLimit("test-key", 5, 60000);
      expect(result1).toEqual(mockResult);

      // Second call should hit cache
      const result2 = await rateLimiter.checkRateLimit("test-key", 5, 60000);
      expect(result2).toEqual(mockResult);

      const metrics = rateLimiter.getPerformanceMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.cacheHits).toBe(1);
      expect(metrics.cacheHitRate).toBe(0.5);

      superCheckRateLimit.mockRestore();
    });

    it("should not cache failed rate limit results", async () => {
      const mockResult = {
        allowed: false,
        totalHits: 5,
        remaining: 0,
        resetTime: new Date(Date.now() + 60000),
        retryAfter: 60,
        algorithm: "sliding-window",
      };

      const superCheckRateLimit = jest
        .spyOn(
          Object.getPrototypeOf(Object.getPrototypeOf(rateLimiter)),
          "checkRateLimit"
        )
        .mockResolvedValue(mockResult);

      await rateLimiter.checkRateLimit("test-key", 5, 60000);
      await rateLimiter.checkRateLimit("test-key", 5, 60000);

      const metrics = rateLimiter.getPerformanceMetrics();
      expect(metrics.cacheHits).toBe(0); // No cache hits for denied requests

      superCheckRateLimit.mockRestore();
    });

    it("should provide comprehensive performance metrics", async () => {
      const mockResult = {
        allowed: true,
        totalHits: 1,
        remaining: 4,
        resetTime: new Date(Date.now() + 60000),
        algorithm: "sliding-window",
      };

      const superCheckRateLimit = jest
        .spyOn(
          Object.getPrototypeOf(Object.getPrototypeOf(rateLimiter)),
          "checkRateLimit"
        )
        .mockResolvedValue(mockResult);

      await rateLimiter.checkRateLimit("test-key", 5, 60000);

      const health = await rateLimiter.getHealth();
      expect(health).toHaveProperty("performance");
      expect(health.performance).toHaveProperty("enabled", true);
      expect(health.performance).toHaveProperty("localCache");
      expect(health.performance).toHaveProperty("metrics");
      expect(health.performance).toHaveProperty("sharedScripts");

      superCheckRateLimit.mockRestore();
    });

    it("should support cache warm-up", async () => {
      const mockResult = {
        allowed: true,
        totalHits: 1,
        remaining: 4,
        resetTime: new Date(Date.now() + 60000),
        algorithm: "sliding-window",
      };

      const superCheckRateLimit = jest
        .spyOn(
          Object.getPrototypeOf(Object.getPrototypeOf(rateLimiter)),
          "checkRateLimit"
        )
        .mockResolvedValue(mockResult);

      const warmUpKeys = [
        { key: "key1", maxRequests: 5, windowMs: 60000 },
        { key: "key2", maxRequests: 10, windowMs: 30000 },
      ];

      await rateLimiter.warmUpCache(warmUpKeys);

      const metrics = rateLimiter.getPerformanceMetrics();
      expect(metrics.cacheStats.size).toBe(2);

      superCheckRateLimit.mockRestore();
    });

    it("should track response times", async () => {
      const mockResult = {
        allowed: true,
        totalHits: 1,
        remaining: 4,
        resetTime: new Date(Date.now() + 60000),
        algorithm: "sliding-window",
      };

      // Add a small delay to simulate Redis response time
      const superCheckRateLimit = jest
        .spyOn(
          Object.getPrototypeOf(Object.getPrototypeOf(rateLimiter)),
          "checkRateLimit"
        )
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return mockResult;
        });

      await rateLimiter.checkRateLimit("test-key", 5, 60000);

      const metrics = rateLimiter.getPerformanceMetrics();
      expect(metrics.avgResponseTime).toBeGreaterThan(0);
      expect(metrics.totalRequests).toBe(1);

      superCheckRateLimit.mockRestore();
    });

    it("should handle cache disabled mode", async () => {
      const disabledCacheRateLimit = new PerformanceOptimizedRateLimit(
        { algorithm: "sliding-window" },
        mockRedisClient as any,
        mockLogger as any,
        false // Disable caching
      );

      const health = await disabledCacheRateLimit.getHealth();
      expect(health.performance.localCache.enabled).toBe(false);

      disabledCacheRateLimit.destroy();
    });
  });

  describe("Factory Methods", () => {
    it("should create optimized instance with factory", () => {
      const config = { algorithm: "sliding-window" as const };
      const instance = PerformanceOptimizedRateLimit.createOptimized(
        config,
        mockRedisClient as any,
        mockLogger as any,
        {
          enableLocalCache: true,
          localCacheSize: 500,
          localCacheTtlMs: 2000,
        }
      );

      expect(instance).toBeInstanceOf(PerformanceOptimizedRateLimit);
      instance.destroy();
    });

    it("should create from environment configuration", () => {
      const instance =
        PerformanceOptimizedRateLimit.createFromEnvironmentOptimized(
          "development",
          mockRedisClient as any,
          mockLogger as any,
          undefined,
          { enableLocalCache: true }
        );

      expect(instance).toBeInstanceOf(PerformanceOptimizedRateLimit);
      instance.destroy();
    });
  });
});
