/**
 * @fileoverview Comprehensive unit tests for CorsHttpMiddleware
 * @description Tests CORS headers, preflight requests, and cross-origin handling
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { CorsHttpMiddleware } from "../../src/middleware/cors/cors.http.middleware";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("CorsHttpMiddleware", () => {
  let middleware: CorsHttpMiddleware;
  let mockContext: MiddlewareContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance with comprehensive configuration
    middleware = new CorsHttpMiddleware(mockMetricsCollector, {
      name: "test-cors",
      enabled: true,
      priority: 1,
      origin: ["https://example.com", "https://app.example.com"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      exposedHeaders: ["X-Custom-Header", "X-Request-ID"],
      credentials: true,
      maxAge: 86400,
      optionsSuccessStatus: 204,
    });

    // Create mock context
    mockContext = {
      requestId: "test-request-123",
      request: {
        method: "GET",
        url: "/api/users",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,authorization",
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
      const defaultMiddleware = new CorsHttpMiddleware(mockMetricsCollector);

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("cors");
      expect(defaultMiddleware["config"].origin).toBe("*");
      expect(defaultMiddleware["config"].methods).toEqual([
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "OPTIONS",
      ]);
      expect(defaultMiddleware["config"].credentials).toBe(true);
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-cors");
      expect(middleware["config"].origin).toEqual([
        "https://example.com",
        "https://app.example.com",
      ]);
      expect(middleware["config"].credentials).toBe(true);
      expect(middleware["config"].maxAge).toBe(86400);
    });

    it("should validate configuration on initialization", () => {
      expect(() => {
        new CorsHttpMiddleware(mockMetricsCollector, {
          maxAge: -1, // Invalid
        });
      }).toThrow("CORS maxAge must be a non-negative integer");
    });
  });

  describe("Preflight Request Handling", () => {
    it("should handle OPTIONS preflight requests", async () => {
      mockContext.request.method = "OPTIONS";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.status).toBe(204);
      expect(mockContext.set.headers).toEqual(
        expect.objectContaining({
          "Access-Control-Allow-Origin": "https://example.com",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, X-Requested-With",
          "Access-Control-Max-Age": "86400",
        })
      );

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cors_preflight_handled",
        1,
        expect.any(Object)
      );
    });

    it("should handle preflight with multiple requested headers", async () => {
      mockContext.request.method = "OPTIONS";
      mockContext.request.headers["access-control-request-headers"] =
        "content-type,authorization,x-custom-header";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Headers"]).toBe(
        "Content-Type, Authorization, X-Requested-With"
      );
    });

    it("should handle preflight with wildcard origin", async () => {
      const wildcardMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        origin: "*",
      });

      mockContext.request.method = "OPTIONS";
      delete mockContext.request.headers.origin;

      await wildcardMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe("*");
    });

    it("should reject preflight from disallowed origin", async () => {
      mockContext.request.method = "OPTIONS";
      mockContext.request.headers.origin = "https://malicious.com";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Origin not allowed");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cors_origin_rejected",
        1,
        expect.any(Object)
      );
    });
  });

  describe("CORS Headers for Regular Requests", () => {
    it("should add CORS headers to regular GET request", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers).toEqual(
        expect.objectContaining({
          "Access-Control-Allow-Origin": "https://example.com",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Expose-Headers": "X-Custom-Header, X-Request-ID",
        })
      );

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cors_headers_added",
        1,
        expect.any(Object)
      );
    });

    it("should add CORS headers to POST request", async () => {
      mockContext.request.method = "POST";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe(
        "https://example.com"
      );
      expect(mockContext.set.headers["Access-Control-Allow-Credentials"]).toBe(
        "true"
      );
    });

    it("should handle requests without origin header", async () => {
      delete mockContext.request.headers.origin;

      await middleware["execute"](mockContext, nextFunction);

      // Should still add some CORS headers but not origin-specific ones
      expect(mockContext.set.headers).toEqual(
        expect.objectContaining({
          "Access-Control-Expose-Headers": "X-Custom-Header, X-Request-ID",
        })
      );
    });

    it("should handle wildcard origin configuration", async () => {
      const wildcardMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        origin: "*",
        credentials: false, // Must be false with wildcard
      });

      await wildcardMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe("*");
      expect(
        mockContext.set.headers["Access-Control-Allow-Credentials"]
      ).toBeUndefined();
    });
  });

  describe("Origin Validation", () => {
    it("should allow requests from configured origins", async () => {
      mockContext.request.headers.origin = "https://app.example.com";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe(
        "https://app.example.com"
      );
    });

    it("should reject requests from disallowed origins", async () => {
      mockContext.request.headers.origin = "https://evil.com";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Origin not allowed");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cors_origin_rejected",
        1,
        expect.any(Object)
      );
    });

    it("should handle origin with port number", async () => {
      const portMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        origin: ["https://example.com:8080"],
      });

      mockContext.request.headers.origin = "https://example.com:8080";

      await portMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe(
        "https://example.com:8080"
      );
    });

    it("should handle localhost origins for development", async () => {
      const devMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
      });

      mockContext.request.headers.origin = "http://localhost:3000";

      await devMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe(
        "http://localhost:3000"
      );
    });
  });

  describe("Method Validation", () => {
    it("should allow configured HTTP methods", async () => {
      const methods = ["GET", "POST", "PUT", "DELETE"];

      for (const method of methods) {
        mockContext.request.method = method;
        await middleware["execute"](mockContext, nextFunction);
        expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe(
          "https://example.com"
        );
      }
    });

    it("should reject disallowed HTTP methods in preflight", async () => {
      mockContext.request.method = "OPTIONS";
      mockContext.request.headers["access-control-request-method"] = "PATCH";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Method not allowed");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cors_method_rejected",
        1,
        expect.any(Object)
      );
    });

    it("should handle case-insensitive method matching", async () => {
      mockContext.request.method = "OPTIONS";
      mockContext.request.headers["access-control-request-method"] = "post";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Methods"]).toBe(
        "GET, POST, PUT, DELETE, OPTIONS"
      );
    });
  });

  describe("Header Validation", () => {
    it("should allow configured headers", async () => {
      mockContext.request.method = "OPTIONS";
      mockContext.request.headers["access-control-request-headers"] =
        "content-type,authorization";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Headers"]).toBe(
        "Content-Type, Authorization, X-Requested-With"
      );
    });

    it("should reject disallowed headers in preflight", async () => {
      mockContext.request.method = "OPTIONS";
      mockContext.request.headers["access-control-request-headers"] =
        "x-disallowed-header";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Header not allowed");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cors_header_rejected",
        1,
        expect.any(Object)
      );
    });

    it("should handle multiple headers in request", async () => {
      mockContext.request.method = "OPTIONS";
      mockContext.request.headers["access-control-request-headers"] =
        "content-type, authorization, x-requested-with";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Headers"]).toBe(
        "Content-Type, Authorization, X-Requested-With"
      );
    });
  });

  describe("Credentials Handling", () => {
    it("should include credentials header when enabled", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Credentials"]).toBe(
        "true"
      );
    });

    it("should not include credentials header when disabled", async () => {
      const noCredentialsMiddleware = new CorsHttpMiddleware(
        mockMetricsCollector,
        {
          credentials: false,
        }
      );

      await noCredentialsMiddleware["execute"](mockContext, nextFunction);

      expect(
        mockContext.set.headers["Access-Control-Allow-Credentials"]
      ).toBeUndefined();
    });

    it("should enforce no credentials with wildcard origin", async () => {
      expect(() => {
        new CorsHttpMiddleware(mockMetricsCollector, {
          origin: "*",
          credentials: true, // This should fail
        });
      }).toThrow("Cannot use credentials with wildcard origin");
    });
  });

  describe("Cache Configuration", () => {
    it("should set cache max-age for preflight requests", async () => {
      mockContext.request.method = "OPTIONS";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Max-Age"]).toBe("86400");
    });

    it("should handle zero max-age", async () => {
      const noCacheMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        maxAge: 0,
      });

      mockContext.request.method = "OPTIONS";

      await noCacheMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.request.method).toBe("OPTIONS");
      expect(mockContext.set.headers["Access-Control-Max-Age"]).toBe("0");
    });

    it("should handle very large max-age", async () => {
      const longCacheMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        maxAge: 31536000, // 1 year
      });

      mockContext.request.method = "OPTIONS";

      await longCacheMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Max-Age"]).toBe(
        "31536000"
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed origin header", async () => {
      mockContext.request.headers.origin = "not-a-valid-url";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Invalid origin format");

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cors_invalid_origin",
        1,
        expect.any(Object)
      );
    });

    it("should handle missing headers in preflight", async () => {
      mockContext.request.method = "OPTIONS";
      delete mockContext.request.headers["access-control-request-method"];

      await middleware["execute"](mockContext, nextFunction);

      // Should still handle the request but with default behavior
      expect(mockContext.set.status).toBe(204);
    });

    it("should handle case sensitivity in headers", async () => {
      mockContext.request.headers["ORIGIN"] = "https://example.com";
      delete mockContext.request.headers.origin;

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe(
        "https://example.com"
      );
    });
  });

  describe("Performance Monitoring", () => {
    it("should record CORS processing duration", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "cors_request_duration",
        expect.any(Number),
        expect.any(Object)
      );
    });

    it("should record successful CORS requests", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cors_request_success",
        1,
        expect.any(Object)
      );
    });

    it("should record CORS failures", async () => {
      mockContext.request.headers.origin = "https://evil.com";

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "cors_request_failure",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Configuration Validation", () => {
    it("should reject invalid maxAge", () => {
      expect(() => {
        new CorsHttpMiddleware(mockMetricsCollector, {
          maxAge: -1,
        });
      }).toThrow("CORS maxAge must be a non-negative integer");
    });

    it("should reject invalid optionsSuccessStatus", () => {
      expect(() => {
        new CorsHttpMiddleware(mockMetricsCollector, {
          optionsSuccessStatus: 300, // Not 200-299
        });
      }).toThrow("CORS optionsSuccessStatus must be between 200 and 299");
    });

    it("should reject empty methods", () => {
      expect(() => {
        new CorsHttpMiddleware(mockMetricsCollector, {
          methods: [],
        });
      }).toThrow("CORS methods array cannot be empty");
    });

    it("should reject empty allowedHeaders", () => {
      expect(() => {
        new CorsHttpMiddleware(mockMetricsCollector, {
          allowedHeaders: [""],
        });
      }).toThrow("CORS allowed headers cannot contain empty strings");
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(1);
    });

    it("should not interfere with non-CORS headers", async () => {
      mockContext.set.headers["x-custom-header"] = "custom-value";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["x-custom-header"]).toBe("custom-value");
      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe(
        "https://example.com"
      );
    });
  });
});
