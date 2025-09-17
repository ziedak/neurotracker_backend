/**

 * Phase 3.1.2: Enterprise-grade adapter combining cache library with rate limiting
 */
import { CacheService, CacheConfigValidator } from "@libs/database";
import type { RateLimitResult } from "../types";
/**
 * Rate limiting algorithms supported
 */
export type RateLimitAlgorithm = "fixed-window" | "sliding-window" | "token-bucket" | "leaky-bucket";
/**
 * Rate limit request for batch operations
 */
export interface RateLimitRequest {
    identifier: string;
    limit: number;
    windowMs: number;
    algorithm?: RateLimitAlgorithm;
    weight?: number;
}
/**
 * Batch processing result
 */
export interface BatchRateLimitResult {
    results: RateLimitResult[];
    totalResponseTime: number;
    cacheHitRate: number;
    errorCount: number;
}
/**
 * Rate limiting statistics
 */
export interface RateLimitingStats {
    totalRequests: number;
    allowedRequests: number;
    blockedRequests: number;
    averageResponseTime: number;
    cacheHitRate: number;
    algorithmDistribution: Record<RateLimitAlgorithm, number>;
    memoryUsage: {
        currentMB: number;
        peakMB: number;
        utilizationPercent: number;
    };
}
/**
 * Configuration for rate limiting adapter
 */
export interface RateLimitingAdapterConfig {
    defaultAlgorithm: RateLimitAlgorithm;
    enableBatchProcessing: boolean;
    maxBatchSize: number;
    enableMetrics: boolean;
    enableCompression: boolean;
    compressionThreshold: number;
    keyPrefix: string;
    ttlBufferMs: number;
    lockTimeoutMs: number;
    enableCoherency: boolean;
}
/**
 * Default configuration optimized for rate limiting
 */
export declare const DEFAULT_RATE_LIMITING_ADAPTER_CONFIG: RateLimitingAdapterConfig;
/**
 * Enterprise-grade rate limiting cache adapter
 * Combines cache library features with optimized rate limiting algorithms
 */
export declare class RateLimitingCacheAdapter {
    private readonly cacheService;
    private readonly configValidator;
    private readonly config;
    private readonly stats;
    private readonly lockManager;
    private readonly logger;
    constructor(cacheService: CacheService, configValidator: CacheConfigValidator, config?: Partial<RateLimitingAdapterConfig>);
    /**
     * Check rate limit with enterprise cache features
     */
    checkRateLimit(identifier: string, limit: number, windowMs: number, algorithm?: RateLimitAlgorithm): Promise<RateLimitResult>;
    /**
     * Batch rate limit checks for high performance
     */
    checkMultipleRateLimits(requests: RateLimitRequest[]): Promise<BatchRateLimitResult>;
    /**
     * Execute the actual rate limit check with algorithm-specific logic
     */
    private executeRateLimitCheck;
    /**
     * Fixed window algorithm implementation
     */
    private checkFixedWindow;
    /**
     * Sliding window algorithm implementation with compression
     */
    private checkSlidingWindow;
    /**
     * Token bucket algorithm implementation
     */
    private checkTokenBucket;
    /**
     * Leaky bucket algorithm implementation
     */
    private checkLeakyBucket;
    /**
     * Generate optimized cache key for rate limiting
     */
    private generateCacheKey;
    /**
     * Align key to fixed window boundaries
     */
    private alignToFixedWindow;
    /**
     * Calculate optimal TTL with buffer
     */
    private calculateOptimalTTL;
    /**
     * Get next window start time
     */
    private getNextWindowStart;
    /**
     * Update adapter statistics
     */
    private updateStatistics;
    /**
     * Update memory usage statistics
     */
    private updateMemoryStats;
    /**
     * Validate adapter configuration
     */
    private validateConfiguration;
    /**
     * Reset rate limit for specific identifier
     */
    resetRateLimit(identifier: string, algorithm?: RateLimitAlgorithm): Promise<void>;
    /**
     * Warmup rate limiting keys for better performance
     */
    warmupRateLimitKeys(identifiers: string[]): Promise<void>;
    /**
     * Get comprehensive adapter statistics
     */
    getRateLimitingStats(): RateLimitingStats;
    /**
     * Get cache service health status
     */
    getHealth(): Promise<{
        healthy: boolean;
        cacheServiceHealth: any;
        adapterStats: RateLimitingStats;
    }>;
    /**
     * Cleanup resources
     */
    destroy(): Promise<void>;
}
//# sourceMappingURL=RateLimitingCacheAdapter.d.ts.map