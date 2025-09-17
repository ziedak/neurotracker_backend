import { MiddlewareContext } from "../../types";
export interface RateLimitStrategy {
    generateKey(context: MiddlewareContext): string;
}
/**
 * API key-based rate limiting strategy
 * Uses API key as the rate limiting key
 * Falls back to IP if no API key is present
 * Optimized for performance, maintainability, and strict validation
 */
export declare class ApiKeyStrategy implements RateLimitStrategy {
    /**
     * Generate a rate limit key based on API key or fallback to IP
     * Caches headers for performance, uses helpers for extraction and validation
     */
    generateKey(context: MiddlewareContext): string;
    /**
     * Cache headers for performance (lowercase keys)
     */
    private cacheHeaders;
    /**
     * Extract API key from headers, authorization, or user context
     * Integrates isValidApiKey for strict validation
     */
    private extractApiKey;
    /**
     * Extract API key from standard headers
     */
    private extractFromHeaders;
    /**
     * Extract API key from Authorization header
     */
    private extractFromAuthorization;
    /**
     * Extract API key from user context
     */
    private extractFromUser;
    /**
     * Match "ApiKey <key>" format in Authorization header
     */
    private static matchApiKeyAuth;
    /**
     * Match "Bearer <key>" format in Authorization header
     */
    private static matchBearerAuth;
    /**
     * Extract client IP for fallback (centralized for reuse)
     */
    static extractClientIp(headers: Record<string, string | undefined>, context: MiddlewareContext): string;
    /**
     * Check if a string looks like an API key
     * API keys are typically longer and don't contain dots (unlike JWTs)
     */
    private looksLikeApiKey;
    /**
     * Mask API key for logging
     */
    static maskApiKey(apiKey: string): string;
    /**
     * Validate API key format using zod
     */
    private isValidApiKey;
}
//# sourceMappingURL=ApiKeyStrategy.d.ts.map