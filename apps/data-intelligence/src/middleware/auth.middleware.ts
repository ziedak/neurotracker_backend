import { SecurityService } from "../services/security.service";
import { Logger } from "@libs/monitoring";

export interface AuthMiddlewareOptions {
  requiredRoles?: string[];
  requiredPermissions?: string[];
  allowAnonymous?: boolean;
}

/**
 * Authentication middleware for data intelligence service
 */
export class AuthMiddleware {
  private readonly securityService: SecurityService;
  private readonly logger: Logger;

  constructor(securityService: SecurityService, logger: Logger) {
    this.securityService = securityService;
    this.logger = logger;
  }

  /**
   * Create authentication middleware function
   */
  authenticate(options: AuthMiddlewareOptions = {}) {
    return async (context: any, next: () => Promise<void>) => {
      const { request, set } = context;

      try {
        // Extract authentication credentials
        const authHeader = request.headers.authorization;
        const apiKey = request.headers["x-api-key"];

        // Allow anonymous access if configured
        if (options.allowAnonymous && !authHeader && !apiKey) {
          context.user = { anonymous: true };
          return await next();
        }

        // Extract token from Authorization header
        let token: string | undefined;
        if (authHeader?.startsWith("Bearer ")) {
          token = authHeader.substring(7);
        }

        // Authenticate the request
        const authResult = await this.securityService.authenticate({
          token,
          apiKey,
          endpoint: request.url,
          method: request.method,
        });

        if (!authResult.authenticated) {
          set.status = 401;
          return {
            error: "Authentication failed",
            message: authResult.error,
            code: "AUTH_FAILED",
          };
        }

        // Check role requirements
        if (options.requiredRoles && options.requiredRoles.length > 0) {
          const userRoles = authResult.roles || [];
          const hasRequiredRole = options.requiredRoles.some(
            (role) => userRoles.includes(role) || userRoles.includes("admin")
          );

          if (!hasRequiredRole) {
            set.status = 403;
            return {
              error: "Insufficient permissions",
              message: `Required roles: ${options.requiredRoles.join(", ")}`,
              code: "INSUFFICIENT_ROLES",
            };
          }
        }

        // Check permission requirements
        if (
          options.requiredPermissions &&
          options.requiredPermissions.length > 0
        ) {
          const userPermissions = authResult.permissions || [];
          const hasRequiredPermission = options.requiredPermissions.some(
            (permission) =>
              userPermissions.includes(permission) ||
              userPermissions.includes("*")
          );

          if (!hasRequiredPermission) {
            set.status = 403;
            return {
              error: "Insufficient permissions",
              message: `Required permissions: ${options.requiredPermissions.join(
                ", "
              )}`,
              code: "INSUFFICIENT_PERMISSIONS",
            };
          }
        }

        // Attach user info to context
        context.user = {
          id: authResult.userId,
          roles: authResult.roles,
          permissions: authResult.permissions,
          rateLimitRemaining: authResult.rateLimitRemaining,
        };

        // Add rate limit headers
        if (authResult.rateLimitRemaining !== undefined) {
          set.headers["X-RateLimit-Remaining"] =
            authResult.rateLimitRemaining.toString();
        }

        await next();
      } catch (error) {
        this.logger.error("Authentication middleware error", error as Error, {
          url: request.url,
          method: request.method,
        });

        set.status = 500;
        return {
          error: "Internal server error",
          message: "Authentication service unavailable",
          code: "AUTH_SERVICE_ERROR",
        };
      }
    };
  }

  /**
   * Create role-based access middleware
   */
  requireRole(...roles: string[]) {
    return this.authenticate({ requiredRoles: roles });
  }

  /**
   * Create permission-based access middleware
   */
  requirePermission(...permissions: string[]) {
    return this.authenticate({ requiredPermissions: permissions });
  }

  /**
   * Admin-only access middleware
   */
  requireAdmin() {
    return this.authenticate({ requiredRoles: ["admin"] });
  }

  /**
   * Allow both authenticated and anonymous access
   */
  optionalAuth() {
    return this.authenticate({ allowAnonymous: true });
  }
}
