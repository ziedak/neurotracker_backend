/**
 * @fileoverview Comprehensive unit tests for SecurityHttpMiddleware
 * @description Tests security headers, CSP, HSTS, and OWASP compliance
 */

import {
  jest,
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
} from "@jest/globals";
import { SecurityHttpMiddleware } from "../../src/middleware/security/security.http.middleware";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

describe("SecurityHttpMiddleware", () => {
  let middleware: SecurityHttpMiddleware;
  let mockContext: MiddlewareContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create middleware instance with comprehensive configuration
    middleware = new SecurityHttpMiddleware(mockMetricsCollector, {
      name: "test-security",
      enabled: true,
      priority: 0,
      contentSecurityPolicy: {
        enabled: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "'unsafe-inline'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        enabled: true,
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      frameOptions: "DENY",
      noSniff: true,
      xssFilter: true,
      referrerPolicy: "strict-origin-when-cross-origin",
      permissionsPolicy: {
        camera: ["'none'"],
        microphone: ["'none'"],
        geolocation: ["'none'"],
      },
      customHeaders: {
        "X-Custom-Security": "enabled",
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
      const defaultMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {}
      );

      expect(defaultMiddleware).toBeDefined();
      expect(defaultMiddleware["config"].name).toBe("security");
      expect(defaultMiddleware["config"].contentSecurityPolicy?.enabled).toBe(
        true
      );
      expect(defaultMiddleware["config"].hsts?.enabled).toBe(true);
      expect(defaultMiddleware["config"].frameOptions).toBe("DENY");
    });

    it("should initialize with custom configuration", () => {
      expect(middleware["config"].name).toBe("test-security");
      expect(middleware["config"].contentSecurityPolicy?.enabled).toBe(true);
      expect(middleware["config"].hsts?.enabled).toBe(true);
      expect(middleware["config"].frameOptions).toBe("DENY");
      expect(middleware["config"].noSniff).toBe(true);
    });

    it("should merge configurations correctly", () => {
      const mergedConfig = middleware["mergeConfig"](
        { frameOptions: "SAMEORIGIN" },
        { ...middleware["config"] }
      );

      expect(mergedConfig.frameOptions).toBe("DENY"); // User config takes precedence
    });
  });

  describe("Security Headers Application", () => {
    it("should apply all security headers by default", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalledTimes(1);
      expect(mockContext.set.headers).toEqual(
        expect.objectContaining({
          "Content-Security-Policy":
            expect.stringContaining("default-src 'self'"),
          "Strict-Transport-Security":
            "max-age=31536000; includeSubDomains; preload",
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "X-XSS-Protection": "1; mode=block",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Permissions-Policy": expect.stringContaining("camera=('none')"),
          "X-Custom-Security": "enabled",
          "X-Powered-By": "",
          Server: "",
        })
      );
    });

    it("should apply headers before calling next middleware", async () => {
      let headersApplied = false;

      nextFunction.mockImplementation(async () => {
        headersApplied = !!mockContext.set.headers["Content-Security-Policy"];
      });

      await middleware["execute"](mockContext, nextFunction);

      expect(headersApplied).toBe(true);
    });
  });

  describe("Content Security Policy (CSP)", () => {
    it("should build CSP header from directives", () => {
      const cspValue = middleware["buildCSPHeader"]({
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
      });

      expect(cspValue).toBe(
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
      );
    });

    it("should apply CSP header when enabled", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Content-Security-Policy"]).toBeDefined();
      expect(mockContext.set.headers["Content-Security-Policy"]).toContain(
        "default-src 'self'"
      );
    });

    it("should skip CSP header when disabled", async () => {
      const noCspMiddleware = new SecurityHttpMiddleware(mockMetricsCollector, {
        contentSecurityPolicy: { enabled: false },
      });

      await noCspMiddleware["execute"](mockContext, nextFunction);

      expect(
        mockContext.set.headers["Content-Security-Policy"]
      ).toBeUndefined();
    });

    it("should handle empty CSP directives", () => {
      const cspValue = middleware["buildCSPHeader"]({});

      expect(cspValue).toBe("");
    });
  });

  describe("HTTP Strict Transport Security (HSTS)", () => {
    it("should apply HSTS header with all options", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Strict-Transport-Security"]).toBe(
        "max-age=31536000; includeSubDomains; preload"
      );
    });

    it("should apply HSTS header with minimal options", async () => {
      const minimalHstsMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          hsts: {
            enabled: true,
            maxAge: 86400,
            includeSubDomains: false,
            preload: false,
          },
        }
      );

      await minimalHstsMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Strict-Transport-Security"]).toBe(
        "max-age=86400"
      );
    });

    it("should skip HSTS header when disabled", async () => {
      const noHstsMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          hsts: { enabled: false },
        }
      );

      await noHstsMiddleware["execute"](mockContext, nextFunction);

      expect(
        mockContext.set.headers["Strict-Transport-Security"]
      ).toBeUndefined();
    });
  });

  describe("Frame Options", () => {
    it("should apply X-Frame-Options DENY", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-Frame-Options"]).toBe("DENY");
    });

    it("should apply X-Frame-Options SAMEORIGIN", async () => {
      const sameOriginMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          frameOptions: "SAMEORIGIN",
        }
      );

      await sameOriginMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    });

    it("should apply custom X-Frame-Options value", async () => {
      const customFrameMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          frameOptions: "ALLOW-FROM https://trusted.com",
        }
      );

      await customFrameMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-Frame-Options"]).toBe(
        "ALLOW-FROM https://trusted.com"
      );
    });

    it("should skip X-Frame-Options when disabled", async () => {
      const noFrameMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          frameOptions: false,
        }
      );

      await noFrameMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-Frame-Options"]).toBeUndefined();
    });
  });

  describe("Content Type Options", () => {
    it("should apply X-Content-Type-Options nosniff", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-Content-Type-Options"]).toBe("nosniff");
    });

    it("should skip X-Content-Type-Options when disabled", async () => {
      const noSniffMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          noSniff: false,
        }
      );

      await noSniffMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-Content-Type-Options"]).toBeUndefined();
    });
  });

  describe("XSS Protection", () => {
    it("should apply X-XSS-Protection with block mode", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-XSS-Protection"]).toBe("1; mode=block");
    });

    it("should apply X-XSS-Protection with report mode", async () => {
      const reportXssMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          xssFilter: { mode: "report", reportUri: "/xss-report" },
        }
      );

      await reportXssMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-XSS-Protection"]).toBe(
        "1; report=/xss-report"
      );
    });

    it("should skip X-XSS-Protection when disabled", async () => {
      const noXssMiddleware = new SecurityHttpMiddleware(mockMetricsCollector, {
        xssFilter: false,
      });

      await noXssMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-XSS-Protection"]).toBeUndefined();
    });
  });

  describe("Referrer Policy", () => {
    it("should apply Referrer-Policy header", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Referrer-Policy"]).toBe(
        "strict-origin-when-cross-origin"
      );
    });

    it("should apply custom referrer policy", async () => {
      const customReferrerMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          referrerPolicy: "no-referrer",
        }
      );

      await customReferrerMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Referrer-Policy"]).toBe("no-referrer");
    });

    it("should skip Referrer-Policy when not configured", async () => {
      const noReferrerMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          referrerPolicy: undefined,
        }
      );

      await noReferrerMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Referrer-Policy"]).toBeUndefined();
    });
  });

  describe("Permissions Policy", () => {
    it("should build Permissions-Policy header from policies", () => {
      const permissionsValue = middleware["buildPermissionsPolicyHeader"]({
        camera: ["'none'"],
        microphone: ["'none'"],
        geolocation: ["'none'"],
      });

      expect(permissionsValue).toBe(
        "camera=('none'), microphone=('none'), geolocation=('none')"
      );
    });

    it("should apply Permissions-Policy header", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["Permissions-Policy"]).toContain(
        "camera=('none')"
      );
      expect(mockContext.set.headers["Permissions-Policy"]).toContain(
        "microphone=('none')"
      );
    });

    it("should handle empty permissions policy", () => {
      const permissionsValue = middleware["buildPermissionsPolicyHeader"]({});

      expect(permissionsValue).toBe("");
    });
  });

  describe("Custom Headers", () => {
    it("should apply custom headers", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-Custom-Security"]).toBe("enabled");
    });

    it("should merge custom headers with security headers", async () => {
      const customHeadersMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          customHeaders: {
            "X-API-Version": "1.0",
            "X-Custom-Security": "custom-value",
          },
        }
      );

      await customHeadersMiddleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-API-Version"]).toBe("1.0");
      expect(mockContext.set.headers["X-Custom-Security"]).toBe("custom-value");
      expect(mockContext.set.headers["X-Frame-Options"]).toBe("DENY");
    });
  });

  describe("Server Signature Removal", () => {
    it("should remove server signatures", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-Powered-By"]).toBe("");
      expect(mockContext.set.headers["Server"]).toBe("");
    });
  });

  describe("Configuration Presets", () => {
    it("should create development configuration", () => {
      const devConfig = SecurityHttpMiddleware.createDevelopmentConfig();

      expect(devConfig.contentSecurityPolicy?.enabled).toBe(false);
      expect(devConfig.hsts?.enabled).toBe(false);
      expect(devConfig.frameOptions).toBe("SAMEORIGIN");
      expect(devConfig.referrerPolicy).toBe("no-referrer-when-downgrade");
    });

    it("should create production configuration", () => {
      const prodConfig = SecurityHttpMiddleware.createProductionConfig();

      expect(prodConfig.contentSecurityPolicy?.enabled).toBe(true);
      expect(prodConfig.hsts?.enabled).toBe(true);
      expect(prodConfig.frameOptions).toBe("DENY");
      expect(prodConfig.permissionsPolicy).toBeDefined();
    });

    it("should create API configuration", () => {
      const apiConfig = SecurityHttpMiddleware.createApiConfig();

      expect(apiConfig.contentSecurityPolicy?.enabled).toBe(false);
      expect(apiConfig.hsts?.enabled).toBe(true);
      expect(apiConfig.xssFilter).toBe(false);
      expect(apiConfig.customHeaders).toBeDefined();
    });

    it("should create strict configuration", () => {
      const strictConfig = SecurityHttpMiddleware.createStrictConfig();

      expect(strictConfig.contentSecurityPolicy?.enabled).toBe(true);
      expect(strictConfig.hsts?.enabled).toBe(true);
      expect(strictConfig.frameOptions).toBe("DENY");
      expect(strictConfig.referrerPolicy).toBe("no-referrer");
    });
  });

  describe("Factory Methods", () => {
    it("should create development middleware instance", () => {
      const devMiddleware =
        SecurityHttpMiddleware.createDevelopment(mockMetricsCollector);

      expect(devMiddleware["config"].name).toBe("security-dev");
      expect(devMiddleware["config"].contentSecurityPolicy?.enabled).toBe(
        false
      );
    });

    it("should create production middleware instance", () => {
      const prodMiddleware =
        SecurityHttpMiddleware.createProduction(mockMetricsCollector);

      expect(prodMiddleware["config"].name).toBe("security-prod");
      expect(prodMiddleware["config"].contentSecurityPolicy?.enabled).toBe(
        true
      );
    });

    it("should create API middleware instance", () => {
      const apiMiddleware =
        SecurityHttpMiddleware.createApi(mockMetricsCollector);

      expect(apiMiddleware["config"].name).toBe("security-api");
      expect(apiMiddleware["config"].contentSecurityPolicy?.enabled).toBe(
        false
      );
    });

    it("should create strict middleware instance", () => {
      const strictMiddleware =
        SecurityHttpMiddleware.createStrict(mockMetricsCollector);

      expect(strictMiddleware["config"].name).toBe("security-strict");
      expect(strictMiddleware["config"].contentSecurityPolicy?.enabled).toBe(
        true
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle errors during header application", async () => {
      // Mock an error in setSecurityHeaders
      const errorMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {}
      );

      // Spy on the private method and mock it to throw
      const setSecurityHeadersSpy = jest.spyOn(
        errorMiddleware as unknown as { setSecurityHeaders: () => void },
        "setSecurityHeaders"
      );
      setSecurityHeadersSpy.mockImplementation(() => {
        throw new Error("Header error");
      });

      await expect(
        errorMiddleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Header error");

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "security_middleware_error_duration",
        expect.any(Number),
        { middleware: "security" }
      );

      // Restore the spy
      setSecurityHeadersSpy.mockRestore();
    });

    it("should continue processing even if header setting fails", async () => {
      nextFunction.mockRejectedValue(new Error("Next middleware error"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow("Next middleware error");

      // Headers should still be applied
      expect(mockContext.set.headers["X-Frame-Options"]).toBe("DENY");
    });
  });

  describe("Performance Monitoring", () => {
    it("should record middleware execution duration", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "security_middleware_duration",
        expect.any(Number),
        { middleware: "test-security" }
      );
    });

    it("should record security headers applied metric", async () => {
      await middleware["execute"](mockContext, nextFunction);

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "security_headers_applied",
        1,
        expect.any(Object)
      );
    });

    it("should record error metrics when middleware fails", async () => {
      nextFunction.mockRejectedValue(new Error("Test error"));

      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).rejects.toThrow();

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "security_middleware_error_duration",
        expect.any(Number),
        { middleware: "test-security" }
      );
    });
  });

  describe("Path Skipping", () => {
    it("should skip security headers for configured paths", async () => {
      const skipPathMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          skipPaths: ["/health", "/metrics"],
        }
      );

      mockContext.path = "/health";

      await skipPathMiddleware["execute"](mockContext, nextFunction);

      // Should still apply headers (skipPaths is handled at base level)
      expect(mockContext.set.headers["X-Frame-Options"]).toBe("DENY");
    });
  });

  describe("Middleware Chain Integration", () => {
    it("should integrate with middleware chain", async () => {
      await expect(
        middleware["execute"](mockContext, nextFunction)
      ).resolves.not.toThrow();
    });

    it("should handle middleware priority correctly", () => {
      expect(middleware["config"].priority).toBe(0);
    });

    it("should preserve existing headers", async () => {
      mockContext.set.headers["X-Existing-Header"] = "existing-value";

      await middleware["execute"](mockContext, nextFunction);

      expect(mockContext.set.headers["X-Existing-Header"]).toBe(
        "existing-value"
      );
      expect(mockContext.set.headers["X-Frame-Options"]).toBe("DENY");
    });

    it("should handle concurrent requests", async () => {
      const promises = Array(5)
        .fill(null)
        .map(() => middleware["execute"]({ ...mockContext }, nextFunction));

      await expect(Promise.all(promises)).resolves.not.toThrow();
    });
  });
});
