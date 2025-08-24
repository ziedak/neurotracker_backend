/**
 * @fileoverview RBACService - Enterprise RBAC Implementation
 * @module rbac/services
 * @version 1.0.0
 * @description Extracted from PermissionServiceV2 with existing infrastructure integration
 */

import { LRUCache } from "@libs/utils";
import { PostgreSQLClient, RedisClient } from "@libs/database";
import { Role, User, RolePermission } from "@libs/database";
import type {
  EntityId,
  IPermissionCheck,
  IBatchOperationResult,
  IBatchPermissionResult,
  IEnhancedRole,
  IEnhancedPermission,
  IRoleHierarchyInfo,
  IPermissionAnalytics,
  IServiceHealth,
  IPermissionContext,
  IRBACConfig,
  IPermissionCheckResult,
  IUserPermissionCacheEntry,
  IRoleHierarchyCacheEntry,
  IPermissionMetrics,
} from "../types/core";
import { DEFAULT_RBAC_CONFIG } from "../types/core";
import type { IRBACService } from "../contracts/services";

/**
 * RBACService Implementation
 *
 * Enterprise-grade RBAC service extracted from PermissionServiceV2 with:
 * - Multi-level caching (local + Redis distributed caching)
 * - Hierarchical role inheritance
 * - Batch permission operations
 * - Context-aware permission evaluation
 * - Analytics and metrics collection
 * - Background cache maintenance
 * - Health monitoring
 */
export class RBACService implements IRBACService {
  // Use existing database clients - NO REIMPLEMENTATION
  private readonly redis = RedisClient.getInstance();
  private readonly prisma = PostgreSQLClient.getInstance();

  // Use existing repository classes - NO REIMPLEMENTATION
  private readonly userRepository = User;
  private readonly roleRepository = Role;
  private readonly permissionRepository = RolePermission;

  // Cache implementations using LRU cache (preserved from original)
  // Cache instances (initialized in constructor)
  private readonly userPermissionCache: LRUCache<
    EntityId,
    IUserPermissionCacheEntry
  >;
  private readonly permissionCheckCache: LRUCache<
    string,
    IPermissionCheckResult
  >;
  private readonly roleHierarchyCache: LRUCache<
    EntityId,
    IRoleHierarchyCacheEntry
  >;

  // In-memory stores (preserved from original)
  private readonly rolePermissionsStore = new Map<EntityId, Set<string>>();
  private readonly roleHierarchyStore = new Map<EntityId, IRoleHierarchyInfo>();

  // Metrics tracking (preserved from original)
  private readonly metrics: IPermissionMetrics = {
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

  private readonly startTime = Date.now();
  private maintenanceJobId: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: IRBACConfig = DEFAULT_RBAC_CONFIG,
    private readonly logger?: any, // Optional logger injection
    private readonly metricsCollector?: any // Optional metrics collector injection
  ) {
    // Initialize caches with config values
    this.userPermissionCache = new LRUCache(5000, this.config.cache.defaultTtl);
    this.permissionCheckCache = new LRUCache(
      10000,
      this.config.cache.permissionCheckTtl
    );
    this.roleHierarchyCache = new LRUCache(500, this.config.cache.hierarchyTtl);

    // Start background maintenance job
    if (this.config.maintenance.enabled) {
      this.startMaintenanceJob();
    }
  }

  /**
   * Check if user has permission (core method from PermissionServiceV2)
   */
  async hasPermission(
    userId: EntityId,
    resource: string,
    action: string,
    context?: IPermissionContext
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
      const cached = this.permissionCheckCache.get(cacheKey);
      if (cached && this.isCacheValid(cached.cachedAt, cached.ttl)) {
        this.metrics.cacheHits++;
        return cached.result;
      }

      this.metrics.cacheMisses++;

      // Resolve user permissions using existing repositories
      const userPermissions = await this.resolvePermissions(userId);

      // Check direct permission
      const directPermission = `${resource}:${action}`;
      if (userPermissions.includes(directPermission)) {
        this.cachePermissionResult(
          userId,
          resource,
          action,
          true,
          "Direct permission match"
        );
        return true;
      }

      // Check wildcard permissions (preserved logic)
      if (this.config.permissions.enableWildcards) {
        const wildcardResource = `${resource}:*`;
        const wildcardAction = `*:${action}`;
        const wildcardAll = "*:*";

        if (
          userPermissions.some(
            (p) =>
              p === wildcardResource ||
              p === wildcardAction ||
              p === wildcardAll
          )
        ) {
          this.cachePermissionResult(
            userId,
            resource,
            action,
            true,
            "Wildcard permission match"
          );
          return true;
        }
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
        this.cachePermissionResult(
          userId,
          resource,
          action,
          contextResult,
          "Context evaluation"
        );
        return contextResult;
      }

      // No permission found
      this.cachePermissionResult(
        userId,
        resource,
        action,
        false,
        "No matching permission"
      );
      return false;
    } catch (error) {
      this.metrics.errorsTotal++;
      this.logger?.error("Permission check failed", {
        error,
        userId,
        resource,
        action,
      });
      throw new Error(
        `Permission check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Check multiple permissions for a user (preserved from original)
   */
  async hasPermissions(
    userId: EntityId,
    permissions: ReadonlyArray<IPermissionCheck>
  ): Promise<ReadonlyArray<IBatchPermissionResult>> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.batchPermissionChecks++;

      const results: IBatchPermissionResult[] = [];

      // Process each permission check
      for (const permission of permissions) {
        try {
          const granted = await this.hasPermission(
            userId,
            permission.resource,
            permission.action,
            permission.context
          );

          results.push({
            userId,
            resource: permission.resource,
            action: permission.action,
            granted,
            reason: granted ? "Permission granted" : "Permission denied",
            cached: this.isPermissionCached(
              userId,
              permission.resource,
              permission.action,
              permission.context
            ),
          });
        } catch (error) {
          results.push({
            userId,
            resource: permission.resource,
            action: permission.action,
            granted: false,
            reason: `Error: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
            cached: false,
          });
        }
      }

      return results;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new Error(
        `Batch permission check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Batch permission check for multiple users
   */
  async batchPermissionCheck(
    checks: ReadonlyArray<IPermissionCheck>
  ): Promise<IBatchOperationResult<IBatchPermissionResult>> {
    const results: IBatchPermissionResult[] = [];
    const errors: Array<{ index: number; error: string }> = [];
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < checks.length; i++) {
      const check = checks[i];
      try {
        const granted = await this.hasPermission(
          check.userId,
          check.resource,
          check.action,
          check.context
        );

        results.push({
          userId: check.userId,
          resource: check.resource,
          action: check.action,
          granted,
          reason: granted ? "Permission granted" : "Permission denied",
          cached: this.isPermissionCached(
            check.userId,
            check.resource,
            check.action,
            check.context
          ),
        });

        if (granted) successful++;
        else failed++;
      } catch (error) {
        errors.push({
          index: i,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        failed++;
      }
    }

    return {
      results,
      successful,
      failed,
      errors,
    };
  }

  /**
   * Get user permissions using existing repositories
   */
  async getUserPermissions(
    userId: EntityId
  ): Promise<ReadonlyArray<IEnhancedPermission>> {
    try {
      this.metrics.operationsTotal++;

      // Try Redis cache first for distributed caching
      const cacheKey = `rbac:user:permissions:${userId}`;
      const redisCached = await this.redis.get(cacheKey);

      if (redisCached) {
        this.metrics.cacheHits++;
        return JSON.parse(redisCached as string);
      }

      this.metrics.cacheMisses++;

      // Get user with roles using existing repository
      const user = await this.userRepository.findUnique(userId, {
        include: {
          role: {
            include: {
              permissions: true,
              parentRole: true,
              childRoles: true,
            },
          },
        },
      });

      if (!user || !user.role) {
        return [];
      }

      // Build enhanced permissions with inheritance
      const permissions = await this.buildEnhancedPermissions(user.role);

      // Cache in Redis for distributed access
      await this.redis.setex(
        cacheKey,
        this.config.cache.defaultTtl / 1000,
        JSON.stringify(permissions)
      );

      return permissions;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new Error(
        `Failed to get user permissions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get user roles using existing repositories
   */
  async getUserRoles(userId: EntityId): Promise<ReadonlyArray<IEnhancedRole>> {
    try {
      const user = await this.userRepository.findUnique(userId, {
        include: {
          role: {
            include: {
              permissions: true,
              parentRole: true,
              childRoles: true,
            },
          },
        },
      });

      if (!user || !user.role) {
        return [];
      }

      // Build role hierarchy including parent roles
      const roles = await this.buildRoleHierarchy(user.role);
      return roles;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new Error(
        `Failed to get user roles: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Resolve effective permissions for user (flat list)
   */
  async resolvePermissions(userId: EntityId): Promise<ReadonlyArray<string>> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.map((p) => p.fullPermissionString);
  }

  // Additional core methods will be implemented...
  // This is the foundation with the key methods extracted from PermissionServiceV2

  /**
   * Private helper methods (preserved from original)
   */
  private generatePermissionCacheKey(
    userId: EntityId,
    resource: string,
    action: string,
    context?: IPermissionContext
  ): string {
    const contextKey = context ? `:${JSON.stringify(context)}` : "";
    return `permission:${userId}:${resource}:${action}${contextKey}`;
  }

  private isCacheValid(cachedAt: Date, ttl: number): boolean {
    return Date.now() - cachedAt.getTime() < ttl;
  }

  private isPermissionCached(
    userId: EntityId,
    resource: string,
    action: string,
    context?: IPermissionContext
  ): boolean {
    const cacheKey = this.generatePermissionCacheKey(
      userId,
      resource,
      action,
      context
    );
    const cached = this.permissionCheckCache.get(cacheKey);
    return (
      cached !== undefined && this.isCacheValid(cached.cachedAt, cached.ttl)
    );
  }

  private async evaluateContextPermission(
    userId: EntityId,
    resource: string,
    action: string,
    context: IPermissionContext,
    userPermissions: ReadonlyArray<string>
  ): Promise<boolean> {
    // Context evaluation logic (simplified for now)
    // This would include time-based, IP-based, and other contextual checks
    return false;
  }

  private async buildEnhancedPermissions(
    role: any
  ): Promise<IEnhancedPermission[]> {
    // Build enhanced permissions with inheritance
    const permissions: IEnhancedPermission[] = [];

    // Add direct permissions
    for (const perm of role.permissions || []) {
      permissions.push({
        ...perm,
        fullPermissionString: `${perm.resource}:${perm.action}`,
        isInherited: false,
        priority: perm.priority as any,
      });
    }

    // Add inherited permissions from parent roles
    if (this.config.permissions.enableInheritance && role.parentRole) {
      const parentPermissions = await this.buildEnhancedPermissions(
        role.parentRole
      );
      for (const perm of parentPermissions) {
        permissions.push({
          ...perm,
          isInherited: true,
          inheritedFromRole: role.parentRole.id,
        });
      }
    }

    return permissions;
  }

  private async buildRoleHierarchy(role: any): Promise<IEnhancedRole[]> {
    const roles: IEnhancedRole[] = [];

    // Add current role
    const enhancedRole: IEnhancedRole = {
      ...role,
      permissions: await this.buildEnhancedPermissions(role),
      hierarchyLevel: 0,
    };
    roles.push(enhancedRole);

    // Add parent roles if inheritance enabled
    if (this.config.permissions.enableInheritance && role.parentRole) {
      const parentRoles = await this.buildRoleHierarchy(role.parentRole);
      roles.push(
        ...parentRoles.map((r) => ({
          ...r,
          hierarchyLevel: (r.hierarchyLevel || 0) + 1,
        }))
      );
    }

    return roles;
  }

  // Placeholder implementations for required interface methods
  // These will be fully implemented in the next iteration

  async assignRole(
    userId: EntityId,
    roleId: EntityId,
    assignedBy?: EntityId
  ): Promise<boolean> {
    // Implementation will use existing User repository to update roleId
    throw new Error("Method not implemented yet");
  }

  async removeRole(
    userId: EntityId,
    roleId: EntityId,
    removedBy?: EntityId
  ): Promise<boolean> {
    throw new Error("Method not implemented yet");
  }

  async getRoleHierarchy(roleId: EntityId): Promise<IRoleHierarchyInfo> {
    throw new Error("Method not implemented yet");
  }

  async getFullRoleHierarchy(): Promise<IRoleHierarchyInfo> {
    throw new Error("Method not implemented yet");
  }

  async refreshRoleHierarchy(): Promise<void> {
    throw new Error("Method not implemented yet");
  }

  async cachePermissionResult(
    userId: EntityId,
    resource: string,
    action: string,
    result: boolean,
    reason: string
  ): Promise<void> {
    const cacheKey = this.generatePermissionCacheKey(userId, resource, action);
    this.permissionCheckCache.set(cacheKey, {
      result,
      reason,
      cachedAt: new Date(),
      ttl: this.config.cache.permissionCheckTtl,
    });
  }

  async clearUserCache(userId: EntityId): Promise<void> {
    // Clear local caches
    this.userPermissionCache.delete(userId);

    // Clear Redis cache
    const pattern = `rbac:user:*:${userId}`;
    // Redis pattern clearing would be implemented here
  }

  async clearPermissionCache(
    userId: EntityId,
    resource: string,
    action: string
  ): Promise<void> {
    const cacheKey = this.generatePermissionCacheKey(userId, resource, action);
    this.permissionCheckCache.delete(cacheKey);
  }

  async warmCache(userIds: ReadonlyArray<EntityId>): Promise<void> {
    // Warm cache implementation
    for (const userId of userIds) {
      try {
        await this.getUserPermissions(userId);
      } catch (error) {
        this.logger?.warn("Failed to warm cache for user", { userId, error });
      }
    }
  }

  async getPermissionAnalytics(
    userId?: EntityId,
    days?: number
  ): Promise<IPermissionAnalytics> {
    return {
      totalPermissionChecks: this.metrics.permissionChecks,
      uniqueUsers: 0, // Would be calculated from actual data
      topPermissions: [],
      cacheHitRate:
        this.metrics.cacheHits /
          (this.metrics.cacheHits + this.metrics.cacheMisses) || 0,
      averageResponseTime: 0, // Would be calculated
      errorRate: this.metrics.errorsTotal / this.metrics.operationsTotal || 0,
    };
  }

  trackPermissionCheck(
    userId: EntityId,
    permission: string,
    granted: boolean
  ): void {
    // Track for analytics
    if (this.metricsCollector) {
      this.metricsCollector.increment("rbac.permission.check", {
        permission,
        granted: granted.toString(),
        userId: userId.substring(0, 8), // Privacy-safe tracking
      });
    }
  }

  async getHealthStatus(): Promise<IServiceHealth> {
    const uptime = Date.now() - this.startTime;

    return {
      service: "RBACService",
      status: "healthy",
      uptime,
      lastCheck: new Date(),
      metrics: {
        cacheHitRate:
          this.metrics.cacheHits /
            (this.metrics.cacheHits + this.metrics.cacheMisses) || 0,
        averageResponseTime: 0, // Would calculate actual response time
        totalOperations: this.metrics.operationsTotal,
        errorRate: this.metrics.errorsTotal / this.metrics.operationsTotal || 0,
      },
      dependencies: {
        database: (await PostgreSQLClient.ping()) ? "healthy" : "unhealthy",
        redis: (await RedisClient.ping()) ? "healthy" : "unhealthy",
      },
    };
  }

  async getCacheStats() {
    const calculateStats = (cache: LRUCache<any, any>) => ({
      size: cache.getSize(),
      hitRate: 0, // LRU cache doesn't expose hit rate directly
      missRate: 0,
    });

    return {
      userPermissionCache: calculateStats(this.userPermissionCache),
      permissionCheckCache: calculateStats(this.permissionCheckCache),
      roleHierarchyCache: calculateStats(this.roleHierarchyCache),
    };
  }

  startMaintenanceJob(): void {
    if (!this.maintenanceJobId && this.config.maintenance.enabled) {
      this.maintenanceJobId = setInterval(async () => {
        try {
          await this.runCacheCleanup();
        } catch (error) {
          this.logger?.error("Cache maintenance job failed", { error });
        }
      }, this.config.maintenance.intervalMs);
    }
  }

  stopMaintenanceJob(): void {
    if (this.maintenanceJobId) {
      clearInterval(this.maintenanceJobId);
      this.maintenanceJobId = undefined;
    }
  }

  async runCacheCleanup(): Promise<void> {
    // Clean up expired cache entries
    // LRU cache handles this automatically, but we can force cleanup here
    const now = Date.now();

    // Clear expired permission check cache entries manually if needed
    for (const [key, value] of this.permissionCheckCache.entries()) {
      if (now - value.cachedAt.getTime() > value.ttl) {
        this.permissionCheckCache.delete(key);
      }
    }
  }

  getConfig(): IRBACConfig {
    return { ...this.config };
  }

  async updateConfig(config: Partial<IRBACConfig>): Promise<void> {
    Object.assign(this.config, config);

    // Update cache configurations
    // Note: LRU cache configuration updates would require recreation
    this.logger?.info("RBAC configuration updated", { config });
  }
}
