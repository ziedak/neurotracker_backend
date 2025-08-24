/**
 * @fileoverview RBAC Service Contracts - Interface definitions for RBAC services
 * @module rbac/contracts
 * @version 1.0.0
 * @description Service interfaces extracted from PermissionServiceV2 with enterprise features
 */

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
} from "../types/core";

/**
 * Core RBAC Service Interface
 *
 * Main interface for enterprise RBAC operations with all features from PermissionServiceV2
 */
export interface IRBACService {
  /**
   * Check if user has permission with optional context
   */
  hasPermission(
    userId: EntityId,
    resource: string,
    action: string,
    context?: IPermissionContext
  ): Promise<boolean>;

  /**
   * Check multiple permissions for a user (batch operation)
   */
  hasPermissions(
    userId: EntityId,
    permissions: ReadonlyArray<IPermissionCheck>
  ): Promise<ReadonlyArray<IBatchPermissionResult>>;

  /**
   * Batch permission check for multiple users
   */
  batchPermissionCheck(
    checks: ReadonlyArray<IPermissionCheck>
  ): Promise<IBatchOperationResult<IBatchPermissionResult>>;

  /**
   * Get all permissions for a user (resolved with inheritance)
   */
  getUserPermissions(
    userId: EntityId
  ): Promise<ReadonlyArray<IEnhancedPermission>>;

  /**
   * Get all roles assigned to a user
   */
  getUserRoles(userId: EntityId): Promise<ReadonlyArray<IEnhancedRole>>;

  /**
   * Resolve effective permissions for user (flat list)
   */
  resolvePermissions(userId: EntityId): Promise<ReadonlyArray<string>>;

  /**
   * Assign role to user with audit tracking
   */
  assignRole(
    userId: EntityId,
    roleId: EntityId,
    assignedBy?: EntityId
  ): Promise<boolean>;

  /**
   * Remove role from user with audit tracking
   */
  removeRole(
    userId: EntityId,
    roleId: EntityId,
    removedBy?: EntityId
  ): Promise<boolean>;

  /**
   * Get role hierarchy information
   */
  getRoleHierarchy(roleId: EntityId): Promise<IRoleHierarchyInfo>;

  /**
   * Get full role hierarchy for the system
   */
  getFullRoleHierarchy(): Promise<IRoleHierarchyInfo>;

  /**
   * Refresh role hierarchy cache
   */
  refreshRoleHierarchy(): Promise<void>;

  // Cache Management Methods

  /**
   * Cache permission check result
   */
  cachePermissionResult(
    userId: EntityId,
    resource: string,
    action: string,
    result: boolean,
    reason: string
  ): Promise<void>;

  /**
   * Clear all cached data for a user
   */
  clearUserCache(userId: EntityId): Promise<void>;

  /**
   * Clear permission cache for specific permission
   */
  clearPermissionCache(
    userId: EntityId,
    resource: string,
    action: string
  ): Promise<void>;

  /**
   * Warm cache for frequently accessed users
   */
  warmCache(userIds: ReadonlyArray<EntityId>): Promise<void>;

  // Analytics and Monitoring Methods

  /**
   * Get permission usage analytics
   */
  getPermissionAnalytics(
    userId?: EntityId,
    days?: number
  ): Promise<IPermissionAnalytics>;

  /**
   * Track permission check for analytics
   */
  trackPermissionCheck(
    userId: EntityId,
    permission: string,
    granted: boolean
  ): void;

  /**
   * Get service health status
   */
  getHealthStatus(): Promise<IServiceHealth>;

  /**
   * Get cache statistics
   */
  getCacheStats(): Promise<{
    userPermissionCache: {
      size: number;
      hitRate: number;
      missRate: number;
    };
    permissionCheckCache: {
      size: number;
      hitRate: number;
      missRate: number;
    };
    roleHierarchyCache: {
      size: number;
      hitRate: number;
      missRate: number;
    };
  }>;

  // Background Maintenance Methods

  /**
   * Start background cache maintenance job
   */
  startMaintenanceJob(): void;

  /**
   * Stop background cache maintenance job
   */
  stopMaintenanceJob(): void;

  /**
   * Run cache cleanup manually
   */
  runCacheCleanup(): Promise<void>;

  /**
   * Get service configuration
   */
  getConfig(): IRBACConfig;

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<IRBACConfig>): Promise<void>;
}

/**
 * RBAC Cache Service Interface
 *
 * Specialized caching interface for RBAC operations
 */
export interface IRBACCacheService {
  /**
   * Get cached permission check result
   */
  getPermissionCheck(
    userId: EntityId,
    resource: string,
    action: string,
    context?: IPermissionContext
  ): Promise<boolean | null>;

  /**
   * Cache permission check result
   */
  setPermissionCheck(
    userId: EntityId,
    resource: string,
    action: string,
    result: boolean,
    ttlSeconds?: number,
    context?: IPermissionContext
  ): Promise<void>;

  /**
   * Get cached user permissions
   */
  getUserPermissions(userId: EntityId): Promise<ReadonlyArray<string> | null>;

  /**
   * Cache user permissions
   */
  setUserPermissions(
    userId: EntityId,
    permissions: ReadonlyArray<string>,
    ttlSeconds?: number
  ): Promise<void>;

  /**
   * Get cached role hierarchy
   */
  getRoleHierarchy(): Promise<IRoleHierarchyInfo | null>;

  /**
   * Cache role hierarchy
   */
  setRoleHierarchy(
    hierarchy: IRoleHierarchyInfo,
    ttlSeconds?: number
  ): Promise<void>;

  /**
   * Invalidate user cache
   */
  invalidateUser(userId: EntityId): Promise<void>;

  /**
   * Invalidate role cache
   */
  invalidateRole(roleId: EntityId): Promise<void>;

  /**
   * Invalidate permission cache
   */
  invalidatePermission(resource: string, action: string): Promise<void>;

  /**
   * Get cache health status
   */
  getHealthStatus(): Promise<IServiceHealth>;
}

/**
 * RBAC Repository Interface
 *
 * Data access interface for RBAC operations using existing repositories
 */
export interface IRBACRepository {
  /**
   * Find user with roles and permissions
   */
  findUserWithRoles(userId: EntityId): Promise<{
    user: any; // Use existing User type from database
    roles: ReadonlyArray<IEnhancedRole>;
  } | null>;

  /**
   * Find role with permissions and hierarchy
   */
  findRoleWithHierarchy(roleId: EntityId): Promise<IEnhancedRole | null>;

  /**
   * Get all roles in hierarchy order
   */
  getAllRolesHierarchy(): Promise<ReadonlyArray<IEnhancedRole>>;

  /**
   * Assign role to user
   */
  assignUserRole(
    userId: EntityId,
    roleId: EntityId,
    assignedBy?: EntityId
  ): Promise<boolean>;

  /**
   * Remove role from user
   */
  removeUserRole(
    userId: EntityId,
    roleId: EntityId,
    removedBy?: EntityId
  ): Promise<boolean>;

  /**
   * Get user role assignments with audit info
   */
  getUserRoleAssignments(userId: EntityId): Promise<
    ReadonlyArray<{
      role: IEnhancedRole;
      assignedAt: Date;
      assignedBy?: EntityId;
      expiresAt?: Date;
    }>
  >;
}

/**
 * RBAC Factory Interface
 *
 * Factory interface for creating RBAC service instances
 */
export interface IRBACFactory {
  /**
   * Create default RBAC service instance
   */
  createDefault(): Promise<IRBACService>;

  /**
   * Create RBAC service with custom configuration
   */
  create(config: IRBACConfig): Promise<IRBACService>;

  /**
   * Create high-performance RBAC service
   */
  createHighPerformance(): Promise<IRBACService>;

  /**
   * Create security-focused RBAC service
   */
  createSecurityFocused(): Promise<IRBACService>;

  /**
   * Create RBAC service for testing
   */
  createForTesting(): Promise<IRBACService>;
}
