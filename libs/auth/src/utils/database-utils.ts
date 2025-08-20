/**
 * @fileoverview Auth Database Utils - Leveraging existing libs/database infrastructure
 * Uses PostgreSQLClient and RedisClient from libs/database for auth operations
 *
 * @version 3.0.0 - Production Ready
 * @author Enterprise Auth Foundation
 */

import { PostgreSQLClient, RedisClient } from "@libs/database";

/**
 * Auth-focused database operations using existing libs/database infrastructure
 * Provides caching, session management, and auth-specific database patterns
 */
export class AuthDatabaseUtils {
  private static instance: AuthDatabaseUtils;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): AuthDatabaseUtils {
    if (!AuthDatabaseUtils.instance) {
      AuthDatabaseUtils.instance = new AuthDatabaseUtils();
    }
    return AuthDatabaseUtils.instance;
  }

  /**
   * Get PostgreSQL client (Prisma instance)
   */
  getPostgresClient(): any {
    return PostgreSQLClient.getInstance();
  }

  /**
   * Get Redis client
   */
  getRedisClient(): any {
    return RedisClient.getInstance();
  }

  /**
   * Health check for database connections
   */
  async healthCheck(): Promise<{ postgres: any; redis: boolean }> {
    try {
      const [postgresHealth, redisHealth] = await Promise.all([
        PostgreSQLClient.healthCheck(),
        RedisClient.getInstance().ping(),
      ]);
      return {
        postgres: postgresHealth,
        redis: redisHealth === "PONG",
      };
    } catch (error) {
      return { postgres: { status: "unhealthy" }, redis: false };
    }
  }

  /**
   * Execute database transaction
   */
  async transaction<T>(callback: (prisma: any) => Promise<T>): Promise<T> {
    return PostgreSQLClient.transaction(callback);
  }

  /**
   * User operations with Redis caching
   */
  async getUserById(userId: string): Promise<any> {
    const cacheKey = `auth:user:${userId}`;
    const redis = RedisClient.getInstance();

    try {
      // Try cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn("[AuthDatabaseUtils] Cache retrieval failed:", error);
    }

    // Get from database
    const prisma = PostgreSQLClient.getInstance();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        sessions: { where: { isActive: true } },
      },
    });

    // Cache for 1 hour if found
    if (user) {
      try {
        await redis.setex(cacheKey, 3600, JSON.stringify(user));
      } catch (error) {
        console.warn("[AuthDatabaseUtils] Cache storage failed:", error);
      }
    }

    return user;
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<any> {
    const prisma = PostgreSQLClient.getInstance();
    return prisma.user.findUnique({
      where: { email },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        sessions: { where: { isActive: true } },
      },
    });
  }

  /**
   * Update user and invalidate cache
   */
  async updateUser(userId: string, updates: Record<string, any>): Promise<any> {
    const prisma = PostgreSQLClient.getInstance();
    const redis = RedisClient.getInstance();

    const result = await prisma.user.update({
      where: { id: userId },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        sessions: { where: { isActive: true } },
      },
    });

    // Invalidate cache
    try {
      await redis.del(`auth:user:${userId}`);
    } catch (error) {
      console.warn("[AuthDatabaseUtils] Cache invalidation failed:", error);
    }

    return result;
  }

  /**
   * Session management with Redis
   */
  async createSession(sessionData: {
    userId: string;
    sessionId: string;
    expiresAt?: Date;
    ipAddress?: string;
    userAgent?: string;
    metadata?: any;
  }): Promise<any> {
    const prisma = PostgreSQLClient.getInstance();
    const redis = RedisClient.getInstance();

    // Create in database
    const session = await prisma.userSession.create({
      data: {
        ...sessionData,
        metadata: sessionData.metadata || {},
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Cache in Redis
    try {
      const cacheKey = `auth:session:${sessionData.sessionId}`;
      const ttl = sessionData.expiresAt
        ? Math.floor((sessionData.expiresAt.getTime() - Date.now()) / 1000)
        : 86400;

      await redis.setex(cacheKey, Math.max(ttl, 0), JSON.stringify(session));
    } catch (error) {
      console.warn("[AuthDatabaseUtils] Session cache failed:", error);
    }

    return session;
  }

  /**
   * Get session with Redis fallback
   */
  async getSession(sessionId: string): Promise<any> {
    const cacheKey = `auth:session:${sessionId}`;
    const redis = RedisClient.getInstance();

    try {
      // Try Redis first
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.warn(
        "[AuthDatabaseUtils] Session cache retrieval failed:",
        error
      );
    }

    // Fallback to database
    const prisma = PostgreSQLClient.getInstance();
    return prisma.userSession.findUnique({
      where: { sessionId },
      include: { user: true },
    });
  }

  /**
   * Delete session (both Redis and database)
   */
  async deleteSession(sessionId: string): Promise<any> {
    const prisma = PostgreSQLClient.getInstance();
    const redis = RedisClient.getInstance();

    // Update database (soft delete)
    const result = await prisma.userSession.update({
      where: { sessionId },
      data: {
        isActive: false,
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Remove from cache
    try {
      await redis.del(`auth:session:${sessionId}`);
    } catch (error) {
      console.warn("[AuthDatabaseUtils] Session cache deletion failed:", error);
    }

    return result;
  }

  /**
   * Permission caching
   */
  async cacheUserPermissions(
    userId: string,
    permissions: string[],
    ttl: number = 3600
  ): Promise<void> {
    try {
      const cacheKey = `auth:permissions:${userId}`;
      await RedisClient.getInstance().setex(
        cacheKey,
        ttl,
        JSON.stringify(permissions)
      );
    } catch (error) {
      console.warn("[AuthDatabaseUtils] Permission cache failed:", error);
    }
  }

  /**
   * Get cached permissions
   */
  async getCachedUserPermissions(userId: string): Promise<string[] | null> {
    try {
      const cacheKey = `auth:permissions:${userId}`;
      const cached = await RedisClient.getInstance().get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.warn(
        "[AuthDatabaseUtils] Permission cache retrieval failed:",
        error
      );
      return null;
    }
  }

  /**
   * Security event logging
   */
  async logSecurityEvent(
    userId: string,
    eventType: string,
    metadata?: any
  ): Promise<any> {
    const prisma = PostgreSQLClient.getInstance();
    return prisma.userEvent.create({
      data: {
        userId,
        eventType,
        metadata: metadata || {},
        timestamp: new Date(),
        isError: false,
      },
    });
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const prisma = PostgreSQLClient.getInstance();
    const result = await prisma.userSession.updateMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          {
            AND: [
              { expiresAt: null },
              {
                createdAt: {
                  lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                },
              }, // 30 days
            ],
          },
        ],
        isActive: true,
      },
      data: {
        isActive: false,
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return result.count;
  }
}

/**
 * Export singleton instance for dependency injection
 */
export const createDatabaseUtils = () => {
  return AuthDatabaseUtils.getInstance();
};

// Export the class as well for direct usage
export { AuthDatabaseUtils as DatabaseUtils };
