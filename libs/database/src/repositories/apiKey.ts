/**
 * @fileoverview ApiKey Repository Implementation
 * @module database/repositories/apiKey
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { ApiKey, ApiKeyCreateInput, ApiKeyUpdateInput } from "../models";
import type { Prisma } from "@prisma/client";

export interface IApiKeyRepository
  extends BaseRepository<ApiKey, ApiKeyCreateInput, ApiKeyUpdateInput> {
  findByKey(keyHash: string): Promise<ApiKey | null>;
  findByUser(userId: string, options?: QueryOptions): Promise<ApiKey[]>;
  findActiveByUser(userId: string): Promise<ApiKey[]>;
  updateLastUsed(id: string): Promise<ApiKey>;
  revokeById(id: string): Promise<ApiKey>;
  revokeByUser(userId: string): Promise<{ count: number }>;
  getApiKeyStats(): Promise<{
    total: number;
    active: number;
    revoked: number;
    expired: number;
  }>;
}

export class ApiKeyRepository
  extends BaseRepository<ApiKey, ApiKeyCreateInput, ApiKeyUpdateInput>
  implements IApiKeyRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "ApiKey", metricsCollector);
  }

  async findById(id: string, _options?: QueryOptions): Promise<ApiKey | null> {
    return this.executeOperation("findById", async () => {
      const result = await this.db.apiKey.findUnique({
        where: { id },
      });
      return result as unknown as ApiKey | null;
    });
  }

  async findMany(options?: QueryOptions): Promise<ApiKey[]> {
    return this.executeOperation("findMany", async () => {
      const prismaOptions: Prisma.ApiKeyFindManyArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.ApiKeyWhereInput;
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.apiKey.findMany(prismaOptions);
      return result as unknown as ApiKey[];
    });
  }

  async findFirst(options?: QueryOptions): Promise<ApiKey | null> {
    return this.executeOperation("findFirst", async () => {
      const prismaOptions: Prisma.ApiKeyFindFirstArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.ApiKeyWhereInput;
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.apiKey.findFirst(prismaOptions);
      return result as unknown as ApiKey | null;
    });
  }

  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      const prismaOptions: Prisma.ApiKeyCountArgs = {};
      if (options?.where) {
        prismaOptions.where = options.where as Prisma.ApiKeyWhereInput;
      }
      return this.db.apiKey.count(prismaOptions);
    });
  }

  async create(data: ApiKeyCreateInput): Promise<ApiKey> {
    return this.executeOperation("create", async () => {
      const result = await this.db.apiKey.create({
        data,
      });
      return result as unknown as ApiKey;
    });
  }

  async createMany(data: ApiKeyCreateInput[]): Promise<ApiKey[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((apiKeyData) =>
          this.db.apiKey.create({
            data: apiKeyData,
          })
        )
      );
      return results as unknown as ApiKey[];
    });
  }

  async updateById(id: string, data: ApiKeyUpdateInput): Promise<ApiKey> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.apiKey.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return result as unknown as ApiKey;
    });
  }

  async updateMany(
    where: Record<string, unknown>,
    data: ApiKeyUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.apiKey.updateMany({
        where: where as Prisma.ApiKeyWhereInput,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  async deleteById(id: string): Promise<ApiKey> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.apiKey.delete({
        where: { id },
      });
      return result as unknown as ApiKey;
    });
  }

  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.apiKey.deleteMany({
        where: where as Prisma.ApiKeyWhereInput,
      });
    });
  }

  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.apiKey.count({
        where: where as Prisma.ApiKeyWhereInput,
      });
      return count > 0;
    });
  }

  async transaction<R>(callback: (repo: this) => Promise<R>): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new ApiKeyRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo as this);
    });
  }

  async findByKey(keyHash: string): Promise<ApiKey | null> {
    return this.executeOperation("findByKey", async () => {
      const result = await this.db.apiKey.findFirst({
        where: { keyHash },
      });
      return result as unknown as ApiKey | null;
    });
  }

  async findByUser(userId: string, options?: QueryOptions): Promise<ApiKey[]> {
    return this.executeOperation("findByUser", async () => {
      const prismaOptions: Prisma.ApiKeyFindManyArgs = {
        where: { userId },
      };
      if (options?.where) {
        prismaOptions.where = {
          userId,
          ...(options.where as Prisma.ApiKeyWhereInput),
        };
      }
      if (options?.skip !== undefined) {
        prismaOptions.skip = options.skip;
      }
      if (options?.take !== undefined) {
        prismaOptions.take = options.take;
      }
      const result = await this.db.apiKey.findMany(prismaOptions);
      return result as unknown as ApiKey[];
    });
  }

  async findActiveByUser(userId: string): Promise<ApiKey[]> {
    return this.executeOperation("findActiveByUser", async () => {
      const result = await this.db.apiKey.findMany({
        where: {
          userId,
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      return result as unknown as ApiKey[];
    });
  }

  async updateLastUsed(id: string): Promise<ApiKey> {
    return this.executeOperation("updateLastUsed", async () => {
      const result = await this.db.apiKey.update({
        where: { id },
        data: {
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return result as unknown as ApiKey;
    });
  }

  async revokeById(id: string): Promise<ApiKey> {
    return this.executeOperation("revokeById", async () => {
      const result = await this.db.apiKey.update({
        where: { id },
        data: {
          isActive: false,
          revokedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return result as unknown as ApiKey;
    });
  }

  async revokeByUser(userId: string): Promise<{ count: number }> {
    return this.executeOperation("revokeByUser", async () => {
      return this.db.apiKey.updateMany({
        where: { userId },
        data: {
          isActive: false,
          revokedAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });
  }

  async getApiKeyStats(): Promise<{
    total: number;
    active: number;
    revoked: number;
    expired: number;
  }> {
    return this.executeOperation("getApiKeyStats", async () => {
      const [total, active, revoked, expired] = await Promise.all([
        this.db.apiKey.count(),
        this.db.apiKey.count({ where: { isActive: true } }),
        this.db.apiKey.count({ where: { isActive: false } }),
        this.db.apiKey.count({
          where: {
            isActive: true,
            expiresAt: { lte: new Date() },
          },
        }),
      ]);

      return {
        total,
        active,
        revoked,
        expired,
      };
    });
  }
}
