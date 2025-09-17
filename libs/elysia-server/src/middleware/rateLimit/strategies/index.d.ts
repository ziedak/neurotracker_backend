export { IpStrategy } from "./IpStrategy";
export { UserStrategy, createUserStrategy } from "./UserStrategy";
export { ApiKeyStrategy } from "./ApiKeyStrategy";
export type { RateLimitStrategy } from "./ApiKeyStrategy";
import { IpStrategy } from "./IpStrategy";
import { ApiKeyStrategy } from "./ApiKeyStrategy";
/**
 * Strategy factory for common rate limiting scenarios
 * Provides pre-configured strategy instances for different use cases
 */
export declare const createRateLimitStrategy: {
    /**
     * IP-based rate limiting - standard configuration
     * Best for: General API protection, anonymous endpoints
     */
    readonly ip: () => IpStrategy;
    /**
     * User-based rate limiting - standard configuration with session fallback
     * Best for: Authenticated APIs with guest access
     */
    readonly user: () => import("./UserStrategy").UserStrategy;
    /**
     * User-based rate limiting - strict authenticated-only
     * Best for: APIs that require authentication
     */
    readonly userStrict: () => import("./UserStrategy").UserStrategy;
    /**
     * User-based rate limiting - session-aware for better UX
     * Best for: Web applications with sessions
     */
    readonly userSessionAware: () => import("./UserStrategy").UserStrategy;
    /**
     * API key-based rate limiting
     * Best for: API services, third-party integrations
     */
    readonly apiKey: () => ApiKeyStrategy;
};
/**
 * Rate limiting strategy presets for common application types
 */
export declare const RATE_LIMIT_STRATEGY_PRESETS: {
    /**
     * Web application with mixed authenticated/anonymous access
     */
    readonly webApp: () => import("./UserStrategy").UserStrategy;
    /**
     * REST API with authentication
     */
    readonly restApi: () => import("./UserStrategy").UserStrategy;
    /**
     * Public API with API key authentication
     */
    readonly publicApi: () => ApiKeyStrategy;
    /**
     * Internal API with strict user authentication
     */
    readonly internalApi: () => import("./UserStrategy").UserStrategy;
    /**
     * CDN/Proxy protection (IP-based)
     */
    readonly cdn: () => IpStrategy;
    /**
     * Anonymous service (IP-based)
     */
    readonly anonymous: () => IpStrategy;
};
//# sourceMappingURL=index.d.ts.map