import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base";
import type { MiddlewareContext } from "../types";
import { type RateLimitAlgorithm, type RateLimitResult, type RateLimitingStats } from "@libs/ratelimit";
/**
 * Internal rate limit result interface for middleware use
 */
/**
 * Rate limit configuration interface
 * Extends HttpMiddlewareConfig with rate limiting-specific options
 */
export interface RateLimitHttpMiddlewareConfig extends HttpMiddlewareConfig {
    readonly algorithm: RateLimitAlgorithm;
    readonly maxRequests: number;
    readonly windowMs: number;
    readonly keyStrategy: "ip" | "user" | "apiKey" | "custom";
    readonly customKeyGenerator?: (context: MiddlewareContext) => string;
    readonly standardHeaders?: boolean;
    readonly message?: string;
    readonly skipSuccessfulRequests?: boolean;
    readonly skipFailedRequests?: boolean;
    readonly skipOnError?: boolean;
    readonly redis?: {
        readonly keyPrefix?: string;
        readonly ttlBuffer?: number;
    };
    readonly onLimitReached?: (result: RateLimitResult, context: MiddlewareContext) => void;
}
/**
 * Production-grade Rate Limiting Middleware
 * Provides comprehensive rate limiting with configurable algorithms and strategies
 *
 * Features:
 * - Framework-agnostic implementation
 * - Multiple rate limiting algorithms (sliding-window, fixed-window, token-bucket, leaky-bucket)
 * - Flexible key generation strategies (IP, user, API key, custom)
 * - Enterprise-grade cache adapter integration
 * - Comprehensive metrics and monitoring
 * - Built-in error handling and failover
 * - Standard rate limit headers
 * - Configurable request filtering
 *
 * @template RateLimitHttpMiddlewareConfig - Rate limiting-specific configuration
 */
export declare class RateLimitHttpMiddleware extends BaseMiddleware<RateLimitHttpMiddlewareConfig> {
    private readonly rateLimiter;
    private readonly strategies;
    private readonly cacheService;
    constructor(metrics: IMetricsCollector, config?: Partial<RateLimitHttpMiddlewareConfig>);
    /**
     * Core rate limiting middleware execution logic
     * Handles rate limit checking with comprehensive error handling
     */
    protected execute(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
    /**
     * Handle rate limit exceeded scenario
     */
    private handleRateLimitExceeded;
    /**
     * Generate rate limit key using configured strategy
     */
    private generateKey;
    /**
     * Get the appropriate prefix for a strategy type
     */
    private getStrategyPrefix;
    /**
     * Check current rate limit status
     */
    private checkRateLimit;
    /**
     * Set standard rate limit headers
     */
    private setRateLimitHeaders;
    /**
     * Update request metrics based on success/failure rules
     */
    private updateRequestMetrics;
    /**
     * Determine if request should be counted towards rate limit
     */
    private shouldCountRequest;
    /**
     * Check if the current request should skip rate limiting
     */
    protected shouldSkip(context: MiddlewareContext): boolean;
    private extractUserId;
    /**
     * Extract API key from context for validation
     */
    private extractApiKey;
    /**
     * Check if a string looks like an API key
     */
    private looksLikeApiKey;
    /**
     * Get client IP address from context
     */
    protected getClientIp(context: MiddlewareContext): string;
    /**
     * Initialize cache service (this should use a service locator or factory in production)
     */
    private initializeCacheService;
    /**
     * Record rate limiting-specific metrics
     */
    private recordRateLimitMetrics;
    /**
     * Validate configuration on instantiation
     */
    private validateConfiguration;
    /**
     * Reset rate limit for a specific key
     */
    resetRateLimit(identifier: string): Promise<void>;
    /**
     * Get rate limit statistics
     */
    getRateLimitStats(): RateLimitingStats | null;
    /**
     * Get adapter health status
     */
    getHealth(): Promise<{
        healthy: boolean;
        cacheServiceHealth: unknown;
        adapterStats: RateLimitingStats;
    } | {
        healthy: boolean;
        error: string;
    }>;
    /**
     * Cleanup method to destroy the rate limiter and clear resources
     */
    cleanup(): Promise<void>;
    /**
     * Create general rate limiting configuration preset
     */
    static createGeneralConfig(): Partial<RateLimitHttpMiddlewareConfig>;
    /**
     * Create strict rate limiting configuration preset
     */
    static createStrictConfig(): Partial<RateLimitHttpMiddlewareConfig>;
    /**
     * Create API rate limiting configuration preset
     */
    static createApiConfig(): Partial<RateLimitHttpMiddlewareConfig>;
    /**
     * Create burst rate limiting configuration preset
     */
    static createBurstConfig(): Partial<RateLimitHttpMiddlewareConfig>;
    /**
     * Create development configuration preset
     */
    static createDevelopmentConfig(): Partial<RateLimitHttpMiddlewareConfig>;
    /**
     * Create production configuration preset
     */
    static createProductionConfig(): Partial<RateLimitHttpMiddlewareConfig>;
}
/**
 * Factory function for rate limit middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export declare function createRateLimitHttpMiddleware(metrics: IMetricsCollector, config?: Partial<RateLimitHttpMiddlewareConfig>): RateLimitHttpMiddleware;
/**
 * Preset configurations for common rate limiting scenarios
 * Immutable configuration objects for different environments
 */
export declare const RATE_LIMIT_PRESETS: {
    readonly general: () => Partial<RateLimitHttpMiddlewareConfig>;
    readonly strict: () => Partial<RateLimitHttpMiddlewareConfig>;
    readonly api: () => Partial<RateLimitHttpMiddlewareConfig>;
    readonly burst: () => Partial<RateLimitHttpMiddlewareConfig>;
    readonly development: () => Partial<RateLimitHttpMiddlewareConfig>;
    readonly production: () => Partial<RateLimitHttpMiddlewareConfig>;
};
//# sourceMappingURL=rateLimit.http.Middleware.d.ts.map