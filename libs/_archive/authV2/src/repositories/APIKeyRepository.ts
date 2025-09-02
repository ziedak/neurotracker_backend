/**
 * @fileoverview API Key Repository Implementation
 * @module repositories/APIKexport class APIKeyRepository extends BaseRepository<
  IAPIKeyInfo,
  CreateAPIKeyInput,
  UpdateAPIKeyInput
> {
  protected readonly entityName = "ApiKey";
*/

import type { EntityId, TenantContext } from "../types/core";
import type { IAPIKeyInfo } from "../contracts/services";
import {
  BaseRepository,
  FindManyOptions,
  CountOptions,
  EntityNotFoundError,
  TenantAccessError,
} from "./base/BaseRepository";

/**
 * API Key creation input interface
 */
export interface CreateAPIKeyInput {
  id: string;
  hashedKey: string;
  name: string;
  userId: string;
  scopes: string[];
  isActive?: boolean;
  expiresAt?: Date | null;
  createdAt?: Date;
  lastUsedAt?: Date | null;
  usageCount?: number;
  storeId?: string | null;
  organizationId?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * API Key update input interface
 */
export interface UpdateAPIKeyInput {
  hashedKey?: string;
  name?: string;
  scopes?: string[];
  isActive?: boolean;
  expiresAt?: Date | null;
  lastUsedAt?: Date | null;
  usageCount?: number;
  updatedBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * API Key search filters
 */
export interface APIKeySearchFilters {
  userId?: string;
  name?: string;
  hashedKey?: string;
  isActive?: boolean;
  storeId?: string;
  organizationId?: string;
  scopes?: string[];
  isDeleted?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
  expiresAfter?: Date;
  expiresBefore?: Date;
  lastUsedAfter?: Date;
}

/**
 * Enterprise API Key Repository with multi-tenant support
 *
 * Features:
 * - Tenant-aware operations
 * - Hashed key validation and lookup
 * - User association tracking
 * - Scope-based access control
 * - Usage statistics and analytics
 * - Audit logging for all operations
 * - Performance optimization with indexing
 */
export class APIKeyRepository extends BaseRepository<
  IAPIKeyInfo,
  CreateAPIKeyInput,
  UpdateAPIKeyInput
> {
  protected readonly entityName = "apikey";

  /**
   * Find API key by ID
   */
  async findById(
    id: EntityId,
    context?: TenantContext
  ): Promise<IAPIKeyInfo | null> {
    const startTime = Date.now();

    try {
      const where = this.applyTenantFilter({ id }, context);

      const result = await this.prisma.apiKey.findUnique({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              status: true,
            },
          },
        },
      });

      if (!result) {
        return null;
      }

      // Validate tenant access
      if (!this.validateAccess(result, context, "read")) {
        return null;
      }

      const apiKey = this.mapToAPIKeyInfo(result);

      this.logMetrics("findById", startTime);
      await this.createAuditEntry("READ", id, {}, context);

      return apiKey;
    } catch (error) {
      this.logMetrics("findById:error", startTime);
      this.handleError(error, "findById");
    }
  }

  /**
   * Find API key by ID with tenant context validation
   */
  async trackUsage(
    id: EntityId,
    context?: TenantContext
  ): Promise<IAPIKeyInfo> {
    const startTime = Date.now();

    try {
      const where = this.applyTenantFilter({ id }, context);

      const result = await this.prisma.apiKey.findUnique({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              status: true,
            },
          },
        },
      });

      if (!result) {
        throw new EntityNotFoundError(this.entityName, id);
      }

      // Validate tenant access
      if (!this.validateAccess(result, context, "read")) {
        throw new TenantAccessError(
          this.entityName,
          id,
          context?.storeId || undefined
        );
      }

      const apiKey = this.mapToAPIKeyInfo(result);

      this.logMetrics("findById", startTime);
      await this.createAuditEntry("READ", id, {}, context);

      return apiKey;
    } catch (error) {
      this.logMetrics("findById:error", startTime);
      if (error instanceof TenantAccessError) {
        throw error;
      }
      this.handleError(error, "findById");
    }
  }

  /**
   * Find API key by hashed key
   */
  async findByHashedKey(
    hashedKey: string,
    context?: TenantContext
  ): Promise<IAPIKeyInfo | null> {
    const startTime = Date.now();

    try {
      const baseWhere = { keyHash: hashedKey, isActive: true };
      const where = this.applyTenantFilter(baseWhere, context);

      const result = await this.prisma.apiKey.findUnique({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              status: true,
            },
          },
        },
      });

      if (!result) {
        return null;
      }

      // Validate tenant access
      if (!this.validateAccess(result, context, "read")) {
        return null; // Don't throw error for key validation, just return null
      }

      const apiKey = this.mapToAPIKeyInfo(result);

      this.logMetrics("findByHashedKey", startTime);
      await this.createAuditEntry(
        "READ",
        result.id,
        { lookup: "hashedKey" },
        context
      );

      return apiKey;
    } catch (error) {
      this.logMetrics("findByHashedKey:error", startTime);
      this.handleError(error, "findByHashedKey");
    }
  }

  /**
   * Find multiple API keys with advanced filtering
   */
  async findMany(
    filter: FindManyOptions<IAPIKeyInfo> & {
      searchFilters?: APIKeySearchFilters;
    },
    context?: TenantContext
  ): Promise<IAPIKeyInfo[]> {
    const startTime = Date.now();

    try {
      const where = this.buildWhereClause(
        filter.where,
        filter.searchFilters,
        context
      );

      const result = await this.prisma.apiKey.findMany({
        where,
        orderBy: this.buildOrderBy(filter.orderBy),
        ...(filter.skip !== undefined && { skip: filter.skip }),
        ...(filter.take !== undefined && { take: filter.take }),
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              status: true,
            },
          },
        },
      });

      const apiKeys = result
        .filter((item: any) => this.validateAccess(item, context, "read"))
        .map((item: any) => this.mapToAPIKeyInfo(item));

      this.logMetrics("findMany", startTime, apiKeys.length);
      await this.createAuditEntry(
        "READ",
        "multiple",
        { count: apiKeys.length },
        context
      );

      return apiKeys;
    } catch (error) {
      this.logMetrics("findMany:error", startTime);
      this.handleError(error, "findMany");
    }
  }

  /**
   * Find API keys by user ID
   */
  async findByUserId(
    userId: string,
    context?: TenantContext
  ): Promise<IAPIKeyInfo[]> {
    const startTime = Date.now();

    try {
      return await this.findMany(
        {
          searchFilters: { userId, isActive: true },
          orderBy: [
            { field: "createdAt" as keyof IAPIKeyInfo, direction: "desc" },
          ],
        },
        context
      );
    } catch (error) {
      this.logMetrics("findByUserId:error", startTime);
      this.handleError(error, "findByUserId");
    }
  }

  /**
   * Create new API key
   */
  async create(
    data: CreateAPIKeyInput,
    context?: TenantContext
  ): Promise<IAPIKeyInfo> {
    const startTime = Date.now();

    try {
      const createData = {
        id: data.id,
        keyHash: data.hashedKey, // Map hashedKey to keyHash for Prisma schema
        keyPreview: data.hashedKey.substring(0, 8), // Create preview from hashed key
        name: data.name,
        userId: data.userId,
        scopes: data.scopes,
        permissions: data.metadata?.["permissions"]
          ? JSON.parse(JSON.stringify(data.metadata["permissions"]))
          : null,
        storeId: context?.storeId || data.storeId || null,
        createdAt: data.createdAt || new Date(),
        lastUsedAt: data.lastUsedAt || null,
        usageCount: data.usageCount || 0,
        isActive: data.isActive !== undefined ? data.isActive : true,
        expiresAt: data.expiresAt || null,
        metadata: data.metadata
          ? JSON.parse(JSON.stringify(data.metadata))
          : null,
      };

      const result = await this.prisma.apiKey.create({
        data: createData,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              status: true,
            },
          },
        },
      });

      const apiKey = this.mapToAPIKeyInfo(result);

      this.logMetrics("create", startTime);
      await this.createAuditEntry("CREATE", result.id, createData, context);

      return apiKey;
    } catch (error) {
      this.logMetrics("create:error", startTime);
      this.handleError(error, "create");
    }
  }

  /**
   * Update API key
   */
  async update(
    id: EntityId,
    data: UpdateAPIKeyInput,
    context?: TenantContext
  ): Promise<IAPIKeyInfo> {
    const startTime = Date.now();

    try {
      // First verify the key exists and we have access
      const existing = await this.findById(id, context);
      if (!existing) {
        throw new EntityNotFoundError(this.entityName, id);
      }

      const updateData: any = {
        updatedAt: new Date(),
      };

      // Only update fields that exist in schema
      if (data.hashedKey) updateData.keyHash = data.hashedKey;
      if (data.name !== undefined) updateData.name = data.name;
      if (data.scopes !== undefined) updateData.scopes = data.scopes;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;
      if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt;
      if (data.lastUsedAt !== undefined)
        updateData.lastUsedAt = data.lastUsedAt;
      if (data.usageCount !== undefined)
        updateData.usageCount = data.usageCount;
      if (data.metadata !== undefined) {
        updateData.metadata = data.metadata
          ? JSON.parse(JSON.stringify(data.metadata))
          : null;
      }

      const result = await this.prisma.apiKey.update({
        where: { id },
        data: updateData,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              status: true,
            },
          },
        },
      });

      const apiKey = this.mapToAPIKeyInfo(result);

      this.logMetrics("update", startTime);
      await this.createAuditEntry("UPDATE", id, updateData, context);

      return apiKey;
    } catch (error) {
      this.logMetrics("update:error", startTime);
      if (error instanceof EntityNotFoundError) {
        throw error;
      }
      this.handleError(error, "update");
    }
  }

  /**
   * Update API key usage (last used time and usage count)
   */
  async updateUsage(id: EntityId): Promise<IAPIKeyInfo> {
    const startTime = Date.now();

    try {
      const result = await this.prisma.apiKey.update({
        where: { id },
        data: {
          lastUsedAt: new Date(),
          usageCount: {
            increment: 1,
          },
          updatedAt: new Date(),
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              status: true,
            },
          },
        },
      });

      const apiKey = this.mapToAPIKeyInfo(result);

      this.logMetrics("updateUsage", startTime);
      // Don't create audit entries for usage updates to avoid spam

      return apiKey;
    } catch (error) {
      this.logMetrics("updateUsage:error", startTime);
      this.handleError(error, "updateUsage");
    }
  }

  /**
   * Soft delete API key
   */
  async delete(id: EntityId, context?: TenantContext): Promise<boolean> {
    const startTime = Date.now();

    try {
      // First verify the key exists and we have access
      const existing = await this.findById(id, context);
      if (!existing) {
        return false;
      }

      await this.prisma.apiKey.update({
        where: { id },
        data: {
          isActive: false,
          revokedAt: new Date(),
          revokedBy: context?.userId || null,
          updatedAt: new Date(),
        },
      });

      this.logMetrics("delete", startTime);
      await this.createAuditEntry("DELETE", id, { soft: true }, context);

      return true;
    } catch (error) {
      this.logMetrics("delete:error", startTime);
      return false;
    }
  }

  /**
   * Count API keys matching filter
   */
  async count(
    filter?: CountOptions<IAPIKeyInfo> & {
      searchFilters?: APIKeySearchFilters;
    },
    context?: TenantContext
  ): Promise<number> {
    const startTime = Date.now();

    try {
      const where = this.buildWhereClause(
        filter?.where,
        filter?.searchFilters,
        context
      );

      const count = await this.prisma.apiKey.count({ where });

      this.logMetrics("count", startTime);
      return count;
    } catch (error) {
      this.logMetrics("count:error", startTime);
      this.handleError(error, "count");
    }
  }

  /**
   * Private helper methods
   */
  private buildWhereClause(
    where?: Partial<IAPIKeyInfo>,
    searchFilters?: APIKeySearchFilters,
    context?: TenantContext
  ): any {
    let whereClause: any = { ...where };

    // Apply search filters
    if (searchFilters) {
      if (searchFilters.userId) {
        whereClause.userId = searchFilters.userId;
      }
      if (searchFilters.name) {
        whereClause.name = {
          contains: searchFilters.name,
          mode: "insensitive",
        };
      }
      if (searchFilters.hashedKey) {
        whereClause.keyHash = searchFilters.hashedKey;
      }
      if (searchFilters.isActive !== undefined) {
        whereClause.isActive = searchFilters.isActive;
      }
      if (searchFilters.scopes && searchFilters.scopes.length > 0) {
        whereClause.scopes = { hasSome: searchFilters.scopes };
      }
      if (searchFilters.createdAfter || searchFilters.createdBefore) {
        whereClause.createdAt = {};
        if (searchFilters.createdAfter) {
          whereClause.createdAt.gte = searchFilters.createdAfter;
        }
        if (searchFilters.createdBefore) {
          whereClause.createdAt.lte = searchFilters.createdBefore;
        }
      }
      if (searchFilters.expiresAfter || searchFilters.expiresBefore) {
        whereClause.expiresAt = {};
        if (searchFilters.expiresAfter) {
          whereClause.expiresAt.gte = searchFilters.expiresAfter;
        }
        if (searchFilters.expiresBefore) {
          whereClause.expiresAt.lte = searchFilters.expiresBefore;
        }
      }
      if (searchFilters.lastUsedAfter) {
        whereClause.lastUsedAt = { gte: searchFilters.lastUsedAfter };
      }
    }

    // Apply tenant filtering
    return this.applyTenantFilter(whereClause, context);
  }

  private buildOrderBy(
    orderBy?: Array<{ field: keyof IAPIKeyInfo; direction: "asc" | "desc" }>
  ): any {
    if (!orderBy || orderBy.length === 0) {
      return { createdAt: "desc" };
    }

    return orderBy.map(({ field, direction }) => ({ [field]: direction }));
  }

  private mapToAPIKeyInfo(dbResult: any): IAPIKeyInfo {
    return {
      id: dbResult.id,
      name: dbResult.name,
      userId: dbResult.userId,
      scopes: dbResult.scopes,
      isActive: dbResult.isActive,
      expiresAt: dbResult.expiresAt,
      createdAt: dbResult.createdAt,
      lastUsedAt: dbResult.lastUsedAt,
      usageCount: dbResult.usageCount,
    };
  }
}
