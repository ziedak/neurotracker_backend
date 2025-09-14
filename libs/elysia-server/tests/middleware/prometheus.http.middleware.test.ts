/**
 * @fileoverview Comprehensive unit tests for PrometheusHttpMiddleware
 * @description Tests metrics collection, Prometheus formatting, and monitoring
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { PrometheusHttpMiddleware } from "../../src/middleware/prometheus/prometheus.http.middleware";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
  recordHistogram: jest.fn(),
  recordSummary: jest.fn(),
  getMetrics: jest.fn().mockResolvedValue("# Test metrics"),
  recordApiRequest: jest.fn(),
  recordDatabaseOperation: jest.fn(),
  recordAuthOperation: jest.fn(),
  recordWebSocketActivity: jest.fn(),
  recordNodeMetrics: jest.fn(),
  measureEventLoopLag: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("PrometheusHttpMiddleware", () => {
  let middleware: PrometheusHttpMiddleware;
  let mockContext: MiddlewareContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance with comprehensive configuration
    middleware = new PrometheusHttpMiddleware(mockMetricsCollector, {
      name: "test-prometheus",
      enabled: true,
      priority: 60,
      collectDefaultMetrics: true,
      collectHttpMetrics: true,
      collectCustomMetrics: true,
      metricPrefix: "test_app",
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      includePathLabels: true,
      includeMethodLabels: true,
      includeStatusLabels: true,
      includeUserAgentLabels: false,
      excludePaths: ["/health", "/metrics"],
      customLabels: {
        environment: "test",
        service: "api",
      },
      registry: undefined,
    });

    // Create mock context
    mockContext = {
      requestId: "test-request-123",
      request: {
        method: "POST",
        url: "/api/users",
        headers: {
          "user-agent": "test-agent/1.0",
          "content-type": "application/json",
        },
        body: { name: "John Doe" },
        query: { filter: "active" },
        params: { id: "123" },
        ip: "192.168.1.1",
      },
      response: {
        status: 201,
        headers: { "content-type": "application/json" },
        body: { id: "123", name: "John Doe" },
      },
      set: {
        status: 201,
        headers: {
          "content-type": "application/json",
          "x-request-id": "test-request-123",
        },
        body: { id: "123", name: "John Doe" },
      },
      user: { id: "user-123", role: "admin" },
      session: undefined,
      validated: {},
      path: "/api/users",
    };

    nextFunction = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("Middleware Initialization", () => {
    it("should initialize with default configuration", () => {
      const defaultMiddleware = new PrometheusHttpMiddleware(
        mockMetricsCollector,
        {}
      );

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("prometheus");
      expect(defaultMiddleware["config"].collectHttpMetrics).toBe(true);
      expect(defaultMiddleware["config"].metricPrefix).toBe("app");
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-prometheus");
      expect(middleware["config"].metricPrefix).toBe("test_app");
      expect(middleware["config"].buckets).toEqual([0.1, 0.5, 1, 2, 5, 10]);
      expect(middleware["config"].customLabels).toEqual({
        environment: "test",
        service: "api",
      });
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new PrometheusHttpMiddleware(mockMetricsCollector, {
          buckets: [-1, 0.5, 1],
        });
      }).toThrow("Prometheus buckets must contain only positive numbers");
    });
  });

  describe("HTTP Metrics Collection", () => {
    it("should collect request count metrics", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "test_app_http_requests_total",
        1,
        expect.objectContaining({
          method: "POST",
          path: "/api/users",
          status: "201",
          environment: "test",
          service: "api",
        })
      );
    });

    it("should collect request duration metrics", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "test_app_http_request_duration_seconds",
        expect.any(Number),
        expect.objectContaining({
          method: "POST",
          path: "/api/users",
          status: "201",
          environment: "test",
          service: "api",
        })
      );
    });

    it("should collect response size metrics", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "test_app_http_response_size_bytes",
        expect.any(Number),
        expect.objectContaining({
          method: "POST",
          path: "/api/users",
          status: "201",
        })
      );
    });

    it("should collect request size metrics", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "test_app_http_request_size_bytes",
        expect.any(Number),
        expect.objectContaining({
          method: "POST",
          path: "/api/users",
        })
      );
    });
  });

  describe("Path Exclusion", () => {
    it("should skip metrics collection for excluded paths", async () => {
      mockContext.path = "/health";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).not.toHaveBeenCalled();
      expect(mockMetricsCollector.recordTimer).not.toHaveBeenCalled();
    });

    it("should collect metrics for non-excluded paths", async () => {
      mockContext.path = "/api/users";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalled();
      expect(mockMetricsCollector.recordTimer).toHaveBeenCalled();
    });

    it("should handle path prefix exclusion", async () => {
      mockContext.path = "/metrics/detailed";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).not.toHaveBeenCalled();
    });
  });

  describe("Label Configuration", () => {
    it("should include method labels when enabled", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    it("should exclude method labels when disabled", async () => {
      const noMethodMiddleware = new PrometheusHttpMiddleware(
        mockMetricsCollector,
        {
          includeMethodLabels: false,
        }
      );

      await noMethodMiddleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.not.objectContaining({
          method: "POST",
        })
      );
    });

    it("should include path labels when enabled", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.objectContaining({
          path: "/api/users",
        })
      );
    });

    it("should exclude path labels when disabled", async () => {
      const noPathMiddleware = new PrometheusHttpMiddleware(
        mockMetricsCollector,
        {
          includePathLabels: false,
        }
      );

      await noPathMiddleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.not.objectContaining({
          path: "/api/users",
        })
      );
    });

    it("should include status labels when enabled", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.objectContaining({
          status: "201",
        })
      );
    });

    it("should exclude status labels when disabled", async () => {
      const noStatusMiddleware = new PrometheusHttpMiddleware(
        mockMetricsCollector,
        {
          includeStatusLabels: false,
        }
      );

      await noStatusMiddleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.not.objectContaining({
          status: "201",
        })
      );
    });

    it("should include user agent labels when enabled", async () => {
      const uaMiddleware = new PrometheusHttpMiddleware(mockMetricsCollector, {
        includeUserAgentLabels: true,
      });

      await uaMiddleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.objectContaining({
          user_agent: "test-agent/1.0",
        })
      );
    });
  });

  describe("Custom Labels", () => {
    it("should include custom labels in all metrics", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.objectContaining({
          environment: "test",
          service: "api",
        })
      );

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.objectContaining({
          environment: "test",
          service: "api",
        })
      );
    });

    it("should handle empty custom labels", async () => {
      const noCustomMiddleware = new PrometheusHttpMiddleware(
        mockMetricsCollector,
        {
          customLabels: {},
        }
      );

      await noCustomMiddleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.not.objectContaining({
          environment: "test",
          service: "api",
        })
      );
    });
  });

  describe("Error Handling", () => {
    it("should collect metrics for error responses", async () => {
      nextFunction.mockRejectedValue(new Error("Test error"));
      mockContext.set.status = 500;

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "test_app_http_requests_total",
        1,
        expect.objectContaining({
          method: "POST",
          path: "/api/users",
          status: "500",
        })
      );
    });

    it("should collect error-specific metrics", async () => {
      nextFunction.mockRejectedValue(new Error("Test error"));
      mockContext.set.status = 500;

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "test_app_http_errors_total",
        1,
        expect.objectContaining({
          method: "POST",
          path: "/api/users",
          status: "500",
          error_type: "Error",
        })
      );
    });

    it("should handle different error types", async () => {
      const errorTypes = [
        new Error("Generic error"),
        new TypeError("Type error"),
        new ReferenceError("Reference error"),
      ];

      for (const error of errorTypes) {
        nextFunction.mockRejectedValue(error);
        mockContext.set.status = 500;

        await expect(
          middleware["execute"](mockContext, nextFunction)
        ).rejects.toThrow();

        expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
          "test_app_http_errors_total",
          1,
          expect.objectContaining({
            error_type: error.constructor.name,
          })
        );
      }
    });
  });

  describe("Size Calculations", () => {
    it("should calculate request size correctly", async () => {
      const largeBody = { data: "x".repeat(1000) };
      mockContext.request.body = largeBody;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "test_app_http_request_size_bytes",
        expect.any(Number),
        expect.any(Object)
      );

      const call = mockMetricsCollector.recordGauge.mock.calls.find(
        (call) => call[0] === "test_app_http_request_size_bytes"
      );

      expect(call?.[1]).toBeGreaterThan(1000);
    });

    it("should calculate response size correctly", async () => {
      const largeResponse = { data: "x".repeat(2000) };
      mockContext.set.body = largeResponse;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "test_app_http_response_size_bytes",
        expect.any(Number),
        expect.any(Object)
      );

      const call = mockMetricsCollector.recordGauge.mock.calls.find(
        (call) => call[0] === "test_app_http_response_size_bytes"
      );

      expect(call?.[1]).toBeGreaterThan(2000);
    });

    it("should handle non-object bodies", async () => {
      mockContext.request.body = "string body";
      mockContext.set.body = "string response";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "test_app_http_request_size_bytes",
        11, // "string body".length
        expect.any(Object)
      );

      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "test_app_http_response_size_bytes",
        15, // "string response".length
        expect.any(Object)
      );
    });
  });

  describe("Default Metrics Collection", () => {
    it("should collect default Node.js metrics when enabled", async () => {
      const defaultMetricsMiddleware = new PrometheusHttpMiddleware(
        mockMetricsCollector,
        {
          name: "test-default-metrics",
          enabled: true,
          priority: 60,
          collectDefaultMetrics: true,
          enableNodeMetrics: true,
          nodeMetricsSampleRate: 1.0, // Ensure it always samples
        }
      );

      await defaultMetricsMiddleware["execute"](mockContext, nextFunction);

      // Verify that runtime metrics collection was attempted
      // Should record memory metrics with runtime label
      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "elysia_runtime_memory_usage_bytes",
        expect.any(Number),
        expect.objectContaining({
          service: "http-service",
          runtime: "nodejs",
          type: "rss",
        })
      );

      // Event loop lag may be recorded asynchronously, so we don't assert it specifically
      // but we can check that some runtime metrics were recorded
    });

    it("should skip default metrics when disabled", async () => {
      const noDefaultMiddleware = new PrometheusHttpMiddleware(
        mockMetricsCollector,
        {
          name: "test-no-default",
          enabled: true,
          priority: 60,
          collectDefaultMetrics: false,
        }
      );

      await noDefaultMiddleware["execute"](mockContext, nextFunction);

      // Should not attempt to collect default metrics
      expect(mockMetricsCollector.recordGauge).not.toHaveBeenCalledWith(
        expect.stringContaining("nodejs"),
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe("Custom Metrics", () => {
    it("should collect custom business metrics", async () => {
      // Simulate custom metrics collection
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "test_app_http_requests_total",
        1,
        expect.any(Object)
      );
    });

    it("should handle custom metrics with user context", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Number),
        expect.objectContaining({
          user_id: "user-123",
          user_role: "admin",
        })
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid buckets", () => {
      expect(() => {
        new PrometheusHttpMiddleware(mockMetricsCollector, {
          name: "test-invalid-buckets",
          enabled: true,
          priority: 60,
          buckets: [0.1, -0.5, 1],
        });
      }).toThrow("Prometheus buckets must contain only positive numbers");
    });

    it("should reject invalid excludePaths", () => {
      expect(() => {
        new PrometheusHttpMiddleware(mockMetricsCollector, {
          name: "test-invalid-paths",
          enabled: true,
          priority: 60,
          excludePaths: ["invalid-path"],
        });
      }).toThrow("Prometheus excludePaths must start with '/'");
    });

    it("should reject invalid metricPrefix", () => {
      expect(() => {
        new PrometheusHttpMiddleware(mockMetricsCollector, {
          name: "test-invalid-prefix",
          enabled: true,
          priority: 60,
          metricPrefix: "invalid-prefix-with-dashes",
        });
      }).toThrow(
        "Prometheus metricPrefix must match Prometheus naming conventions"
      );
    });
  });

  describe("Configuration Presets", () => {
    it("should create development configuration", () => {
      const devConfig = PrometheusHttpMiddleware.createDevelopmentConfig();

      expect(devConfig.collectDefaultMetrics).toBe(true);
      expect(devConfig.collectHttpMetrics).toBe(true);
      expect(devConfig.includePathLabels).toBe(true);
      expect(devConfig.includeMethodLabels).toBe(true);
    });

    it("should create production configuration", () => {
      const prodConfig = PrometheusHttpMiddleware.createProductionConfig();

      expect(prodConfig.collectDefaultMetrics).toBe(true);
      expect(prodConfig.collectHttpMetrics).toBe(true);
      expect(prodConfig.excludePaths).toEqual([
        "/health",
        "/metrics",
        "/favicon.ico",
      ]);
    });

    it("should create minimal configuration", () => {
      const minimalConfig = PrometheusHttpMiddleware.createMinimalConfig();

      expect(minimalConfig.collectDefaultMetrics).toBe(false);
      expect(minimalConfig.collectHttpMetrics).toBe(true);
      expect(minimalConfig.includePathLabels).toBe(false);
      expect(minimalConfig.includeMethodLabels).toBe(false);
    });

    it("should create high-cardinality configuration", () => {
      const highCardConfig =
        PrometheusHttpMiddleware.createHighCardinalityConfig();

      expect(highCardConfig.includePathLabels).toBe(true);
      expect(highCardConfig.includeMethodLabels).toBe(true);
      expect(highCardConfig.includeStatusLabels).toBe(true);
      expect(highCardConfig.includeUserAgentLabels).toBe(true);
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(60);
    });

    it("should preserve request context", async () => {
      const originalRequestId = mockContext.requestId;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.requestId).toBe(originalRequestId);
    });

    it("should handle concurrent requests", async () => {
      const promises = Array(5)
        .fill(null)
        .map(() => middleware["execute"]({ ...mockContext }, nextFunction));

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });

  describe("Metrics Registry", () => {
    it("should use custom registry when provided", () => {
      const mockRegistry = {
        registerMetric: jest.fn(),
        getMetricsAsJSON: jest.fn(),
      };

      const registryMiddleware = new PrometheusHttpMiddleware(
        mockMetricsCollector,
        {
          name: "test-registry",
          enabled: true,
          priority: 60,
          registry: mockRegistry,
        }
      );

      expect(registryMiddleware["config"].registry).toBe(mockRegistry);
    });

    it("should handle registry operations", async () => {
      const mockRegistry = {
        registerMetric: jest.fn(),
        getMetricsAsJSON: jest.fn().mockReturnValue({}),
        metrics: jest.fn().mockReturnValue("# Test metrics"),
      };

      const registryMiddleware = new PrometheusHttpMiddleware(
        mockMetricsCollector,
        {
          name: "test-registry-ops",
          enabled: true,
          priority: 60,
          registry: mockRegistry,
        }
      );

      await registryMiddleware["execute"](mockContext, nextFunction);

      expect(mockRegistry.registerMetric).toHaveBeenCalled();
    });
  });
});
