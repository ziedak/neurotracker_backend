/**
 * ElysiaJS Authentication Middleware
 * Provides HTTP authentication middleware for ElysiaJS applications
 * Integrates with the authentication service for seamless request protection
 */

import { Elysia } from "elysia";
import {
  AuthContext,
  AuthMiddlewareOptions,
  ForbiddenError,
  UnauthorizedError,
  ServiceDependencies,
  User,
} from "../types";
import { AuthenticationService } from "../services/auth-service";

// ===================================================================
// MIDDLEWARE CLASS
// ===================================================================

export class AuthMiddleware {
  constructor(
    private authService: AuthenticationService,
    private deps: ServiceDependencies
  ) {}

  /**
   * Create authentication middleware for ElysiaJS
   */
  create(options: AuthMiddlewareOptions = {}) {
    return new Elysia()
      .derive(async ({ headers }: any) => {
        const authHeader = headers.get("authorization");
        const token = this.authService
          .getJWTService()
          .extractTokenFromHeader(authHeader || "");

        let user: User | null = null;
        let authContext: AuthContext | null = null;

        if (token) {
          try {
            user = await this.authService.verifyToken(token);
            if (user) {
              authContext = this.authService
                .getPermissionService()
                .createAuthContext(user);
            }
          } catch (error) {
            this.deps.monitoring.logger.warn("Token verification failed", {
              error,
            });
          }
        }

        return {
          user,
          authContext,
          isAuthenticated: !!user,
        };
      })
      .guard(options, ({ user, authContext, path }: any) => {
        // Check if authentication is required
        if (options.requireAuth && !user) {
          throw new UnauthorizedError("Authentication required");
        }

        // Check role requirements
        if (options.roles && options.roles.length > 0) {
          if (!user) {
            throw new UnauthorizedError("Authentication required");
          }

          const hasRequiredRole = options.roles.some((role: string) =>
            user.roles.includes(role)
          );
          if (!hasRequiredRole) {
            throw new ForbiddenError("Insufficient permissions");
          }
        }

        // Check permission requirements
        if (options.permissions && options.permissions.length > 0) {
          if (!user || !authContext) {
            throw new UnauthorizedError("Authentication required");
          }

          const hasRequiredPermission = options.permissions.some(
            (permission: string) => user.permissions.includes(permission)
          );

          if (!hasRequiredPermission) {
            throw new ForbiddenError("Insufficient permissions");
          }
        }

        // Check CASL ability requirements
        if (options.resource && options.action) {
          if (!user || !authContext) {
            throw new UnauthorizedError("Authentication required");
          }

          const canPerform = this.authService.can(
            user,
            options.action,
            options.resource
          );

          if (!canPerform) {
            throw new ForbiddenError("Insufficient permissions");
          }
        }

        // Log successful authorization
        if (user) {
          this.deps.monitoring.logger.debug("Request authorized", {
            userId: user.id,
            path,
            roles: user.roles,
            permissions: user.permissions,
          });
        }

        // Return the app instance for Elysia
        return new Elysia();
      });
  }

  /**
   * Create middleware for optional authentication
   */
  optional() {
    return new Elysia().derive(async ({ headers }: any) => {
      const authHeader = headers.get("authorization");
      const token = this.authService
        .getJWTService()
        .extractTokenFromHeader(authHeader || "");

      let user: User | null = null;
      let authContext: AuthContext | null = null;

      if (token) {
        try {
          user = await this.authService.verifyToken(token);
          if (user) {
            authContext = this.authService
              .getPermissionService()
              .createAuthContext(user);
          }
        } catch (error) {
          // Silently fail for optional auth
          this.deps.monitoring.logger.debug(
            "Optional token verification failed",
            { error }
          );
        }
      }

      return {
        user,
        authContext,
        isAuthenticated: !!user,
      };
    });
  }

  /**
   * Create middleware for API key authentication
   */
  apiKey() {
    return new Elysia().derive(async ({ headers }: any) => {
      const apiKey = headers.get("x-api-key");

      if (!apiKey) {
        return {
          apiUser: null,
          apiAuthenticated: false,
        };
      }

      try {
        const validationResult = await this.authService
          .getApiKeyService()
          .validateApiKey(apiKey);

        if (!validationResult) {
          return {
            apiUser: null,
            apiAuthenticated: false,
          };
        }

        // Get user details for API key authentication
        const user = await this.authService.getUserById(
          validationResult.userId
        );
        let authContext: AuthContext | null = null;

        if (user) {
          authContext = this.authService
            .getPermissionService()
            .createAuthContext(user);
        }

        return {
          apiUser: user,
          apiAuthenticated: !!user,
          apiPermissions: validationResult.permissions,
          authContext,
        };
      } catch (error) {
        this.deps.monitoring.logger.warn("API key validation failed", {
          error,
        });
        return {
          apiUser: null,
          apiAuthenticated: false,
        };
      }
    });
  }

  /**
   * Create middleware for role-based access control
   */
  requireRole(roles: string[]) {
    return this.create({ requireAuth: true, roles });
  }

  /**
   * Create middleware for permission-based access control
   */
  requirePermission(permissions: string[]) {
    return this.create({ requireAuth: true, permissions });
  }

  /**
   * Create middleware for CASL ability-based access control
   */
  requireAbility(action: string, resource: string) {
    return this.create({
      requireAuth: true,
      action: action as any,
      resource: resource as any,
    });
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create auth middleware instance
 */
export function createAuthMiddleware(
  authService: AuthenticationService,
  deps: ServiceDependencies
): AuthMiddleware {
  return new AuthMiddleware(authService, deps);
}

/**
 * Helper function to create protected routes
 */
export function protect(options: AuthMiddlewareOptions) {
  return (app: Elysia) => {
    return app.guard(options, () => {
      // This would be used with the middleware instance
      // Implementation depends on the specific use case
      return new Elysia();
    });
  };
}

/**
 * Helper function for role-based protection
 */
export function requireRole(roles: string[]) {
  return protect({ requireAuth: true, roles });
}

/**
 * Helper function for permission-based protection
 */
export function requirePermission(permissions: string[]) {
  return protect({ requireAuth: true, permissions });
}

/**
 * Helper function for ability-based protection
 */
export function requireAbility(action: string, resource: string) {
  return protect({
    requireAuth: true,
    action: action as any,
    resource: resource as any,
  });
}
