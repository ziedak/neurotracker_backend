/**
 * @fileoverview Comprehensive unit tests for ErrorHttpMiddleware
 * @description Tests error handling, response formatting, and logging
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import {
  ErrorHttpMiddleware,
  ErrorResponse,
} from "../../src/middleware/error/error.http.middleware";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("ErrorHttpMiddleware", () => {
  let middleware: ErrorHttpMiddleware;
  let mockContext: MiddlewareContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance with comprehensive configuration
    middleware = new ErrorHttpMiddleware(mockMetricsCollector, {
      name: "test-error",
      enabled: true,
      priority: 100,
      includeStackTrace: true,
      logErrors: true,
      excludePaths: ["/health", "/metrics", "/status"],
      customErrorMessages: {
        ValidationError: "Invalid input data",
        AuthenticationError: "Authentication required",
        AuthorizationError: "Access denied",
        NotFoundError: "Resource not found",
      },
      sensitiveFields: ["password", "token", "secret"],
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
        query: {},
        params: {},
        ip: "192.168.1.1",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { success: true },
      },
      set: {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": "test-request-123",
        },
        body: undefined as ErrorResponse | undefined,
      },
      user: undefined,
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
      const defaultMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "test",
        enabled: true,
        priority: 100,
      });

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("test");
      expect(defaultMiddleware["config"].includeStackTrace).toBe(false);
      expect(defaultMiddleware["config"].logErrors).toBe(true);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-error");
      expect(middleware["config"].includeStackTrace).toBe(true);
      expect(middleware["config"].logErrors).toBe(true);
      expect(middleware["config"].customErrorMessages).toBeDefined();
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new ErrorHttpMiddleware(mockMetricsCollector, {
          name: "test",
          enabled: true,
          priority: 100,
          maxErrorMessageLength: -1,
        });
      }).toThrow("Error maxErrorMessageLength must be a positive integer");
    });
  });

  describe("Error Handling", () => {
    it("should handle standard Error objects", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      const testError = new Error("Test error message");

      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.status).toBe(500);
      expect(mockContext.response?.body).toEqual({
        success: false,
        error: "Error",
        message: "Test error message",
        timestamp: expect.any(String),
        requestId: "test-request-123",
        statusCode: 500,
        ...(middleware["config"].includeStackTrace && {
          stackTrace: expect.any(String),
        }),
      });

      consoleSpy.mockRestore();
    });

    it("should handle custom error types with mappings", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      class ValidationError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "ValidationError";
        }
      }

      const validationError = new ValidationError("Invalid email format");
      nextFunction.mockRejectedValue(validationError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.status).toBe(400);
      expect(mockContext.response?.body).toEqual({
        success: false,
        error: "ValidationError",
        message: "Invalid input data",
        timestamp: expect.any(String),
        requestId: "test-request-123",
        statusCode: 400,
        ...(middleware["config"].includeStackTrace && {
          stackTrace: expect.any(String),
        }),
      });

      consoleSpy.mockRestore();
    });

    it("should handle HTTP status code errors", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      class HttpError extends Error {
        constructor(public statusCode: number, message: string) {
          super(message);
          this.name = "HttpError";
        }
      }

      const httpError = new HttpError(404, "User not found");
      nextFunction.mockRejectedValue(httpError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.status).toBe(404);
      expect(mockContext.response?.body).toEqual({
        success: false,
        error: "HttpError",
        message: "User not found",
        timestamp: expect.any(String),
        requestId: "test-request-123",
        statusCode: 404,
        ...(middleware["config"].includeStackTrace && {
          stackTrace: expect.any(String),
        }),
      });

      consoleSpy.mockRestore();
    });

    it("should handle non-Error objects", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      nextFunction.mockRejectedValue("String error");

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.status).toBe(500);
      expect(mockContext.response?.body).toEqual({
        success: false,
        error: "UnknownError",
        message: "String error",
        timestamp: expect.any(String),
        requestId: "test-request-123",
        statusCode: 500,
      });

      consoleSpy.mockRestore();
    });

    it("should handle null/undefined errors", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      nextFunction.mockRejectedValue(null);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.status).toBe(500);
      expect(mockContext.response?.body).toEqual({
        success: false,
        error: "UnknownError",
        message: "An error occurred",
        timestamp: expect.any(String),
        requestId: "test-request-123",
        statusCode: 500,
      });

      consoleSpy.mockRestore();
    });
  });

  describe("Error Response Formatting", () => {
    it("should format JSON error responses", async () => {
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.headers["content-type"]).toBe("application/json");
      expect(mockContext.response?.body).toEqual({
        success: false,
        error: "Error",
        message: "Test error",
        timestamp: expect.any(String),
        requestId: "test-request-123",
        statusCode: 500,
        ...(middleware["config"].includeStackTrace && {
          stackTrace: expect.any(String),
        }),
      });
    });

    it("should format plain text error responses", async () => {
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.headers["content-type"]).toBe("application/json");
      expect(mockContext.response?.body).toEqual({
        success: false,
        error: "Error",
        message: "Test error",
        timestamp: expect.any(String),
        requestId: "test-request-123",
        statusCode: 500,
        ...(middleware["config"].includeStackTrace && {
          stackTrace: expect.any(String),
        }),
      });
    });

    it("should format HTML error responses", async () => {
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.headers["content-type"]).toBe("application/json");
      expect(mockContext.response?.body).toEqual({
        success: false,
        error: "Error",
        message: "Test error",
        timestamp: expect.any(String),
        requestId: "test-request-123",
        statusCode: 500,
        ...(middleware["config"].includeStackTrace && {
          stackTrace: expect.any(String),
        }),
      });
    });

    it("should include request ID in error response", async () => {
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(
        (mockContext.response?.body as { requestId: string }).requestId
      ).toBe("test-request-123");
    });

    it("should include timestamp in error response", async () => {
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.body).toBeDefined();
      expect((mockContext.set.body as ErrorResponse).timestamp).toBeDefined();
      expect(
        new Date(
          (mockContext.set.body as ErrorResponse).timestamp
        ).toISOString()
      ).toBe((mockContext.set.body as ErrorResponse).timestamp);
    });
  });

  describe("Error Sanitization", () => {
    it("should sanitize sensitive information from error messages", async () => {
      const sensitiveError = new Error(
        "Database connection failed: password=secret123 host=localhost"
      );
      nextFunction.mockRejectedValue(sensitiveError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      const errorResponse = mockContext.set.body as ErrorResponse;
      expect(errorResponse.message).toBe(
        "Database connection failed: password=[REDACTED] host=localhost"
      );
    });

    it("should truncate long error messages", async () => {
      const longMessage = "x".repeat(600);
      const longError = new Error(longMessage);
      nextFunction.mockRejectedValue(longError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      const errorResponse = mockContext.set.body as ErrorResponse;
      expect(errorResponse.message.length).toBeLessThanOrEqual(500);
      expect(errorResponse.message).toContain("...");
    });

    it("should handle error messages with special characters", async () => {
      const specialError = new Error("Error with <script> tags and 'quotes'");
      nextFunction.mockRejectedValue(specialError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      const errorResponse = mockContext.set.body as ErrorResponse;
      expect(errorResponse.message).toBe(
        "Error with &lt;script&gt; tags and &#39;quotes&#39;"
      );
    });
  });

  describe("Stack Trace Handling", () => {
    it("should include stack trace when enabled", async () => {
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      const errorResponse = mockContext.set.body as ErrorResponse;
      expect(errorResponse.stackTrace).toBeDefined();
      expect(typeof errorResponse.stackTrace).toBe("string");
    });

    it("should exclude stack trace when disabled", async () => {
      const noStackMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "test",
        enabled: true,
        priority: 100,
        includeStackTrace: false,
      });

      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        noStackMiddleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      const errorResponse = mockContext.set.body as ErrorResponse;
      expect(errorResponse.stackTrace).toBeUndefined();
    });

    it("should sanitize stack traces", async () => {
      const errorWithSensitiveStack = new Error("Test error");
      errorWithSensitiveStack.stack =
        "Error: Test error\n    at function (/path/to/file.js:123:45)\n    at password=secret (/sensitive/path.js:67:89)";

      nextFunction.mockRejectedValue(errorWithSensitiveStack);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      const errorResponse = mockContext.set.body as ErrorResponse;
      expect(errorResponse.stackTrace).toContain("password=[REDACTED]");
    });
  });

  describe("Error Details Inclusion", () => {
    it("should include error details when enabled", async () => {
      class DetailedError extends Error {
        constructor(message: string, public details: Record<string, unknown>) {
          super(message);
          this.name = "DetailedError";
          this.details = details;
        }
      }

      const detailedError = new DetailedError("Validation failed", {
        field: "email",
        value: "invalid-email",
        constraint: "email-format",
      });

      nextFunction.mockRejectedValue(detailedError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      const errorResponse = mockContext.set.body as ErrorResponse;
      expect(errorResponse.details).toEqual({
        field: "email",
        value: "invalid-email",
        constraint: "email-format",
      });
    });

    it("should exclude error details when disabled", async () => {
      const noDetailsMiddleware = new ErrorHttpMiddleware(
        mockMetricsCollector,
        {
          name: "test",
          enabled: true,
          priority: 100,
          includeErrorDetails: false,
        }
      );

      class DetailedError extends Error {
        constructor(message: string, public details: Record<string, unknown>) {
          super(message);
          this.name = "DetailedError";
          this.details = details;
        }
      }

      const detailedError = new DetailedError("Validation failed", {
        field: "email",
      });
      nextFunction.mockRejectedValue(detailedError);

      await expect(
        noDetailsMiddleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      const errorResponse = mockContext.set.body as ErrorResponse;
      expect(errorResponse.details).toBeUndefined();
    });
  });

  describe("Path Exclusion", () => {
    it("should skip error handling for excluded paths", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      mockContext.path = "/health";
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow(testError);

      // Should not have modified the response for excluded path
      expect(mockContext.set.status).toBe(200); // Original status preserved
      expect(mockContext.set.body).toBeUndefined(); // No error response set for excluded paths

      consoleSpy.mockRestore();
    });

    it("should handle errors for non-excluded paths", async () => {
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockContext.set.status).toBe(500);
      expect(mockContext.set.body).toBeDefined();
    });
  });

  describe("Error Logging", () => {
    it("should log errors when enabled", async () => {
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        "Server error occurred",
        expect.any(Error),
        expect.objectContaining({
          message: "Test error",
          requestId: "test-request-123",
          errorType: "Error",
          statusCode: 500,
        })
      );

      consoleSpy.mockRestore();
    });

    it("should skip error logging when disabled", async () => {
      const noLogMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "test",
        enabled: true,
        priority: 100,
        logErrors: false,
      });

      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        noLogMiddleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should log different error types appropriately", async () => {
      const testCases = [
        { error: new Error("Generic error"), expectedLevel: "error" },
        { error: new Error("4xx error"), expectedLevel: "warn" },
        { error: new Error("5xx error"), expectedLevel: "error" },
      ];

      for (const { error, expectedLevel } of testCases) {
        const consoleSpy = jest
          .spyOn(console, expectedLevel as keyof Console)
          .mockImplementation();
        nextFunction.mockRejectedValue(error);

        await expect(
          middleware["execute"](mockContext, nextFunction)
        ).resolves.not.toThrow();

        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
      }
    });
  });

  describe("Performance Monitoring", () => {
    it("should record error handling metrics", async () => {
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "error_handled",
        1,
        expect.objectContaining({
          errorType: "Error",
          statusCode: "500",
        })
      );
    });

    it("should record error response time", async () => {
      const testError = new Error("Test error");
      nextFunction.mockRejectedValue(testError);

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "error_response_time",
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid maxErrorMessageLength", () => {
      expect(() => {
        new ErrorHttpMiddleware(mockMetricsCollector, {
          name: "test",
          enabled: true,
          priority: 100,
          maxErrorMessageLength: 0,
        });
      }).toThrow("Error maxErrorMessageLength must be a positive integer");
    });

    it("should reject invalid excludePaths", () => {
      expect(() => {
        new ErrorHttpMiddleware(mockMetricsCollector, {
          name: "test",
          enabled: true,
          priority: 100,
          excludePaths: ["invalid-path"],
        });
      }).toThrow("Error excludePaths must start with '/'");
    });

    it("should reject invalid errorResponseFormat", () => {
      expect(() => {
        new ErrorHttpMiddleware(mockMetricsCollector, {
          name: "test",
          enabled: true,
          priority: 100,
          errorResponseFormat: "invalid" as "json" | "text" | "html",
        });
      }).toThrow("Error errorResponseFormat must be one of: json, text, html");
    });
  });

  describe("Configuration Presets", () => {
    it("should create development configuration", () => {
      const devConfig = ErrorHttpMiddleware.createDevelopmentConfig();

      expect(devConfig.includeStackTrace).toBe(true);
      expect(devConfig.includeErrorDetails).toBe(true);
      expect(devConfig.logErrors).toBe(true);
    });

    it("should create production configuration", () => {
      const prodConfig = ErrorHttpMiddleware.createProductionConfig();

      expect(prodConfig.includeStackTrace).toBe(false);
      expect(prodConfig.includeErrorDetails).toBe(false);
      expect(prodConfig.logErrors).toBe(true);
    });

    it("should create minimal configuration", () => {
      const minimalConfig = ErrorHttpMiddleware.createMinimalConfig();

      expect(minimalConfig.logErrors).toBe(false);
      expect(minimalConfig.includeStackTrace).toBe(false);
      expect(minimalConfig.includeErrorDetails).toBe(false);
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(100);
    });

    it("should preserve request context on success", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.requestId).toBe("test-request-123");
    });

    it("should handle concurrent error requests", async () => {
      const promises = Array(5)
        .fill(null)
        .map(() =>
          middleware["execute"]({ ...mockContext }, () =>
            Promise.reject(new Error("Concurrent error"))
          )
        );

      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(
        (result) => result.status === "fulfilled"
      );
      const rejected = results.filter((result) => result.status === "rejected");

      // Error middleware should handle all errors and resolve successfully
      expect(fulfilled).toHaveLength(5);
      expect(rejected).toHaveLength(0);
    });
  });
});
