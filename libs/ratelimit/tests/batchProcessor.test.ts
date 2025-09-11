// Mock dependencies
const mockRedisClient = {
  getRedis: jest.fn(() => ({
    pipeline: jest.fn(() => ({
      evalsha: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    })),
    evalsha: jest.fn().mockResolvedValue([]),
  })),
  isAvailable: jest.fn().mockReturnValue(true),
};

const mockScriptManager = {
  getScriptSha: jest.fn(),
  getInstance: jest.fn(),
  initialize: jest.fn(),
  reset: jest.fn(),
};

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock the dependencies
jest.mock("@libs/database", () => ({
  RedisClient: jest.fn().mockImplementation(() => mockRedisClient),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn().mockReturnValue(mockLogger),
}));

jest.mock("../src/performance/scriptManager", () => ({
  SharedScriptManager: {
    getInstance: jest.fn().mockReturnValue(mockScriptManager),
  },
}));

import {
  BatchRateLimitProcessor,
  BatchRateLimitRequest,
  BatchRateLimitResponse,
} from "../src/performance/batchProcessor";
import { SharedScriptManager } from "../src/performance/scriptManager";

describe("BatchRateLimitProcessor", () => {
  let processor: BatchRateLimitProcessor;
  let scriptManager: SharedScriptManager;
  let mockPipeline: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset mocks
    mockScriptManager.getScriptSha.mockReturnValue("mock-sha");

    // Mock pipeline.exec() to return proper format: [[error, result], ...]
    mockPipeline = {
      evalsha: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, [1, 99, Date.now() + 60000, 1]], // First request result [error, [allowed, remaining, resetTime, totalHits]]
        [null, [1, 98, Date.now() + 60000, 2]], // Second request result
      ]),
    };

    mockRedisClient.getRedis.mockReturnValue({
      pipeline: jest.fn(() => mockPipeline),
      evalsha: jest.fn().mockResolvedValue([1, 99, Date.now() + 60000, 1]),
    });

    scriptManager = SharedScriptManager.getInstance();
    // Reset the script manager for clean testing
    (scriptManager as any).reset();
    // Initialize the script manager for testing
    await scriptManager.initialize(mockRedisClient as any);
    processor = new BatchRateLimitProcessor(
      mockRedisClient as any,
      scriptManager,
      "test_prefix",
      10
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Constructor", () => {
    test("should initialize with default configuration", () => {
      expect(processor).toBeDefined();
    });

    test("should initialize with custom configuration", () => {
      const customProcessor = new BatchRateLimitProcessor(
        mockRedisClient as any,
        scriptManager,
        "custom_prefix",
        20,
        { maxBatchSize: 50, timeout: 10000 }
      );

      expect(customProcessor).toBeDefined();
    });
  });

  describe("processBatch", () => {
    test("should handle empty batch by throwing error", async () => {
      await expect(
        processor.processBatch([], "sliding-window")
      ).rejects.toThrow("Requests must be a non-empty array");
    });

    test("should process single request batch", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 60000,
          priority: "normal",
        },
      ];

      mockRedisClient
        .getRedis()
        .evalsha.mockResolvedValue([[1, 99, Date.now() + 60000, 1]]);

      const result = await processor.processBatch(requests, "sliding-window");

      expect(result).toHaveLength(1);
      expect(result).toBeDefined();
      expect(result!.length).toBe(1);
      expect(result![0]?.key).toBe("user:123");
      expect(result![0]?.result.allowed).toBe(true);
      expect(result![0]?.result.remaining).toBe(99);
      expect(result![0]?.executionTime).toBeGreaterThanOrEqual(0);
    });

    test("should process multiple requests batch", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 60000,
          priority: "high",
        },
        {
          key: "user:456",
          maxRequests: 50,
          windowMs: 30000,
          priority: "normal",
        },
      ];

      const result = await processor.processBatch(requests, "sliding-window");

      expect(result).toHaveLength(2);
      expect(result).toBeDefined();
      expect(result!.length).toBe(2);
      expect(result![0]?.key).toBe("user:123");
      expect(result![1]?.key).toBe("user:456");
    });

    test("should sort requests by priority", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:low",
          maxRequests: 100,
          windowMs: 60000,
          priority: "low",
        },
        {
          key: "user:high",
          maxRequests: 100,
          windowMs: 60000,
          priority: "high",
        },
        {
          key: "user:normal",
          maxRequests: 100,
          windowMs: 60000,
          priority: "normal",
        },
      ];

      await processor.processBatch(requests, "sliding-window");

      // Verify that batch processing was used
      expect(mockScriptManager.getScriptSha).toHaveBeenCalledWith(
        "BATCH_SLIDING_WINDOW"
      );
    });

    test("should handle different algorithms", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      // Test fixed-window
      await processor.processBatch(requests, "fixed-window");
      expect(mockScriptManager.getScriptSha).toHaveBeenCalledWith(
        "FIXED_WINDOW"
      );

      // Test token-bucket
      await processor.processBatch(requests, "token-bucket");
      expect(mockScriptManager.getScriptSha).toHaveBeenCalledWith(
        "TOKEN_BUCKET"
      );
    });

    test("should chunk large batches", async () => {
      const requests: BatchRateLimitRequest[] = Array(250).fill({
        key: "user:test",
        maxRequests: 100,
        windowMs: 60000,
      });

      await processor.processBatch(requests, "sliding-window");

      // Should be split into chunks of maxBatchSize (100)
      expect(mockRedisClient.getRedis().evalsha).toHaveBeenCalledTimes(3); // 250 / 100 = 2.5 -> 3 chunks
    });

    test("should handle batch processing errors", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      // Mock pipeline to fail
      const mockPipelineError = {
        evalsha: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error("Redis error")),
      };

      mockRedisClient.getRedis.mockReturnValue({
        pipeline: jest.fn(() => mockPipelineError),
        evalsha: jest.fn().mockResolvedValue([1, 99, Date.now() + 60000, 1]),
      });

      const result = await processor.processBatch(requests, "sliding-window");

      expect(result).toHaveLength(1);
      expect(result![0]?.result.allowed).toBe(false);
      expect(result![0]?.result.totalHits).toBe(-1); // Error indicator
    });
  });

  describe("Input Validation", () => {
    test("should reject empty requests array", async () => {
      await expect(
        processor.processBatch([], "sliding-window")
      ).rejects.toThrow("Requests must be a non-empty array");
    });

    test("should reject null requests", async () => {
      await expect(
        processor.processBatch(null as any, "sliding-window")
      ).rejects.toThrow("Requests must be a non-empty array");
    });

    test("should reject invalid request keys", async () => {
      const requests = [
        {
          key: "", // Empty key
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      await expect(
        processor.processBatch(requests, "sliding-window")
      ).rejects.toThrow("Invalid key at index 0");
    });

    test("should reject keys that are too long", async () => {
      const requests = [
        {
          key: "a".repeat(251), // Too long
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      await expect(
        processor.processBatch(requests, "sliding-window")
      ).rejects.toThrow("Invalid key at index 0");
    });

    test("should reject invalid maxRequests", async () => {
      const requests = [
        {
          key: "user:123",
          maxRequests: 0, // Invalid
          windowMs: 60000,
        },
      ];

      await expect(
        processor.processBatch(requests, "sliding-window")
      ).rejects.toThrow("Invalid maxRequests at index 0");
    });

    test("should reject maxRequests that are too high", async () => {
      const requests = [
        {
          key: "user:123",
          maxRequests: 10001, // Too high
          windowMs: 60000,
        },
      ];

      await expect(
        processor.processBatch(requests, "sliding-window")
      ).rejects.toThrow("Invalid maxRequests at index 0");
    });

    test("should reject invalid windowMs", async () => {
      const requests = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 0, // Invalid
        },
      ];

      await expect(
        processor.processBatch(requests, "sliding-window")
      ).rejects.toThrow("Invalid windowMs at index 0");
    });

    test("should reject windowMs that are too high", async () => {
      const requests = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 86400001, // Too high (24 hours + 1ms)
        },
      ];

      await expect(
        processor.processBatch(requests, "sliding-window")
      ).rejects.toThrow("Invalid windowMs at index 0");
    });

    test("should reject batches that are too large", async () => {
      const requests = Array(1001).fill({
        key: "user:test",
        maxRequests: 100,
        windowMs: 60000,
      });

      await expect(
        processor.processBatch(requests, "sliding-window")
      ).rejects.toThrow("Batch size too large: 1001");
    });
  });

  describe("Sliding Window Batch Processing", () => {
    test("should use batch script for sliding window with multiple requests", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:1",
          maxRequests: 100,
          windowMs: 60000,
        },
        {
          key: "user:2",
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      mockScriptManager.getScriptSha.mockReturnValue("batch-sliding-sha");
      mockRedisClient.getRedis().evalsha.mockResolvedValue([
        [1, 99, Date.now() + 60000, 1],
        [1, 98, Date.now() + 60000, 2],
      ]);

      const result = await processor.processBatch(requests, "sliding-window");

      expect(mockScriptManager.getScriptSha).toHaveBeenCalledWith(
        "BATCH_SLIDING_WINDOW"
      );
      expect(result).toHaveLength(2);
    });

    test("should handle missing batch script", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:1",
          maxRequests: 100,
          windowMs: 60000,
        },
        {
          key: "user:2",
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      mockScriptManager.getScriptSha.mockReturnValue(null);

      const result = await processor.processBatch(requests, "sliding-window");

      // Should return error results instead of throwing
      expect(result).toHaveLength(2);
      expect(result[0]?.result.allowed).toBe(false);
      expect(result[0]?.result.totalHits).toBe(-1); // Error indicator
      expect(result[1]?.result.allowed).toBe(false);
      expect(result[1]?.result.totalHits).toBe(-1); // Error indicator
    });
  });

  describe("Individual Request Processing", () => {
    test("should process single sliding window request individually", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      mockRedisClient
        .getRedis()
        .pipeline()
        .exec.mockResolvedValue([
          [null, [1, 99, Date.now() + 60000, 1]], // Success result
        ]);

      const result = await processor.processBatch(requests, "sliding-window");

      expect(result).toHaveLength(1);
      expect(result![0]?.result.allowed).toBe(true);
      expect(result![0]?.result.remaining).toBe(99);
    });

    test("should handle pipeline errors", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      mockRedisClient
        .getRedis()
        .pipeline()
        .exec.mockResolvedValue([
          [new Error("Pipeline error"), null], // Error result
        ]);

      const result = await processor.processBatch(requests, "sliding-window");

      expect(result).toHaveLength(1);
      expect(result![0]?.result.allowed).toBe(false);
      expect(result![0]?.result.totalHits).toBe(-1); // Error indicator
    });

    test("should handle invalid script results", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      mockRedisClient
        .getRedis()
        .pipeline()
        .exec.mockResolvedValue([
          [null, [1, 99]], // Incomplete result
        ]);

      const result = await processor.processBatch(requests, "sliding-window");

      expect(result).toHaveLength(1);
      expect(result![0]?.result.allowed).toBe(false);
      expect(result![0]?.result.totalHits).toBe(-1); // Error indicator
    });
  });

  describe("Concurrency Control", () => {
    test("should respect concurrency limits", async () => {
      const requests: BatchRateLimitRequest[] = Array(50).fill({
        key: "user:test",
        maxRequests: 100,
        windowMs: 60000,
      });

      // Custom processor with low concurrency
      const lowConcurrencyProcessor = new BatchRateLimitProcessor(
        mockRedisClient as any,
        scriptManager,
        "test_prefix",
        10,
        { concurrency: 2, maxBatchSize: 10 }
      );

      await lowConcurrencyProcessor.processBatch(requests, "sliding-window");

      // Should process in batches with concurrency control
      expect(mockRedisClient.getRedis).toHaveBeenCalled();
    });
  });

  describe("Statistics Calculation", () => {
    test("should calculate correct batch statistics", async () => {
      const mockResults: BatchRateLimitResponse[] = [
        {
          key: "user:1",
          result: {
            allowed: true,
            totalHits: 1,
            remaining: 99,
            resetTime: Date.now() + 60000,
            algorithm: "sliding-window",
            windowStart: Date.now() - 60000,
            windowEnd: Date.now() + 60000,
            limit: 100,
            cached: true,
            responseTime: 10,
          },
          executionTime: 10,
          cacheHit: true,
        },
        {
          key: "user:2",
          result: {
            allowed: false,
            totalHits: -1, // Error
            remaining: 0,
            resetTime: Date.now() + 60000,
            algorithm: "sliding-window",
            windowStart: Date.now() - 60000,
            windowEnd: Date.now() + 60000,
            limit: 100,
            cached: false,
            responseTime: 15,
          },
          executionTime: 15,
          cacheHit: false,
        },
      ];

      // Mock the processor to return our test results
      const processorWithStats = new BatchRateLimitProcessor(
        mockRedisClient as any,
        scriptManager
      );

      // Access private method for testing
      const stats = (processorWithStats as any).calculateBatchStats(
        mockResults,
        25
      );

      expect(stats.totalRequests).toBe(2);
      expect(stats.processedRequests).toBe(1); // One error
      expect(stats.cacheHits).toBe(1);
      expect(stats.avgExecutionTime).toBe(12.5);
      expect(stats.maxExecutionTime).toBe(15);
      expect(stats.minExecutionTime).toBe(10);
      expect(stats.errors).toBe(1);
    });

    test("should handle empty results for statistics", () => {
      const processorWithStats = new BatchRateLimitProcessor(
        mockRedisClient as any,
        scriptManager
      );

      const stats = (processorWithStats as any).calculateBatchStats([], 0);

      expect(stats.totalRequests).toBe(0);
      expect(stats.processedRequests).toBe(0);
      expect(stats.cacheHits).toBe(0);
      expect(stats.avgExecutionTime).toBe(0);
      expect(stats.maxExecutionTime).toBe(0);
      expect(stats.minExecutionTime).toBe(0);
      expect(stats.errors).toBe(0);
    });
  });

  describe("Error Handling", () => {
    test("should handle Redis connection errors", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      mockRedisClient.getRedis.mockImplementation(() => {
        throw new Error("Redis connection failed");
      });

      const result = await processor.processBatch(requests, "sliding-window");

      // Should return error results instead of throwing
      expect(result).toHaveLength(1);
      expect(result[0]?.result.allowed).toBe(false);
      expect(result[0]?.result.totalHits).toBe(-1); // Error indicator
    });

    test("should handle script loading errors", async () => {
      const requests: BatchRateLimitRequest[] = [
        {
          key: "user:123",
          maxRequests: 100,
          windowMs: 60000,
        },
      ];

      mockScriptManager.getScriptSha.mockReturnValue(null);

      const result = await processor.processBatch(requests, "token-bucket");

      // Should return error results instead of throwing
      expect(result).toHaveLength(1);
      expect(result[0]?.result.allowed).toBe(false);
      expect(result[0]?.result.totalHits).toBe(-1); // Error indicator
    });
  });

  describe("Priority Handling", () => {
    test("should sort by priority correctly", () => {
      const processorForPriority = new BatchRateLimitProcessor(
        mockRedisClient as any,
        scriptManager
      );

      const requests: BatchRateLimitRequest[] = [
        { key: "low", maxRequests: 100, windowMs: 60000, priority: "low" },
        { key: "high", maxRequests: 100, windowMs: 60000, priority: "high" },
        {
          key: "normal",
          maxRequests: 100,
          windowMs: 60000,
          priority: "normal",
        },
        { key: "default", maxRequests: 100, windowMs: 60000 }, // No priority
      ];

      const sorted = (processorForPriority as any).sortByPriority(requests);

      expect(sorted[0].key).toBe("high");
      expect(sorted[1].key).toBe("normal");
      expect(sorted[2].key).toBe("default");
      expect(sorted[3].key).toBe("low");
    });
  });

  describe("Chunking", () => {
    test("should chunk requests correctly", () => {
      const processorForChunking = new BatchRateLimitProcessor(
        mockRedisClient as any,
        scriptManager
      );

      const requests: BatchRateLimitRequest[] = Array(250).fill({
        key: "user:test",
        maxRequests: 100,
        windowMs: 60000,
      });

      const chunks = (processorForChunking as any).chunkRequests(requests, 100);

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toHaveLength(100);
      expect(chunks[1]).toHaveLength(100);
      expect(chunks[2]).toHaveLength(50);
    });

    test("should handle chunking with exact division", () => {
      const processorForChunking = new BatchRateLimitProcessor(
        mockRedisClient as any,
        scriptManager
      );

      const requests: BatchRateLimitRequest[] = Array(200).fill({
        key: "user:test",
        maxRequests: 100,
        windowMs: 60000,
      });

      const chunks = (processorForChunking as any).chunkRequests(requests, 100);

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(100);
      expect(chunks[1]).toHaveLength(100);
    });
  });
});
