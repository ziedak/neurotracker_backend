import { MiddlewareContext } from '../../types';
import { RateLimitStrategy } from '../RateLimitMiddleware';

/**
 * IP-based rate limiting strategy
 * Uses client IP address as the key
 */
export class IpStrategy implements RateLimitStrategy {
  generateKey(context: MiddlewareContext): string {
    const ip = this.extractClientIp(context);
    return `ip:${ip}`;
  }

  /**
   * Extract client IP from context
   */
  private extractClientIp(context: MiddlewareContext): string {
    const headers = context.request.headers;
    
    // Check various headers for client IP
    const xForwardedFor = headers['x-forwarded-for'];
    if (xForwardedFor) {
      // X-Forwarded-For can contain multiple IPs, take the first one
      return xForwardedFor.split(',')[0].trim();
    }

    const xRealIp = headers['x-real-ip'];
    if (xRealIp) {
      return xRealIp;
    }

    const cfConnectingIp = headers['cf-connecting-ip'];
    if (cfConnectingIp) {
      return cfConnectingIp;
    }

    // Fallback to request IP
    return context.request.ip || 'unknown';
  }

  /**
   * Validate IP address format
   */
  private isValidIp(ip: string): boolean {
    // Basic IP validation (IPv4 and IPv6)
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }

  /**
   * Normalize IP address
   */
  private normalizeIp(ip: string): string {
    // Remove port if present
    const colonIndex = ip.lastIndexOf(':');
    if (colonIndex > 0 && ip.indexOf('.') > 0) {
      // IPv4 with port
      return ip.substring(0, colonIndex);
    }

    return ip;
  }
}