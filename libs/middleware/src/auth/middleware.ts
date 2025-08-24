/**
 * Elysia Authentication Middleware
 *
 * Provides session-based and JWT-based authentication middleware
 * for Elysia applications with comprehensive security features.
 */

import { Elysia } from "@libs/elysia-server";
import { AuthService } from "./service";
import { AuthContext, AuthConfig, LoginCredentials } from "./types";
import { RedisClient } from "@libs/database";

/**
 * Authentication middleware configuration
 */
export interface AuthMiddlewareConfig extends Partial<AuthConfig> {
  readonly skipPaths?: string[];
  readonly requireAuth?: boolean;
  readonly cookieName?: string;
  readonly headerName?: string;
}

/**
 * Rate limiting store interface
 */
interface RateLimitStore {
  get(key: string): Promise<number | null>;
  increment(key: string, ttl: number): Promise<number>;
}

/**
 * Redis-based rate limiting store
 */
class RedisRateLimitStore implements RateLimitStore {
  private redis = RedisClient.getInstance();

  async get(key: string): Promise<number | null> {
    const value = await this.redis.get(key);
    return value ? parseInt(value, 10) : null;
  }

  async increment(key: string, ttl: number): Promise<number> {
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, ttl);
    const results = await pipeline.exec();
    if (!results || !results[0] || typeof results[0][1] !== "number") {
      throw new Error("Failed to increment rate limit in Redis");
    }
    return results[0][1] as number;
  }
}

/**
 * Enhanced Elysia Authentication Middleware
 */
export class ElysiaAuthMiddleware {
  private readonly authService: AuthService;
  private readonly config: AuthMiddlewareConfig;
  private readonly rateLimitStore: RateLimitStore;

  constructor(config: AuthMiddlewareConfig = {}) {
    this.config = {
      skipPaths: ["/health", "/metrics"],
      requireAuth: true,
      cookieName: "session",
      headerName: "authorization",
      ...config,
    };

    this.authService = new AuthService(config);
    this.rateLimitStore = new RedisRateLimitStore();
  }

  /**
   * Create authentication plugin for Elysia
   */
  public plugin() {
    return new Elysia({ name: "auth" })
      .decorate("auth", {
        service: this.authService,
        login: this.login.bind(this),
        logout: this.logout.bind(this),
        requireAuth: this.requireAuth.bind(this),
        optionalAuth: this.optionalAuth.bind(this),
      })
      .derive(async ({ headers, cookie, path, request }) => {
        // Skip authentication for specified paths
        if (this.config.skipPaths?.includes(path)) {
          return {
            auth: {
              user: null,
              session: null,
              isAuthenticated: false,
            } as AuthContext,
          };
        }

        // Rate limiting check
        const clientIP = this.getClientIP(request);
        if (await this.isRateLimited(clientIP)) {
          throw new Error("Rate limit exceeded");
        }

        // Try to authenticate from cookie or header
        const authContext = await this.extractAuthContext(
          headers,
          cookie,
          clientIP
        );

        return {
          auth: authContext,
          authService: this.authService,
        };
      })
      .onBeforeHandle(async ({ auth, path }) => {
        // Skip if path is in skip list
        if (this.config.skipPaths?.includes(path)) {
          return;
        }

        // Check if authentication is required
        if (this.config.requireAuth && !auth.isAuthenticated) {
          throw new Error("Authentication required");
        }
      });
  }

  /**
   * Login handler
   */
  public async login(
    credentials: LoginCredentials,
    clientIP?: string,
    userAgent?: string
  ): Promise<{
    user: any;
    sessionToken: string;
    jwtToken: string;
  }> {
    // Rate limiting for login attempts
    const loginKey = `login:${clientIP || "unknown"}`;
    if (await this.isRateLimited(loginKey, "login")) {
      throw new Error("Too many login attempts");
    }

    // Verify user credentials (this would integrate with your user service)
    const user = await this.verifyCredentials(credentials);
    if (!user) {
      await this.rateLimitStore.increment(
        loginKey,
        this.config.rateLimiting!.windowMinutes! * 60
      );
      throw new Error("Invalid credentials");
    }

    // Create session
    const { sessionToken, jwtToken } = await this.authService.createSession({
      userId: user.id,
      ipAddress: clientIP,
      userAgent,
      expiresInHours: credentials.rememberMe ? 24 * 30 : 24, // 30 days vs 1 day
    });

    return {
      user: this.authService.toAuthUser(user),
      sessionToken,
      jwtToken,
    };
  }

  /**
   * Logout handler
   */
  public async logout(
    sessionId?: string,
    sessionToken?: string
  ): Promise<void> {
    if (sessionId) {
      await this.authService.invalidateSession(sessionId);
    } else if (sessionToken) {
      const validation = await this.authService.validateSession(sessionToken);
      if (validation.session) {
        await this.authService.invalidateSession(validation.session.id);
      }
    }
  }

  /**
   * Require authentication guard
   */
  public requireAuth() {
    return new Elysia().guard({
      beforeHandle: ({ auth }: { auth: AuthContext }) => {
        if (!auth.isAuthenticated) {
          throw new Error("Authentication required");
        }
      },
    });
  }

  /**
   * Optional authentication (allows unauthenticated requests)
   */
  public optionalAuth() {
    return new Elysia().guard({
      beforeHandle: () => {
        // No authentication requirement
      },
    });
  }

  // === Private Helper Methods ===

  /**
   * Extract authentication context from request
   */
  private async extractAuthContext(
    headers: Record<string, string | undefined>,
    cookie: Record<string, any>,
    clientIP?: string
  ): Promise<AuthContext> {
    let sessionToken: string | undefined;
    let isJWT = false;

    // Try to get token from cookie first
    sessionToken = cookie[this.config.cookieName!]?.value;

    // If no cookie, try Authorization header
    if (!sessionToken && headers[this.config.headerName!]) {
      const authHeader = headers[this.config.headerName!];
      if (authHeader?.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
        isJWT = true;
      }
    }

    if (!sessionToken) {
      return {
        user: null,
        session: null,
        isAuthenticated: false,
      };
    }

    // Validate token
    const validation = isJWT
      ? await this.authService.validateJWT(sessionToken)
      : await this.authService.validateSession(sessionToken, clientIP);

    if (!validation.isValid || !validation.user) {
      return {
        user: null,
        session: null,
        isAuthenticated: false,
      };
    }

    return {
      user: this.authService.toAuthUser(validation.user),
      session: validation.session,
      isAuthenticated: true,
      token: sessionToken,
    };
  }

  /**
   * Get client IP address from request
   */
  private getClientIP(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for");
    const realIP = request.headers.get("x-real-ip");
    const connectingIP = request.headers.get("cf-connecting-ip");

    return forwarded?.split(",")[0] || realIP || connectingIP || "unknown";
  }

  /**
   * Check if request is rate limited
   */
  private async isRateLimited(
    identifier: string,
    type: "general" | "login" = "general"
  ): Promise<boolean> {
    const config = this.config.rateLimiting!;
    const key = `rate_limit:${type}:${identifier}`;

    const current = await this.rateLimitStore.get(key);
    const limit =
      type === "login" ? config.maxAttempts : config.maxAttempts * 2;

    if (current && current >= limit) {
      return true;
    }

    // Increment counter
    await this.rateLimitStore.increment(key, config.windowMinutes * 60);
    return false;
  }

  /**
   * Verify user credentials (placeholder - integrate with your user service)
   */
  private async verifyCredentials(_: LoginCredentials): Promise<any | null> {
    // This should integrate with your actual user verification logic
    // For now, this is a placeholder that you'll need to implement

    // Example integration:
    // const userService = new UserService();
    // return await userService.authenticate(credentials.email, credentials.password);

    console.warn(
      "verifyCredentials not implemented - integrate with your user service"
    );
    return null;
  }

  /**
   * Cleanup and destroy the middleware
   */
  public destroy(): void {
    this.authService.destroy();
  }
}

/**
 * Create auth middleware plugin for Elysia
 */
export function createAuthPlugin(config: AuthMiddlewareConfig = {}) {
  const middleware = new ElysiaAuthMiddleware(config);
  return middleware.plugin();
}

/**
 * Authentication guard helpers
 */
export const authGuards = {
  /**
   * Require authentication
   */
  required: new Elysia().guard({
    beforeHandle: ({ auth }: { auth: AuthContext }) => {
      if (!auth.isAuthenticated) {
        throw new Error("Authentication required");
      }
    },
  }),

  /**
   * Require specific role
   */
  role: (requiredRole: string) =>
    new Elysia().guard({
      beforeHandle: ({ auth }: { auth: AuthContext }) => {
        if (!auth.isAuthenticated) {
          throw new Error("Authentication required");
        }
        if (!auth.user?.role || auth.user.role.name !== requiredRole) {
          throw new Error("Insufficient permissions");
        }
      },
    }),

  /**
   * Require any of the specified roles
   */
  anyRole: (requiredRoles: string[]) =>
    new Elysia().guard({
      beforeHandle: ({ auth }: { auth: AuthContext }) => {
        if (!auth.isAuthenticated) {
          throw new Error("Authentication required");
        }
        if (!auth.user?.role || !requiredRoles.includes(auth.user.role.name)) {
          throw new Error("Insufficient permissions");
        }
      },
    }),

  /**
   * Optional authentication (allows unauthenticated)
   */
  optional: new Elysia().guard({
    beforeHandle: () => {
      // No requirements
    },
  }),
};
