/**
 * @fileoverview ApiKey Repository Implementation
 * @module database/repositories/apiKey
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  ApiKey,
  ApiKeyCreateInput,
  ApiKeyUpdateInput,
} from "../../models";
import type { Prisma } from "@prisma/client";

export interface IApiKeyRepository
  extends BaseRepository<ApiKey, ApiKeyCreateInput, ApiKeyUpdateInput> {
  findByKey(keyHash: string): Promise<ApiKey | null>;
  findByUser(userId: string, options?: QueryOptions): Promise<ApiKey[]>;
  findActiveByUser(userId: string): Promise<ApiKey[]>;
  updateLastUsed(id: string): Promise<ApiKey>;
  incrementUsageCount(id: string): Promise<ApiKey>;
  batchIncrementUsageCount(
    updates: Array<{ id: string; incrementBy: number }>
  ): Promise<{ count: number }>;
  getUsageStatsByKeyId(keyId: string): Promise<ApiKey | null>;
  revokeById(id: string): Promise<ApiKey>;
  revokeByUser(userId: string): Promise<{ count: number }>;
  getApiKeyStats(): Promise<{
    total: number;
    active: number;
    revoked: number;
    expired: number;
  }>;
  getMostUsedKeys(limit?: number): Promise<ApiKey[]>;
  getLeastUsedKeys(limit?: number): Promise<ApiKey[]>;
  getUsageAnalyticsSummary(): Promise<{
    totalKeys: number;
    activeKeys: number;
    totalUsage: number;
    averageUsagePerKey: number;
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
        data: data as unknown as Prisma.ApiKeyCreateInput,
      });
      return result as unknown as ApiKey;
    });
  }

  async createMany(data: ApiKeyCreateInput[]): Promise<ApiKey[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((apiKeyData) =>
          this.db.apiKey.create({
            data: apiKeyData as unknown as Prisma.ApiKeyCreateInput,
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

  async incrementUsageCount(id: string): Promise<ApiKey> {
    return this.executeOperation("incrementUsageCount", async () => {
      const result = await this.db.apiKey.update({
        where: { id },
        data: {
          usageCount: { increment: 1 },
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return result as unknown as ApiKey;
    });
  }

  async batchIncrementUsageCount(
    updates: Array<{ id: string; incrementBy: number }>
  ): Promise<{ count: number }> {
    return this.executeOperation("batchIncrementUsageCount", async () => {
      // Execute updates with error handling for missing records
      // Use updateMany to avoid Prisma errors for non-existent records
      const results = await Promise.allSettled(
        updates.map(async (update) => {
          // Use updateMany which doesn't throw if record is not found
          const result = await this.db.apiKey.updateMany({
            where: {
              id: update.id,
              revokedAt: null, // Only update non-revoked keys
            },
            data: {
              usageCount: { increment: update.incrementBy },
              lastUsedAt: new Date(),
              updatedAt: new Date(),
            },
          });
          return result.count > 0; // Return true if updated, false if not found
        })
      );

      // Count successful updates
      const successCount = results.filter(
        (result) => result.status === "fulfilled" && result.value === true
      ).length;

      return { count: successCount };
    });
  }

  async getUsageStatsByKeyId(keyId: string): Promise<ApiKey | null> {
    return this.executeOperation("getUsageStatsByKeyId", async () => {
      const result = await this.db.apiKey.findUnique({
        where: { id: keyId },
        select: {
          id: true,
          name: true,
          userId: true,
          usageCount: true,
          lastUsedAt: true,
          createdAt: true,
          isActive: true,
        },
      });
      return result as unknown as ApiKey | null;
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

  async getMostUsedKeys(limit: number = 10): Promise<ApiKey[]> {
    return this.executeOperation("getMostUsedKeys", async () => {
      const result = await this.db.apiKey.findMany({
        where: {
          isActive: true,
          revokedAt: null,
        },
        orderBy: {
          usageCount: "desc",
        },
        take: limit,
      });
      return result as unknown as ApiKey[];
    });
  }

  async getLeastUsedKeys(limit: number = 10): Promise<ApiKey[]> {
    return this.executeOperation("getLeastUsedKeys", async () => {
      const result = await this.db.apiKey.findMany({
        where: {
          isActive: true,
          revokedAt: null,
          usageCount: { gt: 0 },
        },
        orderBy: {
          usageCount: "asc",
        },
        take: limit,
      });
      return result as unknown as ApiKey[];
    });
  }

  async getUsageAnalyticsSummary(): Promise<{
    totalKeys: number;
    activeKeys: number;
    totalUsage: number;
    averageUsagePerKey: number;
  }> {
    return this.executeOperation("getUsageAnalyticsSummary", async () => {
      const [totalKeys, activeKeys, usageStats] = await Promise.all([
        this.db.apiKey.count(),
        this.db.apiKey.count({ where: { isActive: true } }),
        this.db.apiKey.aggregate({
          _sum: {
            usageCount: true,
          },
        }),
      ]);

      const totalUsage = usageStats._sum.usageCount ?? 0;
      const averageUsagePerKey = totalKeys > 0 ? totalUsage / totalKeys : 0;

      return {
        totalKeys,
        activeKeys,
        totalUsage,
        averageUsagePerKey,
      };
    });
  }
}
