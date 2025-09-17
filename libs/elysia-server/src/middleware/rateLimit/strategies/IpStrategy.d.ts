import { MiddlewareContext } from "../../types";
export interface RateLimitStrategy {
    generateKey(context: MiddlewareContext): string;
}
/**
 * IP-based rate limiting strategy
 * Uses client IP address as the key
 */
export declare class IpStrategy implements RateLimitStrategy {
    /**
     * Generate a rate limit key using normalized and validated client IP
     * Caches headers for performance and safety
     */
    generateKey(context: MiddlewareContext): string;
    /**
     * Cache headers for performance (lowercase keys)
     */
    private cacheHeaders;
    /**
     * Extract client IP from headers or context
     * Checks common headers and falls back to request IP
     */
    private extractClientIp;
    /**
     * Validate IP address format (IPv4 and IPv6) using regex
     */
    private isValidIp;
    /**
     * Normalize IP address (removes port if present)
     */
    private normalizeIp;
}
//# sourceMappingURL=IpStrategy.d.ts.map