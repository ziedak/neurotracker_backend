/**
 * @fileoverview RBAC Core Types - Enterprise RBAC type definitions
 * @module rbac/types
 * @version 1.0.0
 * @description Type definitions extracted from PermissionServiceV2 with existing infrastructure integration
 */

import type { Role, RolePermission } from "@libs/models";

/**
 * Core Entity ID type (from existing implementation)
 */
export type EntityId = string;

/**
 * Timestamp type (from existing implementation)
 */
export type Timestamp = Date;

/**
 * Permission check result with caching metadata
 */
export interface IPermissionCheckResult {
  readonly result: boolean;
  readonly reason: string;
  readonly cachedAt: Date;
  readonly ttl: number;
}

/**
 * Permission context for conditional permissions
 */
export interface IPermissionContext {
  ipAddress?: string;
  timeRange?: {
    start: Date;
    end: Date;
  };
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Permission scope for advanced permission filtering
 */
export interface IPermissionScope {
  resource?: string;
  action?: string;
  conditions?: Record<string, unknown>;
}

/**
 * Enhanced Role interface (extends database Role with runtime data)
 */
export interface IEnhancedRole extends Omit<Role, "permissions"> {
  permissions: ReadonlyArray<IEnhancedPermission>;
  effectivePermissions?: ReadonlyArray<string>;
  hierarchyLevel?: number;
  inheritedFrom?: ReadonlyArray<EntityId>;
}

/**
 * Enhanced Permission interface (extends database RolePermission with runtime data)
 */
export interface IEnhancedPermission extends RolePermission {
  fullPermissionString: string; // resource:action format
  isInherited: boolean;
  inheritedFromRole?: EntityId;
  priority: "low" | "medium" | "high" | "critical";
  contextConditions?: IPermissionContext;
}

/**
 * Role hierarchy information
 */
export interface IRoleHierarchy {
  roleId: EntityId;
  parentRoles: ReadonlyArray<EntityId>;
  childRoles: ReadonlyArray<EntityId>;
  depth: number;
  path: ReadonlyArray<EntityId>;
}

/**
 * Role hierarchy info for hierarchy resolution
 */
export interface IRoleHierarchyInfo {
  roles: ReadonlyMap<EntityId, IRoleHierarchy>;
  maxDepth: number;
  totalRoles: number;
  lastUpdated: Date;
}

/**
 * User permission cache entry
 */
export interface IUserPermissionCacheEntry {
  permissions: ReadonlyArray<string>;
  roles: ReadonlyArray<IEnhancedRole>;
  cachedAt: Date;
  ttl: number;
}

/**
 * Role hierarchy cache entry
 */
export interface IRoleHierarchyCacheEntry {
  hierarchy: IRoleHierarchyInfo;
  cachedAt: Date;
  ttl: number;
}

/**
 * Permission metrics for performance tracking
 */
export interface IPermissionMetrics {
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
 * Permission analytics data
 */
export interface IPermissionAnalytics {
  totalPermissionChecks: number;
  uniqueUsers: number;
  topPermissions: ReadonlyArray<{
    permission: string;
    count: number;
  }>;
  cacheHitRate: number;
  averageResponseTime: number;
  errorRate: number;
}

/**
 * Batch operation result
 */
export interface IBatchOperationResult<T> {
  results: ReadonlyArray<T>;
  successful: number;
  failed: number;
  errors: ReadonlyArray<{
    index: number;
    error: string;
  }>;
}

/**
 * Permission check interface for batch operations
 */
export interface IPermissionCheck {
  userId: EntityId;
  resource: string;
  action: string;
  context?: IPermissionContext;
}

/**
 * Batch permission check result
 */
export interface IBatchPermissionResult {
  userId: EntityId;
  resource: string;
  action: string;
  granted: boolean;
  reason: string;
  cached: boolean;
}

/**
 * Service health status
 */
export interface IServiceHealth {
  service: string;
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  lastCheck: Date;
  metrics: {
    cacheHitRate: number;
    averageResponseTime: number;
    totalOperations: number;
    errorRate: number;
  };
  dependencies: {
    database: "healthy" | "unhealthy";
    redis: "healthy" | "unhealthy";
  };
}

/**
 * RBAC Configuration
 */
export interface IRBACConfig {
  cache: {
    defaultTtl: number;
    permissionCheckTtl: number;
    hierarchyTtl: number;
    maxSize: number;
    cleanupThreshold: number;
  };
  permissions: {
    enableWildcards: boolean;
    enableInheritance: boolean;
    maxHierarchyDepth: number;
  };
  analytics: {
    enabled: boolean;
    retentionDays: number;
  };
  maintenance: {
    enabled: boolean;
    intervalMs: number;
  };
}

/**
 * Default RBAC configuration
 */
export const DEFAULT_RBAC_CONFIG: IRBACConfig = {
  cache: {
    defaultTtl: 5 * 60 * 1000, // 5 minutes
    permissionCheckTtl: 2 * 60 * 1000, // 2 minutes
    hierarchyTtl: 10 * 60 * 1000, // 10 minutes
    maxSize: 50000,
    cleanupThreshold: 0.8,
  },
  permissions: {
    enableWildcards: true,
    enableInheritance: true,
    maxHierarchyDepth: 10,
  },
  analytics: {
    enabled: true,
    retentionDays: 30,
  },
  maintenance: {
    enabled: true,
    intervalMs: 10 * 60 * 1000, // 10 minutes
  },
};
