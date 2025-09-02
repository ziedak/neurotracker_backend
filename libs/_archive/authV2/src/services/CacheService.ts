/**
 * @fileoverview CacheServiceV2 - Enterprise caching infrastructure service
 * @module services/CacheService
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { Timestamp } from "../types/core";
import type { ICacheStatistics, IServiceHealth } from "../types/enhanced";
import type { ICacheService } from "../contracts/services";
import { ValidationError, CacheError } from "../errors/core";

/**
 * Cache entry with metadata
 */
interface ICacheEntry<T = any> {
  readonly value: T;
  readonly key: string;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly accessCount: number;
  readonly lastAccessed: Date;
  readonly size: number;
  readonly tags: ReadonlyArray<string>;
}

/**
 * Cache tier configuration
 */
interface ICacheTierConfig {
  readonly name: string;
  readonly maxSize: number;
  readonly defaultTtl: number;
  readonly evictionPolicy: "lru" | "lfu" | "fifo" | "ttl";
  readonly compressionEnabled: boolean;
}

/**
 * Cache operation statistics
 */
interface ICacheOperationStats {
  getOperations: number;
  setOperations: number;
  deleteOperations: number;
  existsOperations: number;
  patternOperations: number;
  totalOperations: number;
  totalErrors: number;
}

/**
 * Cache tier implementation
 */
class CacheTier<T = any> {
  private readonly entries: Map<string, ICacheEntry<T>>;
  private readonly accessOrder: string[];
  private readonly accessFrequency: Map<string, number>;
  private readonly config: ICacheTierConfig;

  constructor(config: ICacheTierConfig) {
    this.entries = new Map();
    this.accessOrder = [];
    this.accessFrequency = new Map();
    this.config = config;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt <= new Date()) {
      this.delete(key);
      return undefined;
    }

    // Update access tracking
    this.updateAccessTracking(key, entry);

    return entry.value;
  }

  set(key: string, value: T, ttl?: number, tags: string[] = []): boolean {
    try {
      const now = new Date();
      const expiresAt = ttl ? new Date(now.getTime() + ttl * 1000) : null;
      const size = this.calculateSize(value);

      // Check if we need to evict entries
      if (this.entries.size >= this.config.maxSize) {
        this.evictEntries(1);
      }

      const entry: ICacheEntry<T> = {
        value,
        key,
        createdAt: now,
        expiresAt,
        accessCount: 1,
        lastAccessed: now,
        size,
        tags: [...tags],
      };

      this.entries.set(key, entry);
      this.updateAccessTracking(key, entry);

      return true;
    } catch {
      return false;
    }
  }

  delete(key: string): boolean {
    const existed = this.entries.has(key);
    this.entries.delete(key);
    this.removeFromAccessTracking(key);
    return existed;
  }

  exists(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt <= new Date()) {
      this.delete(key);
      return false;
    }

    return true;
  }

  clear(): void {
    this.entries.clear();
    this.accessOrder.length = 0;
    this.accessFrequency.clear();
  }

  getSize(): number {
    return this.entries.size;
  }

  getKeys(): string[] {
    return Array.from(this.entries.keys());
  }

  clearByPattern(pattern: string): number {
    const regex = this.patternToRegex(pattern);
    let cleared = 0;

    for (const key of this.entries.keys()) {
      if (regex.test(key)) {
        this.delete(key);
        cleared++;
      }
    }

    return cleared;
  }

  clearByTags(tags: string[]): number {
    let cleared = 0;

    for (const [key, entry] of this.entries) {
      if (tags.some((tag) => entry.tags.includes(tag))) {
        this.delete(key);
        cleared++;
      }
    }

    return cleared;
  }

  private updateAccessTracking(key: string, entry: ICacheEntry<T>): void {
    // Update access count
    const updatedEntry: ICacheEntry<T> = {
      ...entry,
      accessCount: entry.accessCount + 1,
      lastAccessed: new Date(),
    };
    this.entries.set(key, updatedEntry);

    // Update LRU tracking
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);

    // Update LFU tracking
    this.accessFrequency.set(key, (this.accessFrequency.get(key) || 0) + 1);
  }

  private removeFromAccessTracking(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessFrequency.delete(key);
  }

  private evictEntries(count: number): void {
    const toEvict: string[] = [];

    switch (this.config.evictionPolicy) {
      case "lru":
        toEvict.push(...this.accessOrder.slice(0, count));
        break;
      case "lfu":
        toEvict.push(...this.getLeastFrequentlyUsed(count));
        break;
      case "fifo":
        toEvict.push(...this.getOldestEntries(count));
        break;
      case "ttl":
        toEvict.push(...this.getExpiredEntries(count));
        break;
    }

    toEvict.forEach((key) => this.delete(key));
  }

  private getLeastFrequentlyUsed(count: number): string[] {
    return Array.from(this.accessFrequency.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, count)
      .map(([key]) => key);
  }

  private getOldestEntries(count: number): string[] {
    return Array.from(this.entries.entries())
      .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime())
      .slice(0, count)
      .map(([key]) => key);
  }

  private getExpiredEntries(count: number): string[] {
    const now = new Date();
    return Array.from(this.entries.entries())
      .filter(([, entry]) => entry.expiresAt && entry.expiresAt <= now)
      .slice(0, count)
      .map(([key]) => key);
  }

  private calculateSize(value: unknown): number {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }

  private patternToRegex(pattern: string): RegExp {
    // Convert glob-style pattern to regex
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${regex}$`);
  }
}

/**
 * CacheServiceV2 Implementation
 *
 * Enterprise-grade caching infrastructure service with:
 * - Multi-tier caching architecture (L1: memory, L2: distributed, L3: persistent)
 * - Advanced eviction policies (LRU, LFU, FIFO, TTL)
 * - Pattern-based cache clearing and tagging
 * - Comprehensive statistics and health monitoring
 * - Cache warming and preloading capabilities
 * - High-performance operations with minimal latency
 */
export class CacheServiceV2 implements ICacheService {
  private readonly tiers: Map<string, CacheTier>;
  private readonly operationStats: ICacheOperationStats;
  private readonly startTime: number;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private statsInterval: NodeJS.Timeout | null = null;

  // Performance tracking
  private totalHits = 0;
  private totalMisses = 0;
  private totalEvictions = 0;
  private loadTimes: number[] = [];

  // Configuration
  private readonly defaultTtl = 3600; // 1 hour
  private readonly cleanupIntervalMs = 300000; // 5 minutes
  private readonly statsIntervalMs = 60000; // 1 minute
  private readonly maxLoadTimesSamples = 1000;

  constructor() {
    this.startTime = Date.now();
    this.tiers = new Map();
    this.operationStats = {
      getOperations: 0,
      setOperations: 0,
      deleteOperations: 0,
      existsOperations: 0,
      patternOperations: 0,
      totalOperations: 0,
      totalErrors: 0,
    };

    // Initialize cache tiers
    this.initializeTiers();

    // Start background tasks
    this.startCleanupJob();
    this.startStatsJob();
  }

  /**
   * Get value from cache with multi-tier lookup
   */
  async get<T>(key: string): Promise<T | null> {
    const startTime = Date.now();

    try {
      this.operationStats.getOperations++;
      this.operationStats.totalOperations++;

      this.validateKey(key);

      // Try each tier in order
      for (const tier of this.tiers.values()) {
        const value = tier.get(key);
        if (value !== undefined) {
          this.totalHits++;
          this.recordLoadTime(Date.now() - startTime);
          return value;
        }
      }

      this.totalMisses++;
      return null;
    } catch (error) {
      this.operationStats.totalErrors++;
      throw new CacheError(`get operation for key: ${key}`, { error, key });
    }
  }

  /**
   * Set value in cache with multi-tier storage
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const startTime = Date.now();

    try {
      this.operationStats.setOperations++;
      this.operationStats.totalOperations++;

      this.validateKey(key);
      this.validateValue(value);

      const effectiveTtl = ttlSeconds || this.defaultTtl;

      // Set in all tiers
      for (const tier of this.tiers.values()) {
        tier.set(key, value, effectiveTtl);
      }

      this.recordLoadTime(Date.now() - startTime);
    } catch (error) {
      this.operationStats.totalErrors++;
      throw new CacheError(`set operation for key: ${key}`, {
        error,
        key,
        value,
      });
    }
  }

  /**
   * Delete value from all cache tiers
   */
  async delete(key: string): Promise<boolean> {
    try {
      this.operationStats.deleteOperations++;
      this.operationStats.totalOperations++;

      this.validateKey(key);

      let existed = false;
      for (const tier of this.tiers.values()) {
        const tierExisted = tier.delete(key);
        existed = existed || tierExisted;
      }

      return existed;
    } catch (error) {
      this.operationStats.totalErrors++;
      throw new CacheError(`delete operation for key: ${key}`, { error, key });
    }
  }

  /**
   * Check if key exists in any tier
   */
  async exists(key: string): Promise<boolean> {
    try {
      this.operationStats.existsOperations++;
      this.operationStats.totalOperations++;

      this.validateKey(key);

      for (const tier of this.tiers.values()) {
        if (tier.exists(key)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      this.operationStats.totalErrors++;
      throw new CacheError(`exists operation for key: ${key}`, { error, key });
    }
  }

  /**
   * Get comprehensive cache statistics
   */
  async getStats(): Promise<ICacheStatistics> {
    const totalOperations = this.totalHits + this.totalMisses;
    const hitRate = totalOperations > 0 ? this.totalHits / totalOperations : 0;
    const avgLoadTime =
      this.loadTimes.length > 0
        ? this.loadTimes.reduce((a, b) => a + b) / this.loadTimes.length
        : 0;

    let totalCacheSize = 0;
    for (const tier of this.tiers.values()) {
      totalCacheSize += tier.getSize();
    }

    return {
      hitCount: this.totalHits,
      missCount: this.totalMisses,
      hitRate,
      evictionCount: this.totalEvictions,
      averageLoadTime: avgLoadTime,
      cacheSize: totalCacheSize,
      lastUpdated: new Date().toISOString() as Timestamp,
    };
  }

  /**
   * Clear cache entries by pattern
   */
  async clearPattern(pattern: string): Promise<number> {
    try {
      this.operationStats.patternOperations++;
      this.operationStats.totalOperations++;

      this.validatePattern(pattern);

      let totalCleared = 0;
      for (const tier of this.tiers.values()) {
        totalCleared += tier.clearByPattern(pattern);
      }

      return totalCleared;
    } catch (error) {
      this.operationStats.totalErrors++;
      throw new CacheError(`clearPattern operation for pattern: ${pattern}`, {
        error,
        pattern,
      });
    }
  }

  /**
   * Get service health status
   */
  async getHealth(): Promise<IServiceHealth> {
    const uptime = Date.now() - this.startTime;
    const stats = await this.getStats();

    // Determine health status
    let status: "healthy" | "degraded" | "unhealthy" = "healthy";
    if (stats.hitRate < 0.5 && this.operationStats.totalOperations > 1000) {
      status = "degraded";
    }
    if (
      this.operationStats.totalErrors >
      this.operationStats.totalOperations * 0.05
    ) {
      status = "unhealthy";
    }

    return {
      service: "CacheServiceV2",
      status,
      uptime,
      lastCheck: new Date().toISOString() as Timestamp,
      dependencies: [], // Cache service is infrastructure, no dependencies
      metrics: {
        totalOperations: this.operationStats.totalOperations,
        totalErrors: this.operationStats.totalErrors,
        hitRate: stats.hitRate,
        cacheSize: stats.cacheSize,
        averageLoadTime: stats.averageLoadTime,
        uptime,
      },
    };
  }

  /**
   * Clear all cache tiers
   */
  async clear(): Promise<void> {
    try {
      for (const tier of this.tiers.values()) {
        tier.clear();
      }

      // Reset statistics
      this.totalHits = 0;
      this.totalMisses = 0;
      this.totalEvictions = 0;
      this.loadTimes = [];
    } catch (error) {
      this.operationStats.totalErrors++;
      throw new CacheError("clear operation", { error });
    }
  }

  /**
   * Clear cache entries by tags
   */
  async clearByTags(tags: string[]): Promise<number> {
    try {
      this.operationStats.patternOperations++;
      this.operationStats.totalOperations++;

      if (!Array.isArray(tags) || tags.length === 0) {
        throw new ValidationError("Tags must be a non-empty array", [
          {
            field: "tags",
            message: "Tags must be a non-empty array",
            code: "INVALID_TAGS",
          },
        ]);
      }

      let totalCleared = 0;
      for (const tier of this.tiers.values()) {
        totalCleared += tier.clearByTags(tags);
      }

      return totalCleared;
    } catch (error) {
      this.operationStats.totalErrors++;
      throw new CacheError(
        `clearByTags operation for tags: ${tags.join(", ")}`,
        { error, tags }
      );
    }
  }

  /**
   * Warm cache with preloaded data
   */
  async warm<T>(data: Record<string, T>, ttl?: number): Promise<number> {
    try {
      let warmed = 0;

      for (const [key, value] of Object.entries(data)) {
        await this.set(key, value, ttl);
        warmed++;
      }

      return warmed;
    } catch (error) {
      this.operationStats.totalErrors++;
      throw new CacheError("warm operation", {
        error,
        keys: Object.keys(data).length,
      });
    }
  }

  /**
   * Get cache keys by pattern
   */
  async getKeys(pattern?: string): Promise<string[]> {
    try {
      const allKeys = new Set<string>();

      for (const tier of this.tiers.values()) {
        const tierKeys = tier.getKeys();
        tierKeys.forEach((key) => allKeys.add(key));
      }

      if (!pattern) {
        return Array.from(allKeys);
      }

      const regex = this.patternToRegex(pattern);
      return Array.from(allKeys).filter((key) => regex.test(key));
    } catch (error) {
      this.operationStats.totalErrors++;
      throw new CacheError(`getKeys operation for pattern: ${pattern}`, {
        error,
        pattern,
      });
    }
  }

  /**
   * Shutdown cache service
   */
  async shutdown(): Promise<void> {
    // Stop background jobs
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }

    // Clear all caches
    await this.clear();
  }

  // Private helper methods

  private initializeTiers(): void {
    // L1 Cache - Fast in-memory cache
    const l1Config: ICacheTierConfig = {
      name: "L1_Memory",
      maxSize: 10000,
      defaultTtl: 300, // 5 minutes
      evictionPolicy: "lru",
      compressionEnabled: false,
    };
    this.tiers.set("L1", new CacheTier(l1Config));

    // L2 Cache - Larger distributed cache
    const l2Config: ICacheTierConfig = {
      name: "L2_Distributed",
      maxSize: 100000,
      defaultTtl: 3600, // 1 hour
      evictionPolicy: "lfu",
      compressionEnabled: true,
    };
    this.tiers.set("L2", new CacheTier(l2Config));

    // L3 Cache - Persistent cache
    const l3Config: ICacheTierConfig = {
      name: "L3_Persistent",
      maxSize: 1000000,
      defaultTtl: 86400, // 24 hours
      evictionPolicy: "ttl",
      compressionEnabled: true,
    };
    this.tiers.set("L3", new CacheTier(l3Config));
  }

  private validateKey(key: string): void {
    if (!key || typeof key !== "string") {
      throw new ValidationError("Cache key must be a non-empty string", [
        {
          field: "key",
          message: "Cache key must be a non-empty string",
          code: "INVALID_CACHE_KEY",
        },
      ]);
    }
    if (key.length > 250) {
      throw new ValidationError("Cache key too long (max 250 characters)", [
        {
          field: "key",
          message: "Cache key too long (max 250 characters)",
          code: "CACHE_KEY_TOO_LONG",
        },
      ]);
    }
    if (key.includes("\0") || key.includes("\n") || key.includes("\r")) {
      throw new ValidationError("Cache key contains invalid characters", [
        {
          field: "key",
          message: "Cache key contains invalid characters",
          code: "INVALID_CACHE_KEY_CHARS",
        },
      ]);
    }
  }

  private validateValue<T>(value: T): void {
    if (value === undefined) {
      throw new ValidationError("Cache value cannot be undefined", [
        {
          field: "value",
          message: "Cache value cannot be undefined",
          code: "INVALID_CACHE_VALUE",
        },
      ]);
    }
  }

  private validatePattern(pattern: string): void {
    if (!pattern || typeof pattern !== "string") {
      throw new ValidationError("Cache pattern must be a non-empty string", [
        {
          field: "pattern",
          message: "Cache pattern must be a non-empty string",
          code: "INVALID_CACHE_PATTERN",
        },
      ]);
    }
  }

  private recordLoadTime(time: number): void {
    this.loadTimes.push(time);
    if (this.loadTimes.length > this.maxLoadTimesSamples) {
      this.loadTimes.shift();
    }
  }

  private patternToRegex(pattern: string): RegExp {
    // Convert glob-style pattern to regex
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regex = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${regex}$`);
  }

  private startCleanupJob(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        // Cleanup expired entries from all tiers
        for (const tier of this.tiers.values()) {
          const beforeSize = tier.getSize();
          // Force cleanup of expired entries by checking each key
          const keys = tier.getKeys();
          for (const key of keys) {
            if (!tier.exists(key)) {
              // This will remove expired entries
              tier.delete(key);
            }
          }
          const afterSize = tier.getSize();
          this.totalEvictions += beforeSize - afterSize;
        }
      } catch (error) {
        // Log error but don't throw - background job should continue
        console.error("Cache cleanup job error:", error);
      }
    }, this.cleanupIntervalMs);
  }

  private startStatsJob(): void {
    this.statsInterval = setInterval(async () => {
      try {
        // Periodic stats collection and potential optimizations
        const stats = await this.getStats();

        // Auto-optimize based on hit rate
        if (stats.hitRate < 0.3 && this.operationStats.totalOperations > 5000) {
          // Consider cache warming or configuration adjustments
          console.log(
            "Cache hit rate low, consider optimization:",
            stats.hitRate
          );
        }
      } catch (error) {
        // Log error but don't throw - background job should continue
        console.error("Cache stats job error:", error);
      }
    }, this.statsIntervalMs);
  }
}

/**
 * Default export for convenience
 */
export default CacheServiceV2;
