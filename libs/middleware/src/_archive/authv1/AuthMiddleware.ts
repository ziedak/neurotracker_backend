import { BaseMiddleware } from "../../base";
import { MiddlewareContext, AuthConfig } from "../../types";
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  MiddlewareAuthGuard,
  MiddlewareAuthResult,
  AuthorizationRequirements,
  PermissionService,
  UserService,
  SessionManager,
  AuthenticationService,
} from "@libs/auth";

/**
 * Production-ready AuthMiddleware using enhanced MiddlewareAuthGuard
 * No stub implementations - uses proper dependency injection pattern
 */
export class AuthMiddleware extends BaseMiddleware<AuthConfig> {
  private readonly middlewareAuthGuard: MiddlewareAuthGuard;

  constructor(
    config: AuthConfig,
    logger: ILogger,
    metrics?: MetricsCollector,
    services?: {
      permissionService?: PermissionService;
      userService?: UserService;
      sessionManager?: SessionManager;
      authService?: AuthenticationService;
    }
  ) {
    super("auth", config, logger, metrics);

    // Create MiddlewareAuthGuard with optional service injection
    this.middlewareAuthGuard = new MiddlewareAuthGuard(
      logger,
      metrics,
      services
    );
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

      // Build authorization requirements from config
      const requirements: AuthorizationRequirements = {
        roles: this.config.requiredRoles,
        permissions: this.config.requiredPermissions,
        allowAnonymous: this.config.allowAnonymous,
      };

      // Authenticate and authorize using MiddlewareAuthGuard
      const authResult =
        await this.middlewareAuthGuard.authenticateAndAuthorize(
          this.convertToAuthContext(context),
          requirements
        );

      if (!authResult.success) {
        const statusCode = this.getStatusCodeFromError(authResult.errorCode);
        context.set.status = statusCode;

        await this.recordMetric(
          statusCode === 401 ? "auth_failed" : "auth_forbidden"
        );

        this.logger.warn("Authentication/Authorization failed", {
          path: context.request.url,
          error: authResult.error,
          errorCode: authResult.errorCode,
          requestId,
          clientIp: this.getClientIp(context),
        });

        return {
          error:
            authResult.errorCode === "AUTH_REQUIRED"
              ? "Authentication required"
              : "Access denied",
          message: authResult.error || "Authentication/Authorization failed",
          code: authResult.errorCode || "AUTH_FAILED",
          requestId,
        };
      }

      // Attach user info to context
      context.user = authResult.user;
      context.session = authResult.session;

      // Add security headers
      if (authResult.session) {
        context.set.headers["X-Session-ID"] = authResult.session.sessionId;
        context.set.headers["X-Session-Expires"] =
          authResult.session.expiresAt.toISOString();
      }

      if (authResult.payload) {
        context.set.headers["X-User-ID"] = authResult.payload.sub;
        if (authResult.payload.role) {
          context.set.headers["X-User-Role"] = authResult.payload.role;
        }
      }

      await this.recordMetric("auth_success");
      this.logger.debug("Authentication successful", {
        path: context.request.url,
        userId: authResult.user?.id,
        email: authResult.user?.email,
        roles: authResult.user?.roles.length || 0,
        permissions: authResult.user?.permissions.length || 0,
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
   * Convert middleware context to auth context
   */
  private convertToAuthContext(context: MiddlewareContext) {
    // Ensure status is defined for AuthContext compatibility
    return {
      headers: context.request.headers,
      set: {
        status: context.set.status || 200,
        headers: context.set.headers,
      },
    };
  }

  /**
   * Map error codes to HTTP status codes
   */
  private getStatusCodeFromError(errorCode?: string): number {
    switch (errorCode) {
      case "AUTH_REQUIRED":
        return 401;
      case "AUTHORIZATION_FAILED":
        return 403;
      default:
        return 401;
    }
  }

  /**
   * Create Elysia plugin for this middleware
   */
  public elysia(config?: Partial<AuthConfig>) {
    const finalConfig = config ? { ...this.config, ...config } : this.config;
    const middleware = new AuthMiddleware(
      finalConfig,

      this.metrics
    );

    return (app: any) => {
      return app.onBeforeHandle(async (context: any) => {
        return middleware.execute(context, () => Promise.resolve());
      });
    };
  }

  /**
   * Factory method for common auth configurations
   */
  public static create(
    type: "api-gateway" | "ai-engine" | "data-intelligence" | "event-pipeline",
    services?: {
      permissionService?: PermissionService;
      userService?: UserService;
      sessionManager?: SessionManager;
      authService?: AuthenticationService;
    },
    overrides?: Partial<AuthConfig>
  ): AuthMiddleware {
    const configs = {
      "api-gateway": {
        allowAnonymous: true,
        bypassRoutes: ["/health", "/metrics", "/docs", "/swagger", "/auth/*"],
      } as AuthConfig,
      "ai-engine": {
        requiredPermissions: ["ai:predict", "api:access"],
        bypassRoutes: ["/health", "/metrics"],
        allowAnonymous: false,
      } as AuthConfig,
      "data-intelligence": {
        requiredRoles: ["user", "admin", "store_owner"],
        requiredPermissions: ["data:read"],
        bypassRoutes: ["/health", "/metrics"],
        allowAnonymous: false,
      } as AuthConfig,
      "event-pipeline": {
        requiredPermissions: ["events:ingest", "api:access"],
        bypassRoutes: ["/health", "/metrics"],
        allowAnonymous: false,
      } as AuthConfig,
    };

    const config = { ...configs[type], ...overrides };
    const logger = Logger.getInstance("authMiddleware");
    const metrics = MetricsCollector.getInstance();

    return new AuthMiddleware(config, logger, metrics, services);
  }

  /**
   * Create middleware with full service integration
   */
  public static createWithServices(
    config: AuthConfig,
    services: {
      permissionService: PermissionService;
      userService: UserService;
      sessionManager: SessionManager;
      authService: AuthenticationService;
    }
  ): AuthMiddleware {
    const logger = Logger.getInstance("authMiddleware");
    const metrics = MetricsCollector.getInstance();

    return new AuthMiddleware(config, logger, metrics, services);
  }
}
