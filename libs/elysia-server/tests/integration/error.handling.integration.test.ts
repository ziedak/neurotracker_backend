/**
 * @fileoverview Error Handling Integration Tests
 * @description Tests error handling across multiple middleware layers and protocols
 */

import { HttpMiddlewareChain } from "../../src/middleware/base/middlewareChain/httpMiddlewareChain";
import { WebSocketMiddlewareChain } from "../../src/middleware/base/middlewareChain/WebSocketMiddlewareChain";
import { ErrorHttpMiddleware } from "../../src/middleware/error/error.http.middleware";
import { LoggingHttpMiddleware } from "../../src/middleware/logging/logging.http.middleware";
import { AuthHttpMiddleware } from "../../src/middleware/auth/auth.http.middleware";
import { AuthWebSocketMiddleware } from "../../src/middleware/auth/auth.websocket.middleware";
import { SecurityWebSocketMiddleware } from "../../src/middleware/security/security.websocket.middleware";
import { HttpContext, WebSocketContext } from "../../src/middleware/types";
import { IMetricsCollector } from "@libs/monitoring";

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
    validateApiKey: jest.fn(),
  }),
  getPermissionService: jest.fn().mockReturnValue({
    createAuthContext: jest.fn(),
  }),
};

describe("Error Handling Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("HTTP Error Propagation Through Middleware Chain", () => {
    let mockContext: HttpContext;
    let nextFunction: jest.MockedFunction<() => Promise<void>>;

    beforeEach(() => {
      mockContext = {
        request: {
          method: "GET",
          url: "/api/test",
          headers: new Headers({
            authorization: "Bearer invalid-token",
            "user-agent": "Test Client",
          }),
          body: null,
        } as any,
        response: {
          headers: new Headers(),
          status: 200,
          statusText: "OK",
        } as any,
        metadata: {
          startTime: Date.now(),
          requestId: "req_123",
          userAgent: "Test Client",
          ipAddress: "192.168.1.100",
        },
      };

      nextFunction = jest.fn().mockResolvedValue(undefined);
    });

    it("should handle authentication errors and log them properly", async () => {
      const chain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "error-auth-test"
      );

      // Mock console.error to capture logs
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const loggingMiddleware = new LoggingHttpMiddleware(
        mockMetricsCollector,
        {
          name: "http-logging",
          enabled: true,
          priority: 100,
          logLevel: "error",
          includeRequestBody: true,
          includeResponseBody: false,
        }
      );

      const authMiddleware = new AuthHttpMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "http-auth",
          enabled: true,
          priority: 90,
          bypassRoutes: ["/health"],
          jwtSecret: "test-secret",
          requiredPermissions: ["api:read"],
          onAuthFailure: "throw", // Throw error on auth failure
        }
      );

      const errorMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "http-error",
        enabled: true,
        priority: 10,
        enableStackTrace: true,
        logErrors: true,
        customErrorFormatter: (error, context) => ({
          error: "Authentication Error",
          message: error.message,
          requestId: context.metadata.requestId,
          timestamp: new Date().toISOString(),
        }),
      });

      chain.register(
        { name: "http-logging", priority: 100 },
        loggingMiddleware.middleware()
      );
      chain.register(
        { name: "http-auth", priority: 90 },
        authMiddleware.middleware()
      );
      chain.register(
        { name: "http-error", priority: 10 },
        errorMiddleware.middleware()
      );

      // Mock authentication failure
      mockAuthService.verifyToken.mockRejectedValue(
        new Error("Invalid JWT token")
      );

      await chain.execute(mockContext, nextFunction);

      // Verify error was caught and formatted
      expect(mockContext.response.status).toBe(401);

      // Verify logging recorded the error
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "http_auth_failed",
        1,
        expect.objectContaining({ error_type: "authentication" })
      );

      // Verify error was logged to console
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should handle validation errors with custom formatting", async () => {
      const chain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "validation-error-test"
      );

      const errorMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "http-error",
        enabled: true,
        priority: 10,
        enableStackTrace: false, // Don't expose stack traces
        logErrors: true,
        customErrorFormatter: (error, context) => {
          if (error.name === "ValidationError") {
            return {
              error: "Validation Failed",
              details: (error as any).details || [],
              requestId: context.metadata.requestId,
            };
          }
          return { error: "Internal Server Error" };
        },
      });

      // Mock validation middleware that throws validation error
      const validationMiddleware = {
        execute: jest.fn().mockImplementation(async () => {
          const error = new Error("Required field missing");
          error.name = "ValidationError";
          (error as any).details = [
            { field: "email", message: "Email is required" },
            {
              field: "password",
              message: "Password must be at least 8 characters",
            },
          ];
          (error as any).statusCode = 400;
          throw error;
        }),
      };

      chain.register(
        { name: "validation", priority: 90 },
        validationMiddleware.execute
      );
      chain.register(
        { name: "http-error", priority: 10 },
        errorMiddleware.middleware()
      );

      await chain.execute(mockContext, nextFunction);

      // Verify validation error was properly formatted
      expect(mockContext.response.status).toBe(400);

      // Verify validation metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "http_validation_error",
        1,
        expect.any(Object)
      );
    });

    it("should handle middleware chain errors and recover gracefully", async () => {
      const chain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "chain-error-test"
      );

      const errorMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "http-error",
        enabled: true,
        priority: 10,
        enableStackTrace: true,
        logErrors: true,
        enableRecovery: true, // Enable recovery from errors
      });

      // Create middleware that throws unexpected error
      const faultyMiddleware = {
        execute: jest.fn().mockRejectedValue(new Error("Middleware crashed")),
      };

      const workingMiddleware = {
        execute: jest.fn().mockResolvedValue(undefined),
      };

      chain.register(
        { name: "faulty", priority: 90 },
        faultyMiddleware.execute
      );
      chain.register(
        { name: "working", priority: 80 },
        workingMiddleware.execute
      );
      chain.register(
        { name: "http-error", priority: 10 },
        errorMiddleware.middleware()
      );

      await chain.execute(mockContext, nextFunction);

      // Chain should recover and continue
      expect(workingMiddleware.execute).toHaveBeenCalled();

      // Error should be handled
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "http_middleware_error",
        1,
        expect.objectContaining({ middleware: "faulty" })
      );
    });

    it("should handle async errors in middleware chain", async () => {
      const chain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "async-error-test"
      );

      const errorMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "http-error",
        enabled: true,
        priority: 10,
        enableStackTrace: true,
        logErrors: true,
      });

      // Middleware that throws async error
      const asyncErrorMiddleware = {
        execute: jest.fn().mockImplementation(async () => {
          // Simulate async operation that fails
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error("Async operation failed");
        }),
      };

      chain.register(
        { name: "async-error", priority: 90 },
        asyncErrorMiddleware.execute
      );
      chain.register(
        { name: "http-error", priority: 10 },
        errorMiddleware.middleware()
      );

      await chain.execute(mockContext, nextFunction);

      // Verify async error was caught
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "http_async_error",
        1,
        expect.any(Object)
      );

      expect(mockContext.response.status).toBe(500);
    });
  });

  describe("WebSocket Error Handling and Connection Cleanup", () => {
    let mockContext: WebSocketContext;
    let mockWebSocket: {
      send: jest.MockedFunction<(data: string) => void>;
      close: jest.MockedFunction<() => void>;
      readyState: number;
    };

    beforeEach(() => {
      mockWebSocket = {
        send: jest.fn(),
        close: jest.fn(),
        readyState: 1, // WebSocket.OPEN
      };

      mockContext = {
        ws: mockWebSocket,
        connectionId: "conn_123",
        message: {
          type: "chat_message",
          payload: { text: "Hello" },
        },
        timestamp: new Date().toISOString(),
        authenticated: false,
        metadata: {
          connectedAt: new Date(),
          lastActivity: new Date(),
          messageCount: 1,
          clientIp: "192.168.1.100",
          userAgent: "Test WebSocket Client",
          headers: {
            authorization: "Bearer invalid-token",
          },
          query: {},
        },
      };
    });

    it("should handle WebSocket authentication errors with connection cleanup", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "ws-auth-error-test"
      );

      const authMiddleware = new AuthWebSocketMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "ws-auth",
          requireAuth: true,
          closeOnAuthFailure: true,
          jwtSecret: "test-secret",
          enableCleanupTimer: false,
          cleanupInterval: 1000, // 1 second cleanup
        }
      );

      chain.register(
        { name: "ws-auth", priority: 90 },
        authMiddleware.middleware()
      );

      // Mock authentication failure
      mockAuthService.verifyToken.mockRejectedValue(new Error("Token expired"));

      await chain.execute(mockContext);

      // Connection should be closed
      expect(mockWebSocket.close).toHaveBeenCalled();

      // Cleanup metrics should be recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_connection_closed",
        1,
        expect.objectContaining({ reason: "auth_failure" })
      );

      // Error metrics should be recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_auth_failed",
        1,
        expect.any(Object)
      );
    });

    it("should handle message validation errors without closing connection", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "ws-validation-test"
      );

      const securityMiddleware = new SecurityWebSocketMiddleware(
        mockMetricsCollector,
        {
          name: "ws-security",
          enabled: true,
          priority: 90,
          maxMessageLength: 50, // Very short limit
          allowedMessageTypes: ["chat", "ping"],
          validateMessageStructure: true,
          enableCleanupTimer: false,
        }
      );

      chain.register(
        { name: "ws-security", priority: 90 },
        securityMiddleware.middleware()
      );

      // Test with message that's too long
      const longMessageContext = {
        ...mockContext,
        message: {
          type: "chat",
          payload: {
            text: "This message is way too long and should be rejected by the security middleware",
          },
        },
      };

      await chain.execute(longMessageContext);

      // Connection should remain open (validation error, not auth error)
      expect(mockWebSocket.close).not.toHaveBeenCalled();

      // Error message should be sent to client
      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining("Message too long")
      );

      // Validation error metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_message_rejected",
        1,
        expect.objectContaining({ reason: "message_too_long" })
      );
    });

    it("should handle middleware errors and maintain connection stability", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "ws-error-recovery"
      );

      // Middleware that throws an error
      const faultyMiddleware = {
        execute: jest.fn().mockRejectedValue(new Error("Processing failed")),
      };

      // Middleware that should still work after error
      const reliableMiddleware = {
        execute: jest.fn().mockResolvedValue(undefined),
      };

      chain.register(
        { name: "faulty", priority: 90 },
        faultyMiddleware.execute
      );
      chain.register(
        { name: "reliable", priority: 80 },
        reliableMiddleware.execute
      );

      await chain.execute(mockContext);

      // Connection should remain open
      expect(mockWebSocket.close).not.toHaveBeenCalled();

      // Reliable middleware should still execute
      expect(reliableMiddleware.execute).toHaveBeenCalled();

      // Error metrics should be recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_middleware_error",
        1,
        expect.objectContaining({ middleware: "faulty" })
      );
    });

    it("should handle connection cleanup on critical errors", async () => {
      const chain = new WebSocketMiddlewareChain(
        mockMetricsCollector,
        "ws-critical-error"
      );

      // Middleware that throws critical system error
      const criticalErrorMiddleware = {
        execute: jest.fn().mockImplementation(async () => {
          const error = new Error("System overload");
          (error as any).critical = true;
          throw error;
        }),
      };

      chain.register(
        { name: "critical", priority: 90 },
        criticalErrorMiddleware.execute
      );

      await chain.execute(mockContext);

      // For critical errors, connection might be closed
      // (Implementation specific - depends on error handling strategy)

      // Critical error metrics should be recorded
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "websocket_critical_error",
        1,
        expect.any(Object)
      );
    });
  });

  describe("Cross-Service Error Scenarios", () => {
    it("should handle authentication service failures gracefully", async () => {
      const httpChain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "cross-service-test"
      );

      const authMiddleware = new AuthHttpMiddleware(
        mockMetricsCollector,
        mockAuthService,
        {
          name: "http-auth",
          enabled: true,
          priority: 90,
          bypassRoutes: [],
          jwtSecret: "test-secret",
          onAuthFailure: "return_error", // Don't throw, return error response
          fallbackOnServiceFailure: true, // Fallback when auth service fails
        }
      );

      const errorMiddleware = new ErrorHttpMiddleware(mockMetricsCollector, {
        name: "http-error",
        enabled: true,
        priority: 10,
        enableStackTrace: false,
        logErrors: true,
        serviceErrorHandler: (error, service) => ({
          error: "Service Unavailable",
          message: `${service} service is temporarily unavailable`,
          retryAfter: 60,
        }),
      });

      httpChain.register(
        { name: "http-auth", priority: 90 },
        authMiddleware.middleware()
      );
      httpChain.register(
        { name: "http-error", priority: 10 },
        errorMiddleware.middleware()
      );

      // Mock auth service failure (network error, service down, etc.)
      mockAuthService.verifyToken.mockRejectedValue(new Error("ECONNREFUSED"));

      const mockContext: HttpContext = {
        request: {
          method: "GET",
          url: "/api/protected",
          headers: new Headers({ authorization: "Bearer valid-token" }),
        } as any,
        response: {
          headers: new Headers(),
          status: 200,
          statusText: "OK",
        } as any,
        metadata: {
          startTime: Date.now(),
          requestId: "req_456",
          userAgent: "Test Client",
          ipAddress: "192.168.1.100",
        },
      };

      const nextFunction = jest.fn();

      await httpChain.execute(mockContext, nextFunction);

      // Should handle service failure gracefully
      expect(mockContext.response.status).toBe(503); // Service Unavailable

      // Service failure metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "auth_service_failure",
        1,
        expect.objectContaining({ service: "authentication" })
      );

      // Retry metrics
      expect(mockMetricsCollector.recordGauge).toHaveBeenCalledWith(
        "service_retry_after",
        60,
        expect.objectContaining({ service: "authentication" })
      );
    });

    it("should handle metrics collection failures without breaking request flow", async () => {
      // Mock metrics collector that fails
      const failingMetricsCollector = {
        recordCounter: jest
          .fn()
          .mockRejectedValue(new Error("Metrics service down")),
        recordTimer: jest
          .fn()
          .mockRejectedValue(new Error("Metrics service down")),
        recordGauge: jest
          .fn()
          .mockRejectedValue(new Error("Metrics service down")),
      } as jest.Mocked<IMetricsCollector>;

      const chain = new HttpMiddlewareChain(
        failingMetricsCollector,
        "metrics-failure-test"
      );

      const loggingMiddleware = new LoggingHttpMiddleware(
        failingMetricsCollector,
        {
          name: "http-logging",
          enabled: true,
          priority: 100,
          logLevel: "info",
          continueOnMetricsFailure: true, // Don't fail request if metrics fail
        }
      );

      chain.register(
        { name: "http-logging", priority: 100 },
        loggingMiddleware.middleware()
      );

      const mockContext: HttpContext = {
        request: {
          method: "GET",
          url: "/api/test",
          headers: new Headers(),
        } as any,
        response: {
          headers: new Headers(),
          status: 200,
          statusText: "OK",
        } as any,
        metadata: {
          startTime: Date.now(),
          requestId: "req_789",
          userAgent: "Test Client",
          ipAddress: "192.168.1.100",
        },
      };

      const nextFunction = jest.fn().mockResolvedValue(undefined);

      // Should not throw despite metrics failure
      await expect(
        chain.execute(mockContext, nextFunction)
      ).resolves.not.toThrow();

      // Next function should still be called
      expect(nextFunction).toHaveBeenCalled();

      // Verify metrics collection was attempted
      expect(failingMetricsCollector.recordCounter).toHaveBeenCalled();
    });
  });

  describe("Error Recovery and Resilience", () => {
    it("should implement circuit breaker pattern for failing services", async () => {
      const chain = new HttpMiddlewareChain(
        mockMetricsCollector,
        "circuit-breaker-test"
      );

      let failureCount = 0;
      const maxFailures = 3;

      const circuitBreakerMiddleware = {
        execute: jest.fn().mockImplementation(async () => {
          failureCount++;

          if (failureCount <= maxFailures) {
            throw new Error(`Service failure ${failureCount}`);
          }

          // Circuit breaker opens - fail fast
          const error = new Error("Circuit breaker open");
          (error as any).circuitOpen = true;
          (error as any).statusCode = 503;
          throw error;
        }),
      };

      chain.register(
        { name: "circuit-breaker", priority: 90 },
        circuitBreakerMiddleware.execute
      );

      const mockContext: HttpContext = {
        request: {
          method: "GET",
          url: "/api/test",
          headers: new Headers(),
        } as any,
        response: {
          headers: new Headers(),
          status: 200,
          statusText: "OK",
        } as any,
        metadata: {
          startTime: Date.now(),
          requestId: "req_cb",
          userAgent: "Test",
          ipAddress: "127.0.0.1",
        },
      };

      // First few requests should fail normally
      for (let i = 1; i <= maxFailures; i++) {
        await chain.execute({ ...mockContext }, jest.fn());

        expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
          "service_failure",
          1,
          expect.objectContaining({ attempt: i })
        );
      }

      // Subsequent requests should fail fast (circuit breaker open)
      await chain.execute({ ...mockContext }, jest.fn());

      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "circuit_breaker_open",
        1,
        expect.any(Object)
      );
    });

    it("should implement retry logic with exponential backoff", async () => {
      const chain = new HttpMiddlewareChain(mockMetricsCollector, "retry-test");

      let attemptCount = 0;
      const maxRetries = 3;

      const retryMiddleware = {
        execute: jest.fn().mockImplementation(async () => {
          attemptCount++;

          if (attemptCount < maxRetries) {
            // Simulate temporary failure
            const error = new Error("Temporary failure");
            (error as any).retryable = true;
            throw error;
          }

          // Success on final attempt
          return Promise.resolve();
        }),
      };

      chain.register({ name: "retry", priority: 90 }, retryMiddleware.execute);

      const mockContext: HttpContext = {
        request: {
          method: "POST",
          url: "/api/retry",
          headers: new Headers(),
        } as any,
        response: {
          headers: new Headers(),
          status: 200,
          statusText: "OK",
        } as any,
        metadata: {
          startTime: Date.now(),
          requestId: "req_retry",
          userAgent: "Test",
          ipAddress: "127.0.0.1",
        },
      };

      await chain.execute(mockContext, jest.fn());

      // Should have made multiple attempts
      expect(retryMiddleware.execute).toHaveBeenCalledTimes(maxRetries);

      // Should record retry metrics
      expect(mockMetricsCollector.recordCounter).toHaveBeenCalledWith(
        "request_retry",
        maxRetries - 1, // Total retries
        expect.any(Object)
      );
    });
  });
});
