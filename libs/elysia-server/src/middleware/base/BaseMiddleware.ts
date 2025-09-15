import { type IMetricsCollector } from "@libs/monitoring";
import { MiddlewareContext, MiddlewareFunction } from "../types";
import { generateUUId } from "@libs/utils";
import {
  AbstractMiddleware,
  type BaseMiddlewareConfig,
} from "./AbstractMiddleware";

/**
 * HTTP Middleware configuration interface
 */
export interface HttpMiddlewareConfig extends BaseMiddlewareConfig {
  readonly skipPaths?: readonly string[];
}

/**
 * Base class for HTTP middleware implementations
 * Provides HTTP-specific functionality while leveraging shared abstractions
 *
 * @template TConfig - Configuration type extending HttpMiddlewareConfig
 *
 * Features:
 * - Framework-agnostic middleware function creation
 * - Built-in path skipping logic
 * - Request context abstraction and IP extraction
 * - Security utilities for header and data sanitization
 * - Immutable configuration management
 *
 * Usage:
 * ```typescript
 * class SecurityMiddleware extends BaseMiddleware<SecurityConfig> {
 *   protected async execute(context: MiddlewareContext, next: () => Promise<void>) {
 *     // Security logic here
 *     await next();
 *   }
 * }
 *
 * // Usage
 * const middleware = new SecurityMiddleware(metrics, config);
 * const middlewareFunction = middleware.middleware();
 * ```
 */
export abstract class BaseMiddleware<
  TConfig extends HttpMiddlewareConfig = HttpMiddlewareConfig
> extends AbstractMiddleware<TConfig, MiddlewareContext> {
  constructor(
    metrics: IMetricsCollector,
    config: Partial<TConfig>,
    name?: string
  ) {
    const httpDefaults = {
      skipPaths: [] as readonly string[],
      enabled: true,
      priority: 0,
    };

    // Set default name if not provided
    const defaultName =
      name || (config as Partial<BaseMiddlewareConfig>).name || "base-http";
    const configWithDefaults = {
      ...httpDefaults,
      ...config,
      name: defaultName,
    } as TConfig;

    // Validate configuration after merging defaults
    BaseMiddleware.validateConfig(configWithDefaults);

    super(metrics, configWithDefaults, defaultName);
  }

  /**
   * Hook called before request processing
   * Override in subclasses for custom pre-processing logic
   */
  protected beforeProcess(context: MiddlewareContext): void {
    this.logger.debug("Before request processing", {
      middlewareName: this.config.name,
      requestId: this.getRequestId(context),
    });
  }

  /**
   * Hook called after request processing
   * Override in subclasses for custom post-processing logic
   */
  protected afterProcess(context: MiddlewareContext): void {
    this.logger.debug("After request processing", {
      middlewareName: this.config.name,
      requestId: this.getRequestId(context),
    });
  }

  /**
   * Static method to validate configuration
   * Override in subclasses for custom validation
   */
  static validateConfig(config: unknown): void {
    if (!config || typeof config !== "object") {
      throw new Error("Configuration must be an object");
    }

    const configObj = config as Record<string, unknown>;

    if (!configObj["name"] || typeof configObj["name"] !== "string") {
      throw new Error("Configuration must have a valid name");
    }

    if (
      configObj["enabled"] !== undefined &&
      typeof configObj["enabled"] !== "boolean"
    ) {
      throw new Error("Configuration enabled must be a boolean");
    }

    // HTTP-specific validation
    if (
      configObj["priority"] !== undefined &&
      (typeof configObj["priority"] !== "number" || configObj["priority"] < 0)
    ) {
      throw new Error("Base HTTP priority must be a non-negative integer");
    }

    if (
      configObj["skipPaths"] !== undefined &&
      (!Array.isArray(configObj["skipPaths"]) ||
        !configObj["skipPaths"].every(
          (path: unknown) => typeof path === "string"
        ))
    ) {
      throw new Error("Configuration skipPaths must be an array of strings");
    }
  }

  /**
   * Abstract method for middleware execution logic
   * Subclasses must implement this method
   */
  protected abstract override execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void>;

  /**
   * Create middleware function for use in any HTTP framework
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

      // Execute middleware with error handling and timing
      const startTime = Date.now();
      try {
        await this.execute(context, next);
        await this.recordTimer(
          `${this.config.name}_duration`,
          Date.now() - startTime
        );
      } catch (error) {
        await this.handleError(error as Error, context);
        throw error;
      }
    };
  }

  /**
   * Check if the current request should skip this middleware
   */
  protected override shouldSkip(context: MiddlewareContext): boolean {
    const path = context.request.url.split("?")[0] || "";

    return (
      this.config.skipPaths?.some((skipPath) => {
        if (skipPath.endsWith("*")) {
          return path.startsWith(skipPath.slice(0, -1));
        }
        return path === skipPath || path.startsWith(`${skipPath}/`);
      }) || false
    );
  }

  /**
   * Extract relevant information from HTTP context for logging
   */
  protected override extractContextInfo(
    context: MiddlewareContext,
    extraInfoContext?: Record<string, unknown>
  ): Record<string, unknown> {
    const contextInfo: Record<string, unknown> = {
      path: context.request.url,
      method: context.request.method,
      requestId: this.getRequestId(context),
      ip: this.getClientIp(context),
    };

    // Add extra context if provided
    if (extraInfoContext) {
      Object.assign(contextInfo, extraInfoContext);
    }

    return contextInfo;
  }

  /**
   * Extract client IP from request context
   */
  protected getClientIp(context: MiddlewareContext): string {
    const { headers } = context.request;
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

    const requestId = generateUUId(this.config.name);
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
   * Cleanup method for HTTP middleware
   * Default implementation - override in subclasses if needed
   */
  public cleanup(): void {
    this.logger.debug("HTTP middleware cleanup completed", {
      middlewareName: this.config.name,
    });
  }

  /**
   * Update configuration with validation
   */
  public updateConfig(configOverrides: Partial<TConfig>): void {
    const newConfig = { ...this.config, ...configOverrides } as TConfig;
    // Call static validateConfig for validation
    (this.constructor as typeof BaseMiddleware).validateConfig(newConfig);
    // Update config via property assignment
    Object.assign(this as unknown as { config: TConfig }, {
      config: Object.freeze(newConfig),
    });
  }

  /**
   * Sort middleware instances by priority (lower priority numbers first = higher priority)
   */
  static sortByPriority<T extends BaseMiddleware>(middlewares: T[]): T[] {
    return middlewares.sort((a, b) => a.config.priority - b.config.priority);
  }

  /**
   * Factory method to create middleware instances
   */
  static create<
    TConfig extends HttpMiddlewareConfig,
    T extends BaseMiddleware<TConfig>
  >(
    metrics: IMetricsCollector,
    config: TConfig,
    MiddlewareClass: new (
      metrics: IMetricsCollector,
      config: TConfig,
      name?: string
    ) => T
  ): T {
    return new MiddlewareClass(metrics, config, config.name);
  }
}

// Export aliases for backward compatibility
export const BaseHttpMiddleware = BaseMiddleware;
