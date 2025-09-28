/**
 * @fileoverview ReconciliationExecution Repository Implementation
 * @module database/repositories/reconciliationExecution
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  ReconciliationExecution,
  DecimalType,
  ReconciliationExecutionCreateInput,
  ReconciliationExecutionUpdateInput,
} from "../models";
import type { Prisma } from "@prisma/client";

/**
 * ReconciliationExecution repository interface
 */
export interface IReconciliationExecutionRepository
  extends BaseRepository<
    ReconciliationExecution,
    ReconciliationExecutionCreateInput,
    ReconciliationExecutionUpdateInput
  > {
  /**
   * Find executions by rule ID
   */
  findByRuleId(
    ruleId: string,
    options?: QueryOptions
  ): Promise<ReconciliationExecution[]>;

  /**
   * Find executions by status
   */
  findByStatus(
    status: string,
    options?: QueryOptions
  ): Promise<ReconciliationExecution[]>;

  /**
   * Find successful executions
   */
  findSuccessful(options?: QueryOptions): Promise<ReconciliationExecution[]>;

  /**
   * Find failed executions
   */
  findFailed(options?: QueryOptions): Promise<ReconciliationExecution[]>;

  /**
   * Find executions within date range
   */
  findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<ReconciliationExecution[]>;

  /**
   * Get latest execution for rule
   */
  getLatestForRule(ruleId: string): Promise<ReconciliationExecution | null>;

  /**
   * Get execution statistics
   */
  getExecutionStats(): Promise<{
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: DecimalType;
    totalRecordsChecked: number;
    totalDiscrepancies: number;
    byStatus: { status: string; count: number }[];
    recentPerformance: { date: string; avgTime: number; successRate: number }[];
  }>;

  /**
   * Get executions with high discrepancies
   */
  getHighDiscrepancyExecutions(
    threshold: number
  ): Promise<ReconciliationExecution[]>;

  /**
   * Clean up old executions
   */
  cleanupOldExecutions(olderThan: Date): Promise<{ count: number }>;

  /**
   * Get execution summary for dashboard
   */
  getExecutionSummary(): Promise<{
    totalExecutions: number;
    successRate: number;
    averageExecutionTime: DecimalType;
    recentExecutions: ReconciliationExecution[];
    topFailingRules: { ruleId: string; failures: number }[];
  }>;
}

/**
 * ReconciliationExecution repository implementation
 */
export class ReconciliationExecutionRepository
  extends BaseRepository<
    ReconciliationExecution,
    ReconciliationExecutionCreateInput,
    ReconciliationExecutionUpdateInput
  >
  implements IReconciliationExecutionRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "ReconciliationExecution", metricsCollector);
  }

  /**
   * Find reconciliation execution by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<ReconciliationExecution | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.ReconciliationExecutionFindUniqueArgs;

      const result =
        await this.db.reconciliationExecution.findUnique(queryOptions);
      return result as ReconciliationExecution | null;
    });
  }

  /**
   * Find multiple reconciliation executions
   */
  async findMany(options?: QueryOptions): Promise<ReconciliationExecution[]> {
    return this.executeOperation("findMany", async () => {
      const result = await this.db.reconciliationExecution.findMany({
        ...options,
      });
      return result as ReconciliationExecution[];
    });
  }

  /**
   * Find first reconciliation execution matching criteria
   */
  async findFirst(
    options?: QueryOptions
  ): Promise<ReconciliationExecution | null> {
    return this.executeOperation("findFirst", async () => {
      const result = await this.db.reconciliationExecution.findFirst({
        ...options,
      });
      return result as ReconciliationExecution | null;
    });
  }

  /**
   * Count reconciliation executions
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return this.db.reconciliationExecution.count(countOptions);
    });
  }

  /**
   * Create new reconciliation execution
   */
  async create(
    data: ReconciliationExecutionCreateInput
  ): Promise<ReconciliationExecution> {
    return this.executeOperation("create", async () => {
      const result = await this.db.reconciliationExecution.create({
        data: {
          ...data,
          executedAt: data.executedAt ?? new Date(),
        },
      });
      return result as ReconciliationExecution;
    });
  }

  /**
   * Create multiple reconciliation executions
   */
  async createMany(
    data: ReconciliationExecutionCreateInput[]
  ): Promise<ReconciliationExecution[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((executionData) =>
          this.db.reconciliationExecution.create({
            data: {
              ...executionData,
              executedAt: executionData.executedAt ?? new Date(),
            },
          })
        )
      );
      return results as ReconciliationExecution[];
    });
  }

  /**
   * Update reconciliation execution by ID
   */
  async updateById(
    id: string,
    data: ReconciliationExecutionUpdateInput
  ): Promise<ReconciliationExecution> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.reconciliationExecution.update({
        where: { id },
        data,
      });
      return result as ReconciliationExecution;
    });
  }

  /**
   * Update multiple reconciliation executions
   */
  async updateMany(
    where: Record<string, unknown>,
    data: ReconciliationExecutionUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.reconciliationExecution.updateMany({
        where,
        data,
      });
    });
  }

  /**
   * Delete reconciliation execution by ID
   */
  async deleteById(id: string): Promise<ReconciliationExecution> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.reconciliationExecution.delete({
        where: { id },
      });
      return result as ReconciliationExecution;
    });
  }

  /**
   * Delete multiple reconciliation executions
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.reconciliationExecution.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if reconciliation execution exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.reconciliationExecution.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IReconciliationExecutionRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new ReconciliationExecutionRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find executions by rule ID
   */
  async findByRuleId(
    ruleId: string,
    options?: QueryOptions
  ): Promise<ReconciliationExecution[]> {
    return this.executeOperation("findByRuleId", async () => {
      const result = await this.db.reconciliationExecution.findMany({
        where: { ruleId, ...options?.where },
        ...options,
      });
      return result as ReconciliationExecution[];
    });
  }

  /**
   * Find executions by status
   */
  async findByStatus(
    status: string,
    options?: QueryOptions
  ): Promise<ReconciliationExecution[]> {
    return this.executeOperation("findByStatus", async () => {
      const result = await this.db.reconciliationExecution.findMany({
        where: { status, ...options?.where },
        ...options,
      });
      return result as ReconciliationExecution[];
    });
  }

  /**
   * Find successful executions
   */
  async findSuccessful(
    options?: QueryOptions
  ): Promise<ReconciliationExecution[]> {
    return this.executeOperation("findSuccessful", async () => {
      const result = await this.db.reconciliationExecution.findMany({
        where: { status: "success", ...options?.where },
        ...options,
      });
      return result as ReconciliationExecution[];
    });
  }

  /**
   * Find failed executions
   */
  async findFailed(options?: QueryOptions): Promise<ReconciliationExecution[]> {
    return this.executeOperation("findFailed", async () => {
      const result = await this.db.reconciliationExecution.findMany({
        where: { status: "failed", ...options?.where },
        ...options,
      });
      return result as ReconciliationExecution[];
    });
  }

  /**
   * Find executions within date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<ReconciliationExecution[]> {
    return this.executeOperation("findByDateRange", async () => {
      const result = await this.db.reconciliationExecution.findMany({
        where: {
          executedAt: {
            gte: startDate,
            lte: endDate,
          },
          ...options?.where,
        },
        ...options,
      });
      return result as ReconciliationExecution[];
    });
  }

  /**
   * Get latest execution for rule
   */
  async getLatestForRule(
    ruleId: string
  ): Promise<ReconciliationExecution | null> {
    return this.executeOperation("getLatestForRule", async () => {
      const result = await this.db.reconciliationExecution.findFirst({
        where: { ruleId },
        orderBy: {
          executedAt: "desc",
        },
      });
      return result as ReconciliationExecution | null;
    });
  }

  /**
   * Get execution statistics
   */
  async getExecutionStats(): Promise<{
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: DecimalType;
    totalRecordsChecked: number;
    totalDiscrepancies: number;
    byStatus: { status: string; count: number }[];
    recentPerformance: { date: string; avgTime: number; successRate: number }[];
  }> {
    return this.executeOperation("getExecutionStats", async () => {
      const [
        totalExecutions,
        successfulExecutions,
        failedExecutions,
        statsResult,
        byStatusResult,
        aggregates,
      ] = await Promise.all([
        this.db.reconciliationExecution.count(),
        this.db.reconciliationExecution.count({ where: { status: "success" } }),
        this.db.reconciliationExecution.count({ where: { status: "failed" } }),
        this.db.reconciliationExecution.aggregate({
          _avg: {
            executionTime: true,
          },
          _sum: {
            recordsChecked: true,
            discrepancies: true,
          },
        }),
        this.db.reconciliationExecution.groupBy({
          by: ["status"],
          _count: {
            status: true,
          },
        }),
        this.db.reconciliationExecution.findMany({
          select: {
            executedAt: true,
            executionTime: true,
            status: true,
          },
          orderBy: {
            executedAt: "desc",
          },
          take: 100, // Last 100 executions for performance analysis
        }),
      ]);

      const byStatus = byStatusResult.map((item) => ({
        status: item.status,
        count: item._count.status,
      }));

      // Calculate recent performance (group by date)
      const performanceByDate = new Map<
        string,
        { totalTime: number; successes: number; total: number }
      >();
      aggregates.forEach((execution) => {
        const [date] = execution.executedAt.toISOString().split("T");
        if (date) {
          const existing = performanceByDate.get(date) ?? {
            totalTime: 0,
            successes: 0,
            total: 0,
          };
          existing.totalTime += Number(execution.executionTime);
          existing.successes += execution.status === "success" ? 1 : 0;
          existing.total += 1;
          performanceByDate.set(date, existing);
        }
      });

      const recentPerformance = Array.from(performanceByDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-7) // Last 7 days
        .map(([date, data]) => ({
          date,
          avgTime: data.totalTime / data.total,
          successRate: (data.successes / data.total) * 100,
        }));

      return {
        totalExecutions,
        successfulExecutions,
        failedExecutions,
        averageExecutionTime: statsResult._avg.executionTime as DecimalType,
        totalRecordsChecked: statsResult._sum.recordsChecked ?? 0,
        totalDiscrepancies: statsResult._sum.discrepancies ?? 0,
        byStatus,
        recentPerformance,
      };
    });
  }

  /**
   * Get executions with high discrepancies
   */
  async getHighDiscrepancyExecutions(
    threshold: number
  ): Promise<ReconciliationExecution[]> {
    return this.executeOperation("getHighDiscrepancyExecutions", async () => {
      const result = await this.db.reconciliationExecution.findMany({
        where: {
          discrepancies: {
            gte: threshold,
          },
        },
        orderBy: {
          discrepancies: "desc",
        },
      });
      return result as ReconciliationExecution[];
    });
  }

  /**
   * Clean up old executions
   */
  async cleanupOldExecutions(olderThan: Date): Promise<{ count: number }> {
    return this.executeOperation("cleanupOldExecutions", async () => {
      return this.db.reconciliationExecution.deleteMany({
        where: {
          executedAt: {
            lt: olderThan,
          },
        },
      });
    });
  }

  /**
   * Get execution summary for dashboard
   */
  async getExecutionSummary(): Promise<{
    totalExecutions: number;
    successRate: number;
    averageExecutionTime: DecimalType;
    recentExecutions: ReconciliationExecution[];
    topFailingRules: { ruleId: string; failures: number }[];
  }> {
    return this.executeOperation("getExecutionSummary", async () => {
      const [
        totalExecutions,
        successfulCount,
        avgTimeResult,
        recentExecutions,
        failingRulesResult,
      ] = await Promise.all([
        this.db.reconciliationExecution.count(),
        this.db.reconciliationExecution.count({ where: { status: "success" } }),
        this.db.reconciliationExecution.aggregate({
          _avg: {
            executionTime: true,
          },
        }),
        this.db.reconciliationExecution.findMany({
          orderBy: {
            executedAt: "desc",
          },
          take: 10,
          include: {
            rule: true,
          },
        }),
        this.db.reconciliationExecution.groupBy({
          by: ["ruleId"],
          where: {
            status: "failed",
          },
          _count: {
            ruleId: true,
          },
          orderBy: {
            _count: {
              ruleId: "desc",
            },
          },
          take: 5,
        }),
      ]);

      const successRate =
        totalExecutions > 0 ? (successfulCount / totalExecutions) * 100 : 0;

      const topFailingRules = failingRulesResult.map((item) => ({
        ruleId: item.ruleId,
        failures: item._count.ruleId,
      }));

      return {
        totalExecutions,
        successRate,
        averageExecutionTime: avgTimeResult._avg.executionTime as DecimalType,
        recentExecutions: recentExecutions as ReconciliationExecution[],
        topFailingRules,
      };
    });
  }
}
