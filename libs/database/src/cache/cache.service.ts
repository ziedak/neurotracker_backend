/**
 * Redis-First Authentication Cache Layer
 * Phase 1: Implement intelligent caching for authentication operations
 *
 * This service provides:
 * - Multi-level caching (L1: memory, L2: Redis, L3: database)
 * - Cache warming strategies
 * - Intelligent invalidation strategies
 * - Performance monitoring and hit rate optimization
 * - Memory management and compression support
 */

import { createLogger } from "@libs/utils";
import type {
  ICache,
  CacheConfig,
  CacheOperationResult,
  CacheStats,
  CacheHealth,
  CacheWarmingResult,
  WarmupDataProvider,
} from "./interfaces/ICache";
import { CacheWarmingManager } from "./warming/CacheWarmingManager";
import { AuthDataProvider } from "./warming/AuthDataProvider";
import { RedisClient } from "../redis/redisClient";
import { MemoryCache } from "./strategies/MemoryCache";
import { RedisCache } from "./strategies/RedisCache";
import type { IMetricsCollector } from "@libs/monitoring";

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enable: true,
  defaultTtl: 300, // 5 minutes
  minTtl: 60, // 1 minute
  maxTtl: 3600, // 1 hour
  warmupOnStart: false,
  warmingConfig: {
    enableBackgroundWarming: false,
    backgroundWarmingInterval: 300,
    adaptiveWarming: true,
    maxWarmupKeys: 100,
    warmupBatchSize: 10,
    enablePatternLearning: true,
  },
};

/**
 * High-performance caching service
 */
export class CacheService implements ICache {
  private readonly config: CacheConfig;
  private readonly caches: ICache[];
  private readonly warmingManager: CacheWarmingManager;
  private readonly dataProvider: WarmupDataProvider;
  private readonly stats: CacheStats = {
    Hits: 0,
    Misses: 0,
    totalRequests: 0,
    hitRate: 0,
    memoryUsage: 0,
    entryCount: 0,
    invalidations: 0,
    compressions: 0,
  };
  protected readonly logger = createLogger("CacheService");
  constructor(
    metrics?: IMetricsCollector,
    caches?: ICache[],
    config: Partial<CacheConfig> = {}
  ) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.caches = caches ?? [
      new MemoryCache(),
      // Only create RedisCache if we have metrics (to avoid circular dependency)
      ...(metrics ? [new RedisCache(RedisClient.create({}, metrics))] : []),
    ];

    // Initialize warming components
    this.dataProvider = new AuthDataProvider();
    this.warmingManager = new CacheWarmingManager(this.config.warmingConfig);

    if (this.config.warmupOnStart) {
      this.warmupCache().catch((error) => {
        this.logger.error("Cache warmup failed during initialization", error);
      });
    }

    // Start background warming if enabled
    if (this.config.warmingConfig?.enableBackgroundWarming) {
      this.startBackgroundWarming();
    }
  }

  static create(
    metrics?: IMetricsCollector,
    caches?: ICache[],
    config: Partial<CacheConfig> = {}
  ): CacheService {
    return new CacheService(metrics, caches, config);
  }

  protected isValidKey(key: string): boolean {
    if (!key || typeof key !== "string") {
      this.logger.warn("Invalid cache key provided to invalidate", { key });
      return false;
    }

    if (key.length > 512) {
      this.logger.warn("Cache key too long for invalidation", {
        keyLength: key.length,
      });
      return false;
    }
    return true;
  }
  /**
   * Get data from cache with multi-level fallback and input validation
   */
  async get<T>(key: string): Promise<CacheOperationResult<T>> {
    const startTime = performance.now();
    this.stats.totalRequests++;

    // Input validation
    if (!this.isValidKey(key)) {
      this.logger.warn("Invalid cache key provided to get", { key });
      return {
        data: null,
        source: "miss",
        latency: performance.now() - startTime,
        compressed: false,
      };
    }

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        const result = await cache.get<T>(key);
        if (result?.data !== null) {
          this.updateHitRate();

          // Record access pattern for adaptive learning
          if (this.config.warmingConfig?.enablePatternLearning) {
            this.warmingManager.recordAccess(key, result.latency);
          }
          // TODO add logic to promote frequently accessed keys to higher cache levels
          return {
            data: result.data,
            source: `l${idx + 1}`,
            latency: performance.now() - startTime,
            compressed: result.compressed,
          };
        }
      } catch (error) {
        this.logger.error(`Cache get failed for level ${idx + 1}`, {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue to next cache level on error
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
   * Check if key exists in cache
   */
  public async exists(key: string): Promise<boolean> {
    try {
      if (!this.isValidKey(key)) {
        this.logger.warn("Invalid cache key provided to exists", { key });
        return false;
      }
      const result = await this.get(key);
      return result.data !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Set data in cache with intelligent TTL and compression
   */
  async set<T>(
    key: string,
    data: T,
    ttl: number = this.config.defaultTtl
  ): Promise<void> {
    // Input validation
    if (!this.isValidKey(key)) {
      return;
    }

    // Enforce TTL boundaries
    const effectiveTtl = Math.max(
      this.config.minTtl,
      Math.min(ttl || this.config.defaultTtl, this.config.maxTtl)
    );

    // Basic data validation - prevent storing undefined/null as data
    if (data === undefined) {
      this.logger.warn("Attempted to cache undefined data", { key });
      return;
    }

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        await cache.set<T>(key, data, effectiveTtl);
      } catch (error) {
        this.logger.error(`Cache set failed for level ${idx + 1}`, {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue to next cache level even if one fails
      }
    }
  }

  /**
   * Invalidate cache entry at all levels
   */
  async invalidate(key: string): Promise<void> {
    // Input validation
    if (!this.isValidKey(key)) {
      return;
    }

    this.stats.invalidations++;

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        await cache.invalidate(key);
      } catch (error) {
        this.logger.error(`Cache invalidate failed for level ${idx + 1}`, {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue to next cache level even if one fails
      }
    }

    this.logger.debug("Cache entry invalidated", { key });
  }

  /**
   * Batch invalidation for performance
   */
  async invalidatePattern(pattern: string): Promise<number> {
    // Input validation
    if (!this.isValidKey(pattern)) {
      return 0;
    }

    // Prevent dangerous patterns that could invalidate everything
    if (pattern === "*" || pattern === "*:*" || pattern.length < 2) {
      this.logger.warn(
        "Dangerous pattern provided to invalidatePattern, blocking",
        { pattern }
      );
      return 0;
    }

    let invalidatedCount = 0;

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      try {
        const count = await cache.invalidatePattern(pattern);
        invalidatedCount += count;
      } catch (error) {
        this.logger.error(
          `Cache invalidatePattern failed for level ${idx + 1}`,
          {
            pattern,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        // Continue to next cache level even if one fails
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
   * Warm up cache with frequently accessed data
   */
  private async warmupCache(): Promise<void> {
    try {
      await this.warmingManager.warmup(this, this.dataProvider, "static");
    } catch (error) {
      this.logger.error("Cache warmup failed", error as Error);
    }
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    const stats = this.caches.map((cache) => cache.getStats());
    const totalHits = stats.map((stat) => stat.Hits).reduce((a, b) => a + b, 0);
    const totalRequests = stats
      .map((stat) => stat.totalRequests)
      .reduce((a, b) => a + b, 0);
    this.stats.Hits = totalHits;
    this.stats.totalRequests = totalRequests;
    this.stats.hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    // Aggregate stats from all caches
    const cacheStats = this.caches.map((cache) => cache.getStats());
    const totalHits = cacheStats
      .map((stat) => stat.Hits)
      .reduce((a, b) => a + b, 0);
    const totalMisses = cacheStats
      .map((stat) => stat.Misses)
      .reduce((a, b) => a + b, 0);
    const totalRequests = cacheStats
      .map((stat) => stat.totalRequests)
      .reduce((a, b) => a + b, 0);
    const totalMemoryUsage = cacheStats
      .map((stat) => stat.memoryUsage)
      .reduce((a, b) => a + b, 0);
    const totalEntryCount = cacheStats
      .map((stat) => stat.entryCount)
      .reduce((a, b) => a + b, 0);
    const totalInvalidations = cacheStats
      .map((stat) => stat.invalidations)
      .reduce((a, b) => a + b, 0);
    const totalCompressions = cacheStats
      .map((stat) => stat.compressions)
      .reduce((a, b) => a + b, 0);

    return {
      Hits: totalHits,
      Misses: totalMisses,
      totalRequests,
      hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
      memoryUsage: totalMemoryUsage,
      entryCount: totalEntryCount,
      invalidations: totalInvalidations,
      compressions: totalCompressions,
    };
  }

  /**
   * Check if cache is enabled
   */
  async isEnabled(): Promise<boolean> {
    return Promise.resolve(this.config.enable);
  }

  /**
   * Cache health check - aggregates health from all caches
   */
  async healthCheck(): Promise<CacheHealth> {
    const healthChecks: CacheHealth[] = [];

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache) continue;

      const isEnabled = await cache.isEnabled();
      if (!isEnabled) continue;

      const health = await cache.healthCheck();
      healthChecks.push(health);
    }

    // If no caches are available, return critical status
    if (healthChecks.length === 0) {
      return {
        status: "critical",
        capacity: "error",
        hitRate: 0,
        entryCount: 0,
      };
    }

    // Aggregate health metrics from all caches
    const totalEntries = healthChecks.reduce((sum, h) => sum + h.entryCount, 0);
    const avgHitRate =
      healthChecks.reduce((sum, h) => sum + h.hitRate, 0) / healthChecks.length;

    // Determine overall status - worst case wins
    const worstStatus = healthChecks.some((h) => h.status === "critical")
      ? "critical"
      : healthChecks.some((h) => h.status === "degraded")
        ? "degraded"
        : "healthy";

    // Determine overall capacity - worst case wins
    const worstCapacity = healthChecks.some((h) => h.capacity === "error")
      ? "error"
      : healthChecks.some((h) => h.capacity === "full")
        ? "full"
        : "ok";

    return {
      status: worstStatus,
      capacity: worstCapacity,
      hitRate: avgHitRate,
      entryCount: totalEntries,
    };
  }

  /**
   * Warm up cache using specified strategy
   */
  async warmup(strategyName: string = "static"): Promise<CacheWarmingResult> {
    return this.warmingManager.warmup(this, this.dataProvider, strategyName);
  }

  /**
   * Warm up cache using all strategies
   */
  async warmupAll(): Promise<Map<string, CacheWarmingResult>> {
    return this.warmingManager.warmupAll(this, this.dataProvider);
  }

  /**
   * Start background warming
   */
  startBackgroundWarming(): void {
    this.warmingManager.startBackgroundWarming(this, this.dataProvider);
  }

  /**
   * Stop background warming
   */
  stopBackgroundWarming(): void {
    this.warmingManager.stopBackgroundWarming();
  }

  /**
   * Get cache warming statistics
   */
  getWarmingStats(): {
    strategies: string[];
    backgroundStatus?: {
      isRunning: boolean;
      intervalSeconds: number;
      activeWarmups: number;
      maxConcurrentWarmups: number;
    };
    adaptiveStats?: { totalPatterns: number; topKeys: string[] };
  } {
    return this.warmingManager.getStats();
  }

  /**
   * Get recommended keys for warming
   */
  getRecommendedKeys(): Map<string, string[]> {
    return this.warmingManager.getRecommendedKeys();
  }

  private resetStats(): void {
    this.stats.Hits = 0;
    this.stats.Misses = 0;
    this.stats.totalRequests = 0;
    this.stats.hitRate = 0;
    this.stats.memoryUsage = 0;
    this.stats.entryCount = 0;
    this.stats.invalidations = 0;
    this.stats.compressions = 0;
  }
  /**
   * Dispose of cache resources and cleanup
   */
  async dispose(): Promise<void> {
    try {
      // Stop background warming
      this.stopBackgroundWarming();

      // Clear all cache levels
      for (const cache of this.caches) {
        if (cache && typeof cache.dispose === "function") {
          try {
            await cache.dispose();
          } catch (error) {
            this.logger.error("Error disposing cache", error as Error);
          }
        }
      }
      this.resetStats();
      this.logger.info("CacheService disposed successfully");
    } catch (error) {
      this.logger.error("Error during CacheService disposal", error as Error);
    }
  }
}
