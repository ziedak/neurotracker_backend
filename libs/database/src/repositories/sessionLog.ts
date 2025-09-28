/**
 * @fileoverview SessionLog Repository Implementation
 * @module database/repositories/sessionLog
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { SessionLog } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * SessionLog creation input type
 */
export type SessionLogCreateInput = Omit<
  Prisma.SessionLogCreateInput,
  "id" | "timestamp"
> & {
  id?: string;
  timestamp?: Date;
};

/**
 * SessionLog update input type
 */
export type SessionLogUpdateInput = Prisma.SessionLogUpdateInput;

/**
 * SessionLog repository interface
 */
export interface ISessionLogRepository
  extends BaseRepository<
    SessionLog,
    SessionLogCreateInput,
    SessionLogUpdateInput
  > {
  /**
   * Find logs by session ID
   */
  findBySessionId(
    sessionId: string,
    options?: QueryOptions
  ): Promise<SessionLog[]>;

  /**
   * Find logs by event type
   */
  findByEvent(event: string, options?: QueryOptions): Promise<SessionLog[]>;

  /**
   * Find logs within date range
   */
  findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<SessionLog[]>;

  /**
   * Find logs by session and event type
   */
  findBySessionAndEvent(
    sessionId: string,
    event: string,
    options?: QueryOptions
  ): Promise<SessionLog[]>;

  /**
   * Get session activity summary
   */
  getSessionActivitySummary(
    sessionId: string
  ): Promise<{ event: string; count: number }[]>;

  /**
   * Clean up old logs
   */
  cleanupOldLogs(olderThan: Date): Promise<{ count: number }>;
}

/**
 * SessionLog repository implementation
 */
export class SessionLogRepository
  extends BaseRepository<
    SessionLog,
    SessionLogCreateInput,
    SessionLogUpdateInput
  >
  implements ISessionLogRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "SessionLog", metricsCollector);
  }

  /**
   * Find session log by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<SessionLog | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.SessionLogFindUniqueArgs;

      const result = await this.db.sessionLog.findUnique(queryOptions);
      return result as SessionLog | null;
    });
  }

  /**
   * Find multiple session logs
   */
  async findMany(options?: QueryOptions): Promise<SessionLog[]> {
    return this.executeOperation("findMany", async () => {
      const result = await this.db.sessionLog.findMany({
        ...options,
      });
      return result as SessionLog[];
    });
  }

  /**
   * Find first session log matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<SessionLog | null> {
    return this.executeOperation("findFirst", async () => {
      const result = await this.db.sessionLog.findFirst({
        ...options,
      });
      return result as SessionLog | null;
    });
  }

  /**
   * Count session logs
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.db.sessionLog.count as any)(countOptions);
    });
  }

  /**
   * Create new session log
   */
  async create(data: SessionLogCreateInput): Promise<SessionLog> {
    return this.executeOperation("create", async () => {
      const result = await this.db.sessionLog.create({
        data: {
          ...data,
          timestamp: data.timestamp ?? new Date(),
        },
      });
      return result as SessionLog;
    });
  }

  /**
   * Create multiple session logs
   */
  async createMany(data: SessionLogCreateInput[]): Promise<SessionLog[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((logData) =>
          this.db.sessionLog.create({
            data: {
              ...logData,
              timestamp: logData.timestamp ?? new Date(),
            },
          })
        )
      );
      return results as SessionLog[];
    });
  }

  /**
   * Update session log by ID
   */
  async updateById(
    id: string,
    data: SessionLogUpdateInput
  ): Promise<SessionLog> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.sessionLog.update({
        where: { id },
        data,
      });
      return result as SessionLog;
    });
  }

  /**
   * Update multiple session logs
   */
  async updateMany(
    where: Record<string, unknown>,
    data: SessionLogUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.sessionLog.updateMany({
        where,
        data,
      });
    });
  }

  /**
   * Delete session log by ID
   */
  async deleteById(id: string): Promise<SessionLog> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.sessionLog.delete({
        where: { id },
      });
      return result as SessionLog;
    });
  }

  /**
   * Delete multiple session logs
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.sessionLog.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if session log exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.sessionLog.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: ISessionLogRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new SessionLogRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find logs by session ID
   */
  async findBySessionId(
    sessionId: string,
    options?: QueryOptions
  ): Promise<SessionLog[]> {
    return this.executeOperation("findBySessionId", async () => {
      const result = await this.db.sessionLog.findMany({
        where: { sessionId, ...options?.where },
        ...options,
      });
      return result as SessionLog[];
    });
  }

  /**
   * Find logs by event type
   */
  async findByEvent(
    event: string,
    options?: QueryOptions
  ): Promise<SessionLog[]> {
    return this.executeOperation("findByEvent", async () => {
      const result = await this.db.sessionLog.findMany({
        where: { event, ...options?.where },
        ...options,
      });
      return result as SessionLog[];
    });
  }

  /**
   * Find logs within date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<SessionLog[]> {
    return this.executeOperation("findByDateRange", async () => {
      const result = await this.db.sessionLog.findMany({
        where: {
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
          ...options?.where,
        },
        ...options,
      });
      return result as SessionLog[];
    });
  }

  /**
   * Find logs by session and event type
   */
  async findBySessionAndEvent(
    sessionId: string,
    event: string,
    options?: QueryOptions
  ): Promise<SessionLog[]> {
    return this.executeOperation("findBySessionAndEvent", async () => {
      const result = await this.db.sessionLog.findMany({
        where: {
          sessionId,
          event,
          ...options?.where,
        },
        ...options,
      });
      return result as SessionLog[];
    });
  }

  /**
   * Get session activity summary
   */
  async getSessionActivitySummary(
    sessionId: string
  ): Promise<{ event: string; count: number }[]> {
    return this.executeOperation("getSessionActivitySummary", async () => {
      const result = await this.db.sessionLog.groupBy({
        by: ["event"],
        where: { sessionId },
        _count: {
          event: true,
        },
        orderBy: {
          _count: {
            event: "desc",
          },
        },
      });

      return result.map((item) => ({
        event: item.event,
        count: item._count.event,
      }));
    });
  }

  /**
   * Clean up old logs
   */
  async cleanupOldLogs(olderThan: Date): Promise<{ count: number }> {
    return this.executeOperation("cleanupOldLogs", async () => {
      return this.db.sessionLog.deleteMany({
        where: {
          timestamp: {
            lt: olderThan,
          },
        },
      });
    });
  }
}
