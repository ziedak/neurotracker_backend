/**
 * @fileoverview Order Repository Implementation
 * @module database/repositories/order
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  Order,
  OrderStatus,
  OrderCreateInput,
  OrderUpdateInput,
} from "../models";
import type { Prisma } from "@prisma/client";

export type OrderQueryOptions = QueryOptions<Prisma.OrderWhereInput>;

export interface IOrderRepository
  extends BaseRepository<Order, OrderCreateInput, OrderUpdateInput> {
  findByUser(userId: string, options?: QueryOptions): Promise<Order[]>;
  findByCart(cartId: string): Promise<Order | null>;
  findByStatus(status: OrderStatus, options?: QueryOptions): Promise<Order[]>;
  updateStatus(id: string, status: OrderStatus): Promise<Order>;
  getOrderStats(): Promise<{
    total: number;
    pending: number;
    completed: number;
    cancelled: number;
    failed: number;
  }>;
}

export class OrderRepository
  extends BaseRepository<Order, OrderCreateInput, OrderUpdateInput>
  implements IOrderRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Order", metricsCollector);
  }

  async findById(id: string, _options?: QueryOptions): Promise<Order | null> {
    return this.executeOperation("findById", async () => {
      const result = await this.db.order.findUnique({
        where: { id },
      });
      return result as unknown as Order | null;
    });
  }

  async findMany(options?: QueryOptions): Promise<Order[]> {
    return this.executeOperation("findMany", async () => {
      const prismaOptions: Prisma.OrderFindManyArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.OrderWhereInput;
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.order.findMany(prismaOptions);
      return result as unknown as Order[];
    });
  }

  async findFirst(options?: QueryOptions): Promise<Order | null> {
    return this.executeOperation("findFirst", async () => {
      const prismaOptions: Prisma.OrderFindFirstArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.OrderWhereInput;
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.order.findFirst(prismaOptions);
      return result as unknown as Order | null;
    });
  }

  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      const prismaOptions: Prisma.OrderCountArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.OrderWhereInput;
      }
      return this.db.order.count(prismaOptions);
    });
  }

  async create(data: OrderCreateInput): Promise<Order> {
    return this.executeOperation("create", async () => {
      const result = await this.db.order.create({
        data,
      });
      return result as unknown as Order;
    });
  }

  async createMany(data: OrderCreateInput[]): Promise<Order[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((orderData) =>
          this.db.order.create({
            data: orderData,
          })
        )
      );
      return results as unknown as Order[];
    });
  }

  async updateById(id: string, data: OrderUpdateInput): Promise<Order> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.order.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return result as unknown as Order;
    });
  }

  async updateMany(
    where: Record<string, unknown>,
    data: OrderUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.order.updateMany({
        where: where as Prisma.OrderWhereInput,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  async deleteById(id: string): Promise<Order> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.order.delete({
        where: { id },
      });
      return result as unknown as Order;
    });
  }

  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.order.deleteMany({
        where: where as Prisma.OrderWhereInput,
      });
    });
  }

  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.order.count({
        where: where as Prisma.OrderWhereInput,
      });
      return count > 0;
    });
  }

  async transaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new OrderRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo as this);
    });
  }

  async findByUser(userId: string, options?: QueryOptions): Promise<Order[]> {
    return this.executeOperation("findByUser", async () => {
      const prismaOptions: Prisma.OrderFindManyArgs = {
        where: { userId },
      };
      if (options?.where) {
        prismaOptions.where = {
          userId,
          ...(options.where as Prisma.OrderWhereInput),
        };
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.order.findMany(prismaOptions);
      return result as unknown as Order[];
    });
  }

  async findByCart(cartId: string): Promise<Order | null> {
    return this.executeOperation("findByCart", async () => {
      const result = await this.db.order.findFirst({
        where: { cartId },
      });
      return result as unknown as Order | null;
    });
  }

  async findByStatus(
    status: OrderStatus,
    options?: QueryOptions
  ): Promise<Order[]> {
    return this.executeOperation("findByStatus", async () => {
      const prismaOptions: Prisma.OrderFindManyArgs = {
        where: { status },
      };
      if (options?.where) {
        prismaOptions.where = {
          status,
          ...(options.where as Prisma.OrderWhereInput),
        };
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.order.findMany(prismaOptions);
      return result as unknown as Order[];
    });
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    return this.executeOperation("updateStatus", async () => {
      const updateData: Partial<OrderUpdateInput> = {
        status,
        updatedAt: new Date(),
      };

      if (status === "COMPLETED") {
        updateData.completedAt = new Date();
      } else if (status === "CANCELLED") {
        updateData.cancelledAt = new Date();
      }

      const result = await this.db.order.update({
        where: { id },
        data: updateData,
      });
      return result as unknown as Order;
    });
  }

  async getOrderStats(): Promise<{
    total: number;
    pending: number;
    completed: number;
    cancelled: number;
    failed: number;
  }> {
    return this.executeOperation("getOrderStats", async () => {
      const [total, pending, completed, cancelled, failed] = await Promise.all([
        this.db.order.count(),
        this.db.order.count({ where: { status: "PENDING" } }),
        this.db.order.count({ where: { status: "COMPLETED" } }),
        this.db.order.count({ where: { status: "CANCELLED" } }),
        this.db.order.count({ where: { status: "FAILED" } }),
      ]);

      return {
        total,
        pending,
        completed,
        cancelled,
        failed,
      };
    });
  }
}
