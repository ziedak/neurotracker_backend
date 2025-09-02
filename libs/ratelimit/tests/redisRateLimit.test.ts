import {
  OptimizedRedisRateLimit,
  RateLimitConfig,
} from "../src/redisRateLimit";

// Mock dependencies
const mockRedisClient = {
  getRedis: jest.fn(() => ({
    script: jest.fn().mockResolvedValue("mock-sha"),
    evalsha: jest.fn().mockResolvedValue([1, 99, Date.now() + 60000, 1]),
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
  ConsecutiveBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockImplementation((fn) => fn()),
    state: "closed",
  })),
}));

describe("OptimizedRedisRateLimit", () => {
  let rateLimiter: OptimizedRedisRateLimit;
  let config: RateLimitConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    config = {
      algorithm: "sliding-window",
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

    rateLimiter = new OptimizedRedisRateLimit(
      config,
      mockRedisClient,
      mockLogger
    );
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
    test("should validate key format", async () => {
      await expect(rateLimiter.checkRateLimit("", 100, 60000)).rejects.toThrow(
        "Key must be a non-empty string"
      );
    });

    test("should validate numeric parameters", async () => {
      await expect(
        rateLimiter.checkRateLimit("test", 0, 60000)
      ).rejects.toThrow("maxRequests must be a positive integer");
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
