/**
 * @fileoverview Webhook Repository Implementation
 * @module database/repositories/webhook
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  Webhook,
  WebhookCreateInput,
  WebhookUpdateInput,
} from "../../models";
import type { Prisma } from "@prisma/client";

/**
 * Webhook repository interface
 */
export interface IWebhookRepository
  extends BaseRepository<Webhook, WebhookCreateInput, WebhookUpdateInput> {
  /**
   * Find webhooks by store ID
   */
  findByStoreId(storeId: string, options?: QueryOptions): Promise<Webhook[]>;

  /**
   * Find webhooks by event type
   */
  findByEventType(
    eventType: string,
    options?: QueryOptions
  ): Promise<Webhook[]>;

  /**
   * Find active webhooks
   */
  findActive(options?: QueryOptions): Promise<Webhook[]>;

  /**
   * Update webhook last triggered timestamp
   */
  updateLastTriggered(id: string, lastTriggered: Date): Promise<Webhook>;
}

/**
 * Webhook repository implementation
 */
export class WebhookRepository
  extends BaseRepository<Webhook, WebhookCreateInput, WebhookUpdateInput>
  implements IWebhookRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Webhook", metricsCollector);
  }

  /**
   * Find webhook by ID
   */
  async findById(id: string, options?: QueryOptions): Promise<Webhook | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.WebhookFindUniqueArgs;

      return this.db.webhook.findUnique(queryOptions);
    });
  }

  /**
   * Find multiple webhooks
   */
  async findMany(options?: QueryOptions): Promise<Webhook[]> {
    return this.executeOperation("findMany", async () => {
      return this.db.webhook.findMany({
        ...options,
      });
    });
  }

  /**
   * Find first webhook matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<Webhook | null> {
    return this.executeOperation("findFirst", async () => {
      return this.db.webhook.findFirst({
        ...options,
      });
    });
  }

  /**
   * Count webhooks
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      return this.db.webhook.count({
        ...(options?.where && { where: options.where }),
      });
    });
  }

  /**
   * Create new webhook
   */
  async create(data: WebhookCreateInput): Promise<Webhook> {
    return this.executeOperation("create", async () => {
      return this.db.webhook.create({
        data,
      });
    });
  }

  /**
   * Create multiple webhooks
   */
  async createMany(data: WebhookCreateInput[]): Promise<Webhook[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((webhookData) =>
          this.db.webhook.create({
            data: webhookData,
          })
        )
      );
      return results;
    });
  }

  /**
   * Update webhook by ID
   */
  async updateById(id: string, data: WebhookUpdateInput): Promise<Webhook> {
    return this.executeOperation("updateById", async () => {
      return this.db.webhook.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Update multiple webhooks
   */
  async updateMany(
    where: Record<string, unknown>,
    data: WebhookUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.webhook.updateMany({
        where,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete webhook by ID
   */
  async deleteById(id: string): Promise<Webhook> {
    return this.executeOperation("deleteById", async () => {
      return this.db.webhook.delete({
        where: { id },
      });
    });
  }

  /**
   * Delete multiple webhooks
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.webhook.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if webhook exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.webhook.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IWebhookRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new WebhookRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find webhooks by store ID
   */
  async findByStoreId(
    storeId: string,
    options?: QueryOptions
  ): Promise<Webhook[]> {
    return this.executeOperation("findByStoreId", async () => {
      return this.db.webhook.findMany({
        where: { storeId, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find webhooks by event type
   */
  async findByEventType(
    eventType: string,
    options?: QueryOptions
  ): Promise<Webhook[]> {
    return this.executeOperation("findByEventType", async () => {
      return this.db.webhook.findMany({
        where: { eventType, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Find active webhooks
   */
  async findActive(options?: QueryOptions): Promise<Webhook[]> {
    return this.executeOperation("findActive", async () => {
      return this.db.webhook.findMany({
        where: { isActive: true, ...options?.where },
        ...options,
      });
    });
  }

  /**
   * Update webhook last triggered timestamp
   */
  async updateLastTriggered(id: string, lastTriggered: Date): Promise<Webhook> {
    return this.executeOperation("updateLastTriggered", async () => {
      return this.db.webhook.update({
        where: { id },
        data: {
          lastTriggered,
          updatedAt: new Date(),
        },
      });
    });
  }
}
