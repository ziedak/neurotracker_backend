/**
 * @fileoverview Role service implementation for comprehensive role management
 * @module services/auth/RoleService
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, Role, TenantContext } from "../types/core";
import { createTimestamp } from "../types/core";
import type {
  IEnhancedRole,
  IBatchOperationResult,
  IServiceHealth,
} from "../types/enhanced";

import type {
  IRoleService,
  IRoleCreateData,
  IRoleUpdateData,
  IRoleHierarchy,
  IUserRoleAssignment,
  IRoleAnalytics,
  IRoleValidationResult,
} from "../contracts/services/IRoleService";

import type { ICacheService } from "../contracts/services";
import {
  RoleRepository,
  CreateRoleInput,
  UpdateRoleInput,
} from "../repositories/RoleRepository";

/**
 * Cache prefixes for role-related data
 */
const CACHE_PREFIXES = {
  ROLE: "role:",
  USER_ROLES: "user_roles:",
  ROLE_PERMISSIONS: "role_permissions:",
  ROLE_HIERARCHY: "role_hierarchy:",
  ROLE_USERS: "role_users:",
} as const;

/**
 * Cache TTL configurations (in seconds)
 */
const CACHE_TTL = {
  ROLE: 300, // 5 minutes
  USER_ROLES: 180, // 3 minutes
  PERMISSIONS: 600, // 10 minutes
  HIERARCHY: 900, // 15 minutes
} as const;

/**
 * Enterprise role service implementation using RoleRepository
 */
export class RoleService implements IRoleService {
  private readonly cacheService: ICacheService;
  private readonly roleRepository: RoleRepository;
  private readonly tenantContext: TenantContext | undefined;

  constructor(
    cacheService: ICacheService,
    roleRepository: RoleRepository,
    tenantContext?: TenantContext
  ) {
    this.cacheService = cacheService;
    this.roleRepository = roleRepository;
    this.tenantContext = tenantContext;
  }

  /**
   * Create new role
   */
  async create(roleData: IRoleCreateData): Promise<IEnhancedRole> {
    const createInput: CreateRoleInput = {
      name: roleData.name,
      displayName: roleData.name,
      description: roleData.description,
      category: "functional",
      level: 5,
      isActive: true,
      version: "1.0.0",
      parentRoleIds: roleData.parentRoleId ? [roleData.parentRoleId] : [],
      childRoleIds: [],
      metadata: roleData.metadata || null,
    };

    const role = await this.roleRepository.create(
      createInput,
      this.tenantContext
    );

    // Convert Role to IEnhancedRole
    const enhancedRole = this.convertRoleToEnhanced(role);

    // Cache the new role
    await this.cacheService.set(
      `${CACHE_PREFIXES.ROLE}${role.id}`,
      enhancedRole,
      CACHE_TTL.ROLE
    );

    return enhancedRole;
  }

  /**
   * Find role by ID
   */
  async findById(roleId: EntityId): Promise<IEnhancedRole | null> {
    // Try cache first
    const cacheKey = `${CACHE_PREFIXES.ROLE}${roleId}`;
    const cachedRole = await this.cacheService.get<IEnhancedRole>(cacheKey);

    if (cachedRole) {
      return cachedRole;
    }

    const role = await this.roleRepository.findById(roleId, this.tenantContext);
    if (!role) {
      return null;
    }

    const enhancedRole = this.convertRoleToEnhanced(role);

    // Cache the result
    await this.cacheService.set(cacheKey, enhancedRole, CACHE_TTL.ROLE);

    return enhancedRole;
  }

  /**
   * Find role by name
   */
  async findByName(name: string): Promise<IEnhancedRole | null> {
    const role = await this.roleRepository.findByName(name, this.tenantContext);
    if (!role) {
      return null;
    }

    return this.convertRoleToEnhanced(role);
  }

  /**
   * Find roles by IDs (batch operation)
   */
  async findByIds(
    roleIds: ReadonlyArray<EntityId>
  ): Promise<IBatchOperationResult<IEnhancedRole>> {
    const successful: IEnhancedRole[] = [];
    const failed: Array<{ id: string; error: any; input: unknown }> = [];

    for (const roleId of roleIds) {
      try {
        const role = await this.findById(roleId);
        if (role) {
          successful.push(role);
        } else {
          failed.push({
            id: roleId,
            error: { type: "NOT_FOUND", message: "Role not found" },
            input: roleId,
          });
        }
      } catch (error) {
        failed.push({
          id: roleId,
          error: {
            type: "ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
          input: roleId,
        });
      }
    }

    return {
      successful,
      failed,
      totalProcessed: roleIds.length,
      processingTime: 0, // TODO: Add actual timing
      timestamp: createTimestamp(new Date()),
    };
  }

  /**
   * Get all roles with pagination
   */
  async findAll(
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    roles: ReadonlyArray<IEnhancedRole>;
    total: number;
    hasMore: boolean;
  }> {
    const roles = await this.roleRepository.findMany(
      {
        skip: offset,
        take: limit,
        orderBy: [{ field: "name", direction: "asc" }],
      },
      this.tenantContext
    );

    const total = await this.roleRepository.count({}, this.tenantContext);

    const enhancedRoles = roles.map((role) => this.convertRoleToEnhanced(role));

    return {
      roles: enhancedRoles,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Update role information
   */
  async update(
    roleId: EntityId,
    updateData: IRoleUpdateData
  ): Promise<IEnhancedRole> {
    const updateInput: UpdateRoleInput = {
      ...(updateData.name && { name: updateData.name }),
      ...(updateData.name && { displayName: updateData.name }),
      ...(updateData.description !== undefined && {
        description: updateData.description,
      }),
      ...(updateData.isActive !== undefined && {
        isActive: updateData.isActive,
      }),
      ...(updateData.metadata !== undefined && {
        metadata: updateData.metadata,
      }),
    };

    const updatedRole = await this.roleRepository.update(
      roleId,
      updateInput,
      this.tenantContext
    );
    const enhancedRole = this.convertRoleToEnhanced(updatedRole);

    // Update cache
    await this.cacheService.set(
      `${CACHE_PREFIXES.ROLE}${roleId}`,
      enhancedRole,
      CACHE_TTL.ROLE
    );

    // Clear related caches
    await this.clearRoleDependentCaches(roleId);

    return enhancedRole;
  }

  /**
   * Delete role (soft delete)
   */
  async delete(roleId: EntityId): Promise<boolean> {
    const success = await this.roleRepository.delete(
      roleId,
      this.tenantContext
    );

    if (success) {
      // Clear caches
      await this.clearRoleDependentCaches(roleId);
    }

    return success;
  }

  /**
   * Get user roles with inheritance
   */
  async getUserRoles(
    userId: EntityId
  ): Promise<ReadonlyArray<IUserRoleAssignment>> {
    const cacheKey = `${CACHE_PREFIXES.USER_ROLES}${userId}`;
    const cachedRoles = await this.cacheService.get<
      ReadonlyArray<IUserRoleAssignment>
    >(cacheKey);

    if (cachedRoles) {
      return cachedRoles;
    }

    // TODO: Implement actual user role lookup from database
    // For now, return default user role
    const defaultRole = await this.findByName("user");
    if (!defaultRole) {
      return [];
    }

    const assignment: IUserRoleAssignment = {
      userId,
      role: defaultRole,
      assignedAt: new Date(),
      assignedBy: "system" as EntityId,
      isActive: true,
      source: "default",
    };

    const roles = [assignment];

    // Cache the result
    await this.cacheService.set(cacheKey, roles, CACHE_TTL.USER_ROLES);

    return roles;
  }

  /**
   * Get direct user roles (no inheritance)
   */
  async getDirectUserRoles(
    userId: EntityId
  ): Promise<ReadonlyArray<IUserRoleAssignment>> {
    // For now, same as getUserRoles since we don't have inheritance implemented
    return this.getUserRoles(userId);
  }

  /**
   * Get effective roles (direct + inherited)
   */
  async getEffectiveUserRoles(
    userId: EntityId
  ): Promise<ReadonlyArray<IUserRoleAssignment>> {
    // For now, same as getUserRoles
    return this.getUserRoles(userId);
  }

  /**
   * Assign role to user
   */
  async assignRoleToUser(
    userId: EntityId,
    roleId: EntityId,
    assignedBy: EntityId,
    options?: {
      expiresAt?: Date;
      metadata?: Record<string, unknown>;
    }
  ): Promise<IUserRoleAssignment> {
    const role = await this.findById(roleId);
    if (!role) {
      throw new Error(`Role with ID ${roleId} not found`);
    }

    const assignment: IUserRoleAssignment = {
      userId,
      role,
      assignedAt: new Date(),
      assignedBy,
      ...(options?.expiresAt && { expiresAt: options.expiresAt }),
      isActive: true,
      source: "direct",
    };

    // Clear user roles cache
    await this.cacheService.delete(`${CACHE_PREFIXES.USER_ROLES}${userId}`);

    // TODO: Persist assignment to database
    console.log("Role assigned (mock):", assignment);

    return assignment;
  }

  /**
   * Remove role from user
   */
  async removeRoleFromUser(
    userId: EntityId,
    roleId: EntityId,
    removedBy: EntityId,
    reason?: string
  ): Promise<boolean> {
    // Clear user roles cache
    await this.cacheService.delete(`${CACHE_PREFIXES.USER_ROLES}${userId}`);

    // TODO: Remove assignment from database
    console.log("Role removed (mock):", { userId, roleId, removedBy, reason });

    return true;
  }

  /**
   * Batch assign roles to user
   */
  async assignRolesToUser(
    userId: EntityId,
    roleIds: ReadonlyArray<EntityId>,
    assignedBy: EntityId
  ): Promise<IBatchOperationResult<IUserRoleAssignment>> {
    const successful: IUserRoleAssignment[] = [];
    const failed: Array<{ id: string; error: any; input: unknown }> = [];

    for (const roleId of roleIds) {
      try {
        const assignment = await this.assignRoleToUser(
          userId,
          roleId,
          assignedBy
        );
        successful.push(assignment);
      } catch (error) {
        failed.push({
          id: roleId,
          error: {
            type: "ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
          input: { userId, roleId, assignedBy },
        });
      }
    }

    return {
      successful,
      failed,
      totalProcessed: roleIds.length,
      processingTime: 0,
      timestamp: createTimestamp(new Date()),
    };
  }

  /**
   * Batch remove roles from user
   */
  async removeRolesFromUser(
    userId: EntityId,
    roleIds: ReadonlyArray<EntityId>,
    removedBy: EntityId
  ): Promise<IBatchOperationResult<boolean>> {
    const successful: boolean[] = [];
    const failed: Array<{ id: string; error: any; input: unknown }> = [];

    for (const roleId of roleIds) {
      try {
        const removed = await this.removeRoleFromUser(
          userId,
          roleId,
          removedBy
        );
        successful.push(removed);
      } catch (error) {
        failed.push({
          id: roleId,
          error: {
            type: "ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
          input: { userId, roleId, removedBy },
        });
        successful.push(false);
      }
    }

    return {
      successful,
      failed,
      totalProcessed: roleIds.length,
      processingTime: 0,
      timestamp: createTimestamp(new Date()),
    };
  }

  /**
   * Get role hierarchy information
   */
  async getRoleHierarchy(roleId: EntityId): Promise<IRoleHierarchy> {
    const cacheKey = `${CACHE_PREFIXES.ROLE_HIERARCHY}${roleId}`;
    const cachedHierarchy = await this.cacheService.get<IRoleHierarchy>(
      cacheKey
    );

    if (cachedHierarchy) {
      return cachedHierarchy;
    }

    const hierarchyData = await this.roleRepository.getRoleHierarchy(
      roleId,
      this.tenantContext
    );

    const hierarchy: IRoleHierarchy = {
      roleId,
      name: hierarchyData.role.name,
      level: hierarchyData.role.level,
      parentRoles: hierarchyData.parents.map((p) =>
        this.convertRoleToEnhanced(p)
      ),
      childRoles: hierarchyData.children.map((c) =>
        this.convertRoleToEnhanced(c)
      ),
      allDescendants: hierarchyData.allDescendants.map((d) =>
        this.convertRoleToEnhanced(d)
      ),
      allAncestors: [], // TODO: Implement ancestor lookup
    };

    // Cache the result
    await this.cacheService.set(cacheKey, hierarchy, CACHE_TTL.HIERARCHY);

    return hierarchy;
  }

  /**
   * Get role permissions (direct + inherited)
   */
  async getRolePermissions(roleId: EntityId): Promise<ReadonlyArray<string>> {
    const cacheKey = `${CACHE_PREFIXES.ROLE_PERMISSIONS}${roleId}`;
    const cachedPermissions = await this.cacheService.get<
      ReadonlyArray<string>
    >(cacheKey);

    if (cachedPermissions) {
      return cachedPermissions;
    }

    const role = await this.findById(roleId);
    if (!role) {
      return [];
    }

    // Extract permissions from computedPermissions
    const permissions = role.computedPermissions.map(
      (p) => `${p.resource}:${p.action}`
    );

    // Cache the result
    await this.cacheService.set(cacheKey, permissions, CACHE_TTL.PERMISSIONS);

    return permissions;
  }

  /**
   * Get direct role permissions
   */
  async getDirectRolePermissions(
    roleId: EntityId
  ): Promise<ReadonlyArray<string>> {
    return this.getRolePermissions(roleId); // For now, same implementation
  }

  /**
   * Check if user has role
   */
  async userHasRole(userId: EntityId, roleId: EntityId): Promise<boolean> {
    const userRoles = await this.getUserRoles(userId);
    return userRoles.some(
      (assignment) => assignment.role.id === roleId && assignment.isActive
    );
  }

  /**
   * Check if user has any of the roles
   */
  async userHasAnyRole(
    userId: EntityId,
    roleIds: ReadonlyArray<EntityId>
  ): Promise<boolean> {
    const userRoles = await this.getUserRoles(userId);
    const userRoleIds = new Set(
      userRoles.filter((a) => a.isActive).map((a) => a.role.id)
    );

    return roleIds.some((roleId) => userRoleIds.has(roleId));
  }

  /**
   * Check if user has all of the roles
   */
  async userHasAllRoles(
    userId: EntityId,
    roleIds: ReadonlyArray<EntityId>
  ): Promise<boolean> {
    const userRoles = await this.getUserRoles(userId);
    const userRoleIds = new Set(
      userRoles.filter((a) => a.isActive).map((a) => a.role.id)
    );

    return roleIds.every((roleId) => userRoleIds.has(roleId));
  }

  /**
   * Get users with role
   */
  async getUsersWithRole(
    roleId: EntityId,
    includeInherited: boolean = false
  ): Promise<ReadonlyArray<EntityId>> {
    const cacheKey = `${CACHE_PREFIXES.ROLE_USERS}${roleId}:${includeInherited}`;
    const cachedUsers = await this.cacheService.get<ReadonlyArray<EntityId>>(
      cacheKey
    );

    if (cachedUsers) {
      return cachedUsers;
    }

    // TODO: Replace with actual database query
    const users: EntityId[] = [];

    // Cache the result
    await this.cacheService.set(cacheKey, users, CACHE_TTL.USER_ROLES);

    return users;
  }

  /**
   * Validate role configuration
   */
  async validateRole(roleId: EntityId): Promise<IRoleValidationResult> {
    const role = await this.findById(roleId);

    if (!role) {
      return {
        isValid: false,
        role: null,
        effectivePermissions: [],
        inheritedFromRoles: [],
        conflicts: [
          {
            type: "invalid_parent",
            description: "Role not found",
            severity: "high",
          },
        ],
      };
    }

    const effectivePermissions = await this.getRolePermissions(roleId);

    return {
      isValid: true,
      role,
      effectivePermissions,
      inheritedFromRoles: [], // TODO: Implement inheritance tracking
      conflicts: [], // TODO: Implement conflict detection
    };
  }

  /**
   * Get role analytics
   */
  async getRoleAnalytics(roleId: EntityId): Promise<IRoleAnalytics> {
    const role = await this.findById(roleId);
    if (!role) {
      throw new Error(`Role with ID ${roleId} not found`);
    }

    // Mock analytics data
    return {
      roleId,
      roleName: role.name,
      totalUsers: 0,
      activeUsers: 0,
      recentAssignments: 0,
      permissionUsage: role.computedPermissions.map((permission) => ({
        permission: `${permission.resource}:${permission.action}`,
        usageCount: Math.floor(Math.random() * 100),
        lastUsed: new Date(),
      })),
      hierarchyPosition: {
        level: role.hierarchy.level,
        childCount: role.hierarchy.childRoles.length,
        descendantCount: 0, // TODO: Calculate descendants
      },
    };
  }

  /**
   * Get system role analytics
   */
  async getSystemRoleAnalytics(): Promise<ReadonlyArray<IRoleAnalytics>> {
    // Get all roles and filter system ones
    const { roles } = await this.findAll(100, 0);
    const analytics: IRoleAnalytics[] = [];

    for (const role of roles) {
      try {
        const roleAnalytics = await this.getRoleAnalytics(role.id);
        analytics.push(roleAnalytics);
      } catch (error) {
        // Skip roles that can't be analyzed
        console.warn(`Failed to get analytics for role ${role.id}:`, error);
      }
    }

    return analytics;
  }

  /**
   * Clear role cache for user
   */
  async clearUserRoleCache(userId: EntityId): Promise<void> {
    await this.cacheService.delete(`${CACHE_PREFIXES.USER_ROLES}${userId}`);
  }

  /**
   * Clear all role cache
   */
  async clearRoleCache(): Promise<void> {
    // TODO: Implement pattern-based cache clearing
    console.log("Role cache cleared (mock)");
  }

  /**
   * Warm cache with frequently accessed roles
   */
  async warmCache(roleIds: ReadonlyArray<EntityId>): Promise<void> {
    for (const roleId of roleIds) {
      await this.findById(roleId); // This will cache the role
    }
  }

  /**
   * Health check
   */
  async getHealth(): Promise<IServiceHealth> {
    try {
      // Test cache service
      const testKey = "role_health_check";
      await this.cacheService.set(testKey, "test", 1);
      const testValue = await this.cacheService.get<string>(testKey);
      await this.cacheService.delete(testKey);

      const isCacheHealthy = testValue === "test";

      return {
        service: "RoleService",
        status: isCacheHealthy ? "healthy" : "degraded",
        uptime: Date.now(),
        lastCheck: createTimestamp(new Date()),
        dependencies: [
          {
            name: "CacheService",
            status: isCacheHealthy ? "healthy" : "unhealthy",
            responseTime: 0,
            lastCheck: createTimestamp(new Date()),
            error: null,
          },
          {
            name: "RoleRepository",
            status: "healthy", // TODO: Add actual repository health check
            responseTime: 0,
            lastCheck: createTimestamp(new Date()),
            error: null,
          },
        ],
        metrics: {
          cacheHitRate: 0, // TODO: Implement cache hit rate tracking
        },
      };
    } catch (error) {
      return {
        service: "RoleService",
        status: "unhealthy",
        uptime: Date.now(),
        lastCheck: createTimestamp(new Date()),
        dependencies: [],
        metrics: {},
      };
    }
  }

  /**
   * Convert Role to IEnhancedRole
   */
  private convertRoleToEnhanced(role: Role): IEnhancedRole {
    return {
      id: role.id as EntityId,
      name: role.name,
      displayName: role.displayName,
      description: role.description ?? null,
      category: role.category,
      level: role.level,
      isActive: role.isActive,
      parentRoleIds: role.parentRoleIds as EntityId[],
      childRoleIds: role.childRoleIds as EntityId[],
      createdAt: createTimestamp(role.createdAt),
      updatedAt: createTimestamp(role.updatedAt),
      version: role.version,
      metadata: role.metadata ?? null,
      computedPermissions: [], // TODO: Load role permissions from database
      hierarchy: {
        level: role.level,
        parentRoles: role.parentRoleIds as EntityId[],
        childRoles: role.childRoleIds as EntityId[],
        inheritedPermissions: [],
        effectivePermissions: [],
      },
    };
  }

  /**
   * Clear role-dependent caches
   */
  private async clearRoleDependentCaches(roleId: EntityId): Promise<void> {
    // Clear role cache
    await this.cacheService.delete(`${CACHE_PREFIXES.ROLE}${roleId}`);

    // Clear hierarchy cache
    await this.cacheService.delete(`${CACHE_PREFIXES.ROLE_HIERARCHY}${roleId}`);

    // Clear permissions cache
    await this.cacheService.delete(
      `${CACHE_PREFIXES.ROLE_PERMISSIONS}${roleId}`
    );

    // TODO: Clear user roles caches for all users with this role
    // This would require a more sophisticated cache invalidation strategy
  }
}
