import { Elysia } from "@libs/elysia-server";
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
export class ElysiaMiddlewareAdapter {
    middleware;
    constructor(middleware) {
        this.middleware = middleware;
    }
    /**
     * Create simple Elysia plugin for this middleware
     * @param configOverrides - Configuration overrides for this plugin instance
     */
    plugin(configOverrides) {
        const middlewareInstance = configOverrides
            ? this.middleware.withConfig(configOverrides)
            : this.middleware;
        return (app) => {
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
    advancedPlugin(configOverrides) {
        const middlewareInstance = configOverrides
            ? this.middleware.withConfig(configOverrides)
            : this.middleware;
        const config = middlewareInstance.getConfig();
        return new Elysia({ name: config.name })
            .decorate(config.name, {
            config,
            isEnabled: middlewareInstance.isEnabled.bind(middlewareInstance),
            getName: middlewareInstance.getName.bind(middlewareInstance),
        })
            .derive((elysiaContext) => {
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
    transformContext(elysiaContext) {
        const { request, set, headers, path, query, params, body } = elysiaContext;
        // Filter out undefined headers
        const filteredHeaders = {};
        if (headers) {
            Object.entries(headers).forEach(([key, value]) => {
                if (value !== undefined) {
                    filteredHeaders[key] = value;
                }
            });
        }
        // Filter out non-string params (decorators)
        const filteredParams = {};
        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                if (typeof value === "string") {
                    filteredParams[key] = value;
                }
            });
        }
        return {
            requestId: this.generateRequestId(),
            request: {
                method: request?.method ?? "GET",
                url: request?.url ?? path ?? "/",
                headers: filteredHeaders,
                body,
                query: query ?? {},
                params: filteredParams,
                ip: this.extractClientIp(filteredHeaders),
            },
            set: {
                status: typeof set?.status === "number" ? set.status : undefined,
                headers: this.convertHeaders(set?.headers),
            },
            path: path ?? "/",
            // Allow access to original context for advanced use cases
            originalContext: elysiaContext,
        };
    }
    /**
     * Extract client IP from headers
     * @param headers - Request headers
     */
    extractClientIp(headers) {
        return (headers["x-forwarded-for"]?.split(",")[0]?.trim() ??
            headers["x-real-ip"] ??
            headers["cf-connecting-ip"] ??
            "unknown");
    }
    /**
     * Convert HTTPHeaders to Record<string, string>
     * @param headers - HTTPHeaders from Elysia
     */
    convertHeaders(headers) {
        const result = {};
        if (headers) {
            Object.entries(headers).forEach(([key, value]) => {
                result[key] = String(value);
            });
        }
        return result;
    }
    /**
     * Generate a unique request ID
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
}
//# sourceMappingURL=ElysiaMiddlewareAdapter.js.map