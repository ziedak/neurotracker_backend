import { MiddlewareContext } from "../../types";
import { z } from "@libs/utils";

export interface RateLimitStrategy {
  generateKey(context: MiddlewareContext): string;
}
/**
 * IP-based rate limiting strategy
 * Uses client IP address as the key
 */
export class IpStrategy implements RateLimitStrategy {
  /**
   * Generate a rate limit key using normalized and validated client IP
   * Caches headers for performance and safety
   */
  generateKey(context: MiddlewareContext): string {
    const headers = this.cacheHeaders(context.request.headers);
    let ip = this.extractClientIp(headers, context);
    ip = this.normalizeIp(ip);
    if (!this.isValidIp(ip)) {
      ip = "unknown";
    }
    return `ip:${ip}`;
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
   * Extract client IP from headers or context
   * Checks common headers and falls back to request IP
   */
  private extractClientIp(
    headers: Record<string, string | undefined>,
    context: MiddlewareContext
  ): string {
    // Check various headers for client IP
    const xForwardedFor = headers["x-forwarded-for"];
    if (xForwardedFor) {
      // X-Forwarded-For can contain multiple IPs, take the first one
      const firstIp = xForwardedFor.split(",")[0]?.trim();
      return firstIp || "unknown";
    }

    const xRealIp = headers["x-real-ip"];
    if (xRealIp) {
      return xRealIp;
    }

    const cfConnectingIp = headers["cf-connecting-ip"];
    if (cfConnectingIp) {
      return cfConnectingIp;
    }

    // Fallback to request IP
    return context.request.ip || "unknown";
  }

  /**
   * Validate IP address format using zod (IPv4 and IPv6)
   */
  private isValidIp(ip: string): boolean {
    const ipSchema = z.union([
      z.string().ip({ version: "v4" }),
      z.string().ip({ version: "v6" }),
    ]);
    return ipSchema.safeParse(ip).success;
  }

  /**
   * Normalize IP address (removes port if present)
   */
  private normalizeIp(ip: string): string {
    // Remove port if present (IPv4:port or IPv6:port)
    // IPv6 addresses may contain multiple colons, so only remove port if present after last colon
    if (ip.includes(":")) {
      // If IPv4 with port (e.g., 192.168.1.1:12345)
      if (ip.indexOf(".") > 0) {
        const colonIndex = ip.lastIndexOf(":");
        return ip.substring(0, colonIndex);
      }
      // If IPv6 with port (e.g., [2001:db8::1]:12345)
      const match = ip.match(/^\[([0-9a-fA-F:]+)\](?::\d+)?$/);
      if (match && match[1]) {
        return match[1];
      }
    }
    return ip;
  }
}
