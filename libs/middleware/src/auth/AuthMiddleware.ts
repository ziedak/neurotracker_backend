import { BaseMiddleware } from "../base";
import { MiddlewareContext, AuthConfig } from "../types";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { ApiKeyAuth } from "./ApiKeyAuth";
import { JwtAuth } from "./JwtAuth";
import { RoleBasedAuth } from "./RoleBasedAuth";

/**
 * Authentication result interface
 */
export interface AuthResult {
  authenticated: boolean;
  user?: {
    id?: string;
    roles?: string[];
    permissions?: string[];
    anonymous?: boolean;
    [key: string]: any;
  };
  error?: string;
  rateLimitRemaining?: number;
}

/**
 * Main authentication middleware
 * Supports API key, JWT token, and anonymous authentication
 */
export class AuthMiddleware extends BaseMiddleware<AuthConfig> {
  private readonly apiKeyAuth: ApiKeyAuth;
  private readonly jwtAuth: JwtAuth;
  private readonly roleAuth: RoleBasedAuth;

  constructor(config: AuthConfig, logger: Logger, metrics?: MetricsCollector) {
    super("auth", config, logger, metrics);

    this.apiKeyAuth = new ApiKeyAuth(config, logger);
    this.jwtAuth = new JwtAuth(config, logger);
    this.roleAuth = new RoleBasedAuth(config, logger);
  }

  async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void | any> {
    const startTime = performance.now();
    const requestId = this.getRequestId(context);

    try {
      // Check if this route should bypass authentication
      if (this.shouldBypassAuth(context)) {
        this.logger.debug("Bypassing authentication for route", {
          path: context.request.url,
          requestId,
        });
        await this.recordTimer(
          "auth_bypass_duration",
          performance.now() - startTime
        );
        return next();
      }

      // Attempt authentication
      const authResult = await this.authenticate(context);

      if (!authResult.authenticated) {
        context.set.status = 401;
        await this.recordMetric("auth_failed");

        this.logger.warn("Authentication failed", {
          path: context.request.url,
          error: authResult.error,
          requestId,
          clientIp: this.getClientIp(context),
        });

        return {
          error: "Authentication failed",
          message: authResult.error || "Invalid credentials",
          code: "AUTH_FAILED",
          requestId,
        };
      }

      // Check authorization (roles and permissions)
      const authzResult = await this.authorize(authResult, context);
      if (!authzResult.authorized) {
        context.set.status = 403;
        await this.recordMetric("auth_forbidden");

        this.logger.warn("Authorization failed", {
          path: context.request.url,
          userId: authResult.user?.id,
          requiredRoles: this.config.requiredRoles,
          requiredPermissions: this.config.requiredPermissions,
          userRoles: authResult.user?.roles,
          userPermissions: authResult.user?.permissions,
          requestId,
        });

        return {
          error: "Insufficient permissions",
          message: authzResult.error || "Access denied",
          code: "INSUFFICIENT_PERMISSIONS",
          requestId,
        };
      }

      // Attach user info to context
      context.user = authResult.user;

      // Add rate limit info if available
      if (authResult.rateLimitRemaining !== undefined) {
        context.set.headers["X-RateLimit-Remaining"] =
          authResult.rateLimitRemaining.toString();
      }

      await this.recordMetric("auth_success");
      this.logger.debug("Authentication successful", {
        path: context.request.url,
        userId: authResult.user?.id,
        roles: authResult.user?.roles?.length || 0,
        permissions: authResult.user?.permissions?.length || 0,
        requestId,
      });

      await next();
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.recordTimer("auth_error_duration", duration);

      this.logger.error("Authentication middleware error", error as Error, {
        path: context.request.url,
        requestId,
        duration: Math.round(duration),
      });

      context.set.status = 500;
      return {
        error: "Authentication service error",
        message: "Internal authentication error",
        code: "AUTH_SERVICE_ERROR",
        requestId,
      };
    } finally {
      await this.recordTimer("auth_duration", performance.now() - startTime);
    }
  }

  /**
   * Check if authentication should be bypassed for this route
   */
  private shouldBypassAuth(context: MiddlewareContext): boolean {
    const path = context.request.url.split("?")[0];

    return (
      this.config.bypassRoutes?.some((route) => {
        if (route.endsWith("*")) {
          return path.startsWith(route.slice(0, -1));
        }
        return path === route || path.startsWith(route + "/");
      }) || false
    );
  }

  /**
   * Authenticate the request using available methods
   */
  private async authenticate(context: MiddlewareContext): Promise<AuthResult> {
    const authHeader = context.request.headers.authorization;
    const apiKey = context.request.headers["x-api-key"];

    // Allow anonymous access if configured and no credentials provided
    if (this.config.allowAnonymous && !authHeader && !apiKey) {
      return {
        authenticated: true,
        user: {
          anonymous: true,
          roles: [],
          permissions: [],
        },
      };
    }

    // Try API key authentication first
    if (apiKey) {
      return this.apiKeyAuth.authenticate(apiKey, context);
    }

    // Try JWT authentication
    if (authHeader) {
      return this.jwtAuth.authenticate(authHeader, context);
    }

    return {
      authenticated: false,
      error: "No authentication credentials provided",
    };
  }

  /**
   * Check authorization (roles and permissions)
   */
  private async authorize(
    authResult: AuthResult,
    context: MiddlewareContext
  ): Promise<{ authorized: boolean; error?: string }> {
    if (!authResult.user || authResult.user.anonymous) {
      return {
        authorized: this.config.allowAnonymous || false,
        error: this.config.allowAnonymous
          ? undefined
          : "Anonymous access not allowed",
      };
    }

    return this.roleAuth.checkAuthorization(authResult.user, context);
  }

  /**
   * Create Elysia plugin for this middleware
   */
  public elysia(config?: Partial<AuthConfig>) {
    const finalConfig = config ? { ...this.config, ...config } : this.config;
    const middleware = new AuthMiddleware(
      finalConfig,
      this.logger,
      this.metrics
    );

    return (app: any) => {
      return app.onBeforeHandle(middleware.middleware());
    };
  }

  /**
   * Factory method for common auth configurations
   */
  public static create(
    type: "api-gateway" | "ai-engine" | "data-intelligence" | "event-pipeline",
    overrides?: Partial<AuthConfig>
  ): AuthMiddleware {
    const configs = {
      "api-gateway": {
        allowAnonymous: true,
        bypassRoutes: ["/health", "/metrics", "/docs", "/swagger"],
        skipPaths: ["/health", "/metrics"],
      },
      "ai-engine": {
        requiredPermissions: ["predict"],
        apiKeys: new Set(["ai-engine-key-prod-2024", "ai-engine-key-dev-2024"]),
        bypassRoutes: ["/health", "/metrics"],
      },
      "data-intelligence": {
        requiredRoles: ["user", "admin"],
        bypassRoutes: ["/health", "/metrics"],
        strictMode: true,
      },
      "event-pipeline": {
        requiredPermissions: ["event_ingest"],
        bypassRoutes: ["/health", "/metrics"],
        allowAnonymous: false,
      },
    };

    const config = { ...configs[type], ...overrides };
    const logger = Logger.getInstance("authMiddleware");
    const metrics = MetricsCollector.getInstance();

    return new AuthMiddleware(config, logger, metrics);
  }
}
