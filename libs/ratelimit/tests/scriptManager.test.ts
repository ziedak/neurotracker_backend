import { SharedScriptManager } from "../src/performance/scriptManager";

// Mock dependencies
const mockRedisClient = {
  getRedis: jest.fn(() => ({
    script: jest.fn(),
  })),
  isAvailable: jest.fn().mockReturnValue(true),
};

// Mock the dependencies
jest.mock("@libs/database", () => ({
  RedisClient: jest.fn().mockImplementation(() => mockRedisClient),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe("SharedScriptManager", () => {
  let scriptManager: SharedScriptManager;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset singleton instance for clean testing
    (SharedScriptManager as any).instance = undefined;
    scriptManager = SharedScriptManager.getInstance();

    // Setup default mock behavior - mock the script method to resolve
    const mockScript = jest.fn();
    mockRedisClient.getRedis.mockReturnValue({
      script: mockScript,
    });
    mockScript.mockResolvedValue("mock-sha-123");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Singleton Pattern", () => {
    test("should return same instance", () => {
      const instance1 = SharedScriptManager.getInstance();
      const instance2 = SharedScriptManager.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance1).toBe(scriptManager);
    });

    test("should create new instance after reset", () => {
      const instance1 = SharedScriptManager.getInstance();
      (instance1 as any).reset();
      (SharedScriptManager as any).instance = undefined;

      const instance2 = SharedScriptManager.getInstance();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe("Initialization", () => {
    test("should initialize scripts successfully", async () => {
      await scriptManager.initialize(mockRedisClient as any);

      expect(scriptManager.isInitialized()).toBe(true);
      expect(mockRedisClient.getRedis().script).toHaveBeenCalledTimes(4); // 4 scripts
    });

    test("should handle initialization errors", async () => {
      mockRedisClient
        .getRedis()
        .script.mockRejectedValue(new Error("Redis error"));

      await expect(
        scriptManager.initialize(mockRedisClient as any)
      ).rejects.toThrow("Redis error");

      expect(scriptManager.isInitialized()).toBe(false);
    });

    test("should prevent concurrent initialization", async () => {
      // Start two initialization calls
      const init1 = scriptManager.initialize(mockRedisClient as any);
      const init2 = scriptManager.initialize(mockRedisClient as any);

      await Promise.all([init1, init2]);

      // Should only call Redis once due to promise sharing
      expect(mockRedisClient.getRedis().script).toHaveBeenCalledTimes(4);
      expect(scriptManager.isInitialized()).toBe(true);
    });

    test("should return immediately if already initialized", async () => {
      await scriptManager.initialize(mockRedisClient as any);
      await scriptManager.initialize(mockRedisClient as any);

      // Should still only call Redis once
      expect(mockRedisClient.getRedis().script).toHaveBeenCalledTimes(4);
    });
  });

  describe("Script Management", () => {
    beforeEach(async () => {
      await scriptManager.initialize(mockRedisClient as any);
    });

    test("should get script SHA by name", () => {
      const sha = scriptManager.getScriptSha("SLIDING_WINDOW");

      expect(sha).toBe("mock-sha-123");
    });

    test("should return undefined for unknown script", () => {
      const sha = scriptManager.getScriptSha("UNKNOWN_SCRIPT" as any);

      expect(sha).toBeUndefined();
    });

    test("should get all available scripts", () => {
      const scripts = scriptManager.getAvailableScripts();

      expect(scripts).toContain("SLIDING_WINDOW");
      expect(scripts).toContain("FIXED_WINDOW");
      expect(scripts).toContain("TOKEN_BUCKET");
      expect(scripts).toContain("BATCH_SLIDING_WINDOW");
      expect(scripts).toHaveLength(4);
    });

    test("should get script content for debugging", () => {
      const content = scriptManager.getScriptContent("SLIDING_WINDOW");

      expect(content).toBeDefined();
      expect(typeof content).toBe("string");
      expect(content!.length).toBeGreaterThan(0);
      expect(content).toContain("local key = KEYS[1]");
    });

    test("should return undefined for unknown script content", () => {
      const content = scriptManager.getScriptContent("UNKNOWN_SCRIPT" as any);

      expect(content).toBeUndefined();
    });
  });

  describe("Reset and Re-initialization", () => {
    test("should reset initialization state", async () => {
      await scriptManager.initialize(mockRedisClient as any);
      expect(scriptManager.isInitialized()).toBe(true);

      (scriptManager as any).reset();
      expect(scriptManager.isInitialized()).toBe(false);

      // SHAs should be cleared
      const sha = scriptManager.getScriptSha("SLIDING_WINDOW");
      expect(sha).toBeUndefined();
    });

    test("should force re-initialization", async () => {
      await scriptManager.initialize(mockRedisClient as any);
      expect(scriptManager.isInitialized()).toBe(true);

      // Force re-initialization
      await (scriptManager as any).forceReinitialize(mockRedisClient as any);

      expect(scriptManager.isInitialized()).toBe(true);
      // Should have called Redis again
      expect(mockRedisClient.getRedis().script).toHaveBeenCalledTimes(8); // 4 + 4 scripts
    });
  });

  describe("Error Handling", () => {
    test("should handle Redis connection errors during initialization", async () => {
      mockRedisClient.getRedis.mockImplementation(() => {
        throw new Error("Connection failed");
      });

      await expect(
        scriptManager.initialize(mockRedisClient as any)
      ).rejects.toThrow("Connection failed");

      expect(scriptManager.isInitialized()).toBe(false);
    });

    test("should handle partial script loading failures", async () => {
      let callCount = 0;
      mockRedisClient.getRedis().script.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Script loading failed");
        }
        return "mock-sha-" + callCount;
      });

      await expect(
        scriptManager.initialize(mockRedisClient as any)
      ).rejects.toThrow("Script loading failed");

      expect(scriptManager.isInitialized()).toBe(false);
    });
  });

  describe("State Management", () => {
    test("should track initialization state correctly", async () => {
      expect(scriptManager.isInitialized()).toBe(false);

      await scriptManager.initialize(mockRedisClient as any);
      expect(scriptManager.isInitialized()).toBe(true);

      (scriptManager as any).reset();
      expect(scriptManager.isInitialized()).toBe(false);
    });

    test("should handle multiple initialization attempts gracefully", async () => {
      const promises = [
        scriptManager.initialize(mockRedisClient as any),
        scriptManager.initialize(mockRedisClient as any),
        scriptManager.initialize(mockRedisClient as any),
      ];

      await Promise.all(promises);

      expect(scriptManager.isInitialized()).toBe(true);
      // Should only initialize once
      expect(mockRedisClient.getRedis().script).toHaveBeenCalledTimes(4);
    });
  });

  describe("Script Content Validation", () => {
    test("should contain valid Lua script structure", () => {
      const slidingWindowScript =
        scriptManager.getScriptContent("SLIDING_WINDOW");

      expect(slidingWindowScript).toContain("local key = KEYS[1]");
      expect(slidingWindowScript).toContain("redis.call(");
      expect(slidingWindowScript).toContain(
        "return {allowed, remaining, reset_time, total_requests}"
      );
    });

    test("should contain batch script structure", () => {
      const batchScript = scriptManager.getScriptContent(
        "BATCH_SLIDING_WINDOW"
      );

      expect(batchScript).toContain("local keys = KEYS");
      expect(batchScript).toContain("for i, key in ipairs(keys)");
      expect(batchScript).toContain(
        "results[i] = {allowed, remaining, reset_time, total_requests}"
      );
    });

    test("should contain fixed window script structure", () => {
      const fixedWindowScript = scriptManager.getScriptContent("FIXED_WINDOW");

      expect(fixedWindowScript).toContain("local key = KEYS[1]");
      expect(fixedWindowScript).toContain("redis.call('INCR', key)");
      expect(fixedWindowScript).toContain("redis.call('EXPIRE', key, expiry)");
    });

    test("should contain token bucket script structure", () => {
      const tokenBucketScript = scriptManager.getScriptContent("TOKEN_BUCKET");

      expect(tokenBucketScript).toContain("local key = KEYS[1]");
      expect(tokenBucketScript).toContain(
        "local refill_rate = tonumber(ARGV[3])"
      );
      expect(tokenBucketScript).toContain(
        "return {allowed, remaining, reset_time, capacity - remaining}"
      );
    });
  });

  describe("Memory Management", () => {
    test("should not leak memory between tests", () => {
      // Create multiple instances and ensure singleton works
      const instance1 = SharedScriptManager.getInstance();
      const instance2 = SharedScriptManager.getInstance();
      const instance3 = SharedScriptManager.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
      expect(instance1).toBe(scriptManager);
    });

    test("should clean up initialization promise on error", async () => {
      mockRedisClient
        .getRedis()
        .script.mockRejectedValue(new Error("Init failed"));

      await expect(
        scriptManager.initialize(mockRedisClient as any)
      ).rejects.toThrow();

      // Should be able to retry initialization
      mockRedisClient.getRedis().script.mockResolvedValue("retry-sha");
      await scriptManager.initialize(mockRedisClient as any);

      expect(scriptManager.isInitialized()).toBe(true);
    });
  });
});
