/**
 * @fileoverview Report Repository Implementation
 * @module database/repositories/report
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  Report,
  ReportStatus,
  ReportCreateInput,
  ReportUpdateInput,
} from "../models";
import type { Prisma } from "@prisma/client";

/**
 * Report repository interface
 */
export interface IReportRepository
  extends BaseRepository<Report, ReportCreateInput, ReportUpdateInput> {
  /**
   * Find reports by store ID
   */
  findByStoreId(storeId: string, options?: QueryOptions): Promise<Report[]>;

  /**
   * Find reports by type
   */
  findByType(type: string, options?: QueryOptions): Promise<Report[]>;

  /**
   * Find reports by status
   */
  findByStatus(status: ReportStatus, options?: QueryOptions): Promise<Report[]>;

  /**
   * Update report status
   */
  updateStatus(
    id: string,
    status: ReportStatus,
    error?: string
  ): Promise<Report>;

  /**
   * Mark report as ready
   */
  markAsReady(id: string, url: string): Promise<Report>;
}

/**
 * Report repository implementation
 */
export class ReportRepository
  extends BaseRepository<Report, ReportCreateInput, ReportUpdateInput>
  implements IReportRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Report", metricsCollector);
  }

  /**
   * Find report by ID
   */
  async findById(id: string, options?: QueryOptions): Promise<Report | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.ReportFindUniqueArgs;

      return this.db.report.findUnique(queryOptions);
    });
  }

  /**
   * Find multiple reports
   */
  async findMany(options?: QueryOptions): Promise<Report[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.report.findMany({
        ...options,
      });
    });
  }

  /**
   * Find first report matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<Report | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.report.findFirst({
        ...options,
      });
    });
  }

  /**
   * Count reports
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return this.db.report.count(countOptions as any);
    });
  }

  /**
   * Create new report
   */
  async create(data: ReportCreateInput): Promise<Report> {
    return this.executeOperation("create", async () => {
      return this.db.report.create({
        data,
      });
    });
  }

  /**
   * Create multiple reports
   */
  async createMany(data: ReportCreateInput[]): Promise<Report[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((reportData) =>
          this.db.report.create({
            data: reportData,
          })
        )
      );
      return results;
    });
  }

  /**
   * Update report by ID
   */
  async updateById(id: string, data: ReportUpdateInput): Promise<Report> {
    return this.executeOperation("updateById", async () => {
      return this.db.report.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Update multiple reports
   */
  async updateMany(
    where: Record<string, unknown>,
    data: ReportUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.report.updateMany({
        where,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete report by ID
   */
  async deleteById(id: string): Promise<Report> {
    return this.executeOperation("deleteById", async () => {
      return this.db.report.delete({
        where: { id },
      });
    });
  }

  /**
   * Delete multiple reports
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.report.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if report exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.report.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IReportRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new ReportRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find reports by store ID
   */
  async findByStoreId(
    storeId: string,
    options?: QueryOptions
  ): Promise<Report[]> {
    return this.executeOperation("findByStoreId", async () => {
      return this.db.report.findMany({
        where: { storeId, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find reports by type
   */
  async findByType(type: string, options?: QueryOptions): Promise<Report[]> {
    return this.executeOperation("findByType", async () => {
      return this.db.report.findMany({
        where: { type, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find reports by status
   */
  async findByStatus(
    status: ReportStatus,
    options?: QueryOptions
  ): Promise<Report[]> {
    return this.executeOperation("findByStatus", async () => {
      return this.db.report.findMany({
        where: { status, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Update report status
   */
  async updateStatus(
    id: string,
    status: ReportStatus,
    error?: string
  ): Promise<Report> {
    return this.executeOperation("updateStatus", async () => {
      return this.db.report.update({
        where: { id },
        data: {
          status,
          error: error ?? null,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Mark report as ready
   */
  async markAsReady(id: string, url: string): Promise<Report> {
    return this.executeOperation("markAsReady", async () => {
      return this.db.report.update({
        where: { id },
        data: {
          status: "READY",
          url,
          generatedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });
  }
}
