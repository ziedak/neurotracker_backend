import { RedisClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { CacheEntry, CacheStats } from "../types";
import { performance } from "perf_hooks";
import Redis from "ioredis";

/**
 * Cache Service for AI Engine
 * Provides intelligent caching for predictions, features, and models
 * Implements TTL strategies, cache warming, and performance monitoring
 */
export class CacheService {
  private readonly redis: Redis;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  // Cache configuration
  private readonly CACHE_CONFIG = {
    PREDICTION_TTL: 3600, // 1 hour for predictions
    FEATURE_TTL: 1800, // 30 minutes for features
    MODEL_METADATA_TTL: 7200, // 2 hours for model metadata
    BATCH_PREDICTION_TTL: 1800, // 30 minutes for batch predictions
    MAX_KEY_LENGTH: 250,
  };

  // Cache key prefixes
  private readonly KEY_PREFIXES = {
    PREDICTION: "ai:prediction",
    FEATURE: "ai:feature",
    MODEL: "ai:model",
    BATCH: "ai:batch",
    STATS: "ai:stats",
  };

  constructor(redis: Redis, logger: Logger, metrics: MetricsCollector) {
    this.redis = redis;
    this.logger = logger;
    this.metrics = metrics;

    this.logger.info("Cache Service initialized");
  }

  /**
   * Get cached prediction
   */
  async getPrediction(
    cartId: string,
    modelVersion: string = "default"
  ): Promise<any | null> {
    const startTime = performance.now();
    const key = this.buildKey(
      this.KEY_PREFIXES.PREDICTION,
      cartId,
      modelVersion
    );

    try {
      const cached = await this.redis.get(key);
      const duration = performance.now() - startTime;

      if (cached) {
        const data = JSON.parse(cached);
        this.metrics.recordTimer("cache_get_duration", duration);
        this.metrics.recordCounter("cache_hit_prediction");

        this.logger.debug("Cache hit for prediction", {
          cartId,
          modelVersion,
          duration: Math.round(duration),
        });

        // Update hit count
        await this.incrementHitCount(key);

        return data;
      } else {
        this.metrics.recordTimer("cache_get_duration", duration);
        this.metrics.recordCounter("cache_miss_prediction");

        this.logger.debug("Cache miss for prediction", {
          cartId,
          modelVersion,
          duration: Math.round(duration),
        });

        return null;
      }
    } catch (error) {
      const duration = performance.now() - startTime;
      this.metrics.recordTimer("cache_get_duration", duration);
      this.metrics.recordCounter("cache_error");

      this.logger.error("Cache get error", {
        key,
        error: error.message,
        duration: Math.round(duration),
      });

      return null; // Return null on cache errors to avoid breaking the flow
    }
  }

  /**
   * Cache prediction result
   */
  async setPrediction(
    cartId: string,
    modelVersion: string,
    prediction: any,
    customTTL?: number
  ): Promise<void> {
    const startTime = performance.now();
    const key = this.buildKey(
      this.KEY_PREFIXES.PREDICTION,
      cartId,
      modelVersion
    );
    const ttl = customTTL || this.CACHE_CONFIG.PREDICTION_TTL;

    try {
      const cacheEntry: CacheEntry<any> = {
        data: prediction,
        timestamp: Date.now(),
        ttl,
        version: modelVersion,
        hits: 0,
      };

      await this.redis.setex(key, ttl, JSON.stringify(cacheEntry));

      const duration = performance.now() - startTime;
      this.metrics.recordTimer("cache_set_duration", duration);
      this.metrics.recordCounter("cache_set_prediction");

      this.logger.debug("Prediction cached", {
        cartId,
        modelVersion,
        ttl,
        duration: Math.round(duration),
      });
    } catch (error) {
      const duration = performance.now() - startTime;
      this.metrics.recordTimer("cache_set_duration", duration);
      this.metrics.recordCounter("cache_error");

      this.logger.error("Cache set error", {
        key,
        error: error.message,
        duration: Math.round(duration),
      });
    }
  }

  /**
   * Get cached features
   */
  async getFeatures(cartId: string): Promise<any | null> {
    const startTime = performance.now();
    const key = this.buildKey(this.KEY_PREFIXES.FEATURE, cartId);

    try {
      const cached = await this.redis.get(key);
      const duration = performance.now() - startTime;

      if (cached) {
        const data = JSON.parse(cached);
        this.metrics.recordTimer("cache_get_duration", duration);
        this.metrics.recordCounter("cache_hit_feature");

        this.logger.debug("Cache hit for features", {
          cartId,
          duration: Math.round(duration),
        });

        await this.incrementHitCount(key);
        return data;
      } else {
        this.metrics.recordTimer("cache_get_duration", duration);
        this.metrics.recordCounter("cache_miss_feature");

        this.logger.debug("Cache miss for features", {
          cartId,
          duration: Math.round(duration),
        });

        return null;
      }
    } catch (error) {
      const duration = performance.now() - startTime;
      this.metrics.recordTimer("cache_get_duration", duration);
      this.metrics.recordCounter("cache_error");

      this.logger.error("Cache get error for features", {
        key,
        error: error.message,
        duration: Math.round(duration),
      });

      return null;
    }
  }

  /**
   * Cache features
   */
  async setFeatures(
    cartId: string,
    features: any,
    customTTL?: number
  ): Promise<void> {
    const startTime = performance.now();
    const key = this.buildKey(this.KEY_PREFIXES.FEATURE, cartId);
    const ttl = customTTL || this.CACHE_CONFIG.FEATURE_TTL;

    try {
      const cacheEntry: CacheEntry<any> = {
        data: features,
        timestamp: Date.now(),
        ttl,
        version: "1.0.0",
        hits: 0,
      };

      await this.redis.setex(key, ttl, JSON.stringify(cacheEntry));

      const duration = performance.now() - startTime;
      this.metrics.recordTimer("cache_set_duration", duration);
      this.metrics.recordCounter("cache_set_feature");

      this.logger.debug("Features cached", {
        cartId,
        ttl,
        duration: Math.round(duration),
      });
    } catch (error) {
      const duration = performance.now() - startTime;
      this.metrics.recordTimer("cache_set_duration", duration);
      this.metrics.recordCounter("cache_error");

      this.logger.error("Cache set error for features", {
        key,
        error: error.message,
        duration: Math.round(duration),
      });
    }
  }

  /**
   * Get model metadata from cache
   */
  async getModelMetadata(modelVersion: string): Promise<any | null> {
    const key = this.buildKey(
      this.KEY_PREFIXES.MODEL,
      "metadata",
      modelVersion
    );

    try {
      const cached = await this.redis.get(key);

      if (cached) {
        this.metrics.recordCounter("cache_hit_model");
        return JSON.parse(cached);
      } else {
        this.metrics.recordCounter("cache_miss_model");
        return null;
      }
    } catch (error) {
      this.metrics.recordCounter("cache_error");
      this.logger.error("Cache get error for model metadata", {
        modelVersion,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Cache model metadata
   */
  async setModelMetadata(
    modelVersion: string,
    metadata: any,
    customTTL?: number
  ): Promise<void> {
    const key = this.buildKey(
      this.KEY_PREFIXES.MODEL,
      "metadata",
      modelVersion
    );
    const ttl = customTTL || this.CACHE_CONFIG.MODEL_METADATA_TTL;

    try {
      const cacheEntry: CacheEntry<any> = {
        data: metadata,
        timestamp: Date.now(),
        ttl,
        version: modelVersion,
        hits: 0,
      };

      await this.redis.setex(key, ttl, JSON.stringify(cacheEntry));
      this.metrics.recordCounter("cache_set_model");

      this.logger.debug("Model metadata cached", {
        modelVersion,
        ttl,
      });
    } catch (error) {
      this.metrics.recordCounter("cache_error");
      this.logger.error("Cache set error for model metadata", {
        modelVersion,
        error: error.message,
      });
    }
  }

  /**
   * Invalidate prediction cache for a cart
   */
  async invalidatePredictions(cartId: string): Promise<void> {
    try {
      const pattern = this.buildKey(this.KEY_PREFIXES.PREDICTION, cartId, "*");
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.metrics.recordCounter("cache_invalidation");

        this.logger.info("Prediction cache invalidated", {
          cartId,
          keysRemoved: keys.length,
        });
      }
    } catch (error) {
      this.metrics.recordCounter("cache_error");
      this.logger.error("Cache invalidation error", {
        cartId,
        error: error.message,
      });
    }
  }

  /**
   * Warm cache with batch predictions
   */
  async warmCache(
    predictions: Array<{
      cartId: string;
      modelVersion: string;
      prediction: any;
    }>
  ): Promise<void> {
    const startTime = performance.now();

    try {
      const pipeline = this.redis.multi();

      for (const item of predictions) {
        const key = this.buildKey(
          this.KEY_PREFIXES.PREDICTION,
          item.cartId,
          item.modelVersion
        );
        const cacheEntry: CacheEntry<any> = {
          data: item.prediction,
          timestamp: Date.now(),
          ttl: this.CACHE_CONFIG.PREDICTION_TTL,
          version: item.modelVersion,
          hits: 0,
        };

        pipeline.setex(
          key,
          this.CACHE_CONFIG.PREDICTION_TTL,
          JSON.stringify(cacheEntry)
        );
      }

      await pipeline.exec();

      const duration = performance.now() - startTime;
      this.metrics.recordTimer("cache_warm_duration", duration);
      this.metrics.recordCounter("cache_warm_completed");

      this.logger.info("Cache warmed successfully", {
        itemsWarmed: predictions.length,
        duration: Math.round(duration),
      });
    } catch (error) {
      const duration = performance.now() - startTime;
      this.metrics.recordTimer("cache_warm_duration", duration);
      this.metrics.recordCounter("cache_error");

      this.logger.error("Cache warming failed", {
        itemCount: predictions.length,
        error: error.message,
        duration: Math.round(duration),
      });
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<CacheStats> {
    try {
      const info = await this.redis.info("memory");
      const dbSize = await this.redis.dbsize();

      // Parse memory info
      const memoryLines = info.split("\r\n");
      const usedMemory =
        memoryLines
          .find((line) => line.startsWith("used_memory:"))
          ?.split(":")[1] || "0";

      // Get hit/miss counters from metrics (simplified example)
      const stats: CacheStats = {
        hits: 0, // Would be retrieved from metrics aggregation
        misses: 0, // Would be retrieved from metrics aggregation
        hitRate: 0, // Calculated from hits and misses
        totalEntries: dbSize,
        memoryUsage: parseInt(usedMemory),
      };

      return stats;
    } catch (error) {
      this.logger.error("Failed to get cache stats", error);
      return {
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalEntries: 0,
        memoryUsage: 0,
      };
    }
  }

  /**
   * Clear all AI Engine cache
   */
  async clearCache(): Promise<void> {
    try {
      const patterns = Object.values(this.KEY_PREFIXES).map(
        (prefix) => `${prefix}:*`
      );

      for (const pattern of patterns) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }

      this.metrics.recordCounter("cache_clear");
      this.logger.info("AI Engine cache cleared");
    } catch (error) {
      this.metrics.recordCounter("cache_error");
      this.logger.error("Cache clear failed", error);
    }
  }

  /**
   * Build cache key with proper formatting
   */
  private buildKey(...parts: string[]): string {
    const key = parts.join(":");

    // Ensure key doesn't exceed Redis key length limits
    if (key.length > this.CACHE_CONFIG.MAX_KEY_LENGTH) {
      // Hash long keys to ensure they fit
      const crypto = require("crypto");
      const hash = crypto
        .createHash("sha256")
        .update(key)
        .digest("hex")
        .substring(0, 16);
      return `${parts[0]}:${hash}`;
    }

    return key;
  }

  /**
   * Increment hit count for cache entry
   */
  private async incrementHitCount(key: string): Promise<void> {
    try {
      await this.redis.eval(
        `
        local key = KEYS[1]
        local value = redis.call('GET', key)
        if value then
          local data = cjson.decode(value)
          data.hits = (data.hits or 0) + 1
          redis.call('SET', key, cjson.encode(data), 'KEEPTTL')
        end
        `,
        1,
        key
      );
    } catch (error) {
      // Silent fail for hit count updates
      this.logger.debug("Failed to increment hit count", {
        key,
        error: error.message,
      });
    }
  }
}
