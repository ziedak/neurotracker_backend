/**
 * @fileoverview Simple HTTP Middleware Chain Integration Test
 * @description Tests basic HTTP middleware chain functionality with actual API
 */

import { HttpMiddlewareChain } from "../../src/middleware/base/middlewareChain/httpMiddlewareChain";
import { CorsHttpMiddleware } from "../../src/middleware/cors/cors.http.middleware";
import { SecurityHttpMiddleware } from "../../src/middleware/security/security.http.middleware";
import { MiddlewareContext } from "../../src/middleware/types";
import { IMetricsCollector, createMockMetricsCollector } from "../mocks";
import {
  setupTestCleanup,
  createRateLimitHttpMiddleware,
} from "../helpers/testCleanup";

// Mock external dependencies
jest.mock("@libs/monitoring", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
    setLevel: jest.fn(),
  })),
}));

jest.mock("@libs/utils", () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
    setLevel: jest.fn(),
  })),
}));

// Setup automatic cleanup
setupTestCleanup();

// Create a proper mock middleware context
function createMockMiddlewareContext(
  overrides: Partial<MiddlewareContext> = {}
): MiddlewareContext {
  return {
    requestId: "test-request-123",
    request: {
      method: "GET",
      url: "https://api.example.com/test",
      headers: {
        origin: "https://app.example.com",
        "content-type": "application/json",
      },
      body: null,
      params: {},
      query: {},
    },
    set: {
      status: 200,
      headers: {},
    },
    store: {} as Record<string, unknown>,
    ...overrides,
  } as MiddlewareContext;
}

describe("HTTP Middleware Chain Integration", () => {
  let mockMetricsCollector: IMetricsCollector;
  let mockContext: MiddlewareContext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMetricsCollector = createMockMetricsCollector();
    mockContext = createMockMiddlewareContext();
  });

  describe("Basic Chain Operations", () => {
    it("should create and execute empty middleware chain", async () => {
      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "empty-chain",
        middlewares: [],
      });

      const chainFunction = chain.execute();
      const nextCalled = jest.fn();

      await chainFunction(mockContext, nextCalled);

      expect(nextCalled).toHaveBeenCalledTimes(1);
      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "middleware_chain_duration",
        expect.any(Number),
        expect.objectContaining({ chainName: "empty-chain" })
      );
    });

    it("should execute middleware in priority order", async () => {
      const executionOrder: string[] = [];

      const highPriorityMiddleware = jest.fn(async (_context, next) => {
        executionOrder.push("high");
        await next();
      });

      const lowPriorityMiddleware = jest.fn(async (_context, next) => {
        executionOrder.push("low");
        await next();
      });

      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "priority-chain",
        middlewares: [
          {
            name: "low-priority",
            middleware: lowPriorityMiddleware,
            priority: 10,
            enabled: true,
          },
          {
            name: "high-priority",
            middleware: highPriorityMiddleware,
            priority: 50,
            enabled: true,
          },
        ],
      });

      const chainFunction = chain.execute();
      const nextCalled = jest.fn();

      await chainFunction(mockContext, nextCalled);

      // Higher priority should execute first
      expect(executionOrder).toEqual(["high", "low"]);
      expect(nextCalled).toHaveBeenCalledTimes(1);
    });

    it("should add middleware dynamically", async () => {
      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "dynamic-chain",
        middlewares: [],
      });

      const testMiddleware = jest.fn(async (context, next) => {
        (context.store as Record<string, unknown>).testFlag = true;
        await next();
      });

      // Add middleware dynamically
      chain.add("test-middleware", testMiddleware, 30);

      const chainFunction = chain.execute();
      const nextCalled = jest.fn();

      await chainFunction(mockContext, nextCalled);

      expect(testMiddleware).toHaveBeenCalledTimes(1);
      expect((mockContext.store as Record<string, unknown>).testFlag).toBe(
        true
      );
      expect(nextCalled).toHaveBeenCalledTimes(1);
    });
  });

  describe("Real Middleware Integration", () => {
    it("should execute CORS and Security middleware together", async () => {
      const corsMiddleware = new CorsHttpMiddleware(mockMetricsCollector, {
        name: "cors",
        enabled: true,
        priority: 90,
        allowedOrigins: ["https://app.example.com"],
        allowedMethods: ["GET", "POST"],
        credentials: true,
      });

      const securityMiddleware = new SecurityHttpMiddleware(
        mockMetricsCollector,
        {
          name: "security",
          enabled: true,
          priority: 80,
          contentSecurityPolicy: {
            enabled: true,
            directives: {
              "default-src": ["'self'"],
            },
          },
          hsts: {
            enabled: false, // Disabled for tests
          },
        }
      );

      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "cors-security-chain",
        middlewares: [
          {
            name: "cors",
            middleware: corsMiddleware.middleware(),
            priority: 90,
            enabled: true,
          },
          {
            name: "security",
            middleware: securityMiddleware.middleware(),
            priority: 80,
            enabled: true,
          },
        ],
      });

      const chainFunction = chain.execute();
      const nextCalled = jest.fn();

      await chainFunction(mockContext, nextCalled);

      expect(nextCalled).toHaveBeenCalledTimes(1);

      // Verify middleware chain executed successfully
      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "middleware_chain_duration",
        expect.any(Number),
        expect.objectContaining({ chainName: "cors-security-chain" })
      );
    });

    it("should handle middleware with rate limiting", async () => {
      const rateLimitMiddleware = createRateLimitHttpMiddleware(
        mockMetricsCollector,
        {
          name: "rateLimit",
          enabled: true,
          priority: 70,
          maxRequests: 100,
          windowMs: 60000,
          keyStrategy: "ip",
        }
      );

      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "rate-limit-chain",
        middlewares: [
          {
            name: "rateLimit",
            middleware: rateLimitMiddleware.middleware(),
            priority: 70,
            enabled: true,
          },
        ],
      });

      const chainFunction = chain.execute();
      const nextCalled = jest.fn();

      await chainFunction(mockContext, nextCalled);

      expect(nextCalled).toHaveBeenCalledTimes(1);
      // Rate limiter should allow the request and continue to next
    });
  });

  describe("Error Handling", () => {
    it("should handle middleware errors gracefully", async () => {
      const errorMiddleware = jest.fn(async (_context, _next) => {
        throw new Error("Test middleware error");
      });

      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "error-chain",
        middlewares: [
          {
            name: "error-middleware",
            middleware: errorMiddleware,
            priority: 50,
            enabled: true,
          },
        ],
      });

      const chainFunction = chain.execute();
      const nextCalled = jest.fn();

      await expect(chainFunction(mockContext, nextCalled)).rejects.toThrow(
        "Test middleware error"
      );

      expect(errorMiddleware).toHaveBeenCalledTimes(1);
      expect(nextCalled).not.toHaveBeenCalled();
    });

    it("should record metrics for successful execution", async () => {
      const successMiddleware = jest.fn(async (_context, next) => {
        await next();
      });

      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "success-chain",
        middlewares: [
          {
            name: "success-middleware",
            middleware: successMiddleware,
            priority: 50,
            enabled: true,
          },
        ],
      });

      const chainFunction = chain.execute();
      const nextCalled = jest.fn();

      await chainFunction(mockContext, nextCalled);

      expect(mockMetricsCollector.recordTimer).toHaveBeenCalledWith(
        "middleware_chain_duration",
        expect.any(Number),
        expect.objectContaining({
          chainName: "success-chain",
          result: "success",
        })
      );
    });
  });

  describe("Chain Management", () => {
    it("should remove middleware from chain", async () => {
      const testMiddleware = jest.fn(async (_context, next) => {
        await next();
      });

      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "removable-chain",
        middlewares: [
          {
            name: "test-middleware",
            middleware: testMiddleware,
            priority: 50,
            enabled: true,
          },
        ],
      });

      // Remove the middleware
      const removed = chain.remove("test-middleware");
      expect(removed).toBe(true);

      const chainFunction = chain.execute();
      const nextCalled = jest.fn();

      await chainFunction(mockContext, nextCalled);

      // Middleware should not have been called
      expect(testMiddleware).not.toHaveBeenCalled();
      expect(nextCalled).toHaveBeenCalledTimes(1);
    });

    it("should disable middleware without removing", async () => {
      const testMiddleware = jest.fn(async (_context, next) => {
        await next();
      });

      const chain = new HttpMiddlewareChain(mockMetricsCollector, {
        name: "disableable-chain",
        middlewares: [
          {
            name: "test-middleware",
            middleware: testMiddleware,
            priority: 50,
            enabled: false, // Disabled
          },
        ],
      });

      const chainFunction = chain.execute();
      const nextCalled = jest.fn();

      await chainFunction(mockContext, nextCalled);

      // Middleware should not execute when disabled
      expect(testMiddleware).not.toHaveBeenCalled();
      expect(nextCalled).toHaveBeenCalledTimes(1);
    });
  });
});
