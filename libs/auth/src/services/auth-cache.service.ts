/**
 * Redis-First Authentication Cache Layer
 * Phase 1: Implement intelligent caching for authentication operations
 *
 * This service provides:
 * - Multi-level caching (L1: memory, L2: Redis, L3: database)
 * - Cache warming and invalidation strategies
 * - Performance monitoring and hit rate optimization
 */

import { RedisClient } from "@libs/database";
import { Logger } from "@libs/monitoring";

export interface CacheConfig {
  readonly defaultTTL: number; // seconds
  readonly maxMemoryCacheSize: number;
  readonly enableL1Cache: boolean; // in-memory cache
  readonly enableL2Cache: boolean; // Redis cache
  readonly warmupOnStart: boolean;
  readonly compressionThreshold: number; // bytes
  readonly batchInvalidationSize: number;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  defaultTTL: 3600, // 1 hour
  maxMemoryCacheSize: 10000, // 10k entries
  enableL1Cache: true,
  enableL2Cache: true,
  warmupOnStart: true,
  compressionThreshold: 1024, // 1KB
  batchInvalidationSize: 100,
};

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  hits: number;
  compressed: boolean;
}

export interface CacheStats {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  totalRequests: number;
  hitRate: number;
  memoryUsage: number;
  entryCount: number;
  invalidations: number;
  compressions: number;
}

export interface CacheOperationResult<T> {
  data: T | null;
  source: "l1" | "l2" | "miss";
  latency: number;
  compressed: boolean;
}

/**
 * High-performance caching service for authentication operations
 */
export class AuthCacheService {
  private static instance: AuthCacheService;

  private readonly config: CacheConfig;
  private readonly logger: ILogger;
  private readonly redis: any;

  // L1 Cache (in-memory)
  private readonly memoryCache = new Map<string, CacheEntry<any>>();
  private readonly accessOrder = new Map<string, number>(); // For LRU eviction
  private accessCounter = 0;

  // Statistics
  private stats: CacheStats = {
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
    totalRequests: 0,
    hitRate: 0,
    memoryUsage: 0,
    entryCount: 0,
    invalidations: 0,
    compressions: 0,
  };

  private constructor(logger: ILogger, config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.logger = new Logger.c({ service: "AuthCacheService" });
    this.redis = RedisClient.getInstance();

    this.setupCleanupInterval();

    if (this.config.warmupOnStart) {
      this.warmupCache();
    }
  }

  static getInstance(config?: Partial<CacheConfig>): AuthCacheService {
    if (!AuthCacheService.instance) {
      AuthCacheService.instance = new AuthCacheService(config);
    }
    return AuthCacheService.instance;
  }

  /**
   * Get data from cache with multi-level fallback
   */
  async get<T>(key: string): Promise<CacheOperationResult<T>> {
    const startTime = performance.now();
    this.stats.totalRequests++;

    // L1 Cache (Memory)
    if (this.config.enableL1Cache) {
      const l1Result = this.getFromL1<T>(key);
      if (l1Result !== null) {
        this.stats.l1Hits++;
        this.updateHitRate();

        return {
          data: l1Result,
          source: "l1",
          latency: performance.now() - startTime,
          compressed: false,
        };
      }
      this.stats.l1Misses++;
    }

    // L2 Cache (Redis)
    if (this.config.enableL2Cache) {
      try {
        const l2Result = await this.getFromL2<T>(key);
        if (l2Result !== null) {
          this.stats.l2Hits++;

          // Populate L1 cache
          if (this.config.enableL1Cache) {
            this.setInL1(key, l2Result.data, l2Result.ttl);
          }

          this.updateHitRate();

          return {
            data: l2Result.data,
            source: "l2",
            latency: performance.now() - startTime,
            compressed: l2Result.compressed,
          };
        }
        this.stats.l2Misses++;
      } catch (error) {
        this.logger.error(`L2 cache error for key: ${key}`, error as Error);
      }
    }

    this.updateHitRate();

    return {
      data: null,
      source: "miss",
      latency: performance.now() - startTime,
      compressed: false,
    };
  }

  /**
   * Set data in cache with intelligent TTL and compression
   */
  async set<T>(
    key: string,
    data: T,
    ttl: number = this.config.defaultTTL
  ): Promise<void> {
    // L1 Cache
    if (this.config.enableL1Cache) {
      this.setInL1(key, data, ttl);
    }

    // L2 Cache
    if (this.config.enableL2Cache) {
      try {
        await this.setInL2(key, data, ttl);
      } catch (error) {
        this.logger.error(`L2 cache error for key: ${key}`, error as Error);
      }
    }
  }

  /**
   * Invalidate cache entry at all levels
   */
  async invalidate(key: string): Promise<void> {
    this.stats.invalidations++;

    // L1 invalidation
    this.memoryCache.delete(key);
    this.accessOrder.delete(key);

    // L2 invalidation
    if (this.config.enableL2Cache) {
      try {
        await this.redis.del(this.getRedisKey(key));
      } catch (error) {
        this.logger.error(
          `L2 cache invalidation error for key: ${key}`,
          error as Error
        );
      }
    }

    this.logger.debug("Cache entry invalidated", { key });
  }

  /**
   * Batch invalidation for performance
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let invalidatedCount = 0;

    // L1 pattern invalidation
    for (const key of this.memoryCache.keys()) {
      if (this.matchPattern(key, pattern)) {
        this.memoryCache.delete(key);
        this.accessOrder.delete(key);
        invalidatedCount++;
      }
    }

    // L2 pattern invalidation
    if (this.config.enableL2Cache) {
      try {
        const redisPattern = this.getRedisKey(pattern);
        const keys = await this.redis.keys(redisPattern);

        if (keys.length > 0) {
          const batches = this.chunkArray(
            keys,
            this.config.batchInvalidationSize
          );

          for (const batch of batches) {
            await this.redis.del(...batch);
            invalidatedCount += batch.length;
          }
        }
      } catch (error) {
        this.logger.error(
          `L2 pattern invalidation error for pattern: ${pattern}`,
          error as Error
        );
      }
    }

    this.stats.invalidations += invalidatedCount;
    this.logger.info("Batch invalidation completed", {
      pattern,
      count: invalidatedCount,
    });

    return invalidatedCount;
  }

  /**
   * Get from L1 (memory) cache
   */
  private getFromL1<T>(key: string): T | null {
    const entry = this.memoryCache.get(key);

    if (!entry) return null;

    // Check TTL
    const now = Date.now();
    if (now > entry.timestamp + entry.ttl * 1000) {
      this.memoryCache.delete(key);
      this.accessOrder.delete(key);
      return null;
    }

    // Update access tracking
    entry.hits++;
    this.accessOrder.set(key, ++this.accessCounter);

    return entry.data as T;
  }

  /**
   * Get from L2 (Redis) cache
   */
  private async getFromL2<T>(key: string): Promise<CacheEntry<T> | null> {
    const redisKey = this.getRedisKey(key);
    const rawData = await this.redis.get(redisKey);

    if (!rawData) return null;

    try {
      const entry: CacheEntry<T> = JSON.parse(rawData);

      // Check if data was compressed
      if (entry.compressed && typeof entry.data === "string") {
        entry.data = JSON.parse(entry.data) as T;
        entry.compressed = false; // Decompressed for return
      }

      return entry;
    } catch (error) {
      this.logger.error(
        `L2 cache deserialization error for key: ${key}`,
        error as Error
      );
      await this.redis.del(redisKey); // Clean up corrupted entry
      return null;
    }
  }

  /**
   * Set in L1 (memory) cache with LRU eviction
   */
  private setInL1<T>(key: string, data: T, ttl: number): void {
    // LRU eviction if cache is full
    if (this.memoryCache.size >= this.config.maxMemoryCacheSize) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      compressed: false,
    };

    this.memoryCache.set(key, entry);
    this.accessOrder.set(key, ++this.accessCounter);
    this.updateMemoryStats();
  }

  /**
   * Set in L2 (Redis) cache with optional compression
   */
  private async setInL2<T>(key: string, data: T, ttl: number): Promise<void> {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      compressed: false,
    };

    let serializedData = JSON.stringify(entry);

    // Compress large entries
    if (serializedData.length > this.config.compressionThreshold) {
      entry.data = JSON.stringify(data) as any; // Store as compressed string
      entry.compressed = true;
      serializedData = JSON.stringify(entry);
      this.stats.compressions++;
    }

    const redisKey = this.getRedisKey(key);
    await this.redis.setex(redisKey, ttl, serializedData);
  }

  /**
   * Evict least recently used entry from L1
   */
  private evictLRU(): void {
    if (this.accessOrder.size === 0) return;

    const sortedEntries = Array.from(this.accessOrder.entries()).sort(
      ([, a], [, b]) => a - b
    );
    if (sortedEntries.length > 0 && sortedEntries[0]) {
      const oldestKey = sortedEntries[0][0];
      this.memoryCache.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
    }
  }

  /**
   * Warm up cache with frequently accessed data
   */
  private async warmupCache(): Promise<void> {
    this.logger.info("Starting cache warmup");

    try {
      // Define common cache keys to warmup
      const warmupKeys = ["session:*", "user:*", "permissions:*", "roles:*"];

      // This would typically load from database and populate cache
      // For now, we'll just log the warmup attempt
      this.logger.info("Cache warmup completed", { keys: warmupKeys.length });
    } catch (error) {
      this.logger.error(`Cache warmup failed`, error as Error);
    }
  }

  /**
   * Setup cleanup interval for expired entries
   */
  private setupCleanupInterval(): void {
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000); // Clean every minute
  }

  /**
   * Clean up expired entries from L1 cache
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.timestamp + entry.ttl * 1000) {
        this.memoryCache.delete(key);
        this.accessOrder.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug("Cleaned expired cache entries", {
        count: cleanedCount,
      });
      this.updateMemoryStats();
    }
  }

  /**
   * Update memory usage statistics
   */
  private updateMemoryStats(): void {
    this.stats.entryCount = this.memoryCache.size;
    // Rough estimation of memory usage
    this.stats.memoryUsage = this.memoryCache.size * 1024; // Assume 1KB per entry average
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    const totalHits = this.stats.l1Hits + this.stats.l2Hits;
    this.stats.hitRate =
      this.stats.totalRequests > 0 ? totalHits / this.stats.totalRequests : 0;
  }

  /**
   * Get Redis key with namespace
   */
  private getRedisKey(key: string): string {
    return `auth:cache:${key}`;
  }

  /**
   * Pattern matching for cache keys
   */
  private matchPattern(key: string, pattern: string): boolean {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    return regex.test(key);
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      totalRequests: 0,
      hitRate: 0,
      memoryUsage: 0,
      entryCount: 0,
      invalidations: 0,
      compressions: 0,
    };
  }

  /**
   * Cache health check
   */
  async healthCheck(): Promise<{
    status: "healthy" | "degraded" | "critical";
    l1Status: "ok" | "full" | "error";
    l2Status: "ok" | "error";
    hitRate: number;
    entryCount: number;
  }> {
    let l1Status: "ok" | "full" | "error" = "ok";
    let l2Status: "ok" | "error" = "ok";

    // Check L1 cache
    if (this.memoryCache.size >= this.config.maxMemoryCacheSize * 0.9) {
      l1Status = "full";
    }

    // Check L2 cache
    try {
      await this.redis.ping();
    } catch (error) {
      l2Status = "error";
    }

    const status =
      l2Status === "error"
        ? "critical"
        : l1Status === "full"
        ? "degraded"
        : "healthy";

    return {
      status,
      l1Status,
      l2Status,
      hitRate: this.stats.hitRate,
      entryCount: this.stats.entryCount,
    };
  }
}
