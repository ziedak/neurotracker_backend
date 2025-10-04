/**
 * @fileoverview Notification Repository Implementation
 * @module database/repositories/notification
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  Notification,
  NotificationCreateInput,
  NotificationUpdateInput,
} from "../../models";
import type { Prisma } from "@prisma/client";

/**
 * Notification repository interface
 */
export interface INotificationRepository
  extends BaseRepository<
    Notification,
    NotificationCreateInput,
    NotificationUpdateInput
  > {
  /**
   * Find notifications by user ID
   */
  findByUserId(userId: string, options?: QueryOptions): Promise<Notification[]>;

  /**
   * Find notifications by type
   */
  findByType(type: string, options?: QueryOptions): Promise<Notification[]>;

  /**
   * Find unread notifications for user
   */
  findUnreadByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<Notification[]>;

  /**
   * Find read notifications for user
   */
  findReadByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<Notification[]>;

  /**
   * Mark notification as read
   */
  markAsRead(id: string): Promise<Notification>;

  /**
   * Mark multiple notifications as read
   */
  markMultipleAsRead(ids: string[]): Promise<{ count: number }>;

  /**
   * Mark all user notifications as read
   */
  markAllAsRead(userId: string): Promise<{ count: number }>;

  /**
   * Get unread count for user
   */
  getUnreadCount(userId: string): Promise<number>;

  /**
   * Delete read notifications older than date
   */
  cleanupOldReadNotifications(olderThan: Date): Promise<{ count: number }>;

  /**
   * Get notification statistics
   */
  getNotificationStats(userId: string): Promise<{
    total: number;
    unread: number;
    read: number;
    byType: { type: string; count: number }[];
  }>;
}

/**
 * Notification repository implementation
 */
export class NotificationRepository
  extends BaseRepository<
    Notification,
    NotificationCreateInput,
    NotificationUpdateInput
  >
  implements INotificationRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "Notification", metricsCollector);
  }

  /**
   * Find notification by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<Notification | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.NotificationFindUniqueArgs;

      const result = await this.db.notification.findUnique(queryOptions);
      return result as Notification | null;
    });
  }

  /**
   * Find multiple notifications
   */
  async findMany(options?: QueryOptions): Promise<Notification[]> {
    return this.executeOperation("findMany", async () => {
      const result = await this.db.notification.findMany({
        ...options,
      });
      return result as Notification[];
    });
  }

  /**
   * Find first notification matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<Notification | null> {
    return this.executeOperation("findFirst", async () => {
      const result = await this.db.notification.findFirst({
        ...options,
      });
      return result as Notification | null;
    });
  }

  /**
   * Count notifications
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      return this.db.notification.count({
        ...(options?.where && { where: options.where }),
      });
    });
  }

  /**
   * Create new notification
   */
  async create(data: NotificationCreateInput): Promise<Notification> {
    return this.executeOperation("create", async () => {
      const result = await this.db.notification.create({
        data,
      });
      return result as Notification;
    });
  }

  /**
   * Create multiple notifications
   */
  async createMany(data: NotificationCreateInput[]): Promise<Notification[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((notificationData) =>
          this.db.notification.create({
            data: notificationData,
          })
        )
      );
      return results as Notification[];
    });
  }

  /**
   * Update notification by ID
   */
  async updateById(
    id: string,
    data: NotificationUpdateInput
  ): Promise<Notification> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.notification.update({
        where: { id },
        data,
      });
      return result as Notification;
    });
  }

  /**
   * Update multiple notifications
   */
  async updateMany(
    where: Record<string, unknown>,
    data: NotificationUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.notification.updateMany({
        where,
        data,
      });
    });
  }

  /**
   * Delete notification by ID
   */
  async deleteById(id: string): Promise<Notification> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.notification.delete({
        where: { id },
      });
      return result as Notification;
    });
  }

  /**
   * Delete multiple notifications
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.notification.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if notification exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.notification.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: INotificationRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new NotificationRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find notifications by user ID
   */
  async findByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<Notification[]> {
    return this.executeOperation("findByUserId", async () => {
      const result = await this.db.notification.findMany({
        where: { userId, ...options?.where },
        ...options,
      });
      return result as Notification[];
    });
  }

  /**
   * Find notifications by type
   */
  async findByType(
    type: string,
    options?: QueryOptions
  ): Promise<Notification[]> {
    return this.executeOperation("findByType", async () => {
      const result = await this.db.notification.findMany({
        where: { type, ...options?.where },
        ...options,
      });
      return result as Notification[];
    });
  }

  /**
   * Find unread notifications for user
   */
  async findUnreadByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<Notification[]> {
    return this.executeOperation("findUnreadByUserId", async () => {
      const result = await this.db.notification.findMany({
        where: {
          userId,
          read: false,
          ...options?.where,
        },
        ...options,
      });
      return result as Notification[];
    });
  }

  /**
   * Find read notifications for user
   */
  async findReadByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<Notification[]> {
    return this.executeOperation("findReadByUserId", async () => {
      const result = await this.db.notification.findMany({
        where: {
          userId,
          read: true,
          ...options?.where,
        },
        ...options,
      });
      return result as Notification[];
    });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id: string): Promise<Notification> {
    return this.executeOperation("markAsRead", async () => {
      const result = await this.db.notification.update({
        where: { id },
        data: {
          read: true,
          readAt: new Date(),
        },
      });
      return result as Notification;
    });
  }

  /**
   * Mark multiple notifications as read
   */
  async markMultipleAsRead(ids: string[]): Promise<{ count: number }> {
    return this.executeOperation("markMultipleAsRead", async () => {
      return this.db.notification.updateMany({
        where: {
          id: {
            in: ids,
          },
        },
        data: {
          read: true,
          readAt: new Date(),
        },
      });
    });
  }

  /**
   * Mark all user notifications as read
   */
  async markAllAsRead(userId: string): Promise<{ count: number }> {
    return this.executeOperation("markAllAsRead", async () => {
      return this.db.notification.updateMany({
        where: {
          userId,
          read: false,
        },
        data: {
          read: true,
          readAt: new Date(),
        },
      });
    });
  }

  /**
   * Get unread count for user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.executeOperation("getUnreadCount", async () => {
      const count = await this.db.notification.count({
        where: {
          userId,
          read: false,
        },
      });
      return count;
    });
  }

  /**
   * Delete read notifications older than date
   */
  async cleanupOldReadNotifications(
    olderThan: Date
  ): Promise<{ count: number }> {
    return this.executeOperation("cleanupOldReadNotifications", async () => {
      return this.db.notification.deleteMany({
        where: {
          read: true,
          readAt: {
            lt: olderThan,
          },
        },
      });
    });
  }

  /**
   * Get notification statistics
   */
  async getNotificationStats(userId: string): Promise<{
    total: number;
    unread: number;
    read: number;
    byType: { type: string; count: number }[];
  }> {
    return this.executeOperation("getNotificationStats", async () => {
      const [total, unread, read, byTypeResult] = await Promise.all([
        this.db.notification.count({ where: { userId } }),
        this.db.notification.count({ where: { userId, read: false } }),
        this.db.notification.count({ where: { userId, read: true } }),
        this.db.notification.groupBy({
          by: ["type"],
          where: { userId },
          _count: {
            type: true,
          },
        }),
      ]);

      const byType = byTypeResult.map((item) => ({
        type: item.type,
        count: item._count.type,
      }));

      return {
        total,
        unread,
        read,
        byType,
      };
    });
  }
}
