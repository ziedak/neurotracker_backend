/**
 * @fileoverview Store Repository Implementation
 * @module database/repositories/store
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { Store, StoreStatus } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * Store creation input type
 */
export type StoreCreateInput = Omit<
  Prisma.StoreCreateInput,
  "id" | "createdAt" | "updatedAt" | "isDeleted"
> & {
  id?: string;
};

/**
 * Store update input type
 */
export type StoreUpdateInput = Prisma.StoreUpdateInput;

/**
 * Store repository interface
 */
export interface IStoreRepository
  extends BaseRepository<Store, StoreCreateInput, StoreUpdateInput> {
  /**
   * Find store by URL
   */
  findByUrl(url: string): Promise<Store | null>;

  /**
   * Find stores by owner
   */
  findByOwner(ownerId: string, options?: QueryOptions): Promise<Store[]>;

  /**
   * Find stores by status
   */
  findByStatus(status: StoreStatus, options?: QueryOptions): Promise<Store[]>;

  /**
   * Soft delete store
   */
  softDelete(id: string): Promise<Store>;

  /**
   * Restore soft deleted store
   */
  restore(id: string): Promise<Store>;

  /**
   * Get store statistics
   */
  getStoreStats(): Promise<{
    total: number;
    active: number;
    suspended: number;
    deleted: number;
  }>;
}

/**
 * Store repository implementation
 */
export class StoreRepository
  extends BaseRepository<Store, StoreCreateInput, StoreUpdateInput>
  implements IStoreRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Store", metricsCollector);
  }

  /**
   * Find store by ID
   */
  async findById(id: string, options?: QueryOptions): Promise<Store | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, isDeleted: false, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.StoreFindUniqueArgs;

      return this.db.store.findUnique(queryOptions);
    });
  }

  /**
   * Find multiple stores
   */
  async findMany(options?: QueryOptions): Promise<Store[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.store.findMany({
        where: { isDeleted: false, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find first store matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<Store | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.store.findFirst({
        where: { isDeleted: false, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Count stores
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      return this.db.store.count({
        where: { isDeleted: false, ...options?.where },
      });
    });
  }

  /**
   * Create new store
   */
  async create(data: StoreCreateInput): Promise<Store> {
    return this.executeOperation("create", async () => {
      return this.db.store.create({
        data: {
          ...data,
          isDeleted: false,
        },
      });
    });
  }

  /**
   * Create multiple stores
   */
  async createMany(data: StoreCreateInput[]): Promise<Store[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((storeData) =>
          this.db.store.create({
            data: {
              ...storeData,
              isDeleted: false,
            },
          })
        )
      );
      return results;
    });
  }

  /**
   * Update store by ID
   */
  async updateById(id: string, data: StoreUpdateInput): Promise<Store> {
    return this.executeOperation("updateById", async () => {
      return this.db.store.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Update multiple stores
   */
  async updateMany(
    where: Record<string, unknown>,
    data: StoreUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.store.updateMany({
        where: { isDeleted: false, ...where },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete store by ID (hard delete)
   */
  async deleteById(id: string): Promise<Store> {
    return this.executeOperation("deleteById", async () => {
      return this.db.store.delete({
        where: { id },
      });
    });
  }

  /**
   * Delete multiple stores
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.store.deleteMany({
        where: { isDeleted: false, ...where },
      });
    });
  }

  /**
   * Check if store exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.store.count({
        where: { isDeleted: false, ...where },
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IStoreRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new StoreRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find store by URL
   */
  async findByUrl(url: string): Promise<Store | null> {
    return this.executeOperation("findByUrl", async () => {
      return this.db.store.findUnique({
        where: { url, isDeleted: false },
      });
    });
  }

  /**
   * Find stores by owner
   */
  async findByOwner(ownerId: string, options?: QueryOptions): Promise<Store[]> {
    return this.executeOperation("findByOwner", async () => {
      return this.db.store.findMany({
        where: {
          ownerId,
          isDeleted: false,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  /**
   * Find stores by status
   */
  async findByStatus(
    status: StoreStatus,
    options?: QueryOptions
  ): Promise<Store[]> {
    return this.executeOperation("findByStatus", async () => {
      return this.db.store.findMany({
        where: {
          status,
          isDeleted: false,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  /**
   * Soft delete store
   */
  async softDelete(id: string): Promise<Store> {
    return this.executeOperation("softDelete", async () => {
      return this.db.store.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          status: "DELETED",
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Restore soft deleted store
   */
  async restore(id: string): Promise<Store> {
    return this.executeOperation("restore", async () => {
      return this.db.store.update({
        where: { id },
        data: {
          isDeleted: false,
          deletedAt: null,
          status: "ACTIVE",
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Get store statistics
   */
  async getStoreStats(): Promise<{
    total: number;
    active: number;
    suspended: number;
    deleted: number;
  }> {
    return this.executeOperation("getStoreStats", async () => {
      const [total, active, suspended, deleted] = await Promise.all([
        this.db.store.count(),
        this.db.store.count({ where: { status: "ACTIVE" } }),
        this.db.store.count({ where: { status: "SUSPENDED" } }),
        this.db.store.count({ where: { status: "DELETED" } }),
      ]);

      return {
        total,
        active,
        suspended,
        deleted,
      };
    });
  }
}
