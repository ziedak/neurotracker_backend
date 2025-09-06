import { MetricsCollector } from "@libs/monitoring";
import { PostgreSQLClient } from "@libs/database";
import { CacheService } from "./CacheService";
import { APIGatewayService } from "./APIGatewayService";
import { createLogger } from "@libs/utils";

export interface User {
  id: string;
  email: string;
  name?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithSessions extends User {
  sessions: Array<{
    id: string;
    sessionId: string;
    createdAt: Date;
    expiresAt?: Date | null;
  }>;
}

export interface UserFilters {
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface UserStats {
  total: number;
  withSessions: number;
  recentUsers: number;
  activeToday: number;
}

export interface CreateUserData {
  email: string;
  name?: string;
}

export interface UpdateUserData {
  name?: string;
}

/**
 * User Service for Dashboard
 * Handles user management and authentication
 */
export class UserService {
  private readonly db = PostgreSQLClient;
  private readonly cache: CacheService;
  private readonly gateway: APIGatewayService;
  private readonly logger = createLogger("dashboard-user-service");
  private readonly metrics: MetricsCollector;

  constructor(
    cache: CacheService,
    gateway: APIGatewayService,
    metrics: MetricsCollector
  ) {
    this.cache = cache;
    this.gateway = gateway;
    this.metrics = metrics;
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<User | null> {
    try {
      await this.metrics.recordCounter("user_service_get_by_id_requests");

      // Check cache first
      const cacheKey = `user:${id}`;
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        await this.metrics.recordCounter("user_service_cache_hits");
        return cached as User;
      }

      const user = await this.db.user.findUnique({
        where: { id },
      });

      if (user) {
        // Cache for 5 minutes
        await this.cache.set(cacheKey, user, 300);
        await this.metrics.recordCounter("user_service_cache_sets");
      }

      return user;
    } catch (error) {
      this.logger.error("Failed to get user by ID", error as Error, {
        userId: id,
      });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      await this.metrics.recordCounter("user_service_get_by_email_requests");

      const user = await this.db.user.findUnique({
        where: { email },
      });

      if (user) {
        // Cache by ID as well
        const cacheKey = `user:${user.id}`;
        await this.cache.set(cacheKey, user, 300);
      }

      return user;
    } catch (error) {
      this.logger.error("Failed to get user by email", error as Error, {
        email,
      });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Get all users with optional filters
   */
  async getUsers(
    filters: UserFilters = {},
    limit: number = 50,
    offset: number = 0
  ): Promise<User[]> {
    try {
      await this.metrics.recordCounter("user_service_get_users_requests");

      const where: any = {};

      if (filters.search) {
        where.OR = [
          { email: { contains: filters.search, mode: "insensitive" } },
          { name: { contains: filters.search, mode: "insensitive" } },
        ];
      }

      if (filters.dateFrom || filters.dateTo) {
        where.createdAt = {};
        if (filters.dateFrom) {
          where.createdAt.gte = filters.dateFrom;
        }
        if (filters.dateTo) {
          where.createdAt.lte = filters.dateTo;
        }
      }

      const users = await this.db.user.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
      });

      return users;
    } catch (error) {
      this.logger.error("Failed to get users", error as Error, {
        filters,
        limit,
        offset,
      });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Create a new user
   */
  async createUser(userData: CreateUserData): Promise<User> {
    try {
      await this.metrics.recordCounter("user_service_create_requests");

      // Check if user already exists
      const existingUser = await this.getUserByEmail(userData.email);
      if (existingUser) {
        throw new Error("User with this email already exists");
      }

      const user = await this.db.user.create({
        data: userData,
      });

      // Cache the new user
      const cacheKey = `user:${user.id}`;
      await this.cache.set(cacheKey, user, 300);

      this.logger.info("User created", { userId: user.id, email: user.email });
      await this.metrics.recordCounter("user_service_creates");

      return user;
    } catch (error) {
      this.logger.error("Failed to create user", error as Error, { userData });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Update a user
   */
  async updateUser(id: string, updateData: UpdateUserData): Promise<User> {
    try {
      await this.metrics.recordCounter("user_service_update_requests");

      const user = await this.db.user.update({
        where: { id },
        data: updateData,
      });

      // Update cache
      const cacheKey = `user:${id}`;
      await this.cache.set(cacheKey, user, 300);

      this.logger.info("User updated", {
        userId: id,
        updates: Object.keys(updateData),
      });
      await this.metrics.recordCounter("user_service_updates");

      return user;
    } catch (error) {
      this.logger.error("Failed to update user", error as Error, {
        userId: id,
        updateData,
      });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Delete a user
   */
  async deleteUser(id: string): Promise<void> {
    try {
      await this.metrics.recordCounter("user_service_delete_requests");

      await this.db.user.delete({
        where: { id },
      });

      // Remove from cache
      const cacheKey = `user:${id}`;
      await this.cache.delete(cacheKey);

      this.logger.info("User deleted", { userId: id });
      await this.metrics.recordCounter("user_service_deletes");
    } catch (error) {
      this.logger.error("Failed to delete user", error as Error, {
        userId: id,
      });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Get user with sessions
   */
  async getUserWithSessions(id: string): Promise<UserWithSessions | null> {
    try {
      await this.metrics.recordCounter(
        "user_service_get_with_sessions_requests"
      );

      const user = await this.db.user.findUnique({
        where: { id },
        include: {
          sessions: {
            select: {
              id: true,
              sessionId: true,
              createdAt: true,
              expiresAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      return user;
    } catch (error) {
      this.logger.error("Failed to get user with sessions", error as Error, {
        userId: id,
      });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Get user statistics
   */
  async getUserStats(): Promise<UserStats> {
    try {
      await this.metrics.recordCounter("user_service_stats_requests");

      // Check cache first
      const cacheKey = "user_stats";
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        return cached as UserStats;
      }

      const [total, withSessions, recentUsers, activeToday] = await Promise.all(
        [
          this.db.user.count(),
          this.db.user.count({
            where: {
              sessions: {
                some: {},
              },
            },
          }),
          this.db.user.count({
            where: {
              createdAt: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
              },
            },
          }),
          this.db.user.count({
            where: {
              sessions: {
                some: {
                  createdAt: {
                    gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
                  },
                },
              },
            },
          }),
        ]
      );

      const stats: UserStats = {
        total,
        withSessions,
        recentUsers,
        activeToday,
      };

      // Cache for 10 minutes
      await this.cache.set(cacheKey, stats, 600);

      return stats;
    } catch (error) {
      this.logger.error("Failed to get user stats", error as Error);
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Search users across multiple fields
   */
  async searchUsers(query: string, limit: number = 20): Promise<User[]> {
    try {
      await this.metrics.recordCounter("user_service_search_requests");

      const users = await this.db.user.findMany({
        where: {
          OR: [
            { email: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
          ],
        },
        take: limit,
        orderBy: { name: "asc" },
      });

      return users;
    } catch (error) {
      this.logger.error("Failed to search users", error as Error, { query });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Get user events
   */
  async getUserEvents(userId: string, limit: number = 50): Promise<any[]> {
    try {
      await this.metrics.recordCounter("user_service_events_requests");

      const events = await this.db.userEvent.findMany({
        where: { userId },
        take: limit,
        orderBy: { timestamp: "desc" },
      });

      return events;
    } catch (error) {
      this.logger.error("Failed to get user events", error as Error, {
        userId,
      });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Get user carts
   */
  async getUserCarts(userId: string): Promise<any[]> {
    try {
      await this.metrics.recordCounter("user_service_carts_requests");

      const carts = await this.db.cart.findMany({
        where: { userId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      return carts;
    } catch (error) {
      this.logger.error("Failed to get user carts", error as Error, { userId });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Get active sessions through API Gateway
   */
  async getActiveSessions(userId: string, authHeader?: string): Promise<any[]> {
    try {
      await this.metrics.recordCounter("user_service_session_requests");

      // Get sessions from database instead of API Gateway for now
      const sessions = await this.db.userSession.findMany({
        where: {
          userId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: "desc" },
      });

      return sessions;
    } catch (error) {
      this.logger.error("Failed to get active sessions", error as Error, {
        userId,
      });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Revoke user session
   */
  async revokeSession(sessionId: string): Promise<void> {
    try {
      await this.metrics.recordCounter("user_service_session_revocations");

      await this.db.userSession.delete({
        where: { sessionId },
      });

      this.logger.info("User session revoked", { sessionId });
    } catch (error) {
      this.logger.error("Failed to revoke session", error as Error, {
        sessionId,
      });
      await this.metrics.recordCounter("user_service_errors");
      throw error;
    }
  }

  /**
   * Clear user cache
   */
  async clearUserCache(userId?: string): Promise<void> {
    try {
      if (userId) {
        await this.cache.delete(`user:${userId}`);
      } else {
        await this.cache.deletePattern("user:*");
        await this.cache.delete("user_stats");
      }

      this.logger.info("User cache cleared", { userId });
    } catch (error) {
      this.logger.error("Failed to clear user cache", error as Error, {
        userId,
      });
    }
  }
}
