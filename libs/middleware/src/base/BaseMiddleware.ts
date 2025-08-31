import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  MiddlewareContext,
  MiddlewareFunction,
  MiddlewareOptions,
} from "../types";

/**
 * Base class for all middleware implementations
 * Provides common functionality and standardized patterns
 */
export abstract class BaseMiddleware<
  TConfig extends MiddlewareOptions = MiddlewareOptions
> {
  protected readonly logger: ILogger;
  protected readonly metrics?: MetricsCollector;
  protected readonly config: TConfig;
  protected readonly name: string;

  constructor(
    name: string,
    config: TConfig,
    logger: ILogger,
    metrics?: MetricsCollector
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
   * Main execution method - must be implemented by subclasses
   */
  abstract execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void | any>;

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
    const path = context.request.url.split("?")[0];

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

    const requestId = `${this.name}_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
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
