import { type IMetricsCollector } from "@libs/monitoring";
import { BaseWebSocketMiddleware, type WebSocketMiddlewareConfig } from "../base/BaseWebSocketMiddleware";
import type { WebSocketContext } from "../types";
import { type RateLimitAlgorithm } from "@libs/ratelimit";
/**
 * Internal WebSocket rate limit result interface
 */
export interface RateLimitWebSocketResult {
    allowed: boolean;
    totalHits: number;
    remaining: number;
    resetTime: number;
    windowStart: number;
    windowEnd: number;
    limit: number;
    retryAfter?: number;
    algorithm: RateLimitAlgorithm;
    cached: boolean;
    responseTime: number;
}
/**
 * Advanced WebSocket Rate limit configuration interface
 * Extends WebSocketMiddlewareConfig with comprehensive rate limiting options
 */
export interface AdvancedRateLimitWebSocketConfig extends WebSocketMiddlewareConfig {
    readonly algorithm: RateLimitAlgorithm;
    readonly maxMessagesPerMinute: number;
    readonly maxConnectionsPerIP?: number;
    readonly windowMs: number;
    readonly keyStrategy: "ip" | "user" | "connectionId" | "custom";
    readonly customKeyGenerator?: (context: WebSocketContext) => string;
    readonly countMessageTypes?: readonly string[];
    readonly excludeMessageTypes?: readonly string[];
    readonly enableConnectionLimiting?: boolean;
    readonly closeOnLimit?: boolean;
    readonly sendWarningMessage?: boolean;
    readonly warningThreshold?: number;
    readonly maxMessageSize?: number;
    readonly redis: {
        readonly keyPrefix: string;
        readonly ttlBuffer: number;
    };
    readonly onLimitReached?: (result: RateLimitWebSocketResult, context: WebSocketContext) => void;
    readonly message: {
        readonly rateLimitExceeded: string;
        readonly connectionLimitExceeded: string;
        readonly warningMessage: string;
    };
}
/**
 * Production-grade WebSocket Rate Limiting Middleware
 * Provides comprehensive rate limiting for WebSocket connections and messages
 *
 * Features:
 * - Framework-agnostic WebSocket implementation
 * - Multiple rate limiting algorithms (sliding-window, fixed-window, token-bucket, leaky-bucket)
 * - Connection-level and message-level rate limiting
 * - Flexible key generation strategies (IP, user, connectionId, custom)
 * - Enterprise-grade cache adapter integration
 * - Message type filtering (include/exclude specific types)
 * - Warning system before limits are reached
 * - Comprehensive metrics and monitoring
 * - Built-in error handling and failover
 * - Configurable connection closure on limit breach
 *
 * @template AdvancedRateLimitWebSocketConfig - WebSocket rate limiting-specific configuration
 */
export declare class RateLimitWebSocketMiddleware extends BaseWebSocketMiddleware<AdvancedRateLimitWebSocketConfig> {
    private readonly rateLimiter;
    private readonly connectionLimiter?;
    private readonly strategies;
    private readonly cacheService;
    constructor(metrics: IMetricsCollector, config?: Partial<AdvancedRateLimitWebSocketConfig>);
    /**
     * Core WebSocket rate limiting middleware execution logic
     * Handles both connection and message rate limiting
     */
    protected execute(context: WebSocketContext, next: () => Promise<void>): Promise<void>;
    /**
     * Check connection rate limits (per IP)
     */
    private checkConnectionLimit;
    /**
     * Check message rate limits
     */
    private checkMessageRateLimit;
    /**
     * Handle rate limit exceeded scenario
     */
    private handleRateLimitExceeded;
    /**
     * Check if warning should be sent and send it
     */
    private checkAndSendWarning;
    /**
     * Send error message to WebSocket client
     */
    private sendErrorMessage;
    /**
     * Send warning message to WebSocket client
     */
    private sendWarningMessage;
    /**
     * Generate rate limit key using configured strategy
     */
    private generateKey;
    /**
     * Determine if message type should be counted towards rate limit
     */
    private shouldCountMessage;
    /**
     * Generate unique request ID
     */
    private generateRequestId;
    /**
     * Initialize cache service
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
    resetRateLimit(identifier: string, limitType?: "message" | "connection"): Promise<void>;
    /**
     * Get rate limit statistics with proper typing
     */
    getRateLimitStats(): {
        messageStats: import("@libs/ratelimit").RateLimitingStats | null;
        connectionStats?: import("@libs/ratelimit").RateLimitingStats;
    };
    /**
     * Get adapter health status
     */
    getHealth(): Promise<{
        messageRateLimiter: Record<string, unknown>;
        connectionRateLimiter?: Record<string, unknown>;
    }>;
    /**
     * Create general WebSocket rate limiting configuration preset
     */
    static createGeneralConfig(): Partial<AdvancedRateLimitWebSocketConfig>;
    /**
     * Create strict WebSocket rate limiting configuration preset
     */
    static createStrictConfig(): Partial<AdvancedRateLimitWebSocketConfig>;
    /**
     * Create gaming WebSocket rate limiting configuration preset
     */
    static createGamingConfig(): Partial<AdvancedRateLimitWebSocketConfig>;
    /**
     * Create chat WebSocket rate limiting configuration preset
     */
    static createChatConfig(): Partial<AdvancedRateLimitWebSocketConfig>;
    /**
     * Create development configuration preset
     */
    static createDevelopmentConfig(): Partial<AdvancedRateLimitWebSocketConfig>;
    /**
     * Create production configuration preset
     */
    static createProductionConfig(): Partial<AdvancedRateLimitWebSocketConfig>;
}
/**
 * Factory function for WebSocket rate limit middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export declare function createRateLimitWebSocketMiddleware(metrics: IMetricsCollector, config?: Partial<AdvancedRateLimitWebSocketConfig>): RateLimitWebSocketMiddleware;
/**
 * Preset configurations for common WebSocket rate limiting scenarios
 * Immutable configuration objects for different environments and use cases
 */
export declare const WEBSOCKET_RATE_LIMIT_PRESETS: {
    readonly general: () => Partial<AdvancedRateLimitWebSocketConfig>;
    readonly strict: () => Partial<AdvancedRateLimitWebSocketConfig>;
    readonly gaming: () => Partial<AdvancedRateLimitWebSocketConfig>;
    readonly chat: () => Partial<AdvancedRateLimitWebSocketConfig>;
    readonly development: () => Partial<AdvancedRateLimitWebSocketConfig>;
    readonly production: () => Partial<AdvancedRateLimitWebSocketConfig>;
};
//# sourceMappingURL=rateLimit.websocket.middleware.d.ts.map