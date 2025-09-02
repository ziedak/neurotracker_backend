/**
 * @fileoverview Base Repository Pattern for Enterprise AuthV2
 * @module repositories/base/BaseRepository
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, TenantContext } from "../../types/core";

/**
 * Import proper database client types to maintain clean architecture
 * This maintains dependency inversion principle with proper typing
 */
import {
  PostgreSQLClient,
  type DatabaseClient,
  type TransactionCallback,
} from "@libs/database";

/**
 * Base repository interface defining core CRUD operations
 */
export interface IBaseRepository<TEntity, TCreateInput, TUpdateInput> {
  findById(id: EntityId, context?: TenantContext): Promise<TEntity | null>;
  findMany(
    filter: FindManyOptions<TEntity>,
    context?: TenantContext
  ): Promise<TEntity[]>;
  create(data: TCreateInput, context?: TenantContext): Promise<TEntity>;
  update(
    id: EntityId,
    data: TUpdateInput,
    context?: TenantContext
  ): Promise<TEntity>;
  delete(id: EntityId, context?: TenantContext): Promise<boolean>;
  count(
    filter?: CountOptions<TEntity>,
    context?: TenantContext
  ): Promise<number>;
}

/**
 * Find many options interface
 */
export interface FindManyOptions<TEntity> {
  where?: Partial<TEntity> & Record<string, any>;
  orderBy?: Array<{
    field: keyof TEntity;
    direction: "asc" | "desc";
  }>;
  skip?: number;
  take?: number;
  include?: Record<string, boolean>;
}

/**
 * Count options interface
 */
export interface CountOptions<TEntity> {
  where?: Partial<TEntity> & Record<string, any>;
}

/**
 * Transaction callback type
 */
export type { TransactionCallback };

/**
 * Audit entry interface
 */
export interface IAuditEntry {
  entityType: string;
  entityId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "READ";
  changes: Record<string, unknown>;
  userId: string | null;
  storeId: string | null;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

/**
 * Abstract base repository implementing clean architecture patterns
 *
 * Features:
 * - Tenant-aware operations
 * - Transaction support
 * - Audit logging
 * - Type-safe CRUD operations
 * - Performance monitoring
 */
export abstract class BaseRepository<TEntity, TCreateInput, TUpdateInput>
  implements IBaseRepository<TEntity, TCreateInput, TUpdateInput>
{
  protected readonly prisma: DatabaseClient;
  protected abstract readonly entityName: string;

  constructor(prisma?: DatabaseClient) {
    this.prisma = prisma || PostgreSQLClient.getInstance();
  }

  /**
   * Find entity by ID with tenant context
   */
  abstract findById(
    id: EntityId,
    context?: TenantContext
  ): Promise<TEntity | null>;

  /**
   * Find multiple entities with filtering and pagination
   */
  abstract findMany(
    filter: FindManyOptions<TEntity>,
    context?: TenantContext
  ): Promise<TEntity[]>;

  /**
   * Create new entity with audit logging
   */
  abstract create(
    data: TCreateInput,
    context?: TenantContext
  ): Promise<TEntity>;

  /**
   * Update entity with audit logging
   */
  abstract update(
    id: EntityId,
    data: TUpdateInput,
    context?: TenantContext
  ): Promise<TEntity>;

  /**
   * Soft delete entity (sets deletedAt and isDeleted)
   */
  abstract delete(id: EntityId, context?: TenantContext): Promise<boolean>;

  /**
   * Count entities matching filter
   */
  abstract count(
    filter?: CountOptions<TEntity>,
    context?: TenantContext
  ): Promise<number>;

  /**
   * Execute operations within a database transaction
   */
  async executeInTransaction<TResult>(
    callback: TransactionCallback<TResult>
  ): Promise<TResult> {
    // Type assertion: we know prisma has $transaction method
    return await (
      this.prisma as unknown as {
        $transaction: (
          callback: TransactionCallback<TResult>
        ) => Promise<TResult>;
      }
    ).$transaction(callback);
  }

  /**
   * Execute multiple operations in a single transaction
   */
  async batchOperations<TResult>(
    operations: Array<TransactionCallback<TResult>>
  ): Promise<TResult[]> {
    const results: TResult[] = [];
    return await (
      this.prisma as unknown as {
        $transaction: (
          callback: TransactionCallback<TResult[]>
        ) => Promise<TResult[]>;
      }
    ).$transaction(async (prisma) => {
      for (const operation of operations) {
        const result = await operation(prisma);
        results.push(result);
      }
      return results;
    });
  }

  /**
   * Create audit entry for entity changes
   */
  protected async createAuditEntry(
    action: IAuditEntry["action"],
    entityId: string,
    changes: Record<string, unknown>,
    context?: TenantContext,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      // Note: In Phase 3, this will integrate with proper audit service
      // For now, we'll create a basic audit log structure
      const auditEntry: IAuditEntry = {
        entityType: this.entityName,
        entityId,
        action,
        changes,
        userId: context?.userId || null,
        storeId: context?.storeId || null,
        timestamp: new Date(),
        metadata,
      };

      // TODO Phase 3: Implement proper audit service
      console.log(`[AUDIT] ${JSON.stringify(auditEntry)}`);
    } catch (error) {
      // Never let audit failures break business operations
      console.error(`Failed to create audit entry: ${error}`);
    }
  }

  /**
   * Apply tenant context filtering to where clause
   */
  protected applyTenantFilter<T extends Record<string, any>>(
    where: T,
    context?: TenantContext
  ): T {
    if (!context) return where;

    const tenantWhere = { ...where };

    // Apply store-level tenant isolation
    if (context.storeId) {
      (tenantWhere as any).storeId = context.storeId;
    }

    // Apply organization-level tenant isolation
    if (context.organizationId) {
      (tenantWhere as any).organizationId = context.organizationId;
    }

    // Always exclude soft-deleted records unless explicitly requested
    if (!tenantWhere.hasOwnProperty("isDeleted")) {
      (tenantWhere as any).isDeleted = false;
    }

    return tenantWhere;
  }

  /**
   * Validate entity access permissions
   */
  protected validateAccess(
    entity: any,
    context?: TenantContext,
    action: "read" | "write" | "delete" = "read"
  ): boolean {
    if (!context) return true;

    // Store-level access control
    if (context.storeId && entity.storeId !== context.storeId) {
      return false;
    }

    // Organization-level access control
    if (
      context.organizationId &&
      entity.organizationId !== context.organizationId
    ) {
      return false;
    }

    // Role-based access control (basic implementation)
    // TODO Phase 3: Implement full RBAC with permission checking
    const requiredPermissions = this.getRequiredPermissions(action);
    const hasPermission = requiredPermissions.every((permission) =>
      context.permissions.includes(permission)
    );

    return hasPermission;
  }

  /**
   * Get required permissions for operation
   */
  protected getRequiredPermissions(
    action: "read" | "write" | "delete"
  ): string[] {
    const base = this.entityName.toLowerCase();
    switch (action) {
      case "read":
        return [`${base}.read`];
      case "write":
        return [`${base}.write`];
      case "delete":
        return [`${base}.delete`];
      default:
        return [];
    }
  }

  /**
   * Handle repository errors with proper typing
   */
  protected handleError(error: unknown, operation: string): never {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `${this.entityName} repository ${operation} failed: ${message}`
    );
  }

  /**
   * Log performance metrics
   */
  protected logMetrics(
    operation: string,
    startTime: number,
    recordCount?: number
  ): void {
    const duration = Date.now() - startTime;
    console.log(
      `[METRICS] ${this.entityName}.${operation}: ${duration}ms${
        recordCount ? ` (${recordCount} records)` : ""
      }`
    );
  }
}

/**
 * Repository error types
 */
export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly entityType: string,
    public readonly operation: string,
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export class TenantAccessError extends RepositoryError {
  constructor(entityType: string, entityId: string, tenantId?: string) {
    super(
      `Access denied to ${entityType} ${entityId} for tenant ${
        tenantId || "unknown"
      }`,
      entityType,
      "access_check"
    );
    this.name = "TenantAccessError";
  }
}

export class EntityNotFoundError extends RepositoryError {
  constructor(entityType: string, identifier: string) {
    super(`${entityType} not found: ${identifier}`, entityType, "find");
    this.name = "EntityNotFoundError";
  }
}
