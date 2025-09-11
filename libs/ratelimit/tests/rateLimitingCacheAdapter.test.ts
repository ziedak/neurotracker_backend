import {
  RateLimitingCacheAdapter,
  RateLimitAlgorithm,
  RateLimitRequest,
  DEFAULT_RATE_LIMITING_ADAPTER_CONFIG,
} from "../src/adapters/RateLimitingCacheAdapter";

// Mock dependencies
const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  keys: jest.fn(),
  flush: jest.fn(),
  ping: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  isConnected: jest.fn(),
  getStats: jest.fn(),
  healthCheck: jest.fn(),
  invalidatePattern: jest.fn(),
};

const mockConfigValidator = {
  validateCacheConfig: jest.fn(),
};

const mockLockManager = {
  acquireLock: jest.fn(),
  releaseLock: jest.fn(),
  destroy: jest.fn(),
};

// Mock the dependencies
jest.mock("@libs/database", () => ({
  CacheOperationLockManager: jest
    .fn()
    .mockImplementation(() => mockLockManager),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe("RateLimitingCacheAdapter", () => {
  let adapter: RateLimitingCacheAdapter;
  let config: typeof DEFAULT_RATE_LIMITING_ADAPTER_CONFIG;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset mocks to default state
    mockCacheService.get.mockResolvedValue({ data: null, source: "miss" });
    mockCacheService.set.mockResolvedValue(true);
    mockCacheService.invalidatePattern.mockResolvedValue(undefined);
    mockCacheService.getStats.mockReturnValue({
      memoryUsage: 10 * 1024 * 1024, // 10MB
    });
    mockCacheService.healthCheck.mockResolvedValue({ status: "healthy" });
    mockConfigValidator.validateCacheConfig.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
    });
    mockLockManager.acquireLock.mockImplementation(
      async (_key, _operation, fn) => {
        return await fn();
      }
    );

    config = { ...DEFAULT_RATE_LIMITING_ADAPTER_CONFIG };
    adapter = new RateLimitingCacheAdapter(
      mockCacheService as any,
      mockConfigValidator as any,
      config
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Constructor", () => {
    test("should initialize with default configuration", () => {
      expect(adapter).toBeDefined();
      expect(mockConfigValidator.validateCacheConfig).toHaveBeenCalledWith({
        defaultTTL: 3600,
        enable: true,
        maxMemoryCacheSize: 10000,
      });
    });

    test("should initialize with custom configuration", () => {
      const customConfig = {
        ...DEFAULT_RATE_LIMITING_ADAPTER_CONFIG,
        defaultAlgorithm: "token-bucket" as RateLimitAlgorithm,
        enableBatchProcessing: false,
      };

      const customAdapter = new RateLimitingCacheAdapter(
        mockCacheService as any,
        mockConfigValidator as any,
        customConfig
      );

      expect(customAdapter).toBeDefined();
    });

    test("should throw error on invalid configuration", () => {
      mockConfigValidator.validateCacheConfig.mockReturnValue({
        valid: false,
        errors: ["Invalid TTL"],
        warnings: [],
      });

      expect(() => {
        new RateLimitingCacheAdapter(
          mockCacheService as any,
          mockConfigValidator as any,
          config
        );
      }).toThrow("Invalid rate limiting adapter configuration: Invalid TTL");
    });

    test("should log warnings for configuration issues", () => {
      const mockLogger = require("@libs/utils").createLogger();
      mockConfigValidator.validateCacheConfig.mockReturnValue({
        valid: true,
        errors: [],
        warnings: ["Low memory warning"],
      });

      new RateLimitingCacheAdapter(
        mockCacheService as any,
        mockConfigValidator as any,
        config
      );

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Rate limiting adapter configuration warnings",
        { warnings: ["Low memory warning"] }
      );
    });
  });

  describe("checkRateLimit", () => {
    test("should allow request within limit for fixed-window", async () => {
      mockCacheService.get.mockResolvedValue({ data: 5, source: "cache" });

      const result = await adapter.checkRateLimit(
        "user:123",
        10,
        60000,
        "fixed-window"
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.algorithm).toBe("fixed-window");
      expect(result.cached).toBe(true);
      expect(result.totalHits).toBe(6);
      expect(typeof result.responseTime).toBe("number");
    });

    test("should deny request over limit for fixed-window", async () => {
      mockCacheService.get.mockResolvedValue({ data: 10, source: "cache" });

      const result = await adapter.checkRateLimit(
        "user:123",
        10,
        60000,
        "fixed-window"
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.totalHits).toBe(10);
    });

    test("should handle sliding-window algorithm", async () => {
      const now = Date.now();
      const windowData = [now - 10000, now - 5000, now - 2000]; // 3 requests in window
      mockCacheService.get.mockResolvedValue({
        data: windowData,
        source: "cache",
      });

      const result = await adapter.checkRateLimit(
        "user:123",
        5,
        30000,
        "sliding-window"
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1); // 5 - 4 = 1
      expect(result.algorithm).toBe("sliding-window");
    });

    test("should handle token-bucket algorithm", async () => {
      const bucketState = { tokens: 8, lastRefill: Date.now() - 1000 };
      mockCacheService.get.mockResolvedValue({
        data: bucketState,
        source: "cache",
      });

      const result = await adapter.checkRateLimit(
        "user:123",
        10,
        60000,
        "token-bucket"
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7); // 8 - 1 = 7
      expect(result.algorithm).toBe("token-bucket");
    });

    test("should handle leaky-bucket algorithm", async () => {
      const bucketState = { volume: 3, lastLeak: Date.now() - 2000 };
      mockCacheService.get.mockResolvedValue({
        data: bucketState,
        source: "cache",
      });

      const result = await adapter.checkRateLimit(
        "user:123",
        10,
        60000,
        "leaky-bucket"
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(6); // 10 - 4 = 6
      expect(result.algorithm).toBe("leaky-bucket");
    });

    test("should return safe default for unsupported algorithm", async () => {
      const result = await adapter.checkRateLimit(
        "user:123",
        10,
        60000,
        "unsupported" as any
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.algorithm).toBe("unsupported");
      expect(result.responseTime).toBeGreaterThan(0);
    });

    test("should handle cache service errors gracefully", async () => {
      mockCacheService.get.mockRejectedValue(
        new Error("Cache connection failed")
      );
      mockLockManager.acquireLock.mockImplementation(
        async (_key, _operation, fn) => {
          return await fn();
        }
      );

      const result = await adapter.checkRateLimit("user:123", 10, 60000);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.responseTime).toBeGreaterThan(0);
    });

    test("should use lock manager for race condition prevention", async () => {
      await adapter.checkRateLimit("user:123", 10, 60000);

      expect(mockLockManager.acquireLock).toHaveBeenCalledWith(
        expect.stringContaining("rl:sliding-window:60000:user_123"),
        "rate-limit-check",
        expect.any(Function),
        { timeout: 100 }
      );
    });
  });

  describe("checkMultipleRateLimits", () => {
    test("should process batch requests successfully", async () => {
      const requests: RateLimitRequest[] = [
        { identifier: "user:1", limit: 10, windowMs: 60000 },
        { identifier: "user:2", limit: 5, windowMs: 30000 },
      ];

      const result = await adapter.checkMultipleRateLimits(requests);

      expect(result.results).toHaveLength(2);
      expect(result.totalResponseTime).toBeGreaterThan(0);
      expect(typeof result.cacheHitRate).toBe("number");
      expect(result.errorCount).toBe(0);
    });

    test("should reject batch size exceeding maximum", async () => {
      const requests: RateLimitRequest[] = Array(101).fill({
        identifier: "user:1",
        limit: 10,
        windowMs: 60000,
      });

      await expect(adapter.checkMultipleRateLimits(requests)).rejects.toThrow(
        "Batch size 101 exceeds maximum 100"
      );
    });

    test("should handle batch processing when disabled", async () => {
      const disabledAdapter = new RateLimitingCacheAdapter(
        mockCacheService as any,
        mockConfigValidator as any,
        { ...config, enableBatchProcessing: false }
      );

      const requests: RateLimitRequest[] = [
        { identifier: "user:1", limit: 10, windowMs: 60000 },
      ];

      await expect(
        disabledAdapter.checkMultipleRateLimits(requests)
      ).rejects.toThrow("Batch processing is disabled");
    });

    test("should handle errors in batch processing", async () => {
      // Mock checkRateLimit to throw an error for the first call
      const originalCheckRateLimit = adapter.checkRateLimit;
      adapter.checkRateLimit = jest
        .fn()
        .mockRejectedValueOnce(new Error("Cache error"))
        .mockResolvedValue({
          allowed: true,
          limit: 5,
          remaining: 4,
          resetTime: Date.now() + 30000,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 10,
          totalHits: 1,
          windowStart: Date.now() - 30000,
          windowEnd: Date.now() + 30000,
        });

      const requests: RateLimitRequest[] = [
        { identifier: "user:1", limit: 10, windowMs: 60000 },
        { identifier: "user:2", limit: 5, windowMs: 30000 },
      ];

      const result = await adapter.checkMultipleRateLimits(requests);

      expect(result.errorCount).toBe(1);
      expect(result.results).toHaveLength(2);

      // Restore original method
      adapter.checkRateLimit = originalCheckRateLimit;
    });
  });

  describe("resetRateLimit", () => {
    test("should reset rate limit for specific identifier", async () => {
      await adapter.resetRateLimit("user:123");

      expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith(
        "rl:*:user_123"
      );
    });

    test("should reset rate limit for specific algorithm", async () => {
      await adapter.resetRateLimit("user:123", "fixed-window");

      expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith(
        "rl:fixed-window:*:user_123"
      );
    });
  });

  describe("warmupRateLimitKeys", () => {
    test("should warmup multiple keys", async () => {
      const identifiers = ["user:1", "user:2", "user:3"];

      await adapter.warmupRateLimitKeys(identifiers);

      expect(mockCacheService.set).toHaveBeenCalledTimes(3);
      identifiers.forEach((identifier) => {
        expect(mockCacheService.set).toHaveBeenCalledWith(
          expect.stringContaining(identifier.replace(/[^a-zA-Z0-9_-]/g, "_")),
          [],
          expect.any(Number)
        );
      });
    });
  });

  describe("Statistics and Health", () => {
    test("should return rate limiting statistics", () => {
      const stats = adapter.getRateLimitingStats();

      expect(stats).toHaveProperty("totalRequests", 0);
      expect(stats).toHaveProperty("allowedRequests", 0);
      expect(stats).toHaveProperty("blockedRequests", 0);
      expect(stats).toHaveProperty("averageResponseTime", 0);
      expect(stats).toHaveProperty("cacheHitRate", 0);
      expect(stats).toHaveProperty("algorithmDistribution");
      expect(stats).toHaveProperty("memoryUsage");
    });

    test("should return health status", async () => {
      const health = await adapter.getHealth();

      expect(health).toHaveProperty("healthy", true);
      expect(health).toHaveProperty("cacheServiceHealth");
      expect(health).toHaveProperty("adapterStats");
    });

    test("should report unhealthy when cache is down", async () => {
      mockCacheService.healthCheck.mockResolvedValue({ status: "unhealthy" });

      const health = await adapter.getHealth();

      expect(health.healthy).toBe(false);
    });

    test("should report unhealthy when memory usage is high", async () => {
      mockCacheService.getStats.mockReturnValue({
        memoryUsage: 50 * 1024 * 1024, // 50MB - over 90% of assumed 50MB max
      });

      const health = await adapter.getHealth();

      expect(health.healthy).toBe(false);
    });
  });

  describe("Cache Key Generation", () => {
    test("should generate proper cache keys", () => {
      const adapter = new RateLimitingCacheAdapter(
        mockCacheService as any,
        mockConfigValidator as any,
        config
      );

      // Access private method for testing
      const key = (adapter as any).generateCacheKey(
        "user:123",
        "sliding-window",
        60000
      );

      expect(key).toBe("rl:sliding-window:60000:user_123");
    });

    test("should sanitize identifiers in cache keys", () => {
      const adapter = new RateLimitingCacheAdapter(
        mockCacheService as any,
        mockConfigValidator as any,
        config
      );

      const key = (adapter as any).generateCacheKey(
        "user@123!",
        "fixed-window",
        30000
      );

      expect(key).toBe("rl:fixed-window:30000:user_123_");
    });
  });

  describe("TTL Calculation", () => {
    test("should calculate optimal TTL with buffer", () => {
      const adapter = new RateLimitingCacheAdapter(
        mockCacheService as any,
        mockConfigValidator as any,
        config
      );

      const ttl = (adapter as any).calculateOptimalTTL(60000);

      expect(ttl).toBe(61000); // 60000 + 1000 buffer
    });
  });

  describe("Destroy", () => {
    test("should cleanup resources on destroy", async () => {
      await adapter.destroy();

      expect(mockLockManager.destroy).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty identifiers", async () => {
      // This should work as the identifier gets sanitized
      await expect(
        adapter.checkRateLimit("", 10, 60000)
      ).resolves.toBeDefined();
    });

    test("should handle very large limits", async () => {
      const result = await adapter.checkRateLimit("user:123", 1000000, 60000);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(999999);
    });

    test("should handle very small windows", async () => {
      const result = await adapter.checkRateLimit("user:123", 10, 1000);

      expect(result).toBeDefined();
      expect(result.resetTime).toBeGreaterThan(Date.now());
    });

    test("should handle concurrent requests with lock manager", async () => {
      const promises = [
        adapter.checkRateLimit("user:123", 10, 60000),
        adapter.checkRateLimit("user:123", 10, 60000),
        adapter.checkRateLimit("user:123", 10, 60000),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(mockLockManager.acquireLock).toHaveBeenCalledTimes(3);
    });
  });
});
