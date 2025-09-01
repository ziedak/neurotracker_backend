import { MiddlewareContext } from "../../types";
import { RateLimitStrategy } from "../RateLimitMiddleware";
import { z } from "@libs/utils";

/**
 * User-based rate limiting strategy
 * Uses authenticated user ID as the key
 * Falls back to IP if user is not authenticated
 */
export class UserStrategy implements RateLimitStrategy {
  generateKey(context: MiddlewareContext): string {
    const userId = context.user?.id;
    if (userId && !context.user?.anonymous) {
      return `user:${userId}`;
    }
    // Fallback to IP-based strategy for anonymous users
    const headers = this.cacheHeaders(context.request.headers);
    let ip = this.extractClientIp(headers, context);
    ip = this.normalizeIp(ip);
    if (!this.isValidIp(ip)) {
      ip = "unknown";
    }
    return `user_fallback:${ip}`;
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
    const xForwardedFor = headers["x-forwarded-for"];
    if (xForwardedFor) {
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
    if (ip.includes(":")) {
      if (ip.indexOf(".") > 0) {
        const colonIndex = ip.lastIndexOf(":");
        return ip.substring(0, colonIndex);
      }
      const match = ip.match(/^\[([0-9a-fA-F:]+)\](?::\d+)?$/);
      if (match && match[1]) {
        return match[1];
      }
    }
    return ip;
  }
}
