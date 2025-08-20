/**
 * Production-ready PermissionService for Authentication Library
 * Handles role-based access control and permission management
 */

import { PostgreSQLClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";

export interface Permission {
  resource: string;
  action: string;
  conditions?: Record<string, unknown>;
}

export interface RolePermissions {
  role: string;
  permissions: Permission[];
}

/**
 * Production PermissionService implementation
 */
export class PermissionService {
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly rolePermissionsCache: Map<string, Permission[]> = new Map();
  private readonly cacheExpiry: number = 5 * 60 * 1000; // 5 minutes
  private readonly lastCacheUpdate: Map<string, number> = new Map();

  constructor(logger: Logger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
    this.initializeDefaultPermissions();
  }

  /**
   * Check if user has permission for a resource action
   */
  async hasPermission(
    userId: string,
    resource: string,
    action: string,
    context?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      if (!userId || !resource || !action) {
        return false;
      }

      await this.metrics.recordCounter("auth_permission_check_requests");

      // Get user roles
      const userRoles = await this.getUserRoles(userId);
      if (userRoles.length === 0) {
        await this.metrics.recordCounter("auth_permission_check_no_roles");
        return false;
      }

      // Check permissions for each role
      for (const role of userRoles) {
        const permissions = await this.getRolePermissions(role);

        for (const permission of permissions) {
          if (this.matchesPermission(permission, resource, action)) {
            // Check conditions if present
            if (permission.conditions && context) {
              const conditionsMet = this.evaluateConditions(
                permission.conditions,
                context
              );
              if (conditionsMet) {
                await this.metrics.recordCounter(
                  "auth_permission_check_granted"
                );
                this.logger.debug("Permission granted", {
                  userId,
                  role,
                  resource,
                  action,
                });
                return true;
              }
            } else if (!permission.conditions) {
              await this.metrics.recordCounter("auth_permission_check_granted");
              this.logger.debug("Permission granted", {
                userId,
                role,
                resource,
                action,
              });
              return true;
            }
          }
        }
      }

      await this.metrics.recordCounter("auth_permission_check_denied");
      this.logger.debug("Permission denied", {
        userId,
        resource,
        action,
        roles: userRoles,
      });

      return false;
    } catch (error) {
      this.logger.error("Failed to check permission", error as Error, {
        userId,
        resource,
        action,
      });
      await this.metrics.recordCounter("auth_permission_errors");
      return false; // Fail closed
    }
  }

  /**
   * Check multiple permissions at once
   */
  async hasPermissions(
    userId: string,
    permissions: Array<{
      resource: string;
      action: string;
      context?: Record<string, unknown>;
    }>
  ): Promise<boolean[]> {
    try {
      const results = await Promise.all(
        permissions.map(({ resource, action, context }) =>
          this.hasPermission(userId, resource, action, context)
        )
      );

      return results;
    } catch (error) {
      this.logger.error(
        "Failed to check multiple permissions",
        error as Error,
        {
          userId,
          permissionCount: permissions.length,
        }
      );
      // Return all false in case of error
      return new Array(permissions.length).fill(false);
    }
  }

  /**
   * Get all permissions for a user (across all roles)
   */
  async getUserPermissions(userId: string): Promise<Permission[]> {
    try {
      if (!userId) {
        return [];
      }

      await this.metrics.recordCounter("auth_get_user_permissions_requests");

      const userRoles = await this.getUserRoles(userId);
      const allPermissions: Permission[] = [];

      for (const role of userRoles) {
        const rolePermissions = await this.getRolePermissions(role);
        allPermissions.push(...rolePermissions);
      }

      // Deduplicate permissions based on resource and action
      const uniquePermissions = allPermissions.filter(
        (permission, index, self) =>
          index ===
          self.findIndex(
            (p) =>
              p.resource === permission.resource &&
              p.action === permission.action
          )
      );

      await this.metrics.recordCounter("auth_get_user_permissions_success");

      return uniquePermissions;
    } catch (error) {
      this.logger.error("Failed to get user permissions", error as Error, {
        userId,
      });
      await this.metrics.recordCounter("auth_permission_errors");
      return [];
    }
  }

  /**
   * Get permissions for a specific role
   */
  async getRolePermissions(role: string): Promise<Permission[]> {
    try {
      if (!role) {
        return [];
      }

      // Check cache first
      const cacheKey = `role_permissions:${role}`;
      const lastUpdate = this.lastCacheUpdate.get(cacheKey);
      const now = Date.now();

      if (lastUpdate && now - lastUpdate < this.cacheExpiry) {
        const cached = this.rolePermissionsCache.get(cacheKey);
        if (cached) {
          return cached;
        }
      }

      // Get permissions from database or default mapping
      const permissions = this.getDefaultRolePermissions(role);

      // Update cache
      this.rolePermissionsCache.set(cacheKey, permissions);
      this.lastCacheUpdate.set(cacheKey, now);

      return permissions;
    } catch (error) {
      this.logger.error("Failed to get role permissions", error as Error, {
        role,
      });
      return [];
    }
  }

  /**
   * Check if user has admin permissions
   */
  async isAdmin(userId: string): Promise<boolean> {
    try {
      const userRoles = await this.getUserRoles(userId);
      return userRoles.includes("admin");
    } catch (error) {
      this.logger.error("Failed to check admin status", error as Error, {
        userId,
      });
      return false;
    }
  }

  /**
   * Check if user has store owner permissions
   */
  async isStoreOwner(userId: string): Promise<boolean> {
    try {
      const userRoles = await this.getUserRoles(userId);
      return userRoles.includes("store_owner") || userRoles.includes("admin");
    } catch (error) {
      this.logger.error("Failed to check store owner status", error as Error, {
        userId,
      });
      return false;
    }
  }

  /**
   * Clear permissions cache for a role or all roles
   */
  clearPermissionCache(role?: string): void {
    try {
      if (role) {
        const cacheKey = `role_permissions:${role}`;
        this.rolePermissionsCache.delete(cacheKey);
        this.lastCacheUpdate.delete(cacheKey);
        this.logger.debug("Cleared permission cache for role", { role });
      } else {
        this.rolePermissionsCache.clear();
        this.lastCacheUpdate.clear();
        this.logger.debug("Cleared all permission caches");
      }
    } catch (error) {
      this.logger.error("Failed to clear permission cache", error as Error, {
        role,
      });
    }
  }

  /**
   * Validate permission structure
   */
  validatePermission(permission: Permission): boolean {
    if (!permission || typeof permission !== "object") {
      return false;
    }

    if (!permission.resource || typeof permission.resource !== "string") {
      return false;
    }

    if (!permission.action || typeof permission.action !== "string") {
      return false;
    }

    if (permission.conditions && typeof permission.conditions !== "object") {
      return false;
    }

    return true;
  }

  // Private helper methods

  private async getUserRoles(userId: string): Promise<string[]> {
    try {
      const db = PostgreSQLClient.getInstance();
      const userRoles = await db.userRole.findMany({
        where: {
          userId,
          revokedAt: null, // Only active roles
        },
        select: {
          role: true,
        },
      });

      const roles = userRoles.map((ur) => ur.role);

      // Default role if none assigned
      if (roles.length === 0) {
        return ["customer"];
      }

      return roles;
    } catch (error) {
      this.logger.error("Failed to get user roles", error as Error, { userId });
      return ["customer"]; // Default role on error
    }
  }

  private matchesPermission(
    permission: Permission,
    resource: string,
    action: string
  ): boolean {
    // Exact match
    if (permission.resource === resource && permission.action === action) {
      return true;
    }

    // Wildcard matching
    if (permission.resource === "*" || permission.action === "*") {
      return true;
    }

    // Pattern matching for resources (e.g., "user:*" matches "user:read")
    const resourcePattern = permission.resource.replace("*", ".*");
    const actionPattern = permission.action.replace("*", ".*");

    const resourceMatch = new RegExp(`^${resourcePattern}$`).test(resource);
    const actionMatch = new RegExp(`^${actionPattern}$`).test(action);

    return resourceMatch && actionMatch;
  }

  private evaluateConditions(
    conditions: Record<string, unknown>,
    context: Record<string, unknown>
  ): boolean {
    try {
      // Simple condition evaluation
      // In production, you might want a more sophisticated rules engine
      for (const [key, expectedValue] of Object.entries(conditions)) {
        if (context[key] !== expectedValue) {
          return false;
        }
      }
      return true;
    } catch (error) {
      this.logger.debug("Failed to evaluate conditions", {
        conditions,
        context,
      });
      return false;
    }
  }

  private getDefaultRolePermissions(role: string): Permission[] {
    const defaultPermissions: Record<string, Permission[]> = {
      admin: [
        { resource: "*", action: "*" }, // Full access
      ],
      store_owner: [
        { resource: "user", action: "read" },
        { resource: "user", action: "write" },
        { resource: "store", action: "read" },
        { resource: "store", action: "write" },
        { resource: "analytics", action: "read" },
        { resource: "settings", action: "write" },
        { resource: "orders", action: "read" },
        { resource: "orders", action: "write" },
        { resource: "products", action: "*" },
      ],
      api_user: [
        { resource: "api", action: "read" },
        { resource: "api", action: "write" },
        { resource: "user", action: "read" },
        { resource: "store", action: "read" },
        { resource: "orders", action: "read" },
      ],
      customer: [
        { resource: "profile", action: "read" },
        { resource: "profile", action: "write" },
        { resource: "orders", action: "read" },
        { resource: "cart", action: "*" },
      ],
    };

    return defaultPermissions[role] || defaultPermissions["customer"];
  }

  private initializeDefaultPermissions(): void {
    // Pre-populate cache with default permissions
    const roles = ["admin", "store_owner", "api_user", "customer"];

    for (const role of roles) {
      const permissions = this.getDefaultRolePermissions(role);
      const cacheKey = `role_permissions:${role}`;
      this.rolePermissionsCache.set(cacheKey, permissions);
      this.lastCacheUpdate.set(cacheKey, Date.now());
    }

    this.logger.debug("Initialized default permissions cache");
  }
}
