/**
 * Core types for rate limiting system
 */
import type { RateLimitAlgorithm } from "./adapters/RateLimitingCacheAdapter";
export type { RateLimitAlgorithm };
/**
 * Rate limit result interface
 */
export interface RateLimitResult {
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
 * Rate limit configuration interface
 */
export interface RateLimitConfig {
    algorithm: "sliding-window" | "fixed-window" | "token-bucket" | "leaky-bucket";
    maxRequests: number;
    windowMs: number;
    keyPrefix?: string;
    ttlBuffer?: number;
    keyStrategy?: "ip" | "user" | "apiKey" | "custom";
    customKeyGenerator?: (context: any) => string;
    standardHeaders?: boolean;
    message?: string;
    skipOnError?: boolean;
    skipSuccessfulRequests?: boolean;
    onLimitReached?: (result: RateLimitResult) => void;
}
//# sourceMappingURL=types.d.ts.map