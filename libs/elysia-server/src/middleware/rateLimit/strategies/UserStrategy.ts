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
export class UserStrategy implements RateLimitStrategy {
  private readonly useSessionForAnonymous: boolean;
  private readonly anonymousPrefix: string;

  constructor(
    options: {
      useSessionForAnonymous?: boolean;
      anonymousPrefix?: string;
    } = {}
  ) {
    this.useSessionForAnonymous = options.useSessionForAnonymous ?? true;
    this.anonymousPrefix = options.anonymousPrefix ?? "anon";
  }

  generateKey(context: MiddlewareContext): string {
    // Primary: Use authenticated user ID
    const userId = this.extractUserId(context);
    if (userId) {
      return `user:${userId}`;
    }

    // Secondary: Use session ID for anonymous users (if enabled and available)
    if (this.useSessionForAnonymous) {
      const sessionId = this.extractSessionId(context);
      if (sessionId) {
        return `${this.anonymousPrefix}_session:${sessionId}`;
      }
    }

    // Fallback: Use IP address for completely anonymous requests
    const ip = this.extractClientIp(context);
    return `${this.anonymousPrefix}_ip:${ip}`;
  }

  /**
   * Extract user ID from context
   * Checks multiple common patterns for user identification
   */
  private extractUserId(context: MiddlewareContext): string | null {
    // Check context.user (most common pattern)
    if (context.user?.id && !context.user?.anonymous) {
      return String(context.user.id);
    }

    // Check context.userId (alternative pattern)
    if (context["userId"] && context["userId"] !== "anonymous") {
      return String(context["userId"]);
    }

    // Check JWT payload (if JWT is used)
    const jwt = context["jwt"] as
      | { payload?: { sub?: string; user_id?: string } }
      | undefined;
    if (jwt?.payload?.sub) {
      return String(jwt.payload.sub);
    }

    // Check JWT payload user_id (alternative JWT pattern)
    if (jwt?.payload?.user_id) {
      return String(jwt.payload.user_id);
    }

    // Check authentication object
    const auth = context["auth"] as { userId?: string } | undefined;
    if (auth?.userId) {
      return String(auth.userId);
    }

    return null;
  }

  /**
   * Extract session ID from context
   * Checks cookies, headers, and context for session information
   */
  private extractSessionId(context: MiddlewareContext): string | null {
    // Check context.session (most common pattern)
    if (context.session?.id) {
      return String(context.session.id);
    }

    // Check context.sessionId (alternative pattern)
    if (context["sessionId"]) {
      return String(context["sessionId"]);
    }

    // Check cookies for session ID
    const cookies = context.request.headers["cookie"];
    if (cookies) {
      const sessionCookie = this.extractSessionFromCookie(cookies);
      if (sessionCookie) {
        return sessionCookie;
      }
    }

    // Check headers for session ID
    const sessionHeader =
      context.request.headers["x-session-id"] ||
      context.request.headers["session-id"];
    if (sessionHeader) {
      return String(sessionHeader);
    }

    return null;
  }

  /**
   * Extract session ID from cookie string
   * Looks for common session cookie names
   */
  private extractSessionFromCookie(cookieString: string): string | null {
    const sessionCookieNames = [
      "sessionid",
      "session_id",
      "connect.sid",
      "PHPSESSID",
      "JSESSIONID",
      "session",
      "sid",
    ];

    for (const cookieName of sessionCookieNames) {
      const regex = new RegExp(`${cookieName}=([^;]+)`);
      const match = cookieString.match(regex);
      if (match?.[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Extract client IP address as fallback
   * Simple extraction without the complexity of IpStrategy
   */
  private extractClientIp(context: MiddlewareContext): string {
    // Check common forwarded headers
    const {headers} = context.request;

    // X-Forwarded-For (most common)
    const xForwardedFor = headers["x-forwarded-for"];
    if (xForwardedFor) {
      const firstIp = xForwardedFor.split(",")[0]?.trim();
      if (firstIp) return firstIp;
    }

    // X-Real-IP (common in reverse proxy setups)
    const xRealIp = headers["x-real-ip"];
    if (xRealIp) return xRealIp;

    // Cloudflare specific
    const cfConnectingIp = headers["cf-connecting-ip"];
    if (cfConnectingIp) return cfConnectingIp;

    // Direct connection IP
    return context.request.ip || "unknown";
  }
}

/**
 * Factory function to create UserStrategy with common configurations
 */
export const createUserStrategy = {
  /**
   * Standard user strategy with session fallback
   */
  standard: () =>
    new UserStrategy({
      useSessionForAnonymous: true,
      anonymousPrefix: "anon",
    }),

  /**
   * Strict user strategy - only authenticated users get individual limits
   * Anonymous users all share the same limit pool
   */
  strict: () =>
    new UserStrategy({
      useSessionForAnonymous: false,
      anonymousPrefix: "anonymous",
    }),

  /**
   * Session-aware strategy - tries to maintain consistency for anonymous users
   */
  sessionAware: () =>
    new UserStrategy({
      useSessionForAnonymous: true,
      anonymousPrefix: "guest",
    }),
};
