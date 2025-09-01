import { MiddlewareContext } from "../../types";
import { RateLimitStrategy } from "./RateLimitMiddleware";
import { z } from "@libs/utils";

/**
 * API key-based rate limiting strategy
 * Uses API key as the rate limiting key
 * Falls back to IP if no API key is present
 * Optimized for performance, maintainability, and strict validation
 */
export class ApiKeyStrategy implements RateLimitStrategy {
  /**
   * Generate a rate limit key based on API key or fallback to IP
   * Caches headers for performance, uses helpers for extraction and validation
   */
  generateKey(context: MiddlewareContext): string {
    const headers = this.cacheHeaders(context.request.headers);
    const apiKey = this.extractApiKey(headers, context);
    if (apiKey) {
      // Use first 10 characters of API key for privacy
      const keyPrefix = apiKey.substring(0, 10);
      return `api:${keyPrefix}`;
    }
    // Fallback to IP-based strategy
    const ip = ApiKeyStrategy.extractClientIp(headers, context);
    // Example logging usage of maskApiKey (if logger available)
    // logger?.warn(`API key missing, falling back to IP: ${ApiKeyStrategy.maskApiKey(ip)}`);
    return `api_fallback:${ip}`;
  }

  /**
   * Cache headers for performance (lowercase keys)
   */
  private cacheHeaders(
    headers: Record<string, string | undefined>
  ): Record<string, string | undefined> {
    const cached: Record<string, string | undefined> = {};
    for (const key in headers) {
      cached[key.toLowerCase()] = headers[key];
    }
    return cached;
  }

  /**
   * Extract API key from headers, authorization, or user context
   * Integrates isValidApiKey for strict validation
   */
  private extractApiKey(
    headers: Record<string, string | undefined>,
    context: MiddlewareContext
  ): string | null {
    // Try standard API key headers
    const apiKey = this.extractFromHeaders(headers);
    if (apiKey && this.isValidApiKey(apiKey)) return apiKey;

    // Try Authorization header
    const authKey = this.extractFromAuthorization(headers);
    if (authKey && this.isValidApiKey(authKey)) return authKey;

    // Try user context
    const userKey = this.extractFromUser(context);
    if (userKey && this.isValidApiKey(userKey)) return userKey;

    return null;
  }

  /**
   * Extract API key from standard headers
   */
  private extractFromHeaders(
    headers: Record<string, string | undefined>
  ): string | null {
    return headers["x-api-key"] || headers["api-key"] || null;
  }

  /**
   * Extract API key from Authorization header
   */
  private extractFromAuthorization(
    headers: Record<string, string | undefined>
  ): string | null {
    const authHeader = headers["authorization"];
    if (!authHeader) return null;
    const apiKeyMatch = ApiKeyStrategy.matchApiKeyAuth(authHeader);
    if (apiKeyMatch) return apiKeyMatch;
    const bearerMatch = ApiKeyStrategy.matchBearerAuth(authHeader);
    if (bearerMatch && this.looksLikeApiKey(bearerMatch)) return bearerMatch;
    return null;
  }

  /**
   * Extract API key from user context
   */
  private extractFromUser(context: MiddlewareContext): string | null {
    return context.user?.["apiKey"] || null;
  }

  /**
   * Match "ApiKey <key>" format in Authorization header
   */
  private static matchApiKeyAuth(authHeader: string): string | null {
    const match = authHeader.match(/^ApiKey\s+(.+)$/i);
    return match && typeof match[1] === "string" ? match[1] : null;
  }

  /**
   * Match "Bearer <key>" format in Authorization header
   */
  private static matchBearerAuth(authHeader: string): string | null {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match && typeof match[1] === "string" ? match[1] : null;
  }

  /**
   * Extract client IP for fallback (centralized for reuse)
   */
  static extractClientIp(
    headers: Record<string, string | undefined>,
    context: MiddlewareContext
  ): string {
    return (
      headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      headers["x-real-ip"] ||
      headers["cf-connecting-ip"] ||
      context.request.ip ||
      "unknown"
    );
  }

  /**
   * Check if a string looks like an API key
   * API keys are typically longer and don't contain dots (unlike JWTs)
   */
  private looksLikeApiKey(token: string): boolean {
    return (
      token.length >= 20 &&
      !token.includes(".") &&
      /^[a-zA-Z0-9_-]+$/.test(token)
    );
  }

  /**
   * Mask API key for logging
   */
  static maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) {
      return "***";
    }
    return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
  }

  /**
   * Validate API key format using zod
   */
  private isValidApiKey(apiKey: string): boolean {
    const apiKeySchema = z.string().min(10).max(100);
    return apiKeySchema.safeParse(apiKey).success;
  }
}
