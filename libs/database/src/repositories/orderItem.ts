/**
 * @fileoverview OrderItem Repository Implementation
 * @module database/repositories/orderItem
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { OrderItem } from "../models";
import type { Prisma } from "@prisma/client";

export type OrderItemCreateInput = Omit<
  Prisma.OrderItemCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type OrderItemUpdateInput = Prisma.OrderItemUpdateInput;

export interface IOrderItemRepository
  extends BaseRepository<
    OrderItem,
    OrderItemCreateInput,
    OrderItemUpdateInput
  > {
  findByOrder(orderId: string, options?: QueryOptions): Promise<OrderItem[]>;
  findByProduct(
    productId: string,
    options?: QueryOptions
  ): Promise<OrderItem[]>;
  getOrderTotal(orderId: string): Promise<number>;
  updateQuantity(id: string, quantity: number): Promise<OrderItem>;
}

export class OrderItemRepository
  extends BaseRepository<OrderItem, OrderItemCreateInput, OrderItemUpdateInput>
  implements IOrderItemRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "OrderItem", metricsCollector);
  }

  async findById(
    id: string,
    _options?: QueryOptions
  ): Promise<OrderItem | null> {
    return this.executeOperation("findById", async () => {
      const result = await this.db.orderItem.findUnique({
        where: { id },
      });
      return result as unknown as OrderItem | null;
    });
  }

  async findMany(options?: QueryOptions): Promise<OrderItem[]> {
    return this.executeOperation("findMany", async () => {
      const prismaOptions: Prisma.OrderItemFindManyArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.OrderItemWhereInput;
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.orderItem.findMany(prismaOptions);
      return result as unknown as OrderItem[];
    });
  }

  async findFirst(options?: QueryOptions): Promise<OrderItem | null> {
    return this.executeOperation("findFirst", async () => {
      const prismaOptions: Prisma.OrderItemFindFirstArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.OrderItemWhereInput;
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.orderItem.findFirst(prismaOptions);
      return result as unknown as OrderItem | null;
    });
  }

  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      const prismaOptions: Prisma.OrderItemCountArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.OrderItemWhereInput;
      }
      return this.db.orderItem.count(prismaOptions);
    });
  }

  async create(data: OrderItemCreateInput): Promise<OrderItem> {
    return this.executeOperation("create", async () => {
      const result = await this.db.orderItem.create({
        data,
      });
      return result as unknown as OrderItem;
    });
  }

  async createMany(data: OrderItemCreateInput[]): Promise<OrderItem[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((itemData) =>
          this.db.orderItem.create({
            data: itemData,
          })
        )
      );
      return results as unknown as OrderItem[];
    });
  }

  async updateById(id: string, data: OrderItemUpdateInput): Promise<OrderItem> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.orderItem.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return result as unknown as OrderItem;
    });
  }

  async updateMany(
    where: Record<string, unknown>,
    data: OrderItemUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.orderItem.updateMany({
        where: where as Prisma.OrderItemWhereInput,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  async deleteById(id: string): Promise<OrderItem> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.orderItem.delete({
        where: { id },
      });
      return result as unknown as OrderItem;
    });
  }

  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.orderItem.deleteMany({
        where: where as Prisma.OrderItemWhereInput,
      });
    });
  }

  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.orderItem.count({
        where: where as Prisma.OrderItemWhereInput,
      });
      return count > 0;
    });
  }

  async transaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new OrderItemRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo as this);
    });
  }

  async findByOrder(
    orderId: string,
    options?: QueryOptions
  ): Promise<OrderItem[]> {
    return this.executeOperation("findByOrder", async () => {
      const prismaOptions: Prisma.OrderItemFindManyArgs = {
        where: { orderId },
      };
      if (options?.where) {
        prismaOptions.where = {
          orderId,
          ...(options.where as Prisma.OrderItemWhereInput),
        };
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.orderItem.findMany(prismaOptions);
      return result as unknown as OrderItem[];
    });
  }

  async findByProduct(
    productId: string,
    options?: QueryOptions
  ): Promise<OrderItem[]> {
    return this.executeOperation("findByProduct", async () => {
      const prismaOptions: Prisma.OrderItemFindManyArgs = {
        where: { productId },
      };
      if (options?.where) {
        prismaOptions.where = {
          productId,
          ...(options.where as Prisma.OrderItemWhereInput),
        };
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.orderItem.findMany(prismaOptions);
      return result as unknown as OrderItem[];
    });
  }

  async getOrderTotal(orderId: string): Promise<number> {
    return this.executeOperation("getOrderTotal", async () => {
      const items = await this.db.orderItem.findMany({
        where: { orderId },
        select: { price: true, quantity: true },
      });

      return items.reduce((total, item) => {
        return total + Number(item.price) * item.quantity;
      }, 0);
    });
  }

  async updateQuantity(id: string, quantity: number): Promise<OrderItem> {
    return this.executeOperation("updateQuantity", async () => {
      const result = await this.db.orderItem.update({
        where: { id },
        data: {
          quantity,
          updatedAt: new Date(),
        },
      });
      return result as unknown as OrderItem;
    });
  }
}
