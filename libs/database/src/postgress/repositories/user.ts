/**
 * import type { DatabaseClient } from "../../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { User, UserStatus } from "../../models";
import type { Prisma } from "@prisma/client";overview User Repository Implementation
 * @module database/repositories/user
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../../cache";
import { BaseRepository, type QueryOptions, type BatchResult } from "./base";
import type {
  User,
  UserStatus,
  UserCreateInput,
  UserUpdateInput,
} from "../../models";
import type { Prisma } from "@prisma/client";

/**
 * User repository interface
 */
export interface IUserRepository
  extends BaseRepository<User, UserCreateInput, UserUpdateInput> {
  /**
   * Find user by email
   */
  findByEmail(email: string, includeDeleted?: boolean): Promise<User | null>;

  /**
   * Find user by username
   */
  findByUsername(
    username: string,
    includeDeleted?: boolean
  ): Promise<User | null>;

  /**
   * Find users by role
   */
  findByRole(roleId: string, options?: QueryOptions): Promise<User[]>;

  /**
   * Find users by status
   */
  findByStatus(status: UserStatus, options?: QueryOptions): Promise<User[]>;

  /**
   * Find users by store
   */
  findByStore(storeId: string, options?: QueryOptions): Promise<User[]>;

  /**
   * Update user role
   */
  updateRole(
    userId: string,
    roleId: string,
    performedBy: string
  ): Promise<User>;

  /**
   * Soft delete user
   */
  softDelete(userId: string, deletedBy: string): Promise<User>;

  /**
   * Restore soft deleted user
   */
  restore(userId: string): Promise<User>;

  /**
   * Update last login
   */
  updateLastLogin(userId: string): Promise<User>;

  /**
   * Get user statistics
   */
  getUserStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    banned: number;
    deleted: number;
    verifiedEmails: number;
    verifiedPhones: number;
  }>;

  /**
   * Batch update user status
   */
  batchUpdateStatus(
    userIds: string[],
    status: UserStatus,
    performedBy: string
  ): Promise<BatchResult<User>>;
}

/**
 * User repository implementation
 */
export class UserRepository
  extends BaseRepository<User, UserCreateInput, UserUpdateInput>
  implements IUserRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "User", metricsCollector);
  }

  /**
   * Find user by ID
   */
  async findById(id: string, options?: QueryOptions): Promise<User | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.UserFindUniqueArgs;

      return this.db.user.findUnique(queryOptions);
    });
  }

  /**
   * Find multiple users
   */
  async findMany(options?: QueryOptions): Promise<User[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.user.findMany({
        where: { isDeleted: false, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find first user matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<User | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.user.findFirst({
        where: { isDeleted: false, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Count users
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      return this.db.user.count({
        where: { isDeleted: false, ...options?.where },
      });
    });
  }

  /**
   * Create new user
   */
  async create(data: UserCreateInput): Promise<User> {
    return this.executeOperation("create", async () => {
      return this.db.user.create({
        data: {
          ...data,
          loginCount: 0,
        },
      });
    });
  }

  /**
   * Create multiple users
   */
  async createMany(data: UserCreateInput[]): Promise<User[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((userData) =>
          this.db.user.create({
            data: {
              ...userData,
              loginCount: 0,
            },
          })
        )
      );
      return results;
    });
  }

  /**
   * Update user by ID
   */
  async updateById(id: string, data: UserUpdateInput): Promise<User> {
    return this.executeOperation("updateById", async () => {
      return this.db.user.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Update multiple users
   */
  async updateMany(
    where: Record<string, unknown>,
    data: UserUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.user.updateMany({
        where: { isDeleted: false, ...where },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete user by ID (hard delete)
   */
  async deleteById(id: string): Promise<User> {
    return this.updateById(id, {
      isDeleted: true,
      updatedAt: new Date(),
    } as UserUpdateInput);
  }

  /**
   * Delete multiple users
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.updateMany(
      { isDeleted: false, ...where },
      { isDeleted: true, updatedAt: new Date() }
    );
  }

  /**
   * Check if user exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.user.count({
        where: { isDeleted: false, ...where },
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IUserRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      // Create a new repository instance with transaction client
      const txRepo = new UserRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find user by email
   */
  async findByEmail(
    email: string,
    includeDeleted = false
  ): Promise<User | null> {
    return this.executeOperation("findByEmail", async () => {
      return this.db.user.findUnique({
        where: {
          email,
          ...(includeDeleted ? {} : { isDeleted: false }),
        },
      });
    });
  }

  /**
   * Find user by username
   */
  async findByUsername(
    username: string,
    includeDeleted = false
  ): Promise<User | null> {
    return this.executeOperation("findByUsername", async () => {
      return this.db.user.findUnique({
        where: {
          username,
          ...(includeDeleted ? {} : { isDeleted: false }),
        },
      });
    });
  }

  /**
   * Find users by role
   */
  async findByRole(roleId: string, options?: QueryOptions): Promise<User[]> {
    return this.executeOperation("findByRole", async () => {
      return this.db.user.findMany({
        where: {
          roleId,
          isDeleted: false,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  /**
   * Find users by status
   */
  async findByStatus(
    status: UserStatus,
    options?: QueryOptions
  ): Promise<User[]> {
    return this.executeOperation("findByStatus", async () => {
      return this.db.user.findMany({
        where: {
          status,
          isDeleted: false,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  /**
   * Find users by store
   */
  async findByStore(storeId: string, options?: QueryOptions): Promise<User[]> {
    return this.executeOperation("findByStore", async () => {
      return this.db.user.findMany({
        where: {
          storeId,
          isDeleted: false,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  /**
   * Update user role with audit trail
   */
  async updateRole(
    userId: string,
    roleId: string,
    performedBy: string
  ): Promise<User> {
    return this.executeOperation("updateRole", async () => {
      return this.db.user.update({
        where: { id: userId },
        data: {
          roleId,
          roleAssignedAt: new Date(),
          roleAssignedBy: performedBy,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Soft delete user
   */
  async softDelete(userId: string, deletedBy: string): Promise<User> {
    return this.executeOperation("softDelete", async () => {
      return this.db.user.update({
        where: { id: userId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: deletedBy,
          status: "DELETED",
          updatedAt: new Date(),
        },
      });
    });
  }

  async softDeleteMany(userId: string, deletedBy: string): Promise<User> {
    return this.executeOperation("softDelete", async () => {
      return this.db.user.update({
        where: { id: userId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: deletedBy,
          status: "DELETED",
          updatedAt: new Date(),
        },
      });
    });
  }
  /**
   * Restore soft deleted user
   */
  async restore(userId: string): Promise<User> {
    return this.executeOperation("restore", async () => {
      return this.db.user.update({
        where: { id: userId },
        data: {
          isDeleted: false,
          deletedAt: null,
          status: "INACTIVE",
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Update last login timestamp
   */
  async updateLastLogin(userId: string): Promise<User> {
    return this.executeOperation("updateLastLogin", async () => {
      return this.db.user.update({
        where: { id: userId },
        data: {
          lastLoginAt: new Date(),
          loginCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Get user statistics
   */
  async getUserStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    banned: number;
    deleted: number;
    verifiedEmails: number;
    verifiedPhones: number;
  }> {
    return this.executeOperation("getUserStats", async () => {
      const [
        total,
        active,
        inactive,
        banned,
        deleted,
        verifiedEmails,
        verifiedPhones,
      ] = await Promise.all([
        this.db.user.count(),
        this.db.user.count({ where: { status: "ACTIVE" } }),
        this.db.user.count({ where: { status: "INACTIVE" } }),
        this.db.user.count({ where: { status: "BANNED" } }),
        this.db.user.count({ where: { status: "DELETED" } }),
        this.db.user.count({ where: { emailVerified: true } }),
        this.db.user.count({ where: { phoneVerified: true } }),
      ]);

      return {
        total,
        active,
        inactive,
        banned,
        deleted,
        verifiedEmails,
        verifiedPhones,
      };
    });
  }

  /**
   * Batch update user status
   */
  async batchUpdateStatus(
    userIds: string[],
    status: UserStatus,
    performedBy: string
  ): Promise<BatchResult<User>> {
    return this.executeOperation("batchUpdateStatus", async () => {
      const startTime = performance.now();
      const successful: User[] = [];
      const failed: Array<{ item: User; error: Error }> = [];

      for (const userId of userIds) {
        try {
          const user = await this.db.user.update({
            where: { id: userId },
            data: {
              status,
              updatedBy: performedBy,
              updatedAt: new Date(),
            },
          });
          successful.push(user);
        } catch (error) {
          // Try to get the user for the failed item
          try {
            const user = await this.db.user.findUnique({
              where: { id: userId },
            });
            if (user) {
              failed.push({
                item: user,
                error:
                  error instanceof Error ? error : new Error(String(error)),
              });
            }
          } catch {
            // If we can't get the user, create a minimal user object
            failed.push({
              item: { id: userId } as User,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        }
      }

      const duration = performance.now() - startTime;

      return {
        successful,
        failed,
        stats: {
          total: userIds.length,
          successful: successful.length,
          failed: failed.length,
          duration,
        },
      };
    });
  }
}
