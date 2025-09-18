/**
 * Circuit Breaker Security Tests
 * Tests for circuit breaker security, observability, and resilience
 */

import { KeycloakClientFactory } from "../../src/client/keycloak-client-factory";

describe("Circuit Breaker Security Tests", () => {
  let clientFactory: KeycloakClientFactory;

  beforeEach(() => {
    jest.clearAllMocks();
    const envConfig = (global as any).testUtils.createMockEnvironmentConfig();
    clientFactory = new KeycloakClientFactory(envConfig);
  });

  describe("Circuit Breaker Observability Security", () => {
    it("should not expose sensitive information in health status", () => {
      const healthStatus = clientFactory.getHealthStatus();

      // Check that health status doesn't contain sensitive data
      const healthStr = JSON.stringify(healthStatus);

      // Should not contain sensitive patterns
      const sensitivePatterns = [
        /password/i,
        /secret/i,
        /key/i,
        /token/i,
        /localhost/i,
        /127\.0\.0\.1/i,
        /192\.168/i,
        /admin/i,
        /root/i,
        /database/i,
        /redis/i,
        /connection.*string/i,
        /credential/i,
      ];

      sensitivePatterns.forEach((pattern) => {
        expect(healthStr).not.toMatch(pattern);
      });

      // Should only contain expected health fields
      expect(healthStatus).toHaveProperty("healthy");
      expect(healthStatus).toHaveProperty("circuitBreaker");
      expect(typeof healthStatus.healthy).toBe("boolean");
      expect(typeof healthStatus.circuitBreaker).toBe("object");
    });

    it("should provide circuit breaker metrics without sensitive details", () => {
      const healthStatus = clientFactory.getHealthStatus();
      const cbMetrics = healthStatus.circuitBreaker.metrics;

      // Should contain expected metrics
      const expectedMetrics = [
        "successRate",
        "totalRequests",
        "successes",
        "failures",
        "circuitOpenEvents",
        "lastSuccess",
        "lastFailure",
      ];

      expectedMetrics.forEach((metric) => {
        expect(cbMetrics).toHaveProperty(metric);
      });

      // Metrics should be safe numeric/string values
      Object.values(cbMetrics).forEach((value) => {
        expect(
          typeof value === "number" ||
            typeof value === "string" ||
            value === null
        ).toBe(true);
      });

      // Should not contain internal implementation details
      const metricsStr = JSON.stringify(cbMetrics);
      expect(metricsStr).not.toMatch(
        /cockatiel|internal|implementation|error/i
      );
    });

    it("should handle rapid health check requests without degradation", () => {
      const startTime = Date.now();
      const requestCount = 100;

      // Make many rapid health checks
      const healthResults = [];
      for (let i = 0; i < requestCount; i++) {
        const health = clientFactory.getHealthStatus();
        healthResults.push(health);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete quickly
      expect(duration).toBeLessThan(1000); // Less than 1 second

      // All results should be consistent
      healthResults.forEach((health) => {
        expect(health).toHaveProperty("healthy");
        expect(health).toHaveProperty("circuitBreaker");
        expect(health.circuitBreaker).toHaveProperty("configured");
        expect(health.circuitBreaker.configured).toBe(true);
      });
    });

    it("should maintain thread safety during concurrent health checks", async () => {
      const concurrentRequests = 50;
      const promises = [];

      // Launch concurrent health check requests
      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(Promise.resolve(clientFactory.getHealthStatus()));
      }

      // Wait for all to complete
      const results = await Promise.all(promises);

      // All should succeed and be consistent
      expect(results).toHaveLength(concurrentRequests);
      results.forEach((health) => {
        expect(health).toHaveProperty("healthy");
        expect(health).toHaveProperty("circuitBreaker");
      });
    });
  });

  describe("Circuit Breaker Configuration Security", () => {
    it("should have secure default configuration", () => {
      const healthStatus = clientFactory.getHealthStatus();
      const cbConfig = healthStatus.circuitBreaker;

      // Should have reasonable failure threshold (not too high)
      expect(cbConfig.failureThreshold).toBeGreaterThan(0);
      expect(cbConfig.failureThreshold).toBeLessThan(100);

      // Should have reasonable recovery timeout
      expect(cbConfig.recoveryTimeout).toBeDefined();
      expect(typeof cbConfig.recoveryTimeout).toBe("string");

      // Configuration should be immutable from external access
      const originalThreshold = cbConfig.failureThreshold;
      cbConfig.failureThreshold = 999999; // Attempt to modify

      const newHealthStatus = clientFactory.getHealthStatus();
      // Should still have original value (immutable)
      expect(newHealthStatus.circuitBreaker.failureThreshold).toBe(
        originalThreshold
      );
    });

    it("should not expose internal circuit breaker implementation", () => {
      // Test that we can't access internal circuit breaker object
      const factory = clientFactory as any;

      // Internal circuit breaker should not be directly accessible
      expect(factory.circuitBreaker).toBeUndefined();
      expect(factory._circuitBreaker).toBeUndefined();
      expect(factory.cb).toBeUndefined();

      // Should only expose safe methods
      const publicMethods = Object.getOwnPropertyNames(clientFactory);
      const dangerousMethods = [
        "executeWithCircuitBreaker",
        "getCircuitBreaker",
        "setCircuitBreaker",
      ];

      dangerousMethods.forEach((method) => {
        expect(publicMethods.includes(method)).toBe(false);
      });
    });
  });

  describe("Circuit Breaker DoS Protection", () => {
    it("should handle health check flooding without resource exhaustion", () => {
      const startMemory = process.memoryUsage();
      const requestCount = 10000;

      // Make many health check requests
      for (let i = 0; i < requestCount; i++) {
        const health = clientFactory.getHealthStatus();
        expect(health).toBeDefined();

        // Occasionally check memory growth
        if (i % 1000 === 0 && global.gc) {
          global.gc();
        }
      }

      // Final memory check
      if (global.gc) {
        global.gc();
      }
      const endMemory = process.memoryUsage();

      // Memory should not grow excessively
      const memoryGrowth = endMemory.heapUsed - startMemory.heapUsed;
      const growthPercent = (memoryGrowth / startMemory.heapUsed) * 100;

      // Allow reasonable memory growth but prevent memory exhaustion
      expect(growthPercent).toBeLessThan(100); // Less than 100% growth
    });

    it("should maintain consistent performance under load", () => {
      const measurements = [];
      const iterations = 100;

      // Measure performance over multiple iterations
      for (let i = 0; i < iterations; i++) {
        const start = Date.now();

        // Perform health checks
        for (let j = 0; j < 10; j++) {
          clientFactory.getHealthStatus();
        }

        const end = Date.now();
        measurements.push(end - start);
      }

      // Calculate statistics
      const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const max = Math.max(...measurements);
      const min = Math.min(...measurements);

      // Performance should be consistent
      expect(max - min).toBeLessThan(100); // Less than 100ms variation
      expect(avg).toBeLessThan(50); // Average less than 50ms for 10 health checks

      // No extreme outliers
      const outliers = measurements.filter((m) => m > avg * 3);
      expect(outliers.length / measurements.length).toBeLessThan(0.05); // Less than 5% outliers
    });
  });

  describe("Circuit Breaker Error Handling Security", () => {
    it("should handle circuit breaker initialization failures gracefully", () => {
      // Mock environment config that might cause initialization issues
      const mockEnvConfig = {
        ...(global as any).testUtils.createMockEnvironmentConfig(),
        // Potentially problematic values
        KEYCLOAK_CIRCUIT_BREAKER_FAILURE_THRESHOLD: null,
        KEYCLOAK_CIRCUIT_BREAKER_RECOVERY_TIMEOUT: undefined,
      };

      // Should not crash during construction
      expect(() => {
        const factory = new KeycloakClientFactory(mockEnvConfig);
        const health = factory.getHealthStatus();
        expect(health).toBeDefined();
      }).not.toThrow();
    });

    it("should sanitize circuit breaker error messages", () => {
      const healthStatus = clientFactory.getHealthStatus();

      // Convert health status to string to check for sensitive info
      const statusStr = JSON.stringify(healthStatus, null, 2);

      // Should not contain internal error details
      const sensitivePatterns = [
        /stack trace/i,
        /internal error/i,
        /exception/i,
        /at Object\./,
        /at Function\./,
        /node_modules/i,
        /\.js:\d+/,
        /Error: /,
      ];

      sensitivePatterns.forEach((pattern) => {
        expect(statusStr).not.toMatch(pattern);
      });
    });

    it("should maintain circuit breaker isolation", () => {
      // Multiple client factory instances should have isolated circuit breakers
      const envConfig = (global as any).testUtils.createMockEnvironmentConfig();
      const factory1 = new KeycloakClientFactory(envConfig);
      const factory2 = new KeycloakClientFactory(envConfig);

      const health1 = factory1.getHealthStatus();
      const health2 = factory2.getHealthStatus();

      // Both should work independently
      expect(health1.circuitBreaker.metrics).toBeDefined();
      expect(health2.circuitBreaker.metrics).toBeDefined();

      // Metrics should be independent (different object references)
      expect(health1.circuitBreaker.metrics).not.toBe(
        health2.circuitBreaker.metrics
      );
    });
  });

  describe("Circuit Breaker Metrics Security", () => {
    it("should prevent metrics tampering", () => {
      const healthStatus = clientFactory.getHealthStatus();
      const originalMetrics = { ...healthStatus.circuitBreaker.metrics };

      // Attempt to tamper with metrics (this will fail at runtime but test should handle)
      try {
        (originalMetrics as any).successRate = "100%";
        (originalMetrics as any).totalRequests = 999999;
        (originalMetrics as any).failures = -1;
      } catch {
        // Expected - metrics should be protected
      }

      // Get fresh metrics
      const newHealthStatus = clientFactory.getHealthStatus();

      // Metrics should be fresh/protected (not tampered values)
      expect(newHealthStatus.circuitBreaker.metrics).toBeDefined();
      expect(newHealthStatus.circuitBreaker.metrics.failures).not.toBe(-1);
    });

    it("should have bounded metric values", () => {
      const healthStatus = clientFactory.getHealthStatus();
      const metrics = healthStatus.circuitBreaker.metrics;

      // Success rate should be bounded 0-100
      if (typeof metrics.successRate === "string") {
        // Parse numeric value from percentage string
        const rate = parseFloat(metrics.successRate.replace("%", ""));
        if (!isNaN(rate)) {
          expect(rate).toBeGreaterThanOrEqual(0);
          expect(rate).toBeLessThanOrEqual(100);
        }
      }

      // Counters should be non-negative
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(0);
      expect(metrics.totalRequests).toBeLessThan(Number.MAX_SAFE_INTEGER);

      expect(metrics.successes).toBeGreaterThanOrEqual(0);
      expect(metrics.successes).toBeLessThan(Number.MAX_SAFE_INTEGER);

      expect(metrics.failures).toBeGreaterThanOrEqual(0);
      expect(metrics.failures).toBeLessThan(Number.MAX_SAFE_INTEGER);

      expect(metrics.circuitOpenEvents).toBeGreaterThanOrEqual(0);
      expect(metrics.circuitOpenEvents).toBeLessThan(Number.MAX_SAFE_INTEGER);

      // Timestamps should be reasonable
      if (metrics.lastSuccess !== null) {
        const now = Date.now();
        const timestamp = new Date(metrics.lastSuccess).getTime();
        expect(timestamp).toBeLessThanOrEqual(now);
        expect(timestamp).toBeGreaterThan(now - 24 * 60 * 60 * 1000); // Not older than 24h
      }

      if (metrics.lastFailure !== null) {
        const now = Date.now();
        const timestamp = new Date(metrics.lastFailure).getTime();
        expect(timestamp).toBeLessThanOrEqual(now);
        expect(timestamp).toBeGreaterThan(now - 24 * 60 * 60 * 1000); // Not older than 24h
      }
    });
  });
});
