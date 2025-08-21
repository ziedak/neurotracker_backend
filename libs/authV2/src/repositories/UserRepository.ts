/**
 * @fileoverview User Repository Implementation
 * @module repositories/UserRepository
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, TenantContext, User, UserStatus } from "../types/core";
import {
  BaseRepository,
  FindManyOptions,
  CountOptions,
  EntityNotFoundError,
  TenantAccessError,
} from "./base/BaseRepository";

/**
 * User creation input interface
 */
export interface CreateUserInput {
  email: string;
  username: string;
  password: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  status?: UserStatus;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  storeId?: string | null;
  organizationId?: string | null;
  roleId?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * User update input interface
 */
export interface UpdateUserInput {
  email?: string;
  username?: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  status?: UserStatus;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  roleId?: string | null;
  roleAssignedAt?: Date | null;
  roleAssignedBy?: string | null;
  roleRevokedAt?: Date | null;
  roleRevokedBy?: string | null;
  roleExpiresAt?: Date | null;
  updatedBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * User search filters
 */
export interface UserSearchFilters {
  email?: string;
  username?: string;
  status?: UserStatus | UserStatus[];
  storeId?: string;
  organizationId?: string;
  roleId?: string;
  emailVerified?: boolean;
  isDeleted?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
  lastLoginAfter?: Date;
}

/**
 * Enterprise User Repository with multi-tenant support
 *
 * Features:
 * - Tenant-aware operations
 * - Role-based access control integration
 * - Email uniqueness within store context
 * - User activity tracking
 * - Audit logging for all operations
 * - Performance optimization with selective loading
 */
export class UserRepository extends BaseRepository<
  User,
  CreateUserInput,
  UpdateUserInput
> {
  protected readonly entityName = "user";

  constructor(prisma: any) {
    super(prisma);
  }

  /**
   * Find user by ID with tenant context validation
   */
  async findById(id: EntityId, context?: TenantContext): Promise<User | null> {
    const startTime = Date.now();

    try {
      const where = this.applyTenantFilter({ id }, context);

      const user = await this.prisma.user.findFirst({
        where,
        include: {
          // Include related data for enterprise features
          role: context?.permissions.includes("user.read.extended"),
          store: context?.permissions.includes("user.read.extended"),
        },
      });

      if (user && !this.validateAccess(user, context, "read")) {
        throw new TenantAccessError("user", id, context?.storeId || undefined);
      }

      this.logMetrics("findById", startTime, user ? 1 : 0);
      return user as User | null;
    } catch (error) {
      this.handleError(error, "findById");
    }
  }

  /**
   * Find multiple users with filtering and pagination
   */
  async findMany(
    filter: FindManyOptions<User>,
    context?: TenantContext
  ): Promise<User[]> {
    const startTime = Date.now();

    try {
      const where = this.applyTenantFilter(filter.where || {}, context);

      const users = await this.prisma.user.findMany({
        where,
        orderBy: filter.orderBy?.map((order) => ({
          [order.field as string]: order.direction,
        })),
        skip: filter.skip,
        take: filter.take,
        include: filter.include || {},
      });

      // Filter results based on access permissions
      const accessibleUsers = users.filter((user: any) =>
        this.validateAccess(user, context, "read")
      );

      this.logMetrics("findMany", startTime, accessibleUsers.length);
      return accessibleUsers as User[];
    } catch (error) {
      this.handleError(error, "findMany");
    }
  }

  /**
   * Create new user with audit logging
   */
  async create(data: CreateUserInput, context?: TenantContext): Promise<User> {
    const startTime = Date.now();

    try {
      // Validate email uniqueness within tenant context
      await this.validateEmailUniqueness(data.email, context);

      // Apply tenant context to user data
      const userData = {
        ...data,
        storeId: data.storeId || context?.storeId,
        organizationId: data.organizationId || context?.organizationId,
        createdBy: data.createdBy || context?.userId,
        loginCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const user = await this.prisma.user.create({
        data: userData,
        include: {
          role: true,
          store: true,
        },
      });

      // Create audit entry
      await this.createAuditEntry("CREATE", user.id, userData, context);

      this.logMetrics("create", startTime, 1);
      return user as User;
    } catch (error) {
      this.handleError(error, "create");
    }
  }

  /**
   * Update user with audit logging
   */
  async update(
    id: EntityId,
    data: UpdateUserInput,
    context?: TenantContext
  ): Promise<User> {
    const startTime = Date.now();

    try {
      // Verify user exists and is accessible
      const existingUser = await this.findById(id, context);
      if (!existingUser) {
        throw new EntityNotFoundError("user", id);
      }

      // Validate email uniqueness if email is being updated
      if (data.email && data.email !== existingUser.email) {
        await this.validateEmailUniqueness(data.email, context);
      }

      const updateData: UpdateUserInput = {
        ...data,
        updatedBy: (data.updatedBy || context?.userId) ?? null,
        updatedAt: new Date(),
      } as any;

      const updatedUser = await this.prisma.user.update({
        where: { id },
        data: updateData,
        include: {
          role: true,
          store: true,
        },
      });

      // Create audit entry with change tracking
      const changes = this.getChanges(existingUser, updateData);
      await this.createAuditEntry("UPDATE", id, changes, context);

      this.logMetrics("update", startTime, 1);
      return updatedUser as User;
    } catch (error) {
      this.handleError(error, "update");
    }
  }

  /**
   * Soft delete user
   */
  async delete(id: EntityId, context?: TenantContext): Promise<boolean> {
    const startTime = Date.now();

    try {
      // Verify user exists and is accessible
      const existingUser = await this.findById(id, context);
      if (!existingUser) {
        throw new EntityNotFoundError("user", id);
      }

      if (!this.validateAccess(existingUser, context, "delete")) {
        throw new TenantAccessError("user", id, context?.storeId || undefined);
      }

      await this.prisma.user.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedBy: context?.userId,
          updatedAt: new Date(),
        },
      });

      // Create audit entry
      await this.createAuditEntry("DELETE", id, { isDeleted: true }, context);

      this.logMetrics("delete", startTime, 1);
      return true;
    } catch (error) {
      this.handleError(error, "delete");
    }
  }

  /**
   * Count users matching filter
   */
  async count(
    filter?: CountOptions<User>,
    context?: TenantContext
  ): Promise<number> {
    const startTime = Date.now();

    try {
      const where = this.applyTenantFilter(filter?.where || {}, context);

      const count = await this.prisma.user.count({ where });

      this.logMetrics("count", startTime);
      return count;
    } catch (error) {
      this.handleError(error, "count");
    }
  }

  /**
   * Find user by email within tenant context
   */
  async findByEmail(
    email: string,
    context?: TenantContext
  ): Promise<User | null> {
    const filter: FindManyOptions<User> = {
      where: { email },
      take: 1,
    };

    const users = await this.findMany(filter, context);
    return users[0] || null;
  }

  /**
   * Find user by username within tenant context
   */
  async findByUsername(
    username: string,
    context?: TenantContext
  ): Promise<User | null> {
    const filter: FindManyOptions<User> = {
      where: { username },
      take: 1,
    };

    const users = await this.findMany(filter, context);
    return users[0] || null;
  }

  /**
   * Search users with complex filters
   */
  async search(
    filters: UserSearchFilters,
    context?: TenantContext
  ): Promise<User[]> {
    const where: any = {};

    // Apply search filters
    if (filters.email) where.email = { contains: filters.email };
    if (filters.username) where.username = { contains: filters.username };
    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }
    if (filters.storeId) where.storeId = filters.storeId;
    if (filters.organizationId) where.organizationId = filters.organizationId;
    if (filters.roleId) where.roleId = filters.roleId;
    if (filters.emailVerified !== undefined)
      where.emailVerified = filters.emailVerified;
    if (filters.isDeleted !== undefined) where.isDeleted = filters.isDeleted;
    if (filters.createdAfter) where.createdAt = { gte: filters.createdAfter };
    if (filters.createdBefore) {
      where.createdAt = { ...where.createdAt, lte: filters.createdBefore };
    }
    if (filters.lastLoginAfter)
      where.lastLoginAt = { gte: filters.lastLoginAfter };

    return await this.findMany({ where }, context);
  }

  /**
   * Update user's last login timestamp
   */
  async updateLastLogin(id: EntityId, context?: TenantContext): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id },
        data: {
          lastLoginAt: new Date(),
          loginCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      await this.createAuditEntry("UPDATE", id, { action: "login" }, context);
    } catch (error) {
      this.handleError(error, "updateLastLogin");
    }
  }

  /**
   * Assign role to user with audit trail
   */
  async assignRole(
    userId: EntityId,
    roleId: string,
    expiresAt?: Date,
    context?: TenantContext
  ): Promise<User> {
    try {
      const updateData: UpdateUserInput = {
        roleId,
        roleAssignedAt: new Date(),
        roleAssignedBy: context?.userId ?? null,
        roleExpiresAt: expiresAt || null,
        roleRevokedAt: null,
        roleRevokedBy: null,
        updatedBy: context?.userId ?? null,
      };

      const updatedUser = await this.update(userId, updateData, context);

      await this.createAuditEntry(
        "UPDATE",
        userId,
        {
          action: "role_assigned",
          roleId,
          expiresAt,
        },
        context
      );

      return updatedUser;
    } catch (error) {
      this.handleError(error, "assignRole");
    }
  }

  /**
   * Revoke role from user with audit trail
   */
  async revokeRole(userId: EntityId, context?: TenantContext): Promise<User> {
    try {
      const updateData: UpdateUserInput = {
        roleRevokedAt: new Date(),
        roleRevokedBy: context?.userId ?? null,
        updatedBy: context?.userId ?? null,
      };

      const updatedUser = await this.update(userId, updateData, context);

      await this.createAuditEntry(
        "UPDATE",
        userId,
        {
          action: "role_revoked",
        },
        context
      );

      return updatedUser;
    } catch (error) {
      this.handleError(error, "revokeRole");
    }
  }

  /**
   * Validate email uniqueness within tenant context
   */
  private async validateEmailUniqueness(
    email: string,
    context?: TenantContext
  ): Promise<void> {
    const existingUser = await this.findByEmail(email, context);
    if (existingUser) {
      throw new Error(`User with email ${email} already exists in this tenant`);
    }
  }

  /**
   * Get changes between existing entity and update data
   */
  private getChanges(
    existing: User,
    updates: UpdateUserInput
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
