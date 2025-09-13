// Mock external workspace dependencies
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
  matchPattern: jest.fn((key: string, pattern: string) => {
    // Simple pattern matching for tests
    if (pattern === "*") return true;
    if (pattern.includes("*")) {
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return regex.test(key);
    }
    return key === pattern;
  }),
  chunkArray: jest.fn(<T>(array: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }),
  executeWithRetry: jest.fn(),
  executeRedisWithRetry: jest.fn(),
}));

jest.mock("@libs/monitoring", () => ({
  IMetricsCollector: {},
  createMetricsCollector: jest.fn(() => ({
    recordTimer: jest.fn(),
    recordCounter: jest.fn(),
    recordGauge: jest.fn(),
    recordHistogram: jest.fn(),
  })),
}));

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
      CLICKHOUSE_HOST: "localhost",
      CLICKHOUSE_PORT: "8123",
      CLICKHOUSE_USERNAME: "default",
      CLICKHOUSE_PASSWORD: "",
      CLICKHOUSE_DATABASE: "default",
    };
    return envMap[key] ?? defaultValue ?? "";
  }),
  getBooleanEnv: jest.fn((key: string, defaultValue?: boolean) => {
    const envMap: Record<string, boolean> = {
      REDIS_TLS: false,
      REDIS_TLS_REJECT_UNAUTHORIZED: true,
      POSTGRESQL_METRICS_ENABLED: true,
      POSTGRESQL_QUERY_CACHE_ENABLED: true,
      DATABASE_LOGGING: false,
      CLICKHOUSE_TLS: false,
      CLICKHOUSE_READONLY: false,
    };
    return envMap[key] ?? defaultValue ?? false;
  }),
  getNumberEnv: jest.fn((key: string, defaultValue?: number) => {
    const envMap: Record<string, number> = {
      REDIS_PORT: 6379,
      REDIS_DB: 0,
      REDIS_MAX_RETRIES: 3,
      REDIS_CONNECT_TIMEOUT: 10000,
      REDIS_COMMAND_TIMEOUT: 5000,
      REDIS_KEEP_ALIVE: 30000,
      POSTGRESQL_MAX_RETRIES: 3,
      POSTGRESQL_RETRY_DELAY: 1000,
      POSTGRESQL_CIRCUIT_BREAKER_THRESHOLD: 5,
      POSTGRESQL_CIRCUIT_BREAKER_TIMEOUT: 30000,
      POSTGRESQL_CONNECTION_TIMEOUT: 10000,
      POSTGRESQL_SLOW_QUERY_THRESHOLD: 1000,
      POSTGRESQL_HEALTH_CHECK_INTERVAL: 30000,
      POSTGRESQL_QUERY_CACHE_DEFAULT_TTL: 300,
      POSTGRESQL_QUERY_CACHE_MAX_SIZE: 1000,
      CLICKHOUSE_PORT: 8123,
      CLICKHOUSE_MAX_CONNECTIONS: 10,
      CLICKHOUSE_REQUEST_TIMEOUT: 30000,
      CLICKHOUSE_HEALTH_CHECK_INTERVAL: 30000,
    };
    return envMap[key] ?? defaultValue ?? 0;
  }),
}));

// Mock Redis client - REMOVED: Don't mock the component being tested
// jest.mock("../src/redis/redisClient", () => ({
//   RedisClient: jest.fn().mockImplementation(() => ({
//     connect: jest.fn(),
//     disconnect: jest.fn(),
//     ping: jest.fn().mockResolvedValue("PONG"),
//     safeGet: jest.fn(),
//     safeSet: jest.fn(),
//     safeSetEx: jest.fn(),
//     safeDel: jest.fn(),
//     safeKeys: jest.fn(),
//     safeMget: jest.fn(),
//     safePublish: jest.fn(),
//     safePipeline: jest.fn(),
//     safeScan: jest.fn(),
//     exists: jest.fn(),
//     healthCheck: jest.fn(),
//     isHealthy: jest.fn(),
//     getStats: jest.fn(),
//     createSubscriber: jest.fn(),
//     forceReconnect: jest.fn(),
//     getRedis: jest.fn(),
//   })),
// }));

// Global test utilities
global.beforeAll(async () => {
  // Setup code that runs before all tests
});

global.afterAll(() => {
  // Cleanup code that runs after all tests
  jest.clearAllMocks();
});

// Custom matchers
expect.extend({
  toBeValidCacheResult(received: unknown): jest.CustomMatcherResult {
    const pass =
      received !== null &&
      typeof received === "object" &&
      received !== undefined &&
      "data" in received &&
      "source" in received &&
      "latency" in received &&
      typeof (received as Record<string, unknown>).latency === "number";

    return {
      message: () => `expected ${received} to be a valid cache result`,
      pass,
    };
  },
});
