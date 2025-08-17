import { MiddlewareContext } from '../../types';
import { RateLimitStrategy } from '../RateLimitMiddleware';

/**
 * API key-based rate limiting strategy
 * Uses API key as the rate limiting key
 * Falls back to IP if no API key is present
 */
export class ApiKeyStrategy implements RateLimitStrategy {
  generateKey(context: MiddlewareContext): string {
    // Try to get API key from headers
    const apiKey = this.extractApiKey(context);
    
    if (apiKey) {
      // Use first 10 characters of API key for privacy
      const keyPrefix = apiKey.substring(0, 10);
      return `api:${keyPrefix}`;
    }

    // Fallback to IP-based strategy
    const ip = this.extractClientIp(context);
    return `api_fallback:${ip}`;
  }

  /**
   * Extract API key from various headers
   */
  private extractApiKey(context: MiddlewareContext): string | null {
    const headers = context.request.headers;
    
    // Check standard API key headers
    const apiKey = headers['x-api-key'] || headers['api-key'];
    if (apiKey) {
      return apiKey;
    }

    // Check Authorization header for API key
    const authHeader = headers.authorization;
    if (authHeader) {
      // Check for "ApiKey <key>" format
      const apiKeyMatch = authHeader.match(/^ApiKey\s+(.+)$/i);
      if (apiKeyMatch) {
        return apiKeyMatch[1];
      }

      // Check for "Bearer <key>" format (if it looks like an API key)
      const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (bearerMatch && this.looksLikeApiKey(bearerMatch[1])) {
        return bearerMatch[1];
      }
    }

    // Check if user context has API key info
    if (context.user?.apiKey) {
      return context.user.apiKey;
    }

    return null;
  }

  /**
   * Extract client IP for fallback
   */
  private extractClientIp(context: MiddlewareContext): string {
    const headers = context.request.headers;
    
    return (
      headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      headers['x-real-ip'] ||
      headers['cf-connecting-ip'] ||
      context.request.ip ||
      'unknown'
    );
  }

  /**
   * Check if a string looks like an API key
   * API keys are typically longer and don't contain dots (unlike JWTs)
   */
  private looksLikeApiKey(token: string): boolean {
    // API keys are usually:
    // - Longer than 20 characters
    // - Don't contain dots (unlike JWTs which have 3 parts separated by dots)
    // - Contain alphanumeric characters and possibly hyphens/underscores
    return (
      token.length >= 20 &&
      !token.includes('.') &&
      /^[a-zA-Z0-9_-]+$/.test(token)
    );
  }

  /**
   * Mask API key for logging
   */
  private maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) {
      return '***';
    }
    return `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
  }

  /**
   * Validate API key format
   */
  private isValidApiKey(apiKey: string): boolean {
    // Basic validation
    return apiKey.length >= 10 && apiKey.length <= 100;
  }
}