import { Elysia } from "@libs/elysia-server";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base/BaseMiddleware";
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
export declare class ElysiaMiddlewareAdapter<TConfig extends HttpMiddlewareConfig = HttpMiddlewareConfig> {
    private readonly middleware;
    constructor(middleware: BaseMiddleware<TConfig>);
    /**
     * Create simple Elysia plugin for this middleware
     * @param configOverrides - Configuration overrides for this plugin instance
     */
    plugin(configOverrides?: Partial<TConfig>): (app: Elysia) => Elysia;
    /**
     * Create advanced Elysia plugin with decorators and derived context
     * @param configOverrides - Configuration overrides for this plugin instance
     */
    advancedPlugin(configOverrides?: Partial<TConfig>): Elysia;
    /**
     * Transform Elysia context to middleware context
     * @param elysiaContext - Elysia framework context
     */
    private transformContext;
    /**
     * Extract client IP from headers
     * @param headers - Request headers
     */
    private extractClientIp;
    /**
     * Convert HTTPHeaders to Record<string, string>
     * @param headers - HTTPHeaders from Elysia
     */
    private convertHeaders;
    /**
     * Generate a unique request ID
     */
    private generateRequestId;
}
//# sourceMappingURL=ElysiaMiddlewareAdapter.d.ts.map