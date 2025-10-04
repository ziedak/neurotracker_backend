/**
 * @fileoverview Product Repository Implementation
 * @module database/repositories/product
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  Product,
  ProductStatus,
  ProductCreateInput,
  ProductUpdateInput,
} from "../../models";
import type { Prisma } from "@prisma/client";

/**
 * Product repository interface
 */
export interface IProductRepository
  extends BaseRepository<Product, ProductCreateInput, ProductUpdateInput> {
  /**
   * Find product by SKU
   */
  findBySku(sku: string): Promise<Product | null>;

  /**
   * Find products by category
   */
  findByCategory(category: string, options?: QueryOptions): Promise<Product[]>;

  /**
   * Find products by status
   */
  findByStatus(
    status: ProductStatus,
    options?: QueryOptions
  ): Promise<Product[]>;

  /**
   * Soft delete product
   */
  softDelete(id: string): Promise<Product>;

  /**
   * Restore soft deleted product
   */
  restore(id: string): Promise<Product>;
}

/**
 * Product repository implementation
 */
export class ProductRepository
  extends BaseRepository<Product, ProductCreateInput, ProductUpdateInput>
  implements IProductRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Product", metricsCollector);
  }

  async findById(id: string, options?: QueryOptions): Promise<Product | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, isDeleted: false, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.ProductFindUniqueArgs;

      return this.db.product.findUnique(queryOptions);
    });
  }

  async findMany(options?: QueryOptions): Promise<Product[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.product.findMany({
        where: { isDeleted: false, ...options?.where },
        ...options,
      });
    });
  }

  async findFirst(options?: QueryOptions): Promise<Product | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.product.findFirst({
        where: { isDeleted: false, ...options?.where },
        ...options,
      });
    });
  }

  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      return this.db.product.count({
        where: { isDeleted: false, ...options?.where },
      });
    });
  }

  async create(data: ProductCreateInput): Promise<Product> {
    return this.executeOperation("create", async () => {
      return this.db.product.create({
        data: {
          ...data,
          isDeleted: false,
        },
      });
    });
  }

  async createMany(data: ProductCreateInput[]): Promise<Product[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((productData) =>
          this.db.product.create({
            data: {
              ...productData,
              isDeleted: false,
            },
          })
        )
      );
      return results;
    });
  }

  async updateById(id: string, data: ProductUpdateInput): Promise<Product> {
    return this.executeOperation("updateById", async () => {
      return this.db.product.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  async updateMany(
    where: Record<string, unknown>,
    data: ProductUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.product.updateMany({
        where: { isDeleted: false, ...where },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  async deleteById(id: string): Promise<Product> {
    return this.executeOperation("deleteById", async () => {
      return this.db.product.delete({
        where: { id },
      });
    });
  }

  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.product.deleteMany({
        where: { isDeleted: false, ...where },
      });
    });
  }

  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.product.count({
        where: { isDeleted: false, ...where },
      });
      return count > 0;
    });
  }

  async transaction<R>(
    callback: (repo: IProductRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new ProductRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  async findBySku(sku: string): Promise<Product | null> {
    return this.executeOperation("findBySku", async () => {
      return this.db.product.findUnique({
        where: { sku, isDeleted: false },
      });
    });
  }

  async findByCategory(
    category: string,
    options?: QueryOptions
  ): Promise<Product[]> {
    return this.executeOperation("findByCategory", async () => {
      return this.db.product.findMany({
        where: {
          category,
          isDeleted: false,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  async findByStatus(
    status: ProductStatus,
    options?: QueryOptions
  ): Promise<Product[]> {
    return this.executeOperation("findByStatus", async () => {
      return this.db.product.findMany({
        where: {
          status,
          isDeleted: false,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  async softDelete(id: string): Promise<Product> {
    return this.executeOperation("softDelete", async () => {
      return this.db.product.update({
        where: { id },
        data: {
          isDeleted: true,
          status: "DELETED",
          updatedAt: new Date(),
        },
      });
    });
  }

  async restore(id: string): Promise<Product> {
    return this.executeOperation("restore", async () => {
      return this.db.product.update({
        where: { id },
        data: {
          isDeleted: false,
          status: "ACTIVE",
          updatedAt: new Date(),
        },
      });
    });
  }
}
