import { MiddlewareContext } from "../../types";
export interface RateLimitStrategy {
    generateKey(context: MiddlewareContext): string;
}
/**
 * User-based rate limiting strategy
 * Primary strategy: Uses authenticated user ID for rate limiting
 * Secondary strategy: Uses session ID for semi-persistent anonymous users
 * Fallback strategy: Uses IP address for completely anonymous requests
 *
 * This strategy is ideal for applications where you want to:
 * - Rate limit authenticated users individually
 * - Maintain some consistency for anonymous users within a session
 * - Prevent abuse from anonymous requests
 */
export declare class UserStrategy implements RateLimitStrategy {
    private readonly useSessionForAnonymous;
    private readonly anonymousPrefix;
    constructor(options?: {
        useSessionForAnonymous?: boolean;
        anonymousPrefix?: string;
    });
    generateKey(context: MiddlewareContext): string;
    /**
     * Extract user ID from context
     * Checks multiple common patterns for user identification
     */
    private extractUserId;
    /**
     * Extract session ID from context
     * Checks cookies, headers, and context for session information
     */
    private extractSessionId;
    /**
     * Extract session ID from cookie string
     * Looks for common session cookie names
     */
    private extractSessionFromCookie;
    /**
     * Extract client IP address as fallback
     * Simple extraction without the complexity of IpStrategy
     */
    private extractClientIp;
}
/**
 * Factory function to create UserStrategy with common configurations
 */
export declare const createUserStrategy: {
    /**
     * Standard user strategy with session fallback
     */
    standard: () => UserStrategy;
    /**
     * Strict user strategy - only authenticated users get individual limits
     * Anonymous users all share the same limit pool
     */
    strict: () => UserStrategy;
    /**
     * Session-aware strategy - tries to maintain consistency for anonymous users
     */
    sessionAware: () => UserStrategy;
};
//# sourceMappingURL=UserStrategy.d.ts.map