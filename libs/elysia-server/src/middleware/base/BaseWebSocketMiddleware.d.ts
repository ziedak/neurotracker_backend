import { IMetricsCollector } from "@libs/monitoring";
import type { WebSocketContext, WebSocketMessage, WebSocketMiddlewareFunction } from "../types";
import { AbstractMiddleware, type BaseMiddlewareConfig } from "./AbstractMiddleware";
/**
 * WebSocket Middleware configuration interface
 */
export interface WebSocketMiddlewareConfig extends BaseMiddlewareConfig {
    readonly skipMessageTypes?: readonly string[];
}
/**
 * Base class for WebSocket middleware implementations
 * Provides WebSocket-specific functionality while leveraging shared abstractions
 *
 * @template TConfig - Configuration type extending WebSocketMiddlewareConfig
 *
 * Features:
 * - Message type filtering
 * - Safe JSON serialization
 * - Connection context management
 * - WebSocket-specific error handling
 * - Immutable configuration management
 *
 * Usage:
 * ```typescript
 * class AuthMiddleware extends BaseWebSocketMiddleware<AuthConfig> {
 *   protected async execute(context: WebSocketContext, next: () => Promise<void>) {
 *     // Auth logic here
 *     await next();
 *   }
 * }
 *
 * // Usage
 * const middleware = new AuthMiddleware(metrics, config);
 * const middlewareFunction = middleware.middleware();
 * ```
 */
export declare abstract class BaseWebSocketMiddleware<TConfig extends WebSocketMiddlewareConfig = WebSocketMiddlewareConfig> extends AbstractMiddleware<TConfig, WebSocketContext> {
    constructor(metrics: IMetricsCollector, config: Partial<TConfig>, name?: string);
    /**
     * Main execution method - must be implemented by subclasses
     */
    protected abstract execute(context: WebSocketContext, next: () => Promise<void>): Promise<void>;
    /**
     * Create middleware function for use in WebSocket handlers
     */
    middleware(): WebSocketMiddlewareFunction;
    /**
     * Check if the current message should skip this middleware
     */
    protected shouldSkip(context: WebSocketContext): boolean;
    /**
     * Extract relevant information from WebSocket context for logging
     */
    protected extractContextInfo(context: WebSocketContext, extraInfoContext?: Record<string, unknown>): Record<string, unknown>;
    /**
     * Get connection ID from context
     */
    protected getConnectionId(context: WebSocketContext): string;
    /**
     * Get user ID from context
     */
    protected getUserId(context: WebSocketContext): string | undefined;
    /**
     * Get client IP from context
     */
    protected getClientIp(context: WebSocketContext): string;
    /**
     * Check if connection is authenticated
     */
    protected isAuthenticated(context: WebSocketContext): boolean;
    /**
     * Send response message through WebSocket with safe serialization
     * @param context - WebSocket context
     * @param message - Message to send
     * @param options - Send options
     */
    protected sendResponse(context: WebSocketContext, message: WebSocketMessage, options?: {
        addTimestamp?: boolean;
        maxRetries?: number;
    }): Promise<boolean>;
    /**
     * Safe JSON stringification with circular reference handling
     * @param obj - Object to stringify
     */
    private safeJsonStringify;
    /**
     * Cleanup method for WebSocket middleware
     * Default implementation - override in subclasses if needed
     */
    cleanup(): void;
    /**
     * Update configuration with validation
     */
    updateConfig(configOverrides: Partial<TConfig>): void;
    /**
     * Static method to validate configuration
     * Override in subclasses for custom validation
     */
    static validateConfig(config: unknown): void;
    /**
     * Sort middleware instances by priority (lower priority numbers first = higher priority)
     */
    static sortByPriority<T extends BaseWebSocketMiddleware>(middlewares: T[]): T[];
    /**
     * Factory method to create middleware instances
     */
    static create<TConfig extends WebSocketMiddlewareConfig, T extends BaseWebSocketMiddleware<TConfig>>(metrics: IMetricsCollector, config: TConfig, MiddlewareClass: new (metrics: IMetricsCollector, config: TConfig, name?: string) => T): T;
    protected beforeProcessing(context: WebSocketContext): void;
    protected afterProcessing(context: WebSocketContext): void;
    protected beforeExecute(context: WebSocketContext): Promise<void>;
    protected afterExecute(context: WebSocketContext): Promise<void>;
}
//# sourceMappingURL=BaseWebSocketMiddleware.d.ts.map