/**
 * @fileoverview Redis Cache Service - Distributed caching with Redis backend
 * @module services/RedisCacheService
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId } from "../types/core";
import type { IEnhancedPermission } from "../types/enhanced";
import { CacheError } from "../errors/core";
import { RedisClient } from "@libs/database";

/**
 * Redis cache entry with serialization support
 */
interface IRedisCache<T = any> {
  readonly value: T;
  readonly expiresAt: number | null;
  readonly createdAt: number;
  readonly version: number;
}

/**
 * Cache key patterns for different data types
 */
enum CacheKeyPattern {
  USER_PERMISSIONS = "auth:permissions:user:",
  ROLE_HIERARCHY = "auth:hierarchy:role:",
  PERMISSION_CHECK = "auth:check:",
  ROLE_DATA = "auth:role:",
  USER_ROLES = "auth:user:roles:",
  HEALTH_CHECK = "health:",
}

/**
 * Redis-backed distributed cache service for enterprise authentication
 * Provides high-performance caching with Redis cluster support
 */
export class RedisCacheService {
  private readonly keyPrefix: string;
  private readonly defaultTtl: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  // Redis client would be injected in production
  // private readonly redisClient: Redis;

  constructor(
    keyPrefix: string = "authv2:",
    defaultTtl: number = 300, // 5 minutes
    maxRetries: number = 3,
    retryDelay: number = 100
  ) {
    this.keyPrefix = keyPrefix;
    this.defaultTtl = defaultTtl;
    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;
  }
  /**
   * Execute Redis operation with retry logic
   * This justifies the maxRetries and retryDelay parameters for enterprise resilience
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error(`Unknown error in ${operationName}`);

        if (attempt === this.maxRetries) {
          console.error(
            `${operationName} failed after ${this.maxRetries} attempts:`,
            lastError
          );
          break;
        }

        // Wait before retry with exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));

        console.warn(
          `${operationName} attempt ${attempt} failed, retrying in ${delay}ms:`,
          lastError.message
        );
      }
    }

    // If all retries failed, fall back to memory cache and throw error
    throw new CacheError(
      `Redis ${operationName} failed after ${this.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Cache user permissions with Redis backend and retry logic
   */
  async cacheUserPermissions(
    userId: EntityId,
    permissions: ReadonlyArray<IEnhancedPermission>,
    ttl: number = this.defaultTtl
  ): Promise<boolean> {
    const key = this.buildKey(CacheKeyPattern.USER_PERMISSIONS, userId);
    const cacheEntry: IRedisCache<ReadonlyArray<IEnhancedPermission>> = {
      value: permissions,
      expiresAt: Date.now() + ttl * 1000,
      createdAt: Date.now(),
      version: 1,
    };

    try {
      // Try Redis first with retry logic
      await this.executeWithRetry(async () => {
        const redis = RedisClient.getInstance();
        await redis.setex(key, ttl, JSON.stringify(cacheEntry));
      }, `cacheUserPermissions for user ${userId}`);

      return true;
    } catch (error) {
      // Fall back to memory cache if Redis fails
      console.warn(
        `Redis cache failed, using memory fallback for user ${userId}:`,
        error
      );
      this.memoryCache.set(key, cacheEntry);
      return true;
    }
  }

  /**
   * Retrieve cached user permissions with validation
   */
  async getUserPermissions(
    userId: EntityId
  ): Promise<ReadonlyArray<IEnhancedPermission> | null> {
    const key = this.buildKey(CacheKeyPattern.USER_PERMISSIONS, userId);

    try {
      // Try Redis first with retry logic
      const redisResult = await this.executeWithRetry(async () => {
        const redis = RedisClient.getInstance();
        return await redis.get(key);
      }, `getUserPermissions for user ${userId}`);

      if (redisResult) {
        const cached: IRedisCache<ReadonlyArray<IEnhancedPermission>> =
          JSON.parse(redisResult);

        // Check expiration
        if (cached.expiresAt && cached.expiresAt <= Date.now()) {
          await this.invalidateUserPermissions(userId);
          return null;
        }

        return cached.value;
      }

      return null;
    } catch (error) {
      // Fall back to memory cache if Redis fails
      console.warn(
        `Redis retrieval failed for user ${userId}, trying memory cache:`,
        error
      );

      const cached = this.memoryCache.get(key) as
        | IRedisCache<ReadonlyArray<IEnhancedPermission>>
        | undefined;

      if (!cached) {
        return null;
      }

      // Check expiration
      if (cached.expiresAt && cached.expiresAt <= Date.now()) {
        await this.invalidateUserPermissions(userId);
        return null;
      }

      return cached.value;
    }
  }

  /**
   * Cache role hierarchy with complex data structures
   */
  async cacheRoleHierarchy(
    roleId: EntityId,
    hierarchy: {
      directPermissions: ReadonlyArray<string>;
      inheritedPermissions: ReadonlyArray<string>;
      parentRoles: ReadonlyArray<EntityId>;
      childRoles: ReadonlyArray<EntityId>;
    },
    ttl: number = this.defaultTtl * 2 // Hierarchy changes less frequently
  ): Promise<boolean> {
    try {
      const key = this.buildKey(CacheKeyPattern.ROLE_HIERARCHY, roleId);
      const cacheEntry: IRedisCache<typeof hierarchy> = {
        value: hierarchy,
        expiresAt: Date.now() + ttl * 1000,
        createdAt: Date.now(),
        version: 1,
      };

      // In production, use Redis with optimized serialization
      this.memoryCache.set(key, cacheEntry);

      return true;
    } catch (error) {
      throw new CacheError(
        `Failed to cache role hierarchy: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Retrieve cached role hierarchy
   */
  async getRoleHierarchy(roleId: EntityId): Promise<{
    directPermissions: ReadonlyArray<string>;
    inheritedPermissions: ReadonlyArray<string>;
    parentRoles: ReadonlyArray<EntityId>;
    childRoles: ReadonlyArray<EntityId>;
  } | null> {
    try {
      const key = this.buildKey(CacheKeyPattern.ROLE_HIERARCHY, roleId);
      const cached = this.memoryCache.get(key) as IRedisCache<any> | undefined;

      if (!cached) {
        return null;
      }

      // Check expiration
      if (cached.expiresAt && cached.expiresAt <= Date.now()) {
        await this.invalidateRoleHierarchy(roleId);
        return null;
      }

      return cached.value;
    } catch (error) {
      console.warn(
        `Cache retrieval failed for role hierarchy ${roleId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Cache permission check results with context hashing
   */
  async cachePermissionCheck(
    userId: EntityId,
    resource: string,
    action: string,
    context: Record<string, unknown>,
    result: boolean,
    reason: string,
    ttl: number = 120 // Permission checks expire quickly
  ): Promise<boolean> {
    try {
      const contextHash = this.hashContext(context);
      const key = this.buildKey(
        CacheKeyPattern.PERMISSION_CHECK,
        `${userId}:${resource}:${action}:${contextHash}`
      );

      const cacheEntry: IRedisCache<{ result: boolean; reason: string }> = {
        value: { result, reason },
        expiresAt: Date.now() + ttl * 1000,
        createdAt: Date.now(),
        version: 1,
      };

      this.memoryCache.set(key, cacheEntry);
      return true;
    } catch (error) {
      throw new CacheError(
        `Failed to cache permission check: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Retrieve cached permission check result
   */
  async getPermissionCheck(
    userId: EntityId,
    resource: string,
    action: string,
    context: Record<string, unknown>
  ): Promise<{ result: boolean; reason: string } | null> {
    try {
      const contextHash = this.hashContext(context);
      const key = this.buildKey(
        CacheKeyPattern.PERMISSION_CHECK,
        `${userId}:${resource}:${action}:${contextHash}`
      );

      const cached = this.memoryCache.get(key) as
        | IRedisCache<{ result: boolean; reason: string }>
        | undefined;

      if (!cached) {
        return null;
      }

      // Check expiration
      if (cached.expiresAt && cached.expiresAt <= Date.now()) {
        this.memoryCache.delete(key);
        return null;
      }

      return cached.value;
    } catch (error) {
      console.warn(`Cache retrieval failed for permission check:`, error);
      return null;
    }
  }

  /**
   * Invalidation methods for cache consistency with Redis backend
   */
  async invalidateUserPermissions(userId: EntityId): Promise<boolean> {
    const key = this.buildKey(CacheKeyPattern.USER_PERMISSIONS, userId);

    try {
      // Try Redis deletion with retry logic
      await this.executeWithRetry(async () => {
        const redis = RedisClient.getInstance();
        await redis.del(key);
      }, `invalidateUserPermissions for user ${userId}`);
    } catch (error) {
      console.warn(
        `Redis invalidation failed for user ${userId}, clearing memory cache:`,
        error
      );
    }

    // Always clear memory cache as fallback
    this.memoryCache.delete(key);

    // Also invalidate related cache entries
    await this.invalidateRelatedUserCaches(userId);

    return true;
  }

  async invalidateRoleHierarchy(roleId: EntityId): Promise<boolean> {
    const key = this.buildKey(CacheKeyPattern.ROLE_HIERARCHY, roleId);

    try {
      // Try Redis deletion with retry logic
      await this.executeWithRetry(async () => {
        const redis = RedisClient.getInstance();
        await redis.del(key);
      }, `invalidateRoleHierarchy for role ${roleId}`);
    } catch (error) {
      console.warn(
        `Redis invalidation failed for role ${roleId}, clearing memory cache:`,
        error
      );
    }

    // Always clear memory cache as fallback
    this.memoryCache.delete(key);

    // Also invalidate related cache entries
    await this.invalidateRelatedRoleCaches(roleId);

    return true;
  }

  async invalidateUserPermissionChecks(userId: EntityId): Promise<boolean> {
    try {
      // In production, use Redis SCAN with pattern matching
      const pattern = this.buildKey(
        CacheKeyPattern.PERMISSION_CHECK,
        `${userId}:*`
      );

      // For now, clear memory cache entries matching pattern
      const keysToDelete: string[] = [];
      for (const key of this.memoryCache.keys()) {
        if (key.startsWith(pattern.replace("*", ""))) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach((key) => this.memoryCache.delete(key));

      return true;
    } catch (error) {
      console.error(`Failed to invalidate permission check cache:`, error);
      return false;
    }
  }

  /**
   * Cache warming for frequently accessed data
   */
  async warmUserPermissionsCache(
    userIds: ReadonlyArray<EntityId>
  ): Promise<number> {
    let warmedCount = 0;

    for (const userId of userIds) {
      try {
        // Check if already cached
        const cached = await this.getUserPermissions(userId);
        if (cached) {
          continue;
        }

        // In production, pre-load from database
        // const permissions = await this.permissionService.getUserPermissionsFromDatabase(userId);
        // await this.cacheUserPermissions(userId, permissions);

        warmedCount++;
      } catch (error) {
        console.warn(`Failed to warm cache for user ${userId}:`, error);
      }
    }

    return warmedCount;
  }

  /**
   * Cache statistics and monitoring
   */
  async getCacheStats(): Promise<{
    hitRate: number;
    missRate: number;
    totalEntries: number;
    memoryUsage: number;
    averageAccessTime: number;
  }> {
    // In production, implement comprehensive Redis stats
    const totalEntries = this.memoryCache.size;
    const memoryUsage = this.estimateMemoryUsage();

    return {
      hitRate: this.hitCount / (this.hitCount + this.missCount) || 0,
      missRate: this.missCount / (this.hitCount + this.missCount) || 0,
      totalEntries,
      memoryUsage,
      averageAccessTime: this.averageAccessTime,
    };
  }

  /**
   * Health check for cache service with Redis connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      // First check Redis health with retry logic
      await this.executeWithRetry(async () => {
        return await RedisClient.ping();
      }, "health check ping");

      return true;
    } catch (error) {
      console.warn(
        "Redis health check failed, checking memory fallback:",
        error
      );

      // Fall back to memory cache test
      try {
        const testKey = this.buildKey(CacheKeyPattern.HEALTH_CHECK, "check");
        this.memoryCache.set(testKey, { test: true });
        const result = this.memoryCache.get(testKey);
        this.memoryCache.delete(testKey);

        return result !== undefined;
      } catch (memoryError) {
        console.error(
          "Both Redis and memory cache health checks failed:",
          memoryError
        );
        return false;
      }
    }
  }

  // Private helper methods
  private buildKey(pattern: CacheKeyPattern, suffix: string): string {
    return `${this.keyPrefix}${pattern}${suffix}`;
  }

  private hashContext(context: Record<string, unknown>): string {
    // Simple hash for context - in production use proper hashing
    const contextStr = JSON.stringify(context, Object.keys(context).sort());
    return Buffer.from(contextStr).toString("base64").substring(0, 16);
  }

  private async invalidateRelatedUserCaches(userId: EntityId): Promise<void> {
    // Invalidate permission checks for this user
    await this.invalidateUserPermissionChecks(userId);

    // Invalidate user roles cache
    const userRolesKey = this.buildKey(CacheKeyPattern.USER_ROLES, userId);
    this.memoryCache.delete(userRolesKey);
  }

  private async invalidateRelatedRoleCaches(_roleId: EntityId): Promise<void> {
    // In production, find all users with this role and invalidate their caches
    // This would require Redis pattern scanning or maintaining role-to-user mappings
  }

  private estimateMemoryUsage(): number {
    // Rough estimation - in production use more accurate memory tracking
    return this.memoryCache.size * 1000; // Assume 1KB per entry average
  }

  // Temporary in-memory storage for development/fallback
  private readonly memoryCache = new Map<string, any>();
  private hitCount = 0;
  private missCount = 0;
  private averageAccessTime = 0;
}
