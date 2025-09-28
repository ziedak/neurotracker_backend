/**
 * @fileoverview Cart Repository Implementation
 * @module database/repositories/cart
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  Cart,
  CartStatus,
  CartCreateInput,
  CartUpdateInput,
} from "../models";
import type { Prisma } from "@prisma/client";

export interface ICartRepository
  extends BaseRepository<Cart, CartCreateInput, CartUpdateInput> {
  findByUser(userId: string, options?: QueryOptions): Promise<Cart[]>;
  findByStatus(status: CartStatus, options?: QueryOptions): Promise<Cart[]>;
  findActiveByUser(userId: string): Promise<Cart | null>;
  softDelete(id: string): Promise<Cart>;
  restore(id: string): Promise<Cart>;
  archive(id: string): Promise<Cart>;
}

export class CartRepository
  extends BaseRepository<Cart, CartCreateInput, CartUpdateInput>
  implements ICartRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Cart", metricsCollector);
  }

  async findById(id: string, options?: QueryOptions): Promise<Cart | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, isDeleted: false, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.CartFindUniqueArgs;

      return this.db.cart.findUnique(queryOptions);
    });
  }

  async findMany(options?: QueryOptions): Promise<Cart[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.cart.findMany({
        where: { isDeleted: false, ...options?.where },
        ...options,
      });
    });
  }

  async findFirst(options?: QueryOptions): Promise<Cart | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.cart.findFirst({
        where: { isDeleted: false, ...options?.where },
        ...options,
      });
    });
  }

  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      return this.db.cart.count({
        where: { isDeleted: false, ...options?.where },
      });
    });
  }

  async create(data: CartCreateInput): Promise<Cart> {
    return this.executeOperation("create", async () => {
      const { userId, ...createData } = data;
      return this.db.cart.create({
        data: {
          ...createData,
          user: { connect: { id: userId } },
          isDeleted: false,
          archived: false,
        },
      });
    });
  }

  async createMany(data: CartCreateInput[]): Promise<Cart[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((cartData) => {
          const { userId, ...createData } = cartData;
          return this.db.cart.create({
            data: {
              ...createData,
              user: { connect: { id: userId } },
              isDeleted: false,
              archived: false,
            },
          });
        })
      );
      return results;
    });
  }

  async updateById(id: string, data: CartUpdateInput): Promise<Cart> {
    return this.executeOperation("updateById", async () => {
      return this.db.cart.update({
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
    data: CartUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.cart.updateMany({
        where: { isDeleted: false, ...where },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  async deleteById(id: string): Promise<Cart> {
    return this.executeOperation("deleteById", async () => {
      return this.db.cart.delete({
        where: { id },
      });
    });
  }

  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.cart.deleteMany({
        where: { isDeleted: false, ...where },
      });
    });
  }

  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.cart.count({
        where: { isDeleted: false, ...where },
      });
      return count > 0;
    });
  }

  async transaction<R>(
    callback: (repo: ICartRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new CartRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  async findByUser(userId: string, options?: QueryOptions): Promise<Cart[]> {
    return this.executeOperation("findByUser", async () => {
      return this.db.cart.findMany({
        where: {
          userId,
          isDeleted: false,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  async findByStatus(
    status: CartStatus,
    options?: QueryOptions
  ): Promise<Cart[]> {
    return this.executeOperation("findByStatus", async () => {
      return this.db.cart.findMany({
        where: {
          status,
          isDeleted: false,
          ...options?.where,
        },
        ...options,
      });
    });
  }

  async findActiveByUser(userId: string): Promise<Cart | null> {
    return this.executeOperation("findActiveByUser", async () => {
      return this.db.cart.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          isDeleted: false,
        },
        orderBy: { updatedAt: "desc" },
      });
    });
  }

  async softDelete(id: string): Promise<Cart> {
    return this.executeOperation("softDelete", async () => {
      return this.db.cart.update({
        where: { id },
        data: {
          isDeleted: true,
          archived: true,
          updatedAt: new Date(),
        },
      });
    });
  }

  async restore(id: string): Promise<Cart> {
    return this.executeOperation("restore", async () => {
      return this.db.cart.update({
        where: { id },
        data: {
          isDeleted: false,
          archived: false,
          updatedAt: new Date(),
        },
      });
    });
  }

  async archive(id: string): Promise<Cart> {
    return this.executeOperation("archive", async () => {
      return this.db.cart.update({
        where: { id },
        data: {
          archived: true,
          updatedAt: new Date(),
        },
      });
    });
  }
}
