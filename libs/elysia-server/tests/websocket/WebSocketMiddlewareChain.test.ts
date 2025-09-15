// No Jest globals import needed, Jest provides these globally

// Mock monitoring libraries
const MetricsCollector = {
  getInstance: jest.fn(() => ({
    recordCounter: jest.fn(),
    recordTimer: jest.fn(),
    recordGauge: jest.fn(),
  })),
};

// Type for the metrics instance
type MockMetricsInstance = {
  recordCounter: jest.MockedFunction<
    (name: string, value?: number, labels?: Record<string, string>) => void
  >;
  recordTimer: jest.MockedFunction<
    (name: string, value: number, labels?: Record<string, string>) => void
  >;
  recordGauge: jest.MockedFunction<
    (name: string, value: number, labels?: Record<string, string>) => void
  >;
};
import {
  WebSocketMiddlewareChain,
  MiddlewarePriority,
  type MiddlewareConfig,
} from "../../src/middleware/base/middlewareChain/WebSocketMiddlewareChain";
import type {
  WebSocketContext,
  WebSocketMiddlewareFunction,
} from "../../src/middleware/types";

// Mock WebSocket context
const createMockContext = (): WebSocketContext => ({
  ws: {
    send: jest.fn(),
    close: jest.fn(),
    readyState: 0,
  },
  connectionId: "test-conn-123",
  message: { type: "test", payload: { data: "test" } },
  metadata: {
    connectedAt: new Date(),
    lastActivity: new Date(),
    messageCount: 1,
    clientIp: "192.168.1.1",
    userAgent: "test-agent",
    headers: { origin: "https://test.com" },
    query: {},
  },
  authenticated: false,
  executionOrder: [], // Initialize execution order array
});

// Mock middleware functions
const createTestMiddleware = (
  name: string,
  delay = 0,
  shouldFail = false
): WebSocketMiddlewareFunction => {
  return jest.fn(
    async (context: WebSocketContext, next: () => Promise<void>) => {
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Track execution order BEFORE potentially failing
      if (!context.executionOrder) {
        context.executionOrder = [];
      }
      (context.executionOrder as string[]).push(name);

      if (shouldFail) {
        throw new Error(`${name} middleware failed`);
      }

      await next();
    }
  );
};

describe("WebSocketMiddlewareChain", () => {
  let chain: WebSocketMiddlewareChain;
  let metrics: MockMetricsInstance;

  beforeEach(() => {
    metrics = MetricsCollector.getInstance();
    chain = new WebSocketMiddlewareChain(metrics, "test-chain");
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("Middleware Registration", () => {
    it("should register middleware successfully", () => {
      const config: MiddlewareConfig = {
        name: "test-middleware",
        priority: MiddlewarePriority.NORMAL,
      };
      const middleware = createTestMiddleware("test");

      expect(() => chain.register(config, middleware)).not.toThrow();

      const stats = chain.getChainStats();
      expect(stats.middlewareCount).toBe(1);
      expect(stats.executionOrder).toContain("test-middleware");
    });

    it("should order middleware by priority", () => {
      const criticalConfig: MiddlewareConfig = {
        name: "critical",
        priority: MiddlewarePriority.CRITICAL,
      };
      const normalConfig: MiddlewareConfig = {
        name: "normal",
        priority: MiddlewarePriority.NORMAL,
      };
      const lowConfig: MiddlewareConfig = {
        name: "low",
        priority: MiddlewarePriority.LOW,
      };

      // Register in reverse priority order
      chain.register(lowConfig, createTestMiddleware("low"));
      chain.register(normalConfig, createTestMiddleware("normal"));
      chain.register(criticalConfig, createTestMiddleware("critical"));

      const stats = chain.getChainStats();
      expect(stats.executionOrder).toEqual(["critical", "normal", "low"]);
    });

    it("should handle dependencies correctly", () => {
      const baseConfig: MiddlewareConfig = {
        name: "base",
        priority: MiddlewarePriority.NORMAL,
      };
      const dependentConfig: MiddlewareConfig = {
        name: "dependent",
        priority: MiddlewarePriority.NORMAL,
        dependencies: ["base"],
      };

      chain.register(baseConfig, createTestMiddleware("base"));

      expect(() =>
        chain.register(dependentConfig, createTestMiddleware("dependent"))
      ).not.toThrow();

      const stats = chain.getChainStats();
      const baseIndex = stats.executionOrder.indexOf("base");
      const dependentIndex = stats.executionOrder.indexOf("dependent");
      expect(baseIndex).toBeLessThan(dependentIndex);
    });

    it("should throw error for missing dependency", () => {
      const config: MiddlewareConfig = {
        name: "dependent",
        priority: MiddlewarePriority.NORMAL,
        dependencies: ["missing"],
      };

      expect(() =>
        chain.register(config, createTestMiddleware("dependent"))
      ).toThrow("Middleware dependency 'missing' not found");
    });

    it("should detect circular dependencies", () => {
      const config1: MiddlewareConfig = {
        name: "middleware1",
        priority: MiddlewarePriority.NORMAL,
        dependencies: ["middleware2"],
      };
      const config2: MiddlewareConfig = {
        name: "middleware2",
        priority: MiddlewarePriority.NORMAL,
        dependencies: ["middleware1"],
      };

      chain.register(config1, createTestMiddleware("middleware1"));

      expect(() =>
        chain.register(config2, createTestMiddleware("middleware2"))
      ).toThrow("Circular dependency detected");
    });
  });

  describe("Middleware Execution", () => {
    it("should execute all middleware in correct order", async () => {
      const config1: MiddlewareConfig = {
        name: "first",
        priority: MiddlewarePriority.CRITICAL,
      };
      const config2: MiddlewareConfig = {
        name: "second",
        priority: MiddlewarePriority.HIGH,
      };
      const config3: MiddlewareConfig = {
        name: "third",
        priority: MiddlewarePriority.NORMAL,
      };

      chain.register(config1, createTestMiddleware("first"));
      chain.register(config2, createTestMiddleware("second"));
      chain.register(config3, createTestMiddleware("third"));

      const context = createMockContext();
      await chain.execute(context);

      expect(context.executionOrder).toEqual(["first", "second", "third"]);
    });

    it("should stop execution on required middleware failure", async () => {
      const requiredConfig: MiddlewareConfig = {
        name: "required",
        priority: MiddlewarePriority.CRITICAL,
        optional: false,
      };
      const afterConfig: MiddlewareConfig = {
        name: "after",
        priority: MiddlewarePriority.HIGH,
      };

      chain.register(requiredConfig, createTestMiddleware("required", 0, true));
      chain.register(afterConfig, createTestMiddleware("after"));

      const context = createMockContext();

      await expect(chain.execute(context)).rejects.toThrow(
        "Required middleware 'required' failed"
      );

      expect(context.executionOrder).toEqual(["required"]);
    });

    it("should continue execution on optional middleware failure", async () => {
      const optionalConfig: MiddlewareConfig = {
        name: "optional",
        priority: MiddlewarePriority.CRITICAL,
        optional: true,
      };
      const afterConfig: MiddlewareConfig = {
        name: "after",
        priority: MiddlewarePriority.HIGH,
      };

      chain.register(optionalConfig, createTestMiddleware("optional", 0, true));
      chain.register(afterConfig, createTestMiddleware("after"));

      const context = createMockContext();
      await chain.execute(context);

      expect(context.executionOrder).toEqual(["optional", "after"]);
    });
  });

  describe("Circuit Breaker", () => {
    it("should trigger circuit breaker after failure threshold", async () => {
      const config: MiddlewareConfig = {
        name: "failing",
        priority: MiddlewarePriority.CRITICAL,
        circuitBreakerConfig: {
          failureThreshold: 2,
          recoveryTimeout: 1000,
          halfOpenMaxCalls: 2,
        },
      };

      chain.register(config, createTestMiddleware("failing", 0, true));

      const context = createMockContext();

      // First failure
      await expect(chain.execute(context)).rejects.toThrow();

      // Second failure - should trigger circuit breaker
      await expect(chain.execute(context)).rejects.toThrow();

      // Third call - circuit breaker should be OPEN
      await expect(chain.execute(context)).rejects.toThrow(
        "Circuit breaker OPEN"
      );

      const stats = chain.getChainStats();
      expect(stats.individualStats.failing.circuitBreakerState).toBe("open");
    });

    it("should recover from circuit breaker after timeout", async () => {
      const config: MiddlewareConfig = {
        name: "recovering",
        priority: MiddlewarePriority.CRITICAL,
        circuitBreakerConfig: {
          failureThreshold: 1,
          recoveryTimeout: 100, // Short timeout for test
          halfOpenMaxCalls: 1,
        },
      };

      let shouldFail = true;
      const middleware = jest.fn(
        async (context: WebSocketContext, next: () => Promise<void>) => {
          if (shouldFail) {
            throw new Error("Temporary failure");
          }
          await next();
        }
      );

      chain.register(config, middleware);

      const context = createMockContext();

      // Trigger circuit breaker
      await expect(chain.execute(context)).rejects.toThrow();

      // Wait for recovery timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Fix the issue
      shouldFail = false;

      // Should work now
      await expect(chain.execute(context)).resolves.not.toThrow();

      const stats = chain.getChainStats();
      expect(stats.individualStats.recovering.circuitBreakerState).toBe(
        "closed"
      );
    });
  });

  describe("Retry Logic", () => {
    it("should retry failed middleware", async () => {
      let attempts = 0;
      const retryMiddleware = jest.fn(
        async (context: WebSocketContext, next: () => Promise<void>) => {
          attempts++;
          if (attempts < 3) {
            throw new Error(`Attempt ${attempts} failed`);
          }
          await next();
        }
      );

      const config: MiddlewareConfig = {
        name: "retry",
        priority: MiddlewarePriority.NORMAL,
        retryConfig: {
          maxRetries: 3,
          baseDelay: 10,
          maxDelay: 100,
          backoffMultiplier: 2,
        },
      };

      chain.register(config, retryMiddleware);

      const context = createMockContext();
      await chain.execute(context);

      expect(attempts).toBe(3);
      expect(retryMiddleware).toHaveBeenCalledTimes(3);
    });

    it("should fail after max retries", async () => {
      const alwaysFailMiddleware = jest.fn(() => {
        throw new Error("Always fails");
      });

      const config: MiddlewareConfig = {
        name: "always-fail",
        priority: MiddlewarePriority.NORMAL,
        retryConfig: {
          maxRetries: 2,
          baseDelay: 10,
          maxDelay: 100,
          backoffMultiplier: 2,
        },
      };

      chain.register(config, alwaysFailMiddleware);

      const context = createMockContext();

      await expect(chain.execute(context)).rejects.toThrow("Always fails");
      expect(alwaysFailMiddleware).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
  });

  describe("Metrics Collection", () => {
    it("should record execution metrics", async () => {
      const recordCounterSpy = jest.spyOn(metrics, "recordCounter");
      const recordTimerSpy = jest.spyOn(metrics, "recordTimer");

      const config: MiddlewareConfig = {
        name: "metrics-test",
        priority: MiddlewarePriority.NORMAL,
      };

      chain.register(config, createTestMiddleware("metrics-test"));

      const context = createMockContext();
      await chain.execute(context);

      expect(recordCounterSpy).toHaveBeenCalledWith(
        "websocket_middleware_chain_success",
        1,
        expect.any(Object)
      );
      expect(recordTimerSpy).toHaveBeenCalledWith(
        "websocket_middleware_chain_duration",
        expect.any(Number),
        expect.any(Object)
      );
    });

    it("should update execution stats", async () => {
      const config: MiddlewareConfig = {
        name: "stats-test",
        priority: MiddlewarePriority.NORMAL,
      };

      chain.register(config, createTestMiddleware("stats-test", 50));

      const context = createMockContext();
      await chain.execute(context);

      const stats = chain.getChainStats();
      const middlewareStats = stats.individualStats["stats-test"];

      expect(middlewareStats.totalExecutions).toBe(1);
      expect(middlewareStats.totalFailures).toBe(0);
      expect(middlewareStats.averageExecutionTime).toBeGreaterThan(0);
    });
  });

  describe("Middleware Unregistration", () => {
    it("should unregister middleware successfully", () => {
      const config: MiddlewareConfig = {
        name: "to-remove",
        priority: MiddlewarePriority.NORMAL,
      };

      chain.register(config, createTestMiddleware("to-remove"));
      expect(chain.getChainStats().middlewareCount).toBe(1);

      const removed = chain.unregister("to-remove");
      expect(removed).toBe(true);
      expect(chain.getChainStats().middlewareCount).toBe(0);
    });

    it("should prevent unregistration if dependents exist", () => {
      const baseConfig: MiddlewareConfig = {
        name: "base",
        priority: MiddlewarePriority.NORMAL,
      };
      const dependentConfig: MiddlewareConfig = {
        name: "dependent",
        priority: MiddlewarePriority.NORMAL,
        dependencies: ["base"],
      };

      chain.register(baseConfig, createTestMiddleware("base"));
      chain.register(dependentConfig, createTestMiddleware("dependent"));

      expect(() => chain.unregister("base")).toThrow(
        "Cannot unregister 'base': it has dependents: dependent"
      );
    });

    it("should return false for non-existent middleware", () => {
      const removed = chain.unregister("non-existent");
      expect(removed).toBe(false);
    });
  });

  describe("Factory Method", () => {
    it("should create executable middleware function", async () => {
      const config: MiddlewareConfig = {
        name: "executor-test",
        priority: MiddlewarePriority.NORMAL,
      };

      chain.register(config, createTestMiddleware("executor-test"));

      const executor = chain.createExecutor();
      const context = createMockContext();
      const next = jest.fn();

      await executor(context, next);

      expect(context.executionOrder).toEqual(["executor-test"]);
      expect(next).toHaveBeenCalled();
    });
  });
});

describe("Performance Tests", () => {
  let chain: WebSocketMiddlewareChain;

  beforeEach(() => {
    const metrics = MetricsCollector.getInstance();
    chain = new WebSocketMiddlewareChain(metrics, "test-chain");
  });

  it("should handle large number of middleware efficiently", async () => {
    const MIDDLEWARE_COUNT = 100;

    // Register many middleware
    for (let i = 0; i < MIDDLEWARE_COUNT; i++) {
      const config: MiddlewareConfig = {
        name: `middleware-${i}`,
        priority: MiddlewarePriority.NORMAL,
      };
      chain.register(config, createTestMiddleware(`middleware-${i}`));
    }

    const context = createMockContext();
    const startTime = performance.now();

    await chain.execute(context);

    const executionTime = performance.now() - startTime;

    expect(context.executionOrder).toHaveLength(MIDDLEWARE_COUNT);
    expect(executionTime).toBeLessThan(1000); // Should complete in under 1 second
  });

  it("should meet performance targets for authentication chain", async () => {
    // Simulate typical WebSocket auth middleware chain
    const configs = [
      { name: "origin-validation", priority: MiddlewarePriority.CRITICAL },
      { name: "rate-limit", priority: MiddlewarePriority.CRITICAL },
      { name: "authentication", priority: MiddlewarePriority.CRITICAL },
      { name: "authorization", priority: MiddlewarePriority.HIGH },
      { name: "metrics", priority: MiddlewarePriority.LOW },
    ];

    configs.forEach((config) => {
      chain.register(
        config as MiddlewareConfig,
        createTestMiddleware(config.name, 2) // 2ms delay per middleware
      );
    });

    const context = createMockContext();
    const startTime = performance.now();

    await chain.execute(context);

    const executionTime = performance.now() - startTime;

    // Target: <50ms for complete WebSocket authentication
    expect(executionTime).toBeLessThan(50);
    expect(context.executionOrder).toEqual([
      "origin-validation",
      "rate-limit",
      "authentication",
      "authorization",
      "metrics",
    ]);
  });
});
