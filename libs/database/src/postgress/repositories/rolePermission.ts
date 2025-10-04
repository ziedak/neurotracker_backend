/**
 * @fileoverview RolePermission Repository Implementation
 * @module database/repositories/rolePermission
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  RolePermission,
  RolePermissionCreateInput,
  RolePermissionUpdateInput,
} from "../../models";
import type { Prisma } from "@prisma/client";

/**
 * RolePermission repository interface
 */
export interface IRolePermissionRepository
  extends BaseRepository<
    RolePermission,
    RolePermissionCreateInput,
    RolePermissionUpdateInput
  > {
  /**
   * Find permissions by role ID
   */
  findByRoleId(
    roleId: string,
    options?: QueryOptions
  ): Promise<RolePermission[]>;

  /**
   * Find permissions by resource
   */
  findByResource(
    resource: string,
    options?: QueryOptions
  ): Promise<RolePermission[]>;

  /**
   * Find permissions by action
   */
  findByAction(
    action: string,
    options?: QueryOptions
  ): Promise<RolePermission[]>;

  /**
   * Find permission by role, resource, and action
   */
  findByRoleResourceAction(
    roleId: string,
    resource: string,
    action: string
  ): Promise<RolePermission | null>;

  /**
   * Check if role has permission for resource and action
   */
  hasPermission(
    roleId: string,
    resource: string,
    action: string
  ): Promise<boolean>;
}

/**
 * RolePermission repository implementation
 */
export class RolePermissionRepository
  extends BaseRepository<
    RolePermission,
    RolePermissionCreateInput,
    RolePermissionUpdateInput
  >
  implements IRolePermissionRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "RolePermission", metricsCollector);
  }

  /**
   * Find role permission by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<RolePermission | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.RolePermissionFindUniqueArgs;

      return this.db.rolePermission.findUnique(queryOptions);
    });
  }

  /**
   * Find multiple role permissions
   */
  async findMany(options?: QueryOptions): Promise<RolePermission[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.rolePermission.findMany({
        ...options,
      });
    });
  }

  /**
   * Find first role permission matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<RolePermission | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.rolePermission.findFirst({
        ...options,
      });
    });
  }

  /**
   * Count role permissions
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      return this.db.rolePermission.count({
        ...(options?.where && { where: options.where }),
      });
    });
  }

  /**
   * Create new role permission
   */
  async create(data: RolePermissionCreateInput): Promise<RolePermission> {
    return this.executeOperation("create", async () => {
      return this.db.rolePermission.create({
        data,
      });
    });
  }

  /**
   * Create multiple role permissions
   */
  async createMany(
    data: RolePermissionCreateInput[]
  ): Promise<RolePermission[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((rolePermissionData) =>
          this.db.rolePermission.create({
            data: rolePermissionData,
          })
        )
      );
      return results;
    });
  }

  /**
   * Update role permission by ID
   */
  async updateById(
    id: string,
    data: RolePermissionUpdateInput
  ): Promise<RolePermission> {
    return this.executeOperation("updateById", async () => {
      return this.db.rolePermission.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Update multiple role permissions
   */
  async updateMany(
    where: Record<string, unknown>,
    data: RolePermissionUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.rolePermission.updateMany({
        where,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete role permission by ID
   */
  async deleteById(id: string): Promise<RolePermission> {
    return this.executeOperation("deleteById", async () => {
      return this.db.rolePermission.delete({
        where: { id },
      });
    });
  }

  /**
   * Delete multiple role permissions
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.rolePermission.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if role permission exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.rolePermission.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IRolePermissionRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new RolePermissionRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find permissions by role ID
   */
  async findByRoleId(
    roleId: string,
    options?: QueryOptions
  ): Promise<RolePermission[]> {
    return this.executeOperation("findByRoleId", async () => {
      return this.db.rolePermission.findMany({
        where: { roleId, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find permissions by resource
   */
  async findByResource(
    resource: string,
    options?: QueryOptions
  ): Promise<RolePermission[]> {
    return this.executeOperation("findByResource", async () => {
      return this.db.rolePermission.findMany({
        where: { resource, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find permissions by action
   */
  async findByAction(
    action: string,
    options?: QueryOptions
  ): Promise<RolePermission[]> {
    return this.executeOperation("findByAction", async () => {
      return this.db.rolePermission.findMany({
        where: { action, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find permission by role, resource, and action
   */
  async findByRoleResourceAction(
    roleId: string,
    resource: string,
    action: string
  ): Promise<RolePermission | null> {
    return this.executeOperation("findByRoleResourceAction", async () => {
      return this.db.rolePermission.findUnique({
        where: {
          roleId_resource_action: {
            roleId,
            resource,
            action,
          },
        },
      });
    });
  }

  /**
   * Check if role has permission for resource and action
   */
  async hasPermission(
    roleId: string,
    resource: string,
    action: string
  ): Promise<boolean> {
    return this.executeOperation("hasPermission", async () => {
      const count = await this.db.rolePermission.count({
        where: {
          roleId,
          resource,
          action,
        },
      });
      return count > 0;
    });
  }
}
