/**
 * @fileoverview StoreSettings Repository Implementation
 * @module database/repositories/storeSettings
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  StoreSettings,
  StoreSettingsCreateInput,
  StoreSettingsUpdateInput,
} from "../../models";
import type { Prisma } from "@prisma/client";

/**
 * StoreSettings repository interface
 */
export interface IStoreSettingsRepository
  extends BaseRepository<
    StoreSettings,
    StoreSettingsCreateInput,
    StoreSettingsUpdateInput
  > {
  /**
   * Find store settings by store ID
   */
  findByStoreId(storeId: string): Promise<StoreSettings | null>;
}

/**
 * StoreSettings repository implementation
 */
export class StoreSettingsRepository
  extends BaseRepository<
    StoreSettings,
    StoreSettingsCreateInput,
    StoreSettingsUpdateInput
  >
  implements IStoreSettingsRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "StoreSettings", metricsCollector);
  }

  /**
   * Find store settings by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<StoreSettings | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.StoreSettingsFindUniqueArgs;

      return this.db.storeSettings.findUnique(queryOptions);
    });
  }

  /**
   * Find multiple store settings
   */
  async findMany(options?: QueryOptions): Promise<StoreSettings[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.storeSettings.findMany({
        ...options,
      });
    });
  }

  /**
   * Find first store settings matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<StoreSettings | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.storeSettings.findFirst({
        ...options,
      });
    });
  }

  /**
   * Count store settings
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      return this.db.storeSettings.count({
        ...(options?.where && { where: options.where }),
      });
    });
  }

  /**
   * Create new store settings
   */
  async create(data: StoreSettingsCreateInput): Promise<StoreSettings> {
    return this.executeOperation("create", async () => {
      return this.db.storeSettings.create({
        data,
      });
    });
  }

  /**
   * Create multiple store settings
   */
  async createMany(data: StoreSettingsCreateInput[]): Promise<StoreSettings[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((storeSettingsData) =>
          this.db.storeSettings.create({
            data: storeSettingsData,
          })
        )
      );
      return results;
    });
  }

  /**
   * Update store settings by ID
   */
  async updateById(
    id: string,
    data: StoreSettingsUpdateInput
  ): Promise<StoreSettings> {
    return this.executeOperation("updateById", async () => {
      return this.db.storeSettings.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Update multiple store settings
   */
  async updateMany(
    where: Record<string, unknown>,
    data: StoreSettingsUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.storeSettings.updateMany({
        where,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete store settings by ID
   */
  async deleteById(id: string): Promise<StoreSettings> {
    return this.executeOperation("deleteById", async () => {
      return this.db.storeSettings.delete({
        where: { id },
      });
    });
  }

  /**
   * Delete multiple store settings
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.storeSettings.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if store settings exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.storeSettings.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IStoreSettingsRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new StoreSettingsRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find store settings by store ID
   */
  async findByStoreId(storeId: string): Promise<StoreSettings | null> {
    return this.executeOperation("findByStoreId", async () => {
      return this.db.storeSettings.findUnique({
        where: { storeId },
      });
    });
  }
}
