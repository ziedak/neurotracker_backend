/**
 * Redis-First Authentication Cache Layer
 * Phase 1: Implement intelligent caching for authentication operations
 *
 * This service provides:
 * - Multi-level caching (: memory, L2: Redis, L3: database)
 * - Cache warming and invalidation strategies
 * - Performance monitoring and hit rate optimization
 */

import { type ILogger } from "@libs/monitoring";
import { inject, injectable, LRUCache, matchPattern } from "@libs/utils";
import {
  DEFAULT_CACHE_STATS,
  type CacheConfig,
  type CacheEntry,
  type CacheHealth,
  type CacheOperationResult,
  type CacheStats,
  type ICache,
} from "../interfaces/ICache";
import {
  MemoryTracker,
  type MemoryTrackerConfig,
} from "../utils/MemoryTracker";
import {
  CacheCompressor,
  type CompressionAlgorithm,
  type CompressionConfig,
  DEFAULT_COMPRESSION_CONFIG,
} from "../utils/CacheCompressor";

export interface MemoryCacheConfig extends CacheConfig {
  readonly maxMemoryCacheSize: number; // entries (for LRU limit)
  readonly memoryConfig?: Partial<MemoryTrackerConfig>; // Memory management config
  readonly compressionConfig?: Partial<CompressionConfig>; // Compression config
}

export const DEFAULT_MEMORY_CACHE_CONFIG: MemoryCacheConfig = {
  enable: true,
  defaultTTL: 3600, // 1 hour
  maxMemoryCacheSize: 10000, // 10k entries
  memoryConfig: {
    maxMemoryMB: 50, // 50MB default
    warningThresholdPercent: 75,
    criticalThresholdPercent: 90,
    enableDetailedTracking: true,
    sizeCalculationInterval: 50,
  },
  compressionConfig: DEFAULT_COMPRESSION_CONFIG,
};

/**
 * Memory-based LRU cache implementation
 */
@injectable()
export class MemoryCache implements ICache {
  private readonly config: MemoryCacheConfig;
  private readonly memoryCache: LRUCache<string, CacheEntry<unknown>>;
  private readonly memoryTracker: MemoryTracker;
  private readonly compressor: CacheCompressor;
  private stats: CacheStats = { ...DEFAULT_CACHE_STATS };

  constructor(
    @inject("ILogger") private readonly logger: ILogger,
    config: Partial<MemoryCacheConfig> = {}
  ) {
    this.config = { ...DEFAULT_MEMORY_CACHE_CONFIG, ...config };
    this.logger = logger.child({ service: "MemoryCache" });

    // Initialize memory tracker
    this.memoryTracker = new MemoryTracker(
      this.logger,
      this.config.memoryConfig
    );

    // Initialize compressor
    this.compressor = new CacheCompressor(
      this.logger,
      this.config.compressionConfig
    );

    // Use LRUCache properly - it handles all LRU logic internally
    this.memoryCache = new LRUCache<string, CacheEntry<unknown>>({
      max: this.config.maxMemoryCacheSize,
      ttl: this.config.defaultTTL * 1000, // Convert to milliseconds
    });

    this.logger.info("MemoryCache initialized", {
      maxEntries: this.config.maxMemoryCacheSize,
      memoryLimitMB: this.config.memoryConfig?.maxMemoryMB || 50,
      compressionEnabled: this.config.compressionConfig?.enableCompression,
    });
  }
  isEnabled(): boolean {
    return this.config.enable;
  }
  /**
   * Get data from memory cache
   */
  async get<T>(key: string): Promise<CacheOperationResult<T>> {
    const startTime = performance.now();
    this.stats.totalRequests++;

    if (this.config.enable) {
      const entry = this.memoryCache.get(key);
      if (entry) {
        this.stats.Hits++;

        // Decompress data if it was compressed
        let data = entry.data;
        if (entry.compressed) {
          try {
            data = await this.compressor.decompress(
              entry.data,
              entry.compressionAlgorithm as CompressionAlgorithm | undefined
            );
          } catch (error) {
            this.logger.warn(
              "Failed to decompress cache entry, returning raw data",
              {
                key,
                error: error instanceof Error ? error.message : String(error),
              }
            );
            // Return raw data as fallback
          }
        }

        return {
          data: data as T,
          source: "l1",
          latency: performance.now() - startTime,
          compressed: entry.compressed,
        };
      }
      this.stats.Misses++;
    }

    return {
      data: null,
      source: "miss",
      latency: performance.now() - startTime,
      compressed: false,
    };
  }

  /**
   * Set data in memory cache
   */
  async set<T>(
    key: string,
    data: T,
    ttl: number = this.config.defaultTTL
  ): Promise<void> {
    if (this.config.enable) {
      // Compress data if enabled and meets threshold
      let finalData = data;
      let compressed = false;
      let compressionAlgorithm: string | undefined;

      if (this.config.compressionConfig?.enableCompression) {
        try {
          const compressionResult = await this.compressor.compress(data);
          if (compressionResult.compressed) {
            finalData = compressionResult.data;
            compressed = true;
            compressionAlgorithm = compressionResult.algorithm;
            this.stats.compressions++;
          }
        } catch (error) {
          this.logger.warn("Compression failed, storing uncompressed data", {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Check memory limits before adding
      if (!this.checkMemoryLimits(key, finalData)) {
        this.logger.warn("Memory limit exceeded, skipping cache set", {
          key,
          currentUsage: this.memoryTracker.getMemoryUsagePercent(),
          limit: this.config.memoryConfig?.criticalThresholdPercent || 90,
        });
        return;
      }

      const entry: CacheEntry<T> = {
        data: finalData,
        timestamp: Date.now(),
        ttl,
        hits: 0,
        compressed,
        ...(compressionAlgorithm && { compressionAlgorithm }),
      };

      // Track memory usage before setting
      const metadata = {
        timestamp: entry.timestamp,
        ttl: entry.ttl,
        hits: entry.hits,
        compressed: entry.compressed,
        compressionAlgorithm: entry.compressionAlgorithm,
      };
      this.memoryTracker.trackEntry(key, finalData, metadata);

      this.memoryCache.set(key, entry);
      this.updateMemoryStats();

      this.logger.debug("Memory cache entry set", {
        key,
        ttl,
        compressed,
        compressionAlgorithm,
        memoryUsage: this.memoryTracker.getTotalMemoryUsageMB(),
      });
    }
  }

  /**
   * Invalidate cache entry at all levels
   */
  async invalidate(key: string): Promise<void> {
    this.stats.invalidations++;

    this.memoryCache.delete(key);
    this.memoryTracker.removeEntry(key);
    this.logger.debug("Cache entry invalidated", { key });
  }

  /**
   * Batch invalidation for performance
   */
  async invalidatePattern(pattern: string): Promise<number> {
    let invalidatedCount = 0;

    //  pattern invalidation - use LRUCache keys() method
    const Keys = Array.from(this.memoryCache.keys());
    for (const key of Keys) {
      if (matchPattern(key, pattern)) {
        this.memoryCache.delete(key);
        this.memoryTracker.removeEntry(key);
        invalidatedCount++;
      }
    }

    return invalidatedCount;
  }

  /**
   * Cache health check
   */
  async healthCheck(): Promise<CacheHealth> {
    let result: CacheHealth = {
      status: "healthy",
      capacity: "ok",
      hitRate: this.stats.hitRate,
      entryCount: this.stats.entryCount,
    };

    // Check memory usage
    const memoryStats = this.memoryTracker.getMemoryStats();
    if (!memoryStats.isWithinLimits) {
      result.status = "critical";
      result.capacity = "error";
    } else if (
      memoryStats.usagePercent >=
      (this.config.memoryConfig?.warningThresholdPercent || 75)
    ) {
      result.status = "degraded";
      result.capacity = "full";
    }

    // Check L1 cache entry limit
    if (this.memoryCache.size >= this.config.maxMemoryCacheSize * 0.9) {
      result.capacity = result.capacity === "error" ? "error" : "full";
      result.status = result.status === "critical" ? "critical" : "degraded";
    }

    return result;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get detailed memory statistics
   */
  getMemoryStats(): any {
    return this.memoryTracker.getMemoryStats();
  }

  /**
   * Get memory tracker configuration
   */
  getMemoryConfig(): Partial<MemoryTrackerConfig> | undefined {
    return this.config.memoryConfig;
  }

  /**
   * Get compression statistics
   */
  getCompressionStats(): any {
    return this.compressor.getCompressionStats();
  }

  /**
   * Get compression configuration
   */
  getCompressionConfig(): CompressionConfig {
    return this.compressor.getConfig();
  }

  /**
   * Update compression configuration
   */
  updateCompressionConfig(newConfig: Partial<CompressionConfig>): void {
    this.compressor.updateConfig(newConfig);
  }

  /**
   * Check if adding an entry would exceed memory limits
   */
  private checkMemoryLimits(key: string, data: any): boolean {
    // If we're replacing an existing entry, account for the memory we'll free up
    const existingEntry = this.memoryCache.get(key);
    let projectedUsage = this.memoryTracker.getTotalMemoryUsage();

    if (existingEntry) {
      // Subtract existing entry size
      const existingInfo = this.memoryTracker.getEntryMemoryInfo(key);
      if (existingInfo) {
        projectedUsage -= existingInfo.totalSize;
      }
    }

    // Add new entry size
    const newEntrySize =
      this.memoryTracker.calculateObjectSize(key) +
      this.memoryTracker.calculateObjectSize(data) +
      this.memoryTracker.calculateObjectSize({
        timestamp: Date.now(),
        ttl: this.config.defaultTTL,
        hits: 0,
        compressed: false,
      });

    projectedUsage += newEntrySize;

    const maxBytes =
      (this.config.memoryConfig?.maxMemoryMB || 50) * 1024 * 1024;
    const usagePercent = (projectedUsage / maxBytes) * 100;

    return (
      usagePercent < (this.config.memoryConfig?.criticalThresholdPercent || 90)
    );
  }

  /**
   * Update memory usage statistics
   */
  private updateMemoryStats(): void {
    this.stats.entryCount = this.memoryCache.size;
    this.stats.memoryUsage = this.memoryTracker.getTotalMemoryUsage();

    // Log memory stats periodically
    if (this.stats.totalRequests % 100 === 0) {
      const memoryStats = this.memoryTracker.getMemoryStats();
      this.logger.debug("Memory cache stats", {
        entries: this.stats.entryCount,
        memoryMB: Math.round(memoryStats.totalUsageMB * 100) / 100,
        usagePercent: Math.round(memoryStats.usagePercent * 100) / 100,
        averageEntrySize: Math.round(memoryStats.averageEntrySize),
      });
    }
  }
}
