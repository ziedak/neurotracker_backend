import {
  MemoryCache,
  DEFAULT_MEMORY_CACHE_CONFIG,
} from "../../../src/cache/strategies/MemoryCache";

// Mock LRUCache at module level
jest.mock("lru-cache", () => ({
  LRUCache: jest.fn(),
}));

// Mock the compression utilities
jest.mock("../../../src/cache/utils/CacheCompressor", () => ({
  compress: jest.fn(),
  decompress: jest.fn(),
  DEFAULT_COMPRESSION_CONFIG: {
    enableCompression: true,
    minSizeForCompression: 1024,
    compressionAlgorithm: "gzip",
  },
  DEFAULT_DECOMPRESSION_CONFIG: {},
}));

// Mock utils
jest.mock("@libs/utils", () => ({
  matchPattern: jest.fn(),
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe("MemoryCache", () => {
  let memoryCache: MemoryCache;
  let mockLRUCache: {
    get: jest.Mock;
    set: jest.Mock;
    delete: jest.Mock;
    clear: jest.Mock;
    keys: jest.Mock;
    size: number;
  };
  let mockSize = 0;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    mockSize = 0;

    // Setup LRUCache mock
    const { LRUCache: MockLRUCache } = require("lru-cache");
    mockLRUCache = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      keys: jest.fn().mockReturnValue([]),
      get size(): number {
        return mockSize;
      },
      set size(value: number) {
        mockSize = value;
      },
    };
    MockLRUCache.mockImplementation(() => mockLRUCache);

    memoryCache = new MemoryCache();
  });

  describe("constructor", () => {
    it("should initialize with default config", () => {
      const { LRUCache: MockLRUCache } = require("lru-cache");
      expect(MockLRUCache).toHaveBeenCalledWith({
        max: DEFAULT_MEMORY_CACHE_CONFIG.maxMemoryCacheSize,
        ttl: DEFAULT_MEMORY_CACHE_CONFIG.defaultTtl * 1000,
      });
      expect(memoryCache).toBeDefined();
    });

    it("should initialize with custom config", () => {
      const customConfig = {
        maxMemoryCacheSize: 500,
        defaultTTL: 1800,
      };

      new MemoryCache(customConfig);

      const { LRUCache: MockLRUCache } = require("lru-cache");
      expect(MockLRUCache).toHaveBeenCalledWith({
        max: 500,
        ttl: 1800 * 1000,
      });
    });
  });

  describe("get", () => {
    it("should return cached data when available", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };
      const cacheEntry = {
        data: testData,
        timestamp: Date.now(),
        ttl: 3600,
        hits: 1,
        compressed: false,
      };

      mockLRUCache.get.mockReturnValue(cacheEntry);

      const result = await memoryCache.get(testKey);

      expect(result).toEqual({
        data: testData,
        source: "l1",
        latency: expect.any(Number),
        compressed: false,
      });
      expect(mockLRUCache.get).toHaveBeenCalledWith(testKey);
    });

    it("should return miss when data not found", async () => {
      const testKey = "test-key";
      mockLRUCache.get.mockReturnValue(undefined);

      const result = await memoryCache.get(testKey);

      expect(result).toEqual({
        data: null,
        source: "miss",
        latency: expect.any(Number),
        compressed: false,
      });
    });

    it("should handle compressed data", async () => {
      const testKey = "test-key";
      const compressedData = "compressed-string";
      const originalData = { value: "decompressed" };
      const cacheEntry = {
        data: compressedData,
        timestamp: Date.now(),
        ttl: 3600,
        hits: 1,
        compressed: true,
        compressionAlgorithm: "gzip",
      };

      mockLRUCache.get.mockReturnValue(cacheEntry);

      // Mock the decompress function
      const {
        decompress,
      } = require("../../../src/cache/utils/CacheCompressor");
      (decompress as jest.Mock).mockResolvedValue({
        data: originalData,
      });

      const result = await memoryCache.get(testKey);

      expect(result.data).toEqual(originalData);
      expect(result.compressed).toBe(true);
      expect(decompress).toHaveBeenCalledWith(
        compressedData,
        expect.any(Object)
      );
    });

    it("should handle decompression errors gracefully", async () => {
      const testKey = "test-key";
      const compressedData = "corrupted-data";
      const cacheEntry = {
        data: compressedData,
        timestamp: Date.now(),
        ttl: 3600,
        hits: 1,
        compressed: true,
        compressionAlgorithm: "gzip",
      };

      mockLRUCache.get.mockReturnValue(cacheEntry);

      // Mock decompress to throw error
      const {
        decompress,
      } = require("../../../src/cache/utils/CacheCompressor");
      (decompress as jest.Mock).mockRejectedValue(
        new Error("Decompression failed")
      );

      const result = await memoryCache.get(testKey);

      // Should return raw data as fallback
      expect(result.data).toBe(compressedData);
      expect(result.compressed).toBe(true);
    });
  });

  describe("set", () => {
    it("should store data in cache", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };
      const ttl = 1800;

      await memoryCache.set(testKey, testData, ttl);

      expect(mockLRUCache.set).toHaveBeenCalledWith(
        testKey,
        expect.objectContaining({
          data: testData,
          timestamp: expect.any(Number),
          ttl,
          hits: 0,
          compressed: false,
        })
      );
    });

    it("should use default TTL when not provided", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };

      await memoryCache.set(testKey, testData);

      expect(mockLRUCache.set).toHaveBeenCalledWith(
        testKey,
        expect.objectContaining({
          ttl: DEFAULT_MEMORY_CACHE_CONFIG.defaultTtl,
        })
      );
    });

    it("should handle compression when enabled", async () => {
      const compressionConfig = { enableCompression: true };
      const compressingCache = new MemoryCache({ compressionConfig });

      const testKey = "test-key";
      const testData = { value: "large-data-that-should-be-compressed" };

      // Mock compress function
      const { compress } = require("../../../src/cache/utils/CacheCompressor");
      (compress as jest.Mock).mockResolvedValue({
        data: "compressed-data",
        compressed: true,
        algorithm: "gzip",
      });

      await compressingCache.set(testKey, testData);

      expect(compress).toHaveBeenCalledWith(testData, expect.any(Object));
    });

    it("should handle compression errors gracefully", async () => {
      const compressionConfig = { enableCompression: true };
      const compressingCache = new MemoryCache({ compressionConfig });

      const testKey = "test-key";
      const testData = { value: "test" };

      // Mock compress to throw error
      const { compress } = require("../../../src/cache/utils/CacheCompressor");
      (compress as jest.Mock).mockRejectedValue(
        new Error("Compression failed")
      );

      await compressingCache.set(testKey, testData);

      // Should store uncompressed data
      expect(mockLRUCache.set).toHaveBeenCalledWith(
        testKey,
        expect.objectContaining({
          data: testData,
          compressed: false,
        })
      );
    });

    it("should check memory limits before storing", async () => {
      const testKey = "test-key";
      const testData = { value: "test" };

      // Mock the checkMemoryLimits method to return false (limit exceeded)
      const checkMemoryLimitsSpy = jest.spyOn(
        memoryCache as unknown as { checkMemoryLimits: () => boolean },
        "checkMemoryLimits"
      );
      checkMemoryLimitsSpy.mockReturnValue(false);

      await memoryCache.set(testKey, testData);

      expect(mockLRUCache.set).not.toHaveBeenCalled();
    });
  });

  describe("invalidate", () => {
    it("should remove entry from cache", async () => {
      const testKey = "test-key";

      await memoryCache.invalidate(testKey);

      expect(mockLRUCache.delete).toHaveBeenCalledWith(testKey);
    });
  });

  describe("invalidatePattern", () => {
    it("should remove matching entries", async () => {
      const pattern = "user:*";
      const mockKeys = ["user:1", "user:2", "post:1"];
      mockLRUCache.keys.mockReturnValue(mockKeys);

      // Mock matchPattern to return true for user:* pattern
      const { matchPattern } = require("@libs/utils");
      (matchPattern as jest.Mock).mockImplementation(
        (key: string, pat: string) => {
          if (pat === "user:*") {
            return key.startsWith("user:");
          }
          return false;
        }
      );

      const result = await memoryCache.invalidatePattern(pattern);

      expect(result).toBe(2); // user:1 and user:2
      expect(mockLRUCache.delete).toHaveBeenCalledWith("user:1");
      expect(mockLRUCache.delete).toHaveBeenCalledWith("user:2");
      expect(mockLRUCache.delete).not.toHaveBeenCalledWith("post:1");
    });
  });

  describe("healthCheck", () => {
    it("should return healthy status when within limits", async () => {
      // Set the mock size to 500
      mockLRUCache.size = 500;

      const health = await memoryCache.healthCheck();

      expect(health.status).toBe("healthy");
      expect(health.capacity).toBe("ok");
      expect(health.hitRate).toBeGreaterThanOrEqual(0);
      expect(health.entryCount).toBe(500);
    });

    it("should return degraded status when near capacity", async () => {
      mockLRUCache.size = 9500; // 95% of 10000

      const health = await memoryCache.healthCheck();

      expect(health.status).toBe("degraded");
      expect(health.capacity).toBe("full");
    });

    it("should return critical status when memory limit exceeded", async () => {
      const cache = new MemoryCache();
      const mockMemoryTracker = {
        getMemoryStats: jest.fn().mockReturnValue({
          isWithinLimits: false,
          usagePercent: 95,
        }),
        getTotalMemoryUsage: jest.fn().mockReturnValue(1000000),
      };

      // Mock the memory tracker
      (
        cache as unknown as { memoryTracker: typeof mockMemoryTracker }
      ).memoryTracker = mockMemoryTracker;

      const health = await cache.healthCheck();

      expect(health.status).toBe("critical");
      expect(health.capacity).toBe("error");
    });
  });

  describe("dispose", () => {
    it("should clear cache and memory tracker", async () => {
      await memoryCache.dispose();

      expect(mockLRUCache.clear).toHaveBeenCalled();
    });
  });

  describe("getMemoryStats", () => {
    it("should return memory statistics", () => {
      const mockStats = {
        totalUsageMB: 25,
        usagePercent: 50,
        averageEntrySize: 1024,
        isWithinLimits: true,
      };

      const cache = new MemoryCache();
      (
        cache as unknown as { memoryTracker: { getMemoryStats: jest.Mock } }
      ).memoryTracker.getMemoryStats = jest.fn().mockReturnValue(mockStats);

      const stats = cache.getMemoryStats();

      expect(stats).toEqual(mockStats);
    });
  });

  describe("edge cases", () => {
    it("should handle empty key gracefully", async () => {
      const result = await memoryCache.get("");
      expect(result.data).toBeNull();
      expect(result.source).toBe("miss");
    });

    it("should handle null data", async () => {
      await memoryCache.set("test-key", null as unknown);
      expect(mockLRUCache.set).toHaveBeenCalledWith(
        "test-key",
        expect.objectContaining({
          data: null,
        })
      );
    });

    it("should handle undefined data", async () => {
      await memoryCache.set("test-key", undefined as unknown);
      expect(mockLRUCache.set).not.toHaveBeenCalled();
    });

    it("should handle very large data objects", async () => {
      const largeData = { data: "x".repeat(1024 * 1024) }; // 1MB string

      // Mock compress to return compressed data for large objects
      const { compress } = require("../../../src/cache/utils/CacheCompressor");
      (compress as jest.Mock).mockResolvedValueOnce({
        data: "compressed-large-data",
        compressed: true,
        algorithm: "gzip",
        originalSize: 1048576,
        compressedSize: 100,
        compressionTime: 5,
      });

      await memoryCache.set("large-key", largeData);

      expect(compress).toHaveBeenCalledWith(largeData, expect.any(Object));
      expect(mockLRUCache.set).toHaveBeenCalledWith(
        "large-key",
        expect.objectContaining({
          compressed: true,
        })
      );
    });

    it("should handle concurrent operations", async () => {
      const operations = Array(10)
        .fill(null)
        .map((_, i) => memoryCache.set(`key-${i}`, { value: i }));

      await Promise.all(operations);

      expect(mockLRUCache.set).toHaveBeenCalledTimes(10);
    });

    it("should handle LRU cache errors", async () => {
      mockLRUCache.get.mockImplementation(() => {
        throw new Error("LRU cache error");
      });

      const result = await memoryCache.get("test-key");

      expect(result.data).toBeNull();
      expect(result.source).toBe("miss");
    });
  });
});
