import { createLogger, executeRedisWithRetry } from "../../../../utils/src";
import { RedisClient } from "../../../src/redis/redisClient";

// Mock ioredis
jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    quit: jest.fn(),
    ping: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    keys: jest.fn(),
    scan: jest.fn(),
    mget: jest.fn(),
    publish: jest.fn(),
    subscribe: jest.fn(),
    pipeline: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    once: jest.fn(),
    emit: jest.fn(),
    status: "ready",
    options: {},
  }));
});

// Mock dependencies
jest.mock("@libs/config", () => ({
  getEnv: jest.fn((key: string, defaultValue?: string) => {
    const envMap: Record<string, string> = {
      REDIS_HOST: "localhost",
      REDIS_PORT: "6379",
      REDIS_PASSWORD: "",
      REDIS_DB: "0",
      REDIS_USERNAME: "",
      REDIS_MAX_RETRIES: "3",
      REDIS_CONNECT_TIMEOUT: "10000",
      REDIS_COMMAND_TIMEOUT: "5000",
      REDIS_KEEP_ALIVE: "30000",
    };
    return envMap[key] ?? defaultValue ?? "";
  }),
  getNumberEnv: jest.fn((key: string, defaultValue?: number) => {
    const envMap: Record<string, number> = {
      REDIS_PORT: 6379,
      REDIS_DB: 0,
      REDIS_MAX_RETRIES: 3,
      REDIS_CONNECT_TIMEOUT: 10000,
      REDIS_COMMAND_TIMEOUT: 5000,
      REDIS_KEEP_ALIVE: 30000,
    };
    return envMap[key] ?? defaultValue ?? 0;
  }),
  getBooleanEnv: jest.fn((key: string, defaultValue?: boolean) => {
    const envMap: Record<string, boolean> = {
      REDIS_TLS: false,
      REDIS_TLS_REJECT_UNAUTHORIZED: true,
    };
    return envMap[key] ?? defaultValue ?? false;
  }),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(),
  executeRedisWithRetry: jest.fn(),
}));

jest.mock("@libs/monitoring", () => ({
  IMetricsCollector: jest.fn(),
}));

describe("RedisClient", () => {
  let redisClient: RedisClient;
  let mockRedis: {
    connect: jest.Mock;
    disconnect: jest.Mock;
    quit: jest.Mock;
    ping: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
    setex: jest.Mock;
    del: jest.Mock;
    exists: jest.Mock;
    keys: jest.Mock;
    scan: jest.Mock;
    mget: jest.Mock;
    publish: jest.Mock;
    subscribe: jest.Mock;
    pipeline: jest.Mock;
    on: jest.Mock;
    off: jest.Mock;
    once: jest.Mock;
    emit: jest.Mock;
    status: string;
    options: Record<string, unknown>;
  };
  let mockLogger: {
    info: jest.Mock;
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let mockMetrics: {
    recordTimer: jest.Mock;
    recordCounter: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mocks
    mockRedis = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue("PONG"),
      get: jest.fn().mockResolvedValue("test-value"),
      set: jest.fn().mockResolvedValue("OK"),
      setex: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
      exists: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue(["key1", "key2"]),
      mget: jest.fn().mockResolvedValue(["value1", "value2"]),
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn(),
      pipeline: jest.fn().mockReturnValue({ exec: jest.fn() }),
      scan: jest.fn().mockResolvedValue(["0", ["key1", "key2"]]),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      emit: jest.fn(),
      status: "ready",
      options: {},
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    mockMetrics = {
      recordTimer: jest.fn(),
      recordCounter: jest.fn(),
    };

    // Setup mock implementations
    (createLogger as jest.Mock).mockReturnValue(mockLogger);
    (executeRedisWithRetry as jest.Mock).mockImplementation(
      (redis, operation, errorHandler, _options) => {
        try {
          const result = operation(redis);
          return result;
        } catch (error) {
          errorHandler(error);
          throw error;
        }
      }
    );

    // Mock ioredis constructor
    const RedisMock = require("ioredis");
    RedisMock.mockImplementation(() => mockRedis);

    redisClient = new RedisClient(mockMetrics);
  });

  afterEach(async () => {
    // Clean up
    await redisClient.disconnect();
  });

  describe("constructor", () => {
    it("should initialize with default configuration", () => {
      expect(redisClient).toBeDefined();
      expect(createLogger).toHaveBeenCalledWith("RedisClient");
    });

    it("should initialize with custom configuration", () => {
      const customConfig = {
        host: "custom-host",
        port: 6380,
        password: "custom-password",
      };

      const customClient = new RedisClient(mockMetrics, customConfig);
      expect(customClient).toBeDefined();
    });

    it("should create static instance", () => {
      const staticClient = RedisClient.create({}, mockMetrics);
      expect(staticClient).toBeInstanceOf(RedisClient);
    });
  });

  describe("connection management", () => {
    it("should connect successfully", async () => {
      mockRedis.connect.mockResolvedValue(undefined);

      await redisClient.connect();

      expect(mockRedis.connect).toHaveBeenCalled();
    });

    it("should handle connection errors", async () => {
      const error = new Error("Connection failed");
      mockRedis.connect.mockRejectedValue(error);

      await expect(redisClient.connect()).rejects.toThrow("Connection failed");
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Redis connect() failed",
        error
      );
    });

    it("should disconnect successfully", async () => {
      // Set connected state
      (redisClient as unknown as { isConnected: boolean }).isConnected = true;
      mockRedis.quit.mockResolvedValue(undefined);

      await redisClient.disconnect();

      expect(mockRedis.quit).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith("Redis disconnected");
    });
  });

  describe("basic operations", () => {
    beforeEach(async () => {
      await redisClient.connect();
    });

    it("should ping successfully", async () => {
      mockRedis.ping.mockResolvedValue("PONG");

      const result = await redisClient.ping();

      expect(mockRedis.ping).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should return false when ping fails", async () => {
      mockRedis.ping.mockResolvedValue("NOT_PONG");

      const result = await redisClient.ping();

      expect(mockRedis.ping).toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it("should get value using safeGet", async () => {
      mockRedis.get.mockResolvedValue("test-value");

      const result = await redisClient.safeGet("test-key");

      expect(result).toBe("test-value");
      expect(mockRedis.get).toHaveBeenCalledWith("test-key");
    });

    it("should set value using safeSet", async () => {
      mockRedis.set.mockResolvedValue("OK");

      const result = await redisClient.safeSet("test-key", "test-value");

      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith("test-key", "test-value");
    });

    it("should set value with TTL using safeSet", async () => {
      mockRedis.set.mockResolvedValue("OK");

      const result = await redisClient.safeSet("test-key", "test-value", 300);

      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "test-key",
        "test-value",
        "EX",
        300
      );
    });

    it("should set value with TTL using safeSetEx", async () => {
      mockRedis.setex.mockResolvedValue("OK");

      const result = await redisClient.safeSetEx("test-key", 300, "test-value");

      expect(result).toBe(true);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        "test-key",
        300,
        "test-value"
      );
    });

    it("should delete key using safeDel", async () => {
      mockRedis.del.mockResolvedValue(1);

      const result = await redisClient.safeDel("test-key");

      expect(result).toBe(1);
      expect(mockRedis.del).toHaveBeenCalledWith("test-key");
    });

    it("should check if key exists", async () => {
      mockRedis.exists.mockResolvedValue(1);

      const result = await redisClient.exists("test-key");

      expect(result).toBe(1);
      expect(mockRedis.exists).toHaveBeenCalledWith("test-key");
    });

    it("should get keys by pattern using safeKeys", async () => {
      const keys = ["key1", "key2"];
      mockRedis.keys.mockResolvedValue(keys);

      const result = await redisClient.safeKeys("pattern*");

      expect(result).toEqual(keys);
      expect(mockRedis.keys).toHaveBeenCalledWith("pattern*");
    });

    it("should get multiple values using safeMget", async () => {
      const values = ["value1", "value2"];
      mockRedis.mget.mockResolvedValue(values);

      const result = await redisClient.safeMget("key1", "key2");

      expect(result).toEqual(values);
      expect(mockRedis.mget).toHaveBeenCalledWith("key1", "key2");
    });
  });

  describe("pub/sub operations", () => {
    beforeEach(async () => {
      await redisClient.connect();
    });

    it("should publish message using safePublish", async () => {
      mockRedis.publish.mockResolvedValue(1);

      const result = await redisClient.safePublish("channel", "message");

      expect(result).toBe(1);
      expect(mockRedis.publish).toHaveBeenCalledWith("channel", "message");
    });

    it("should create subscriber", () => {
      const subscriber = redisClient.createSubscriber();

      expect(subscriber).toBeDefined();
      expect(typeof subscriber.connect).toBe("function");
    });
  });

  describe("pipeline operations", () => {
    beforeEach(async () => {
      await redisClient.connect();
    });

    it("should create pipeline using safePipeline", async () => {
      const mockPipeline = { exec: jest.fn() };
      mockRedis.pipeline.mockReturnValue(mockPipeline);

      const pipeline = await redisClient.safePipeline();

      expect(pipeline).toBe(mockPipeline);
      expect(mockRedis.pipeline).toHaveBeenCalled();
    });
  });

  describe("scan operations", () => {
    beforeEach(async () => {
      await redisClient.connect();
    });

    it("should scan keys using safeScan", async () => {
      const scanResult = ["0", ["key1", "key2"]];
      mockRedis.scan.mockResolvedValue(scanResult);

      const result = await redisClient.safeScan(
        0,
        "MATCH",
        "pattern*",
        "COUNT",
        10
      );

      expect(result).toEqual(scanResult);
      expect(mockRedis.scan).toHaveBeenCalledWith(
        0,
        "MATCH",
        "pattern*",
        "COUNT",
        10,
        undefined
      );
    });
  });

  describe("health check", () => {
    it("should return healthy status", async () => {
      mockRedis.ping.mockResolvedValue("PONG");

      const result = await redisClient.healthCheck();

      expect(result.status).toBe("healthy");
      expect(result).toHaveProperty("latency");
      expect(typeof result.latency).toBe("number");
      expect(result.latency).toBeGreaterThanOrEqual(0);
      expect(result).toHaveProperty("connectionState");
      expect(typeof result.connectionState).toBe("string");
      expect(result).toHaveProperty("retryCount");
      expect(typeof result.retryCount).toBe("number");
    });

    it("should return unhealthy status on failure", async () => {
      mockRedis.ping.mockRejectedValue(new Error("Ping failed"));

      const result = await redisClient.healthCheck();

      expect(result.status).toBe("unhealthy");
      expect(result).toHaveProperty("connectionState");
      expect(result).toHaveProperty("retryCount");
      expect(result).not.toHaveProperty("latency");
    });
  });

  describe("isHealthy", () => {
    it("should return true when healthy", async () => {
      // Set connected state
      (redisClient as unknown as { isConnected: boolean }).isConnected = true;
      mockRedis.ping.mockResolvedValue("PONG");

      const result = await redisClient.isHealthy();

      expect(result).toBe(true);
    });

    it("should return false when unhealthy", async () => {
      mockRedis.ping.mockRejectedValue(new Error("Ping failed"));

      const result = await redisClient.isHealthy();

      expect(result).toBe(false);
    });

    it("should return false when not connected", async () => {
      // Simulate disconnected state
      await redisClient.disconnect();

      const result = await redisClient.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return connection statistics", () => {
      const stats = redisClient.getStats();

      expect(stats).toEqual({
        isConnected: expect.any(Boolean),
        retryCount: expect.any(Number),
        connectionStatus: expect.any(String),
      });
    });
  });

  describe("forceReconnect", () => {
    it("should force reconnection", async () => {
      mockRedis.disconnect.mockImplementation(() => {});
      mockRedis.connect.mockResolvedValue(undefined);

      await redisClient.forceReconnect();

      expect(mockRedis.disconnect).toHaveBeenCalled();
      expect(mockRedis.connect).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle safeGet operation errors", async () => {
      const error = new Error("Redis operation failed");
      mockRedis.get.mockRejectedValue(error);

      const result = await redisClient.safeGet("test-key");

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Safe get failed for key test-key",
        error
      );
    });

    it("should handle safeSet operation errors", async () => {
      const error = new Error("Redis operation failed");
      mockRedis.set.mockRejectedValue(error);

      const result = await redisClient.safeSet("test-key", "test-value");

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Safe set failed for key test-key",
        error
      );
    });

    it("should handle safeDel operation errors", async () => {
      const error = new Error("Redis operation failed");
      mockRedis.del.mockRejectedValue(error);

      const result = await redisClient.safeDel("test-key");

      expect(result).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Safe del failed for keys test-key",
        error
      );
    });

    it("should handle safeKeys operation errors", async () => {
      const error = new Error("Redis operation failed");
      mockRedis.keys.mockRejectedValue(error);

      const result = await redisClient.safeKeys("pattern*");

      expect(result).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Safe keys failed for pattern pattern*",
        error
      );
    });

    it("should handle safePublish operation errors", async () => {
      const error = new Error("Redis operation failed");
      mockRedis.publish.mockRejectedValue(error);

      const result = await redisClient.safePublish("channel", "message");

      expect(result).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to publish to channel channel",
        error
      );
    });
  });

  describe("input validation", () => {
    it("should reject invalid key in safeGet", async () => {
      const result = await redisClient.safeGet("");

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Invalid key provided to safeGet",
        { key: "" }
      );
    });

    it("should reject invalid key in safeSet", async () => {
      const result = await redisClient.safeSet("", "value");

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Invalid key provided to safeSet",
        { key: "" }
      );
    });

    it("should reject invalid pattern in safeKeys", async () => {
      const result = await redisClient.safeKeys("*");

      expect(result).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Dangerous pattern provided to safeKeys, blocking",
        { pattern: "*" }
      );
    });

    it("should reject invalid channel in safePublish", async () => {
      const result = await redisClient.safePublish("", "message");

      expect(result).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Invalid channel provided to safePublish",
        { channel: "" }
      );
    });

    it("should reject oversized key", async () => {
      const longKey = "a".repeat(513);
      const result = await redisClient.safeGet(longKey);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith("Key too long for safeGet", {
        keyLength: 513,
      });
    });

    it("should reject oversized value", async () => {
      const longValue = "a".repeat(1024 * 1024 + 1);
      const result = await redisClient.safeSet("key", longValue);

      expect(result).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Value too large for safeSet",
        { valueLength: 1048577 }
      );
    });
  });
});
