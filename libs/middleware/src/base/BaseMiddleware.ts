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
  constructor(metrics: IMetricsCollector, config: TConfig, name?: string) {
    const httpDefaults = {
      skipPaths: [] as readonly string[],
    };

    super(metrics, { ...httpDefaults, ...config } as TConfig, name);
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
        return path === skipPath || path.startsWith(skipPath + "/");
      }) || false
    );
  }

  /**
   * Extract relevant information from HTTP context for logging
   */
  protected override extractContextInfo(
    context: MiddlewareContext
  ): Record<string, any> {
    return {
      path: context.request.url,
      method: context.request.method,
      requestId: context.requestId,
      ip: this.getClientIp(context),
    };
  }

  /**
   * Extract client IP from request context
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
}
