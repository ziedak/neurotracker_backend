/**
 * @fileoverview SessionActivity Repository Implementation
 * @module database/repositories/sessionActivity
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { SessionActivity } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * SessionActivity creation input type
 */
export type SessionActivityCreateInput = Omit<
  Prisma.SessionActivityCreateInput,
  "id" | "timestamp"
> & {
  id?: string;
};

/**
 * SessionActivity update input type
 */
export type SessionActivityUpdateInput = Prisma.SessionActivityUpdateInput;

/**
 * SessionActivity repository interface
 */
export interface ISessionActivityRepository
  extends BaseRepository<
    SessionActivity,
    SessionActivityCreateInput,
    SessionActivityUpdateInput
  > {
  /**
   * Find session activities by session ID
   */
  findBySessionId(
    sessionId: string,
    options?: QueryOptions
  ): Promise<SessionActivity[]>;

  /**
   * Find session activities by store ID
   */
  findByStoreId(
    storeId: string,
    options?: QueryOptions
  ): Promise<SessionActivity[]>;

  /**
   * Find session activities by activity type
   */
  findByActivity(
    activity: string,
    options?: QueryOptions
  ): Promise<SessionActivity[]>;

  /**
   * Find session activities by user ID
   */
  findByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<SessionActivity[]>;
}

/**
 * SessionActivity repository implementation
 */
export class SessionActivityRepository
  extends BaseRepository<
    SessionActivity,
    SessionActivityCreateInput,
    SessionActivityUpdateInput
  >
  implements ISessionActivityRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "SessionActivity", metricsCollector);
  }

  /**
   * Find session activity by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<SessionActivity | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        include: {
          session: true,
          store: true,
          User: true,
          ...include,
        },
        ...(select && { select }),
      } as Prisma.SessionActivityFindUniqueArgs;

      return this.db.sessionActivity.findUnique(queryOptions);
    });
  }

  /**
   * Find multiple session activities
   */
  async findMany(options?: QueryOptions): Promise<SessionActivity[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.sessionActivity.findMany({
        include: {
          session: true,
          store: true,
          User: true,
        },
        ...options,
      });
    });
  }

  /**
   * Find first session activity matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<SessionActivity | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.sessionActivity.findFirst({
        include: {
          session: true,
          store: true,
          User: true,
        },
        ...options,
      });
    });
  }

  /**
   * Count session activities
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      const { include, ...countOptions } = options ?? {};
      return this.db.sessionActivity.count(countOptions);
    });
  }

  /**
   * Create new session activity
   */
  async create(data: SessionActivityCreateInput): Promise<SessionActivity> {
    return this.executeOperation("create", async () => {
      return this.db.sessionActivity.create({
        data,
      });
    });
  }

  /**
   * Create multiple session activities
   */
  async createMany(
    data: SessionActivityCreateInput[]
  ): Promise<SessionActivity[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((sessionActivityData) =>
          this.db.sessionActivity.create({
            data: sessionActivityData,
          })
        )
      );
      return results;
    });
  }

  /**
   * Update session activity by ID
   */
  async updateById(
    id: string,
    data: SessionActivityUpdateInput
  ): Promise<SessionActivity> {
    return this.executeOperation("updateById", async () => {
      return this.db.sessionActivity.update({
        where: { id },
        data,
      });
    });
  }

  /**
   * Update multiple session activities
   */
  async updateMany(
    where: Record<string, unknown>,
    data: SessionActivityUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.sessionActivity.updateMany({
        where,
        data,
      });
    });
  }

  /**
   * Delete session activity by ID
   */
  async deleteById(id: string): Promise<SessionActivity> {
    return this.executeOperation("deleteById", async () => {
      return this.db.sessionActivity.delete({
        where: { id },
      });
    });
  }

  /**
   * Delete multiple session activities
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.sessionActivity.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if session activity exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.sessionActivity.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: ISessionActivityRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new SessionActivityRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find session activities by session ID
   */
  async findBySessionId(
    sessionId: string,
    options?: QueryOptions
  ): Promise<SessionActivity[]> {
    return this.executeOperation("findBySessionId", async () => {
      return this.db.sessionActivity.findMany({
        where: { sessionId, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find session activities by store ID
   */
  async findByStoreId(
    storeId: string,
    options?: QueryOptions
  ): Promise<SessionActivity[]> {
    return this.executeOperation("findByStoreId", async () => {
      return this.db.sessionActivity.findMany({
        where: { storeId, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find session activities by activity type
   */
  async findByActivity(
    activity: string,
    options?: QueryOptions
  ): Promise<SessionActivity[]> {
    return this.executeOperation("findByActivity", async () => {
      return this.db.sessionActivity.findMany({
        where: { activity, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find session activities by user ID
   */
  async findByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<SessionActivity[]> {
    return this.executeOperation("findByUserId", async () => {
      return this.db.sessionActivity.findMany({
        where: { User: { some: { id: userId } }, ...options?.where },
        ...options,
      });
    });
  }
}
