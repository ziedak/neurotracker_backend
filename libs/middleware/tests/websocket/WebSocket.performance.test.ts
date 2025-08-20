import { describe, it, expect, beforeEach, vi } from "vitest";
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  WebSocketMiddlewareChainFactory,
  type WebSocketMiddlewareChainConfig,
  WEBSOCKET_CHAIN_PRESETS,
} from "../../src/websocket/WebSocketMiddlewareChainFactory";
import { UnifiedSessionManager } from "@libs/auth";
import type { WebSocketContext } from "../../src/types";

// Mock dependencies
vi.mock("@libs/auth");
vi.mock("@libs/monitoring");
vi.mock("@libs/database");

const mockSessionManager = {
  getSession: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
} as any;

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(() => mockLogger),
  getInstance: vi.fn(() => mockLogger),
} as any;

const mockMetrics = {
  recordCounter: vi.fn(),
  recordTimer: vi.fn(),
  getInstance: vi.fn(() => mockMetrics),
} as any;

// Test utilities
const createMockContext = (
  overrides?: Partial<WebSocketContext>
): WebSocketContext => ({
  ws: {
    send: vi.fn(),
    close: vi.fn(),
  },
  connectionId: `conn_${Math.random().toString(36).substr(2, 9)}`,
  message: { type: "test", payload: {} },
  metadata: {
    connectedAt: new Date(),
    lastActivity: new Date(),
    messageCount: 1,
    clientIp: "192.168.1.1",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    headers: {
      authorization: "Bearer valid-token",
      cookie: "sessionId=sess_123",
      origin: "https://test.com",
    },
    query: {},
  },
  authenticated: false,
  ...overrides,
});

const createValidSession = () => ({
  sessionId: "sess_123",
  userId: "user_123",
  protocol: "websocket" as any,
  authMethod: "session_token" as any,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  lastActivity: new Date(),
  ipAddress: "192.168.1.1",
  userAgent: "test-agent",
  origin: "https://test.com",
  connectionId: "conn_123",
  deviceInfo: { deviceType: "desktop", os: "Linux", browser: "Chrome" },
  metadata: {},
  isRevoked: false,
});

// Setup mocks
beforeEach(() => {
  vi.mocked(Logger).getInstance = vi.fn(() => mockLogger);
  vi.mocked(MetricsCollector).getInstance = vi.fn(() => mockMetrics);

  // Setup successful authentication by default
  mockSessionManager.getSession.mockResolvedValue(createValidSession());
  mockSessionManager.updateSession.mockResolvedValue(undefined);

  vi.clearAllMocks();
});

describe("WebSocket Middleware Performance Benchmarks", () => {
  let factory: WebSocketMiddlewareChainFactory;

  beforeEach(() => {
    factory = new WebSocketMiddlewareChainFactory(mockLogger, mockMetrics);
  });

  describe("Authentication Performance", () => {
    it("should meet <50ms authentication target", async () => {
      const config: WebSocketMiddlewareChainConfig = {
        ...WEBSOCKET_CHAIN_PRESETS.PRODUCTION,
        auth: {
          ...WEBSOCKET_CHAIN_PRESETS.PRODUCTION.auth,
          name: "auth-perf-test",
        },
      };

      const chain = factory.createComplete(config, mockSessionManager);
      const executor = chain.createExecutor();

      const context = createMockContext();
      const next = vi.fn();

      const startTime = performance.now();
      await executor(context, next);
      const executionTime = performance.now() - startTime;

      expect(executionTime).toBeLessThan(50);
      expect(next).toHaveBeenCalled();
    });

    it("should handle 1000+ concurrent connections", async () => {
      const config: WebSocketMiddlewareChainConfig = {
        ...WEBSOCKET_CHAIN_PRESETS.HIGH_THROUGHPUT,
        auth: {
          ...WEBSOCKET_CHAIN_PRESETS.HIGH_THROUGHPUT.auth,
          name: "concurrent-test",
        },
      };

      const chain = factory.createComplete(config, mockSessionManager);
      const executor = chain.createExecutor();

      // Create 1000 concurrent authentication requests
      const CONCURRENT_CONNECTIONS = 1000;
      const promises = Array.from({ length: CONCURRENT_CONNECTIONS }, () => {
        const context = createMockContext();
        const next = vi.fn();
        return executor(context, next);
      });

      const startTime = performance.now();
      const results = await Promise.allSettled(promises);
      const totalTime = performance.now() - startTime;

      const successfulResults = results.filter((r) => r.status === "fulfilled");
      const failedResults = results.filter((r) => r.status === "rejected");

      expect(successfulResults.length).toBe(CONCURRENT_CONNECTIONS);
      expect(failedResults.length).toBe(0);
      expect(totalTime).toBeLessThan(5000); // All requests within 5 seconds

      // Average should be well under target
      const averageTime = totalTime / CONCURRENT_CONNECTIONS;
      expect(averageTime).toBeLessThan(5);
    });

    it("should achieve <10ms session lookup target", async () => {
      const minimalChain = factory.createMinimal(
        {
          name: "session-lookup-test",
          requireAuth: true,
          jwtSecret: "test-secret",
        },
        mockSessionManager
      );

      const executor = minimalChain.createExecutor();
      const context = createMockContext();
      const next = vi.fn();

      // Measure just the session lookup portion
      const startTime = performance.now();
      await executor(context, next);
      const executionTime = performance.now() - startTime;

      expect(executionTime).toBeLessThan(10);
      expect(mockSessionManager.getSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("Memory Usage", () => {
    it("should maintain stable memory usage under load", async () => {
      const config: WebSocketMiddlewareChainConfig = {
        ...WEBSOCKET_CHAIN_PRESETS.HIGH_THROUGHPUT,
        auth: {
          ...WEBSOCKET_CHAIN_PRESETS.HIGH_THROUGHPUT.auth,
          name: "memory-test",
        },
      };

      const chain = factory.createComplete(config, mockSessionManager);
      const executor = chain.createExecutor();

      // Measure initial memory usage
      const initialMemory = process.memoryUsage();

      // Process many requests to check for memory leaks
      const BATCH_SIZE = 100;
      const BATCHES = 5;

      for (let batch = 0; batch < BATCHES; batch++) {
        const promises = Array.from({ length: BATCH_SIZE }, () => {
          const context = createMockContext();
          const next = vi.fn();
          return executor(context, next);
        });

        await Promise.allSettled(promises);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Memory increase should be minimal (< 10MB for 500 requests)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    it("should efficiently handle middleware chain statistics", async () => {
      const config: WebSocketMiddlewareChainConfig = {
        ...WEBSOCKET_CHAIN_PRESETS.PRODUCTION,
        auth: {
          ...WEBSOCKET_CHAIN_PRESETS.PRODUCTION.auth,
          name: "stats-test",
        },
      };

      const chain = factory.createComplete(config, mockSessionManager);

      // Get stats multiple times to ensure efficiency
      const iterations = 1000;
      const startTime = performance.now();

      for (let i = 0; i < iterations; i++) {
        chain.getChainStats();
      }

      const totalTime = performance.now() - startTime;
      const averageTime = totalTime / iterations;

      // Should be very fast to get stats
      expect(averageTime).toBeLessThan(1);
    });
  });

  describe("Throughput Benchmarks", () => {
    it("should process messages at high throughput", async () => {
      const config: WebSocketMiddlewareChainConfig = {
        ...WEBSOCKET_CHAIN_PRESETS.HIGH_THROUGHPUT,
        auth: {
          ...WEBSOCKET_CHAIN_PRESETS.HIGH_THROUGHPUT.auth,
          name: "throughput-test",
        },
      };

      const chain = factory.createComplete(config, mockSessionManager);
      const executor = chain.createExecutor();

      const MESSAGE_COUNT = 10000;
      const contexts = Array.from({ length: MESSAGE_COUNT }, () =>
        createMockContext()
      );

      const startTime = performance.now();

      // Process messages in smaller batches to simulate real-world usage
      const BATCH_SIZE = 100;
      for (let i = 0; i < MESSAGE_COUNT; i += BATCH_SIZE) {
        const batch = contexts.slice(i, i + BATCH_SIZE);
        const promises = batch.map((context) => {
          const next = vi.fn();
          return executor(context, next);
        });
        await Promise.allSettled(promises);
      }

      const totalTime = performance.now() - startTime;
      const messagesPerSecond = (MESSAGE_COUNT / totalTime) * 1000;

      // Should achieve high throughput (target: >1000 messages/second)
      expect(messagesPerSecond).toBeGreaterThan(1000);
    });

    it("should handle burst traffic patterns", async () => {
      const chain = factory.createPerformanceOptimized(
        {
          name: "burst-test",
          requireAuth: true,
          jwtSecret: "test-secret",
        },
        mockSessionManager
      );

      const executor = chain.createExecutor();

      // Simulate burst patterns: periods of high activity followed by low activity
      const bursts = [
        { connections: 500, interval: 1000 }, // 500 connections in 1 second
        { connections: 100, interval: 2000 }, // 100 connections in 2 seconds
        { connections: 1000, interval: 500 }, // 1000 connections in 0.5 seconds
      ];

      for (const burst of bursts) {
        const promises = Array.from({ length: burst.connections }, () => {
          const context = createMockContext();
          const next = vi.fn();
          return executor(context, next);
        });

        const startTime = performance.now();
        const results = await Promise.allSettled(promises);
        const burstTime = performance.now() - startTime;

        expect(burstTime).toBeLessThan(burst.interval);
        expect(results.filter((r) => r.status === "fulfilled").length).toBe(
          burst.connections
        );

        // Wait before next burst
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });
  });

  describe("Scalability Tests", () => {
    it("should maintain performance with complex middleware chains", async () => {
      // Create a complex chain with all available middleware
      const config: WebSocketMiddlewareChainConfig = {
        auth: {
          name: "complex-auth",
          requireAuth: true,
          jwtSecret: "test-secret",
          messagePermissions: {
            test1: ["perm1", "perm2"],
            test2: ["perm3", "perm4"],
            test3: ["perm5", "perm6"],
          },
          messageRoles: {
            admin1: ["admin"],
            admin2: ["admin", "moderator"],
            user1: ["user"],
          },
        },
        originValidation: {
          name: "origin-validation",
          allowedOrigins: [
            "https://test1.com",
            "https://test2.com",
            "https://*.test3.com",
          ],
          requireOrigin: true,
          allowCredentials: true,
        },
        rateLimit: {
          name: "rate-limit",
          windowMs: 60000,
          maxRequests: 100,
          skipSuccessfulRequests: true,
        },
        enableMetrics: true,
        enableDetailedLogging: true,
        defaultCircuitBreaker: {
          failureThreshold: 5,
          recoveryTimeout: 10000,
          halfOpenMaxCalls: 3,
        },
        defaultRetry: {
          maxRetries: 2,
          baseDelay: 50,
          maxDelay: 500,
          backoffMultiplier: 2,
        },
      };

      const chain = factory.createComplete(config, mockSessionManager);
      const executor = chain.createExecutor();

      // Test with various message types and contexts
      const testScenarios = [
        { messageType: "test1", expectSuccess: true },
        { messageType: "test2", expectSuccess: true },
        { messageType: "admin1", expectSuccess: true },
        { messageType: "unknown", expectSuccess: true }, // Should pass with no specific requirements
      ];

      for (const scenario of testScenarios) {
        const context = createMockContext({
          message: { type: scenario.messageType, payload: {} },
        });
        const next = vi.fn();

        const startTime = performance.now();

        if (scenario.expectSuccess) {
          await executor(context, next);
          expect(next).toHaveBeenCalled();
        } else {
          await expect(executor(context, next)).rejects.toThrow();
        }

        const executionTime = performance.now() - startTime;
        expect(executionTime).toBeLessThan(100); // Even complex chains should be fast
      }
    });

    it("should handle middleware registration and unregistration efficiently", async () => {
      const chain = factory.createMinimal(
        {
          name: "registration-test",
          requireAuth: true,
          jwtSecret: "test-secret",
        },
        mockSessionManager
      );

      // Test adding and removing middleware dynamically
      const middlewareCount = 50;
      const registrationTimes: number[] = [];
      const unregistrationTimes: number[] = [];

      // Register middleware
      for (let i = 0; i < middlewareCount; i++) {
        const config = {
          name: `dynamic-middleware-${i}`,
          priority: 20,
          optional: true,
        };

        const middleware = vi.fn(
          async (context: WebSocketContext, next: () => Promise<void>) => {
            await next();
          }
        );

        const startTime = performance.now();
        chain.register(config, middleware);
        const registrationTime = performance.now() - startTime;
        registrationTimes.push(registrationTime);
      }

      // Unregister middleware (in reverse order to avoid dependency issues)
      for (let i = middlewareCount - 1; i >= 0; i--) {
        const startTime = performance.now();
        chain.unregister(`dynamic-middleware-${i}`);
        const unregistrationTime = performance.now() - startTime;
        unregistrationTimes.push(unregistrationTime);
      }

      // All registration/unregistration operations should be fast
      const maxRegistrationTime = Math.max(...registrationTimes);
      const maxUnregistrationTime = Math.max(...unregistrationTimes);

      expect(maxRegistrationTime).toBeLessThan(10);
      expect(maxUnregistrationTime).toBeLessThan(10);

      // Final state should be clean
      const finalStats = chain.getChainStats();
      expect(finalStats.middlewareCount).toBe(1); // Only the auth middleware should remain
    });
  });

  describe("Error Recovery Performance", () => {
    it("should recover quickly from circuit breaker states", async () => {
      let shouldFail = true;
      const flakyMiddleware = vi.fn(
        async (context: WebSocketContext, next: () => Promise<void>) => {
          if (shouldFail) {
            throw new Error("Simulated failure");
          }
          await next();
        }
      );

      const chain = factory.createMinimal(
        {
          name: "recovery-test",
          requireAuth: true,
          jwtSecret: "test-secret",
        },
        mockSessionManager
      );

      chain.register(
        {
          name: "flaky",
          priority: 10,
          circuitBreakerConfig: {
            failureThreshold: 2,
            recoveryTimeout: 100, // Very short for testing
            halfOpenMaxCalls: 2,
          },
        },
        flakyMiddleware
      );

      const executor = chain.createExecutor();
      const context = createMockContext();

      // Trigger failures to open circuit breaker
      await expect(executor(context, vi.fn())).rejects.toThrow();
      await expect(executor(context, vi.fn())).rejects.toThrow();

      // Circuit should be open now
      await expect(executor(context, vi.fn())).rejects.toThrow(
        "Circuit breaker OPEN"
      );

      // Wait for recovery timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Fix the middleware
      shouldFail = false;

      // Recovery should happen quickly
      const recoveryStart = performance.now();
      await executor(context, vi.fn()); // This should succeed and close the circuit
      const recoveryTime = performance.now() - recoveryStart;

      expect(recoveryTime).toBeLessThan(50);

      // Subsequent calls should be fast
      const fastCallStart = performance.now();
      await executor(context, vi.fn());
      const fastCallTime = performance.now() - fastCallStart;

      expect(fastCallTime).toBeLessThan(10);
    });

    it("should handle retry scenarios efficiently", async () => {
      let attemptCount = 0;
      const retryMiddleware = vi.fn(
        async (context: WebSocketContext, next: () => Promise<void>) => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error(`Attempt ${attemptCount} failed`);
          }
          await next();
        }
      );

      const chain = factory.createMinimal(
        {
          name: "retry-test",
          requireAuth: true,
          jwtSecret: "test-secret",
        },
        mockSessionManager
      );

      chain.register(
        {
          name: "retry",
          priority: 10,
          retryConfig: {
            maxRetries: 3,
            baseDelay: 10, // Small delays for testing
            maxDelay: 50,
            backoffMultiplier: 1.5,
          },
        },
        retryMiddleware
      );

      const executor = chain.createExecutor();
      const context = createMockContext();

      const startTime = performance.now();
      await executor(context, vi.fn());
      const totalTime = performance.now() - startTime;

      expect(attemptCount).toBe(3);
      // Should complete retries quickly despite multiple attempts
      expect(totalTime).toBeLessThan(200);
    });
  });
});

describe("Real-world Performance Scenarios", () => {
  let factory: WebSocketMiddlewareChainFactory;

  beforeEach(() => {
    factory = new WebSocketMiddlewareChainFactory(mockLogger, mockMetrics);
  });

  it("should handle e-commerce cart recovery scenario", async () => {
    const config: WebSocketMiddlewareChainConfig = {
      ...WEBSOCKET_CHAIN_PRESETS.PRODUCTION,
      auth: {
        ...WEBSOCKET_CHAIN_PRESETS.PRODUCTION.auth,
        name: "cart-recovery",
        messagePermissions: {
          "cart.update": ["cart:write"],
          "cart.checkout": ["cart:checkout", "payment:process"],
          "cart.abandon": ["cart:read"],
        },
      },
    };

    const chain = factory.createComplete(config, mockSessionManager);
    const executor = chain.createExecutor();

    // Simulate typical cart recovery messages
    const cartMessages = [
      { type: "cart.view", payload: { cartId: "cart_123" } },
      { type: "cart.update", payload: { cartId: "cart_123", items: [] } },
      {
        type: "cart.abandon",
        payload: { cartId: "cart_123", reason: "price" },
      },
    ];

    const startTime = performance.now();

    for (const message of cartMessages) {
      const context = createMockContext({ message });
      const next = vi.fn();
      await executor(context, next);
      expect(next).toHaveBeenCalled();
    }

    const totalTime = performance.now() - startTime;
    expect(totalTime).toBeLessThan(150); // All cart operations under 150ms
  });

  it("should handle real-time analytics dashboard scenario", async () => {
    const config: WebSocketMiddlewareChainConfig = {
      ...WEBSOCKET_CHAIN_PRESETS.HIGH_THROUGHPUT,
      auth: {
        ...WEBSOCKET_CHAIN_PRESETS.HIGH_THROUGHPUT.auth,
        name: "analytics-dashboard",
        messagePermissions: {
          "analytics.subscribe": ["analytics:read"],
          "analytics.query": ["analytics:query"],
          "analytics.export": ["analytics:export"],
        },
      },
    };

    const chain = factory.createComplete(config, mockSessionManager);
    const executor = chain.createExecutor();

    // Simulate high-frequency analytics updates
    const analyticsMessages = Array.from({ length: 1000 }, (_, i) => ({
      type: "analytics.update",
      payload: {
        metric: "page_views",
        value: Math.floor(Math.random() * 1000),
        timestamp: Date.now() + i,
      },
    }));

    const startTime = performance.now();

    // Process in batches to simulate real-time streaming
    const BATCH_SIZE = 50;
    for (let i = 0; i < analyticsMessages.length; i += BATCH_SIZE) {
      const batch = analyticsMessages.slice(i, i + BATCH_SIZE);
      const promises = batch.map((message) => {
        const context = createMockContext({ message });
        const next = vi.fn();
        return executor(context, next);
      });
      await Promise.allSettled(promises);
    }

    const totalTime = performance.now() - startTime;
    const messagesPerSecond = (analyticsMessages.length / totalTime) * 1000;

    // Should handle high-frequency analytics efficiently
    expect(messagesPerSecond).toBeGreaterThan(2000);
    expect(totalTime).toBeLessThan(2000);
  });
});
