/**
 * @fileoverview QualityAnomaly Repository Implementation
 * @module database/repositories/qualityAnomaly
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { QualityAnomaly } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * QualityAnomaly creation input type
 */
export type QualityAnomalyCreateInput = Omit<
  Prisma.QualityAnomalyCreateInput,
  "id" | "timestamp"
> & {
  id?: string;
  timestamp?: Date;
};

/**
 * QualityAnomaly update input type
 */
export type QualityAnomalyUpdateInput = Prisma.QualityAnomalyUpdateInput;

/**
 * QualityAnomaly repository interface
 */
export interface IQualityAnomalyRepository
  extends BaseRepository<
    QualityAnomaly,
    QualityAnomalyCreateInput,
    QualityAnomalyUpdateInput
  > {
  /**
   * Find anomalies by type
   */
  findByType(type: string, options?: QueryOptions): Promise<QualityAnomaly[]>;

  /**
   * Find anomalies within date range
   */
  findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<QualityAnomaly[]>;

  /**
   * Find outliers
   */
  findOutliers(options?: QueryOptions): Promise<QualityAnomaly[]>;

  /**
   * Find missing data anomalies
   */
  findMissingData(options?: QueryOptions): Promise<QualityAnomaly[]>;

  /**
   * Find duplicate data anomalies
   */
  findDuplicates(options?: QueryOptions): Promise<QualityAnomaly[]>;

  /**
   * Get anomaly statistics
   */
  getAnomalyStats(): Promise<{
    total: number;
    byType: { type: string; count: number }[];
    recentCount: number; // Last 24 hours
    trendData: { date: string; count: number }[];
  }>;

  /**
   * Get anomalies by severity (based on details field)
   */
  getBySeverity(
    severity: "low" | "medium" | "high" | "critical"
  ): Promise<QualityAnomaly[]>;

  /**
   * Clean up old anomalies
   */
  cleanupOldAnomalies(olderThan: Date): Promise<{ count: number }>;

  /**
   * Get anomaly summary for dashboard
   */
  getAnomalySummary(): Promise<{
    totalAnomalies: number;
    criticalCount: number;
    recentAnomalies: QualityAnomaly[];
    topTypes: { type: string; count: number }[];
  }>;
}

/**
 * QualityAnomaly repository implementation
 */
export class QualityAnomalyRepository
  extends BaseRepository<
    QualityAnomaly,
    QualityAnomalyCreateInput,
    QualityAnomalyUpdateInput
  >
  implements IQualityAnomalyRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "QualityAnomaly", metricsCollector);
  }

  /**
   * Find quality anomaly by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<QualityAnomaly | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.QualityAnomalyFindUniqueArgs;

      const result = await this.db.qualityAnomaly.findUnique(queryOptions);
      return result as QualityAnomaly | null;
    });
  }

  /**
   * Find multiple quality anomalies
   */
  async findMany(options?: QueryOptions): Promise<QualityAnomaly[]> {
    return this.executeOperation("findMany", async () => {
      // QualityAnomaly has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityAnomaly.findMany(queryOptions);
      return result as QualityAnomaly[];
    });
  }

  /**
   * Find first quality anomaly matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<QualityAnomaly | null> {
    return this.executeOperation("findFirst", async () => {
      // QualityAnomaly has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityAnomaly.findFirst(queryOptions);
      return result as QualityAnomaly | null;
    });
  }

  /**
   * Count quality anomalies
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.db.qualityAnomaly.count as any)(countOptions);
    });
  }

  /**
   * Create new quality anomaly
   */
  async create(data: QualityAnomalyCreateInput): Promise<QualityAnomaly> {
    return this.executeOperation("create", async () => {
      const result = await this.db.qualityAnomaly.create({
        data: {
          ...data,
          timestamp: data.timestamp ?? new Date(),
        },
      });
      return result as QualityAnomaly;
    });
  }

  /**
   * Create multiple quality anomalies
   */
  async createMany(
    data: QualityAnomalyCreateInput[]
  ): Promise<QualityAnomaly[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((anomalyData) =>
          this.db.qualityAnomaly.create({
            data: {
              ...anomalyData,
              timestamp: anomalyData.timestamp ?? new Date(),
            },
          })
        )
      );
      return results as QualityAnomaly[];
    });
  }

  /**
   * Update quality anomaly by ID
   */
  async updateById(
    id: string,
    data: QualityAnomalyUpdateInput
  ): Promise<QualityAnomaly> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.qualityAnomaly.update({
        where: { id },
        data,
      });
      return result as QualityAnomaly;
    });
  }

  /**
   * Update multiple quality anomalies
   */
  async updateMany(
    where: Record<string, unknown>,
    data: QualityAnomalyUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.qualityAnomaly.updateMany({
        where,
        data,
      });
    });
  }

  /**
   * Delete quality anomaly by ID
   */
  async deleteById(id: string): Promise<QualityAnomaly> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.qualityAnomaly.delete({
        where: { id },
      });
      return result as QualityAnomaly;
    });
  }

  /**
   * Delete multiple quality anomalies
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.qualityAnomaly.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if quality anomaly exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.qualityAnomaly.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IQualityAnomalyRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new QualityAnomalyRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find anomalies by type
   */
  async findByType(
    type: string,
    options?: QueryOptions
  ): Promise<QualityAnomaly[]> {
    return this.executeOperation("findByType", async () => {
      // QualityAnomaly has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityAnomaly.findMany({
        where: { type, ...queryOptions.where },
        ...queryOptions,
      });
      return result as QualityAnomaly[];
    });
  }

  /**
   * Find anomalies within date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<QualityAnomaly[]> {
    return this.executeOperation("findByDateRange", async () => {
      // QualityAnomaly has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityAnomaly.findMany({
        where: {
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
          ...queryOptions.where,
        },
        ...queryOptions,
      });
      return result as QualityAnomaly[];
    });
  }

  /**
   * Find outliers
   */
  async findOutliers(options?: QueryOptions): Promise<QualityAnomaly[]> {
    return this.executeOperation("findOutliers", async () => {
      // QualityAnomaly has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityAnomaly.findMany({
        where: {
          type: "outlier",
          ...queryOptions.where,
        },
        ...queryOptions,
      });
      return result as QualityAnomaly[];
    });
  }

  /**
   * Find missing data anomalies
   */
  async findMissingData(options?: QueryOptions): Promise<QualityAnomaly[]> {
    return this.executeOperation("findMissingData", async () => {
      // QualityAnomaly has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityAnomaly.findMany({
        where: {
          type: "missing",
          ...queryOptions.where,
        },
        ...queryOptions,
      });
      return result as QualityAnomaly[];
    });
  }

  /**
   * Find duplicate data anomalies
   */
  async findDuplicates(options?: QueryOptions): Promise<QualityAnomaly[]> {
    return this.executeOperation("findDuplicates", async () => {
      // QualityAnomaly has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.qualityAnomaly.findMany({
        where: {
          type: "duplicate",
          ...queryOptions.where,
        },
        ...queryOptions,
      });
      return result as QualityAnomaly[];
    });
  }

  /**
   * Get anomaly statistics
   */
  async getAnomalyStats(): Promise<{
    total: number;
    byType: { type: string; count: number }[];
    recentCount: number;
    trendData: { date: string; count: number }[];
  }> {
    return this.executeOperation("getAnomalyStats", async () => {
      const now = new Date();
      const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const [total, byTypeResult, recentCount, trendResult] = await Promise.all(
        [
          this.db.qualityAnomaly.count(),
          this.db.qualityAnomaly.groupBy({
            by: ["type"],
            _count: {
              type: true,
            },
          }),
          this.db.qualityAnomaly.count({
            where: {
              timestamp: {
                gte: last24Hours,
              },
            },
          }),
          this.db.qualityAnomaly.groupBy({
            by: ["timestamp"],
            _count: {
              timestamp: true,
            },
            orderBy: {
              timestamp: "desc",
            },
            take: 30, // Last 30 days
          }),
        ]
      );

      const byType = byTypeResult.map((item) => ({
        type: item.type,
        count: item._count.type,
      }));

      const trendData = trendResult.map((item) => ({
        date: item.timestamp?.toISOString().split("T")[0] ?? "",
        count: item._count.timestamp,
      }));

      return {
        total,
        byType,
        recentCount,
        trendData,
      };
    });
  }

  /**
   * Get anomalies by severity (based on details field)
   */
  async getBySeverity(
    severity: "low" | "medium" | "high" | "critical"
  ): Promise<QualityAnomaly[]> {
    return this.executeOperation("getBySeverity", async () => {
      // This would require parsing the details JSON field for severity
      // For now, we'll return all anomalies and filter in memory
      const result = await this.db.qualityAnomaly.findMany();
      const filtered = result.filter((anomaly) => {
        if (!anomaly.details) return false;
        const details = anomaly.details as Record<string, unknown>;
        return details["severity"] === severity;
      });
      return filtered as QualityAnomaly[];
    });
  }

  /**
   * Clean up old anomalies
   */
  async cleanupOldAnomalies(olderThan: Date): Promise<{ count: number }> {
    return this.executeOperation("cleanupOldAnomalies", async () => {
      return this.db.qualityAnomaly.deleteMany({
        where: {
          timestamp: {
            lt: olderThan,
          },
        },
      });
    });
  }

  /**
   * Get anomaly summary for dashboard
   */
  async getAnomalySummary(): Promise<{
    totalAnomalies: number;
    criticalCount: number;
    recentAnomalies: QualityAnomaly[];
    topTypes: { type: string; count: number }[];
  }> {
    return this.executeOperation("getAnomalySummary", async () => {
      const [totalAnomalies, criticalCount, recentAnomalies, topTypesResult] =
        await Promise.all([
          this.db.qualityAnomaly.count(),
          this.db.qualityAnomaly.count({
            where: {
              details: {
                path: ["severity"],
                equals: "critical",
              },
            },
          }),
          this.db.qualityAnomaly.findMany({
            orderBy: {
              timestamp: "desc",
            },
            take: 10,
          }),
          this.db.qualityAnomaly.groupBy({
            by: ["type"],
            _count: {
              type: true,
            },
            orderBy: {
              _count: {
                type: "desc",
              },
            },
            take: 5,
          }),
        ]);

      const topTypes = topTypesResult.map((item) => ({
        type: item.type,
        count: item._count.type,
      }));

      return {
        totalAnomalies,
        criticalCount,
        recentAnomalies: recentAnomalies as QualityAnomaly[],
        topTypes,
      };
    });
  }
}
