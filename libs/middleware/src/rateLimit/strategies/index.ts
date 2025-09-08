export { IpStrategy } from "./IpStrategy";
export { UserStrategy, createUserStrategy } from "./UserStrategy";
export { ApiKeyStrategy, RateLimitStrategy } from "./ApiKeyStrategy";

// Import classes for internal factory use
import { IpStrategy } from "./IpStrategy";
import { ApiKeyStrategy } from "./ApiKeyStrategy";
import { createUserStrategy } from "./UserStrategy";

/**
 * Strategy factory for common rate limiting scenarios
 * Provides pre-configured strategy instances for different use cases
 */
export const createRateLimitStrategy = {
  /**
   * IP-based rate limiting - standard configuration
   * Best for: General API protection, anonymous endpoints
   */
  ip: () => new IpStrategy(),

  /**
   * User-based rate limiting - standard configuration with session fallback
   * Best for: Authenticated APIs with guest access
   */
  user: () => createUserStrategy.standard(),

  /**
   * User-based rate limiting - strict authenticated-only
   * Best for: APIs that require authentication
   */
  userStrict: () => createUserStrategy.strict(),

  /**
   * User-based rate limiting - session-aware for better UX
   * Best for: Web applications with sessions
   */
  userSessionAware: () => createUserStrategy.sessionAware(),

  /**
   * API key-based rate limiting
   * Best for: API services, third-party integrations
   */
  apiKey: () => new ApiKeyStrategy(),
} as const;

/**
 * Rate limiting strategy presets for common application types
 */
export const RATE_LIMIT_STRATEGY_PRESETS = {
  /**
   * Web application with mixed authenticated/anonymous access
   */
  webApp: () => createRateLimitStrategy.userSessionAware(),

  /**
   * REST API with authentication
   */
  restApi: () => createRateLimitStrategy.user(),

  /**
   * Public API with API key authentication
   */
  publicApi: () => createRateLimitStrategy.apiKey(),

  /**
   * Internal API with strict user authentication
   */
  internalApi: () => createRateLimitStrategy.userStrict(),

  /**
   * CDN/Proxy protection (IP-based)
   */
  cdn: () => createRateLimitStrategy.ip(),

  /**
   * Anonymous service (IP-based)
   */
  anonymous: () => createRateLimitStrategy.ip(),
} as const;
