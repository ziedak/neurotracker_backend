// Mock dependencies
const mockRedisClient = {
  getRedis: jest.fn(() => ({
    script: jest.fn().mockResolvedValue("mock-sha"),
    evalsha: jest.fn().mockResolvedValue([1, 99, Date.now() + 60000, 1]),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    zcard: jest.fn().mockResolvedValue(1),
    zadd: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    ping: jest.fn().mockResolvedValue("PONG"),
  })),
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
  OptimizedRedisRateLimit,
  OptimizedRedisRateLimitConfig,
} from "../src/redisRateLimit";

describe("OptimizedRedisRateLimit", () => {
  let rateLimiter: OptimizedRedisRateLimit;
  let config: OptimizedRedisRateLimitConfig;

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
    };

    rateLimiter = new OptimizedRedisRateLimit(config, mockRedisClient);
  });

  describe("Initialization", () => {
    test("should initialize with correct configuration", () => {
      expect(rateLimiter).toBeDefined();
    });

    test("should initialize circuit breaker when enabled", () => {
      const circuitBreakerStatus = rateLimiter.getCircuitBreakerStatus();
      expect(circuitBreakerStatus.enabled).toBe(true);
    });
  });

  describe("Input Validation", () => {
    test("should handle empty key", async () => {
      const result = await rateLimiter.checkRateLimit("", 100, 60000);
      expect(result.allowed).toBe(true); // Empty key is still processed
    });

    test("should handle zero maxRequests", async () => {
      const result = await rateLimiter.checkRateLimit("test", 0, 60000);
      expect(result.allowed).toBe(false); // Zero maxRequests blocks all requests
      expect(result.limit).toBe(0);
    });
  });

  describe("Rate Limiting Logic", () => {
    test("should allow requests within limit", async () => {
      const result = await rateLimiter.checkRateLimit("user:123", 100, 60000);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99);
      expect(result.algorithm).toBe("sliding-window");
    });
  });

  describe("Health Monitoring", () => {
    test("should provide health status", async () => {
      const health = await rateLimiter.getHealth();

      expect(health).toHaveProperty("redis");
      expect(health).toHaveProperty("circuitBreaker");
      expect(health).toHaveProperty("algorithm");
    });
  });
});
