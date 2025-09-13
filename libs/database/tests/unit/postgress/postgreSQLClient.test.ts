// Mock external dependencies
jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn(),
}));

jest.mock("@libs/config", () => ({
  getEnv: jest.fn((key: string, defaultValue?: string) => {
    const envMap: Record<string, string> = {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      POSTGRESQL_MAX_RETRIES: "3",
      POSTGRESQL_RETRY_DELAY: "1000",
      POSTGRESQL_CIRCUIT_BREAKER_THRESHOLD: "5",
      POSTGRESQL_CIRCUIT_BREAKER_TIMEOUT: "30000",
      POSTGRESQL_CONNECTION_TIMEOUT: "10000",
      POSTGRESQL_METRICS_ENABLED: "true",
      POSTGRESQL_SLOW_QUERY_THRESHOLD: "1000",
      POSTGRESQL_HEALTH_CHECK_INTERVAL: "30000",
      POSTGRESQL_QUERY_CACHE_ENABLED: "true",
      POSTGRESQL_QUERY_CACHE_DEFAULT_TTL: "300",
      POSTGRESQL_QUERY_CACHE_MAX_SIZE: "1000",
      POSTGRESQL_QUERY_CACHE_KEY_PREFIX: "postgresql:",
      POSTGRESQL_QUERY_CACHE_EXCLUDE_PATTERNS:
        "INSERT,UPDATE,DELETE,CREATE,DROP,ALTER,TRUNCATE",
      DATABASE_LOGGING: "false",
    };
    return envMap[key] ?? defaultValue ?? "";
  }),
  getBooleanEnv: jest.fn((key: string, defaultValue?: boolean) => {
    const envMap: Record<string, boolean> = {
      POSTGRESQL_METRICS_ENABLED: true,
      POSTGRESQL_QUERY_CACHE_ENABLED: true,
      DATABASE_LOGGING: false,
    };
    return envMap[key] ?? defaultValue ?? false;
  }),
  getNumberEnv: jest.fn((key: string, defaultValue?: number) => {
    const envMap: Record<string, number> = {
      POSTGRESQL_MAX_RETRIES: 3,
      POSTGRESQL_RETRY_DELAY: 1000,
      POSTGRESQL_CIRCUIT_BREAKER_THRESHOLD: 5,
      POSTGRESQL_CIRCUIT_BREAKER_TIMEOUT: 30000,
      POSTGRESQL_CONNECTION_TIMEOUT: 10000,
      POSTGRESQL_SLOW_QUERY_THRESHOLD: 1000,
      POSTGRESQL_HEALTH_CHECK_INTERVAL: 30000,
      POSTGRESQL_QUERY_CACHE_DEFAULT_TTL: 300,
      POSTGRESQL_QUERY_CACHE_MAX_SIZE: 1000,
    };
    return envMap[key] ?? defaultValue ?? 0;
  }),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(),
  executeWithRetry: jest.fn(),
}));

jest.mock("@prisma/extension-accelerate", () => ({
  withAccelerate: jest.fn().mockReturnValue({}),
}));

import {
  PostgreSQLClient,
  PostgreSQLError,
} from "../../../src/postgress/PostgreSQLClient";

// Mock dependencies
const mockPrismaClient = {
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $queryRaw: jest.fn(),
  $queryRawUnsafe: jest.fn(),
  $transaction: jest.fn(),
  $extends: jest.fn().mockReturnThis(),
};

const mockMetricsCollector = {
  recordTimer: jest.fn(),
  recordCounter: jest.fn(),
};

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  invalidate: jest.fn(),
  invalidatePattern: jest.fn(),
  getStats: jest.fn(),
  healthCheck: jest.fn(),
  isEnabled: jest.fn(),
};

const mockExecuteWithRetry = require("@libs/utils").executeWithRetry;
const mockCreateLogger = require("@libs/utils").createLogger;

describe("PostgreSQLClient", () => {
  let client: PostgreSQLClient;
  let loggerMock: {
    info: jest.Mock;
    debug: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup logger mock
    loggerMock = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    mockCreateLogger.mockReturnValue(loggerMock);

    // Setup executeWithRetry mock to just call the function
    mockExecuteWithRetry.mockImplementation((fn: Function) => fn());

    // Setup Prisma constructor to return mock client
    const { PrismaClient } = require("@prisma/client");
    PrismaClient.mockImplementation(() => mockPrismaClient);

    // Setup cache service mocks
    mockCacheService.get.mockResolvedValue({ data: null });
    mockCacheService.set.mockResolvedValue(undefined);
    mockCacheService.invalidate.mockResolvedValue(undefined);
    mockCacheService.invalidatePattern.mockResolvedValue(5);
    mockCacheService.getStats.mockReturnValue({ Hits: 10, Misses: 5 });
    mockCacheService.healthCheck.mockResolvedValue({ hitRate: 0.67 });
    mockCacheService.isEnabled.mockResolvedValue(true);

    // Setup Prisma mocks
    mockPrismaClient.$queryRaw.mockResolvedValue([
      { version: "PostgreSQL 15.0" },
    ]);
    mockPrismaClient.$queryRawUnsafe.mockResolvedValue([]);
    mockPrismaClient.$transaction.mockImplementation(
      (callback: (prisma: unknown) => unknown) => callback(mockPrismaClient)
    );

    client = new PostgreSQLClient(mockMetricsCollector, mockCacheService);
  });

  afterEach(async () => {
    // Clean up connections
    await client.disconnect();
  });

  describe("constructor", () => {
    it("should initialize with default configuration", () => {
      expect(client).toBeDefined();
      expect(mockCreateLogger).toHaveBeenCalledWith("PostgreSQLClient");
      expect(loggerMock.info).toHaveBeenCalledWith(
        "PostgreSQL client initialized",
        expect.objectContaining({
          accelerateEnabled: true,
          strictMode: true,
          resilience: expect.any(Object),
          metrics: expect.any(Object),
          queryCache: expect.any(Object),
        })
      );
    });

    it("should initialize without optional dependencies", () => {
      const clientWithoutDeps = new PostgreSQLClient();
      expect(clientWithoutDeps).toBeDefined();
    });

    it("should create static instance", () => {
      const staticClient = PostgreSQLClient.create(
        mockMetricsCollector,
        mockCacheService
      );
      expect(staticClient).toBeInstanceOf(PostgreSQLClient);
    });
  });

  describe("connect", () => {
    it("should connect successfully", async () => {
      mockPrismaClient.$connect.mockResolvedValue(undefined);

      await client.connect();

      expect(mockPrismaClient.$connect).toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(
        "Database connection established"
      );
    });

    it("should handle connection errors", async () => {
      const error = new Error("Connection failed");
      mockPrismaClient.$connect.mockRejectedValue(error);

      await expect(client.connect()).rejects.toThrow("Connection failed");
      expect(loggerMock.error).toHaveBeenCalledWith(
        "Failed to connect to database",
        error
      );
    });

    it("should be idempotent", async () => {
      mockPrismaClient.$connect.mockResolvedValue(undefined);

      await client.connect();
      await client.connect(); // Second call should not connect again

      expect(mockPrismaClient.$connect).toHaveBeenCalledTimes(1);
    });
  });

  describe("disconnect", () => {
    it("should disconnect successfully", async () => {
      await client.connect(); // Ensure connected first
      mockPrismaClient.$disconnect.mockResolvedValue(undefined);

      await client.disconnect();

      expect(mockPrismaClient.$disconnect).toHaveBeenCalled();
      expect(loggerMock.info).toHaveBeenCalledWith(
        "Database connection closed"
      );
    });

    it("should be idempotent", async () => {
      await client.connect(); // Ensure connected first
      mockPrismaClient.$disconnect.mockResolvedValue(undefined);

      await client.disconnect();
      await client.disconnect();

      expect(mockPrismaClient.$disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("ping", () => {
    it("should ping successfully and record metrics", async () => {
      mockPrismaClient.$queryRaw.mockResolvedValue([]);

      const result = await client.ping();

      expect(result).toBe(true);
      expect(mockPrismaClient.$queryRaw).toHaveBeenCalled();
      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "postgresql.ping.duration",
        expect.any(Number)
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "postgresql.ping.success"
      );
    });

    it("should handle ping failures", async () => {
      const error = new Error("Ping failed");
      mockExecuteWithRetry.mockRejectedValue(error);

      await expect(client.ping()).rejects.toThrow(PostgreSQLError);
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "postgresql.ping.failure"
      );
    });
  });

  describe("healthCheck", () => {
    it("should return healthy status with version", async () => {
      mockPrismaClient.$queryRaw.mockResolvedValue([
        { version: "PostgreSQL 15.0" },
      ]);

      const result = await client.healthCheck();

      expect(result).toEqual({
        status: "healthy",
        latency: expect.any(Number),
        version: "PostgreSQL 15.0",
      });
      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "postgresql.healthcheck.duration",
        expect.any(Number)
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "postgresql.healthcheck.success"
      );
    });

    it("should return degraded status for slow queries", async () => {
      // Mock slow query by delaying response
      mockPrismaClient.$queryRaw = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return [{ version: "PostgreSQL 15.0" }];
      });

      const result = await client.healthCheck();

      expect(result.status).toBe("degraded");
      expect(result.latency).toBeGreaterThan(1000);
    });

    it("should return unhealthy status on failure", async () => {
      const error = new Error("Health check failed");
      mockExecuteWithRetry.mockRejectedValue(error);

      const result = await client.healthCheck();

      expect(result).toEqual({
        status: "unhealthy",
        error: "Health check failed",
      });
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "postgresql.healthcheck.failure"
      );
    });
  });

  describe("executeRaw", () => {
    it("should execute raw query successfully", async () => {
      const mockResult = [{ id: 1, name: "test" }];
      mockPrismaClient.$queryRawUnsafe.mockResolvedValue(mockResult);

      const result = await client.executeRaw("SELECT * FROM users", [1]);

      expect(result).toBe(mockResult);
      expect(mockPrismaClient.$queryRawUnsafe).toHaveBeenCalledWith(
        "SELECT * FROM users",
        [1]
      );
      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "postgresql.raw_query.duration",
        expect.any(Number)
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "postgresql.raw_query.success"
      );
    });

    it("should handle query execution errors", async () => {
      const error = new Error("Query failed");
      mockExecuteWithRetry.mockRejectedValue(error);

      await expect(client.executeRaw("SELECT * FROM invalid")).rejects.toThrow(
        PostgreSQLError
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "postgresql.raw_query.failure"
      );
    });

    it("should detect and log slow queries", async () => {
      mockPrismaClient.$queryRawUnsafe.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 1500))
      );

      await client.executeRaw("SELECT * FROM slow_table");

      expect(loggerMock.warn).toHaveBeenCalledWith(
        "PostgreSQL slow query detected",
        expect.objectContaining({
          duration: expect.stringMatching(/^\d+\.\d{2}ms$/),
          threshold: "1000ms",
          query: expect.stringContaining("SELECT * FROM slow_table"),
          paramCount: 0,
        })
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "postgresql.slow_query"
      );
    });
  });

  describe("executeRawWithCache", () => {
    it("should cache SELECT query results", async () => {
      const mockResult = [{ id: 1 }];
      mockPrismaClient.$queryRawUnsafe.mockResolvedValue(mockResult);
      mockCacheService.get.mockResolvedValue({ data: null }); // Cache miss

      const result = await client.executeRawWithCache(
        "SELECT * FROM users WHERE id = ?",
        [1]
      );

      expect(result).toBe(mockResult);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.stringContaining("postgresql:query:"),
        mockResult,
        300
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "postgresql.cache.miss"
      );
    });

    it("should return cached result on cache hit", async () => {
      const cachedResult = [{ id: 1 }];
      mockCacheService.get.mockResolvedValue({ data: cachedResult });

      const result = await client.executeRawWithCache("SELECT * FROM users");

      expect(result).toBe(cachedResult);
      expect(mockPrismaClient.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "postgresql.cache.hit"
      );
    });

    it("should skip caching for non-SELECT queries", async () => {
      mockPrismaClient.$queryRawUnsafe.mockResolvedValue([]);

      await client.executeRawWithCache("INSERT INTO users VALUES (?)", [
        "test",
      ]);

      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it("should handle cache errors gracefully", async () => {
      mockCacheService.get.mockRejectedValue(new Error("Cache error"));
      mockPrismaClient.$queryRawUnsafe.mockResolvedValue([{ id: 1 }]);

      const result = await client.executeRawWithCache("SELECT * FROM users");

      expect(result).toEqual([{ id: 1 }]);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        "Cache operation failed, executing query directly",
        expect.any(Error)
      );
    });
  });

  describe("invalidateCache", () => {
    it("should invalidate cache patterns", async () => {
      const result = await client.invalidateCache("user:*");

      expect(result).toBeUndefined();
      expect(mockCacheService.invalidatePattern).toHaveBeenCalledWith("user:*");
      expect(loggerMock.info).toHaveBeenCalledWith(
        "PostgreSQL cache invalidated",
        {
          pattern: "user:*",
          invalidatedCount: 5,
        }
      );
    });

    it("should handle cache invalidation errors", async () => {
      mockCacheService.invalidatePattern.mockRejectedValue(
        new Error("Invalidation failed")
      );

      await expect(client.invalidateCache()).rejects.toThrow(PostgreSQLError);
    });
  });

  describe("getCacheStats", () => {
    it("should return cache statistics", async () => {
      const stats = await client.getCacheStats();

      expect(stats).toEqual({
        enabled: true,
        config: expect.any(Object),
        metrics: {
          hits: 10,
          misses: 5,
          errors: 0,
          hitRate: 0.67, // 10/(10+5) = 10/15 = 0.666..., rounded to 0.67
        },
      });
      expect(stats.config).toHaveProperty("enabled", true);
      expect(stats.config).toHaveProperty("defaultTTL", 300);
    });

    it("should handle missing cache service", async () => {
      const clientWithoutCache = new PostgreSQLClient(mockMetricsCollector);

      const stats = await clientWithoutCache.getCacheStats();

      expect(stats.enabled).toBe(false);
      expect(stats.metrics.hits).toBe(0);
      expect(stats.metrics.misses).toBe(0);
      expect(stats.metrics.hitRate).toBe(0);
    });
  });

  describe("cachedQuery", () => {
    it("should execute cached SELECT query", async () => {
      const mockResult = [{ id: 1 }];
      mockPrismaClient.$queryRawUnsafe.mockResolvedValue(mockResult);

      const result = await client.cachedQuery("SELECT * FROM users", [], 600);

      expect(result).toBe(mockResult);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        expect.any(String),
        mockResult,
        600
      );
    });

    it("should reject non-SELECT queries", async () => {
      await expect(client.cachedQuery("DELETE FROM users")).rejects.toThrow(
        PostgreSQLError
      );
    });
  });

  describe("writeWithCacheInvalidation", () => {
    it("should execute write and invalidate cache", async () => {
      mockPrismaClient.$queryRawUnsafe.mockResolvedValue({ affectedRows: 1 });

      const result = await client.writeWithCacheInvalidation(
        "UPDATE users SET name = ? WHERE id = ?",
        ["John", 1],
        ["user:1", "users:*"]
      );

      expect(result).toEqual({ affectedRows: 1 });
      expect(mockCacheService.invalidatePattern).toHaveBeenCalledTimes(2);
    });
  });

  describe("batchExecute", () => {
    it("should execute operations in batches", async () => {
      const operations = [
        jest.fn().mockResolvedValue({ id: 1 }),
        jest.fn().mockResolvedValue({ id: 2 }),
      ];

      const result = await client.batchExecute(operations);

      expect(result.results).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.stats.processed).toBe(2);
      expect(result.stats.failed).toBe(0);
      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "postgresql.batch.duration",
        expect.any(Number)
      );
    });

    it("should handle batch operation failures", async () => {
      const operations = [
        jest.fn().mockResolvedValue({ id: 1 }),
        jest.fn().mockRejectedValue(new Error("Operation failed")),
      ];

      const result = await client.batchExecute(operations);

      expect(result.results).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.stats.failed).toBe(1);
    });
  });

  describe("transaction", () => {
    it("should execute transaction callback", async () => {
      const callback = jest.fn().mockResolvedValue({ success: true });

      const result = await client.transaction(callback);

      expect(result).toEqual({ success: true });
      expect(mockPrismaClient.$transaction).toHaveBeenCalledWith(callback);
    });
  });

  describe("getConnectionInfo", () => {
    it("should return connection information", async () => {
      mockPrismaClient.$queryRawUnsafe
        .mockResolvedValueOnce([
          { active_connections: 5, idle_connections: 3, total_connections: 8 },
        ])
        .mockResolvedValueOnce([{ uptime: 3600 }]);

      const info = await client.getConnectionInfo();

      expect(info).toEqual({
        isConnected: false, // Not connected in test
        connectionPool: {
          active: 5,
          idle: 3,
          total: 8,
        },
        performance: {
          avgQueryTime: expect.any(Number),
          slowQueries: 0,
          errorRate: 0,
        },
        uptime: 3600,
      });
    });

    it("should handle connection info errors", async () => {
      mockPrismaClient.$queryRawUnsafe.mockRejectedValue(
        new Error("Query failed")
      );

      await expect(client.getConnectionInfo()).rejects.toThrow(PostgreSQLError);
    });
  });

  describe("isHealthy", () => {
    it("should return connection health status", () => {
      expect(client.isHealthy()).toBe(false); // Not connected in test
    });
  });

  describe("error handling", () => {
    it("should throw PostgreSQLError for database errors", async () => {
      mockExecuteWithRetry.mockRejectedValue(new Error("Database error"));

      await expect(client.ping()).rejects.toThrow(PostgreSQLError);
    });

    it("should include original error in PostgreSQLError", async () => {
      const originalError = new Error("Original error");
      mockExecuteWithRetry.mockRejectedValue(originalError);

      try {
        await client.ping();
      } catch (error) {
        expect(error).toBeInstanceOf(PostgreSQLError);
        expect((error as PostgreSQLError).cause).toBe(originalError);
      }
    });
  });
});
