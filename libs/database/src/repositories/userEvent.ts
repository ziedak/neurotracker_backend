/**
 * @fileoverview UserEvent Repository Implementation
 * @module database/repositories/userEvent
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type { UserEvent } from "../models";
import type { Prisma } from "@prisma/client";

/**
 * UserEvent creation input type
 */
export type UserEventCreateInput = Omit<
  Prisma.UserEventCreateInput,
  "id" | "timestamp"
> & {
  id?: string;
  timestamp?: Date;
};

/**
 * UserEvent update input type
 */
export type UserEventUpdateInput = Prisma.UserEventUpdateInput;

/**
 * UserEvent repository interface
 */
export interface IUserEventRepository
  extends BaseRepository<
    UserEvent,
    UserEventCreateInput,
    UserEventUpdateInput
  > {
  /**
   * Find events by user ID
   */
  findByUserId(userId: string, options?: QueryOptions): Promise<UserEvent[]>;

  /**
   * Find events by session ID
   */
  findBySessionId(
    sessionId: string,
    options?: QueryOptions
  ): Promise<UserEvent[]>;

  /**
   * Find events by event type
   */
  findByEventType(
    eventType: string,
    options?: QueryOptions
  ): Promise<UserEvent[]>;

  /**
   * Find events within date range
   */
  findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<UserEvent[]>;

  /**
   * Find events by user and event type
   */
  findByUserAndEventType(
    userId: string,
    eventType: string,
    options?: QueryOptions
  ): Promise<UserEvent[]>;

  /**
   * Find error events
   */
  findErrors(options?: QueryOptions): Promise<UserEvent[]>;

  /**
   * Get user activity summary
   */
  getUserActivitySummary(
    userId: string
  ): Promise<{ eventType: string; count: number }[]>;

  /**
   * Get event type statistics
   */
  getEventTypeStats(): Promise<
    { eventType: string; count: number; errorCount: number }[]
  >;

  /**
   * Clean up old events
   */
  cleanupOldEvents(olderThan: Date): Promise<{ count: number }>;
}

/**
 * UserEvent repository implementation
 */
export class UserEventRepository
  extends BaseRepository<
    UserEvent,
    UserEventCreateInput,
    UserEventUpdateInput
  >
  implements IUserEventRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "UserEvent", metricsCollector);
  }

  /**
   * Find user event by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<UserEvent | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.UserEventFindUniqueArgs;

      const result = await this.db.userEvent.findUnique(queryOptions);
      return result as UserEvent | null;
    });
  }

  /**
   * Find multiple user events
   */
  async findMany(options?: QueryOptions): Promise<UserEvent[]> {
    return this.executeOperation("findMany", async () => {
      const result = await this.db.userEvent.findMany({
        ...options,
      });
      return result as UserEvent[];
    });
  }

  /**
   * Find first user event matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<UserEvent | null> {
    return this.executeOperation("findFirst", async () => {
      const result = await this.db.userEvent.findFirst({
        ...options,
      });
      return result as UserEvent | null;
    });
  }

  /**
   * Count user events
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { include, ...countOptions } = options ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (this.db.userEvent.count as any)(countOptions);
    });
  }

  /**
   * Create new user event
   */
  async create(data: UserEventCreateInput): Promise<UserEvent> {
    return this.executeOperation("create", async () => {
      const result = await this.db.userEvent.create({
        data: {
          ...data,
          timestamp: data.timestamp ?? new Date(),
        },
      });
      return result as UserEvent;
    });
  }

  /**
   * Create multiple user events
   */
  async createMany(data: UserEventCreateInput[]): Promise<UserEvent[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((eventData) =>
          this.db.userEvent.create({
            data: {
              ...eventData,
              timestamp: eventData.timestamp ?? new Date(),
            },
          })
        )
      );
      return results as UserEvent[];
    });
  }

  /**
   * Update user event by ID
   */
  async updateById(id: string, data: UserEventUpdateInput): Promise<UserEvent> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.userEvent.update({
        where: { id },
        data,
      });
      return result as UserEvent;
    });
  }

  /**
   * Update multiple user events
   */
  async updateMany(
    where: Record<string, unknown>,
    data: UserEventUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.userEvent.updateMany({
        where,
        data,
      });
    });
  }

  /**
   * Delete user event by ID
   */
  async deleteById(id: string): Promise<UserEvent> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.userEvent.delete({
        where: { id },
      });
      return result as UserEvent;
    });
  }

  /**
   * Delete multiple user events
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.userEvent.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if user event exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.userEvent.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IUserEventRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new UserEventRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find events by user ID
   */
  async findByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<UserEvent[]> {
    return this.executeOperation("findByUserId", async () => {
      const result = await this.db.userEvent.findMany({
        where: { userId, ...options?.where },
        ...options,
      });
      return result as UserEvent[];
    });
  }

  /**
   * Find events by session ID
   */
  async findBySessionId(
    sessionId: string,
    options?: QueryOptions
  ): Promise<UserEvent[]> {
    return this.executeOperation("findBySessionId", async () => {
      const result = await this.db.userEvent.findMany({
        where: { sessionId, ...options?.where },
        ...options,
      });
      return result as UserEvent[];
    });
  }

  /**
   * Find events by event type
   */
  async findByEventType(
    eventType: string,
    options?: QueryOptions
  ): Promise<UserEvent[]> {
    return this.executeOperation("findByEventType", async () => {
      const result = await this.db.userEvent.findMany({
        where: { eventType, ...options?.where },
        ...options,
      });
      return result as UserEvent[];
    });
  }

  /**
   * Find events within date range
   */
  async findByDateRange(
    startDate: Date,
    endDate: Date,
    options?: QueryOptions
  ): Promise<UserEvent[]> {
    return this.executeOperation("findByDateRange", async () => {
      const result = await this.db.userEvent.findMany({
        where: {
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
          ...options?.where,
        },
        ...options,
      });
      return result as UserEvent[];
    });
  }

  /**
   * Find events by user and event type
   */
  async findByUserAndEventType(
    userId: string,
    eventType: string,
    options?: QueryOptions
  ): Promise<UserEvent[]> {
    return this.executeOperation("findByUserAndEventType", async () => {
      const result = await this.db.userEvent.findMany({
        where: {
          userId,
          eventType,
          ...options?.where,
        },
        ...options,
      });
      return result as UserEvent[];
    });
  }

  /**
   * Find error events
   */
  async findErrors(options?: QueryOptions): Promise<UserEvent[]> {
    return this.executeOperation("findErrors", async () => {
      const result = await this.db.userEvent.findMany({
        where: {
          isError: true,
          ...options?.where,
        },
        ...options,
      });
      return result as UserEvent[];
    });
  }

  /**
   * Get user activity summary
   */
  async getUserActivitySummary(
    userId: string
  ): Promise<{ eventType: string; count: number }[]> {
    return this.executeOperation("getUserActivitySummary", async () => {
      const result = await this.db.userEvent.groupBy({
        by: ["eventType"],
        where: { userId },
        _count: {
          eventType: true,
        },
        orderBy: {
          _count: {
            eventType: "desc",
          },
        },
      });

      return result.map((item) => ({
        eventType: item.eventType,
        count: item._count.eventType,
      }));
    });
  }

  /**
   * Get event type statistics
   */
  async getEventTypeStats(): Promise<
    { eventType: string; count: number; errorCount: number }[]
  > {
    return this.executeOperation("getEventTypeStats", async () => {
      const result = await this.db.userEvent.groupBy({
        by: ["eventType"],
        _count: {
          eventType: true,
        },
        where: {
          isError: true,
        },
      });

      const errorCounts = new Map(
        result.map((item) => [item.eventType, item._count.eventType])
      );

      const allEvents = await this.db.userEvent.groupBy({
        by: ["eventType"],
        _count: {
          eventType: true,
        },
      });

      return allEvents.map((item) => ({
        eventType: item.eventType,
        count: item._count.eventType,
        errorCount: errorCounts.get(item.eventType) ?? 0,
      }));
    });
  }

  /**
   * Clean up old events
   */
  async cleanupOldEvents(olderThan: Date): Promise<{ count: number }> {
    return this.executeOperation("cleanupOldEvents", async () => {
      return this.db.userEvent.deleteMany({
        where: {
          timestamp: {
            lt: olderThan,
          },
        },
      });
    });
  }
}
