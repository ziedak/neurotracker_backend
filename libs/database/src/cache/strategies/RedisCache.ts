/**
 * Redis-First Authentication Cache Layer
 * Phase 1: Implement intelligent caching for authentication operations
 *
 * This service provides:
 * - Multi-level caching (L1: memory, : Redis, L3: database)
 * - Cache warming and invalidation strategies
 * - Performance monitoring and hit rate optimization
 */

import { RedisClient } from "@libs/database";
import { type ILogger } from "@libs/monitoring";
import { chunkArray, inject, injectable } from "@libs/utils";
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
  CacheCompressor,
  type CompressionConfig,
  DEFAULT_COMPRESSION_CONFIG,
} from "../utils/CacheCompressor";

export interface RedisCacheConfig extends CacheConfig {
  readonly compressionThreshold: number; // bytes
  readonly batchInvalidationSize: number;
  readonly compressionConfig?: Partial<CompressionConfig>; // Compression config
}

export const DEFAULT_REDIS_CACHE_CONFIG: RedisCacheConfig = {
  enable: true,
  defaultTTL: 3600, // 1 hour
  compressionThreshold: 1024, // 1KB
  batchInvalidationSize: 100,
  compressionConfig: DEFAULT_COMPRESSION_CONFIG,
};

/**
 * Redis-based cache implementation
 */
@injectable()
export class RedisCache implements ICache {
  private readonly config: RedisCacheConfig;
  private readonly compressor: CacheCompressor;
  private stats: CacheStats = { ...DEFAULT_CACHE_STATS };

  constructor(
    @inject("ILogger") private readonly logger: ILogger,
    @inject("RedisClient") private readonly redis: RedisClient,
    config?: Partial<RedisCacheConfig>
  ) {
    this.config = { ...DEFAULT_REDIS_CACHE_CONFIG, ...config };
    this.logger = logger.child({ service: "RedisCache" });

    // Initialize compressor
    this.compressor = new CacheCompressor(
      this.logger,
      this.config.compressionConfig
    );
  }

  isEnabled(): boolean {
    return this.config.enable;
  }

  /**
   * Get data from Redis cache
   */
  async get<T>(key: string): Promise<CacheOperationResult<T>> {
    const startTime = performance.now();
    this.stats.totalRequests++;

    if (this.config.enable) {
      try {
        const entry = await this.getFromRedis<T>(key);
        if (entry) {
          this.stats.Hits++;
          return {
            data: entry.data,
            source: "l2",
            latency: performance.now() - startTime,
            compressed: entry.compressed,
          };
        }
        this.stats.Misses++;
      } catch (error) {
        this.logger.error(`Redis cache error for key: ${key}`, error as Error);
      }
    }

    return {
      data: null,
      source: "miss",
      latency: performance.now() - startTime,
      compressed: false,
    };
  }

  /**
   * Set data in Redis cache
   */
  async set<T>(
    key: string,
    data: T,
    ttl: number = this.config.defaultTTL
  ): Promise<void> {
    if (this.config.enable) {
      try {
        await this.setInRedis(key, data, ttl);
      } catch (error) {
        this.logger.error(`Redis cache error for key: ${key}`, error as Error);
      }
    }
  }

  /**
   * Invalidate cache entry at all levels
   */
  async invalidate(key: string): Promise<void> {
    this.stats.invalidations++;

    //  invalidation - RedisClient already has retry logic
    if (this.config.enable) {
      try {
        await this.redis.safeDel(this.getRedisKey(key));
      } catch (error) {
        this.logger.error(
          ` cache invalidation error for key: ${key}`,
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

    //  pattern invalidation - RedisClient already has retry logic
    if (this.config.enable) {
      try {
        const redisPattern = this.getRedisKey(pattern);
        const keys = await this.redis.safeKeys(redisPattern);

        if (keys.length > 0) {
          const batches = chunkArray(keys, this.config.batchInvalidationSize);

          for (const batch of batches) {
            await this.redis.safeDel(...batch);
            invalidatedCount += batch.length;
          }
        }
      } catch (error) {
        this.logger.error(
          ` pattern invalidation error for pattern: ${pattern}`,
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
   * Cache health check
   */
  async healthCheck(): Promise<CacheHealth> {
    let result: CacheHealth = {
      status: "healthy",
      capacity: "ok",
      hitRate: this.stats.hitRate,
      entryCount: this.stats.entryCount,
    };

    try {
      await this.redis.ping();
    } catch (error) {
      result.status = "degraded";
    }

    return result;
  }

  /**
   * Get Redis key with namespace
   */
  private getRedisKey(key: string): string {
    return `auth:cache:${key}`;
  }

  /**
   * Get from Redis cache
   */
  private async getFromRedis<T>(key: string): Promise<CacheEntry<T> | null> {
    const redisKey = this.getRedisKey(key);

    // RedisClient.safeGet already has retry logic built-in
    const rawData = await this.redis.safeGet(redisKey);

    if (!rawData) return null;

    try {
      const entry: CacheEntry<T> = JSON.parse(rawData);

      // Decompress data if it was compressed
      if (entry.compressed && entry.compressionAlgorithm) {
        try {
          entry.data = await this.compressor.decompress(
            entry.data,
            entry.compressionAlgorithm as any
          );
          entry.compressed = false; // Mark as decompressed
        } catch (error) {
          this.logger.warn("Failed to decompress Redis cache entry", {
            key,
            algorithm: entry.compressionAlgorithm,
            error: error instanceof Error ? error.message : String(error),
          });
          // Return raw data as fallback
        }
      }

      return entry;
    } catch (error) {
      this.logger.error(
        `Redis cache deserialization error for key: ${key}`,
        error as Error
      );
      // RedisClient.safeDel already has retry logic built-in
      await this.redis.safeDel(redisKey);
      return null;
    }
  }

  /**
   * Set in Redis cache with optional compression
   */
  private async setInRedis<T>(
    key: string,
    data: T,
    ttl: number
  ): Promise<void> {
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
        this.logger.warn(
          "Redis compression failed, storing uncompressed data",
          {
            key,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    const entry: CacheEntry<T> = {
      data: finalData,
      timestamp: Date.now(),
      ttl,
      hits: 0,
      compressed,
      ...(compressionAlgorithm && { compressionAlgorithm }),
    };

    const serializedData = JSON.stringify(entry);
    const redisKey = this.getRedisKey(key);

    // RedisClient.safeSetEx already has retry logic built-in
    await this.redis.safeSetEx(redisKey, ttl, serializedData);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
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
}
