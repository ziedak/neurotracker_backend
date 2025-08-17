import { MiddlewareContext } from '../../types';
import { RateLimitStrategy } from '../RateLimitMiddleware';

/**
 * User-based rate limiting strategy
 * Uses authenticated user ID as the key
 * Falls back to IP if user is not authenticated
 */
export class UserStrategy implements RateLimitStrategy {
  generateKey(context: MiddlewareContext): string {
    // Try to get user ID from context
    const userId = context.user?.id;
    
    if (userId && !context.user?.anonymous) {
      return `user:${userId}`;
    }

    // Fallback to IP-based strategy for anonymous users
    const ip = this.extractClientIp(context);
    return `user_fallback:${ip}`;
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
   * Check if user is authenticated
   */
  private isAuthenticated(context: MiddlewareContext): boolean {
    return !!(context.user?.id && !context.user?.anonymous);
  }

  /**
   * Get fallback strategy name
   */
  private getFallbackStrategy(context: MiddlewareContext): 'user' | 'ip' {
    return this.isAuthenticated(context) ? 'user' : 'ip';
  }
}