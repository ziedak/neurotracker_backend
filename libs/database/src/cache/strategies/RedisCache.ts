/**
 * Redis-First Authentication Cache Layer
 * Phase 1: Implement intelligent caching for authentication operations
 *
 * This service provides:
 * - Multi-level caching (L1: memory, : Redis, L3: database)
 * - Cache warming and invalidation strategies
 * - Performance monitoring and hit rate optimization
 */

import { chunkArray } from "@libs/utils";
import {
  type CacheConfig,
  type CacheEntry,
  type CacheHealth,
  type CacheOperationResult,
} from "../interfaces/ICache";
import {
  type CompressionConfig,
  DEFAULT_COMPRESSION_CONFIG,
} from "../utils/CacheCompressor";
import { compress, decompress } from "../utils/CacheCompressor";

import { BaseCache } from "./BaseCache";
import type { RedisClient } from "../../redis/redisClient";

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
export class RedisCache extends BaseCache<RedisCacheConfig> {
  private readonly redisClient: RedisClient;

  constructor(redisClient: RedisClient, config?: Partial<RedisCacheConfig>) {
    const fullConfig = { ...DEFAULT_REDIS_CACHE_CONFIG, ...config };
    super(fullConfig);
    this.redisClient = redisClient;
  }

  /**
   * Async check for both config and Redis health.
   */
  override async isEnabled(): Promise<boolean> {
    return (await super.isEnabled()) && (await this.redisClient.isHealthy());
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
      await this.redisClient.ping();
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

    const rawData = await this.redisClient.safeGet(redisKey);

    if (!rawData) return null;

    try {
      const entry: CacheEntry<T> = JSON.parse(rawData);

      // Decompress data if it was compressed
      if (entry.compressed && entry.compressionAlgorithm) {
        try {
          const decompressResult = await decompress(
            entry.data,
            DEFAULT_COMPRESSION_CONFIG
          );
          entry.data = decompressResult.data;
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
      await this.redisClient.safeDel(redisKey);
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
        const compressionResult = await compress(
          data,
          DEFAULT_COMPRESSION_CONFIG
        );
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

    await this.redisClient.safeSetEx(redisKey, ttl, serializedData);
  }

  // Abstract method implementations
  protected async doGet<T>(
    key: string
  ): Promise<CacheOperationResult<T> | null> {
    const entry = await this.getFromRedis<T>(key);
    if (entry) {
      return {
        data: entry.data,
        source: "l2",
        latency: 0, // Will be set by base class
        compressed: entry.compressed,
      };
    }
    return null;
  }

  protected async doSet<T>(key: string, data: T, ttl: number): Promise<void> {
    await this.setInRedis(key, data, ttl);
  }

  protected async doInvalidate(key: string): Promise<void> {
    await this.redisClient.safeDel(this.getRedisKey(key));
  }

  protected async doInvalidatePattern(pattern: string): Promise<number> {
    let invalidatedCount = 0;
    const redisPattern = this.getRedisKey(pattern);
    const keys = await this.redisClient.safeKeys(redisPattern);

    if (keys.length > 0) {
      const batches = chunkArray(keys, this.config.batchInvalidationSize);

      for (const batch of batches) {
        await this.redisClient.safeDel(...batch);
        invalidatedCount += batch.length;
      }
    }

    return invalidatedCount;
  }
}
