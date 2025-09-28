/**
 * @fileoverview Payment Repository Implementation
 * @module database/repositories/payment
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  Payment,
  PaymentStatus,
  PaymentCreateInput,
  PaymentUpdateInput,
} from "../models";
import type { Prisma } from "@prisma/client";

export interface IPaymentRepository
  extends BaseRepository<Payment, PaymentCreateInput, PaymentUpdateInput> {
  findByOrder(orderId: string): Promise<Payment[]>;
  findByStatus(
    status: PaymentStatus,
    options?: QueryOptions
  ): Promise<Payment[]>;
  findByTransactionId(transactionId: string): Promise<Payment | null>;
  updateStatus(id: string, status: PaymentStatus): Promise<Payment>;
  getPaymentStats(): Promise<{
    total: number;
    pending: number;
    completed: number;
    failed: number;
    refunded: number;
  }>;
}

export class PaymentRepository
  extends BaseRepository<Payment, PaymentCreateInput, PaymentUpdateInput>
  implements IPaymentRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Payment", metricsCollector);
  }

  async findById(id: string, _options?: QueryOptions): Promise<Payment | null> {
    return this.executeOperation("findById", async () => {
      const result = await this.db.payment.findUnique({
        where: { id },
      });
      return result as unknown as Payment | null;
    });
  }

  async findMany(options?: QueryOptions): Promise<Payment[]> {
    return this.executeOperation("findMany", async () => {
      const prismaOptions: Prisma.PaymentFindManyArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.PaymentWhereInput;
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.payment.findMany(prismaOptions);
      return result as unknown as Payment[];
    });
  }

  async findFirst(options?: QueryOptions): Promise<Payment | null> {
    return this.executeOperation("findFirst", async () => {
      const prismaOptions: Prisma.PaymentFindFirstArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.PaymentWhereInput;
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.payment.findFirst(prismaOptions);
      return result as unknown as Payment | null;
    });
  }

  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      const prismaOptions: Prisma.PaymentCountArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.PaymentWhereInput;
      }
      return this.db.payment.count(prismaOptions);
    });
  }

  async create(data: PaymentCreateInput): Promise<Payment> {
    return this.executeOperation("create", async () => {
      const result = await this.db.payment.create({
        data,
      });
      return result as unknown as Payment;
    });
  }

  async createMany(data: PaymentCreateInput[]): Promise<Payment[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((paymentData) =>
          this.db.payment.create({
            data: paymentData,
          })
        )
      );
      return results as unknown as Payment[];
    });
  }

  async updateById(id: string, data: PaymentUpdateInput): Promise<Payment> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.payment.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return result as unknown as Payment;
    });
  }

  async updateMany(
    where: Record<string, unknown>,
    data: PaymentUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.payment.updateMany({
        where: where as Prisma.PaymentWhereInput,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  async deleteById(id: string): Promise<Payment> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.payment.delete({
        where: { id },
      });
      return result as unknown as Payment;
    });
  }

  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.payment.deleteMany({
        where: where as Prisma.PaymentWhereInput,
      });
    });
  }

  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.payment.count({
        where: where as Prisma.PaymentWhereInput,
      });
      return count > 0;
    });
  }

  async transaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new PaymentRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo as this);
    });
  }

  async findByOrder(orderId: string): Promise<Payment[]> {
    return this.executeOperation("findByOrder", async () => {
      const result = await this.db.payment.findMany({
        where: { orderId },
      });
      return result as unknown as Payment[];
    });
  }

  async findByStatus(
    status: PaymentStatus,
    options?: QueryOptions
  ): Promise<Payment[]> {
    return this.executeOperation("findByStatus", async () => {
      const prismaOptions: Prisma.PaymentFindManyArgs = {
        where: { status },
      };
      if (options?.where) {
        prismaOptions.where = {
          status,
          ...(options.where as Prisma.PaymentWhereInput),
        };
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.payment.findMany(prismaOptions);
      return result as unknown as Payment[];
    });
  }

  async findByTransactionId(transactionId: string): Promise<Payment | null> {
    return this.executeOperation("findByTransactionId", async () => {
      const result = await this.db.payment.findFirst({
        where: { transactionId },
      });
      return result as unknown as Payment | null;
    });
  }

  async updateStatus(id: string, status: PaymentStatus): Promise<Payment> {
    return this.executeOperation("updateStatus", async () => {
      const updateData: Partial<PaymentUpdateInput> = {
        status,
        updatedAt: new Date(),
      };

      if (status === "COMPLETED") {
        updateData.completedAt = new Date();
      } else if (status === "FAILED") {
        updateData.failedAt = new Date();
      }

      const result = await this.db.payment.update({
        where: { id },
        data: updateData,
      });
      return result as unknown as Payment;
    });
  }

  async getPaymentStats(): Promise<{
    total: number;
    pending: number;
    completed: number;
    failed: number;
    refunded: number;
  }> {
    return this.executeOperation("getPaymentStats", async () => {
      const [total, pending, completed, failed, refunded] = await Promise.all([
        this.db.payment.count(),
        this.db.payment.count({ where: { status: "PENDING" } }),
        this.db.payment.count({ where: { status: "COMPLETED" } }),
        this.db.payment.count({ where: { status: "FAILED" } }),
        this.db.payment.count({ where: { status: "REFUNDED" } }),
      ]);

      return {
        total,
        pending,
        completed,
        failed,
        refunded,
      };
    });
  }
}
