/**
 * @fileoverview RepairOperation Repository Implementation
 * @module database/repositories/repairOperation
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { RepairOperation } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * RepairOperation creation input type
 */
export type RepairOperationCreateInput = Omit<
  Prisma.RepairOperationCreateInput,
  "id" | "executedAt"
> & {
  id?: string;
  executedAt?: Date;
};

/**
 * RepairOperation update input type
 */
export type RepairOperationUpdateInput = Prisma.RepairOperationUpdateInput;

/**
 * RepairOperation repository interface
 */
export interface IRepairOperationRepository
  extends BaseRepository<
    RepairOperation,
    RepairOperationCreateInput,
    RepairOperationUpdateInput
  > {
  /**
   * Find operations by operation ID
   */
  findByOperationId(
    operationId: string,
    options?: QueryOptions
  ): Promise<RepairOperation[]>;

  /**
   * Find operations by status
   */
  findByStatus(
    status: string,
    options?: QueryOptions
  ): Promise<RepairOperation[]>;

  /**
   * Find successful operations
   */
  findSuccessful(options?: QueryOptions): Promise<RepairOperation[]>;

  /**
   * Find failed operations
   */
  findFailed(options?: QueryOptions): Promise<RepairOperation[]>;

  /**
   * Find operations by type
   */
  findByType(type: string, options?: QueryOptions): Promise<RepairOperation[]>;

  /**
   * Find operations within date range
   */
  findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<RepairOperation[]>;

  /**
   * Get repair operation statistics
   */
  getOperationStats(): Promise<{
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    byStatus: { status: string; count: number }[];
    byType: { type: string; count: number }[];
    recentOperations: { date: string; count: number }[];
  }>;

  /**
   * Clean up old operations
   */
  cleanupOldOperations(olderThan: Date): Promise<{ count: number }>;
}

/**
 * RepairOperation repository implementation
 */
export class RepairOperationRepository
  extends BaseRepository<
    RepairOperation,
    RepairOperationCreateInput,
    RepairOperationUpdateInput
  >
  implements IRepairOperationRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "RepairOperation", metricsCollector);
  }

  /**
   * Find repair operation by ID
   */
  async findById(id: string): Promise<RepairOperation | null> {
    return this.executeOperation("findById", async () => {
      const result = await this.db.repairOperation.findUnique({
        where: { id },
      });
      return result as RepairOperation | null;
    });
  }

  /**
   * Find multiple repair operations
   */
  async findMany(options?: QueryOptions): Promise<RepairOperation[]> {
    return this.executeOperation("findMany", async () => {
      // RepairOperation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.repairOperation.findMany({
        ...queryOptions,
      });
      return result as RepairOperation[];
    });
  }

  /**
   * Find first repair operation matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<RepairOperation | null> {
    return this.executeOperation("findFirst", async () => {
      // RepairOperation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.repairOperation.findFirst({
        ...queryOptions,
      });
      return result as RepairOperation | null;
    });
  }

  /**
   * Count repair operations
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      return this.db.repairOperation.count(countOptions);
    });
  }

  /**
   * Create new repair operation
   */
  async create(data: RepairOperationCreateInput): Promise<RepairOperation> {
    return this.executeOperation("create", async () => {
      const result = await this.db.repairOperation.create({
        data: {
          ...data,
          executedAt: data.executedAt ?? new Date(),
        },
      });
      return result as RepairOperation;
    });
  }

  /**
   * Create multiple repair operations
   */
  async createMany(
    data: RepairOperationCreateInput[]
  ): Promise<RepairOperation[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((operationData) =>
          this.db.repairOperation.create({
            data: {
              ...operationData,
              executedAt: operationData.executedAt ?? new Date(),
            },
          })
        )
      );
      return results as RepairOperation[];
    });
  }

  /**
   * Update repair operation by ID
   */
  async updateById(
    id: string,
    data: RepairOperationUpdateInput
  ): Promise<RepairOperation> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.repairOperation.update({
        where: { id },
        data,
      });
      return result as RepairOperation;
    });
  }

  /**
   * Update multiple repair operations
   */
  async updateMany(
    where: Record<string, unknown>,
    data: RepairOperationUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.repairOperation.updateMany({
        where,
        data,
      });
    });
  }

  /**
   * Delete repair operation by ID
   */
  async deleteById(id: string): Promise<RepairOperation> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.repairOperation.delete({
        where: { id },
      });
      return result as RepairOperation;
    });
  }

  /**
   * Delete multiple repair operations
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.repairOperation.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if repair operation exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.repairOperation.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IRepairOperationRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new RepairOperationRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find operations by operation ID
   */
  async findByOperationId(
    operationId: string,
    options?: QueryOptions
  ): Promise<RepairOperation[]> {
    return this.executeOperation("findByOperationId", async () => {
      // RepairOperation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.repairOperation.findMany({
        where: { operationId, ...queryOptions.where },
        ...queryOptions,
      });
      return result as RepairOperation[];
    });
  }

  /**
   * Find operations by status
   */
  async findByStatus(
    status: string,
    options?: QueryOptions
  ): Promise<RepairOperation[]> {
    return this.executeOperation("findByStatus", async () => {
      // RepairOperation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.repairOperation.findMany({
        where: { status, ...queryOptions.where },
        ...queryOptions,
      });
      return result as RepairOperation[];
    });
  }

  /**
   * Find successful operations
   */
  async findSuccessful(options?: QueryOptions): Promise<RepairOperation[]> {
    return this.executeOperation("findSuccessful", async () => {
      // RepairOperation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.repairOperation.findMany({
        where: { status: "success", ...queryOptions.where },
        ...queryOptions,
      });
      return result as RepairOperation[];
    });
  }

  /**
   * Find failed operations
   */
  async findFailed(options?: QueryOptions): Promise<RepairOperation[]> {
    return this.executeOperation("findFailed", async () => {
      // RepairOperation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.repairOperation.findMany({
        where: { status: "failed", ...queryOptions.where },
        ...queryOptions,
      });
      return result as RepairOperation[];
    });
  }

  /**
   * Find operations by type
   */
  async findByType(
    type: string,
    options?: QueryOptions
  ): Promise<RepairOperation[]> {
    return this.executeOperation("findByType", async () => {
      // RepairOperation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.repairOperation.findMany({
        where: { type, ...queryOptions.where },
        ...queryOptions,
      });
      return result as RepairOperation[];
    });
  }

  /**
   * Find operations within date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<RepairOperation[]> {
    return this.executeOperation("findByDateRange", async () => {
      // RepairOperation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.repairOperation.findMany({
        where: {
          executedAt: {
            gte: startDate,
            lte: endDate,
          },
          ...queryOptions.where,
        },
        ...queryOptions,
      });
      return result as RepairOperation[];
    });
  }

  /**
   * Get repair operation statistics
   */
  async getOperationStats(): Promise<{
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    byStatus: { status: string; count: number }[];
    byType: { type: string; count: number }[];
    recentOperations: { date: string; count: number }[];
  }> {
    return this.executeOperation("getOperationStats", async () => {
      const [
        totalOperations,
        successfulOperations,
        failedOperations,
        byStatusResult,
        byTypeResult,
        recentOperations,
      ] = await Promise.all([
        this.db.repairOperation.count(),
        this.db.repairOperation.count({ where: { status: "success" } }),
        this.db.repairOperation.count({ where: { status: "failed" } }),
        this.db.repairOperation.groupBy({
          by: ["status"],
          _count: {
            status: true,
          },
        }),
        this.db.repairOperation.groupBy({
          by: ["type"],
          _count: {
            type: true,
          },
        }),
        this.db.repairOperation.findMany({
          select: {
            executedAt: true,
          },
          orderBy: {
            executedAt: "desc",
          },
          take: 100,
        }),
      ]);

      const byStatus = byStatusResult.map((item) => ({
        status: item.status,
        count: item._count.status,
      }));

      const byType = byTypeResult.map((item) => ({
        type: item.type,
        count: item._count.type,
      }));

      // Calculate recent operations by date
      const operationsByDate = new Map<string, number>();
      recentOperations.forEach((operation) => {
        const [date] = operation.executedAt.toISOString().split("T");
        if (date) {
          operationsByDate.set(date, (operationsByDate.get(date) ?? 0) + 1);
        }
      });

      const recentOperationsCount = Array.from(operationsByDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-7) // Last 7 days
        .map(([date, count]) => ({
          date,
          count,
        }));

      return {
        totalOperations,
        successfulOperations,
        failedOperations,
        byStatus,
        byType,
        recentOperations: recentOperationsCount,
      };
    });
  }

  /**
   * Clean up old operations
   */
  async cleanupOldOperations(olderThan: Date): Promise<{ count: number }> {
    return this.executeOperation("cleanupOldOperations", async () => {
      return this.db.repairOperation.deleteMany({
        where: {
          executedAt: {
            lt: olderThan,
          },
        },
      });
    });
  }
}
