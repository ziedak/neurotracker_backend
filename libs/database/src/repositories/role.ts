/**
 * @fileoverview Role Repository Implementation
 * @module database/repositories/role
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { Role, RolePermission } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * Role creation input type
 */
export type RoleCreateInput = Omit<
  Prisma.RoleCreateInput,
  "id" | "createdAt" | "updatedAt" | "version"
> & {
  id?: string;
};

/**
 * Role update input type
 */
export type RoleUpdateInput = Prisma.RoleUpdateInput;

/**
 * Role permission creation input
 */
export type RolePermissionCreateInput = Omit<
  Prisma.RolePermissionCreateInput,
  "id" | "createdAt" | "updatedAt" | "version" | "role"
> & {
  id?: string;
};

/**
 * Role permission update input
 */
export type RolePermissionUpdateInput = Prisma.RolePermissionUpdateInput;

/**
 * Role query filters
 */
export interface RoleFilters {
  category?: string;
  level?: number;
  isActive?: boolean;
  parentRoleId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

/**
 * Role repository interface
 */
export interface IRoleRepository
  extends BaseRepository<Role, RoleCreateInput, RoleUpdateInput> {
  /**
   * Find role by name
   */
  findByName(name: string): Promise<Role | null>;

  /**
   * Find roles by category
   */
  findByCategory(category: string, options?: QueryOptions): Promise<Role[]>;

  /**
   * Find child roles
   */
  findChildRoles(parentRoleId: string, options?: QueryOptions): Promise<Role[]>;

  /**
   * Find parent role
   */
  findParentRole(childRoleId: string): Promise<Role | null>;

  /**
   * Get role hierarchy
   */
  getRoleHierarchy(roleId: string): Promise<{
    role: Role;
    parents: Role[];
    children: Role[];
  }>;

  /**
   * Update role hierarchy
   */
  updateHierarchy(roleId: string, parentRoleId: string | null): Promise<Role>;

  /**
   * Get role permissions
   */
  getRolePermissions(roleId: string): Promise<RolePermission[]>;

  /**
   * Add permission to role
   */
  addPermission(
    roleId: string,
    permission: RolePermissionCreateInput
  ): Promise<RolePermission>;

  /**
   * Remove permission from role
   */
  removePermission(
    roleId: string,
    resource: string,
    action: string
  ): Promise<boolean>;

  /**
   * Check if role has permission
   */
  hasPermission(
    roleId: string,
    resource: string,
    action: string
  ): Promise<boolean>;

  /**
   * Get all permissions for role (including inherited)
   */
  getAllPermissions(roleId: string): Promise<RolePermission[]>;

  /**
   * Clone role with permissions
   */
  cloneRole(sourceRoleId: string, newRoleData: RoleCreateInput): Promise<Role>;
}

/**
 * Role repository implementation
 */
export class RoleRepository
  extends BaseRepository<Role, RoleCreateInput, RoleUpdateInput>
  implements IRoleRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Role", metricsCollector);
  }

  /**
   * Find role by ID
   */
  async findById(id: string, options?: QueryOptions): Promise<Role | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.RoleFindUniqueArgs;

      return this.db.role.findUnique(queryOptions);
    });
  }

  /**
   * Find multiple roles
   */
  async findMany(options?: QueryOptions): Promise<Role[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.role.findMany({
        where: { isActive: true, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find first role matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<Role | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.role.findFirst({
        where: { isActive: true, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Count roles
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      return this.db.role.count({
        where: { isActive: true, ...options?.where },
      });
    });
  }

  /**
   * Create new role
   */
  async create(data: RoleCreateInput): Promise<Role> {
    return this.executeOperation("create", async () => {
      return this.db.role.create({
        data: {
          ...data,
          version: "1.0.0",
        },
      });
    });
  }

  /**
   * Create multiple roles
   */
  async createMany(data: RoleCreateInput[]): Promise<Role[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((roleData) =>
          this.db.role.create({
            data: {
              ...roleData,
              version: "1.0.0",
            },
          })
        )
      );
      return results;
    });
  }

  /**
   * Update role by ID
   */
  async updateById(id: string, data: RoleUpdateInput): Promise<Role> {
    return this.executeOperation("updateById", async () => {
      return this.db.role.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Update multiple roles
   */
  async updateMany(
    where: Record<string, unknown>,
    data: RoleUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.role.updateMany({
        where: { isActive: true, ...where },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete role by ID
   */
  async deleteById(id: string): Promise<Role> {
    return this.executeOperation("deleteById", async () => {
      return this.db.role.delete({
        where: { id },
      });
    });
  }

  /**
   * Delete multiple roles
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.role.deleteMany({
        where: { isActive: true, ...where },
      });
    });
  }

  /**
   * Check if role exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.role.count({
        where: { isActive: true, ...where },
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IRoleRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new RoleRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find role by name
   */
  async findByName(name: string): Promise<Role | null> {
    return this.executeOperation("findByName", async () => {
      return this.db.role.findUnique({
        where: { name },
      });
    });
  }

  /**
   * Find roles by category
   */
  async findByCategory(
    category: string,
    options?: QueryOptions
  ): Promise<Role[]> {
    return this.executeOperation("findByCategory", async () => {
      return this.db.role.findMany({
        where: {
          category,
          isActive: true,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  /**
   * Find child roles
   */
  async findChildRoles(
    parentRoleId: string,
    options?: QueryOptions
  ): Promise<Role[]> {
    return this.executeOperation("findChildRoles", async () => {
      return this.db.role.findMany({
        where: {
          parentRoleId,
          isActive: true,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  /**
   * Find parent role
   */
  async findParentRole(childRoleId: string): Promise<Role | null> {
    return this.executeOperation("findParentRole", async () => {
      const childRole = await this.db.role.findUnique({
        where: { id: childRoleId },
        select: { parentRoleId: true },
      });

      if (!childRole?.parentRoleId) {
        return null;
      }

      return this.db.role.findUnique({
        where: { id: childRole.parentRoleId },
      });
    });
  }

  /**
   * Get role hierarchy
   */
  async getRoleHierarchy(roleId: string): Promise<{
    role: Role;
    parents: Role[];
    children: Role[];
  }> {
    return this.executeOperation("getRoleHierarchy", async () => {
      const role = await this.db.role.findUnique({
        where: { id: roleId },
      });

      if (!role) {
        throw new Error(`Role with ID ${roleId} not found`);
      }

      // Get all parents (recursive)
      const parents: Role[] = [];
      let currentParentId = role.parentRoleId;

      while (currentParentId) {
        const parent = await this.db.role.findUnique({
          where: { id: currentParentId },
        });
        if (parent) {
          parents.unshift(parent);
          currentParentId = parent.parentRoleId;
        } else {
          break;
        }
      }

      // Get direct children
      const children = await this.db.role.findMany({
        where: {
          parentRoleId: roleId,
          isActive: true,
        },
      });

      return { role, parents, children };
    });
  }

  /**
   * Update role hierarchy
   */
  async updateHierarchy(
    roleId: string,
    parentRoleId: string | null
  ): Promise<Role> {
    return this.executeOperation("updateHierarchy", async () => {
      // Prevent circular references
      if (parentRoleId) {
        const parentChain = await this.getParentChain(parentRoleId);
        if (parentChain.includes(roleId)) {
          throw new Error("Circular role hierarchy detected");
        }
      }

      return this.db.role.update({
        where: { id: roleId },
        data: {
          parentRoleId,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Get parent chain for circular reference detection
   */
  private async getParentChain(roleId: string): Promise<string[]> {
    const chain: string[] = [];
    let currentId = roleId;

    while (currentId) {
      const role = await this.db.role.findUnique({
        where: { id: currentId },
        select: { id: true, parentRoleId: true },
      });

      if (!role) break;

      chain.push(role.id);
      currentId = role.parentRoleId ?? "";
    }

    return chain;
  }

  /**
   * Get role permissions
   */
  async getRolePermissions(roleId: string): Promise<RolePermission[]> {
    return this.executeOperation("getRolePermissions", async () => {
      return this.db.rolePermission.findMany({
        where: { roleId },
        orderBy: { priority: "desc" },
      });
    });
  }

  /**
   * Add permission to role
   */
  async addPermission(
    roleId: string,
    permission: RolePermissionCreateInput
  ): Promise<RolePermission> {
    return this.executeOperation("addPermission", async () => {
      return this.db.rolePermission.create({
        data: {
          ...permission,
          roleId,
          version: "1.0.0",
        },
      });
    });
  }

  /**
   * Remove permission from role
   */
  async removePermission(
    roleId: string,
    resource: string,
    action: string
  ): Promise<boolean> {
    return this.executeOperation("removePermission", async () => {
      const result = await this.db.rolePermission.deleteMany({
        where: {
          roleId,
          resource,
          action,
        },
      });
      return result.count > 0;
    });
  }

  /**
   * Check if role has permission
   */
  async hasPermission(
    roleId: string,
    resource: string,
    action: string
  ): Promise<boolean> {
    return this.executeOperation("hasPermission", async () => {
      const permissions = await this.getAllPermissions(roleId);
      return permissions.some(
        (p) => p.resource === resource && p.action === action
      );
    });
  }

  /**
   * Get all permissions for role (including inherited)
   */
  async getAllPermissions(roleId: string): Promise<RolePermission[]> {
    return this.executeOperation("getAllPermissions", async () => {
      const hierarchy = await this.getRoleHierarchy(roleId);
      const roleIds = [roleId, ...hierarchy.parents.map((r) => r.id)];

      return this.db.rolePermission.findMany({
        where: {
          roleId: { in: roleIds },
        },
        orderBy: [{ priority: "desc" }, { roleId: "asc" }],
      });
    });
  }

  /**
   * Clone role with permissions
   */
  async cloneRole(
    sourceRoleId: string,
    newRoleData: RoleCreateInput
  ): Promise<Role> {
    return this.executeOperation("cloneRole", async () => {
      return this.transaction(async (txRepo) => {
        // Get source role
        const sourceRole = await txRepo.findById(sourceRoleId);
        if (!sourceRole) {
          throw new Error(`Source role ${sourceRoleId} not found`);
        }

        // Create new role
        const newRole = await txRepo.create({
          ...newRoleData,
          level: sourceRole.level,
          category: sourceRole.category,
        });

        // Clone permissions
        const sourcePermissions = await txRepo.getRolePermissions(sourceRoleId);
        for (const permission of sourcePermissions) {
          await txRepo.addPermission(newRole.id, {
            resource: permission.resource,
            action: permission.action,
            name: permission.name,
            description: permission.description ?? null,
            conditions: permission.conditions as Prisma.InputJsonValue,
            priority: permission.priority,
          });
        }

        return newRole;
      });
    });
  }
}
