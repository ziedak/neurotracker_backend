/**
 * @fileoverview PermissionServiceV2 - Enterprise RBAC permission management service
 * @module services/PermissionService
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, Timestamp } from "../types/core";
import type {
  IEnhancedRole,
  IEnhancedPermission,
  IServiceHealth,
  IRoleHierarchy,
} from "../types/enhanced";
import type {
  IPermissionService,
  IPermissionCheck,
  IRoleHierarchyInfo,
  IPermissionAnalytics,
  IBatchOperationResult,
} from "../contracts/services";
import { ValidationError } from "../errors/core";

/**
 * Permission check result with caching metadata
 */
interface IPermissionCheckResult {
  readonly result: boolean;
  readonly reason: string;
  readonly cachedAt: Date;
  readonly ttl: number;
}

/**
 * Permission metrics for performance tracking
 */
interface IPermissionMetrics {
  permissionChecks: number;
  batchPermissionChecks: number;
  roleAssignments: number;
  roleRemovals: number;
  cacheHits: number;
  cacheMisses: number;
  hierarchyResolutions: number;
  operationsTotal: number;
  errorsTotal: number;
}

/**
 * User permission cache entry
 */
interface IUserPermissionCacheEntry {
  permissions: ReadonlyArray<string>;
  roles: ReadonlyArray<IEnhancedRole>;
  cachedAt: Date;
  ttl: number;
}

/**
 * Role hierarchy cache entry
 */
interface IRoleHierarchyCacheEntry {
  hierarchy: IRoleHierarchyInfo;
  cachedAt: Date;
  ttl: number;
}

/**
 * PermissionServiceV2 Implementation
 *
 * Enterprise-grade RBAC permission management service with:
 * - High-performance permission checking with multi-level caching
 * - Role-based access control with hierarchical inheritance
 * - Dynamic permission resolution and context evaluation
 * - Batch permission operations for performance
 * - Permission analytics and audit tracking
 * - Health monitoring and metrics collection
 */
export class PermissionServiceV2 implements IPermissionService {
  private readonly userPermissionCache = new Map<
    EntityId,
    IUserPermissionCacheEntry
  >();
  private readonly permissionCheckCache = new Map<
    string,
    IPermissionCheckResult
  >();
  private readonly roleHierarchyCache = new Map<
    EntityId,
    IRoleHierarchyCacheEntry
  >();
  private readonly userRolesStore = new Map<EntityId, Set<EntityId>>();
  private readonly rolePermissionsStore = new Map<EntityId, Set<string>>();
  private readonly roleHierarchyStore = new Map<EntityId, IRoleHierarchy>();
  private readonly metrics: IPermissionMetrics;
  private readonly startTime: number;

  // Configuration
  private readonly defaultCacheTtl = 5 * 60 * 1000; // 5 minutes
  private readonly permissionCheckCacheTtl = 2 * 60 * 1000; // 2 minutes
  private readonly hierarchyCacheTtl = 10 * 60 * 1000; // 10 minutes
  private readonly maxCacheSize = 50000;
  private readonly cacheCleanupThreshold = 0.8;

  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      permissionChecks: 0,
      batchPermissionChecks: 0,
      roleAssignments: 0,
      roleRemovals: 0,
      cacheHits: 0,
      cacheMisses: 0,
      hierarchyResolutions: 0,
      operationsTotal: 0,
      errorsTotal: 0,
    };

    // Initialize with basic roles for demo
    this.initializeBasicRoles();

    // Start background maintenance
    this.startCacheMaintenanceJob();
  }

  /**
   * Check if user has permission
   */
  async hasPermission(
    userId: EntityId,
    resource: string,
    action: string,
    context?: Record<string, unknown>
  ): Promise<boolean> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.permissionChecks++;

      // Generate cache key
      const cacheKey = this.generatePermissionCacheKey(
        userId,
        resource,
        action,
        context
      );

      // Check permission cache first
      const cached = this.getPermissionFromCache(cacheKey);
      if (cached !== null) {
        this.metrics.cacheHits++;
        return cached.result;
      }

      this.metrics.cacheMisses++;

      // Resolve user permissions
      const userPermissions = await this.resolvePermissions(userId);

      // Check direct permission
      const directPermission = `${resource}:${action}`;
      if (userPermissions.includes(directPermission)) {
        this.cachePermissionResultInternal(
          cacheKey,
          true,
          "Direct permission match"
        );
        return true;
      }

      // Check wildcard permissions
      const wildcardResource = `${resource}:*`;
      const wildcardAction = `*:${action}`;
      const wildcardAll = "*:*";

      if (
        userPermissions.some(
          (p) =>
            p === wildcardResource || p === wildcardAction || p === wildcardAll
        )
      ) {
        this.cachePermissionResultInternal(
          cacheKey,
          true,
          "Wildcard permission match"
        );
        return true;
      }

      // Check context-based permissions if context provided
      if (context) {
        const contextResult = await this.evaluateContextPermission(
          userId,
          resource,
          action,
          context,
          userPermissions
        );
        this.cachePermissionResultInternal(
          cacheKey,
          contextResult,
          "Context evaluation"
        );
        return contextResult;
      }

      // No permission found
      this.cachePermissionResultInternal(
        cacheKey,
        false,
        "No matching permission"
      );
      return false;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Permission check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Check multiple permissions (batch)
   */
  async hasPermissions(
    userId: EntityId,
    permissions: ReadonlyArray<IPermissionCheck>
  ): Promise<IBatchOperationResult<boolean>> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.batchPermissionChecks++;

      const results: { [key: string]: boolean } = {};
      const errors: { [key: string]: string } = {};
      let successCount = 0;

      // Process each permission check
      for (const permission of permissions) {
        const key = `${permission.resource}:${permission.action}`;

        try {
          const result = await this.hasPermission(
            userId,
            permission.resource,
            permission.action,
            permission.context
          );

          results[key] = result;
          if (result) successCount++;
        } catch (error) {
          errors[key] =
            error instanceof Error ? error.message : "Permission check failed";
        }
      }

      return {
        successful: Object.entries(results)
          .filter(([, result]) => result)
          .map(([, result]) => result),
        failed: Object.entries(errors).map(([key, error]) => ({
          id: key,
          error: {
            code: "PERMISSION_CHECK_FAILED" as any,
            message: error,
            details: { resource: key.split(":")[0], action: key.split(":")[1] },
            timestamp: new Date().toISOString() as Timestamp,
            traceId: `perm_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`,
          },
          input: permissions.find((p) => `${p.resource}:${p.action}` === key),
        })),
        totalProcessed: permissions.length,
        processingTime: Date.now() - this.startTime,
        timestamp: new Date().toISOString() as Timestamp,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Batch permission check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get user permissions
   */
  async getUserPermissions(
    userId: EntityId
  ): Promise<ReadonlyArray<IEnhancedPermission>> {
    try {
      this.metrics.operationsTotal++;

      // Get user roles
      const userRoles = await this.getUserRoles(userId);

      // Collect all permissions from roles
      const permissions: IEnhancedPermission[] = [];

      for (const role of userRoles) {
        permissions.push(...role.computedPermissions);
      }

      // Remove duplicates based on resource:action combination
      const uniquePermissions = permissions.filter(
        (permission, index, array) =>
          array.findIndex(
            (p) =>
              p.resource === permission.resource &&
              p.action === permission.action
          ) === index
      );

      return Object.freeze(uniquePermissions);
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to get user permissions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get user roles
   */
  async getUserRoles(userId: EntityId): Promise<ReadonlyArray<IEnhancedRole>> {
    try {
      this.metrics.operationsTotal++;

      // Check cache first
      const cached = this.getUserFromCache(userId);
      if (cached) {
        return cached.roles;
      }

      // Get user role IDs
      const roleIds = Array.from(this.userRolesStore.get(userId) || new Set());

      // Build enhanced roles
      const roles: IEnhancedRole[] = [];

      for (const roleId of roleIds) {
        const role = await this.buildEnhancedRole(roleId as EntityId);
        if (role) {
          roles.push(role);
        }
      }

      // Cache the result
      this.cacheUserPermissions(userId, [], roles);

      return Object.freeze(roles);
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to get user roles: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Assign role to user
   */
  async assignRole(userId: EntityId, roleId: EntityId): Promise<boolean> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.roleAssignments++;

      // Validate role exists
      if (!this.roleHierarchyStore.has(roleId)) {
        throw new ValidationError(`Role not found: ${roleId}`);
      }

      // Get or create user role set
      if (!this.userRolesStore.has(userId)) {
        this.userRolesStore.set(userId, new Set());
      }

      const userRoles = this.userRolesStore.get(userId)!;

      // Check if already assigned
      if (userRoles.has(roleId)) {
        return false; // Already assigned
      }

      // Assign role
      userRoles.add(roleId);

      // Clear user cache
      this.clearUserPermissionCache(userId);

      return true;
    } catch (error) {
      this.metrics.errorsTotal++;
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to assign role: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Remove role from user
   */
  async removeRole(userId: EntityId, roleId: EntityId): Promise<boolean> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.roleRemovals++;

      const userRoles = this.userRolesStore.get(userId);
      if (!userRoles || !userRoles.has(roleId)) {
        return false; // Role not assigned
      }

      // Remove role
      userRoles.delete(roleId);

      // Clean up empty set
      if (userRoles.size === 0) {
        this.userRolesStore.delete(userId);
      }

      // Clear user cache
      await this.clearUserPermissionCache(userId);

      return true;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to remove role: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get role hierarchy
   */
  async getRoleHierarchy(roleId: EntityId): Promise<IRoleHierarchyInfo> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.hierarchyResolutions++;

      // Check cache first
      const cached = this.getRoleHierarchyFromCache(roleId);
      if (cached) {
        return cached.hierarchy;
      }

      // Get role hierarchy data
      const hierarchy = this.roleHierarchyStore.get(roleId);
      if (!hierarchy) {
        throw new ValidationError(`Role hierarchy not found: ${roleId}`);
      }

      // Get role permissions
      const directPermissions = Array.from(
        this.rolePermissionsStore.get(roleId) || new Set()
      ) as string[];

      // Resolve inherited permissions
      const inheritedPermissions = this.resolveInheritedPermissions(
        roleId
      ) as string[];

      const hierarchyInfo: IRoleHierarchyInfo = {
        roleId,
        level: hierarchy.level,
        parentRoles: hierarchy.parentRoles,
        childRoles: hierarchy.childRoles,
        inheritedPermissions: inheritedPermissions,
        directPermissions: directPermissions,
      };

      // Cache the result
      this.cacheRoleHierarchy(roleId, hierarchyInfo);

      return hierarchyInfo;
    } catch (error) {
      this.metrics.errorsTotal++;
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to get role hierarchy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Resolve permissions with inheritance
   */
  async resolvePermissions(userId: EntityId): Promise<ReadonlyArray<string>> {
    try {
      this.metrics.operationsTotal++;

      // Check cache first
      const cached = this.getUserFromCache(userId);
      if (cached) {
        return cached.permissions;
      }

      // Get user roles
      const roleIds = Array.from(this.userRolesStore.get(userId) || new Set());

      // Collect all permissions with inheritance
      const allPermissions = new Set<string>();

      for (const roleId of roleIds) {
        // Get role hierarchy info
        const hierarchyInfo = await this.getRoleHierarchy(roleId as EntityId);

        // Add direct permissions
        hierarchyInfo.directPermissions.forEach((p) => allPermissions.add(p));

        // Add inherited permissions
        hierarchyInfo.inheritedPermissions.forEach((p) =>
          allPermissions.add(p)
        );
      }

      const permissions = Array.from(allPermissions);

      // Cache the result
      this.cacheUserPermissions(userId, permissions, []);

      return Object.freeze(permissions);
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to resolve permissions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Cache permission check result
   */
  async cachePermissionResult(
    userId: EntityId,
    resource: string,
    action: string,
    result: boolean
  ): Promise<void> {
    const cacheKey = this.generatePermissionCacheKey(userId, resource, action);
    this.cachePermissionResultInternal(cacheKey, result, "Manual cache");
  }

  /**
   * Clear permission cache for user
   */
  async clearUserPermissionCache(userId: EntityId): Promise<void> {
    this.userPermissionCache.delete(userId);

    // Clear related permission check cache entries
    const keysToDelete: string[] = [];
    for (const [key] of this.permissionCheckCache) {
      if (key.startsWith(`${userId}:`)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.permissionCheckCache.delete(key));
  }

  /**
   * Get permission analytics
   */
  async getPermissionAnalytics(
    userId: EntityId,
    _days: number = 30
  ): Promise<IPermissionAnalytics> {
    try {
      this.metrics.operationsTotal++;

      // In a real implementation, this would query audit logs
      // For now, provide basic analytics from cache

      // Count permission checks from cache (simplified)
      let totalChecks = 0;
      let deniedChecks = 0;
      const resourceCounts: { [resource: string]: number } = {};
      const actionCounts: { [action: string]: number } = {};

      // Analyze cached permission checks for this user
      for (const [key, result] of this.permissionCheckCache) {
        if (key.startsWith(`${userId}:`)) {
          totalChecks++;
          if (!result.result) {
            deniedChecks++;
          }

          // Parse resource and action from cache key
          const parts = key.split(":");
          if (parts.length >= 3) {
            const resource = parts[1];
            const action = parts[2];

            if (resource) {
              resourceCounts[resource] = (resourceCounts[resource] || 0) + 1;
            }
            if (action) {
              actionCounts[action] = (actionCounts[action] || 0) + 1;
            }
          }
        }
      }

      // Sort and limit top resources/actions
      const topResources = Object.entries(resourceCounts)
        .map(([resource, count]) => ({ resource, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const topActions = Object.entries(actionCounts)
        .map(([action, count]) => ({ action, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return {
        userId,
        totalChecks,
        deniedChecks,
        topResources: Object.freeze(topResources),
        topActions: Object.freeze(topActions),
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to get permission analytics: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Health check
   */
  async getHealth(): Promise<IServiceHealth> {
    try {
      return {
        service: "PermissionServiceV2",
        status: "healthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [],
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
          permissionChecks: this.metrics.permissionChecks,
          batchPermissionChecks: this.metrics.batchPermissionChecks,
          roleAssignments: this.metrics.roleAssignments,
          roleRemovals: this.metrics.roleRemovals,
          cacheHits: this.metrics.cacheHits,
          cacheMisses: this.metrics.cacheMisses,
          hierarchyResolutions: this.metrics.hierarchyResolutions,
          userCacheSize: this.userPermissionCache.size,
          permissionCheckCacheSize: this.permissionCheckCache.size,
          roleHierarchyCacheSize: this.roleHierarchyCache.size,
          totalUsers: this.userRolesStore.size,
          totalRoles: this.roleHierarchyStore.size,
        },
      };
    } catch (error) {
      return {
        service: "PermissionServiceV2",
        status: "unhealthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [],
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
        },
      };
    }
  }

  /**
   * Private utility methods
   */
  private generatePermissionCacheKey(
    userId: EntityId,
    resource: string,
    action: string,
    context?: Record<string, unknown>
  ): string {
    const contextStr = context ? JSON.stringify(context) : "";
    return `${userId}:${resource}:${action}:${contextStr}`;
  }

  private getPermissionFromCache(
    cacheKey: string
  ): IPermissionCheckResult | null {
    const entry = this.permissionCheckCache.get(cacheKey);
    if (entry && Date.now() - entry.cachedAt.getTime() < entry.ttl) {
      return entry;
    }

    // Remove expired entry
    if (entry) {
      this.permissionCheckCache.delete(cacheKey);
    }

    return null;
  }

  /**
   * Cache permission check result (private method)
   */
  private cachePermissionResultInternal(
    cacheKey: string,
    result: boolean,
    reason: string
  ): void {
    if (
      this.permissionCheckCache.size >=
      this.maxCacheSize * this.cacheCleanupThreshold
    ) {
      this.cleanupPermissionCheckCache();
    }

    this.permissionCheckCache.set(cacheKey, {
      result,
      reason,
      cachedAt: new Date(),
      ttl: this.permissionCheckCacheTtl,
    });
  }

  private getUserFromCache(userId: EntityId): IUserPermissionCacheEntry | null {
    const entry = this.userPermissionCache.get(userId);
    if (entry && Date.now() - entry.cachedAt.getTime() < entry.ttl) {
      return entry;
    }

    if (entry) {
      this.userPermissionCache.delete(userId);
    }

    return null;
  }

  private cacheUserPermissions(
    userId: EntityId,
    permissions: ReadonlyArray<string>,
    roles: ReadonlyArray<IEnhancedRole>
  ): void {
    this.userPermissionCache.set(userId, {
      permissions,
      roles,
      cachedAt: new Date(),
      ttl: this.defaultCacheTtl,
    });
  }

  private getRoleHierarchyFromCache(
    roleId: EntityId
  ): IRoleHierarchyCacheEntry | null {
    const entry = this.roleHierarchyCache.get(roleId);
    if (entry && Date.now() - entry.cachedAt.getTime() < entry.ttl) {
      return entry;
    }

    if (entry) {
      this.roleHierarchyCache.delete(roleId);
    }

    return null;
  }

  private cacheRoleHierarchy(
    roleId: EntityId,
    hierarchy: IRoleHierarchyInfo
  ): void {
    this.roleHierarchyCache.set(roleId, {
      hierarchy,
      cachedAt: new Date(),
      ttl: this.hierarchyCacheTtl,
    });
  }

  private async buildEnhancedRole(
    roleId: EntityId
  ): Promise<IEnhancedRole | null> {
    const hierarchy = this.roleHierarchyStore.get(roleId);
    const permissions = this.rolePermissionsStore.get(roleId);

    if (!hierarchy || !permissions) {
      return null;
    }

    // Build enhanced permissions
    const enhancedPermissions: IEnhancedPermission[] = Array.from(
      permissions
    ).map((permission) => {
      const [resource, action] = permission.split(":");
      return {
        id: roleId as EntityId,
        roleId,
        resource: resource || "",
        action: action || "",
        name: permission,
        priority: "medium",
        version: "1.0.0",
        createdAt: new Date().toISOString() as Timestamp,
        updatedAt: new Date().toISOString() as Timestamp,
        compiledConditions: {
          timeRestrictions: null,
          ipRestrictions: [],
          contextRequirements: [],
          customRules: [],
        },
        scope: {
          resourceType: resource || "",
          resourceIds: [],
          actions: [action || ""],
          filters: [],
        },
      };
    });

    return {
      id: roleId,
      name: `Role_${roleId}`, // Simplified for demo
      displayName: `Role ${roleId} Display Name`,
      description: `Role ${roleId} description`,
      category: "functional",
      level: hierarchy.level,
      isActive: true,
      version: "1.0.0",
      createdAt: new Date().toISOString() as Timestamp,
      updatedAt: new Date().toISOString() as Timestamp,
      metadata: null,
      parentRoleIds: [...hierarchy.parentRoles],
      childRoleIds: [...hierarchy.childRoles],
      computedPermissions: Object.freeze(enhancedPermissions),
      hierarchy: hierarchy,
    };
  }

  private async evaluateContextPermission(
    _userId: EntityId,
    _resource: string,
    _action: string,
    context: Record<string, unknown>,
    _userPermissions: ReadonlyArray<string>
  ): Promise<boolean> {
    // Simplified context evaluation
    // In a real implementation, this would evaluate complex context rules

    // Example: time-based permissions
    if (context["timeRestricted"] === true) {
      const hour = new Date().getHours();
      if (hour < 9 || hour > 17) {
        return false; // Outside business hours
      }
    }

    // Example: IP-based permissions
    if (context["ipAddress"] && typeof context["ipAddress"] === "string") {
      const ip = context["ipAddress"];
      if (ip.startsWith("192.168.")) {
        return true; // Local network access
      }
    }

    return false;
  }

  private resolveInheritedPermissions(roleId: EntityId): ReadonlyArray<string> {
    const hierarchy = this.roleHierarchyStore.get(roleId);
    if (!hierarchy) {
      return [];
    }

    const inherited = new Set<string>();

    // Collect permissions from parent roles
    for (const parentRoleId of hierarchy.parentRoles) {
      const parentPermissions = this.rolePermissionsStore.get(parentRoleId);
      if (parentPermissions) {
        parentPermissions.forEach((p) => inherited.add(p));
      }

      // Recursively collect from parent's parents
      const parentInherited = this.resolveInheritedPermissions(parentRoleId);
      parentInherited.forEach((p) => inherited.add(p));
    }

    return Array.from(inherited);
  }

  private initializeBasicRoles(): void {
    // Create basic role hierarchy for demo
    const adminRoleId = "admin" as EntityId;
    const userRoleId = "user" as EntityId;
    const guestRoleId = "guest" as EntityId;

    // Admin role
    this.roleHierarchyStore.set(adminRoleId, {
      level: 1,
      parentRoles: [],
      childRoles: [userRoleId],
      inheritedPermissions: [],
      effectivePermissions: [adminRoleId],
    });
    this.rolePermissionsStore.set(
      adminRoleId,
      new Set(["*:*", "users:*", "system:*", "reports:*"])
    );

    // User role
    this.roleHierarchyStore.set(userRoleId, {
      level: 2,
      parentRoles: [adminRoleId],
      childRoles: [guestRoleId],
      inheritedPermissions: [adminRoleId],
      effectivePermissions: [userRoleId, adminRoleId],
    });
    this.rolePermissionsStore.set(
      userRoleId,
      new Set(["profile:read", "profile:update", "data:read", "dashboard:read"])
    );

    // Guest role
    this.roleHierarchyStore.set(guestRoleId, {
      level: 3,
      parentRoles: [userRoleId],
      childRoles: [],
      inheritedPermissions: [userRoleId, adminRoleId],
      effectivePermissions: [guestRoleId, userRoleId, adminRoleId],
    });
    this.rolePermissionsStore.set(guestRoleId, new Set(["public:read"]));
  }

  private cleanupPermissionCheckCache(): void {
    // Remove oldest entries
    const entries = Array.from(this.permissionCheckCache.entries());
    entries.sort(([, a], [, b]) => a.cachedAt.getTime() - b.cachedAt.getTime());

    const removeCount = Math.floor(entries.length * 0.2);
    for (let i = 0; i < removeCount && i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        this.permissionCheckCache.delete(entry[0]);
      }
    }
  }

  private startCacheMaintenanceJob(): void {
    // Clean up expired cache entries every 10 minutes
    setInterval(() => {
      try {
        // Clean permission check cache
        for (const [key, entry] of this.permissionCheckCache) {
          if (Date.now() - entry.cachedAt.getTime() >= entry.ttl) {
            this.permissionCheckCache.delete(key);
          }
        }

        // Clean user permission cache
        for (const [userId, entry] of this.userPermissionCache) {
          if (Date.now() - entry.cachedAt.getTime() >= entry.ttl) {
            this.userPermissionCache.delete(userId);
          }
        }

        // Clean role hierarchy cache
        for (const [roleId, entry] of this.roleHierarchyCache) {
          if (Date.now() - entry.cachedAt.getTime() >= entry.ttl) {
            this.roleHierarchyCache.delete(roleId);
          }
        }
      } catch (error) {
        console.error("Permission cache maintenance failed:", error);
      }
    }, 10 * 60 * 1000);
  }
}
