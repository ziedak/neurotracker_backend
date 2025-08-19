import { AuthGuard, type AuthContext } from "./guards";
import { type JWTPayload, JWTService } from "./jwt";
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  PermissionService,
  UserService,
  SessionManager,
  UserIdentity,
} from "./index";

/**
 * Enhanced authentication result for middleware layer
 */
export interface MiddlewareAuthResult {
  readonly success: boolean;
  readonly payload?: JWTPayload;
  readonly user?: {
    id: string;
    email?: string;
    roles: string[];
    permissions: string[];
    storeId?: string;
    metadata?: Record<string, unknown>;
  };
  readonly session?: {
    sessionId: string;
    expiresAt: Date;
    lastActivity: Date;
  };
  readonly error?: string;
  readonly errorCode?: string;
}

/**
 * Authorization requirements for middleware
 */
export interface AuthorizationRequirements {
  roles?: string[];
  permissions?: string[];
  allowAnonymous?: boolean;
  requireValidSession?: boolean;
}

/**
 * Enhanced AuthGuard for middleware integration
 * Bridges JWT-based authentication with optional service-based authorization
 */
export class MiddlewareAuthGuard extends AuthGuard {
  private readonly logger: Logger;
  private readonly metrics?: MetricsCollector;
  private readonly permissionService?: PermissionService;
  private readonly userService?: UserService;
  private readonly sessionManager?: SessionManager;

  constructor(
    logger: Logger,
    metrics?: MetricsCollector,
    services?: {
      permissionService?: PermissionService;
      userService?: UserService;
      sessionManager?: SessionManager;
    }
  ) {
    super();
    this.logger = logger;
    this.metrics = metrics;
    this.permissionService = services?.permissionService;
    this.userService = services?.userService;
    this.sessionManager = services?.sessionManager;
  }

  /**
   * Comprehensive authentication that works with or without services
   */
  async authenticate(context: AuthContext): Promise<MiddlewareAuthResult> {
    try {
      // First attempt JWT authentication
      const payload = await this.optionalAuth(context);

      if (!payload) {
        return {
          success: false,
          error: "Authentication required",
          errorCode: "AUTH_REQUIRED",
        };
      }

      await this.metrics?.recordCounter("auth_jwt_success");

      // Build base user info from JWT
      const baseUser = {
        id: payload.sub,
        email: payload.email,
        roles: [payload.role],
        permissions: payload.permissions || [],
        storeId: payload.storeId,
        metadata: {},
      };

      // Enhance with service data if available
      let enhancedUser = baseUser;
      if (this.userService) {
        try {
          const userInfo = await this.userService.getUserById(payload.sub);
          if (userInfo) {
            enhancedUser = {
              ...baseUser,
              email: userInfo.email || baseUser.email,
              metadata: userInfo.metadata || {},
            };
          }
        } catch (error) {
          this.logger.warn("Failed to fetch user info from service", {
            userId: payload.sub,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Enhance permissions with service data if available
      if (this.permissionService) {
        try {
          const servicePermissions =
            await this.permissionService.getUserPermissions(payload.sub);
          const allPermissions = Array.from(
            new Set([
              ...enhancedUser.permissions,
              ...servicePermissions.map((p) => `${p.resource}:${p.action}`),
            ])
          );
          enhancedUser.permissions = allPermissions;
        } catch (error) {
          this.logger.warn("Failed to fetch permissions from service", {
            userId: payload.sub,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      // Handle session if session manager available
      let sessionInfo;
      if (this.sessionManager) {
        try {
          // Try to find active session for user
          // Note: This is a basic implementation - in practice you'd want
          // to include session ID in JWT or use a different approach
          this.logger.debug(
            "Session validation skipped - no sessionId in JWT",
            { userId: payload.sub }
          );
        } catch (error) {
          this.logger.warn("Session validation failed", {
            userId: payload.sub,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      return {
        success: true,
        payload,
        user: enhancedUser,
        session: sessionInfo,
      };
    } catch (error) {
      await this.metrics?.recordCounter("auth_error");
      this.logger.warn("Authentication failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
        errorCode: "AUTH_FAILED",
      };
    }
  }

  /**
   * Check authorization against requirements
   */
  async authorize(
    authResult: MiddlewareAuthResult,
    requirements: AuthorizationRequirements
  ): Promise<{ authorized: boolean; error?: string }> {
    try {
      // Handle anonymous access
      if (!authResult.success || !authResult.user) {
        return {
          authorized: requirements.allowAnonymous || false,
          error: requirements.allowAnonymous
            ? undefined
            : "Authentication required",
        };
      }

      const user = authResult.user;

      // Check role requirements
      if (requirements.roles?.length) {
        const hasRequiredRole = requirements.roles.some(
          (role) => user.roles.includes(role) || user.roles.includes("admin")
        );

        if (!hasRequiredRole) {
          await this.metrics?.recordCounter("auth_role_denied");
          return {
            authorized: false,
            error: `Required role not found. Need one of: ${requirements.roles.join(
              ", "
            )}`,
          };
        }
      }

      // Check permission requirements
      if (requirements.permissions?.length) {
        const hasRequiredPermission = requirements.permissions.some(
          (permission) =>
            user.permissions.includes(permission) ||
            user.roles.includes("admin")
        );

        if (!hasRequiredPermission) {
          await this.metrics?.recordCounter("auth_permission_denied");
          return {
            authorized: false,
            error: `Required permission not found. Need one of: ${requirements.permissions.join(
              ", "
            )}`,
          };
        }
      }

      // Check session requirements
      if (requirements.requireValidSession && !authResult.session) {
        await this.metrics?.recordCounter("auth_session_required");
        return {
          authorized: false,
          error: "Valid session required",
        };
      }

      await this.metrics?.recordCounter("auth_authorized");
      return { authorized: true };
    } catch (error) {
      this.logger.error("Authorization check failed", error as Error);
      return {
        authorized: false,
        error: "Authorization service error",
      };
    }
  }

  /**
   * One-step authentication and authorization
   */
  async authenticateAndAuthorize(
    context: AuthContext,
    requirements: AuthorizationRequirements
  ): Promise<MiddlewareAuthResult> {
    const authResult = await this.authenticate(context);

    if (!authResult.success) {
      return authResult;
    }

    const authzResult = await this.authorize(authResult, requirements);
    if (!authzResult.authorized) {
      return {
        success: false,
        error: authzResult.error || "Authorization failed",
        errorCode: "AUTHORIZATION_FAILED",
      };
    }

    return authResult;
  }
}
