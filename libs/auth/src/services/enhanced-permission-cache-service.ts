/**
 * Enhanced Permission Caching Service
 * Provides Redis-based caching for frequently accessed permissions
 * Implements cache invalidation, TTL management, and performance monitoring
 */

import { ServiceDependencies } from "../types";

// ===================================================================
// CACHE TYPES
// ===================================================================

export interface PermissionCacheEntry {
  permissions: string[];
  roles: string[];
  timestamp: number;
  ttl: number;
  hitCount: number;
  lastAccessed: number;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  averageAccessTime: number;
  memoryUsage: number;
}

export interface CacheConfig {
  defaultTtl: number;
  maxEntries: number;
  cleanupInterval: number;
  enableStats: boolean;
}

// ===================================================================
// ENHANCED PERMISSION CACHING SERVICE
// ===================================================================

export class EnhancedPermissionCacheService {
  private cacheConfig: CacheConfig;
  private stats: CacheStats;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private deps: ServiceDependencies,
    config?: Partial<CacheConfig>
  ) {
    this.cacheConfig = {
      defaultTtl: 3600, // 1 hour
      maxEntries: 10000,
      cleanupInterval: 300000, // 5 minutes
      enableStats: true,
      ...config,
    };

    this.stats = {
      totalEntries: 0,
      totalHits: 0,
      totalMisses: 0,
      hitRate: 0,
      averageAccessTime: 0,
      memoryUsage: 0,
    };

    this.startCleanupTimer();
  }

  /**
   * Get cached permissions for user
   */
  async getUserPermissions(userId: string): Promise<string[] | null> {
    const startTime = Date.now();

    try {
      const cacheKey = `perm:user:${userId}`;
      const cached = await this.deps.redis.get(cacheKey);

      if (cached) {
        const entry: PermissionCacheEntry = JSON.parse(cached);

        // Check if entry is expired
        if (Date.now() - entry.timestamp > entry.ttl * 1000) {
          await this.deps.redis.del(cacheKey);
          this.updateStats(false, Date.now() - startTime);
          return null;
        }

        // Update access statistics
        entry.hitCount++;
        entry.lastAccessed = Date.now();
        await this.deps.redis.setex(cacheKey, entry.ttl, JSON.stringify(entry));

        this.updateStats(true, Date.now() - startTime);
        return entry.permissions;
      }

      this.updateStats(false, Date.now() - startTime);
      return null;
    } catch (error) {
      this.deps.monitoring.logger.warn("Failed to get cached permissions", {
        userId,
        error,
      });
      this.updateStats(false, Date.now() - startTime);
      return null;
    }
  }

  /**
   * Cache user permissions
   */
  async setUserPermissions(
    userId: string,
    permissions: string[],
    roles: string[] = [],
    ttl?: number
  ): Promise<void> {
    try {
      const cacheKey = `perm:user:${userId}`;
      const entry: PermissionCacheEntry = {
        permissions,
        roles,
        timestamp: Date.now(),
        ttl: ttl || this.cacheConfig.defaultTtl,
        hitCount: 0,
        lastAccessed: Date.now(),
      };

      await this.deps.redis.setex(cacheKey, entry.ttl, JSON.stringify(entry));

      // Update stats
      this.stats.totalEntries++;
      this.updateMemoryUsage();

      this.deps.monitoring.logger.debug("Cached user permissions", {
        userId,
        permissionCount: permissions.length,
        roleCount: roles.length,
      });
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to cache user permissions", {
        userId,
        error,
      });
    }
  }

  /**
   * Get cached roles for user
   */
  async getUserRoles(userId: string): Promise<string[] | null> {
    const startTime = Date.now();

    try {
      const cacheKey = `roles:user:${userId}`;
      const cached = await this.deps.redis.get(cacheKey);

      if (cached) {
        const entry: PermissionCacheEntry = JSON.parse(cached);

        // Check if entry is expired
        if (Date.now() - entry.timestamp > entry.ttl * 1000) {
          await this.deps.redis.del(cacheKey);
          this.updateStats(false, Date.now() - startTime);
          return null;
        }

        // Update access statistics
        entry.hitCount++;
        entry.lastAccessed = Date.now();
        await this.deps.redis.setex(cacheKey, entry.ttl, JSON.stringify(entry));

        this.updateStats(true, Date.now() - startTime);
        return entry.roles;
      }

      this.updateStats(false, Date.now() - startTime);
      return null;
    } catch (error) {
      this.deps.monitoring.logger.warn("Failed to get cached roles", {
        userId,
        error,
      });
      this.updateStats(false, Date.now() - startTime);
      return null;
    }
  }

  /**
   * Cache user roles
   */
  async setUserRoles(
    userId: string,
    roles: string[],
    ttl?: number
  ): Promise<void> {
    try {
      const cacheKey = `roles:user:${userId}`;
      const entry: PermissionCacheEntry = {
        permissions: [],
        roles,
        timestamp: Date.now(),
        ttl: ttl || this.cacheConfig.defaultTtl,
        hitCount: 0,
        lastAccessed: Date.now(),
      };

      await this.deps.redis.setex(cacheKey, entry.ttl, JSON.stringify(entry));

      // Update stats
      this.stats.totalEntries++;
      this.updateMemoryUsage();

      this.deps.monitoring.logger.debug("Cached user roles", {
        userId,
        roleCount: roles.length,
      });
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to cache user roles", {
        userId,
        error,
      });
    }
  }

  /**
   * Invalidate user permission cache
   */
  async invalidateUserPermissions(userId: string): Promise<void> {
    try {
      const cacheKey = `perm:user:${userId}`;
      await this.deps.redis.del(cacheKey);

      this.stats.totalEntries = Math.max(0, this.stats.totalEntries - 1);
      this.updateMemoryUsage();

      this.deps.monitoring.logger.debug("Invalidated user permission cache", {
        userId,
      });
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Failed to invalidate user permissions",
        {
          userId,
          error,
        }
      );
    }
  }

  /**
   * Invalidate user role cache
   */
  async invalidateUserRoles(userId: string): Promise<void> {
    try {
      const cacheKey = `roles:user:${userId}`;
      await this.deps.redis.del(cacheKey);

      this.stats.totalEntries = Math.max(0, this.stats.totalEntries - 1);
      this.updateMemoryUsage();

      this.deps.monitoring.logger.debug("Invalidated user role cache", {
        userId,
      });
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to invalidate user roles", {
        userId,
        error,
      });
    }
  }

  /**
   * Invalidate all caches for user
   */
  async invalidateUserCache(userId: string): Promise<void> {
    await Promise.all([
      this.invalidateUserPermissions(userId),
      this.invalidateUserRoles(userId),
    ]);
  }

  /**
   * Invalidate permission cache by role
   */
  async invalidateRolePermissions(roleName: string): Promise<void> {
    try {
      // Find all users with this role and invalidate their caches
      const pattern = `perm:user:*`;
      const keys = await this.deps.redis.keys(pattern);

      for (const key of keys) {
        const cached = await this.deps.redis.get(key);
        if (cached) {
          const entry: PermissionCacheEntry = JSON.parse(cached);
          if (entry.roles.includes(roleName)) {
            await this.deps.redis.del(key);
            this.stats.totalEntries = Math.max(0, this.stats.totalEntries - 1);
          }
        }
      }

      this.updateMemoryUsage();

      this.deps.monitoring.logger.debug("Invalidated role permissions", {
        roleName,
      });
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Failed to invalidate role permissions",
        {
          roleName,
          error,
        }
      );
    }
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    try {
      const patterns = ["perm:user:*", "roles:user:*"];
      for (const pattern of patterns) {
        const keys = await this.deps.redis.keys(pattern);
        if (keys.length > 0) {
          await this.deps.redis.del(...keys);
        }
      }

      this.stats.totalEntries = 0;
      this.updateMemoryUsage();

      this.deps.monitoring.logger.info("Cleared all permission caches");
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to clear all caches", {
        error,
      });
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    this.updateHitRate();
    return { ...this.stats };
  }

  /**
   * Get cache configuration
   */
  getConfig(): CacheConfig {
    return { ...this.cacheConfig };
  }

  /**
   * Update cache configuration
   */
  updateConfig(config: Partial<CacheConfig>): void {
    this.cacheConfig = { ...this.cacheConfig, ...config };

    if (config.cleanupInterval) {
      this.restartCleanupTimer();
    }
  }

  /**
   * Warm up cache with frequently accessed data
   */
  async warmupCache(userIds: string[]): Promise<void> {
    this.deps.monitoring.logger.info("Starting cache warmup", {
      userCount: userIds.length,
    });

    for (const userId of userIds) {
      try {
        // This would typically call the permission service to get fresh data
        // For now, we'll just log the warmup attempt
        this.deps.monitoring.logger.debug("Warming up cache for user", {
          userId,
        });
      } catch (error) {
        this.deps.monitoring.logger.warn("Failed to warmup cache for user", {
          userId,
          error,
        });
      }
    }
  }

  /**
   * Cleanup expired entries
   */
  private async cleanup(): Promise<void> {
    try {
      const patterns = ["perm:user:*", "roles:user:*"];
      let cleanedCount = 0;

      for (const pattern of patterns) {
        const keys = await this.deps.redis.keys(pattern);

        for (const key of keys) {
          const cached = await this.deps.redis.get(key);
          if (cached) {
            const entry: PermissionCacheEntry = JSON.parse(cached);

            // Check if entry is expired
            if (Date.now() - entry.timestamp > entry.ttl * 1000) {
              await this.deps.redis.del(key);
              cleanedCount++;
              this.stats.totalEntries = Math.max(
                0,
                this.stats.totalEntries - 1
              );
            }
          }
        }
      }

      if (cleanedCount > 0) {
        this.updateMemoryUsage();
        this.deps.monitoring.logger.debug("Cleaned up expired cache entries", {
          cleanedCount,
        });
      }
    } catch (error) {
      this.deps.monitoring.logger.error("Cache cleanup failed", { error });
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(
      () => this.cleanup(),
      this.cacheConfig.cleanupInterval
    );
  }

  /**
   * Restart cleanup timer with new interval
   */
  private restartCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.startCleanupTimer();
  }

  /**
   * Update cache statistics
   */
  private updateStats(isHit: boolean, accessTime: number): void {
    if (!this.cacheConfig.enableStats) return;

    if (isHit) {
      this.stats.totalHits++;
    } else {
      this.stats.totalMisses++;
    }

    // Update average access time
    const totalRequests = this.stats.totalHits + this.stats.totalMisses;
    if (totalRequests > 0) {
      this.stats.averageAccessTime =
        (this.stats.averageAccessTime * (totalRequests - 1) + accessTime) /
        totalRequests;
    }
  }

  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.totalHits + this.stats.totalMisses;
    this.stats.hitRate = total > 0 ? this.stats.totalHits / total : 0;
  }

  /**
   * Update memory usage estimate
   */
  private updateMemoryUsage(): void {
    // Rough estimate: 1KB per entry
    this.stats.memoryUsage = this.stats.totalEntries * 1024;
  }

  /**
   * Cleanup on destruction
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create enhanced permission cache service instance
 */
export function createEnhancedPermissionCacheService(
  deps: ServiceDependencies,
  config?: Partial<CacheConfig>
): EnhancedPermissionCacheService {
  return new EnhancedPermissionCacheService(deps, config);
}

/**
 * Quick cache status check
 */
export function getCacheStatus(cache: EnhancedPermissionCacheService): {
  isHealthy: boolean;
  stats: CacheStats;
  config: CacheConfig;
} {
  const stats = cache.getStats();
  const config = cache.getConfig();

  // Consider cache healthy if hit rate is reasonable and no excessive memory usage
  const isHealthy =
    stats.hitRate > 0.1 && stats.memoryUsage < 100 * 1024 * 1024; // 100MB limit

  return { isHealthy, stats, config };
}

export default EnhancedPermissionCacheService;
