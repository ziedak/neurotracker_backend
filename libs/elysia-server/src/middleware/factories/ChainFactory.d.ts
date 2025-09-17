import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base/BaseMiddleware";
import { BaseWebSocketMiddleware, type WebSocketMiddlewareConfig } from "../base/BaseWebSocketMiddleware";
import { HttpMiddlewareChain } from "../base/middlewareChain/httpMiddlewareChain";
import { WebSocketMiddlewareChain } from "../base/middlewareChain/WebSocketMiddlewareChain";
import { MiddlewareContext, WebSocketContext } from "../types";
/**
 * Factory functions for creating middleware chains with proper configuration
 * Provides convenient APIs for common middleware chain patterns
 *
 * Features:
 * - Type-safe chain creation
 * - Automatic priority assignment
 * - Metrics integration
 * - Error handling setup
 *
 * Usage:
 * ```typescript
 * // HTTP middleware chain
 * const httpChain = createHttpMiddlewareChain(metrics, [
 *   { name: "auth", middleware: authMiddleware },
 *   { name: "cors", middleware: corsMiddleware },
 * ]);
 *
 * // WebSocket middleware chain
 * const wsChain = createWebSocketMiddlewareChain(metrics, [
 *   { name: "auth", middleware: wsAuthMiddleware },
 *   { name: "rate-limit", middleware: wsRateLimitMiddleware },
 * ]);
 * ```
 */
/**
 * HTTP middleware chain item configuration
 */
export interface HttpChainItem {
    readonly name: string;
    readonly middleware: BaseMiddleware<HttpMiddlewareConfig>;
    readonly priority?: number;
    readonly enabled?: boolean;
    readonly config?: Partial<HttpMiddlewareConfig>;
}
/**
 * WebSocket middleware chain item configuration
 */
export interface WebSocketChainItem {
    readonly name: string;
    readonly middleware: BaseWebSocketMiddleware<WebSocketMiddlewareConfig>;
    readonly priority?: number;
    readonly enabled?: boolean;
    readonly config?: Partial<WebSocketMiddlewareConfig>;
}
/**
 * Create HTTP middleware chain from BaseMiddleware instances
 * @param metrics - Metrics collector instance
 * @param chainName - Name for the chain
 * @param middlewares - Array of middleware configurations
 */
export declare function createHttpMiddlewareChain(metrics: IMetricsCollector, chainName: string, middlewares: HttpChainItem[]): HttpMiddlewareChain;
/**
 * Create WebSocket middleware chain from BaseWebSocketMiddleware instances
 * @param metrics - Metrics collector instance
 * @param chainName - Name for the chain
 * @param middlewares - Array of middleware configurations
 */
export declare function createWebSocketMiddlewareChain(metrics: IMetricsCollector, chainName: string, middlewares: WebSocketChainItem[]): WebSocketMiddlewareChain;
/**
 * Create a simple HTTP middleware chain with basic configuration
 * @param metrics - Metrics collector instance
 * @param middlewares - Simple middleware function array
 */
export declare function createSimpleHttpChain(metrics: IMetricsCollector, middlewares: Array<{
    name: string;
    middleware: (context: MiddlewareContext, next: () => Promise<void>) => Promise<void>;
    priority?: number;
}>): HttpMiddlewareChain;
/**
 * Create a simple WebSocket middleware chain with basic configuration
 * @param metrics - Metrics collector instance
 * @param middlewares - Simple middleware function array
 */
export declare function createSimpleWebSocketChain(metrics: IMetricsCollector, middlewares: Array<{
    name: string;
    middleware: (context: WebSocketContext, next: () => Promise<void>) => Promise<void>;
    priority?: number;
}>): WebSocketMiddlewareChain;
/**
 * Predefined middleware chain patterns
 */
export declare const MiddlewareChainPatterns: {
    /**
     * Basic security chain for HTTP
     */
    readonly BASIC_HTTP_SECURITY: () => {
        name: string;
        priorities: {
            cors: number;
            security: number;
            rateLimit: number;
            auth: number;
            metrics: number;
        };
    };
    /**
     * Basic security chain for WebSocket
     */
    readonly BASIC_WS_SECURITY: () => {
        name: string;
        priorities: {
            auth: number;
            rateLimit: number;
            validation: number;
        };
    };
    /**
     * Full production chain for HTTP
     */
    readonly PRODUCTION_HTTP: () => {
        name: string;
        priorities: {
            logging: number;
            cors: number;
            security: number;
            rateLimit: number;
            auth: number;
            validation: number;
            business: number;
            metrics: number;
        };
    };
    /**
     * Full production chain for WebSocket
     */
    readonly PRODUCTION_WS: () => {
        name: string;
        priorities: {
            logging: number;
            auth: number;
            rateLimit: number;
            validation: number;
            business: number;
            metrics: number;
        };
    };
    /**
     * Development chain with minimal security
     */
    readonly DEVELOPMENT: () => {
        name: string;
        priorities: {
            logging: number;
            auth: number;
            rateLimit: number;
        };
    };
};
/**
 * Chain factory for creating predefined middleware patterns
 */
export declare const ChainFactory: {
    patterns: {
        /**
         * Basic security chain for HTTP
         */
        readonly BASIC_HTTP_SECURITY: () => {
            name: string;
            priorities: {
                cors: number;
                security: number;
                rateLimit: number;
                auth: number;
                metrics: number;
            };
        };
        /**
         * Basic security chain for WebSocket
         */
        readonly BASIC_WS_SECURITY: () => {
            name: string;
            priorities: {
                auth: number;
                rateLimit: number;
                validation: number;
            };
        };
        /**
         * Full production chain for HTTP
         */
        readonly PRODUCTION_HTTP: () => {
            name: string;
            priorities: {
                logging: number;
                cors: number;
                security: number;
                rateLimit: number;
                auth: number;
                validation: number;
                business: number;
                metrics: number;
            };
        };
        /**
         * Full production chain for WebSocket
         */
        readonly PRODUCTION_WS: () => {
            name: string;
            priorities: {
                logging: number;
                auth: number;
                rateLimit: number;
                validation: number;
                business: number;
                metrics: number;
            };
        };
        /**
         * Development chain with minimal security
         */
        readonly DEVELOPMENT: () => {
            name: string;
            priorities: {
                logging: number;
                auth: number;
                rateLimit: number;
            };
        };
    };
    createHttpChain: typeof createHttpMiddlewareChain;
    createWebSocketChain: typeof createWebSocketMiddlewareChain;
    createSimpleHttpChain: typeof createSimpleHttpChain;
    createSimpleWebSocketChain: typeof createSimpleWebSocketChain;
};
//# sourceMappingURL=ChainFactory.d.ts.map