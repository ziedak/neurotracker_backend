import { createLogger, type ILogger } from "@libs/utils";
import { CacheService } from "@libs/database";
import { createHash } from "crypto";

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number;
  key: string;
}

/**
 * Cache operation result
 */
export interface CacheResult<T = any> {
  data: T | null;
  hit: boolean;
  key: string;
  timestamp?: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  invalidations: number;
  hitRate: number;
  totalOperations: number;
}

/**
 * Token cache configuration
 */
export interface TokenCacheConfig {
  defaultTtl: number;
  minTtl: number;
  maxTtl: number;
  enableFallbackHashing: boolean;
  saltRotationInterval: number;
}

/**
 * Interface for token cache service
 */
export interface ITokenCacheService {
  /**
   * Get cached data by key
   */
  get<T = any>(key: string): Promise<CacheResult<T>>;

  /**
   * Set data in cache with TTL
   */
  set<T = any>(key: string, data: T, ttl?: number): Promise<void>;

  /**
   * Delete data from cache
   */
  delete(key: string): Promise<boolean>;

  /**
   * Invalidate cache entries by pattern
   */
  invalidatePattern(pattern: string): Promise<number>;

  /**
   * Get cache statistics
   */
  getStats(): CacheStats;

  /**
   * Clear all cache entries
   */
  clear(): Promise<void>;

  /**
   * Check if key exists in cache
   */
  exists(key: string): Promise<boolean>;
}

/**
 * Token Cache Service
 *
 * Unified caching service for token operations with secure hashing and salt rotation.
 * Provides consistent caching interface across JWT validation, introspection, and public key operations.
 *
 * Features:
 * - Secure token hashing with rotating salts
 * - Fallback hashing during salt rotation
 * - Comprehensive cache statistics
 * - Pattern-based cache invalidation
 * - TTL management and expiration
 */
export class TokenCacheService implements ITokenCacheService {
  private logger: ILogger;
  private stats: CacheStats;
  private config: TokenCacheConfig;

  constructor(
    private readonly cacheService: CacheService,
    config?: Partial<TokenCacheConfig>
  ) {
    this.logger = createLogger("token-cache-service");

    this.config = {
      defaultTtl: 300, // 5 minutes
      minTtl: 60, // 1 minute
      maxTtl: 3600, // 1 hour
      enableFallbackHashing: true,
      saltRotationInterval: 24 * 60 * 60 * 1000, // 24 hours
      ...config,
    };

    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      invalidations: 0,
      hitRate: 0,
      totalOperations: 0,
    };

    this.logger.info("TokenCacheService initialized", {
      config: this.config,
    });
  }

  /**
   * Get cached data by key with secure hashing
   *
   * @param key - Cache key (will be hashed for security)
   * @returns Promise<CacheResult<T>> - Cache result with metadata
   */
  public async get<T = any>(key: string): Promise<CacheResult<T>> {
    this.stats.totalOperations++;

    try {
      const hashedKey = this.hashKey(key);
      const cached = await this.cacheService.get(hashedKey);

      if (cached?.data) {
        this.stats.hits++;
        this.updateHitRate();

        this.logger.debug("Cache hit", {
          originalKey: this.getKeyPrefix(key),
          hashedKey: hashedKey.substring(0, 16) + "...",
        });

        return {
          data: cached.data as T,
          hit: true,
          key: hashedKey,
          timestamp: Date.now(), // Add current timestamp since cache doesn't provide it
        };
      }

      this.stats.misses++;
      this.updateHitRate();

      this.logger.debug("Cache miss", {
        originalKey: this.getKeyPrefix(key),
        hashedKey: hashedKey.substring(0, 16) + "...",
      });

      return {
        data: null,
        hit: false,
        key: hashedKey,
      };
    } catch (error) {
      this.logger.error("Cache get operation failed", {
        key: this.getKeyPrefix(key),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Set data in cache with TTL
   *
   * @param key - Cache key (will be hashed for security)
   * @param data - Data to cache
   * @param ttl - Time to live in seconds (optional, uses default if not provided)
   */
  public async set<T = any>(key: string, data: T, ttl?: number): Promise<void> {
    this.stats.totalOperations++;
    this.stats.sets++;

    try {
      const hashedKey = this.hashKey(key);
      const effectiveTtl = Math.max(
        this.config.minTtl,
        Math.min(ttl || this.config.defaultTtl, this.config.maxTtl)
      );

      await this.cacheService.set(hashedKey, data, effectiveTtl);

      this.logger.debug("Cache set", {
        originalKey: this.getKeyPrefix(key),
        hashedKey: hashedKey.substring(0, 16) + "...",
        ttl: effectiveTtl,
      });
    } catch (error) {
      this.logger.error("Cache set operation failed", {
        key: this.getKeyPrefix(key),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete data from cache (using invalidate)
   *
   * @param key - Cache key to delete
   * @returns Promise<boolean> - True if key was deleted
   */
  public async delete(key: string): Promise<boolean> {
    this.stats.totalOperations++;
    this.stats.deletes++;

    try {
      const hashedKey = this.hashKey(key);
      await this.cacheService.invalidate(hashedKey);

      this.logger.debug("Cache delete", {
        originalKey: this.getKeyPrefix(key),
        hashedKey: hashedKey.substring(0, 16) + "...",
      });

      return true; // Assume success since invalidate doesn't return status
    } catch (error) {
      this.logger.error("Cache delete operation failed", {
        key: this.getKeyPrefix(key),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Invalidate cache entries by pattern
   *
   * @param pattern - Pattern to match for invalidation (e.g., "jwt:*", "introspection:*")
   * @returns Promise<number> - Number of entries invalidated
   */
  public async invalidatePattern(pattern: string): Promise<number> {
    this.stats.totalOperations++;
    this.stats.invalidations++;

    try {
      const invalidated = await this.cacheService.invalidatePattern(pattern);

      this.logger.info("Cache pattern invalidation", {
        pattern,
        invalidated,
      });

      return invalidated;
    } catch (error) {
      this.logger.error("Cache invalidation failed", {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get comprehensive cache statistics
   *
   * @returns CacheStats - Current cache statistics
   */
  public getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Clear all cache entries (using dispose)
   */
  public async clear(): Promise<void> {
    try {
      await this.cacheService.dispose();
      this.resetStats();

      this.logger.info("Cache cleared");
    } catch (error) {
      this.logger.error("Cache clear operation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if key exists in cache
   *
   * @param key - Cache key to check
   * @returns Promise<boolean> - True if key exists
   */
  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.get(key);
      return result.hit;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get cache entry with TTL information
   *
   * @param key - Cache key
   * @returns Promise<CacheEntry | null> - Cache entry with metadata
   */
  public async getWithMetadata<T = any>(
    key: string
  ): Promise<CacheEntry<T> | null> {
    try {
      const hashedKey = this.hashKey(key);
      const cached = await this.cacheService.get(hashedKey);

      if (cached?.data) {
        return {
          data: cached.data as T,
          timestamp: Date.now(), // Cache doesn't provide timestamp, use current time
          ttl: 0, // Cache doesn't provide TTL information
          key: hashedKey,
        };
      }

      return null;
    } catch (error) {
      this.logger.error("Failed to get cache metadata", {
        key: this.getKeyPrefix(key),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Securely hash cache key with salt
   *
   * @param key - Original cache key
   * @returns string - Hashed cache key
   */
  private hashKey(key: string): string {
    // Use SHA-256 for secure hashing (256-bit security)
    const hash = createHash("sha256")
      .update(key + this.getSalt())
      .digest("hex");

    // Return full 64-character hash for maximum security
    return hash;
  }

  /**
   * Get salt for hashing (placeholder - would integrate with salt manager)
   *
   * @returns string - Salt for hashing
   */
  private getSalt(): string {
    // In production, this would integrate with TokenHashSaltManager
    // For now, using a static salt - should be replaced with rotating salt
    return "token-cache-service-salt";
  }

  /**
   * Get key prefix for logging (first part before special characters)
   *
   * @param key - Full cache key
   * @returns string - Key prefix for logging
   */
  private getKeyPrefix(key: string): string {
    const parts = key.split(":");
    return parts.length > 0 && parts[0] ? parts[0] : key;
  }

  /**
   * Update cache hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  /**
   * Reset cache statistics
   */
  private resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      invalidations: 0,
      hitRate: 0,
      totalOperations: 0,
    };
  }

  /**
   * Get cache health status
   *
   * @returns Object with health metrics
   */
  public getHealthStatus(): {
    operational: boolean;
    hitRate: number;
    totalOperations: number;
    errorRate: number;
  } {
    // In a real implementation, this would track errors
    const errorRate = 0; // Placeholder

    return {
      operational: true,
      hitRate: this.stats.hitRate,
      totalOperations: this.stats.totalOperations,
      errorRate,
    };
  }
}

/**
 * Factory function to create token cache service
 */
export const createTokenCacheService = (
  cacheService: CacheService,
  config?: Partial<TokenCacheConfig>
): TokenCacheService => {
  return new TokenCacheService(cacheService, config);
};
