import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base";
import type { MiddlewareContext } from "../types";
/**
 * CORS middleware configuration interface
 * Extends HttpMiddlewareConfig with CORS-specific options
 */
export interface CorsHttpMiddlewareConfig extends HttpMiddlewareConfig {
    readonly allowedOrigins?: string | readonly string[] | boolean | ((origin: string) => boolean);
    readonly allowedMethods?: readonly string[];
    readonly allowedHeaders?: readonly string[];
    readonly exposedHeaders?: readonly string[];
    readonly credentials?: boolean;
    readonly maxAge?: number;
    readonly preflightContinue?: boolean;
    readonly optionsSuccessStatus?: number;
}
/**
 * Production-grade CORS Middleware
 * Implements Cross-Origin Resource Sharing with comprehensive security controls
 *
 * Features:
 * - Strict type safety with readonly configurations
 * - Comprehensive origin validation with detailed logging
 * - Performance-optimized header setting
 * - Built-in security best practices
 * - Extensive monitoring and metrics
 *
 * @template CorsHttpMiddlewareConfig - CORS-specific configuration
 */
export declare class CorsHttpMiddleware extends BaseMiddleware<CorsHttpMiddlewareConfig> {
    constructor(metrics: IMetricsCollector, config?: Partial<CorsHttpMiddlewareConfig>);
    /**
     * Core CORS middleware execution logic
     * Handles both preflight and actual requests with comprehensive validation
     */
    protected execute(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
    /**
     * Handle CORS preflight requests with detailed validation
     */
    private handlePreflightRequest;
    /**
     * Set CORS headers with type-safe mutations
     */
    private setCorsHeaders;
    /**
     * Set preflight-specific headers
     */
    private setPreflightHeaders;
    /**
     * Extract origin from request with proper null handling
     */
    private extractOrigin;
    /**
     * Validate origin format
     */
    private isValidOriginFormat;
    /**
     * Validate origin against configuration with detailed result
     */
    private validateOrigin;
    /**
     * Handle CORS-related errors
     */
    private handleCorsError;
    /**
     * Record CORS-specific metrics
     */
    private recordCorsMetrics;
    /**
     * Validate configuration on instantiation
     */
    private validateConfiguration;
    /**
     * Create development configuration preset
     */
    static createDevelopmentConfig(): Partial<CorsHttpMiddlewareConfig>;
    /**
     * Create production configuration preset
     */
    static createProductionConfig(allowedOrigins: readonly string[]): Partial<CorsHttpMiddlewareConfig>;
    /**
     * Create API-specific configuration preset
     */
    static createApiConfig(): Partial<CorsHttpMiddlewareConfig>;
    /**
     * Create strict security configuration preset
     */
    static createStrictConfig(allowedOrigins: readonly string[]): Partial<CorsHttpMiddlewareConfig>;
}
/**
 * Factory function for CORS middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export declare function createCorsHttpMiddleware(metrics: IMetricsCollector, config?: Partial<CorsHttpMiddlewareConfig>): CorsHttpMiddleware;
/**
 * Preset configurations for common CORS scenarios
 * Immutable configuration objects for different environments
 */
export declare const CORS_PRESETS: {
    readonly development: () => Partial<CorsHttpMiddlewareConfig>;
    readonly production: (origins: readonly string[]) => Partial<CorsHttpMiddlewareConfig>;
    readonly api: () => Partial<CorsHttpMiddlewareConfig>;
    readonly strict: (origins: readonly string[]) => Partial<CorsHttpMiddlewareConfig>;
    readonly websocket: (origins: readonly string[]) => Partial<CorsHttpMiddlewareConfig>;
    readonly graphql: (origins: readonly string[]) => Partial<CorsHttpMiddlewareConfig>;
};
//# sourceMappingURL=cors.http.middleware.d.ts.map