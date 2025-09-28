/**
 * @fileoverview ReconciliationRule Repository Implementation
 * @module database/repositories/reconciliationRule
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { ReconciliationRule } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * ReconciliationRule creation input type
 */
export type ReconciliationRuleCreateInput = Omit<
  Prisma.ReconciliationRuleCreateInput,
  "id" | "createdAt"
> & {
  id?: string;
};

/**
 * ReconciliationRule update input type
 */
export type ReconciliationRuleUpdateInput =
  Prisma.ReconciliationRuleUpdateInput;

/**
 * ReconciliationRule repository interface
 */
export interface IReconciliationRuleRepository
  extends BaseRepository<
    ReconciliationRule,
    ReconciliationRuleCreateInput,
    ReconciliationRuleUpdateInput
  > {
  /**
   * Find rules by source table
   */
  findBySourceTable(
    sourceTable: string,
    options?: QueryOptions
  ): Promise<ReconciliationRule[]>;

  /**
   * Find rules by target table
   */
  findByTargetTable(
    targetTable: string,
    options?: QueryOptions
  ): Promise<ReconciliationRule[]>;

  /**
   * Find enabled rules
   */
  findEnabled(options?: QueryOptions): Promise<ReconciliationRule[]>;

  /**
   * Find disabled rules
   */
  findDisabled(options?: QueryOptions): Promise<ReconciliationRule[]>;

  /**
   * Enable rule
   */
  enableRule(id: string): Promise<ReconciliationRule>;

  /**
   * Disable rule
   */
  disableRule(id: string): Promise<ReconciliationRule>;

  /**
   * Get rule with executions
   */
  getRuleWithExecutions(
    id: string
  ): Promise<(ReconciliationRule & { executions: unknown[] }) | null>;

  /**
   * Get rules by join key
   */
  findByJoinKey(
    joinKey: string,
    options?: QueryOptions
  ): Promise<ReconciliationRule[]>;

  /**
   * Get reconciliation statistics
   */
  getReconciliationStats(): Promise<{
    totalRules: number;
    enabledRules: number;
    disabledRules: number;
    bySourceTable: { table: string; count: number }[];
    byTargetTable: { table: string; count: number }[];
    recentExecutions: number; // Last 24 hours
  }>;

  /**
   * Clean up old rules (mark as disabled)
   */
  cleanupOldRules(olderThan: Date): Promise<{ count: number }>;
}

/**
 * ReconciliationRule repository implementation
 */
export class ReconciliationRuleRepository
  extends BaseRepository<
    ReconciliationRule,
    ReconciliationRuleCreateInput,
    ReconciliationRuleUpdateInput
  >
  implements IReconciliationRuleRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "ReconciliationRule", metricsCollector);
  }

  /**
   * Find reconciliation rule by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<ReconciliationRule | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.ReconciliationRuleFindUniqueArgs;

      const result = await this.db.reconciliationRule.findUnique(queryOptions);
      return result as ReconciliationRule | null;
    });
  }

  /**
   * Find multiple reconciliation rules
   */
  async findMany(options?: QueryOptions): Promise<ReconciliationRule[]> {
    return this.executeOperation("findMany", async () => {
      const result = await this.db.reconciliationRule.findMany({
        ...options,
      });
      return result as ReconciliationRule[];
    });
  }

  /**
   * Find first reconciliation rule matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<ReconciliationRule | null> {
    return this.executeOperation("findFirst", async () => {
      const result = await this.db.reconciliationRule.findFirst({
        ...options,
      });
      return result as ReconciliationRule | null;
    });
  }

  /**
   * Count reconciliation rules
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.db.reconciliationRule.count as any)(countOptions);
    });
  }

  /**
   * Create new reconciliation rule
   */
  async create(
    data: ReconciliationRuleCreateInput
  ): Promise<ReconciliationRule> {
    return this.executeOperation("create", async () => {
      const result = await this.db.reconciliationRule.create({
        data,
      });
      return result as ReconciliationRule;
    });
  }

  /**
   * Create multiple reconciliation rules
   */
  async createMany(
    data: ReconciliationRuleCreateInput[]
  ): Promise<ReconciliationRule[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((ruleData) =>
          this.db.reconciliationRule.create({
            data: ruleData,
          })
        )
      );
      return results as ReconciliationRule[];
    });
  }

  /**
   * Update reconciliation rule by ID
   */
  async updateById(
    id: string,
    data: ReconciliationRuleUpdateInput
  ): Promise<ReconciliationRule> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.reconciliationRule.update({
        where: { id },
        data,
      });
      return result as ReconciliationRule;
    });
  }

  /**
   * Update multiple reconciliation rules
   */
  async updateMany(
    where: Record<string, unknown>,
    data: ReconciliationRuleUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.reconciliationRule.updateMany({
        where,
        data,
      });
    });
  }

  /**
   * Delete reconciliation rule by ID
   */
  async deleteById(id: string): Promise<ReconciliationRule> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.reconciliationRule.delete({
        where: { id },
      });
      return result as ReconciliationRule;
    });
  }

  /**
   * Delete multiple reconciliation rules
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.reconciliationRule.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if reconciliation rule exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.reconciliationRule.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IReconciliationRuleRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new ReconciliationRuleRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find rules by source table
   */
  async findBySourceTable(
    sourceTable: string,
    options?: QueryOptions
  ): Promise<ReconciliationRule[]> {
    return this.executeOperation("findBySourceTable", async () => {
      const result = await this.db.reconciliationRule.findMany({
        where: { sourceTable, ...options?.where },
        ...options,
      });
      return result as ReconciliationRule[];
    });
  }

  /**
   * Find rules by target table
   */
  async findByTargetTable(
    targetTable: string,
    options?: QueryOptions
  ): Promise<ReconciliationRule[]> {
    return this.executeOperation("findByTargetTable", async () => {
      const result = await this.db.reconciliationRule.findMany({
        where: { targetTable, ...options?.where },
        ...options,
      });
      return result as ReconciliationRule[];
    });
  }

  /**
   * Find enabled rules
   */
  async findEnabled(options?: QueryOptions): Promise<ReconciliationRule[]> {
    return this.executeOperation("findEnabled", async () => {
      const result = await this.db.reconciliationRule.findMany({
        where: { enabled: true, ...options?.where },
        ...options,
      });
      return result as ReconciliationRule[];
    });
  }

  /**
   * Find disabled rules
   */
  async findDisabled(options?: QueryOptions): Promise<ReconciliationRule[]> {
    return this.executeOperation("findDisabled", async () => {
      const result = await this.db.reconciliationRule.findMany({
        where: { enabled: false, ...options?.where },
        ...options,
      });
      return result as ReconciliationRule[];
    });
  }

  /**
   * Enable rule
   */
  async enableRule(id: string): Promise<ReconciliationRule> {
    return this.executeOperation("enableRule", async () => {
      const result = await this.db.reconciliationRule.update({
        where: { id },
        data: { enabled: true },
      });
      return result as ReconciliationRule;
    });
  }

  /**
   * Disable rule
   */
  async disableRule(id: string): Promise<ReconciliationRule> {
    return this.executeOperation("disableRule", async () => {
      const result = await this.db.reconciliationRule.update({
        where: { id },
        data: { enabled: false },
      });
      return result as ReconciliationRule;
    });
  }

  /**
   * Get rule with executions
   */
  async getRuleWithExecutions(
    id: string
  ): Promise<(ReconciliationRule & { executions: any[] }) | null> {
    return this.executeOperation("getRuleWithExecutions", async () => {
      const result = await this.db.reconciliationRule.findUnique({
        where: { id },
        include: {
          executions: {
            orderBy: {
              executedAt: "desc",
            },
          },
        },
      });
      return result as (ReconciliationRule & { executions: any[] }) | null;
    });
  }

  /**
   * Get rules by join key
   */
  async findByJoinKey(
    joinKey: string,
    options?: QueryOptions
  ): Promise<ReconciliationRule[]> {
    return this.executeOperation("findByJoinKey", async () => {
      const result = await this.db.reconciliationRule.findMany({
        where: { joinKey, ...options?.where },
        ...options,
      });
      return result as ReconciliationRule[];
    });
  }

  /**
   * Get reconciliation statistics
   */
  async getReconciliationStats(): Promise<{
    totalRules: number;
    enabledRules: number;
    disabledRules: number;
    bySourceTable: { table: string; count: number }[];
    byTargetTable: { table: string; count: number }[];
    recentExecutions: number;
  }> {
    return this.executeOperation("getReconciliationStats", async () => {
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [
        totalRules,
        enabledRules,
        disabledRules,
        bySourceResult,
        byTargetResult,
        recentExecutions,
      ] = await Promise.all([
        this.db.reconciliationRule.count(),
        this.db.reconciliationRule.count({ where: { enabled: true } }),
        this.db.reconciliationRule.count({ where: { enabled: false } }),
        this.db.reconciliationRule.groupBy({
          by: ["sourceTable"],
          _count: {
            sourceTable: true,
          },
        }),
        this.db.reconciliationRule.groupBy({
          by: ["targetTable"],
          _count: {
            targetTable: true,
          },
        }),
        this.db.reconciliationExecution.count({
          where: {
            executedAt: {
              gte: last24Hours,
            },
          },
        }),
      ]);

      const bySourceTable = bySourceResult.map((item) => ({
        table: item.sourceTable,
        count: item._count.sourceTable,
      }));

      const byTargetTable = byTargetResult.map((item) => ({
        table: item.targetTable,
        count: item._count.targetTable,
      }));

      return {
        totalRules,
        enabledRules,
        disabledRules,
        bySourceTable,
        byTargetTable,
        recentExecutions,
      };
    });
  }

  /**
   * Clean up old rules (mark as disabled)
   */
  async cleanupOldRules(olderThan: Date): Promise<{ count: number }> {
    return this.executeOperation("cleanupOldRules", async () => {
      return this.db.reconciliationRule.updateMany({
        where: {
          createdAt: {
            lt: olderThan,
          },
          enabled: true,
        },
        data: {
          enabled: false,
        },
      });
    });
  }
}
