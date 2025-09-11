// Mock dependencies
const mockRedisInstance = {
  script: jest.fn().mockResolvedValue("mock-sha"),
  evalsha: jest.fn().mockResolvedValue([1, 99, Date.now() + 60000, 1]),
  zremrangebyscore: jest.fn().mockResolvedValue(0),
  zcard: jest.fn().mockResolvedValue(1),
  zadd: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  del: jest.fn().mockResolvedValue(1),
  ping: jest.fn().mockResolvedValue("PONG"),
  publish: jest.fn().mockResolvedValue(1),
  subscribe: jest.fn(),
  on: jest.fn(),
};

const mockRedisClient = {
  getRedis: jest.fn(() => mockRedisInstance),
  isAvailable: jest.fn().mockReturnValue(true),
} as any;

const mockLogger = {
  child: jest.fn(() => mockLogger),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

// Mock the external dependencies
jest.mock("@libs/database", () => ({
  RedisClient: jest.fn().mockImplementation(() => mockRedisClient),
}));

jest.mock("@libs/monitoring", () => ({
  ILogger: jest.fn().mockImplementation(() => mockLogger),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn().mockReturnValue(mockLogger),
  ConsecutiveBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation((fn) => fn()),
    state: "closed",
  })),
}));

import {
  DistributedRateLimit,
  DistributedRateLimitConfig,
} from "../src/distributedRateLimit";

describe("DistributedRateLimit", () => {
  let distributedLimiter: DistributedRateLimit;
  let config: DistributedRateLimitConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    config = {
      algorithm: "sliding-window",
      maxRequests: 100,
      windowMs: 60000,
      redis: {
        keyPrefix: "test_rate_limit",
        ttlBuffer: 10,
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 3,
        recoveryTimeout: 30000,
      },
      distributed: {
        enabled: true,
        instanceId: "test-instance-123",
        syncInterval: 30000,
        maxDrift: 5000,
      },
    };

    distributedLimiter = new DistributedRateLimit(config, mockRedisClient);
  });

  afterEach(() => {
    // Clean up the distributed limiter to stop timers
    if (distributedLimiter) {
      distributedLimiter.destroy();
    }
    jest.clearAllMocks();
  });

  describe("Initialization", () => {
    test("should initialize with distributed config", () => {
      expect(distributedLimiter).toBeDefined();
    });

    test("should throw error if distributed not enabled", () => {
      const invalidConfig = {
        ...config,
        distributed: {
          enabled: false,
          instanceId: "test-instance-123",
          syncInterval: 30000,
          maxDrift: 5000,
        },
      };
      expect(() => {
        new DistributedRateLimit(invalidConfig, mockRedisClient);
      }).toThrow("Distributed rate limiting must be enabled in config");
    });

    test("should start periodic sync", () => {
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Distributed rate limiting initialized",
        expect.objectContaining({
          instanceId: "test-instance-123",
          syncInterval: 30000,
        })
      );
    });
  });

  describe("Distributed Events", () => {
    test("should subscribe to distributed events", () => {
      expect(mockRedisInstance.subscribe).toHaveBeenCalledWith(
        "rate_limit:sync",
        "rate_limit:reset",
        "rate_limit:events"
      );
    });

    test("should handle sync events from other instances", () => {
      // Simulate receiving a message from another instance
      const messageHandler = mockRedisInstance.on.mock.calls.find(
        ([event]: [string, any]) => event === "message"
      )![1];

      const event = {
        instanceId: "other-instance",
        timestamp: Date.now(),
        type: "heartbeat",
      };

      messageHandler("rate_limit:sync", JSON.stringify(event));

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Received sync from instance",
        expect.objectContaining({
          fromInstance: "other-instance",
        })
      );
    });

    test("should ignore own messages", () => {
      const messageHandler = mockRedisInstance.on.mock.calls.find(
        ([event]: [string, any]) => event === "message"
      )![1];

      const event = {
        instanceId: "test-instance-123", // Same as our instance
        timestamp: Date.now(),
        type: "heartbeat",
      };

      messageHandler("rate_limit:sync", JSON.stringify(event));

      // Should not log the sync message since it's our own message
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        "Received sync from instance",
        expect.any(Object)
      );
    });
  });

  describe("Rate Limiting with Distribution", () => {
    test("should publish denied events to other instances", async () => {
      // Mock the Redis operations to simulate a denied request
      mockRedisInstance.zcard.mockResolvedValueOnce(100); // Global count exceeds limit

      await distributedLimiter.checkRateLimit("user:123", 100, 60000);

      expect(mockRedisInstance.publish).toHaveBeenCalledWith(
        "rate_limit:events",
        expect.stringContaining('"type":"denied"')
      );
    });

    test("should not publish events for allowed requests", async () => {
      await distributedLimiter.checkRateLimit("user:123", 100, 60000);

      expect(mockRedisInstance.publish).not.toHaveBeenCalled();
    });
  });

  describe("Reset with Distribution", () => {
    test("should publish reset events to other instances", async () => {
      await distributedLimiter.reset("user:123");

      expect(mockRedisInstance.publish).toHaveBeenCalledWith(
        "rate_limit:events",
        expect.stringContaining('"type":"reset"')
      );
    });
  });

  describe("Periodic Sync", () => {
    test("should publish heartbeat during sync", () => {
      // Trigger the sync function (normally called by setInterval)
      const syncFunction = (distributedLimiter as any).performSync;
      syncFunction.call(distributedLimiter);

      expect(mockRedisInstance.publish).toHaveBeenCalledWith(
        "rate_limit:events",
        expect.stringContaining('"type":"heartbeat"')
      );
    });

    test("should detect time drift", async () => {
      // Set lastSyncTime to simulate drift
      (distributedLimiter as any).lastSyncTime = Date.now() - 10000; // 10 seconds ago

      const syncFunction = (distributedLimiter as any).performSync;
      await syncFunction.call(distributedLimiter);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Time drift detected",
        expect.objectContaining({
          drift: expect.any(Number),
          maxDrift: 5000,
          instanceId: "test-instance-123",
        })
      );
    });
  });

  describe("Health Monitoring", () => {
    test("should provide distributed health status", async () => {
      const health = await distributedLimiter.getDistributedHealth();

      expect(health).toHaveProperty("distributed");
      expect(health.distributed).toEqual({
        enabled: true,
        instanceId: "test-instance-123",
        syncInterval: 30000,
        lastSyncTime: expect.any(Number),
        timeSinceLastSync: expect.any(Number),
      });
    });
  });

  describe("Active Instances", () => {
    test("should return current instance when no registry", async () => {
      const instances = await distributedLimiter.getActiveInstances();

      expect(instances).toEqual(["test-instance-123"]);
    });
  });

  describe("Cleanup", () => {
    test("should clean up resources on destroy", () => {
      distributedLimiter.destroy();

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Distributed rate limiter destroyed",
        expect.objectContaining({
          instanceId: "test-instance-123",
        })
      );
    });
  });

  describe("Error Handling", () => {
    test("should handle malformed distributed events", () => {
      const messageHandler = mockRedisInstance.on.mock.calls.find(
        ([event]: [string, any]) => event === "message"
      )![1];

      messageHandler("rate_limit:sync", "invalid json");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to handle distributed event",
        expect.any(Error),
        expect.objectContaining({
          channel: "rate_limit:sync",
          message: "invalid json",
        })
      );
    });

    test("should handle sync failures gracefully", async () => {
      // Mock the publish method to reject
      mockRedisInstance.publish.mockRejectedValueOnce(new Error("Redis error"));

      const syncFunction = (distributedLimiter as any).performSync;
      await syncFunction.call(distributedLimiter);

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to publish distributed event",
        expect.any(Error),
        expect.objectContaining({
          type: "heartbeat",
        })
      );
    });
  });
});
