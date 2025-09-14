import { MiddlewareContext, MiddlewareFunction } from "../../types";
import { createLogger, type ILogger } from "@libs/utils";
import { type IMetricsCollector } from "@libs/monitoring";

/**
 * Middleware configuration for HTTP middleware chain
 */
export interface HttpMiddlewareChainConfig {
  readonly name: string;
  readonly middlewares: readonly HttpMiddlewareChainItem[];
}

/**
 * Individual middleware configuration in chain
 */
export interface HttpMiddlewareChainItem {
  readonly name: string;
  readonly middleware: MiddlewareFunction;
  readonly priority?: number;
  readonly enabled?: boolean;
}

/**
 * Utility class for chaining multiple HTTP middleware functions
 * Handles priority ordering, error propagation, and execution statistics
 *
 * Features:
 * - Direct instantiation (no DI)
 * - Priority-based execution ordering
 * - Error isolation and propagation
 * - Execution metrics and monitoring
 * - Dynamic middleware management
 *
 * Usage:
 * ```typescript
 * const chain = new HttpMiddlewareChain(metrics, config);
 * const chainFunction = chain.execute();
 * app.use(chainFunction);
 * ```
 */
export class HttpMiddlewareChain {
  private readonly middlewares: Array<{
    name: string;
    middleware: MiddlewareFunction;
    priority: number;
    enabled: boolean;
  }>;

  private readonly logger: ILogger;
  private readonly metrics: IMetricsCollector;
  private readonly chainName: string;

  constructor(metrics: IMetricsCollector, config: HttpMiddlewareChainConfig) {
    this.metrics = metrics;
    this.chainName = config.name;
    this.logger = createLogger(`HttpMiddlewareChain:${config.name}`);

    this.middlewares = config.middlewares
      .filter((m) => m.enabled !== false)
      .map((m) => ({
        name: m.name,
        middleware: m.middleware,
        priority: m.priority ?? 0,
        enabled: m.enabled ?? true,
      }))
      .sort((a, b) => b.priority - a.priority); // Higher priority first

    this.logger.info("HTTP middleware chain initialized", {
      chainName: this.chainName,
      count: this.middlewares.length,
      middlewares: this.middlewares.map((m) => ({
        name: m.name,
        priority: m.priority,
      })),
    });
  }

  /**
   * Execute the middleware chain
   */
  public execute(): MiddlewareFunction {
    return async (
      context: MiddlewareContext,
      finalNext: () => Promise<void>
    ) => {
      const startTime = performance.now();
      const executionId = this.generateExecutionId();
      let currentIndex = 0;

      this.logger.debug("Starting middleware chain execution", {
        chainName: this.chainName,
        executionId,
        middlewareCount: this.middlewares.length,
        requestPath: context.request.url,
      });

      const next = async (): Promise<void> => {
        if (currentIndex >= this.middlewares.length) {
          // All middleware executed, call final next
          return finalNext();
        }

        const current = this.middlewares[currentIndex++];

        if (!current?.enabled) {
          return next(); // Skip disabled middleware
        }

        try {
          this.logger.debug("Executing middleware", {
            chainName: this.chainName,
            executionId,
            name: current.name,
            index: currentIndex - 1,
          });

          const middlewareStartTime = performance.now();
          await current.middleware(context, next);
          const middlewareExecutionTime =
            performance.now() - middlewareStartTime;

          await this.recordMiddlewareMetrics(
            current.name,
            "success",
            middlewareExecutionTime
          );
        } catch (error) {
          const middlewareExecutionTime = performance.now() - startTime;

          this.logger.error("Middleware execution failed", error as Error, {
            chainName: this.chainName,
            executionId,
            middleware: current.name,
            index: currentIndex - 1,
          });

          await this.recordMiddlewareMetrics(
            current.name,
            "failure",
            middlewareExecutionTime
          );
          throw error;
        }
      };

      try {
        await next();

        const totalTime = performance.now() - startTime;
        await this.recordChainMetrics("success", totalTime);

        this.logger.debug("Middleware chain execution completed", {
          chainName: this.chainName,
          executionId,
          totalTime: `${totalTime.toFixed(2)}ms`,
        });
      } catch (error) {
        const totalTime = performance.now() - startTime;
        await this.recordChainMetrics("failure", totalTime);
        throw error;
      }
    };
  }

  /**
   * Add a middleware to the chain
   */
  public add(
    name: string,
    middleware: MiddlewareFunction,
    priority: number = 0
  ): void {
    this.middlewares.push({
      name,
      middleware,
      priority,
      enabled: true,
    });

    // Re-sort after adding
    this.middlewares.sort((a, b) => b.priority - a.priority);

    this.logger.debug("Middleware added to chain", {
      name,
      priority,
      total: this.middlewares.length,
    });
  }

  /**
   * Remove a middleware from the chain
   */
  public remove(name: string): boolean {
    const index = this.middlewares.findIndex((m) => m.name === name);
    if (index >= 0) {
      this.middlewares.splice(index, 1);
      this.logger.debug("Middleware removed from chain", {
        name,
        remaining: this.middlewares.length,
      });
      return true;
    }
    return false;
  }

  /**
   * Enable or disable a middleware
   */
  public toggle(name: string, enabled: boolean): boolean {
    const middleware = this.middlewares.find((m) => m.name === name);
    if (middleware) {
      middleware.enabled = enabled;
      this.logger.debug("Middleware toggled", { name, enabled });
      return true;
    }
    return false;
  }

  /**
   * Get the list of middlewares in execution order
   */
  public getMiddlewares(): Array<{
    name: string;
    priority: number;
    enabled: boolean;
  }> {
    return this.middlewares.map((m) => ({
      name: m.name,
      priority: m.priority,
      enabled: m.enabled,
    }));
  }

  /**
   * Get middleware count
   */
  public getCount(): number {
    return this.middlewares.filter((m) => m.enabled).length;
  }

  /**
   * Create a new chain with additional middleware
   */
  public with(
    name: string,
    middleware: MiddlewareFunction,
    priority: number = 0
  ): HttpMiddlewareChain {
    const newConfig: HttpMiddlewareChainConfig = {
      name: `${this.chainName}-extended`,
      middlewares: [
        ...this.middlewares.map((m) => ({
          name: m.name,
          middleware: m.middleware,
          priority: m.priority,
          enabled: m.enabled,
        })),
        { name, middleware, priority, enabled: true },
      ],
    };

    return new HttpMiddlewareChain(this.metrics, newConfig);
  }

  /**
   * Record chain-level metrics
   */
  private async recordChainMetrics(
    result: "success" | "failure",
    totalTime: number
  ): Promise<void> {
    try {
      await Promise.all([
        this.metrics.recordCounter(`middleware_chain_${result}`, 1, {
          chainName: this.chainName,
          middlewareCount: this.middlewares.length.toString(),
        }),
        this.metrics.recordTimer("middleware_chain_duration", totalTime, {
          chainName: this.chainName,
          result,
        }),
      ]);
    } catch (error) {
      this.logger.warn("Failed to record chain metrics", {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Record individual middleware metrics
   */
  private async recordMiddlewareMetrics(
    middlewareName: string,
    result: "success" | "failure",
    executionTime: number
  ): Promise<void> {
    try {
      await Promise.all([
        this.metrics.recordCounter(`middleware_execution_${result}`, 1, {
          chainName: this.chainName,
          middleware: middlewareName,
        }),
        this.metrics.recordTimer(
          "middleware_execution_duration",
          executionTime,
          {
            chainName: this.chainName,
            middleware: middlewareName,
            result,
          }
        ),
      ]);
    } catch (error) {
      this.logger.warn("Failed to record middleware metrics", {
        middleware: middlewareName,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Cleanup all middlewares in the chain
   */
  public async cleanup(): Promise<void> {
    this.logger.info("Starting HTTP middleware chain cleanup", {
      chainName: this.chainName,
      middlewareCount: this.middlewares.length,
    });

    for (const middleware of this.middlewares) {
      try {
        // Check if the middleware has a cleanup method using type assertion
        const middlewareObj = middleware.middleware as unknown as {
          cleanup?: () => void | Promise<void>;
        };

        if (
          middlewareObj.cleanup &&
          typeof middlewareObj.cleanup === "function"
        ) {
          const cleanupResult = middlewareObj.cleanup();
          if (cleanupResult instanceof Promise) {
            await cleanupResult;
          }
          this.logger.debug("Cleaned up middleware", {
            middlewareName: middleware.name,
          });
        }
      } catch (error) {
        this.logger.error("Failed to cleanup middleware", error as Error, {
          middlewareName: middleware.name,
        });
      }
    }

    this.logger.info("HTTP middleware chain cleanup completed", {
      chainName: this.chainName,
    });
  }
  /**
   * Generate unique execution ID for tracing
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
