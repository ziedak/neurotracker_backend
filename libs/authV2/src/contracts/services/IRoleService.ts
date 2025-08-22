/**
 * @fileoverview Role service contract for comprehensive role management
 * @module contracts/services/IRoleService
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId } from "../../types/core";
import type {
  IEnhancedRole,
  IBatchOperationResult,
  IServiceHealth,
} from "../../types/enhanced";

/**
 * Role assignment data for user-role associations
 */
export interface IRoleAssignmentData {
  readonly userId: EntityId;
  readonly roleId: EntityId;
  readonly assignedBy: EntityId;
  readonly expiresAt?: Date;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Role creation data for new roles
 */
export interface IRoleCreateData {
  readonly name: string;
  readonly description: string;
  readonly permissions: ReadonlyArray<string>;
  readonly parentRoleId?: EntityId;
  readonly isSystemRole?: boolean;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Role update data for role modifications
 */
export interface IRoleUpdateData {
  readonly name?: string;
  readonly description?: string;
  readonly permissions?: ReadonlyArray<string>;
  readonly parentRoleId?: EntityId;
  readonly isActive?: boolean;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Role hierarchy information
 */
export interface IRoleHierarchy {
  readonly roleId: EntityId;
  readonly name: string;
  readonly level: number;
  readonly parentRoles: ReadonlyArray<IEnhancedRole>;
  readonly childRoles: ReadonlyArray<IEnhancedRole>;
  readonly allDescendants: ReadonlyArray<IEnhancedRole>;
  readonly allAncestors: ReadonlyArray<IEnhancedRole>;
}

/**
 * User role assignment result
 */
export interface IUserRoleAssignment {
  readonly userId: EntityId;
  readonly role: IEnhancedRole;
  readonly assignedAt: Date;
  readonly assignedBy: EntityId;
  readonly expiresAt?: Date;
  readonly isActive: boolean;
  readonly source: "direct" | "inherited" | "default";
}

/**
 * Role analytics data
 */
export interface IRoleAnalytics {
  readonly roleId: EntityId;
  readonly roleName: string;
  readonly totalUsers: number;
  readonly activeUsers: number;
  readonly recentAssignments: number;
  readonly permissionUsage: ReadonlyArray<{
    permission: string;
    usageCount: number;
    lastUsed: Date;
  }>;
  readonly hierarchyPosition: {
    level: number;
    childCount: number;
    descendantCount: number;
  };
}

/**
 * Role validation result
 */
export interface IRoleValidationResult {
  readonly isValid: boolean;
  readonly role: IEnhancedRole | null;
  readonly effectivePermissions: ReadonlyArray<string>;
  readonly inheritedFromRoles: ReadonlyArray<EntityId>;
  readonly conflicts: ReadonlyArray<{
    type: "permission_conflict" | "hierarchy_loop" | "invalid_parent";
    description: string;
    severity: "low" | "medium" | "high";
  }>;
}

/**
 * Enterprise role service contract
 */
export interface IRoleService {
  /**
   * Create new role
   */
  create(roleData: IRoleCreateData): Promise<IEnhancedRole>;

  /**
   * Find role by ID
   */
  findById(roleId: EntityId): Promise<IEnhancedRole | null>;

  /**
   * Find role by name
   */
  findByName(name: string): Promise<IEnhancedRole | null>;

  /**
   * Find roles by IDs (batch operation)
   */
  findByIds(
    roleIds: ReadonlyArray<EntityId>
  ): Promise<IBatchOperationResult<IEnhancedRole>>;

  /**
   * Get all roles with pagination
   */
  findAll(
    limit?: number,
    offset?: number
  ): Promise<{
    roles: ReadonlyArray<IEnhancedRole>;
    total: number;
    hasMore: boolean;
  }>;

  /**
   * Update role information
   */
  update(roleId: EntityId, updateData: IRoleUpdateData): Promise<IEnhancedRole>;

  /**
   * Delete role (soft delete)
   */
  delete(roleId: EntityId): Promise<boolean>;

  /**
   * Get user roles with inheritance
   */
  getUserRoles(userId: EntityId): Promise<ReadonlyArray<IUserRoleAssignment>>;

  /**
   * Get direct user roles (no inheritance)
   */
  getDirectUserRoles(
    userId: EntityId
  ): Promise<ReadonlyArray<IUserRoleAssignment>>;

  /**
   * Get effective roles (direct + inherited)
   */
  getEffectiveUserRoles(
    userId: EntityId
  ): Promise<ReadonlyArray<IUserRoleAssignment>>;

  /**
   * Assign role to user
   */
  assignRoleToUser(
    userId: EntityId,
    roleId: EntityId,
    assignedBy: EntityId,
    options?: {
      expiresAt?: Date;
      metadata?: Record<string, unknown>;
    }
  ): Promise<IUserRoleAssignment>;

  /**
   * Remove role from user
   */
  removeRoleFromUser(
    userId: EntityId,
    roleId: EntityId,
    removedBy: EntityId,
    reason?: string
  ): Promise<boolean>;

  /**
   * Batch assign roles to user
   */
  assignRolesToUser(
    userId: EntityId,
    roleIds: ReadonlyArray<EntityId>,
    assignedBy: EntityId
  ): Promise<IBatchOperationResult<IUserRoleAssignment>>;

  /**
   * Batch remove roles from user
   */
  removeRolesFromUser(
    userId: EntityId,
    roleIds: ReadonlyArray<EntityId>,
    removedBy: EntityId
  ): Promise<IBatchOperationResult<boolean>>;

  /**
   * Get role hierarchy information
   */
  getRoleHierarchy(roleId: EntityId): Promise<IRoleHierarchy>;

  /**
   * Get role permissions (direct + inherited)
   */
  getRolePermissions(roleId: EntityId): Promise<ReadonlyArray<string>>;

  /**
   * Get direct role permissions
   */
  getDirectRolePermissions(roleId: EntityId): Promise<ReadonlyArray<string>>;

  /**
   * Check if user has role
   */
  userHasRole(userId: EntityId, roleId: EntityId): Promise<boolean>;

  /**
   * Check if user has any of the roles
   */
  userHasAnyRole(
    userId: EntityId,
    roleIds: ReadonlyArray<EntityId>
  ): Promise<boolean>;

  /**
   * Check if user has all of the roles
   */
  userHasAllRoles(
    userId: EntityId,
    roleIds: ReadonlyArray<EntityId>
  ): Promise<boolean>;

  /**
   * Get users with role
   */
  getUsersWithRole(
    roleId: EntityId,
    includeInherited?: boolean
  ): Promise<ReadonlyArray<EntityId>>;

  /**
   * Validate role configuration
   */
  validateRole(roleId: EntityId): Promise<IRoleValidationResult>;

  /**
   * Get role analytics
   */
  getRoleAnalytics(roleId: EntityId): Promise<IRoleAnalytics>;

  /**
   * Get system role analytics
   */
  getSystemRoleAnalytics(): Promise<ReadonlyArray<IRoleAnalytics>>;

  /**
   * Clear role cache for user
   */
  clearUserRoleCache(userId: EntityId): Promise<void>;

  /**
   * Clear all role cache
   */
  clearRoleCache(): Promise<void>;

  /**
   * Warm cache with frequently accessed roles
   */
  warmCache(roleIds: ReadonlyArray<EntityId>): Promise<void>;

  /**
   * Health check
   */
  getHealth(): Promise<IServiceHealth>;
}
