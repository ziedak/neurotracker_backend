import {
  MiddlewareContext,
  MiddlewareFunction,
  MiddlewareChainConfig,
} from "../types";
import { injectable, inject } from "@libs/utils";
import { ILogger } from "@libs/monitoring";

/**
 * Utility class for chaining multiple middleware functions
 * Handles priority ordering and error propagation
 */
@injectable()
export class MiddlewareChain {
  private readonly middlewares: Array<{
    name: string;
    middleware: MiddlewareFunction;
    priority: number;
    enabled: boolean;
  }>;

  private readonly logger: ILogger;

  constructor(
    @inject("MiddlewareChainConfig") config: MiddlewareChainConfig,
    @inject("ILogger") logger: ILogger
  ) {
    this.logger = logger.child({ component: "MiddlewareChain" });
    this.middlewares = config.middlewares
      .filter((m) => m.enabled !== false)
      .map((m) => ({
        name: m.name,
        middleware: m.middleware,
        priority: m.priority ?? 0,
        enabled: m.enabled ?? true,
      }))
      .sort((a, b) => b.priority - a.priority);
    this.logger.info("Middleware chain initialized", {
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
      let currentIndex = 0;

      const next = async (): Promise<void> => {
        if (currentIndex >= this.middlewares.length) {
          // All middleware executed, call final next
          return finalNext();
        }

        const current = this.middlewares[currentIndex++];

        if (!current) {
          this.logger.error("No middleware found at index", undefined, {
            index: currentIndex - 1,
          });
          return;
        }

        try {
          this.logger.debug("Executing middleware", {
            name: current.name,
            index: currentIndex - 1,
          });
          return await current.middleware(context, next);
        } catch (error) {
          this.logger.error("Middleware execution failed", error as Error, {
            middleware: current.name,
            index: currentIndex - 1,
          });

          throw error;
        }
      };

      return next();
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
  ): MiddlewareChain {
    const newConfig: MiddlewareChainConfig = {
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

    return new MiddlewareChain(newConfig, this.logger);
  }
}
