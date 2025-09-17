import { type IMetricsCollector } from "@libs/monitoring";
import { MiddlewareContext, MiddlewareFunction } from "../types";
import { AbstractMiddleware, type BaseMiddlewareConfig } from "./AbstractMiddleware";
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
export declare abstract class BaseMiddleware<TConfig extends HttpMiddlewareConfig = HttpMiddlewareConfig> extends AbstractMiddleware<TConfig, MiddlewareContext> {
    constructor(metrics: IMetricsCollector, config: Partial<TConfig>, name?: string);
    /**
     * Hook called before request processing
     * Override in subclasses for custom pre-processing logic
     */
    protected beforeProcess(context: MiddlewareContext): void;
    /**
     * Hook called after request processing
     * Override in subclasses for custom post-processing logic
     */
    protected afterProcess(context: MiddlewareContext): void;
    /**
     * Static method to validate configuration
     * Override in subclasses for custom validation
     */
    static validateConfig(config: unknown): void;
    /**
     * Abstract method for middleware execution logic
     * Subclasses must implement this method
     */
    protected abstract execute(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
    /**
     * Create middleware function for use in any HTTP framework
     */
    middleware(): MiddlewareFunction;
    /**
     * Check if the current request should skip this middleware
     */
    protected shouldSkip(context: MiddlewareContext): boolean;
    /**
     * Extract relevant information from HTTP context for logging
     */
    protected extractContextInfo(context: MiddlewareContext, extraInfoContext?: Record<string, unknown>): Record<string, unknown>;
    /**
     * Extract client IP from request context
     */
    protected getClientIp(context: MiddlewareContext): string;
    /**
     * Generate a unique request ID if not present
     */
    protected getRequestId(context: MiddlewareContext): string;
    /**
     * Check if a header contains sensitive information
     */
    protected isSensitiveHeader(headerName: string, sensitiveFields?: string[]): boolean;
    /**
     * Cleanup method for HTTP middleware
     * Default implementation - override in subclasses if needed
     */
    cleanup(): void;
    /**
     * Update configuration with validation
     */
    updateConfig(configOverrides: Partial<TConfig>): void;
    /**
     * Sort middleware instances by priority (lower priority numbers first = higher priority)
     */
    static sortByPriority<T extends BaseMiddleware>(middlewares: T[]): T[];
    /**
     * Factory method to create middleware instances
     */
    static create<TConfig extends HttpMiddlewareConfig, T extends BaseMiddleware<TConfig>>(metrics: IMetricsCollector, config: TConfig, MiddlewareClass: new (metrics: IMetricsCollector, config: TConfig, name?: string) => T): T;
}
export declare const BaseHttpMiddleware: typeof BaseMiddleware;
//# sourceMappingURL=BaseMiddleware.d.ts.map