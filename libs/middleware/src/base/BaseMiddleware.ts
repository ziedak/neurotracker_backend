import { inject } from "@libs/utils";
import { type ILogger, type IMetricsCollector } from "@libs/monitoring";
import { Elysia } from "@libs/elysia-server";
import {
  MiddlewareContext,
  MiddlewareFunction,
  MiddlewareOptions,
} from "../types";
import { generateUUId } from "@libs/utils";

/**
 * Base class for all middleware implementations
 * Provides common functionality and standardized patterns for Elysia middleware
 *
 * @template TConfig - Configuration type extending MiddlewareOptions
 *
 * Features:
 * - Framework-agnostic middleware function creation
 * - Elysia plugin integration with multiple patterns
 * - Built-in error handling and metrics recording
 * - Request context abstraction and IP extraction
 * - Configurable path skipping and security utilities
 * - Production-ready logging and monitoring integration
 *
 * Usage Patterns:
 * 1. Simple plugin: `app.use(middleware.elysia())`
 * 2. Advanced plugin: `app.use(middleware.plugin())`
 * 3. Framework-agnostic: `middleware.middleware()`
 *
 * @example
 * ```typescript
 * class MyMiddleware extends BaseMiddleware<MyConfig> {
 *   protected async execute(context: MiddlewareContext, next: () => Promise<void>) {
 *     // Your middleware logic here
 *     await next();
 *   }
 *
 *   protected createInstance(config: MyConfig): MyMiddleware {
 *     return new MyMiddleware(this.logger, this.metrics, config, this.name);
 *   }
 * }
 *
 * // Usage in Elysia
 * const middleware = new MyMiddleware(logger, metrics, config, "my-middleware");
 * app.use(middleware.elysia());
 * ```
 */
export abstract class BaseMiddleware<
  TConfig extends MiddlewareOptions = MiddlewareOptions
> {
  constructor(
    @inject("ILogger") protected readonly logger: ILogger,
    @inject("IMetricsCollector") protected readonly metrics: IMetricsCollector,
    protected readonly config: TConfig,
    protected readonly name: string
  ) {
    this.name = name;
    this.logger = logger.child({ middleware: name });
    this.metrics = metrics;
    this.config = {
      enabled: true,
      priority: 0,
      skipPaths: [],
      ...config,
      name,
    } as TConfig;

    this.logger.debug("Middleware initialized", {
      name: this.name,
      enabled: this.config.enabled,
      skipPaths: this.config.skipPaths?.length || 0,
    });
  }

  /**
   * Abstract method for middleware execution logic
   * Subclasses must implement this method
   */
  protected abstract execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void>;

  /**
   * Create Elysia plugin for this middleware
   * Returns a proper Elysia plugin function
   */
  public elysia(config?: Partial<TConfig>): (app: Elysia) => Elysia {
    // Merge configuration if provided
    const finalConfig = config ? { ...this.config, ...config } : this.config;

    // Create new instance with merged config if config was provided
    const middlewareInstance = config ? this.createInstance(finalConfig) : this;

    // Return Elysia plugin function
    return (app: Elysia) => {
      return app.onBeforeHandle(async (elysiaContext) => {
        // Check if middleware is enabled
        if (!finalConfig.enabled) {
          this.logger.debug("Middleware disabled, skipping");
          return;
        }

        // Create middleware context from Elysia context
        const middlewareContext =
          middlewareInstance.createMiddlewareContext(elysiaContext);

        // Check if path should be skipped
        if (middlewareInstance.shouldSkip(middlewareContext)) {
          this.logger.debug("Path matched skip pattern, skipping", {
            path: middlewareContext.request.url,
          });
          return;
        }

        // Execute middleware with error handling
        try {
          await middlewareInstance.execute(middlewareContext, async () => {
            // No-op next function for before handle
          });
        } catch (error) {
          await middlewareInstance.handleError(
            error as Error,
            middlewareContext
          );
          throw error;
        }
      });
    };
  }

  /**
   * Create advanced Elysia plugin with decorators and derived context
   * Subclasses can override this for complex plugin behavior
   */
  public plugin(config?: Partial<TConfig>): Elysia {
    // Merge configuration if provided
    const finalConfig = config ? { ...this.config, ...config } : this.config;

    // Create new instance with merged config if config was provided
    const middlewareInstance = config ? this.createInstance(finalConfig) : this;

    return new Elysia({ name: this.name })
      .decorate(this.name, {
        config: finalConfig,
        isEnabled: middlewareInstance.isEnabled.bind(middlewareInstance),
        getName: middlewareInstance.getName.bind(middlewareInstance),
      })
      .derive(async (elysiaContext) => {
        // Create middleware context from Elysia context
        const middlewareContext =
          middlewareInstance.createMiddlewareContext(elysiaContext);

        // Skip if middleware is disabled or path should be skipped
        if (
          !finalConfig.enabled ||
          middlewareInstance.shouldSkip(middlewareContext)
        ) {
          return {};
        }

        return {
          middlewareContext,
          [`${this.name}Enabled`]: true,
        };
      })
      .onBeforeHandle(async (elysiaContext) => {
        // Check if middleware is enabled
        if (!finalConfig.enabled) {
          return;
        }

        // Create middleware context
        const middlewareContext =
          middlewareInstance.createMiddlewareContext(elysiaContext);

        // Check if path should be skipped
        if (middlewareInstance.shouldSkip(middlewareContext)) {
          return;
        }

        // Execute middleware
        try {
          await middlewareInstance.execute(middlewareContext, async () => {
            // No-op next function for before handle
          });
        } catch (error) {
          await middlewareInstance.handleError(
            error as Error,
            middlewareContext
          );
          throw error;
        }
      });
  }

  /**
   * Create middleware context from Elysia context
   * Abstracts Elysia-specific context into our middleware context
   */
  protected createMiddlewareContext(elysiaContext: any): MiddlewareContext {
    const { request, set, headers, path, query, params } = elysiaContext;

    return {
      requestId: this.getRequestId(elysiaContext),
      request: {
        method: request?.method || "GET",
        url: request?.url || path || "/",
        headers: headers || {},
        body: elysiaContext.body,
        query: query || {},
        params: params || {},
        ip: this.getClientIp(elysiaContext),
      },
      set: {
        status: set?.status,
        headers: set?.headers || {},
      },
      path: path,
      ...elysiaContext, // Allow access to original context
    };
  }

  /**
   * Create new instance of this middleware with different config
   * Subclasses should override this method to return proper instance
   */
  protected createInstance(_config: TConfig): BaseMiddleware<TConfig> {
    // This is a fallback - subclasses should override this
    // to return a properly constructed instance of their specific type
    this.logger.warn(
      "createInstance not overridden - using same instance with merged config. " +
        "Consider overriding createInstance in subclass for proper config isolation."
    );
    return this;
  }

  /**
   * Create middleware function for use in framework
   */
  public middleware(): MiddlewareFunction {
    return async (context: MiddlewareContext, next: () => Promise<void>) => {
      // Check if middleware is enabled
      if (!this.config.enabled) {
        this.logger.debug("Middleware disabled, skipping");
        return next();
      }

      // Check if path should be skipped
      if (this.shouldSkip(context)) {
        this.logger.debug("Path matched skip pattern, skipping", {
          path: context.request.url,
        });
        return next();
      }

      // Execute middleware with error handling
      try {
        return await this.execute(context, next);
      } catch (error) {
        await this.handleError(error as Error, context);
        throw error;
      }
    };
  }

  /**
   * Check if the current request should skip this middleware
   */
  protected shouldSkip(context: MiddlewareContext): boolean {
    const path = context.request.url.split("?")[0] || "";

    return (
      this.config.skipPaths?.some((skipPath) => {
        if (skipPath.endsWith("*")) {
          return path.startsWith(skipPath.slice(0, -1));
        }
        return path === skipPath || path.startsWith(skipPath + "/");
      }) || false
    );
  }

  /**
   * Handle errors that occur during middleware execution
   */
  protected async handleError(
    error: Error,
    context: MiddlewareContext
  ): Promise<void> {
    this.logger.error(`${this.name} middleware error`, error, {
      path: context.request.url,
      method: context.request.method,
      requestId: context.requestId,
    });

    await this.recordMetric(`${this.name}_error`);
  }

  /**
   * Record a metric counter
   */
  protected async recordMetric(
    name: string,
    value: number = 1,
    tags?: Record<string, string>
  ): Promise<void> {
    if (this.metrics) {
      try {
        await this.metrics.recordCounter(name, value, tags);
      } catch (error) {
        this.logger.warn("Failed to record metric", {
          name,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Record a timer metric
   */
  protected async recordTimer(
    name: string,
    duration: number,
    tags?: Record<string, string>
  ): Promise<void> {
    if (this.metrics) {
      try {
        await this.metrics.recordTimer(name, duration, tags);
      } catch (error) {
        this.logger.warn("Failed to record timer", {
          name,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Record a histogram metric
   */
  protected async recordHistogram(
    name: string,
    value: number,
    tags?: Record<string, string>
  ): Promise<void> {
    if (this.metrics) {
      try {
        await this.metrics.recordHistogram(name, value, tags);
      } catch (error) {
        this.logger.warn("Failed to record histogram", {
          name,
          error: (error as Error).message,
        });
      }
    }
  }

  /**
   * Extract client IP from request
   */
  protected getClientIp(context: MiddlewareContext): string {
    const headers = context.request.headers;
    return (
      headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      headers["x-real-ip"] ||
      headers["cf-connecting-ip"] ||
      context.request.ip ||
      "unknown"
    );
  }

  /**
   * Generate a unique request ID if not present
   */
  protected getRequestId(context: MiddlewareContext): string {
    if (context.requestId) {
      return context.requestId;
    }

    const requestId = generateUUId(this.name);
    context.requestId = requestId;
    return requestId;
  }

  /**
   * Check if a header contains sensitive information
   */
  protected isSensitiveHeader(
    headerName: string,
    sensitiveFields: string[] = []
  ): boolean {
    const defaultSensitive = [
      "authorization",
      "cookie",
      "x-api-key",
      "x-auth-token",
    ];
    const allSensitive = [...defaultSensitive, ...sensitiveFields];

    return allSensitive.some((field) =>
      headerName.toLowerCase().includes(field.toLowerCase())
    );
  }

  /**
   * Sanitize object by removing or masking sensitive fields
   */
  protected sanitizeObject(obj: any, sensitiveFields: string[] = []): any {
    if (!obj || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item, sensitiveFields));
    }

    const sanitized: Record<string, any> = {};
    const defaultSensitive = ["password", "token", "secret", "key", "auth"];
    const allSensitive = [...defaultSensitive, ...sensitiveFields];

    for (const [key, value] of Object.entries(obj)) {
      const isSensitive = allSensitive.some((field) =>
        key.toLowerCase().includes(field.toLowerCase())
      );

      if (isSensitive) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizeObject(value, sensitiveFields);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Get middleware configuration
   */
  public getConfig(): TConfig {
    return { ...this.config };
  }

  /**
   * Get middleware name
   */
  public getName(): string {
    return this.name;
  }

  /**
   * Check if middleware is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled || false;
  }
}
