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
import {
  UserRepository,
  RoleRepository,
  getRepositoryFactory,
} from "../repositories";
import { RedisCacheService } from "./RedisCacheService";
import type { IPermissionScope } from "../types/enhanced";

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
  private readonly userRepository: UserRepository;
  private readonly roleRepository: RoleRepository;
  private readonly redisCache: RedisCacheService;

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
  // Remove unused in-memory store - replaced with database operations
  // private readonly userRolesStore = new Map<EntityId, Set<EntityId>>();
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
    const repositoryFactory = getRepositoryFactory();
    this.userRepository = repositoryFactory.getUserRepository();
    this.roleRepository = repositoryFactory.getRoleRepository();
    this.redisCache = new RedisCacheService();

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

    // Initialize metrics and cache
    // Note: Role data is now managed entirely through the database

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
   * Get user permissions with Redis distributed caching
   */
  async getUserPermissions(
    userId: EntityId
  ): Promise<ReadonlyArray<IEnhancedPermission>> {
    try {
      this.metrics.operationsTotal++;

      // Try Redis cache first for distributed caching
      const redisCached = await this.redisCache.getUserPermissions(userId);
      if (redisCached) {
        this.metrics.cacheHits++;
        return Object.freeze(redisCached);
      }

      // Fallback to local cache
      const cached = this.getUserFromCache(userId);
      if (cached) {
        this.metrics.cacheHits++;
        // Return fresh data from database to ensure consistency
        const enhancedPermissions = await this.getUserPermissionsFromDatabase(
          userId
        );

        // Update Redis cache with fresh data
        await this.redisCache.cacheUserPermissions(userId, enhancedPermissions);

        return Object.freeze(enhancedPermissions);
      }

      this.metrics.cacheMisses++;

      // Get permissions from database
      const enhancedPermissions = await this.getUserPermissionsFromDatabase(
        userId
      );

      // Cache in both Redis and local cache
      await this.redisCache.cacheUserPermissions(userId, enhancedPermissions);

      const permissionStrings = enhancedPermissions.map(
        (p) => `${p.resource}:${p.action}`
      );
      this.cacheUserPermissions(userId, permissionStrings, []);

      return Object.freeze(enhancedPermissions);
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

      // Get user with role from database using repositories
      const user = await this.userRepository.findById(userId);
      if (!user || !user.roleId) {
        return Object.freeze([]);
      }

      // Build enhanced roles
      const roles: IEnhancedRole[] = [];
      const role = await this.buildEnhancedRole(user.roleId as EntityId);
      if (role) {
        roles.push(role);
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
      const role = await this.roleRepository.findById(roleId);
      if (!role) {
        throw new ValidationError(`Role not found: ${roleId}`);
      }

      // Get current user
      const user = await this.userRepository.findById(userId);
      if (!user) {
        throw new ValidationError(`User not found: ${userId}`);
      }

      // Check if already assigned
      if (user.roleId === roleId) {
        return false; // Already assigned
      }

      // Update user's role
      await this.userRepository.update(userId, {
        ...user,
        roleId,
        roleAssignedAt: new Date(),
        // Note: roleAssignedBy would need to be passed as parameter in real implementation
      });

      // Clear both Redis and local caches
      await this.redisCache.invalidateUserPermissions(userId);
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

      // Get current user
      const user = await this.userRepository.findById(userId);
      if (!user || user.roleId !== roleId) {
        return false; // Role not assigned to this user
      }

      // Remove role by setting roleId to null
      await this.userRepository.update(userId, {
        ...user,
        roleId: null,
        roleRevokedAt: new Date(),
        // Note: roleRevokedBy would need to be passed as parameter in real implementation
      });

      // Clear both Redis and local caches
      await this.redisCache.invalidateUserPermissions(userId);
      await this.clearUserPermissionCache(userId);

      return true;
    } catch (error) {
      this.metrics.errorsTotal++;
      if (error instanceof ValidationError) {
        throw error;
      }
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

      // Get user from database using repository
      const user = await this.userRepository.findById(userId);
      if (!user || !user.roleId) {
        return Object.freeze([]);
      }

      // Collect all permissions with inheritance
      const allPermissions = new Set<string>();

      // Get role hierarchy info
      const hierarchyInfo = await this.getRoleHierarchy(
        user.roleId as EntityId
      );

      // Add direct permissions
      hierarchyInfo.directPermissions.forEach((p) => allPermissions.add(p));

      // Add inherited permissions
      hierarchyInfo.inheritedPermissions.forEach((p) => allPermissions.add(p));

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
    days: number = 30
  ): Promise<IPermissionAnalytics> {
    try {
      this.metrics.operationsTotal++;

      // Get analytics data from cache analysis
      // Future enhancement: integrate with audit logging system for data older than cache TTL

      // Calculate analysis time window (used for future audit log queries)
      const analysisWindow = days * 24 * 60 * 60 * 1000;
      const currentTime = Date.now();
      const oldestRelevantTime = currentTime - analysisWindow;

      // Get user's current permissions for analysis
      const userPermissions = await this.getUserPermissions(userId);

      let totalChecks = 0;
      let deniedChecks = 0;
      const resourceCounts: { [resource: string]: number } = {};
      const actionCounts: { [action: string]: number } = {};

      // Analyze cached permission checks for this user (within analysis window)
      for (const [key, result] of this.permissionCheckCache) {
        if (key.startsWith(`${userId}:`)) {
          // Filter by time window for more accurate analytics
          if (result.cachedAt.getTime() >= oldestRelevantTime) {
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
      }

      // Include user's current permissions in resource analysis
      userPermissions.forEach((permission) => {
        const resource = permission.resource;
        const action = permission.action;

        resourceCounts[resource] = resourceCounts[resource] || 0;
        actionCounts[action] = actionCounts[action] || 0;
      });

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
   * Cache warming for frequently accessed permissions
   * Optimizes performance by pre-loading popular user permissions
   */
  async warmPermissionCache(userIds: ReadonlyArray<EntityId>): Promise<{
    warmedCount: number;
    failedCount: number;
    totalTime: number;
  }> {
    const startTime = Date.now();
    let warmedCount = 0;
    let failedCount = 0;

    try {
      // Use Redis cache warming
      warmedCount = await this.redisCache.warmUserPermissionsCache(userIds);

      // Also warm local cache for immediate access
      for (const userId of userIds) {
        try {
          const cached = await this.redisCache.getUserPermissions(userId);
          if (cached) {
            const permissionStrings = cached.map(
              (p) => `${p.resource}:${p.action}`
            );
            this.cacheUserPermissions(userId, permissionStrings, []);
          }
        } catch (error) {
          failedCount++;
          console.warn(`Failed to warm local cache for user ${userId}:`, error);
        }
      }

      return {
        warmedCount,
        failedCount,
        totalTime: Date.now() - startTime,
      };
    } catch (error) {
      throw new ValidationError(
        `Cache warming failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Optimize permission queries with batch loading
   * Reduces database load by batching permission lookups
   */
  async batchLoadPermissions(
    userIds: ReadonlyArray<EntityId>,
    options?: {
      useCache?: boolean;
      cacheResults?: boolean;
    }
  ): Promise<Map<EntityId, ReadonlyArray<IEnhancedPermission>>> {
    const { useCache = true, cacheResults = true } = options || {};
    const results = new Map<EntityId, ReadonlyArray<IEnhancedPermission>>();
    const uncachedUserIds: EntityId[] = [];

    try {
      this.metrics.batchPermissionChecks++;

      // First, check cache for all requested users
      if (useCache) {
        for (const userId of userIds) {
          const cached = await this.redisCache.getUserPermissions(userId);
          if (cached) {
            results.set(userId, cached);
            this.metrics.cacheHits++;
          } else {
            uncachedUserIds.push(userId);
            this.metrics.cacheMisses++;
          }
        }
      } else {
        uncachedUserIds.push(...userIds);
      }

      // Batch load uncached permissions from database
      if (uncachedUserIds.length > 0) {
        for (const userId of uncachedUserIds) {
          const permissions = await this.getUserPermissionsFromDatabase(userId);
          results.set(userId, permissions);

          // Cache the results if enabled
          if (cacheResults) {
            await this.redisCache.cacheUserPermissions(userId, permissions);
            const permissionStrings = permissions.map(
              (p) => `${p.resource}:${p.action}`
            );
            this.cacheUserPermissions(userId, permissionStrings, []);
          }
        }
      }

      return results;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Batch permission loading failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get cache performance statistics
   */
  async getCacheStats(): Promise<{
    redis: {
      hitRate: number;
      missRate: number;
      totalEntries: number;
      memoryUsage: number;
      averageAccessTime: number;
    };
    local: {
      hitRate: number;
      missRate: number;
      userCacheSize: number;
      permissionCheckCacheSize: number;
      hierarchyCacheSize: number;
    };
  }> {
    const redisStats = await this.redisCache.getCacheStats();

    const localHitRate =
      this.metrics.cacheHits /
        (this.metrics.cacheHits + this.metrics.cacheMisses) || 0;
    const localMissRate =
      this.metrics.cacheMisses /
        (this.metrics.cacheHits + this.metrics.cacheMisses) || 0;

    return {
      redis: redisStats,
      local: {
        hitRate: localHitRate,
        missRate: localMissRate,
        userCacheSize: this.userPermissionCache.size,
        permissionCheckCacheSize: this.permissionCheckCache.size,
        hierarchyCacheSize: this.roleHierarchyCache.size,
      },
    };
  }

  /**
   * Health check with Redis cache status
   */
  async getHealth(): Promise<IServiceHealth> {
    try {
      const redisHealthy = await this.redisCache.healthCheck();
      const now = new Date().toISOString() as Timestamp;

      return {
        service: "PermissionServiceV2",
        status: redisHealthy ? "healthy" : "degraded",
        uptime: Date.now() - this.startTime,
        lastCheck: now,
        dependencies: [
          {
            name: "Redis Cache",
            status: redisHealthy ? "healthy" : "unhealthy",
            responseTime: 0, // Would be measured in production
            lastCheck: now,
            error: redisHealthy ? null : "Redis cache connection failed",
          },
          {
            name: "User Repository",
            status: "healthy", // Would check repository health
            responseTime: 0,
            lastCheck: now,
            error: null,
          },
          {
            name: "Role Repository",
            status: "healthy", // Would check repository health
            responseTime: 0,
            lastCheck: now,
            error: null,
          },
        ],
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
          totalUsers: await this.getUserCount(),
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
   * Get total user count from database
   */
  private async getUserCount(): Promise<number> {
    try {
      return await this.userRepository.count();
    } catch (error) {
      console.error("Failed to get user count:", error);
      return 0;
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
    try {
      // Get role data from repository
      const role = await this.roleRepository.findById(roleId);
      if (!role) {
        return null;
      }

      // Get permissions via transaction to ensure data consistency
      const enhancedPermissions = await this.getUserPermissionsFromDatabase(
        roleId
      );

      // Get role hierarchy info from database
      const hierarchy = await this.getRoleHierarchy(roleId);

      return {
        id: roleId,
        name: role.name,
        displayName: role.displayName,
        description: role.description || "",
        category: role.category,
        level: role.level,
        isActive: role.isActive,
        version: role.version,
        createdAt: role.createdAt.toISOString() as Timestamp,
        updatedAt: role.updatedAt.toISOString() as Timestamp,
        metadata: role.metadata
          ? JSON.parse(JSON.stringify(role.metadata))
          : null,
        parentRoleIds: role.parentRoleIds || [],
        childRoleIds: role.childRoleIds || [],
        computedPermissions: Object.freeze(enhancedPermissions),
        hierarchy: {
          level: role.level,
          parentRoles: (role.parentRoleIds || []).map(
            (id: any) => id as EntityId
          ),
          childRoles: (role.childRoleIds || []).map(
            (id: any) => id as EntityId
          ),
          inheritedPermissions: hierarchy.inheritedPermissions.map(
            (perm) => perm as EntityId
          ),
          effectivePermissions: [
            ...(role.parentRoleIds || []).map((id: any) => id as EntityId),
            roleId,
          ],
        },
      };
    } catch (error) {
      console.error(`Failed to build enhanced role ${roleId}:`, error);
      return null;
    }
  }

  private async evaluateContextPermission(
    userId: EntityId,
    resource: string,
    action: string,
    context: Record<string, unknown>,
    userPermissions: ReadonlyArray<string>
  ): Promise<boolean> {
    try {
      // Get user with enhanced permissions from database via transaction
      const enhancedPermissions = await this.getUserPermissionsFromDatabase(
        userId
      );

      // Filter permissions by resource and action
      const relevantPermissions = enhancedPermissions.filter(
        (perm) => perm.resource === resource && perm.action === action
      );

      if (relevantPermissions.length === 0) {
        return false;
      }

      // Evaluate context-specific permissions
      for (const permission of relevantPermissions) {
        if (permission.compiledConditions) {
          const conditions = permission.compiledConditions;

          // Time-based restrictions
          if (conditions.timeRestrictions) {
            const hour = new Date().getHours();
            const day = new Date().getDay();

            if (
              conditions.timeRestrictions.allowedHours &&
              !conditions.timeRestrictions.allowedHours.includes(hour)
            ) {
              continue;
            }
            if (
              conditions.timeRestrictions.allowedDays &&
              !conditions.timeRestrictions.allowedDays.includes(day)
            ) {
              continue;
            }
          }

          // IP-based restrictions
          if (conditions.ipRestrictions && context["ipAddress"]) {
            const ip = context["ipAddress"] as string;
            const allowed = conditions.ipRestrictions.some((range: string) => {
              if (range.includes("/")) {
                // CIDR notation support would be implemented here
                const baseIp = range.split("/")[0];
                return baseIp ? ip.startsWith(baseIp) : false;
              }
              return ip === range || ip.startsWith(range);
            });
            if (!allowed) {
              continue;
            }
          }

          // Context requirements
          if (conditions.contextRequirements) {
            const meetsRequirements = conditions.contextRequirements.every(
              (req: any) => {
                const contextValue = context[req.field];
                switch (req.operator) {
                  case "equals":
                    return contextValue === req.value;
                  case "contains":
                    return (
                      typeof contextValue === "string" &&
                      contextValue.includes(req.value)
                    );
                  case "in":
                    return (
                      Array.isArray(req.value) &&
                      req.value.includes(contextValue)
                    );
                  default:
                    return false;
                }
              }
            );
            if (!meetsRequirements) {
              continue;
            }
          }

          // If we reach here, all conditions are satisfied
          return true;
        }
      }

      // Check if user has base permission without conditions
      const basePermission = `${resource}:${action}`;
      return userPermissions.includes(basePermission);
    } catch (error) {
      console.error("Context permission evaluation failed:", error);
      return false;
    }
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

  /**
   * Helper method to get user permissions from database using repositories
   */
  private async getUserPermissionsFromDatabase(
    userId: EntityId
  ): Promise<IEnhancedPermission[]> {
    // Get user with roleId from repository
    const user = await this.userRepository.findById(userId);
    if (!user || !user.roleId) {
      return [];
    }

    // Query role permissions using raw database query since repository doesn't expose permissions
    // This is a temporary implementation - in production, we'd add a getRoleWithPermissions method to repository
    const repositoryFactory = getRepositoryFactory();
    const result = await repositoryFactory.executeInTransaction(
      async ({ userRepo }) => {
        // Access the underlying prisma client through repository transaction
        const prisma = (userRepo as any).prisma;

        const roleWithPermissions = await prisma.role.findUnique({
          where: { id: user.roleId },
          include: {
            permissions: true,
          },
        });

        if (!roleWithPermissions || !roleWithPermissions.permissions) {
          return [];
        }

        // Transform to enhanced permissions
        return roleWithPermissions.permissions.map(
          (permission: any): IEnhancedPermission => ({
            id: permission.id as EntityId,
            roleId: permission.roleId as EntityId,
            resource: permission.resource,
            action: permission.action,
            name: permission.name,
            description: permission.description || "",
            priority: permission.priority,
            version: permission.version,
            createdAt: permission.createdAt.toISOString() as Timestamp,
            updatedAt: permission.updatedAt.toISOString() as Timestamp,
            compiledConditions: permission.conditions
              ? JSON.parse(JSON.stringify(permission.conditions))
              : {},
            scope: {
              resourceType: permission.resource,
              resourceIds: [],
              actions: [permission.action],
              filters: [],
            } as IPermissionScope,
          })
        );
      }
    );

    return result;
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
