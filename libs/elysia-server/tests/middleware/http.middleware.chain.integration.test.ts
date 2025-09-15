/**
 * @fileoverview HTTP Middleware Chain Integration Tests
 * @description Tests multiple middleware working together in realistic scenarios
 */

import { HttpMiddlewareChain } from "../../src/middleware/base/middlewareChain/httpMiddlewareChain";
import { CorsHttpMiddleware } from "../../src/middleware/cors/cors.http.middleware";
import { SecurityHttpMiddleware } from "../../src/middleware/security/security.http.middleware";
import { RateLimitHttpMiddleware } from "../../src/middleware/rateLimit/rateLimit.http.Middleware";
import { LoggingHttpMiddleware } from "../../src/middleware/logging/logging.http.middleware";
import { ErrorHttpMiddleware } from "../../src/middleware/error/error.http.middleware";
import { AuthHttpMiddleware } from "../../src/middleware/auth/auth.http.middleware";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";
import { ChainFactory } from "../../src/middleware";

// Mock external dependencies
jest.mock("@libs/monitoring");
jest.mock("@libs/auth");

const mockMetricsCollector = {
  recordCounter: jest.fn(),
  recordTimer: jest.fn(),
  recordGauge: jest.fn(),
} as jest.Mocked<IMetricsCollector>;

const mockAuthService = {
  verifyToken: jest.fn(),
  getUserById: jest.fn(),
  can: jest.fn(),
  getJWTService: jest.fn().mockReturnValue({
    extractTokenFromHeader: jest.fn().mockReturnValue("test-token"),
  }),
  getApiKeyService: jest.fn().mockReturnValue({
    validateApiKey: jest.fn().mockResolvedValue({
      id: "api_key_123",
      userId: "user_123",
      permissions: ["api:read"],
    }),
  }),
  getPermissionService: jest.fn().mockReturnValue({
    createAuthContext: jest.fn().mockReturnValue({
      user: { id: "user_123", roles: ["user"], permissions: ["api:read"] },
      permissions: ["api:read"],
      roles: ["user"],
    }),
  }),
};

describe("HTTP Middleware Chain Integration Tests", () => {
  let mockContext: MiddlewareContext;
  let nextFunction: jest.MockedFunction<() => Promise<void>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      requestId: "req_123",
      request: {
        method: "POST",
        url: "https://api.example.com/api/users",
        headers: {
          origin: "https://app.example.com",
          "content-type": "application/json",
          authorization: "Bearer test-token",
          "user-agent": "test-client/1.0",
          "x-forwarded-for": "192.168.1.100",
        },
        body: { name: "John Doe", email: "john@example.com" },
        query: {},
        params: {},
        ip: "192.168.1.100",
      },
      response: {
        status: 200,
        headers: {},
        body: undefined,
      },
      set: {
        status: 200,
        headers: {},
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

  describe("CORS + Security + Rate Limiting Chain", () => {
    it("should handle successful request through complete middleware chain", async () => {
      // Create middleware chain with proper priorities
      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "cors-security-rateLimit-test",
      });

      const corsMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        name: "cors",
        enabled: true,
        priority: 100,
        allowedOrigins: ["https://app.example.com"],
        allowedMethods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["content-type", "authorization"],
        credentials: true,
      });

      const securityMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          name: "security",
          enabled: true,
          priority: 90,
          customHeaders: {
            "X-Frame-Options": "DENY",
            "X-Content-Type-Options": "nosniff",
            "X-XSS-Protection": "1; mode=block",
            "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
          },
        }
      );

      const rateLimitMiddleware = new RateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          name: "rateLimit",
          enabled: true,
          priority: 80,
          windowMs: 60000,
          maxRequests: 100,
          keyStrategy: "ip" as const,
        }
      );

      // Add middleware to chain - correct API: (name, middleware, priority)
      chain.add("cors", corsMiddleware.middleware(), 100);
      chain.add("security", securityMiddleware.middleware(), 90);
      chain.add("rateLimit", rateLimitMiddleware.middleware(), 80);

      // Execute the chain
      const chainMiddleware = chain.execute();
      await chainMiddleware(mockContext, nextFunction);

      // Verify next was called (request completed successfully)
      expect(nextFunction).toHaveBeenCalled();

      // Verify CORS headers were set
      expect(mockContext.set.headers).toEqual(
        expect.objectContaining({
          "Access-Control-Allow-Origin": "https://app.example.com",
          "Access-Control-Allow-Credentials": "true",
        })
      );

      // Verify security headers were set
      expect(mockContext.set.headers).toEqual(
        expect.objectContaining({
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "X-XSS-Protection": "1; mode=block",
          "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        })
      );

      // Verify metrics were recorded for each middleware
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "middleware_executed",
        1,
        expect.objectContaining({ name: "cors" })
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "middleware_executed",
        1,
        expect.objectContaining({ name: "security" })
      );
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "middleware_executed",
        1,
        expect.objectContaining({ name: "rateLimit" })
      );
    });

    it("should handle CORS preflight request properly", async () => {
      // Modify context for preflight request
      mockContext.request.method = "OPTIONS";
      mockContext.request.headers = {
        origin: "https://app.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      };

      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "preflight-test",
      });

      const corsMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        name: "cors",
        enabled: true,
        priority: 100,
        allowedOrigins: ["https://app.example.com"],
        allowedMethods: ["GET", "POST", "PUT", "DELETE"],
        allowedHeaders: ["content-type", "authorization"],
        credentials: true,
      });

      chain.add(
        corsMiddleware.getName(),
        corsMiddleware.middleware(),
        corsMiddleware.getPriority()
      );

      const chainMiddleware = chain.execute();
      await chainMiddleware(mockContext, nextFunction);

      // For preflight requests, next should still be called
      expect(nextFunction).toHaveBeenCalled();

      // Verify preflight response headers
      expect(mockContext.set.headers).toEqual(
        expect.objectContaining({
          "Access-Control-Allow-Origin": "https://app.example.com",
          "Access-Control-Allow-Methods": expect.stringContaining("POST"),
          "Access-Control-Allow-Headers":
            expect.stringContaining("content-type"),
          "Access-Control-Allow-Credentials": "true",
        })
      );
    });

    it("should block request with invalid origin", async () => {
      mockContext.request.headers.origin = "https://malicious-site.com";

      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "invalid-origin-test",
      });

      const corsMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        name: "cors",
        enabled: true,
        priority: 100,
        allowedOrigins: ["https://app.example.com"],
        allowedMethods: ["GET", "POST"],
        credentials: true,
      });

      chain.add(
        corsMiddleware.getName(),
        corsMiddleware.middleware(),
        corsMiddleware.getPriority()
      );

      const chainMiddleware = chain.execute();

      // CORS middleware should not block by default, but should not set CORS headers
      await chainMiddleware(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      // Should not have CORS headers for invalid origin
      expect(
        mockContext.set.headers["Access-Control-Allow-Origin"]
      ).toBeUndefined();
    });
  });

  describe("Auth + Error Handling Chain", () => {
    it("should handle authentication flow with error handling", async () => {
      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "auth-error-test",
      });

      const errorMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "error",
        enabled: true,
        priority: 1000, // Highest priority to catch all errors
        includeStackTrace: false,
        logErrors: true,
      });

      const authMiddleware = new AuthHttpMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "auth",
          enabled: true,
          priority: 70,
          requireAuth: true,
          skipPaths: ["/health"],
          permissions: ["api:read"],
        }
      );

      chain.add(
        errorMiddleware.getName(),
        errorMiddleware.middleware(),
        errorMiddleware.getPriority()
      );
      chain.add(
        authMiddleware.getName(),
        authMiddleware.middleware(),
        authMiddleware.getPriority()
      );

      // Mock successful authentication
      mockAuthService.verifyToken.mockResolvedValue({
        id: "user_123",
        roles: ["user"],
        permissions: ["api:read"],
      });

      const chainMiddleware = chain.execute();
      await chainMiddleware(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(mockContext.authenticated).toBe(true);
      expect(mockContext.user).toBeDefined();
    });

    it("should handle authentication failure with proper error response", async () => {
      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "auth-fail-test",
      });

      const errorMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "error",
        enabled: true,
        priority: 1000,
        includeStackTrace: false,
        logErrors: true,
      });

      const authMiddleware = new AuthHttpMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "auth",
          enabled: true,
          priority: 70,
          requireAuth: true,
          permissions: ["api:read"],
        }
      );

      chain.add(
        errorMiddleware.getName(),
        errorMiddleware.middleware(),
        errorMiddleware.getPriority()
      );
      chain.add(
        authMiddleware.getName(),
        authMiddleware.middleware(),
        authMiddleware.getPriority()
      );

      // Mock authentication failure
      mockAuthService.verifyToken.mockRejectedValue(new Error("Invalid token"));

      const chainMiddleware = chain.execute();
      await chainMiddleware(mockContext, nextFunction);

      // Next should still be called (error middleware handles the error)
      expect(nextFunction).toHaveBeenCalled();

      // Should have error response
      expect(mockContext.set.status).toBe(401);
      expect(mockContext.response?.body).toEqual(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
          message: expect.any(String),
        })
      );
    });
  });

  describe("Complete Production-Ready Chain", () => {
    it("should handle request through full production middleware stack", async () => {
      const chain = ChainFactory.createHttpChain(
        mockMetricsCollector,
        "production-stack",
        [
          {
            name: "error",
            middleware: new ErrorHttpMiddleware(mockMetricsCollector, {
              name: "error",
              enabled: true,
              priority: 1000,
              includeStackTrace: false,
              logErrors: true,
            }),
            priority: 1000,
            enabled: true,
          },
          {
            name: "logging",
            middleware: new LoggingHttpMiddleware(mockMetricsCollector, {
              name: "logging",
              enabled: true,
              priority: 90,
              logLevel: "info",
              logHeaders: true,
              logRequestBody: false,
              sensitiveFields: ["authorization"],
            }),
            priority: 90,
            enabled: true,
          },
          {
            name: "cors",
            middleware: new CorsHttpMiddleware(mockMetricsCollector, {
              name: "cors",
              enabled: true,
              priority: 80,
              allowedOrigins: ["https://app.example.com"],
              allowedMethods: ["GET", "POST", "PUT", "DELETE"],
              credentials: true,
            }),
            priority: 80,
            enabled: true,
          },
          {
            name: "security",
            middleware: new SecurityHttpMiddleware(mockMetricsCollector, {
              name: "security",
              enabled: true,
              priority: 70,
              customHeaders: {
                "X-Frame-Options": "DENY",
                "X-Content-Type-Options": "nosniff",
              },
            }),
            priority: 70,
            enabled: true,
          },
          {
            name: "rateLimit",
            middleware: new RateLimitHttpMiddleware(mockMetricsCollector, {
              name: "rateLimit",
              enabled: true,
              priority: 60,
              windowMs: 60000,
              maxRequests: 1000,
            }),
            priority: 60,
            enabled: true,
          },
          {
            name: "auth",
            middleware: new AuthHttpMiddleware(
              mockMetricsCollector,
              mockAuthService,
              {
                name: "auth",
                enabled: true,
                priority: 50,
                requireAuth: true,
                permissions: ["api:read"],
              }
            ),
            priority: 50,
            enabled: true,
          },
        ]
      );

      // Mock successful auth
      mockAuthService.verifyToken.mockResolvedValue({
        id: "user_123",
        roles: ["user"],
        permissions: ["api:read"],
      });

      const chainMiddleware = chain.execute();
      await chainMiddleware(mockContext, nextFunction);

      expect(nextFunction).toHaveBeenCalled();

      // Verify all middleware executed
      const middlewareNames = [
        "error",
        "logging",
        "cors",
        "security",
        "rateLimit",
        "auth",
      ];
      middlewareNames.forEach((name) => {
        expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
          "middleware_executed",
          1,
          expect.objectContaining({ name })
        );
      });

      // Verify final context state
      expect(mockContext.authenticated).toBe(true);
      expect(mockContext.user).toBeDefined();
      expect(mockContext.set.headers).toEqual(
        expect.objectContaining({
          "Access-Control-Allow-Origin": "https://app.example.com",
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
        })
      );
    });
  });

  describe("Dynamic Middleware Configuration", () => {
    it("should allow enabling/disabling middleware at runtime", async () => {
      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "dynamic-config",
      });

      const corsMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        name: "cors",
        enabled: true,
        priority: 100,
        allowedOrigins: ["*"],
      });

      chain.add(
        corsMiddleware.getName(),
        corsMiddleware.middleware(),
        corsMiddleware.getPriority()
      );

      // Initially enabled
      let chainMiddleware = chain.execute();
      await chainMiddleware(mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe("*");

      // Reset context
      mockContext.set.headers = {};
      nextFunction.mockClear();

      // Disable middleware
      chain.toggle("cors", false);

      chainMiddleware = chain.execute();
      await chainMiddleware(mockContext, nextFunction);

      // Should not have CORS headers when disabled
      expect(
        mockContext.set.headers["Access-Control-Allow-Origin"]
      ).toBeUndefined();
    });

    it("should support middleware hot-swapping", async () => {
      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "hot-swap",
      });

      const originalMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        name: "cors",
        enabled: true,
        priority: 100,
        allowedOrigins: ["https://original.com"],
      });

      chain.add(
        originalMiddleware.getName(),
        originalMiddleware.middleware(),
        originalMiddleware.getPriority()
      );

      // Execute with original config
      let chainMiddleware = chain.execute();
      await chainMiddleware(mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe(
        "https://original.com"
      );

      // Hot-swap with new configuration
      const newMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        name: "cors",
        enabled: true,
        priority: 100,
        allowedOrigins: ["https://newsite.com"],
      });

      chain.remove("cors");
      chain.add(
        newMiddleware.getName(),
        newMiddleware.middleware(),
        newMiddleware.getPriority()
      );

      // Reset and execute with new config
      mockContext.set.headers = {};
      nextFunction.mockClear();

      chainMiddleware = chain.execute();
      await chainMiddleware(mockContext, nextFunction);

      expect(mockContext.set.headers["Access-Control-Allow-Origin"]).toBe(
        "https://newsite.com"
      );
    });
  });
});
