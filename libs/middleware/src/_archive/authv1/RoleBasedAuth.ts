import { Logger } from "@libs/monitoring";
import { AuthConfig, MiddlewareContext } from "../../types";

/**
 * User information for authorization
 */
interface User {
  id?: string;
  roles?: string[];
  permissions?: string[];
  [key: string]: any;
}

/**
 * Authorization result
 */
interface AuthorizationResult {
  authorized: boolean;
  error?: string;
  matchedRoles?: string[];
  matchedPermissions?: string[];
}

/**
 * Role-based authorization implementation
 */
export class RoleBasedAuth {
  private readonly config: AuthConfig;
  private readonly logger: ILogger;

  // Route-specific permission requirements
  private readonly routePermissions: Map<string, string[]> = new Map([
    // AI Engine routes
    ["POST /predict", ["predict"]],
    ["POST /batch-predict", ["batch_predict"]],
    ["GET /explain", ["explain"]],
    ["GET /models", ["admin", "models"]],
    ["POST /models", ["admin"]],
    ["DELETE /cache", ["admin", "cache_manage"]],

    // Data Intelligence routes
    ["GET /analytics", ["analytics", "admin"]],
    ["POST /exports", ["data_export", "admin"]],
    ["GET /features", ["features", "admin"]],
    ["POST /gdpr", ["gdpr", "admin"]],
    ["DELETE /gdpr/*", ["gdpr", "admin"]],

    // Event Pipeline routes
    ["POST /events", ["event_ingest"]],
    ["POST /events/batch", ["event_ingest", "batch_process"]],
    ["GET /deadletter", ["admin", "event_admin"]],

    // Common routes
    ["GET /metrics", ["metrics", "admin"]],
    ["GET /health", []], // Public
  ]);

  // Role hierarchy (higher roles inherit lower role permissions)
  private readonly roleHierarchy: Map<string, string[]> = new Map([
    ["admin", ["user", "service", "data_processor", "event_processor"]],
    ["service", ["user"]],
    ["data_processor", ["user"]],
    ["event_processor", ["user"]],
    ["user", []],
  ]);

  // Default permissions for roles
  private readonly rolePermissions: Map<string, string[]> = new Map([
    ["admin", ["*"]], // Admin has all permissions
    ["service", ["predict", "event_ingest", "metrics"]],
    ["data_processor", ["analytics", "features", "data_export"]],
    ["event_processor", ["event_ingest", "batch_process"]],
    ["user", ["predict", "analytics"]],
  ]);

  constructor(config: AuthConfig, logger: ILogger) {
    this.config = config;
    this.logger = createLogger( "RoleBasedAuth" });
  }

  /**
   * Check if user is authorized to access resource
   */
  async checkAuthorization(
    user: User,
    context: MiddlewareContext
  ): Promise<AuthorizationResult> {
    try {
      const userRoles = user.roles || [];
      const userPermissions = user.permissions || [];

      // Get all effective roles (including inherited)
      const effectiveRoles = this.getEffectiveRoles(userRoles);

      // Get all effective permissions (from roles + direct permissions)
      const effectivePermissions = this.getEffectivePermissions(
        effectiveRoles,
        userPermissions
      );

      // Check global role requirements
      if (this.config.requiredRoles?.length) {
        const hasRequiredRole = this.config.requiredRoles.some(
          (role) =>
            effectiveRoles.includes(role) || effectiveRoles.includes("admin")
        );

        if (!hasRequiredRole) {
          return {
            authorized: false,
            error: `Required roles: ${this.config.requiredRoles.join(", ")}`,
          };
        }
      }

      // Check global permission requirements
      if (this.config.requiredPermissions?.length) {
        const hasRequiredPermission = this.config.requiredPermissions.some(
          (permission) =>
            effectivePermissions.includes(permission) ||
            effectivePermissions.includes("*")
        );

        if (!hasRequiredPermission) {
          return {
            authorized: false,
            error: `Required permissions: ${this.config.requiredPermissions.join(
              ", "
            )}`,
          };
        }
      }

      // Check route-specific permissions
      const routePermissions = this.getRoutePermissions(context);
      if (routePermissions.length > 0) {
        const hasRoutePermission = routePermissions.some(
          (permission) =>
            effectivePermissions.includes(permission) ||
            effectivePermissions.includes("*")
        );

        if (!hasRoutePermission) {
          return {
            authorized: false,
            error: `Route requires permissions: ${routePermissions.join(", ")}`,
          };
        }
      }

      this.logger.debug("Authorization successful", {
        userId: user.id,
        userRoles,
        effectiveRoles,
        userPermissions,
        effectivePermissions,
        routePermissions,
        path: context.request.url,
      });

      return {
        authorized: true,
        matchedRoles: effectiveRoles,
        matchedPermissions: effectivePermissions,
      };
    } catch (error) {
      this.logger.error("Authorization check error", error as Error, {
        userId: user.id,
        path: context.request.url,
      });

      return {
        authorized: false,
        error: "Authorization check failed",
      };
    }
  }

  /**
   * Get effective roles including inherited roles
   */
  private getEffectiveRoles(userRoles: string[]): string[] {
    const effectiveRoles = new Set<string>(userRoles);

    // Add inherited roles
    for (const role of userRoles) {
      const inheritedRoles = this.roleHierarchy.get(role) || [];
      inheritedRoles.forEach((inherited) => effectiveRoles.add(inherited));
    }

    return Array.from(effectiveRoles);
  }

  /**
   * Get effective permissions from roles and direct permissions
   */
  private getEffectivePermissions(
    roles: string[],
    directPermissions: string[]
  ): string[] {
    const permissions = new Set<string>(directPermissions);

    // Add permissions from roles
    for (const role of roles) {
      const rolePerms = this.rolePermissions.get(role) || [];
      rolePerms.forEach((perm) => permissions.add(perm));
    }

    return Array.from(permissions);
  }

  /**
   * Get required permissions for current route
   */
  private getRoutePermissions(context: MiddlewareContext): string[] {
    const method = context.request.method.toUpperCase();
    const path = this.normalizePath(context.request.url);
    const routeKey = `${method} ${path}`;

    // Try exact match first
    let permissions = this.routePermissions.get(routeKey);

    if (!permissions) {
      // Try wildcard matches
      for (const [route, perms] of this.routePermissions.entries()) {
        if (route.includes("*")) {
          const pattern = route.replace("*", ".*");
          const regex = new RegExp(`^${pattern}$`);
          if (regex.test(routeKey)) {
            permissions = perms;
            break;
          }
        }
      }
    }

    return permissions || [];
  }

  /**
   * Normalize path for route matching
   */
  private normalizePath(url: string | undefined): string {
    // Remove query parameters
    const path = ((url ?? "") as string).split("?")[0] || "";

    // Remove trailing slash
    return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  }

  /**
   * Check if user has specific permission
   */
  public hasPermission(user: User, permission: string): boolean {
    const userRoles = user.roles || [];
    const userPermissions = user.permissions || [];

    const effectiveRoles = this.getEffectiveRoles(userRoles);
    const effectivePermissions = this.getEffectivePermissions(
      effectiveRoles,
      userPermissions
    );

    return (
      effectivePermissions.includes(permission) ||
      effectivePermissions.includes("*")
    );
  }

  /**
   * Check if user has any of the specified roles
   */
  public hasRole(user: User, roles: string | string[]): boolean {
    const userRoles = user.roles || [];
    const effectiveRoles = this.getEffectiveRoles(userRoles);
    const requiredRoles = Array.isArray(roles) ? roles : [roles];

    return requiredRoles.some(
      (role) =>
        effectiveRoles.includes(role) || effectiveRoles.includes("admin")
    );
  }

  /**
   * Check if user is admin
   */
  public isAdmin(user: User): boolean {
    return this.hasRole(user, "admin");
  }

  /**
   * Add route permission requirement
   */
  public addRoutePermission(
    method: string,
    path: string,
    permissions: string[]
  ): void {
    const routeKey = `${method.toUpperCase()} ${path}`;
    this.routePermissions.set(routeKey, permissions);

    this.logger.debug("Route permission added", {
      route: routeKey,
      permissions,
    });
  }

  /**
   * Remove route permission requirement
   */
  public removeRoutePermission(method: string, path: string): void {
    const routeKey = `${method.toUpperCase()} ${path}`;
    this.routePermissions.delete(routeKey);

    this.logger.debug("Route permission removed", {
      route: routeKey,
    });
  }

  /**
   * Add role to hierarchy
   */
  public addRole(
    role: string,
    inherits: string[] = [],
    permissions: string[] = []
  ): void {
    this.roleHierarchy.set(role, inherits);
    this.rolePermissions.set(role, permissions);

    this.logger.info("Role added", {
      role,
      inherits,
      permissions: permissions.length,
    });
  }

  /**
   * Get all route permissions
   */
  public getRoutePermissionsMap(): Record<string, string[]> {
    return Object.fromEntries(this.routePermissions);
  }

  /**
   * Get role hierarchy
   */
  public getRoleHierarchy(): Record<string, string[]> {
    return Object.fromEntries(this.roleHierarchy);
  }

  /**
   * Get role permissions
   */
  public getRolePermissionsMap(): Record<string, string[]> {
    return Object.fromEntries(this.rolePermissions);
  }
}
