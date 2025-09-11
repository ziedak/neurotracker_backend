import { Elysia } from "@libs/elysia-server";
import {
  BaseMiddleware,
  type HttpMiddlewareConfig,
} from "../base/BaseMiddleware";
import { MiddlewareContext } from "../types";

/**
 * Adapter for integrating BaseMiddleware with Elysia framework
 * Separates framework-specific concerns from core middleware logic
 *
 * Features:
 * - Type-safe Elysia context transformation
 * - Plugin generation with decorators and derived context
 * - Per-route configuration support
 * - Framework isolation for better testability
 *
 * Usage:
 * ```typescript
 * const middleware = new SecurityMiddleware(metrics, config);
 * const adapter = new ElysiaMiddlewareAdapter(middleware);
 *
 * // Simple plugin
 * app.use(adapter.plugin());
 *
 * // Advanced plugin with decorators
 * app.use(adapter.advancedPlugin());
 *
 * // Per-route configuration
 * app.use(adapter.plugin({ enabled: false }));
 * ```
 */
export class ElysiaMiddlewareAdapter<
  TConfig extends HttpMiddlewareConfig = HttpMiddlewareConfig
> {
  constructor(private readonly middleware: BaseMiddleware<TConfig>) {}

  /**
   * Create simple Elysia plugin for this middleware
   * @param configOverrides - Configuration overrides for this plugin instance
   */
  public plugin(configOverrides?: Partial<TConfig>): (app: Elysia) => Elysia {
    const middlewareInstance = configOverrides
      ? this.middleware.withConfig(configOverrides)
      : this.middleware;

    return (app: Elysia) => {
      return app.onBeforeHandle(async (elysiaContext) => {
        // Check if middleware is enabled
        if (!middlewareInstance.isEnabled()) {
          return;
        }

        // Transform Elysia context to middleware context
        const middlewareContext = this.transformContext(elysiaContext);

        // Execute middleware
        const middlewareFunction = middlewareInstance.middleware();
        await middlewareFunction(middlewareContext, async () => {
          // No-op next function for onBeforeHandle
        });
      });
    };
  }

  /**
   * Create advanced Elysia plugin with decorators and derived context
   * @param configOverrides - Configuration overrides for this plugin instance
   */
  public advancedPlugin(configOverrides?: Partial<TConfig>): Elysia {
    const middlewareInstance = configOverrides
      ? this.middleware.withConfig(configOverrides)
      : this.middleware;

    const config = middlewareInstance.getConfig();

    return new Elysia({ name: config.name })
      .decorate(config.name as any, {
        config,
        isEnabled: middlewareInstance.isEnabled.bind(middlewareInstance),
        getName: middlewareInstance.getName.bind(middlewareInstance),
      })
      .derive(async (elysiaContext) => {
        // Skip if middleware is disabled
        if (!middlewareInstance.isEnabled()) {
          return {};
        }

        // Transform context
        const middlewareContext = this.transformContext(elysiaContext);

        return {
          middlewareContext,
          [`${config.name}Enabled`]: true,
        };
      })
      .onBeforeHandle(async (elysiaContext) => {
        // Check if middleware is enabled
        if (!middlewareInstance.isEnabled()) {
          return;
        }

        // Transform context and execute middleware
        const middlewareContext = this.transformContext(elysiaContext);
        const middlewareFunction = middlewareInstance.middleware();

        await middlewareFunction(middlewareContext, async () => {
          // No-op next function for onBeforeHandle
        });
      });
  }

  /**
   * Transform Elysia context to middleware context
   * @param elysiaContext - Elysia framework context
   */
  private transformContext(elysiaContext: any): MiddlewareContext {
    const { request, set, headers, path, query, params, body } = elysiaContext;

    return {
      requestId: this.generateRequestId(),
      request: {
        method: request?.method || "GET",
        url: request?.url || path || "/",
        headers: headers || {},
        body,
        query: query || {},
        params: params || {},
        ip: this.extractClientIp(headers),
      },
      set: {
        status: set?.status,
        headers: set?.headers || {},
      },
      path,
      // Allow access to original context for advanced use cases
      originalContext: elysiaContext,
    };
  }

  /**
   * Extract client IP from headers
   * @param headers - Request headers
   */
  private extractClientIp(headers: Record<string, string>): string {
    return (
      headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      headers["x-real-ip"] ||
      headers["cf-connecting-ip"] ||
      "unknown"
    );
  }

  /**
   * Generate a unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
