/**
 * @fileoverview Feature Repository Implementation
 * @module database/repositories/feature
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  Feature,
  FeatureCreateInput,
  FeatureUpdateInput,
} from "../models";
import type { Prisma } from "@prisma/client";

/**
 * Feature repository interface
 */
export interface IFeatureRepository
  extends BaseRepository<Feature, FeatureCreateInput, FeatureUpdateInput> {
  /**
   * Find features by cart ID
   */
  findByCartId(cartId: string, options?: QueryOptions): Promise<Feature[]>;

  /**
   * Find feature by cart ID and name
   */
  findByCartIdAndName(cartId: string, name: string): Promise<Feature | null>;

  /**
   * Find features by version
   */
  findByVersion(version: string, options?: QueryOptions): Promise<Feature[]>;

  /**
   * Update feature value
   */
  updateValue(
    cartId: string,
    name: string,
    value: Prisma.JsonValue
  ): Promise<Feature>;

  /**
   * Update feature version
   */
  updateVersion(
    cartId: string,
    name: string,
    version: string
  ): Promise<Feature>;

  /**
   * Remove feature from cart
   */
  removeFromCart(cartId: string, name: string): Promise<Feature | null>;

  /**
   * Clear all features from cart
   */
  clearCartFeatures(cartId: string): Promise<{ count: number }>;

  /**
   * Get features count for cart
   */
  getCartFeaturesCount(cartId: string): Promise<number>;

  /**
   * Check if feature exists in cart
   */
  featureExistsInCart(cartId: string, name: string): Promise<boolean>;

  /**
   * Get expired features
   */
  getExpiredFeatures(currentDate?: Date): Promise<Feature[]>;
}

/**
 * Feature repository implementation
 */
export class FeatureRepository
  extends BaseRepository<Feature, FeatureCreateInput, FeatureUpdateInput>
  implements IFeatureRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Feature", metricsCollector);
  }

  /**
   * Find feature by ID
   */
  async findById(id: string, options?: QueryOptions): Promise<Feature | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.FeatureFindUniqueArgs;

      const result = await this.db.feature.findUnique(queryOptions);
      return result as Feature | null;
    });
  }

  /**
   * Find multiple features
   */
  async findMany(options?: QueryOptions): Promise<Feature[]> {
    return this.executeOperation("findMany", async () => {
      const result = await this.db.feature.findMany({
        ...options,
      });
      return result as Feature[];
    });
  }

  /**
   * Find first feature matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<Feature | null> {
    return this.executeOperation("findFirst", async () => {
      const result = await this.db.feature.findFirst({
        ...options,
      });
      return result as Feature | null;
    });
  }

  /**
   * Count features
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      return this.db.feature.count({
        ...(options?.where && { where: options.where }),
      });
    });
  }

  /**
   * Create new feature
   */
  async create(data: FeatureCreateInput): Promise<Feature> {
    return this.executeOperation("create", async () => {
      const result = await this.db.feature.create({
        data,
      });
      return result as Feature;
    });
  }

  /**
   * Create multiple features
   */
  async createMany(data: FeatureCreateInput[]): Promise<Feature[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((featureData) =>
          this.db.feature.create({
            data: featureData,
          })
        )
      );
      return results as Feature[];
    });
  }

  /**
   * Update feature by ID
   */
  async updateById(id: string, data: FeatureUpdateInput): Promise<Feature> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.feature.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return result as Feature;
    });
  }

  /**
   * Update multiple features
   */
  async updateMany(
    where: Record<string, unknown>,
    data: FeatureUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.feature.updateMany({
        where,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete feature by ID
   */
  async deleteById(id: string): Promise<Feature> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.feature.delete({
        where: { id },
      });
      return result as Feature;
    });
  }

  /**
   * Delete multiple features
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.feature.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if feature exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.feature.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IFeatureRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new FeatureRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find features by cart ID
   */
  async findByCartId(
    cartId: string,
    options?: QueryOptions
  ): Promise<Feature[]> {
    return this.executeOperation("findByCartId", async () => {
      const result = await this.db.feature.findMany({
        where: { cartId, ...options?.where },
        ...options,
      });
      return result as Feature[];
    });
  }

  /**
   * Find feature by cart ID and name
   */
  async findByCartIdAndName(
    cartId: string,
    name: string
  ): Promise<Feature | null> {
    return this.executeOperation("findByCartIdAndName", async () => {
      const result = await this.db.feature.findUnique({
        where: {
          cartId_name: {
            cartId,
            name,
          },
        },
      });
      return result as Feature | null;
    });
  }

  /**
   * Find features by version
   */
  async findByVersion(
    version: string,
    options?: QueryOptions
  ): Promise<Feature[]> {
    return this.executeOperation("findByVersion", async () => {
      const result = await this.db.feature.findMany({
        where: { version, ...options?.where },
        ...options,
      });
      return result as Feature[];
    });
  }

  /**
   * Update feature value
   */
  async updateValue(
    cartId: string,
    name: string,
    value: Prisma.JsonValue
  ): Promise<Feature> {
    return this.executeOperation("updateValue", async () => {
      const result = await this.db.feature.update({
        where: {
          cartId_name: {
            cartId,
            name,
          },
        },
        data: {
          value: value as Prisma.InputJsonValue,
        },
      });
      return result as Feature;
    });
  }

  /**
   * Update feature version
   */
  async updateVersion(
    cartId: string,
    name: string,
    version: string
  ): Promise<Feature> {
    return this.executeOperation("updateVersion", async () => {
      const result = await this.db.feature.update({
        where: {
          cartId_name: {
            cartId,
            name,
          },
        },
        data: {
          version,
        },
      });
      return result as Feature;
    });
  }

  /**
   * Remove feature from cart
   */
  async removeFromCart(cartId: string, name: string): Promise<Feature | null> {
    return this.executeOperation("removeFromCart", async () => {
      try {
        const result = await this.db.feature.delete({
          where: {
            cartId_name: {
              cartId,
              name,
            },
          },
        });
        return result as Feature;
      } catch {
        return null;
      }
    });
  }

  /**
   * Clear all features from cart
   */
  async clearCartFeatures(cartId: string): Promise<{ count: number }> {
    return this.executeOperation("clearCartFeatures", async () => {
      return this.db.feature.deleteMany({
        where: { cartId },
      });
    });
  }

  /**
   * Get features count for cart
   */
  async getCartFeaturesCount(cartId: string): Promise<number> {
    return this.executeOperation("getCartFeaturesCount", async () => {
      const count = await this.db.feature.count({
        where: { cartId },
      });
      return count;
    });
  }

  /**
   * Check if feature exists in cart
   */
  async featureExistsInCart(cartId: string, name: string): Promise<boolean> {
    return this.executeOperation("featureExistsInCart", async () => {
      const count = await this.db.feature.count({
        where: {
          cartId,
          name,
        },
      });
      return count > 0;
    });
  }

  /**
   * Get expired features
   */
  async getExpiredFeatures(currentDate: Date = new Date()): Promise<Feature[]> {
    return this.executeOperation("getExpiredFeatures", async () => {
      const result = await this.db.feature.findMany({
        where: {
          ttl: {
            not: null,
          },
        },
      });

      // Filter expired features in memory since TTL calculation requires row-level logic
      const expiredFeatures = result.filter((feature) => {
        if (!feature.ttl) return false;
        const expirationTime = new Date(
          feature.createdAt.getTime() + feature.ttl * 1000
        );
        return expirationTime < currentDate;
      });

      return expiredFeatures as Feature[];
    });
  }
}
