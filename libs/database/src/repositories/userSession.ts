/**
 * @fileoverview UserSession Repository Implementation
 * @module database/repositories/userSession
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { DatabaseClient } from "../types/DatabaseClient";
import type { IMetricsCollector } from "@libs/monitoring";
import type { ICache } from "../cache";
import { BaseRepository, type QueryOptions } from "./base";
import type {
  UserSession,
  UserSessionCreateInput,
  UserSessionUpdateInput,
} from "../models";
import type { Prisma } from "@prisma/client";

/**
 * UserSession repository interface
 */
export interface IUserSessionRepository
  extends BaseRepository<
    UserSession,
    UserSessionCreateInput,
    UserSessionUpdateInput
  > {
  /**
   * Find sessions by user ID
   */
  findByUserId(userId: string, options?: QueryOptions): Promise<UserSession[]>;

  /**
   * Find active sessions by user ID
   */
  findActiveByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<UserSession[]>;

  /**
   * Find session by session token
   */
  findBySessionToken(sessionToken: string): Promise<UserSession | null>;

  /**
   * Find expired sessions
   */
  findExpired(options?: QueryOptions): Promise<UserSession[]>;

  /**
   * Update session last activity
   */
  updateLastActivity(id: string): Promise<UserSession>;

  /**
   * Invalidate session by ID
   */
  invalidateSession(id: string): Promise<UserSession>;

  /**
   * Invalidate all sessions for user
   */
  invalidateAllUserSessions(userId: string): Promise<{ count: number }>;

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): Promise<{ count: number }>;
}

/**
 * UserSession repository implementation
 */
export class UserSessionRepository
  extends BaseRepository<
    UserSession,
    UserSessionCreateInput,
    UserSessionUpdateInput
  >
  implements IUserSessionRepository
{
  constructor(
    protected override readonly db: DatabaseClient,
    protected override readonly metricsCollector?: IMetricsCollector,
    protected readonly cacheService?: ICache
  ) {
    super(db, "UserSession", metricsCollector);
  }

  /**
   * Find user session by ID
   */
  async findById(
    id: string,
    options?: QueryOptions
  ): Promise<UserSession | null> {
    return this.executeOperation("findById", async () => {
      const { where, include, select } = options ?? {};
      const queryOptions = {
        where: { id, ...where },
        ...(select && { select }),
        ...(include && { include }),
      } as Prisma.UserSessionFindUniqueArgs;

      const result = await this.db.userSession.findUnique(queryOptions);
      return result as UserSession | null;
    });
  }

  /**
   * Find multiple user sessions
   */
  async findMany(options?: QueryOptions): Promise<UserSession[]> {
    return this.executeOperation("findMany", async () => {
      const result = await this.db.userSession.findMany({
        ...options,
      });
      return result as UserSession[];
    });
  }

  /**
   * Find first user session matching criteria
   */
  async findFirst(options?: QueryOptions): Promise<UserSession | null> {
    return this.executeOperation("findFirst", async () => {
      const result = await this.db.userSession.findFirst({
        ...options,
      });
      return result as UserSession | null;
    });
  }

  /**
   * Count user sessions
   */
  async count(options?: QueryOptions): Promise<number> {
    return this.executeOperation("count", async () => {
      // Count operations don't support include, so we omit it
      return this.db.userSession.count({
        ...(options?.where && { where: options.where }),
      });
    });
  }

  /**
   * Create new user session
   */
  async create(data: UserSessionCreateInput): Promise<UserSession> {
    return this.executeOperation("create", async () => {
      const result = await this.db.userSession.create({
        data,
      });
      return result as UserSession;
    });
  }

  /**
   * Create multiple user sessions
   */
  async createMany(data: UserSessionCreateInput[]): Promise<UserSession[]> {
    return this.executeOperation("createMany", async () => {
      const results = await Promise.all(
        data.map((sessionData) =>
          this.db.userSession.create({
            data: sessionData,
          })
        )
      );
      return results as UserSession[];
    });
  }

  /**
   * Update user session by ID
   */
  async updateById(
    id: string,
    data: UserSessionUpdateInput
  ): Promise<UserSession> {
    return this.executeOperation("updateById", async () => {
      const result = await this.db.userSession.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
      return result as UserSession;
    });
  }

  /**
   * Update multiple user sessions
   */
  async updateMany(
    where: Record<string, unknown>,
    data: UserSessionUpdateInput
  ): Promise<{ count: number }> {
    return this.executeOperation("updateMany", async () => {
      return this.db.userSession.updateMany({
        where,
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Delete user session by ID
   */
  async deleteById(id: string): Promise<UserSession> {
    return this.executeOperation("deleteById", async () => {
      const result = await this.db.userSession.delete({
        where: { id },
      });
      return result as UserSession;
    });
  }

  /**
   * Delete multiple user sessions
   */
  async deleteMany(where: Record<string, unknown>): Promise<{ count: number }> {
    return this.executeOperation("deleteMany", async () => {
      return this.db.userSession.deleteMany({
        where,
      });
    });
  }

  /**
   * Check if user session exists
   */
  async exists(where: Record<string, unknown>): Promise<boolean> {
    return this.executeOperation("exists", async () => {
      const count = await this.db.userSession.count({
        where,
      });
      return count > 0;
    });
  }

  /**
   * Execute operation within transaction
   */
  async transaction<R>(
    callback: (repo: IUserSessionRepository) => Promise<R>
  ): Promise<R> {
    return this.db.$transaction(async (tx) => {
      const txRepo = new UserSessionRepository(
        tx as DatabaseClient,
        this.metricsCollector,
        this.cacheService
      );
      return callback(txRepo);
    });
  }

  /**
   * Find sessions by user ID
   */
  async findByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<UserSession[]> {
    return this.executeOperation("findByUserId", async () => {
      const result = await this.db.userSession.findMany({
        where: { userId, ...options?.where },
        ...options,
      });
      return result as UserSession[];
    });
  }

  /**
   * Find active sessions by user ID
   */
  async findActiveByUserId(
    userId: string,
    options?: QueryOptions
  ): Promise<UserSession[]> {
    return this.executeOperation("findActiveByUserId", async () => {
      const result = await this.db.userSession.findMany({
        where: {
          userId,
          expiresAt: {
            gt: new Date(),
          },
          ...options?.where,
        },
        ...options,
      });
      return result as UserSession[];
    });
  }

  /**
   * Find session by session token
   */
  async findBySessionToken(sessionToken: string): Promise<UserSession | null> {
    return this.executeOperation("findBySessionToken", async () => {
      const result = await this.db.userSession.findUnique({
        where: { sessionId: sessionToken },
      });
      return result as UserSession | null;
    });
  }

  /**
   * Find expired sessions
   */
  async findExpired(options?: QueryOptions): Promise<UserSession[]> {
    return this.executeOperation("findExpired", async () => {
      const result = await this.db.userSession.findMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
          ...options?.where,
        },
        ...options,
      });
      return result as UserSession[];
    });
  }

  /**
   * Update session last activity
   */
  async updateLastActivity(id: string): Promise<UserSession> {
    return this.executeOperation("updateLastActivity", async () => {
      const result = await this.db.userSession.update({
        where: { id },
        data: {
          lastAccessedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return result as UserSession;
    });
  }

  /**
   * Invalidate session by ID
   */
  async invalidateSession(id: string): Promise<UserSession> {
    return this.executeOperation("invalidateSession", async () => {
      const result = await this.db.userSession.update({
        where: { id },
        data: {
          expiresAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return result as UserSession;
    });
  }

  /**
   * Invalidate all sessions for user
   */
  async invalidateAllUserSessions(userId: string): Promise<{ count: number }> {
    return this.executeOperation("invalidateAllUserSessions", async () => {
      return this.db.userSession.updateMany({
        where: { userId },
        data: {
          expiresAt: new Date(),
          updatedAt: new Date(),
        },
      });
    });
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<{ count: number }> {
    return this.executeOperation("cleanupExpiredSessions", async () => {
      return this.db.userSession.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });
    });
  }
}
