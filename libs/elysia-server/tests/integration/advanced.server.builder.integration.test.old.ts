/**
 * @fileoverview AdvancedElysiaServerBuilder Integration Tests
 * @description End-to-end tests with real HTTP/WebSocket traffic and server lifecycle
 */

import { AdvancedElysiaServerBuilder } from "../../src/server";
import { HttpMiddlewareChain } from "../../src/middleware/base/middlewareChain/httpMiddlewareChain";
import { CorsHttpMiddleware } from "../../src/middleware/cors/cors.http.middleware";
import { SecurityHttpMiddleware } from "../../src/middleware/security/security.http.middleware";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";
import { createMockMetricsCollector } from "../mocks";
import { Elysia } from "elysia";
import WebSocket from "ws";

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
      permissions: ["api:read", "api:write"],
    }),
  }),
  getPermissionService: jest.fn().mockReturnValue({
    createAuthContext: jest.fn().mockReturnValue({
      user: {
        id: "user_123",
        roles: ["user"],
        permissions: ["api:read", "api:write"],
      },
      permissions: ["api:read", "api:write"],
      roles: ["user"],
    }),
  }),
};

describe("AdvancedElysiaServerBuilder Integration Tests", () => {
  let serverBuilder: AdvancedElysiaServerBuilder;
  let testServer: { server: any; port: number };
  let mockMetricsCollector: IMetricsCollector;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMetricsCollector = createMockMetricsCollector();
    serverBuilder = new AdvancedElysiaServerBuilder(
      { name: "test-server", port: 3000 },
      mockMetricsCollector
    );
  });

  afterEach(async () => {
    if (testServer?.server) {
      try {
        await testServer.server.stop();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });

  describe("Complete HTTP Server with Middleware Stack", () => {
    it("should create and start server with full middleware configuration", async () => {
      const app = serverBuilder
        .development() // Use development preset
        .withCors({
          origin: ["http://localhost:3000", "https://app.example.com"],
          credentials: true,
          methods: ["GET", "POST", "PUT", "DELETE"],
        })
        .withSecurity({
          contentSecurityPolicy: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'"],
          },
          enableHsts: true,
        })
        .withAuthentication(mockAuthService, {
          jwtSecret: "test-secret",
          bypassRoutes: ["/health", "/metrics"],
          requiredPermissions: ["api:read"],
        })
        .withRateLimit({
          windowMs: 60000,
          max: 100,
          standardHeaders: true,
        })
        .withErrorHandling({
          enableStackTrace: true,
          logErrors: true,
        })
        .withLogging({
          enabled: true,
          logLevel: "info",
          includeResponseBody: false,
        })
        .build();

      // Add test routes
      app.get("/health", () => ({ status: "healthy" }));
      app.get("/protected", () => ({ message: "Protected data" }));
      app.post("/data", ({ body }) => ({ received: body }));

      // Start the server
      testServer = { server: app, port: 3001 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Test health endpoint (should bypass auth)
      const healthResponse = await fetch(
        `http://localhost:${testServer.port}/health`
      );
      expect(healthResponse.status).toBe(200);
      const healthData = await healthResponse.json();
      expect(healthData.status).toBe("healthy");

      // Test protected endpoint without auth (should fail)
      const protectedResponse = await fetch(
        `http://localhost:${testServer.port}/protected`
      );
      expect(protectedResponse.status).toBe(401);

      // Mock successful authentication for protected endpoint
      mockAuthService.verifyToken.mockResolvedValue({
        id: "user_123",
        roles: ["user"],
        permissions: ["api:read"],
      });

      // Test protected endpoint with auth (should succeed)
      const authResponse = await fetch(
        `http://localhost:${testServer.port}/protected`,
        {
          headers: { Authorization: "Bearer test-token" },
        }
      );
      expect(authResponse.status).toBe(200);
      const authData = await authResponse.json();
      expect(authData.message).toBe("Protected data");

      // Verify middleware metrics were recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "http_requests_total",
        expect.any(Number),
        expect.any(Object)
      );
    }, 10000);

    it("should enforce CORS policies correctly", async () => {
      const app = serverBuilder
        .development()
        .withCors({
          origin: ["http://localhost:3000"],
          credentials: true,
          methods: ["GET", "POST"],
        })
        .build();

      app.get("/api/data", () => ({ data: "test" }));

      testServer = { server: app, port: 3002 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Test OPTIONS preflight request
      const optionsResponse = await fetch(
        `http://localhost:${testServer.port}/api/data`,
        {
          method: "OPTIONS",
          headers: {
            Origin: "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
          },
        }
      );

      expect(optionsResponse.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://localhost:3000"
      );
      expect(
        optionsResponse.headers.get("Access-Control-Allow-Credentials")
      ).toBe("true");

      // Test request from allowed origin
      const allowedResponse = await fetch(
        `http://localhost:${testServer.port}/api/data`,
        {
          headers: { Origin: "http://localhost:3000" },
        }
      );
      expect(allowedResponse.status).toBe(200);

      // Test request from disallowed origin should still work (CORS is enforced by browser)
      const disallowedResponse = await fetch(
        `http://localhost:${testServer.port}/api/data`,
        {
          headers: { Origin: "http://malicious.com" },
        }
      );
      expect(disallowedResponse.status).toBe(200);
      expect(
        disallowedResponse.headers.get("Access-Control-Allow-Origin")
      ).toBe(null);
    }, 10000);

    it("should handle rate limiting correctly", async () => {
      const app = serverBuilder
        .development()
        .withRateLimit({
          windowMs: 1000, // 1 second window
          max: 3, // Only 3 requests allowed
          standardHeaders: true,
        })
        .build();

      app.get("/api/limited", () => ({ message: "success" }));

      testServer = { server: app, port: 3003 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      const baseUrl = `http://localhost:${testServer.port}/api/limited`;

      // First 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const response = await fetch(baseUrl);
        expect(response.status).toBe(200);
        expect(response.headers.get("X-RateLimit-Limit")).toBe("3");
        expect(response.headers.get("X-RateLimit-Remaining")).toBe(
          String(2 - i)
        );
      }

      // 4th request should be rate limited
      const rateLimitedResponse = await fetch(baseUrl);
      expect(rateLimitedResponse.status).toBe(429);

      // Verify rate limit metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "rate_limit_exceeded",
        1,
        expect.any(Object)
      );
    }, 10000);
  });

  describe("WebSocket Server Integration", () => {
    it("should create WebSocket server with middleware", async () => {
      const app = serverBuilder
        .development()
        .withWebSocket({
          enabled: true,
          path: "/ws",
          maxPayload: 1024 * 1024, // 1MB
          compression: true,
        })
        .withWebSocketAuth(mockAuthService, {
          requireAuth: false, // Allow anonymous for testing
          jwtSecret: "test-secret",
        })
        .withWebSocketSecurity({
          maxMessageLength: 1000,
          allowedMessageTypes: ["chat", "ping", "pong"],
        })
        .build();

      testServer = { server: app, port: 3004 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Create WebSocket client
      const wsClient = new WebSocket(`ws://localhost:${testServer.port}/ws`);

      await new Promise<void>((resolve, reject) => {
        wsClient.on("open", resolve);
        wsClient.on("error", reject);
        setTimeout(reject, 5000); // Timeout after 5 seconds
      });

      // Test message sending
      const messagePromise = new Promise<string>((resolve) => {
        wsClient.on("message", (data) => {
          resolve(data.toString());
        });
      });

      wsClient.send(
        JSON.stringify({
          type: "chat",
          payload: { text: "Hello WebSocket!" },
        })
      );

      // Close connection
      wsClient.close();

      // Verify WebSocket metrics were recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_connections_total",
        1,
        expect.any(Object)
      );
    }, 10000);

    it("should handle WebSocket authentication", async () => {
      const app = serverBuilder
        .development()
        .withWebSocket({
          enabled: true,
          path: "/ws-auth",
        })
        .withWebSocketAuth(mockAuthService, {
          requireAuth: true,
          closeOnAuthFailure: true,
          jwtSecret: "test-secret",
        })
        .build();

      testServer = { server: app, port: 3005 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Mock successful authentication
      mockAuthService.verifyToken.mockResolvedValue({
        id: "user_123",
        roles: ["user"],
        permissions: ["ws:connect"],
      });

      // Create WebSocket client with auth header
      const wsClient = new WebSocket(
        `ws://localhost:${testServer.port}/ws-auth`,
        {
          headers: { Authorization: "Bearer test-token" },
        }
      );

      await new Promise<void>((resolve, reject) => {
        wsClient.on("open", resolve);
        wsClient.on("error", reject);
        wsClient.on("close", (code) => {
          if (code === 1000) resolve(); // Normal closure
          else reject(new Error(`Connection closed with code ${code}`));
        });
        setTimeout(reject, 5000);
      });

      wsClient.close();

      // Verify authentication metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_auth_success",
        expect.any(Number),
        expect.any(Object)
      );
    }, 10000);
  });

  describe("Production Configuration", () => {
    it("should apply production-optimized settings", async () => {
      const app = serverBuilder
        .production() // Use production preset
        .withSecurity({
          enableHsts: true,
          enableNoSniff: true,
          enableXssFilter: true,
          contentSecurityPolicy: {
            "default-src": ["'self'"],
            "script-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'"],
          },
        })
        .withRateLimit({
          windowMs: 60000,
          max: 1000, // Higher limit for production
          standardHeaders: false, // Don't expose rate limit info
        })
        .withErrorHandling({
          enableStackTrace: false, // Hide stack traces in production
          logErrors: true,
          sanitizeErrors: true,
        })
        .withLogging({
          enabled: true,
          logLevel: "warn", // Only log warnings and errors in production
          includeResponseBody: false,
          sanitizeHeaders: true,
        })
        .build();

      app.get("/api/production", () => ({ environment: "production" }));
      app.get("/api/error", () => {
        throw new Error("Production error");
      });

      testServer = { server: app, port: 3006 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Test successful request
      const successResponse = await fetch(
        `http://localhost:${testServer.port}/api/production`
      );
      expect(successResponse.status).toBe(200);

      // Check security headers
      expect(
        successResponse.headers.get("Strict-Transport-Security")
      ).toBeTruthy();
      expect(successResponse.headers.get("X-Content-Type-Options")).toBe(
        "nosniff"
      );
      expect(successResponse.headers.get("X-XSS-Protection")).toBeTruthy();
      expect(successResponse.headers.get("Content-Security-Policy")).toContain(
        "default-src 'self'"
      );

      // Test error handling (should not expose stack trace)
      const errorResponse = await fetch(
        `http://localhost:${testServer.port}/api/error`
      );
      expect(errorResponse.status).toBe(500);
      const errorData = await errorResponse.json();
      expect(errorData).not.toHaveProperty("stack");

      // Verify production metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "http_requests_total",
        expect.any(Number),
        expect.objectContaining({ environment: "production" })
      );
    }, 10000);
  });

  describe("Custom Middleware Integration", () => {
    it("should integrate custom middleware with built-in middleware", async () => {
      const customMiddleware = jest
        .fn()
        .mockImplementation(async ({ request }, next) => {
          // Add custom header
          const response = await next();
          response.headers.set("X-Custom-Middleware", "true");
          return response;
        });

      const app = serverBuilder
        .development()
        .withLogging({ enabled: true, logLevel: "info" })
        .withAuthentication(mockAuthService, {
          jwtSecret: "test-secret",
          bypassRoutes: ["/public"],
        })
        .build();

      // Add custom middleware
      app.use(customMiddleware);
      app.get("/public", () => ({ message: "public" }));
      app.get("/custom", () => ({ message: "custom middleware test" }));

      testServer = { server: app, port: 3007 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Test public endpoint
      const publicResponse = await fetch(
        `http://localhost:${testServer.port}/public`
      );
      expect(publicResponse.status).toBe(200);
      expect(publicResponse.headers.get("X-Custom-Middleware")).toBe("true");

      // Mock authentication for protected route
      mockAuthService.verifyToken.mockResolvedValue({
        id: "user_123",
        roles: ["user"],
        permissions: ["api:read"],
      });

      // Test custom endpoint with auth
      const customResponse = await fetch(
        `http://localhost:${testServer.port}/custom`,
        {
          headers: { Authorization: "Bearer test-token" },
        }
      );
      expect(customResponse.status).toBe(200);
      expect(customResponse.headers.get("X-Custom-Middleware")).toBe("true");

      // Verify custom middleware was called
      expect(customMiddleware).toHaveBeenCalled();
    }, 10000);
  });

  describe("Error Handling Across Middleware", () => {
    it("should handle errors properly through middleware chain", async () => {
      const app = serverBuilder
        .development()
        .withErrorHandling({
          enableStackTrace: true,
          logErrors: true,
          customErrorFormatter: (error) => ({
            error: "Custom error format",
            message: error.message,
            timestamp: new Date().toISOString(),
          }),
        })
        .withLogging({ enabled: true, logLevel: "error" })
        .build();

      app.get("/auth-error", () => {
        throw new Error("Authentication failed");
      });

      app.get("/validation-error", () => {
        const error = new Error("Validation failed");
        (error as any).statusCode = 400;
        throw error;
      });

      testServer = { server: app, port: 3008 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Test auth error
      const authErrorResponse = await fetch(
        `http://localhost:${testServer.port}/auth-error`
      );
      expect(authErrorResponse.status).toBe(500);
      const authErrorData = await authErrorResponse.json();
      expect(authErrorData.error).toBe("Custom error format");

      // Test validation error
      const validationErrorResponse = await fetch(
        `http://localhost:${testServer.port}/validation-error`
      );
      expect(validationErrorResponse.status).toBe(400);
      const validationErrorData = await validationErrorResponse.json();
      expect(validationErrorData.message).toBe("Validation failed");

      // Verify error metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "http_errors_total",
        expect.any(Number),
        expect.any(Object)
      );
    }, 10000);
  });

  describe("Server Lifecycle Management", () => {
    it("should handle server startup and shutdown gracefully", async () => {
      const app = serverBuilder
        .development()
        .withLogging({ enabled: true, logLevel: "info" })
        .withGracefulShutdown({
          timeout: 5000,
          signals: ["SIGTERM", "SIGINT"],
        })
        .build();

      app.get("/status", () => ({ status: "running" }));

      // Start server
      testServer = { server: app, port: 3009 };
      await new Promise<void>((resolve) => {
        testServer.server = app.listen(testServer.port, resolve);
      });

      // Test that server is running
      const statusResponse = await fetch(
        `http://localhost:${testServer.port}/status`
      );
      expect(statusResponse.status).toBe(200);

      // Graceful shutdown
      const shutdownPromise = new Promise<void>((resolve) => {
        testServer.server.server.on("close", resolve);
      });

      testServer.server.stop();
      await shutdownPromise;

      // Verify shutdown metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "server_shutdown",
        1,
        expect.any(Object)
      );
    }, 10000);
  });

  describe("Configuration Validation", () => {
    it("should validate configuration and provide helpful errors", () => {
      expect(() => {
        serverBuilder.withRateLimit({
          windowMs: -1000, // Invalid negative value
          max: 100,
        });
      }).toThrow("Rate limit windowMs must be positive");

      expect(() => {
        serverBuilder.withSecurity({
          contentSecurityPolicy: null as any, // Invalid CSP
        });
      }).toThrow();

      expect(() => {
        serverBuilder.withWebSocket({
          enabled: true,
          maxPayload: -1, // Invalid payload size
        });
      }).toThrow();
    });
  });
});
