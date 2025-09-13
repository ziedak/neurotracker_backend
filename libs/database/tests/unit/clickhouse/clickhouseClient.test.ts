import {
  ClickHouseClient,
  ClickHouseError,
  HealthStatus,
} from "../../../src/clickhouse/clickhouseClient";

// Mock the ClickHouse client
jest.mock("@clickhouse/client", () => ({
  createClient: jest.fn(),
}));

// Mock dependencies
jest.mock("@libs/config", () => ({
  getEnv: jest.fn(),
  getNumberEnv: jest.fn(),
  getBooleanEnv: jest.fn(),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(),
  executeWithRetry: jest.fn(),
}));

jest.mock("@libs/monitoring", () => ({
  IMetricsCollector: Symbol("IMetricsCollector"),
}));

describe("ClickHouseClient", () => {
  let mockClient: {
    ping: jest.Mock;
    query: jest.Mock;
    insert: jest.Mock;
    close: jest.Mock;
  };
  let mockLogger: {
    info: jest.Mock;
    error: jest.Mock;
    warn: jest.Mock;
    debug: jest.Mock;
  };
  let mockMetricsCollector: {
    recordCounter: jest.Mock;
    recordTimer: jest.Mock;
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock client
    mockClient = {
      ping: jest.fn(),
      query: jest.fn(),
      insert: jest.fn(),
      close: jest.fn(),
    };

    // Setup mock dependencies
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    mockMetricsCollector = {
      recordCounter: jest.fn(),
      recordTimer: jest.fn(),
    };

    // Mock the createClient to return our mock client
    const { createClient } = require("@clickhouse/client");
    createClient.mockReturnValue(mockClient);

    // Mock config functions
    const { getEnv, getNumberEnv, getBooleanEnv } = require("@libs/config");
    getEnv.mockImplementation((key: string, defaultValue?: string) => {
      const envMap: Record<string, string> = {
        CLICKHOUSE_URL: "http://localhost:8123",
        CLICKHOUSE_USERNAME: "default",
        CLICKHOUSE_PASSWORD: "",
        CLICKHOUSE_DATABASE: "test_db",
        CLICKHOUSE_QUERY_CACHE_PREFIX: "ch:",
        CLICKHOUSE_QUERY_CACHE_EXCLUDE_PATTERNS: "INSERT,UPDATE,DELETE",
      };
      return envMap[key] ?? defaultValue ?? "";
    });

    getNumberEnv.mockImplementation((key: string, defaultValue?: number) => {
      const envMap: Record<string, number> = {
        CLICKHOUSE_REQUEST_TIMEOUT: 30000,
        CLICKHOUSE_MAX_CONNECTIONS: 10,
        CLICKHOUSE_MAX_RETRIES: 3,
        CLICKHOUSE_RETRY_DELAY: 1000,
        CLICKHOUSE_CIRCUIT_BREAKER_THRESHOLD: 5,
        CLICKHOUSE_CIRCUIT_BREAKER_TIMEOUT: 30000,
        CLICKHOUSE_QUERY_CACHE_TTL: 300,
        CLICKHOUSE_QUERY_CACHE_MAX_SIZE: 1000,
      };
      return envMap[key] ?? defaultValue ?? 0;
    });

    getBooleanEnv.mockImplementation((key: string, defaultValue?: boolean) => {
      const envMap: Record<string, boolean> = {
        CLICKHOUSE_COMPRESSION: true,
        CLICKHOUSE_REQUEST_COMPRESSION: false,
        CLICKHOUSE_QUERY_CACHE_ENABLED: true,
      };
      return envMap[key] ?? defaultValue ?? false;
    });

    // Mock logger
    const { createLogger } = require("@libs/utils");
    createLogger.mockReturnValue(mockLogger);

    // Mock executeWithRetry
    const { executeWithRetry } = require("@libs/utils");
    executeWithRetry.mockImplementation((fn: Function) => fn());
  });

  describe("constructor", () => {
    it("should initialize with default configuration", () => {
      const client = new ClickHouseClient();

      expect(client).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        "ClickHouse client initialized",
        expect.objectContaining({
          url: "http://localhost:8123",
          database: "test_db",
          hasCache: false,
        })
      );
    });

    it("should initialize with cache service", () => {
      const mockCache = {
        get: jest.fn(),
        set: jest.fn(),
        isEnabled: jest.fn(),
        invalidate: jest.fn(),
        invalidatePattern: jest.fn(),
        getStats: jest.fn(),
        healthCheck: jest.fn(),
        dispose: jest.fn(),
      };
      new ClickHouseClient(mockCache);

      expect(mockLogger.info).toHaveBeenCalledWith(
        "ClickHouse client initialized",
        expect.objectContaining({
          hasCache: true,
        })
      );
    });

    it("should throw error for missing required config", () => {
      const { getEnv } = require("@libs/config");
      getEnv.mockReturnValue(""); // Empty URL

      expect(() => new ClickHouseClient()).toThrow(ClickHouseError);
      expect(() => new ClickHouseClient()).toThrow(
        "Missing required ClickHouse configuration"
      );
    });
  });

  describe("ping", () => {
    it("should return true on successful ping", async () => {
      mockClient.ping.mockResolvedValue({ success: true });

      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      const result = await client.ping();

      expect(result).toBe(true);
      expect(mockClient.ping).toHaveBeenCalledTimes(1);
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "clickhouse.ping.success",
        1
      );
    });

    it("should throw ClickHouseError on ping failure", async () => {
      const pingError = new Error("Connection failed");
      mockClient.ping.mockRejectedValue(pingError);

      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      await expect(client.ping()).rejects.toThrow(ClickHouseError);
      await expect(client.ping()).rejects.toThrow("Ping failed");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "clickhouse.ping.error",
        1
      );
    });
  });

  describe("healthCheck", () => {
    it("should return healthy status on successful ping", async () => {
      mockClient.ping.mockResolvedValue({ success: true });
      mockClient.query.mockResolvedValue({
        json: jest.fn().mockResolvedValue([{ version: "23.8.1" }]),
      });

      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      const result = await client.healthCheck();

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.version).toBe("23.8.1");
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it("should return unhealthy status on ping failure", async () => {
      mockClient.ping.mockRejectedValue(new Error("Connection failed"));
      mockClient.query.mockRejectedValue(new Error("Query failed"));

      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      const result = await client.healthCheck();

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.version).toBeUndefined();
    });

    it("should cache version information", async () => {
      mockClient.ping.mockResolvedValue({ success: true });
      mockClient.query.mockResolvedValue({
        json: jest.fn().mockResolvedValue([{ version: "23.8.1" }]),
      });

      const client = new ClickHouseClient();

      // First call should fetch version
      await client.healthCheck();
      expect(mockClient.query).toHaveBeenCalledTimes(1);

      // Second call should use cached version
      await client.healthCheck();
      expect(mockClient.query).toHaveBeenCalledTimes(1); // Still 1 call
    });
  });

  describe("isHealthy", () => {
    it("should return connection status", () => {
      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      expect(client.isHealthy()).toBe(false); // Initially not connected
    });
  });

  describe("execute", () => {
    it("should execute query successfully", async () => {
      const mockResult = [{ id: 1, name: "test" }];
      mockClient.query.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockResult),
      });

      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      const result = await client.execute("SELECT * FROM test_table");

      expect(result).toEqual(mockResult);
      expect(mockClient.query).toHaveBeenCalledWith({
        query: "SELECT * FROM test_table",
        query_params: {},
        format: "JSONEachRow",
      });
    });

    it("should execute query with parameters", async () => {
      const mockResult = [{ id: 1 }];
      mockClient.query.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockResult),
      });

      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      const result = await client.execute(
        "SELECT * FROM test_table WHERE id = {id:String}",
        { id: "123" }
      );

      expect(result).toEqual(mockResult);
      expect(mockClient.query).toHaveBeenCalledWith({
        query: "SELECT * FROM test_table WHERE id = {id:String}",
        query_params: { id: "123" },
        format: "JSONEachRow",
      });
    });

    it("should throw error for empty query", async () => {
      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      await expect(client.execute("")).rejects.toThrow(ClickHouseError);
      await expect(client.execute("")).rejects.toThrow("Query cannot be empty");
    });

    it("should handle query execution errors", async () => {
      const queryError = new Error("Query failed");
      mockClient.query.mockRejectedValue(queryError);

      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      await expect(client.execute("SELECT * FROM test_table")).rejects.toThrow(
        ClickHouseError
      );
      await expect(client.execute("SELECT * FROM test_table")).rejects.toThrow(
        "Query execution failed"
      );
    });
  });

  describe("insert", () => {
    it("should insert data successfully", async () => {
      const testData = [{ id: 1, name: "test" }];
      mockClient.insert.mockResolvedValue(undefined);

      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      await client.insert("test_table", testData);

      expect(mockClient.insert).toHaveBeenCalledWith({
        table: "test_table",
        values: testData,
        format: "JSONEachRow",
      });
    });

    it("should throw error for empty table name", async () => {
      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      await expect(client.insert("", [{ id: 1 }])).rejects.toThrow(
        ClickHouseError
      );
      await expect(client.insert("", [{ id: 1 }])).rejects.toThrow(
        "Table name and data are required"
      );
    });

    it("should throw error for empty data", async () => {
      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      await expect(client.insert("test_table", [])).rejects.toThrow(
        ClickHouseError
      );
      await expect(client.insert("test_table", [])).rejects.toThrow(
        "Table name and data are required"
      );
    });
  });

  describe("disconnect", () => {
    it("should disconnect successfully", async () => {
      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      // Simulate connected state
      (client as unknown as { isConnected: boolean }).isConnected = true;

      await client.disconnect();

      expect(mockClient.close).toHaveBeenCalledTimes(1);
    });

    it("should handle disconnect when not connected", async () => {
      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      await client.disconnect();

      expect(mockClient.close).not.toHaveBeenCalled();
    });
  });

  describe("executeWithCache", () => {
    let mockCache: {
      get: jest.Mock;
      set: jest.Mock;
      isEnabled: jest.Mock;
      invalidate: jest.Mock;
      invalidatePattern: jest.Mock;
      getStats: jest.Mock;
      healthCheck: jest.Mock;
      dispose: jest.Mock;
    };

    beforeEach(() => {
      mockCache = {
        get: jest.fn(),
        set: jest.fn(),
        isEnabled: jest.fn(),
        invalidate: jest.fn(),
        invalidatePattern: jest.fn(),
        getStats: jest.fn(),
        healthCheck: jest.fn(),
        dispose: jest.fn(),
      };
    });

    it("should execute query and cache result", async () => {
      const mockResult = [{ id: 1 }];
      mockClient.query.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockResult),
      });
      mockCache.get.mockResolvedValue({ data: null }); // Cache miss

      const client = new ClickHouseClient(mockCache, mockMetricsCollector);
      const result = await client.executeWithCache("SELECT * FROM test_table");

      expect(result).toEqual(mockResult);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it("should return cached result on cache hit", async () => {
      const cachedResult = [{ id: 1 }];
      mockCache.get.mockResolvedValue({ data: cachedResult });

      const client = new ClickHouseClient(mockCache, mockMetricsCollector);
      const result = await client.executeWithCache("SELECT * FROM test_table");

      expect(result).toEqual(cachedResult);
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it("should skip caching for write operations", async () => {
      const mockResult = [{ affected: 1 }];
      mockClient.query.mockResolvedValue({
        json: jest.fn().mockResolvedValue(mockResult),
      });

      const client = new ClickHouseClient(mockCache, mockMetricsCollector);
      const result = await client.executeWithCache(
        "INSERT INTO test_table VALUES (1)"
      );

      expect(result).toEqual(mockResult);
      expect(mockCache.set).not.toHaveBeenCalled();
    });
  });

  describe("invalidateCache", () => {
    let mockCache: {
      invalidatePattern: jest.Mock;
      get: jest.Mock;
      set: jest.Mock;
      isEnabled: jest.Mock;
      invalidate: jest.Mock;
      getStats: jest.Mock;
      healthCheck: jest.Mock;
      dispose: jest.Mock;
    };

    beforeEach(() => {
      mockCache = {
        invalidatePattern: jest.fn().mockResolvedValue(5),
        get: jest.fn(),
        set: jest.fn(),
        isEnabled: jest.fn(),
        invalidate: jest.fn(),
        getStats: jest.fn(),
        healthCheck: jest.fn(),
        dispose: jest.fn(),
      };
    });

    it("should invalidate cache pattern", async () => {
      const client = new ClickHouseClient(mockCache, mockMetricsCollector);
      await client.invalidateCache("test:*");

      expect(mockCache.invalidatePattern).toHaveBeenCalledWith("test:*");
    });

    it("should use default pattern when none provided", async () => {
      const client = new ClickHouseClient(mockCache, mockMetricsCollector);
      await client.invalidateCache();

      expect(mockCache.invalidatePattern).toHaveBeenCalledWith("ch:*");
    });

    it("should handle cache invalidation errors", async () => {
      mockCache.invalidatePattern.mockRejectedValue(new Error("Cache error"));

      const client = new ClickHouseClient(mockCache, mockMetricsCollector);
      await expect(client.invalidateCache()).rejects.toThrow(ClickHouseError);
    });
  });

  describe("batchInsert", () => {
    it("should perform batch insert successfully", async () => {
      const testData = Array.from({ length: 150 }, (_, i) => ({
        id: i,
        name: `test${i}`,
      }));
      mockClient.insert.mockResolvedValue(undefined);

      const client = new ClickHouseClient(undefined, mockMetricsCollector);
      const result = await client.batchInsert("test_table", testData, {
        batchSize: 50,
        maxConcurrency: 2,
        delayBetweenBatches: 100,
      });

      expect(result.totalRows).toBe(150);
      expect(result.batchesProcessed).toBe(3);
      expect(result.successfulBatches).toBe(3);
      expect(result.failedBatches).toBe(0);
      expect(mockClient.insert).toHaveBeenCalledTimes(3);
    });

    it("should handle batch insert errors", async () => {
      const testData = [{ id: 1 }, { id: 2 }];
      mockClient.insert.mockRejectedValueOnce(new Error("Batch 1 failed"));

      const client = new ClickHouseClient();
      const result = await client.batchInsert("test_table", testData, {
        batchSize: 1,
        maxConcurrency: 1,
        delayBetweenBatches: 0,
      });

      expect(result.successfulBatches).toBe(1);
      expect(result.failedBatches).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });
});
