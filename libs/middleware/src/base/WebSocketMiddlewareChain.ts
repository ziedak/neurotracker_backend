import { MetricsCollector, type ILogger } from "@libs/monitoring";
import { WebSocketContext, WebSocketMiddlewareFunction } from "../types";

/**
 * Middleware execution priority levels
 */
export enum MiddlewarePriority {
  CRITICAL = 0, // Security, authentication
  HIGH = 10, // Authorization, rate limiting
  NORMAL = 20, // Business logic, validation
  LOW = 30, // Logging, metrics, cleanup
}

/**
 * Middleware configuration interface
 */
export interface MiddlewareConfig {
  name: string;
  priority: MiddlewarePriority;
  dependencies?: string[] | undefined;
  optional?: boolean | undefined;
  circuitBreakerConfig?: CircuitBreakerConfig | undefined;
  retryConfig?: RetryConfig | undefined;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  halfOpenMaxCalls: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Circuit breaker states
 */
enum CircuitBreakerState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

/**
 * Middleware execution result
 */
interface MiddlewareResult {
  success: boolean;
  error?: Error;
  executionTime: number;
  retryAttempt?: number;
}

/**
 * Circuit breaker for middleware execution
 */
class MiddlewareCircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;

  constructor(
    private readonly config: CircuitBreakerConfig,
    private readonly middlewareName: string,
    private readonly logger: ILogger
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.config.recoveryTimeout) {
        throw new Error(
          `Circuit breaker OPEN for middleware: ${this.middlewareName}`
        );
      } else {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenCalls = 0;
        this.logger.info(`Circuit breaker transitioning to HALF_OPEN`, {
          middleware: this.middlewareName,
        });
      }
    }

    try {
      const result = await operation();

      // Success case
      if (this.state === CircuitBreakerState.HALF_OPEN) {
        this.halfOpenCalls++;
        if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
          this.state = CircuitBreakerState.CLOSED;
          this.failureCount = 0;
          this.logger.info(`Circuit breaker transitioning to CLOSED`, {
            middleware: this.middlewareName,
          });
        }
      } else if (this.state === CircuitBreakerState.CLOSED) {
        this.failureCount = Math.max(0, this.failureCount - 1);
      }

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.config.failureThreshold) {
        this.state = CircuitBreakerState.OPEN;
        this.logger.warn(`Circuit breaker transitioning to OPEN`, {
          middleware: this.middlewareName,
          failureCount: this.failureCount,
          error: (error as Error).message,
        });
      }

      throw error;
    }
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

/**
 * Registered middleware with execution context
 */
interface RegisteredMiddleware {
  config: MiddlewareConfig;
  middleware: WebSocketMiddlewareFunction;
  circuitBreaker?: MiddlewareCircuitBreaker | undefined;
  executionStats: {
    totalExecutions: number;
    totalFailures: number;
    averageExecutionTime: number;
    lastExecutionTime?: number;
  };
}

/**
 * Production-grade WebSocket Middleware Chain with advanced composition capabilities
 * Provides ordered execution, dependency resolution, circuit breakers, and error isolation
 */
export class WebSocketMiddlewareChain {
  private readonly middleware: Map<string, RegisteredMiddleware> = new Map();
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector | undefined;
  private executionOrder: string[] = [];

  constructor(logger: ILogger, metrics?: MetricsCollector) {
    this.logger = createLogger( "WebSocketMiddlewareChain" });
    this.metrics = metrics;
  }

  /**
   * Register a middleware in the chain
   */
  register(
    config: MiddlewareConfig,
    middleware: WebSocketMiddlewareFunction
  ): this {
    // Validate dependencies exist
    if (config.dependencies) {
      for (const dep of config.dependencies) {
        if (!this.middleware.has(dep)) {
          throw new Error(
            `Middleware dependency '${dep}' not found for '${config.name}'`
          );
        }
      }
    }

    // Create circuit breaker if configured
    let circuitBreaker: MiddlewareCircuitBreaker | undefined;
    if (config.circuitBreakerConfig) {
      circuitBreaker = new MiddlewareCircuitBreaker(
        config.circuitBreakerConfig,
        config.name,
        this.logger
      );
    }

    // Register middleware
    const registered: RegisteredMiddleware = {
      config,
      middleware,
      circuitBreaker,
      executionStats: {
        totalExecutions: 0,
        totalFailures: 0,
        averageExecutionTime: 0,
      },
    };

    this.middleware.set(config.name, registered);

    // Rebuild execution order
    this.buildExecutionOrder();

    this.logger.info(`Middleware registered: ${config.name}`, {
      priority: config.priority,
      dependencies: config.dependencies,
      hasCircuitBreaker: !!circuitBreaker,
    });

    return this;
  }

  /**
   * Unregister middleware from the chain
   */
  unregister(name: string): boolean {
    if (!this.middleware.has(name)) {
      return false;
    }

    // Check if any middleware depends on this one
    const dependents = Array.from(this.middleware.values())
      .filter((m) => m.config.dependencies?.includes(name))
      .map((m) => m.config.name);

    if (dependents.length > 0) {
      throw new Error(
        `Cannot unregister '${name}': it has dependents: ${dependents.join(
          ", "
        )}`
      );
    }

    this.middleware.delete(name);
    this.buildExecutionOrder();

    this.logger.info(`Middleware unregistered: ${name}`);
    return true;
  }

  /**
   * Execute the complete middleware chain
   */
  async execute(context: WebSocketContext): Promise<void> {
    const startTime = performance.now();
    const executionId = this.generateExecutionId();

    this.logger.debug("Starting middleware chain execution", {
      executionId,
      middlewareCount: this.executionOrder.length,
      connectionId: context.connectionId,
    });

    try {
      await this.executeMiddlewareChain(context, executionId);

      const totalTime = performance.now() - startTime;
      await this.recordChainMetrics("success", totalTime, executionId);

      this.logger.debug("Middleware chain execution completed successfully", {
        executionId,
        totalTime: `${totalTime.toFixed(2)}ms`,
        connectionId: context.connectionId,
      });
    } catch (error) {
      const totalTime = performance.now() - startTime;
      await this.recordChainMetrics("failure", totalTime, executionId);

      this.logger.error("Middleware chain execution failed", error as Error, {
        executionId,
        totalTime: `${totalTime.toFixed(2)}ms`,
        connectionId: context.connectionId,
      });

      throw error;
    }
  }

  /**
   * Get middleware chain statistics
   */
  getChainStats() {
    const stats: Record<string, any> = {};

    for (const [name, registered] of this.middleware) {
      stats[name] = {
        ...registered.executionStats,
        circuitBreakerState: registered.circuitBreaker?.getState(),
        circuitBreakerMetrics: registered.circuitBreaker?.getMetrics(),
      };
    }

    return {
      middlewareCount: this.middleware.size,
      executionOrder: this.executionOrder,
      individualStats: stats,
    };
  }

  /**
   * Build middleware execution order based on priorities and dependencies
   */
  private buildExecutionOrder(): void {
    const middleware = Array.from(this.middleware.entries());

    // Sort by priority first (lower number = higher priority)
    middleware.sort(([, a], [, b]) => a.config.priority - b.config.priority);

    // Build dependency-aware execution order
    const ordered: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected involving '${name}'`);
      }

      visiting.add(name);

      const registered = this.middleware.get(name);
      if (registered?.config.dependencies) {
        for (const dep of registered.config.dependencies) {
          visit(dep);
        }
      }

      visiting.delete(name);
      visited.add(name);
      ordered.push(name);
    };

    // Visit all middleware
    for (const [name] of middleware) {
      visit(name);
    }

    this.executionOrder = ordered;

    this.logger.debug("Middleware execution order rebuilt", {
      order: this.executionOrder,
    });
  }

  /**
   * Execute middleware chain with error isolation
   */
  private async executeMiddlewareChain(
    context: WebSocketContext,
    executionId: string
  ): Promise<void> {
    const results: MiddlewareResult[] = [];

    for (const middlewareName of this.executionOrder) {
      const registered = this.middleware.get(middlewareName);
      if (!registered) continue;

      const result = await this.executeMiddleware(
        registered,
        context,
        executionId
      );
      results.push(result);

      // Stop execution if middleware failed and is not optional
      if (!result.success && !registered.config.optional) {
        throw new Error(
          `Required middleware '${middlewareName}' failed: ${result.error?.message}`
        );
      }
    }

    // Log execution summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    this.logger.debug("Middleware chain execution summary", {
      executionId,
      total: results.length,
      successful,
      failed,
      averageExecutionTime:
        results.reduce((sum, r) => sum + r.executionTime, 0) / results.length,
    });
  }

  /**
   * Execute individual middleware with circuit breaker and retry logic
   */
  private async executeMiddleware(
    registered: RegisteredMiddleware,
    context: WebSocketContext,
    executionId: string
  ): Promise<MiddlewareResult> {
    const { config, middleware, circuitBreaker } = registered;
    const startTime = performance.now();

    try {
      // Execute with circuit breaker if configured
      const executeOperation = async () => {
        return await this.executeWithRetry(
          middleware,
          context,
          config.retryConfig
        );
      };

      if (circuitBreaker) {
        await circuitBreaker.execute(executeOperation);
      } else {
        await executeOperation();
      }

      const executionTime = performance.now() - startTime;

      // Update execution stats
      this.updateExecutionStats(registered, executionTime, true);

      await this.recordMiddlewareMetrics(config.name, "success", executionTime);

      this.logger.debug(`Middleware executed successfully: ${config.name}`, {
        executionId,
        executionTime: `${executionTime.toFixed(2)}ms`,
      });

      return {
        success: true,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;

      // Update execution stats
      this.updateExecutionStats(registered, executionTime, false);

      await this.recordMiddlewareMetrics(config.name, "failure", executionTime);

      const errorMessage = (error as Error).message;
      this.logger.warn(`Middleware execution failed: ${config.name}`, {
        executionId,
        error: errorMessage,
        executionTime: `${executionTime.toFixed(2)}ms`,
        optional: config.optional,
      });

      return {
        success: false,
        error: error as Error,
        executionTime,
      };
    }
  }

  /**
   * Execute middleware with retry logic
   */
  private async executeWithRetry(
    middleware: WebSocketMiddlewareFunction,
    context: WebSocketContext,
    retryConfig?: RetryConfig
  ): Promise<void> {
    if (!retryConfig) {
      return await middleware(context, async () => {});
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        return await middleware(context, async () => {});
      } catch (error) {
        lastError = error as Error;

        if (attempt === retryConfig.maxRetries) {
          break; // No more retries
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          retryConfig.baseDelay *
            Math.pow(retryConfig.backoffMultiplier, attempt),
          retryConfig.maxDelay
        );

        this.logger.debug(`Retrying middleware execution`, {
          attempt: attempt + 1,
          maxRetries: retryConfig.maxRetries,
          delay: `${delay}ms`,
          error: lastError.message,
        });

        await this.sleep(delay);
      }
    }

    throw lastError || new Error("Retry execution failed");
  }

  /**
   * Update execution statistics for middleware
   */
  private updateExecutionStats(
    registered: RegisteredMiddleware,
    executionTime: number,
    success: boolean
  ): void {
    const stats = registered.executionStats;
    stats.totalExecutions++;
    stats.lastExecutionTime = Date.now();

    if (!success) {
      stats.totalFailures++;
    }

    // Update rolling average execution time
    stats.averageExecutionTime =
      (stats.averageExecutionTime * (stats.totalExecutions - 1) +
        executionTime) /
      stats.totalExecutions;
  }

  /**
   * Record chain-level metrics
   */
  private async recordChainMetrics(
    result: "success" | "failure",
    totalTime: number,
    executionId: string
  ): Promise<void> {
    if (!this.metrics) return;

    await Promise.all([
      this.metrics.recordCounter(`websocket_middleware_chain_${result}`, 1, {
        executionId,
        middlewareCount: this.executionOrder.length.toString(),
      }),
      this.metrics.recordTimer(
        "websocket_middleware_chain_duration",
        totalTime,
        {
          result,
          middlewareCount: this.executionOrder.length.toString(),
        }
      ),
    ]);
  }

  /**
   * Record individual middleware metrics
   */
  private async recordMiddlewareMetrics(
    middlewareName: string,
    result: "success" | "failure",
    executionTime: number
  ): Promise<void> {
    if (!this.metrics) return;

    await Promise.all([
      this.metrics.recordCounter(
        `websocket_middleware_execution_${result}`,
        1,
        {
          middleware: middlewareName,
        }
      ),
      this.metrics.recordTimer(
        "websocket_middleware_execution_duration",
        executionTime,
        {
          middleware: middlewareName,
          result,
        }
      ),
    ]);
  }

  /**
   * Generate unique execution ID for tracing
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a factory function that returns an executable middleware function
   */
  createExecutor(): WebSocketMiddlewareFunction {
    return async (context: WebSocketContext, next: () => Promise<void>) => {
      await this.execute(context);
      await next();
    };
  }
}
