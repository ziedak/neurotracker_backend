/**
 * @fileoverview RecoveryEvent Repository Implementation
 * @module database/repositories/recoveryEvent
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { RecoveryEvent, RecoveryStatus } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * RecoveryEvent creation input type
 */
export type RecoveryEventCreateInput = Omit<
  Prisma.RecoveryEventCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

/**
 * RecoveryEvent update input type
 */
export type RecoveryEventUpdateInput = Prisma.RecoveryEventUpdateInput;

/**
 * RecoveryEvent repository interface
 */
export interface IRecoveryEventRepository
  extends BaseRepository<
    RecoveryEvent,
    RecoveryEventCreateInput,
    RecoveryEventUpdateInput
  > {
  /**
   * Find recovery events by cart ID
   */
  findByCartId(
    cartId: string,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]>;

  /**
   * Find recovery events by store ID
   */
  findByStoreId(
    storeId: string,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]>;

  /**
   * Find recovery events by user ID
   */
  findByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]>;

  /**
   * Find recovery events by status
   */
  findByStatus(
    status: RecoveryStatus,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]>;

  /**
   * Find recovery events by event type
   */
  findByEventType(
    eventType: string,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]>;

  /**
   * Update recovery event status
   */
  updateStatus(
    id: string,
    status: RecoveryStatus,
    outcome?: string
  ): Promise<RecoveryEvent>;
}

/**
 * RecoveryEvent repository implementation
 */
export class RecoveryEventRepository
  extends BaseRepository<
    RecoveryEvent,
    RecoveryEventCreateInput,
    RecoveryEventUpdateInput
  >
  implements IRecoveryEventRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "RecoveryEvent", metricsCollector);
  }

  /**
   * Find recovery event by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<RecoveryEvent | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.RecoveryEventFindUniqueArgs;

      return this.db.recoveryEvent.findUnique(queryOptions);
    });
  }

  /**
   * Find multiple recovery events
   */
  async findMany(options?: QueryOptions): Promise<RecoveryEvent[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.recoveryEvent.findMany({
        ...options,
      });
    });
  }

  /**
   * Find first recovery event matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<RecoveryEvent | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.recoveryEvent.findFirst({
        ...options,
      });
    });
  }

  /**
   * Count recovery events
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      const { include, ...countOptions } = options ?? {};
      return this.db.recoveryEvent.count(countOptions);
    });
  }

  /**
   * Create new recovery event
   */
  async create(data: RecoveryEventCreateInput): Promise<RecoveryEvent> {
    return this.executeOperation("create", async () => {
      return this.db.recoveryEvent.create({
        data,
      });
    });
  }

  /**
   * Create multiple recovery events
   */
  async createMany(data: RecoveryEventCreateInput[]): Promise<RecoveryEvent[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((recoveryEventData) =>
          this.db.recoveryEvent.create({
            data: recoveryEventData,
          })
        )
      );
      return results;
    });
  }

  /**
   * Update recovery event by ID
   */
  async updateById(
    id: string,
    data: RecoveryEventUpdateInput
  ): Promise<RecoveryEvent> {
    return this.executeOperation("updateById", async () => {
      return this.db.recoveryEvent.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Update multiple recovery events
   */
  async updateMany(
    where: Record<string, unknown>,
    data: RecoveryEventUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.recoveryEvent.updateMany({
        where,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete recovery event by ID
   */
  async deleteById(id: string): Promise<RecoveryEvent> {
    return this.executeOperation("deleteById", async () => {
      return this.db.recoveryEvent.delete({
        where: { id },
      });
    });
  }

  /**
   * Delete multiple recovery events
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.recoveryEvent.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if recovery event exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.recoveryEvent.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IRecoveryEventRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new RecoveryEventRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find recovery events by cart ID
   */
  async findByCartId(
    cartId: string,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]> {
    return this.executeOperation("findByCartId", async () => {
      return this.db.recoveryEvent.findMany({
        where: { cartId, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find recovery events by store ID
   */
  async findByStoreId(
    storeId: string,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]> {
    return this.executeOperation("findByStoreId", async () => {
      return this.db.recoveryEvent.findMany({
        where: { storeId, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find recovery events by user ID
   */
  async findByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]> {
    return this.executeOperation("findByUserId", async () => {
      return this.db.recoveryEvent.findMany({
        where: { userId, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find recovery events by status
   */
  async findByStatus(
    status: RecoveryStatus,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]> {
    return this.executeOperation("findByStatus", async () => {
      return this.db.recoveryEvent.findMany({
        where: { status, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find recovery events by event type
   */
  async findByEventType(
    eventType: string,
    options?: QueryOptions
  ): Promise<RecoveryEvent[]> {
    return this.executeOperation("findByEventType", async () => {
      return this.db.recoveryEvent.findMany({
        where: { eventType, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Update recovery event status
   */
  async updateStatus(
    id: string,
    status: RecoveryStatus,
    outcome?: string
  ): Promise<RecoveryEvent> {
    return this.executeOperation("updateStatus", async () => {
      return this.db.recoveryEvent.update({
        where: { id },
        data: {
          status,
          outcome: outcome ?? null,
          updatedAt: new Date(),
        },
      });
    });
  }
}
