import { RateLimitMonitoringService } from "../src/rateLimitMonitoring";

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

const mockRateLimiter = {
  getHealth: jest.fn().mockResolvedValue({
    redis: { available: true },
    circuitBreaker: { enabled: true, state: "closed" },
    algorithm: "sliding-window",
  }),
  getCircuitBreakerStatus: jest.fn().mockReturnValue({
    enabled: true,
    state: "closed",
  }),
} as any;

// Mock the external dependencies
jest.mock("@libs/database", () => ({
  RedisClient: jest.fn().mockImplementation(() => mockRedisClient),
}));

jest.mock("@libs/monitoring", () => ({
  ILogger: jest.fn().mockImplementation(() => mockLogger),
}));

jest.mock("../src/redisRateLimit", () => ({
  OptimizedRedisRateLimit: jest.fn().mockImplementation(() => mockRateLimiter),
}));

describe("RateLimitMonitoringService", () => {
  let monitoringService: RateLimitMonitoringService;

  beforeEach(() => {
    jest.clearAllMocks();
    monitoringService = new RateLimitMonitoringService(
      mockRateLimiter,
      mockLogger
    );
  });

  describe("Initialization", () => {
    test("should initialize with rate limiter and logger", () => {
      expect(monitoringService).toBeDefined();
      expect(mockLogger.child).toHaveBeenCalledWith({
        component: "RateLimitMonitoring",
      });
    });

    test("should initialize default alerts", () => {
      // Default alerts should be initialized
      const service = new RateLimitMonitoringService(
        mockRateLimiter,
        mockLogger
      );
      expect(service).toBeDefined();
    });
  });

  describe("Metrics Recording", () => {
    test("should record allowed request", () => {
      const result = { allowed: true, remaining: 99 };
      const responseTime = 50;

      monitoringService.recordCheck(result, responseTime);

      const metrics = monitoringService.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.allowedRequests).toBe(1);
      expect(metrics.deniedRequests).toBe(0);
      expect(metrics.averageResponseTime).toBe(50);
    });

    test("should record denied request", () => {
      const result = { allowed: false, remaining: 0 };
      const responseTime = 75;

      monitoringService.recordCheck(result, responseTime);

      const metrics = monitoringService.getMetrics();
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.allowedRequests).toBe(0);
      expect(metrics.deniedRequests).toBe(1);
      expect(metrics.averageResponseTime).toBe(75);
    });

    test("should update average response time", () => {
      monitoringService.recordCheck({ allowed: true }, 100);
      monitoringService.recordCheck({ allowed: true }, 200);

      const metrics = monitoringService.getMetrics();
      expect(metrics.averageResponseTime).toBe(150); // (100 + 200) / 2
    });

    test("should record circuit breaker trip", () => {
      monitoringService.recordCircuitBreakerTrip();

      const metrics = monitoringService.getMetrics();
      expect(metrics.circuitBreakerTrips).toBe(1);
    });

    test("should record Redis error", () => {
      const error = new Error("Redis connection failed");
      monitoringService.recordRedisError(error);

      const metrics = monitoringService.getMetrics();
      expect(metrics.redisErrors).toBe(1);
    });
  });

  describe("Metrics Retrieval", () => {
    test("should return current metrics", () => {
      monitoringService.recordCheck({ allowed: true }, 50);
      monitoringService.recordCheck({ allowed: false }, 100);
      monitoringService.recordCircuitBreakerTrip();
      monitoringService.recordRedisError(new Error("test"));

      const metrics = monitoringService.getMetrics();

      expect(metrics).toEqual({
        totalRequests: 2,
        allowedRequests: 1,
        deniedRequests: 1,
        circuitBreakerTrips: 1,
        redisErrors: 1,
        averageResponseTime: 75, // (50 + 100) / 2
        peakRequestsPerMinute: 0,
      });
    });

    test("should return copy of metrics (not reference)", () => {
      const metrics1 = monitoringService.getMetrics();
      const metrics2 = monitoringService.getMetrics();

      expect(metrics1).not.toBe(metrics2); // Different objects
      expect(metrics1).toEqual(metrics2); // Same values
    });
  });

  describe("Health Status", () => {
    test("should provide healthy status", async () => {
      const health = await monitoringService.getHealthStatus();

      expect(health).toEqual({
        status: "healthy",
        metrics: expect.any(Object),
        rateLimiter: expect.any(Object),
        circuitBreaker: expect.any(Object),
        alerts: expect.any(Array),
        timestamp: expect.any(String),
      });
    });

    test("should report degraded status with moderate errors", async () => {
      // Add some errors but not enough for unhealthy
      for (let i = 0; i < 6; i++) {
        monitoringService.recordRedisError(new Error("test"));
      }
      for (let i = 0; i < 3; i++) {
        monitoringService.recordCircuitBreakerTrip();
      }

      const health = await monitoringService.getHealthStatus();
      expect(health.status).toBe("degraded");
    });

    test("should report unhealthy status with high errors", async () => {
      // Add many errors
      for (let i = 0; i < 11; i++) {
        monitoringService.recordRedisError(new Error("test"));
      }

      const health = await monitoringService.getHealthStatus();
      expect(health.status).toBe("unhealthy");
    });
  });

  describe("Alert System", () => {
    test("should trigger high error rate alert", () => {
      // Ensure clean state
      monitoringService.resetMetrics();

      // Create 10 requests with 2 errors (20% error rate > 10% threshold)
      for (let i = 0; i < 8; i++) {
        monitoringService.recordCheck({ allowed: true }, 50);
      }
      for (let i = 0; i < 2; i++) {
        monitoringService.recordRedisError(new Error("test"));
      }

      // Trigger alert check by recording another request
      monitoringService.recordCheck({ allowed: true }, 50);

      // The alert should be triggered (checked internally)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "High error rate alert triggered",
        expect.objectContaining({
          errorRate: "0.222", // 2 errors out of 9 total requests
          threshold: 0.1,
        })
      );
    });

    test("should trigger high denial rate alert", () => {
      // Ensure clean state
      monitoringService.resetMetrics();

      // Create requests with high denial rate (4 denials out of 6 = 66% > 50% threshold)
      for (let i = 0; i < 4; i++) {
        monitoringService.recordCheck({ allowed: false }, 50);
      }
      for (let i = 0; i < 2; i++) {
        monitoringService.recordCheck({ allowed: true }, 50);
      }

      // Check the last call to warn (should be the final calculation)
      const warnCalls = mockLogger.warn.mock.calls.filter(
        (call: any[]) => call[0] === "High denial rate alert triggered"
      );
      const lastCall = warnCalls[warnCalls.length - 1];

      expect(lastCall[0]).toBe("High denial rate alert triggered");
      expect(lastCall[1]).toEqual(
        expect.objectContaining({
          denialRate: "1.000", // Alert triggered when rate was 4/4 = 100%
          threshold: 0.5,
        })
      );
    });

    test("should trigger circuit breaker frequent trips alert", () => {
      // Ensure clean state
      monitoringService.resetMetrics();

      // Trip circuit breaker multiple times
      for (let i = 0; i < 4; i++) {
        monitoringService.recordCircuitBreakerTrip();
      }

      // Trigger alert check
      monitoringService.recordCheck({ allowed: true }, 50);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Frequent circuit breaker trips alert triggered",
        expect.objectContaining({
          trips: 4,
          threshold: 3,
        })
      );
    });

    test("should resolve alerts when conditions improve", () => {
      // Ensure clean state
      monitoringService.resetMetrics();

      // First trigger alert
      for (let i = 0; i < 2; i++) {
        monitoringService.recordRedisError(new Error("test"));
      }
      monitoringService.recordCheck({ allowed: true }, 50);

      // Then resolve by having many successful requests (reduce error rate below threshold)
      for (let i = 0; i < 20; i++) {
        monitoringService.recordCheck({ allowed: true }, 50);
      }

      expect(mockLogger.info).toHaveBeenCalledWith(
        "High error rate alert resolved",
        expect.objectContaining({
          errorRate: expect.stringMatching(/^0\.\d{3}$/), // Should be below 0.1
        })
      );
    });
  });

  describe("Custom Alerts", () => {
    test("should add custom alert", () => {
      monitoringService.addAlert("custom-alert", 0.05);

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Custom alert added",
        expect.objectContaining({
          name: "custom-alert",
          threshold: 0.05,
        })
      );
    });

    test("should remove alert", () => {
      monitoringService.addAlert("test-alert", 0.1);
      monitoringService.removeAlert("test-alert");

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Alert removed",
        expect.objectContaining({
          name: "test-alert",
        })
      );
    });
  });

  describe("Metrics Reset", () => {
    test("should reset all metrics", () => {
      // Add some metrics
      monitoringService.recordCheck({ allowed: true }, 100);
      monitoringService.recordCircuitBreakerTrip();
      monitoringService.recordRedisError(new Error("test"));

      // Reset
      monitoringService.resetMetrics();

      const metrics = monitoringService.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.circuitBreakerTrips).toBe(0);
      expect(metrics.redisErrors).toBe(0);
    });

    test("should log metrics reset", () => {
      monitoringService.resetMetrics();

      expect(mockLogger.info).toHaveBeenCalledWith("Metrics reset");
    });
  });

  describe("Integration with Rate Limiter", () => {
    test("should call rate limiter health methods", async () => {
      await monitoringService.getHealthStatus();

      expect(mockRateLimiter.getHealth).toHaveBeenCalled();
      expect(mockRateLimiter.getCircuitBreakerStatus).toHaveBeenCalled();
    });
  });
});
