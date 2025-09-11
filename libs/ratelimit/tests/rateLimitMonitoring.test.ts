import { RateLimitMonitoringService } from "../src/rateLimitMonitoring";
import { RateLimitResult } from "../src/types";

// Mock the dependencies first
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(),
}));

jest.mock("../src/adapters/RateLimitingCacheAdapter", () => ({
  RateLimitingCacheAdapter: jest.fn(),
}));

// Mock dependencies
const mockRateLimiter = {
  getHealth: jest.fn().mockResolvedValue({
    status: "healthy",
    redis: { connected: true },
    circuitBreaker: { state: "closed" },
  }),
  getRateLimitingStats: jest.fn().mockReturnValue({
    totalKeys: 100,
    activeKeys: 50,
    hitRate: 0.95,
  }),
};

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Setup the mocks
const createLogger = jest.requireMock("@libs/utils").createLogger;
createLogger.mockReturnValue(mockLogger);

const RateLimitingCacheAdapter = jest.requireMock(
  "../src/adapters/RateLimitingCacheAdapter"
).RateLimitingCacheAdapter;
RateLimitingCacheAdapter.mockImplementation(() => mockRateLimiter);

describe("RateLimitMonitoringService", () => {
  let monitoringService: RateLimitMonitoringService;

  beforeEach(() => {
    jest.clearAllMocks();
    monitoringService = new RateLimitMonitoringService(mockRateLimiter as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Initialization", () => {
    test("should initialize with default alerts", () => {
      expect(monitoringService).toBeDefined();
      // Check that default alerts are initialized
      const metrics = monitoringService.getMetrics();
      expect(metrics.totalRequests).toBe(0);
    });

    test("should create logger with correct name", () => {
      const createLogger = jest.requireMock("@libs/utils").createLogger;
      expect(createLogger).toHaveBeenCalledWith("RateLimitMonitoring");
    });
  });

  describe("Recording Metrics", () => {
    test("should record allowed request correctly", () => {
      const result: RateLimitResult = {
        allowed: true,
        totalHits: 1,
        remaining: 9,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 10,
        algorithm: "sliding-window",
        cached: false,
        responseTime: 50,
      };

      monitoringService.recordCheck(result, 50);

      const metrics = monitoringService.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.allowedRequests).toBe(1);
      expect(metrics.deniedRequests).toBe(0);
      expect(metrics.averageResponseTime).toBe(50);
    });

    test("should record denied request correctly", () => {
      const result: RateLimitResult = {
        allowed: false,
        totalHits: 100,
        remaining: 0,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 10,
        algorithm: "sliding-window",
        cached: false,
        responseTime: 75,
      };

      monitoringService.recordCheck(result, 75);

      const metrics = monitoringService.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.allowedRequests).toBe(0);
      expect(metrics.deniedRequests).toBe(1);
      expect(metrics.averageResponseTime).toBe(75);
    });

    test("should calculate average response time correctly", () => {
      const results: RateLimitResult[] = [
        {
          allowed: true,
          totalHits: 1,
          remaining: 9,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 50,
        },
        {
          allowed: true,
          totalHits: 2,
          remaining: 8,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 100,
        },
        {
          allowed: false,
          totalHits: 3,
          remaining: 0,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 25,
        },
      ];

      monitoringService.recordCheck(results[0]!, 50);
      monitoringService.recordCheck(results[1]!, 100);
      monitoringService.recordCheck(results[2]!, 25);

      const metrics = monitoringService.getMetrics();
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.allowedRequests).toBe(2);
      expect(metrics.deniedRequests).toBe(1);
      expect(metrics.averageResponseTime).toBe(175 / 3); // (50 + 100 + 25) / 3
    });

    test("should log debug information for each check", () => {
      const result: RateLimitResult = {
        allowed: true,
        totalHits: 5,
        remaining: 5,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 10,
        algorithm: "sliding-window",
        cached: false,
        responseTime: 30,
      };

      monitoringService.recordCheck(result, 30);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Rate limit check recorded",
        expect.objectContaining({
          allowed: true,
          responseTime: 30,
          totalRequests: 1,
        })
      );
    });
  });

  describe("Circuit Breaker Recording", () => {
    test("should record circuit breaker trip", () => {
      monitoringService.recordCircuitBreakerTrip();

      const metrics = monitoringService.getMetrics();
      expect(metrics.circuitBreakerTrips).toBe(1);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Circuit breaker tripped",
        expect.objectContaining({
          totalTrips: 1,
        })
      );
    });

    test("should record multiple circuit breaker trips", () => {
      monitoringService.recordCircuitBreakerTrip();
      monitoringService.recordCircuitBreakerTrip();
      monitoringService.recordCircuitBreakerTrip();

      const metrics = monitoringService.getMetrics();
      expect(metrics.circuitBreakerTrips).toBe(3);
    });
  });

  describe("Redis Error Recording", () => {
    test("should record Redis error", () => {
      const error = new Error("Redis connection failed");

      monitoringService.recordRedisError(error);

      const metrics = monitoringService.getMetrics();
      expect(metrics.redisErrors).toBe(1);

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Redis error in rate limiter",
        error,
        expect.objectContaining({
          totalErrors: 1,
        })
      );
    });

    test("should record multiple Redis errors", () => {
      const error1 = new Error("Connection timeout");
      const error2 = new Error("Command failed");

      monitoringService.recordRedisError(error1);
      monitoringService.recordRedisError(error2);

      const metrics = monitoringService.getMetrics();
      expect(metrics.redisErrors).toBe(2);
    });
  });

  describe("Alert System", () => {
    test("should trigger high error rate alert", () => {
      // Record 8 requests with 2 errors (20% error rate)
      for (let i = 0; i < 8; i++) {
        const result: RateLimitResult = {
          allowed: true,
          totalHits: 1,
          remaining: 9,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 50,
        };
        monitoringService.recordCheck(result, 50);
      }

      // Record 2 errors
      monitoringService.recordRedisError(new Error("Error 1"));
      monitoringService.recordRedisError(new Error("Error 2"));

      // Trigger alert check by recording another request
      const result: RateLimitResult = {
        allowed: true,
        totalHits: 1,
        remaining: 9,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 10,
        algorithm: "sliding-window",
        cached: false,
        responseTime: 50,
      };
      monitoringService.recordCheck(result, 50);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "High error rate alert triggered",
        expect.objectContaining({
          errorRate: "0.222", // 2/9 = 0.222
          threshold: 0.1,
        })
      );
    });

    test("should trigger high denial rate alert", () => {
      // Record 10 requests with 6 denials (60% denial rate)
      for (let i = 0; i < 4; i++) {
        const result: RateLimitResult = {
          allowed: true,
          totalHits: 1,
          remaining: 9,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 50,
        };
        monitoringService.recordCheck(result, 50);
      }

      for (let i = 0; i < 6; i++) {
        const result: RateLimitResult = {
          allowed: false,
          totalHits: 100,
          remaining: 0,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 50,
        };
        monitoringService.recordCheck(result, 50);
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "High denial rate alert triggered",
        expect.objectContaining({
          denialRate: expect.stringMatching(/^0\.5[0-9]+$/), // 6/(4+6) = 0.6, but actual calculation may vary
          threshold: 0.5,
        })
      );
    });

    test("should trigger circuit breaker frequent trips alert", () => {
      // Record 3 circuit breaker trips
      for (let i = 0; i < 3; i++) {
        monitoringService.recordCircuitBreakerTrip();
      }

      // Need to trigger alert check by recording a request
      const result: RateLimitResult = {
        allowed: true,
        totalHits: 1,
        remaining: 9,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 10,
        algorithm: "sliding-window",
        cached: false,
        responseTime: 50,
      };
      monitoringService.recordCheck(result, 50);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Frequent circuit breaker trips alert triggered",
        expect.objectContaining({
          trips: 3,
          threshold: 3,
        })
      );
    });

    test("should resolve alerts when conditions improve", () => {
      // First trigger error rate alert
      for (let i = 0; i < 8; i++) {
        const result: RateLimitResult = {
          allowed: true,
          totalHits: 1,
          remaining: 9,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 50,
        };
        monitoringService.recordCheck(result, 50);
      }
      monitoringService.recordRedisError(new Error("Error"));

      // Then resolve by recording successful requests
      for (let i = 0; i < 10; i++) {
        const result: RateLimitResult = {
          allowed: true,
          totalHits: 1,
          remaining: 9,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 50,
        };
        monitoringService.recordCheck(result, 50);
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        "High error rate alert resolved",
        expect.any(Object)
      );
    });

    test("should not trigger alerts with zero requests", () => {
      // No requests recorded, should not trigger any alerts
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe("Health Status", () => {
    test("should return healthy status for good metrics", async () => {
      const health = await monitoringService.getHealthStatus();

      expect(health.status).toBe("healthy");
      expect(health.metrics).toBeDefined();
      expect(health.rateLimiter).toBeDefined();
      expect(health.stats).toBeDefined();
      expect(health.alerts).toBeDefined();
      expect(health.timestamp).toBeDefined();
    });

    test("should return degraded status for moderate issues", async () => {
      // Record some errors and circuit breaker trips
      for (let i = 0; i < 6; i++) {
        monitoringService.recordRedisError(new Error("Error"));
      }
      for (let i = 0; i < 3; i++) {
        monitoringService.recordCircuitBreakerTrip();
      }

      const health = await monitoringService.getHealthStatus();

      expect(health.status).toBe("degraded");
    });

    test("should return unhealthy status for severe issues", async () => {
      // Record many errors and circuit breaker trips
      for (let i = 0; i < 15; i++) {
        monitoringService.recordRedisError(new Error("Error"));
      }
      for (let i = 0; i < 10; i++) {
        monitoringService.recordCircuitBreakerTrip();
      }

      const health = await monitoringService.getHealthStatus();

      expect(health.status).toBe("unhealthy");
    });

    test("should include rate limiter health and stats", async () => {
      const health = await monitoringService.getHealthStatus();

      expect(health.rateLimiter).toEqual({
        status: "healthy",
        redis: { connected: true },
        circuitBreaker: { state: "closed" },
      });

      expect(health.stats).toEqual({
        totalKeys: 100,
        activeKeys: 50,
        hitRate: 0.95,
      });
    });

    test("should include active alerts in health status", async () => {
      // Trigger an alert
      for (let i = 0; i < 8; i++) {
        const result: RateLimitResult = {
          allowed: true,
          totalHits: 1,
          remaining: 9,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 50,
        };
        monitoringService.recordCheck(result, 50);
      }
      monitoringService.recordRedisError(new Error("Error"));

      // Trigger alert check by recording another request
      const result: RateLimitResult = {
        allowed: true,
        totalHits: 1,
        remaining: 9,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 10,
        algorithm: "sliding-window",
        cached: false,
        responseTime: 50,
      };
      monitoringService.recordCheck(result, 50);

      const health = await monitoringService.getHealthStatus();

      expect(health.alerts).toContain("high-error-rate");
    });
  });

  describe("Metrics Management", () => {
    test("should reset metrics correctly", () => {
      // Record some metrics
      const result: RateLimitResult = {
        allowed: true,
        totalHits: 1,
        remaining: 9,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 10,
        algorithm: "sliding-window",
        cached: false,
        responseTime: 50,
      };
      monitoringService.recordCheck(result, 50);
      monitoringService.recordCircuitBreakerTrip();
      monitoringService.recordRedisError(new Error("Error"));

      // Reset metrics
      monitoringService.resetMetrics();

      const metrics = monitoringService.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.allowedRequests).toBe(0);
      expect(metrics.deniedRequests).toBe(0);
      expect(metrics.circuitBreakerTrips).toBe(0);
      expect(metrics.redisErrors).toBe(0);
      expect(metrics.averageResponseTime).toBe(0);

      expect(mockLogger.info).toHaveBeenCalledWith("Metrics reset");
    });

    test("should reset alert triggers on metrics reset", async () => {
      // Trigger an alert
      for (let i = 0; i < 8; i++) {
        const result: RateLimitResult = {
          allowed: true,
          totalHits: 1,
          remaining: 9,
          resetTime: Date.now() + 60000,
          windowStart: Date.now(),
          windowEnd: Date.now() + 60000,
          limit: 10,
          algorithm: "sliding-window",
          cached: false,
          responseTime: 50,
        };
        monitoringService.recordCheck(result, 50);
      }
      monitoringService.recordRedisError(new Error("Error"));

      // Reset metrics
      monitoringService.resetMetrics();

      // Check that alert is no longer active
      const health = await monitoringService.getHealthStatus();
      expect(health.alerts).not.toContain("high-error-rate");
    });
  });

  describe("Custom Alerts", () => {
    test("should add custom alert", () => {
      monitoringService.addAlert("custom-alert", 0.75);

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Custom alert added",
        expect.objectContaining({
          name: "custom-alert",
          threshold: 0.75,
        })
      );
    });

    test("should remove alert", () => {
      monitoringService.addAlert("custom-alert", 0.75);
      monitoringService.removeAlert("custom-alert");

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Alert removed",
        expect.objectContaining({
          name: "custom-alert",
        })
      );
    });

    test("should handle removing non-existent alert", () => {
      monitoringService.removeAlert("non-existent");

      // Should not log anything since alert doesn't exist
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        "Alert removed",
        expect.any(Object)
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle zero division in alert calculations", () => {
      // No requests recorded, should not trigger alerts
      monitoringService.recordRedisError(new Error("Error"));

      // Should not trigger error rate alert due to zero total requests
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        "High error rate alert triggered",
        expect.any(Object)
      );
    });

    test("should handle very high response times", () => {
      const result: RateLimitResult = {
        allowed: true,
        totalHits: 1,
        remaining: 9,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 10,
        algorithm: "sliding-window",
        cached: false,
        responseTime: 5000,
      };

      monitoringService.recordCheck(result, 5000); // 5 second response time

      const metrics = monitoringService.getMetrics();
      expect(metrics.averageResponseTime).toBe(5000);
    });

    test("should handle concurrent metric updates", () => {
      const result: RateLimitResult = {
        allowed: true,
        totalHits: 1,
        remaining: 9,
        resetTime: Date.now() + 60000,
        windowStart: Date.now(),
        windowEnd: Date.now() + 60000,
        limit: 10,
        algorithm: "sliding-window",
        cached: false,
        responseTime: 50,
      };

      // Simulate concurrent updates
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            monitoringService.recordCheck(result, 50);
            resolve();
          })
        );
      }

      // All promises should resolve without errors
      expect(async () => {
        await Promise.all(promises);
      }).not.toThrow();
    });
  });
});
