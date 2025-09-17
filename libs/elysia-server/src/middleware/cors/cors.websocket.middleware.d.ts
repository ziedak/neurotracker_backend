import { type IMetricsCollector } from "@libs/monitoring";
import { BaseWebSocketMiddleware, type WebSocketMiddlewareConfig } from "../base";
import type { WebSocketContext } from "../types";
/**
 * WebSocket CORS middleware configuration interface
 * Extends WebSocketMiddlewareConfig with CORS-specific options for WebSocket connections
 */
export interface CorsWebSocketMiddlewareConfig extends WebSocketMiddlewareConfig {
    readonly origin?: string | readonly string[] | boolean | ((origin: string) => boolean);
    readonly allowedProtocols?: readonly string[];
    readonly allowedExtensions?: readonly string[];
    readonly credentials?: boolean;
    readonly maxAge?: number;
    readonly validateUpgrade?: boolean;
    readonly allowOriginless?: boolean;
}
/**
 * Extended WebSocket context with upgrade headers for CORS validation
 */
export interface CorsWebSocketContext extends WebSocketContext {
    upgradeHeaders?: Record<string, string | string[] | undefined>;
    websocket?: any;
}
/**
 * Production-grade WebSocket CORS Middleware
 * Implements Cross-Origin Resource Sharing validation for WebSocket connections
 *
 * Features:
 * - WebSocket-specific CORS validation during connection upgrade
 * - Protocol and extension validation
 * - Origin validation with detailed logging
 * - Connection security validation
 * - Comprehensive monitoring and metrics
 * - Support for originless connections (controlled)
 *
 * @template CorsWebSocketMiddlewareConfig - WebSocket CORS-specific configuration
 */
export declare class CorsWebSocketMiddleware extends BaseWebSocketMiddleware<CorsWebSocketMiddlewareConfig> {
    constructor(metrics: IMetricsCollector, config?: Partial<CorsWebSocketMiddlewareConfig>);
    /**
     * Core WebSocket CORS middleware execution logic
     * Validates CORS policies for WebSocket connections and messages
     */
    protected execute(context: WebSocketContext, next: () => Promise<void>): Promise<void>;
    /**
     * Validate WebSocket connection upgrade request
     */
    private validateConnectionUpgrade;
    /**
     * Validate message origin for ongoing WebSocket communication
     */
    private validateMessageOrigin;
    /**
     * Extract upgrade headers from context
     */
    private extractUpgradeHeaders;
    /**
     * Validate WebSocket upgrade headers
     */
    private validateUpgradeHeaders;
    /**
     * Validate WebSocket protocols
     */
    private validateProtocols;
    /**
     * Validate WebSocket extensions
     */
    private validateExtensions;
    /**
     * Validate origin against configuration with detailed result
     */
    private validateOrigin;
    /**
     * Handle WebSocket CORS-related errors
     */
    private handleWebSocketCorsError;
    /**
     * Record WebSocket CORS-specific metrics
     */
    private recordWebSocketCorsMetrics;
    /**
     * Validate configuration on instantiation
     */
    private validateConfiguration;
    /**
     * Create development configuration preset
     */
    static createDevelopmentConfig(): Partial<CorsWebSocketMiddlewareConfig>;
    /**
     * Create production configuration preset
     */
    static createProductionConfig(allowedOrigins: readonly string[]): Partial<CorsWebSocketMiddlewareConfig>;
    /**
     * Create real-time application configuration preset
     */
    static createRealtimeConfig(allowedOrigins: readonly string[]): Partial<CorsWebSocketMiddlewareConfig>;
    /**
     * Create strict security configuration preset
     */
    static createStrictConfig(allowedOrigins: readonly string[]): Partial<CorsWebSocketMiddlewareConfig>;
}
/**
 * Factory function for WebSocket CORS middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export declare function CorscreateWebSocketMiddleware(metrics: IMetricsCollector, config?: Partial<CorsWebSocketMiddlewareConfig>): CorsWebSocketMiddleware;
/**
 * Preset configurations for common WebSocket CORS scenarios
 * Immutable configuration objects for different environments and use cases
 */
export declare const WEBSOCKET_CORS_PRESETS: {
    readonly development: () => Partial<CorsWebSocketMiddlewareConfig>;
    readonly production: (origins: readonly string[]) => Partial<CorsWebSocketMiddlewareConfig>;
    readonly realtime: (origins: readonly string[]) => Partial<CorsWebSocketMiddlewareConfig>;
    readonly strict: (origins: readonly string[]) => Partial<CorsWebSocketMiddlewareConfig>;
    readonly gaming: (origins: readonly string[]) => Partial<CorsWebSocketMiddlewareConfig>;
    readonly streaming: (origins: readonly string[]) => Partial<CorsWebSocketMiddlewareConfig>;
    readonly chat: (origins: readonly string[]) => Partial<CorsWebSocketMiddlewareConfig>;
};
//# sourceMappingURL=cors.websocket.middleware.d.ts.map