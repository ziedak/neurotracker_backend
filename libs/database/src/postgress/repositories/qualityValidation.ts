/**
 * @fileoverview QualityValidation Repository Implementation
 * @module database/repositories/qualityValidation
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  QualityValidation,
  QualityValidationCreateInput,
  QualityValidationUpdateInput,
} from "../../models";
import type { Prisma } from "@prisma/client";

/**
 * QualityValidation repository interface
 */
export interface IQualityValidationRepository
  extends BaseRepository<
    QualityValidation,
    QualityValidationCreateInput,
    QualityValidationUpdateInput
  > {
  /**
   * Find validations by table
   */
  findByTable(
    table: string,
    options?: QueryOptions
  ): Promise<QualityValidation[]>;

  /**
   * Find validations by check
   */
  findByCheck(
    check: string,
    options?: QueryOptions
  ): Promise<QualityValidation[]>;

  /**
   * Find validations by status
   */
  findByStatus(
    status: string,
    options?: QueryOptions
  ): Promise<QualityValidation[]>;

  /**
   * Find validations within date range
   */
  findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<QualityValidation[]>;

  /**
   * Find failed validations
   */
  findFailed(options?: QueryOptions): Promise<QualityValidation[]>;

  /**
   * Find passed validations
   */
  findPassed(options?: QueryOptions): Promise<QualityValidation[]>;

  /**
   * Get validation statistics
   */
  getValidationStats(): Promise<{
    total: number;
    passed: number;
    failed: number;
    byTable: { table: string; count: number; passed: number; failed: number }[];
    byCheck: { check: string; count: number; passed: number; failed: number }[];
  }>;

  /**
   * Get latest validation for table
   */
  getLatestForTable(table: string): Promise<QualityValidation | null>;

  /**
   * Clean up old validations
   */
  cleanupOldValidations(olderThan: Date): Promise<{ count: number }>;
}

/**
 * QualityValidation repository implementation
 */
export class QualityValidationRepository
  extends BaseRepository<
    QualityValidation,
    QualityValidationCreateInput,
    QualityValidationUpdateInput
  >
  implements IQualityValidationRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "QualityValidation", metricsCollector);
  }

  /**
   * Find quality validation by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<QualityValidation | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.QualityValidationFindUniqueArgs;

      const result = await this.db.qualityValidation.findUnique(queryOptions);
      return result as QualityValidation | null;
    });
  }

  /**
   * Find multiple quality validations
   */
  async findMany(options?: QueryOptions): Promise<QualityValidation[]> {
    return this.executeOperation("findMany", async () => {
      // QualityValidation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityValidation.findMany(queryOptions);
      return result as QualityValidation[];
    });
  }

  /**
   * Find first quality validation matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<QualityValidation | null> {
    return this.executeOperation("findFirst", async () => {
      // QualityValidation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityValidation.findFirst(queryOptions);
      return result as QualityValidation | null;
    });
  }

  /**
   * Count quality validations
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.db.qualityValidation.count as any)(countOptions);
    });
  }

  /**
   * Create new quality validation
   */
  async create(data: QualityValidationCreateInput): Promise<QualityValidation> {
    return this.executeOperation("create", async () => {
      const result = await this.db.qualityValidation.create({
        data: {
          ...data,
          executedAt: data.executedAt ?? new Date(),
        },
      });
      return result as QualityValidation;
    });
  }

  /**
   * Create multiple quality validations
   */
  async createMany(
    data: QualityValidationCreateInput[]
  ): Promise<QualityValidation[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((validationData) =>
          this.db.qualityValidation.create({
            data: {
              ...validationData,
              executedAt: validationData.executedAt ?? new Date(),
            },
          })
        )
      );
      return results as QualityValidation[];
    });
  }

  /**
   * Update quality validation by ID
   */
  async updateById(
    id: string,
    data: QualityValidationUpdateInput
  ): Promise<QualityValidation> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.qualityValidation.update({
        where: { id },
        data,
      });
      return result as QualityValidation;
    });
  }

  /**
   * Update multiple quality validations
   */
  async updateMany(
    where: Record<string, unknown>,
    data: QualityValidationUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.qualityValidation.updateMany({
        where,
        data,
      });
    });
  }

  /**
   * Delete quality validation by ID
   */
  async deleteById(id: string): Promise<QualityValidation> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.qualityValidation.delete({
        where: { id },
      });
      return result as QualityValidation;
    });
  }

  /**
   * Delete multiple quality validations
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.qualityValidation.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if quality validation exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.qualityValidation.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IQualityValidationRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new QualityValidationRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find validations by table
   */
  async findByTable(
    table: string,
    options?: QueryOptions
  ): Promise<QualityValidation[]> {
    return this.executeOperation("findByTable", async () => {
      // QualityValidation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityValidation.findMany({
        where: { tableName: table, ...queryOptions.where },
        ...queryOptions,
      });
      return result as QualityValidation[];
    });
  }

  /**
   * Find validations by check
   */
  async findByCheck(
    check: string,
    options?: QueryOptions
  ): Promise<QualityValidation[]> {
    return this.executeOperation("findByCheck", async () => {
      // QualityValidation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityValidation.findMany({
        where: { checkName: check, ...queryOptions.where },
        ...queryOptions,
      });
      return result as QualityValidation[];
    });
  }

  /**
   * Find validations by status
   */
  async findByStatus(
    status: string,
    options?: QueryOptions
  ): Promise<QualityValidation[]> {
    return this.executeOperation("findByStatus", async () => {
      // QualityValidation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityValidation.findMany({
        where: { status, ...queryOptions.where },
        ...queryOptions,
      });
      return result as QualityValidation[];
    });
  }

  /**
   * Find validations within date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<QualityValidation[]> {
    return this.executeOperation("findByDateRange", async () => {
      // QualityValidation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityValidation.findMany({
        where: {
          executedAt: {
            gte: startDate,
            lte: endDate,
          },
          ...queryOptions.where,
        },
        ...queryOptions,
      });
      return result as QualityValidation[];
    });
  }

  /**
   * Find failed validations
   */
  async findFailed(options?: QueryOptions): Promise<QualityValidation[]> {
    return this.executeOperation("findFailed", async () => {
      // QualityValidation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityValidation.findMany({
        where: {
          status: "FAILED",
          ...queryOptions.where,
        },
        ...queryOptions,
      });
      return result as QualityValidation[];
    });
  }

  /**
   * Find passed validations
   */
  async findPassed(options?: QueryOptions): Promise<QualityValidation[]> {
    return this.executeOperation("findPassed", async () => {
      // QualityValidation has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityValidation.findMany({
        where: {
          status: "PASSED",
          ...queryOptions.where,
        },
        ...queryOptions,
      });
      return result as QualityValidation[];
    });
  }

  /**
   * Get validation statistics
   */
  async getValidationStats(): Promise<{
    total: number;
    passed: number;
    failed: number;
    byTable: { table: string; count: number; passed: number; failed: number }[];
    byCheck: { check: string; count: number; passed: number; failed: number }[];
  }> {
    return this.executeOperation("getValidationStats", async () => {
      const [total, passed, failed, byTableResult, byCheckResult] =
        await Promise.all([
          this.db.qualityValidation.count(),
          this.db.qualityValidation.count({ where: { status: "PASSED" } }),
          this.db.qualityValidation.count({ where: { status: "FAILED" } }),
          this.db.qualityValidation.groupBy({
            by: ["tableName"],
            _count: {
              tableName: true,
            },
            where: {
              status: "PASSED",
            },
          }),
          this.db.qualityValidation.groupBy({
            by: ["checkName"],
            _count: {
              checkName: true,
            },
            where: {
              status: "PASSED",
            },
          }),
        ]);

      // Get failed counts for each table and check
      const tableFailedCounts = await this.db.qualityValidation.groupBy({
        by: ["tableName"],
        _count: {
          tableName: true,
        },
        where: {
          status: "FAILED",
        },
      });

      const checkFailedCounts = await this.db.qualityValidation.groupBy({
        by: ["checkName"],
        _count: {
          checkName: true,
        },
        where: {
          status: "FAILED",
        },
      });

      const tablePassedMap = new Map(
        byTableResult.map((item) => [item.tableName, item._count.tableName])
      );
      const tableFailedMap = new Map(
        tableFailedCounts.map((item) => [item.tableName, item._count.tableName])
      );

      const checkPassedMap = new Map(
        byCheckResult.map((item) => [item.checkName, item._count.checkName])
      );
      const checkFailedMap = new Map(
        checkFailedCounts.map((item) => [item.checkName, item._count.checkName])
      );

      // Get all unique tables and checks
      const allTables = new Set([
        ...tablePassedMap.keys(),
        ...tableFailedMap.keys(),
      ]);
      const allChecks = new Set([
        ...checkPassedMap.keys(),
        ...checkFailedMap.keys(),
      ]);

      const byTable = Array.from(allTables).map((table) => ({
        table,
        count:
          (tablePassedMap.get(table) ?? 0) + (tableFailedMap.get(table) ?? 0),
        passed: tablePassedMap.get(table) ?? 0,
        failed: tableFailedMap.get(table) ?? 0,
      }));

      const byCheck = Array.from(allChecks).map((check) => ({
        check,
        count:
          (checkPassedMap.get(check) ?? 0) + (checkFailedMap.get(check) ?? 0),
        passed: checkPassedMap.get(check) ?? 0,
        failed: checkFailedMap.get(check) ?? 0,
      }));

      return {
        total,
        passed,
        failed,
        byTable,
        byCheck,
      };
    });
  }

  /**
   * Get latest validation for table
   */
  async getLatestForTable(table: string): Promise<QualityValidation | null> {
    return this.executeOperation("getLatestForTable", async () => {
      const result = await this.db.qualityValidation.findFirst({
        where: { tableName: table },
        orderBy: {
          executedAt: "desc",
        },
      });
      return result as QualityValidation | null;
    });
  }

  /**
   * Clean up old validations
   */
  async cleanupOldValidations(olderThan: Date): Promise<{ count: number }> {
    return this.executeOperation("cleanupOldValidations", async () => {
      return this.db.qualityValidation.deleteMany({
        where: {
          executedAt: {
            lt: olderThan,
          },
        },
      });
    });
  }
}
