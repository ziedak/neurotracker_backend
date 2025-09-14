/**
 * @fileoverview Comprehensive unit tests for RateLimitHttpMiddleware
 * @description Tests rate limiting, algorithms, strategies, and cache integration
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { RateLimitHttpMiddleware } from "../../src/middleware/rateLimit/rateLimit.http.Middleware";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

// Mock dependencies
const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

const mockCacheService = {
  isEnabled: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  invalidate: jest.fn(),
  invalidatePattern: jest.fn(),
  getStats: jest.fn(),
  healthCheck: jest.fn(),
  dispose: jest.fn(),
};

const mockRateLimitingAdapter = {
  checkRateLimit: jest.fn(),
  resetRateLimit: jest.fn(),
  getRateLimitingStats: jest.fn(),
  getHealth: jest.fn(),
};

// Mock the external dependencies
jest.mock("@libs/ratelimit", () => ({
  RateLimitingCacheAdapter: jest
    .fn()
    .mockImplementation(() => mockRateLimitingAdapter),
}));

jest.mock("@libs/database", () => ({
  CacheConfigValidator: jest.fn(),
  CacheService: jest.fn(),
}));

describe("RateLimitHttpMiddleware", () => {
  let middleware: RateLimitHttpMiddleware;
  let mockContext: MiddlewareContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock environment for testing
    process.env["NODE_ENV"] = "test";
    process.env["JEST_WORKER_ID"] = "1";

    // Create middleware instance
    middleware = new RateLimitHttpMiddleware(mockMetricsCollector, {
      name: "test-rate-limit",
      enabled: true,
      priority: 10,
      algorithm: "sliding-window",
      maxRequests: 100,
      windowMs: 60000,
      keyStrategy: "ip",
      standardHeaders: true,
      message: "Rate limit exceeded",
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      skipOnError: true,
      redis: {
        keyPrefix: "test:",
        ttlBuffer: 1000,
      },
    });

    // Create mock context
    mockContext = {
      requestId: "test-request-123",
      request: {
        method: "GET",
        url: "/api/users",
        headers: {
          "user-agent": "test-agent",
          "x-forwarded-for": "192.168.1.1",
        },
        body: {},
        query: {},
        params: {},
        ip: "192.168.1.1",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { message: "success" },
      },
      set: {
        status: 200,
        headers: { "content-type": "application/json" },
      },
      user: {
        id: "user-123",
        roles: ["user"],
        permissions: ["read:user"],
        authenticated: true,
        anonymous: false,
      },
      session: {
        id: "session-123",
      },
      validated: {},
      path: "/api/users",
    };

    nextFunction = jest.fn().mockResolvedValue(undefined);

    // Setup default mock responses
    mockRateLimitingAdapter.checkRateLimit.mockResolvedValue({
      allowed: true,
      totalHits: 5,
      remaining: 95,
      resetTime: Date.now() + 60000,
      algorithm: "sliding-window",
      windowStart: Date.now(),
      windowEnd: Date.now() + 60000,
      limit: 100,
      cached: false,
      responseTime: 10,
    });
  });

  afterEach(() => {
    jest.clearAllTimers();
    delete process.env["NODE_ENV"];
    delete process.env["JEST_WORKER_ID"];
  });

  describe("Middleware Initialization", () => {
    it("should initialize with default configuration", () => {
      const defaultMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector
      );

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("rate-limit");
      expect(defaultMiddleware["config"].algorithm).toBe("sliding-window");
      expect(defaultMiddleware["config"].maxRequests).toBe(100);
      expect(defaultMiddleware["config"].windowMs).toBe(60000);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-rate-limit");
      expect(middleware["config"].algorithm).toBe("sliding-window");
      expect(middleware["config"].maxRequests).toBe(100);
      expect(middleware["config"].windowMs).toBe(60000);
      expect(middleware["config"].keyStrategy).toBe("ip");
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new RateLimitHttpMiddleware(mockMetricsCollector, {
          maxRequests: -1, // Invalid
        });
      }).toThrow("Rate limit maxRequests must be a positive integer");
    });
  });

  describe("Rate Limit Checking", () => {
    it("should allow requests within rate limit", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalledTimes(1);
      expect(mockContext.set.status).toBe(200);
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "rate_limit_request_allowed",
        1,
        expect.any(Object)
      );
    });

    it("should set standard rate limit headers", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-RateLimit-Limit"]).toBe("100");
      expect(mockContext.set.headers["X-RateLimit-Remaining"]).toBe("95");
      expect(mockContext.set.headers["X-RateLimit-Reset"]).toBeDefined();
      expect(mockContext.set.headers["X-RateLimit-Window"]).toBe("60000");
      expect(mockContext.set.headers["X-RateLimit-Algorithm"]).toBe(
        "sliding-window"
      );
    });

    it("should deny requests over rate limit", async () => {
      mockRateLimitingAdapter.checkRateLimit.mockResolvedValue({
        allowed: false,
        totalHits: 101,
        remaining: 0,
        resetTime: Date.now() + 60000,
        algorithm: "sliding-window",
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 100,
        cached: false,
        responseTime: 10,
        retryAfter: 60000,
      });

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(mockContext.set.status).toBe(429);
      expect(mockContext.set.headers["Retry-After"]).toBe("60");
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "rate_limit_request_denied",
        1,
        expect.any(Object)
      );
    });

    it("should handle rate limit exceeded with custom callback", async () => {
      const onLimitReached = jest.fn();
      const customMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          onLimitReached,
        }
      );

      mockRateLimitingAdapter.checkRateLimit.mockResolvedValue({
        allowed: false,
        totalHits: 101,
        remaining: 0,
        resetTime: Date.now() + 60000,
        algorithm: "sliding-window",
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 100,
        cached: false,
        responseTime: 10,
      });

      await customMiddleware["execute"](mockContext, nextFunction);

      expect(onLimitReached).toHaveBeenCalledWith(
        expect.objectContaining({ allowed: false }),
        mockContext
      );
    });
  });

  describe("Key Generation Strategies", () => {
    it("should generate IP-based keys", async () => {
      const ipMiddleware = new RateLimitHttpMiddleware(mockMetricsCollector, {
        keyStrategy: "ip",
        redis: { keyPrefix: "test:" },
      });

      await ipMiddleware["execute"](mockContext, nextFunction);

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledWith(
        "test:ip:192.168.1.1",
        100,
        60000,
        "sliding-window"
      );
    });

    it("should generate user-based keys", async () => {
      const userMiddleware = new RateLimitHttpMiddleware(mockMetricsCollector, {
        keyStrategy: "user",
        redis: { keyPrefix: "test:" },
      });

      await userMiddleware["execute"](mockContext, nextFunction);

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledWith(
        "test:user:user-123",
        100,
        60000,
        "sliding-window"
      );
    });

    it("should generate API key-based keys", async () => {
      mockContext.request.headers["x-api-key"] = "api-key-123";

      const apiKeyMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          keyStrategy: "apiKey",
          redis: { keyPrefix: "test:" },
        }
      );

      await apiKeyMiddleware["execute"](mockContext, nextFunction);

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledWith(
        "test:apiKey:api-key-123",
        100,
        60000,
        "sliding-window"
      );
    });

    it("should use custom key generator", async () => {
      const customKeyGenerator = jest.fn().mockReturnValue("custom-key-123");

      const customMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          keyStrategy: "custom",
          customKeyGenerator,
          redis: { keyPrefix: "test:" },
        }
      );

      await customMiddleware["execute"](mockContext, nextFunction);

      expect(customKeyGenerator).toHaveBeenCalledWith(mockContext);
      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledWith(
        "test:custom:custom-key-123",
        100,
        60000,
        "sliding-window"
      );
    });

    it("should handle missing user for user strategy", async () => {
      const userMiddleware = new RateLimitHttpMiddleware(mockMetricsCollector, {
        keyStrategy: "user",
      });

      delete mockContext.user;

      await expect(
        userMiddleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("User not authenticated");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "rate_limit_error",
        1,
        expect.any(Object)
      );
    });

    it("should handle missing API key for apiKey strategy", async () => {
      const apiKeyMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          keyStrategy: "apiKey",
        }
      );

      await expect(
        apiKeyMiddleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("API key not provided");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "rate_limit_error",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Rate Limiting Algorithms", () => {
    it("should use sliding-window algorithm", async () => {
      const slidingWindowMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          algorithm: "sliding-window",
        }
      );

      await slidingWindowMiddleware["execute"](mockContext, nextFunction);

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledWith(
        expect.any(String),
        100,
        60000,
        "sliding-window"
      );
    });

    it("should use fixed-window algorithm", async () => {
      const fixedWindowMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          algorithm: "fixed-window",
        }
      );

      await fixedWindowMiddleware["execute"](mockContext, nextFunction);

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledWith(
        expect.any(String),
        100,
        60000,
        "fixed-window"
      );
    });

    it("should use token-bucket algorithm", async () => {
      const tokenBucketMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          algorithm: "token-bucket",
        }
      );

      await tokenBucketMiddleware["execute"](mockContext, nextFunction);

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledWith(
        expect.any(String),
        100,
        60000,
        "token-bucket"
      );
    });

    it("should use leaky-bucket algorithm", async () => {
      const leakyBucketMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          algorithm: "leaky-bucket",
        }
      );

      await leakyBucketMiddleware["execute"](mockContext, nextFunction);

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledWith(
        expect.any(String),
        100,
        60000,
        "leaky-bucket"
      );
    });
  });

  describe("Request Filtering", () => {
    it("should skip successful requests when configured", async () => {
      const skipSuccessMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          skipSuccessfulRequests: true,
        }
      );

      await skipSuccessMiddleware["execute"](mockContext, nextFunction);

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledTimes(1);
      // Should still check rate limit but not count the request
    });

    it("should skip failed requests when configured", async () => {
      const skipFailedMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          skipFailedRequests: true,
        }
      );

      mockContext.set.status = 500;
      nextFunction.mockRejectedValue(new Error("Server error"));

      await expect(
        skipFailedMiddleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledTimes(1);
      // Should still check rate limit but not count the failed request
    });

    it("should skip rate limiting for configured paths", async () => {
      const skipPathMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          skipPaths: ["/health", "/metrics"],
        }
      );

      mockContext.path = "/health";

      await skipPathMiddleware["execute"](mockContext, nextFunction);

      expect(mockRateLimitingAdapter.checkRateLimit).not.toHaveBeenCalled();
      expect(nextFunction).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling", () => {
    it("should handle rate limiter errors and fail open when configured", async () => {
      mockRateLimitingAdapter.checkRateLimit.mockRejectedValue(
        new Error("Rate limiter error")
      );

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalledTimes(1);
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "rate_limit_error",
        1,
        expect.any(Object)
      );
    });

    it("should handle rate limiter errors and fail closed when configured", async () => {
      const failClosedMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          skipOnError: false,
        }
      );

      mockRateLimitingAdapter.checkRateLimit.mockRejectedValue(
        new Error("Rate limiter error")
      );

      await expect(
        failClosedMiddleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Rate limiter error");

      expect(nextFunction).not.toHaveBeenCalled();
    });

    it("should handle cache service errors gracefully", async () => {
      mockCacheService.get.mockRejectedValue(new Error("Cache error"));

      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalledTimes(1);
    });
  });

  describe("Performance Monitoring", () => {
    it("should record request processing duration", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "rate_limit_execution_time",
        expect.any(Number),
        expect.any(Object)
      );
    });

    it("should record successful rate limit checks", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "rate_limit_request_allowed",
        1,
        expect.any(Object)
      );
    });

    it("should record rate limit violations", async () => {
      mockRateLimitingAdapter.checkRateLimit.mockResolvedValue({
        allowed: false,
        totalHits: 101,
        remaining: 0,
        resetTime: Date.now() + 60000,
        algorithm: "sliding-window",
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 100,
        cached: false,
        responseTime: 10,
      });

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "rate_limit_request_denied",
        1,
        expect.any(Object)
      );
    });

    it("should record approaching limit warnings", async () => {
      mockRateLimitingAdapter.checkRateLimit.mockResolvedValue({
        allowed: true,
        totalHits: 85,
        remaining: 15,
        resetTime: Date.now() + 60000,
        algorithm: "sliding-window",
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 100,
        cached: false,
        responseTime: 10,
      });

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "rate_limit_approaching_limit",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid maxRequests", () => {
      expect(() => {
        new RateLimitHttpMiddleware(mockMetricsCollector, {
          maxRequests: 0,
        });
      }).toThrow("Rate limit maxRequests must be a positive integer");
    });

    it("should reject invalid windowMs", () => {
      expect(() => {
        new RateLimitHttpMiddleware(mockMetricsCollector, {
          windowMs: -1,
        });
      }).toThrow("Rate limit windowMs must be a positive integer");
    });

    it("should reject invalid keyStrategy", () => {
      expect(() => {
        new RateLimitHttpMiddleware(mockMetricsCollector, {
          keyStrategy: "invalid" as "ip",
        });
      }).toThrow(
        "Rate limit keyStrategy must be one of: ip, user, apiKey, custom"
      );
    });

    it("should reject custom strategy without keyGenerator", () => {
      expect(() => {
        new RateLimitHttpMiddleware(mockMetricsCollector, {
          keyStrategy: "custom",
        });
      }).toThrow(
        "Rate limit customKeyGenerator is required when keyStrategy is 'custom'"
      );
    });
  });

  describe("Middleware Management", () => {
    it("should reset rate limit for specific identifier", async () => {
      await middleware.resetRateLimit("test-identifier");

      expect(mockRateLimitingAdapter.resetRateLimit).toHaveBeenCalledWith(
        "test-identifier",
        "sliding-window"
      );
    });

    it("should get rate limit statistics", () => {
      const mockStats = {
        totalRequests: 1000,
        totalAllowed: 950,
        totalDenied: 50,
        averageResponseTime: 15,
      };

      mockRateLimitingAdapter.getRateLimitingStats.mockReturnValue(mockStats);

      const stats = middleware.getRateLimitStats();

      expect(stats).toEqual(mockStats);
    });

    it("should get health status", async () => {
      const mockHealth = {
        healthy: true,
        cacheServiceHealth: { isHealthy: true },
        adapterStats: {
          totalRequests: 1000,
          totalAllowed: 950,
          totalDenied: 50,
          averageResponseTime: 15,
        },
      };

      mockRateLimitingAdapter.getHealth.mockResolvedValue(mockHealth);

      const health = await middleware.getHealth();

      expect(health).toEqual(mockHealth);
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(10);
    });

    it("should handle concurrent requests", async () => {
      const promises = Array(10)
        .fill(null)
        .map(() => middleware["execute"](mockContext, nextFunction));

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it("should handle request context isolation", async () => {
      const context1 = { ...mockContext, requestId: "req-1" };
      const context2 = { ...mockContext, requestId: "req-2" };

      await Promise.all([
        middleware["execute"](context1, nextFunction),
        middleware["execute"](context2, nextFunction),
      ]);

      expect(mockRateLimitingAdapter.checkRateLimit).toHaveBeenCalledTimes(2);
    });
  });
});
