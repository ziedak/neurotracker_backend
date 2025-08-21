/**
 * @fileoverview Role Repository Implementation
 * @module repositories/RoleRepository
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, TenantContext, Role } from "../types/core";
import {
  BaseRepository,
  FindManyOptions,
  CountOptions,
  EntityNotFoundError,
  TenantAccessError,
} from "./base/BaseRepository";

/**
 * Role creation input interface
 */
export interface CreateRoleInput {
  name: string;
  displayName: string;
  description?: string | null;
  category: string;
  level: number;
  isActive?: boolean;
  version?: string;
  parentRoleIds?: string[];
  childRoleIds?: string[];
  metadata?: Record<string, unknown> | null;
}

/**
 * Role update input interface
 */
export interface UpdateRoleInput {
  name?: string;
  displayName?: string;
  description?: string | null;
  category?: string;
  level?: number;
  isActive?: boolean;
  version?: string;
  parentRoleIds?: string[];
  childRoleIds?: string[];
  metadata?: Record<string, unknown> | null;
}

/**
 * Enterprise Role Repository with hierarchy support
 *
 * Features:
 * - Role hierarchy management
 * - Version control for role changes
 * - Tenant-aware operations
 * - Role inheritance computation
 * - Audit logging for all operations
 */
export class RoleRepository extends BaseRepository<
  Role,
  CreateRoleInput,
  UpdateRoleInput
> {
  protected readonly entityName = "role";

  constructor(prisma: any) {
    super(prisma);
  }

  /**
   * Find role by ID with tenant context validation
   */
  async findById(id: EntityId, context?: TenantContext): Promise<Role | null> {
    const startTime = Date.now();

    try {
      const where = this.applyTenantFilter({ id }, context);

      const role = await this.prisma.role.findFirst({
        where,
        include: {
          permissions: context?.permissions.includes("role.read.extended"),
          parentRoles: context?.permissions.includes("role.read.hierarchy"),
          childRoles: context?.permissions.includes("role.read.hierarchy"),
        },
      });

      if (role && !this.validateAccess(role, context, "read")) {
        throw new TenantAccessError("role", id, context?.storeId || undefined);
      }

      this.logMetrics("findById", startTime, role ? 1 : 0);
      return role as Role | null;
    } catch (error) {
      this.handleError(error, "findById");
    }
  }

  /**
   * Find multiple roles with filtering and pagination
   */
  async findMany(
    filter: FindManyOptions<Role>,
    context?: TenantContext
  ): Promise<Role[]> {
    const startTime = Date.now();

    try {
      const where = this.applyTenantFilter(filter.where || {}, context);

      const roles = await this.prisma.role.findMany({
        where,
        orderBy: filter.orderBy?.map((order) => ({
          [order.field as string]: order.direction,
        })),
        skip: filter.skip,
        take: filter.take,
        include: filter.include || {},
      });

      // Filter results based on access permissions
      const accessibleRoles = roles.filter((role: any) =>
        this.validateAccess(role, context, "read")
      );

      this.logMetrics("findMany", startTime, accessibleRoles.length);
      return accessibleRoles as Role[];
    } catch (error) {
      this.handleError(error, "findMany");
    }
  }

  /**
   * Create new role with audit logging
   */
  async create(data: CreateRoleInput, context?: TenantContext): Promise<Role> {
    const startTime = Date.now();

    try {
      // Validate role name uniqueness within tenant
      await this.validateRoleNameUniqueness(data.name, context);

      const roleData = {
        ...data,
        isActive: data.isActive ?? true,
        version: data.version || "1.0.0",
        parentRoleIds: data.parentRoleIds || [],
        childRoleIds: data.childRoleIds || [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const role = await this.prisma.role.create({
        data: roleData,
        include: {
          permissions: true,
        },
      });

      // Create audit entry
      await this.createAuditEntry("CREATE", role.id, roleData, context);

      this.logMetrics("create", startTime, 1);
      return role as Role;
    } catch (error) {
      this.handleError(error, "create");
    }
  }

  /**
   * Update role with audit logging
   */
  async update(
    id: EntityId,
    data: UpdateRoleInput,
    context?: TenantContext
  ): Promise<Role> {
    const startTime = Date.now();

    try {
      // Verify role exists and is accessible
      const existingRole = await this.findById(id, context);
      if (!existingRole) {
        throw new EntityNotFoundError("role", id);
      }

      // Validate role name uniqueness if name is being updated
      if (data.name && data.name !== existingRole.name) {
        await this.validateRoleNameUniqueness(data.name, context);
      }

      const updateData = {
        ...data,
        updatedAt: new Date(),
      };

      const updatedRole = await this.prisma.role.update({
        where: { id },
        data: updateData,
        include: {
          permissions: true,
        },
      });

      // Create audit entry with change tracking
      const changes = this.getChanges(existingRole, updateData);
      await this.createAuditEntry("UPDATE", id, changes, context);

      this.logMetrics("update", startTime, 1);
      return updatedRole as Role;
    } catch (error) {
      this.handleError(error, "update");
    }
  }

  /**
   * Soft delete role
   */
  async delete(id: EntityId, context?: TenantContext): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Verify role exists and is accessible
      const existingRole = await this.findById(id, context);
      if (!existingRole) {
        throw new EntityNotFoundError("role", id);
      }

      if (!this.validateAccess(existingRole, context, "delete")) {
        throw new TenantAccessError("role", id, context?.storeId || undefined);
      }

      await this.prisma.role.update({
        where: { id },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      // Create audit entry
      await this.createAuditEntry("DELETE", id, { isActive: false }, context);

      this.logMetrics("delete", startTime, 1);
      return true;
    } catch (error) {
      this.handleError(error, "delete");
    }
  }

  /**
   * Count roles matching filter
   */
  async count(
    filter?: CountOptions<Role>,
    context?: TenantContext
  ): Promise<number> {
    const startTime = Date.now();

    try {
      const where = this.applyTenantFilter(filter?.where || {}, context);

      const count = await this.prisma.role.count({ where });

      this.logMetrics("count", startTime);
      return count;
    } catch (error) {
      this.handleError(error, "count");
    }
  }

  /**
   * Find role by name within tenant context
   */
  async findByName(
    name: string,
    context?: TenantContext
  ): Promise<Role | null> {
    const filter: FindManyOptions<Role> = {
      where: { name },
      take: 1,
    };

    const roles = await this.findMany(filter, context);
    return roles[0] || null;
  }

  /**
   * Get role hierarchy (parent and child roles)
   */
  async getRoleHierarchy(
    roleId: EntityId,
    context?: TenantContext
  ): Promise<{
    role: Role;
    parents: Role[];
    children: Role[];
    allDescendants: Role[];
  }> {
    try {
      const role = await this.findById(roleId, context);
      if (!role) {
        throw new EntityNotFoundError("role", roleId);
      }

      // Get parent roles
      const parents: Role[] = [];
      for (const parentId of role.parentRoleIds) {
        const parent = await this.findById(parentId as EntityId, context);
        if (parent) parents.push(parent);
      }

      // Get child roles
      const children: Role[] = [];
      for (const childId of role.childRoleIds) {
        const child = await this.findById(childId as EntityId, context);
        if (child) children.push(child);
      }

      // Get all descendants recursively
      const allDescendants = await this.getAllDescendants(roleId, context);

      return {
        role,
        parents,
        children,
        allDescendants,
      };
    } catch (error) {
      this.handleError(error, "getRoleHierarchy");
    }
  }

  /**
   * Add parent role to role hierarchy
   */
  async addParentRole(
    childRoleId: EntityId,
    parentRoleId: EntityId,
    context?: TenantContext
  ): Promise<void> {
    try {
      const childRole = await this.findById(childRoleId, context);
      const parentRole = await this.findById(parentRoleId, context);

      if (!childRole) throw new EntityNotFoundError("role", childRoleId);
      if (!parentRole) throw new EntityNotFoundError("role", parentRoleId);

      // Prevent circular dependencies
      if (
        await this.wouldCreateCircularDependency(
          childRoleId,
          parentRoleId,
          context
        )
      ) {
        throw new Error(
          "Adding this parent role would create a circular dependency"
        );
      }

      // Update child role's parent list
      const updatedParentIds = [
        ...new Set([...childRole.parentRoleIds, parentRoleId]),
      ];
      await this.update(
        childRoleId,
        { parentRoleIds: updatedParentIds },
        context
      );

      // Update parent role's child list
      const updatedChildIds = [
        ...new Set([...parentRole.childRoleIds, childRoleId]),
      ];
      await this.update(
        parentRoleId,
        { childRoleIds: updatedChildIds },
        context
      );

      await this.createAuditEntry(
        "UPDATE",
        childRoleId,
        {
          action: "parent_role_added",
          parentRoleId,
        },
        context
      );
    } catch (error) {
      this.handleError(error, "addParentRole");
    }
  }

  /**
   * Remove parent role from role hierarchy
   */
  async removeParentRole(
    childRoleId: EntityId,
    parentRoleId: EntityId,
    context?: TenantContext
  ): Promise<void> {
    try {
      const childRole = await this.findById(childRoleId, context);
      const parentRole = await this.findById(parentRoleId, context);

      if (!childRole) throw new EntityNotFoundError("role", childRoleId);
      if (!parentRole) throw new EntityNotFoundError("role", parentRoleId);

      // Update child role's parent list
      const updatedParentIds = childRole.parentRoleIds.filter(
        (id) => id !== parentRoleId
      );
      await this.update(
        childRoleId,
        { parentRoleIds: updatedParentIds },
        context
      );

      // Update parent role's child list
      const updatedChildIds = parentRole.childRoleIds.filter(
        (id) => id !== childRoleId
      );
      await this.update(
        parentRoleId,
        { childRoleIds: updatedChildIds },
        context
      );

      await this.createAuditEntry(
        "UPDATE",
        childRoleId,
        {
          action: "parent_role_removed",
          parentRoleId,
        },
        context
      );
    } catch (error) {
      this.handleError(error, "removeParentRole");
    }
  }

  /**
   * Get all roles at a specific level
   */
  async getRolesByLevel(
    level: number,
    context?: TenantContext
  ): Promise<Role[]> {
    return await this.findMany(
      {
        where: { level },
      },
      context
    );
  }

  /**
   * Get all active roles for a tenant
   */
  async getActiveRoles(context?: TenantContext): Promise<Role[]> {
    return await this.findMany(
      {
        where: { isActive: true },
      },
      context
    );
  }

  /**
   * Validate role name uniqueness within tenant context
   */
  private async validateRoleNameUniqueness(
    name: string,
    context?: TenantContext
  ): Promise<void> {
    const existingRole = await this.findByName(name, context);
    if (existingRole) {
      throw new Error(`Role with name ${name} already exists in this tenant`);
    }
  }

  /**
   * Get all descendant roles recursively
   */
  private async getAllDescendants(
    roleId: EntityId,
    context?: TenantContext,
    visited: Set<string> = new Set()
  ): Promise<Role[]> {
    if (visited.has(roleId)) {
      return []; // Prevent infinite recursion
    }
    visited.add(roleId);

    const role = await this.findById(roleId, context);
    if (!role) return [];

    let descendants: Role[] = [];

    // Get direct children
    for (const childId of role.childRoleIds) {
      const child = await this.findById(childId as EntityId, context);
      if (child) {
        descendants.push(child);
        // Recursively get grandchildren
        const grandchildren = await this.getAllDescendants(
          childId as EntityId,
          context,
          visited
        );
        descendants = descendants.concat(grandchildren);
      }
    }

    return descendants;
  }

  /**
   * Check if adding a parent role would create circular dependency
   */
  private async wouldCreateCircularDependency(
    childRoleId: EntityId,
    proposedParentId: EntityId,
    context?: TenantContext
  ): Promise<boolean> {
    // If the proposed parent is actually a descendant of the child, it would create a circle
    const descendants = await this.getAllDescendants(childRoleId, context);
    return descendants.some((desc) => desc.id === proposedParentId);
  }

  /**
   * Get changes between existing entity and update data
   */
  private getChanges(
    existing: Role,
    updates: UpdateRoleInput
  ): Record<string, unknown> {
    const changes: Record<string, unknown> = {};

    for (const [key, newValue] of Object.entries(updates)) {
      const oldValue = (existing as any)[key];
      if (oldValue !== newValue) {
        changes[key] = { from: oldValue, to: newValue };
      }
    }

    return changes;
  }
}
