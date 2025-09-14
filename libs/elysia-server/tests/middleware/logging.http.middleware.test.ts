/**
 * @fileoverview Comprehensive unit tests for LoggingHttpMiddleware
 * @description Tests request/response log  afterEach(() => {
    jest.clearAllTimers();
    // Clear all mocks
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  }); data sanitization, and configuration
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { LoggingHttpMiddleware } from "../../src/middleware/logging/logging.http.middleware";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

// Mock the logger creation
jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
    setLevel: jest.fn(),
  })),
}));

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("LoggingHttpMiddleware", () => {
  let middleware: LoggingHttpMiddleware;
  let mockContext: MiddlewareContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;
  let mockLogger: {
    info: jest.MockedFunction<any>;
    warn: jest.MockedFunction<any>;
    error: jest.MockedFunction<any>;
    debug: jest.MockedFunction<any>;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance with comprehensive configuration
    middleware = new LoggingHttpMiddleware(mockMetricsCollector, {
      name: "test-logging",
      enabled: true,
      priority: 50,
      logLevel: "info",
      logRequestBody: true,
      logResponseBody: true,
      logHeaders: true,
      excludePaths: ["/health", "/metrics"],
      excludeHeaders: ["authorization", "cookie"],
      maxBodySize: 1024,
      sensitiveFields: ["password", "token", "secret"],
      includeRequestTiming: true,
      includeUserAgent: true,
      includeClientIp: true,
    });

    // Get the mocked logger instance
    mockLogger = middleware["logger"] as any;

    // Create mock context
    mockContext = {
      requestId: "test-request-123",
      request: {
        method: "POST",
        url: "/api/users",
        headers: {
          "user-agent": "test-agent/1.0",
          authorization: "Bearer secret-token",
          "content-type": "application/json",
          "x-forwarded-for": "192.168.1.1",
        },
        body: {
          name: "John Doe",
          email: "john@example.com",
          password: "secret123",
          token: "jwt-token",
        },
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
      user: undefined,
      session: undefined,
      validated: {},
      path: "/api/users",
      // Add query and params to context directly for middleware to find them
      query: { filter: "active" },
      params: { id: "123" },
    };

    nextFunction = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    // Clear all mocks
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
  });

  describe("Middleware Initialization", () => {
    it("should initialize with default configuration", () => {
      const defaultMiddleware = new LoggingHttpMiddleware(
        mockMetricsCollector,
        {}
      );

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("logging");
      expect(defaultMiddleware["config"].logLevel).toBe("info");
      expect(defaultMiddleware["config"].logRequestBody).toBe(false);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-logging");
      expect(middleware["config"].logLevel).toBe("info");
      expect(middleware["config"].logRequestBody).toBe(true);
      expect(middleware["config"].maxBodySize).toBe(1024);
      expect(middleware["config"].sensitiveFields).toEqual([
        "password",
        "token",
        "secret",
      ]);
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new LoggingHttpMiddleware(mockMetricsCollector, {
          maxBodySize: -1,
        });
      }).toThrow("Logging maxBodySize must be a non-negative integer");
    });
  });

  describe("Request Logging", () => {
    it("should log incoming request with all details", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Incoming request",
        expect.objectContaining({
          requestId: expect.any(String),
          method: "POST",
          url: "/api/users",
          userAgent: "test-agent/1.0",
          ip: "192.168.1.1",
          timestamp: expect.any(String),
          headers: expect.objectContaining({
            "user-agent": "test-agent/1.0",
            authorization: "[REDACTED]",
          }),
          body: expect.objectContaining({
            name: "John Doe",
            email: "john@example.com",
            password: "[REDACTED]",
            token: "[REDACTED]",
          }),
          query: { filter: "active" },
          params: { id: "123" },
        })
      );
    });

    it("should add request ID to headers", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.request.headers["x-request-id"]).toBeDefined();
      expect(typeof mockContext.request.headers["x-request-id"]).toBe("string");
    });

    it("should skip logging for excluded paths", async () => {
      mockContext.request.url = "/health";

      await middleware["execute"](mockContext, nextFunction);

      // Should not log request for excluded path
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        "Incoming request",
        expect.any(Object)
      );
    });

    it("should handle requests without body", async () => {
      mockContext.request.body = undefined;
      mockContext.request.method = "GET";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Incoming request",
        expect.objectContaining({
          method: "GET",
          // Body field should not be present when undefined
        })
      );

      // Verify that body is not included in the logged data
      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );
      expect(loggedCall?.[1]).not.toHaveProperty("body");
    });
  });

  describe("Response Logging", () => {
    it("should log successful response", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockLogger.info).toHaveBeenCalledWith(
        "Outgoing response",
        expect.objectContaining({
          requestId: expect.any(String),
          statusCode: 201,
          responseTime: expect.any(Number),
          contentLength: expect.any(Number),
          headers: expect.objectContaining({
            "content-type": "application/json",
          }),
          body: { id: "123", name: "John Doe" },
        })
      );
    });

    it("should log error responses", async () => {
      nextFunction.mockRejectedValue(new Error("Test error"));
      mockContext.set.status = 500;

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Test error");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Error response",
        expect.any(Error)
      );
    });

    it("should use appropriate log level for different status codes", async () => {
      const testCases = [
        { status: 200, expectedLevel: "info" },
        { status: 201, expectedLevel: "info" },
        { status: 301, expectedLevel: "info" },
        { status: 404, expectedLevel: "warn" },
        { status: 500, expectedLevel: "error" },
      ];

      for (const { status, expectedLevel } of testCases) {
        const spy = mockLogger[expectedLevel as keyof typeof mockLogger];
        mockContext.set.status = status;

        await middleware["execute"](mockContext, nextFunction);

        expect(spy).toHaveBeenCalledWith(
          "Outgoing response",
          expect.any(Object)
        );
      }
    });
  });

  describe("Data Sanitization", () => {
    it("should sanitize sensitive fields in request body", async () => {
      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].body.password).toBe("[REDACTED]");
      expect(loggedCall?.[1].body.token).toBe("[REDACTED]");
      expect(loggedCall?.[1].body.name).toBe("John Doe");
    });

    it("should sanitize sensitive fields in response body", async () => {
      mockContext.set.body = {
        id: "123",
        name: "John Doe",
        token: "response-token",
        secret: "response-secret",
      };

      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Outgoing response"
      );

      expect(loggedCall?.[1].body.token).toBe("[REDACTED]");
      expect(loggedCall?.[1].body.secret).toBe("[REDACTED]");
      expect(loggedCall?.[1].body.name).toBe("John Doe");
    });

    it("should sanitize sensitive headers", async () => {
      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].headers.authorization).toBe("[REDACTED]");
      expect(loggedCall?.[1].headers["user-agent"]).toBe("test-agent/1.0");
    });

    it("should sanitize sensitive query parameters", async () => {
      mockContext.request.url = "/api/users?token=secret-token&filter=active";

      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].url).toContain("token=%5BREDACTED%5D");
      expect(loggedCall?.[1].url).toContain("filter=active");
    });

    it("should handle deep object sanitization", async () => {
      mockContext.request.body = {
        user: {
          name: "John",
          credentials: {
            password: "secret",
            token: "jwt-token",
          },
        },
        metadata: {
          secret: "api-secret",
        },
      };

      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].body.user.credentials.password).toBe("[REDACTED]");
      expect(loggedCall?.[1].body.user.credentials.token).toBe("[REDACTED]");
      expect(loggedCall?.[1].body.metadata.secret).toBe("[REDACTED]");
      expect(loggedCall?.[1].body.user.name).toBe("John");
    });
  });

  describe("Body Size Limits", () => {
    it("should truncate large request bodies", async () => {
      const largeBody = { data: "x".repeat(2000) };
      mockContext.request.body = largeBody;

      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].body).toMatch(/^\[TRUNCATED - \d+ bytes\]$/);
    });

    it("should handle unparseable bodies", async () => {
      // Create a circular reference that can't be JSON stringified
      const circularObj: Record<string, unknown> = { prop: "value" };
      circularObj.circular = circularObj;
      mockContext.request.body = circularObj;

      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].body).toBe("[UNPARSEABLE]");
    });
  });

  describe("Client Information Extraction", () => {
    it("should extract user agent", async () => {
      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].userAgent).toBe("test-agent/1.0");
    });

    it("should extract client IP from x-forwarded-for", async () => {
      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].ip).toBe("192.168.1.1");
    });

    it("should extract client IP from x-real-ip", async () => {
      delete mockContext.request.headers["x-forwarded-for"];
      mockContext.request.headers["x-real-ip"] = "10.0.0.1";

      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].ip).toBe("10.0.0.1");
    });

    it("should handle multiple IPs in x-forwarded-for", async () => {
      mockContext.request.headers["x-forwarded-for"] =
        "192.168.1.1, 10.0.0.1, 172.16.0.1";

      await middleware["execute"](mockContext, nextFunction);

      const loggedCall = mockLogger.info.mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].ip).toBe("192.168.1.1");
    });
  });

  describe("Configuration Options", () => {
    it("should skip request body logging when disabled", async () => {
      const noBodyMiddleware = new LoggingHttpMiddleware(mockMetricsCollector, {
        logRequestBody: false,
      });

      await noBodyMiddleware["execute"](mockContext, nextFunction);

      const loggedCall = noBodyMiddleware["logger"]["info"].mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].body).toBeUndefined();
    });

    it("should skip response body logging when disabled", async () => {
      const noBodyMiddleware = new LoggingHttpMiddleware(mockMetricsCollector, {
        logResponseBody: false,
      });

      await noBodyMiddleware["execute"](mockContext, nextFunction);

      const loggedCall = noBodyMiddleware["logger"]["info"].mock.calls.find(
        (call: unknown[]) => call[0] === "Outgoing response"
      );

      expect(loggedCall?.[1].body).toBeUndefined();
    });

    it("should skip headers logging when disabled", async () => {
      const noHeadersMiddleware = new LoggingHttpMiddleware(
        mockMetricsCollector,
        {
          logHeaders: false,
        }
      );

      await noHeadersMiddleware["execute"](mockContext, nextFunction);

      const loggedCall = noHeadersMiddleware["logger"]["info"].mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].headers).toBeUndefined();
    });

    it("should skip user agent when disabled", async () => {
      const noUserAgentMiddleware = new LoggingHttpMiddleware(
        mockMetricsCollector,
        {
          includeUserAgent: false,
        }
      );

      await noUserAgentMiddleware["execute"](mockContext, nextFunction);

      const loggedCall = noUserAgentMiddleware["logger"][
        "info"
      ].mock.calls.find((call: unknown[]) => call[0] === "Incoming request");

      expect(loggedCall?.[1].userAgent).toBeUndefined();
    });

    it("should skip client IP when disabled", async () => {
      const noIpMiddleware = new LoggingHttpMiddleware(mockMetricsCollector, {
        includeClientIp: false,
      });

      await noIpMiddleware["execute"](mockContext, nextFunction);

      const loggedCall = noIpMiddleware["logger"]["info"].mock.calls.find(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(loggedCall?.[1].ip).toBeUndefined();
    });
  });

  describe("Path Exclusion", () => {
    it("should exclude specific paths from logging", async () => {
      const paths = ["/health", "/metrics"];

      for (const path of paths) {
        mockContext.request.url = path;
        await middleware["execute"](mockContext, nextFunction);
      }

      // Should not have logged any requests
      const requestLogs = mockLogger.info.mock.calls.filter(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(requestLogs).toHaveLength(0);
    });

    it("should exclude paths with prefixes", async () => {
      mockContext.request.url = "/metrics/detailed";

      await middleware["execute"](mockContext, nextFunction);

      // Should not have logged the request
      const requestLogs = mockLogger.info.mock.calls.filter(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(requestLogs).toHaveLength(0);
    });

    it("should log non-excluded paths", async () => {
      mockContext.path = "/api/users";

      await middleware["execute"](mockContext, nextFunction);

      const requestLogs = mockLogger.info.mock.calls.filter(
        (call: unknown[]) => call[0] === "Incoming request"
      );

      expect(requestLogs).toHaveLength(1);
    });
  });

  describe("Performance Monitoring", () => {
    it("should record request processing duration", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "logging_execution_time",
        expect.any(Number),
        expect.any(Object)
      );
    });

    it("should record successful request logging", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "logging_request_logged",
        1,
        expect.any(Object)
      );
    });

    it("should record error logging", async () => {
      nextFunction.mockRejectedValue(new Error("Test error"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "logging_error_logged",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid maxBodySize", () => {
      expect(() => {
        new LoggingHttpMiddleware(mockMetricsCollector, {
          maxBodySize: -1,
        });
      }).toThrow("Logging maxBodySize must be a non-negative integer");
    });

    it("should reject invalid excludePaths", () => {
      expect(() => {
        new LoggingHttpMiddleware(mockMetricsCollector, {
          excludePaths: ["invalid-path"],
        });
      }).toThrow("Logging excludePaths must start with '/'");
    });

    it("should reject empty excludeHeaders", () => {
      expect(() => {
        new LoggingHttpMiddleware(mockMetricsCollector, {
          excludeHeaders: [""],
        });
      }).toThrow("Logging excludeHeaders cannot contain empty strings");
    });

    it("should reject empty sensitiveFields", () => {
      expect(() => {
        new LoggingHttpMiddleware(mockMetricsCollector, {
          sensitiveFields: [""],
        });
      }).toThrow("Logging sensitiveFields cannot contain empty strings");
    });
  });

  describe("Configuration Presets", () => {
    it("should create development configuration", () => {
      const devConfig = LoggingHttpMiddleware.createDevelopmentConfig();

      expect(devConfig.logLevel).toBe("debug");
      expect(devConfig.logRequestBody).toBe(true);
      expect(devConfig.logResponseBody).toBe(true);
      expect(devConfig.logHeaders).toBe(true);
    });

    it("should create production configuration", () => {
      const prodConfig = LoggingHttpMiddleware.createProductionConfig();

      expect(prodConfig.logLevel).toBe("info");
      expect(prodConfig.logRequestBody).toBe(false);
      expect(prodConfig.logResponseBody).toBe(false);
      expect(prodConfig.logHeaders).toBe(false);
    });

    it("should create audit configuration", () => {
      const auditConfig = LoggingHttpMiddleware.createAuditConfig();

      expect(auditConfig.logRequestBody).toBe(true);
      expect(auditConfig.logResponseBody).toBe(true);
      expect(auditConfig.logHeaders).toBe(true);
      expect(auditConfig.excludePaths).toEqual([]);
    });

    it("should create minimal configuration", () => {
      const minimalConfig = LoggingHttpMiddleware.createMinimalConfig();

      expect(minimalConfig.logLevel).toBe("warn");
      expect(minimalConfig.logRequestBody).toBe(false);
      expect(minimalConfig.includeRequestTiming).toBe(false);
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(50);
    });

    it("should handle concurrent requests", async () => {
      const promises = Array(5)
        .fill(null)
        .map(() => middleware["execute"]({ ...mockContext }, nextFunction));

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });

    it("should preserve request context", async () => {
      const originalRequestId = mockContext.requestId;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.requestId).toBe(originalRequestId);
      expect(mockContext.request.headers["x-request-id"]).toBeDefined();
    });
  });
});
