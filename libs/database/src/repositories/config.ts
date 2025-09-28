/**
 * @fileoverview Config Repository Implementation
 * @module database/repositories/config
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache/interfaces/ICache";
import { BaseRepository, type QueryOptions } from "./base";
import type { Config, ConfigCreateInput, ConfigUpdateInput } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * Config repository interface
 */
export interface IConfigRepository
  extends BaseRepository<Config, ConfigCreateInput, ConfigUpdateInput> {
  /**
   * Find config by key
   */
  findByKey(key: string): Promise<Config | null>;

  /**
   * Set config value
   */
  setValue(
    key: string,
    value: Prisma.JsonValue,
    description?: string
  ): Promise<Config>;

  /**
   * Get config value
   */
  getValue(key: string): Promise<Prisma.JsonValue | null>;

  /**
   * Check if config key exists
   */
  keyExists(key: string): Promise<boolean>;

  /**
   * Delete config by key
   */
  deleteByKey(key: string): Promise<Config | null>;

  /**
   * Get all config keys
   */
  getAllKeys(): Promise<string[]>;

  /**
   * Get configs by prefix
   */
  getByPrefix(prefix: string): Promise<Config[]>;

  /**
   * Bulk set configs
   */
  bulkSet(
    configs: { key: string; value: Prisma.JsonValue; description?: string }[]
  ): Promise<Config[]>;

  /**
   * Get config with default value
   */
  getValueWithDefault<T>(key: string, defaultValue: T): Promise<T>;
}

/**
 * Config repository implementation
 */
export class ConfigRepository
  extends BaseRepository<Config, ConfigCreateInput, ConfigUpdateInput>
  implements IConfigRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Config", metricsCollector);
  }

  /**
   * Find config by ID
   */
  async findById(id: string, options?: QueryOptions): Promise<Config | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.ConfigFindUniqueArgs;

      const result = await this.db.config.findUnique(queryOptions);
      return result as Config | null;
    });
  }

  /**
   * Find multiple configs
   */
  async findMany(options?: QueryOptions): Promise<Config[]> {
    return this.executeOperation("findMany", async () => {
      // Config has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.config.findMany({
        ...queryOptions,
      });
      return result as Config[];
    });
  }

  /**
   * Find first config matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<Config | null> {
    return this.executeOperation("findFirst", async () => {
      // Config has no relations, so omit include
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...queryOptions } = options ?? {};
      const result = await this.db.config.findFirst({
        ...queryOptions,
      });
      return result as Config | null;
    });
  }

  /**
   * Count configs
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      return this.db.config.count(countOptions);
    });
  }

  /**
   * Create new config
   */
  async create(data: ConfigCreateInput): Promise<Config> {
    return this.executeOperation("create", async () => {
      const result = await this.db.config.create({
        data,
      });
      return result as Config;
    });
  }

  /**
   * Create multiple configs
   */
  async createMany(data: ConfigCreateInput[]): Promise<Config[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((configData) =>
          this.db.config.create({
            data: configData,
          })
        )
      );
      return results as Config[];
    });
  }

  /**
   * Update config by ID
   */
  async updateById(id: string, data: ConfigUpdateInput): Promise<Config> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.config.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return result as Config;
    });
  }

  /**
   * Update multiple configs
   */
  async updateMany(
    where: Record<string, unknown>,
    data: ConfigUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.config.updateMany({
        where,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete config by ID
   */
  async deleteById(id: string): Promise<Config> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.config.delete({
        where: { id },
      });
      return result as Config;
    });
  }

  /**
   * Delete multiple configs
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.config.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if config exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.config.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IConfigRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new ConfigRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find config by key
   */
  async findByKey(key: string): Promise<Config | null> {
    return this.executeOperation("findByKey", async () => {
      const result = await this.db.config.findUnique({
        where: { key },
      });
      return result as Config | null;
    });
  }

  /**
   * Set config value
   */
  async setValue(
    key: string,
    value: Prisma.JsonValue,
    description?: string
  ): Promise<Config> {
    return this.executeOperation("setValue", async () => {
      const result = await this.db.config.upsert({
        where: { key },
        update: {
          value: value as Prisma.InputJsonValue,
          description: description ?? null,
          updatedAt: new Date(),
        },
        create: {
          key,
          value: value as Prisma.InputJsonValue,
          description: description ?? null,
        },
      });
      return result as Config;
    });
  }

  /**
   * Get config value
   */
  async getValue(key: string): Promise<Prisma.JsonValue | null> {
    return this.executeOperation("getValue", async () => {
      const config = await this.db.config.findUnique({
        where: { key },
        select: { value: true },
      });
      return config?.value ?? null;
    });
  }

  /**
   * Check if config key exists
   */
  async keyExists(key: string): Promise<boolean> {
    return this.executeOperation("keyExists", async () => {
      const count = await this.db.config.count({
        where: { key },
      });
      return count > 0;
    });
  }

  /**
   * Delete config by key
   */
  async deleteByKey(key: string): Promise<Config | null> {
    return this.executeOperation("deleteByKey", async () => {
      try {
        const result = await this.db.config.delete({
          where: { key },
        });
        return result as Config;
      } catch {
        return null;
      }
    });
  }

  /**
   * Get all config keys
   */
  async getAllKeys(): Promise<string[]> {
    return this.executeOperation("getAllKeys", async () => {
      const configs = await this.db.config.findMany({
        select: { key: true },
      });
      return configs.map((config) => config.key);
    });
  }

  /**
   * Get configs by prefix
   */
  async getByPrefix(prefix: string): Promise<Config[]> {
    return this.executeOperation("getByPrefix", async () => {
      const result = await this.db.config.findMany({
        where: {
          key: {
            startsWith: prefix,
          },
        },
      });
      return result as Config[];
    });
  }

  /**
   * Bulk set configs
   */
  async bulkSet(
    configs: { key: string; value: Prisma.JsonValue; description?: string }[]
  ): Promise<Config[]> {
    return this.executeOperation("bulkSet", async () => {
      const results = await Promise.all(
        configs.map(({ key, value, description }) =>
          this.db.config.upsert({
            where: { key },
            update: {
              value: value as Prisma.InputJsonValue,
              description: description ?? null,
            },
            create: {
              key,
              value: value as Prisma.InputJsonValue,
              description: description ?? null,
            },
          })
        )
      );
      return results as Config[];
    });
  }

  /**
   * Get config with default value
   */
  async getValueWithDefault<T>(key: string, defaultValue: T): Promise<T> {
    return this.executeOperation("getValueWithDefault", async () => {
      const value = await this.getValue(key);
      return (value as T) ?? defaultValue;
    });
  }
}
