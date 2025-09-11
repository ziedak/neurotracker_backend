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
import { MemoryCache } from "./strategies/MemoryCache";
import { RedisCache } from "./strategies/RedisCache";
import { inject, injectable, singleton } from "tsyringe";
import type { RedisClient } from "../redis/redisClient";

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enable: true,
  defaultTTL: 3600,
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
@injectable()
@singleton()
export class CacheService implements ICache {
  private readonly config: CacheConfig;
  private readonly caches: ICache[];
  private readonly warmingManager: CacheWarmingManager;
  private readonly dataProvider: WarmupDataProvider;
  private stats: CacheStats = {
    Hits: 0,
    Misses: 0,
    totalRequests: 0,
    hitRate: 0,
    memoryUsage: 0,
    entryCount: 0,
    invalidations: 0,
    compressions: 0,
  };
  private logger = createLogger("CacheService");
  constructor(
    @inject("RedisClient") private readonly redisClient: RedisClient,
    config: Partial<CacheConfig> = {},
    caches?: ICache[]
  ) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.caches = caches || [
      new MemoryCache(),
      new RedisCache(this.redisClient),
    ];

    // Initialize warming components
    this.dataProvider = new AuthDataProvider();
    this.warmingManager = new CacheWarmingManager(this.config.warmingConfig);

    if (this.config.warmupOnStart) {
      this.warmupCache();
    }

    // Start background warming if enabled
    if (this.config.warmingConfig?.enableBackgroundWarming) {
      this.startBackgroundWarming();
    }
  }

  /**
   * Get data from cache with multi-level fallback
   */
  async get<T>(key: string): Promise<CacheOperationResult<T>> {
    const startTime = performance.now();
    this.stats.totalRequests++;

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache || !cache.isEnabled()) continue;
      const result = await cache.get<T>(key);
      if (result) {
        this.updateHitRate();

        // Record access pattern for adaptive learning
        if (this.config.warmingConfig?.enablePatternLearning) {
          this.warmingManager.recordAccess(key, result.latency);
        }

        return {
          data: result.data,
          source: `l${idx + 1}`,
          latency: performance.now() - startTime,
          compressed: result.compressed,
        };
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
    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache || !cache.isEnabled()) continue;
      cache.set<T>(key, data, ttl);
    }
  }

  /**
   * Invalidate cache entry at all levels
   */
  async invalidate(key: string): Promise<void> {
    this.stats.invalidations++;

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache || !cache.isEnabled()) continue;

      cache.invalidate(key);
    }

    this.logger.debug("Cache entry invalidated", { key });
  }

  /**
   * Batch invalidation for performance
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let invalidatedCount = 0;

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache || !cache.isEnabled()) continue;

      invalidatedCount += await cache.invalidatePattern(pattern);
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
    return { ...this.stats };
  }

  /**
   * Check if cache is enabled
   */
  async isEnabled(): Promise<boolean> {
    return this.config.enable;
  }

  /**
   * Cache health check - aggregates health from all caches
   */
  async healthCheck(): Promise<CacheHealth> {
    const healthChecks: CacheHealth[] = [];

    for (let idx = 0; idx < this.caches.length; idx++) {
      const cache = this.caches[idx];
      if (!cache || !cache.isEnabled()) continue;

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
  getWarmingStats(): any {
    return this.warmingManager.getStats();
  }

  /**
   * Get recommended keys for warming
   */
  getRecommendedKeys(): Map<string, string[]> {
    return this.warmingManager.getRecommendedKeys();
  }
}
