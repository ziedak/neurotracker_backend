import { RedisClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string; // Key prefix
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
}

/**
 * Cache Service for Dashboard
 * Provides caching functionality using Redis
 */
export class CacheService {
  private readonly redis: RedisClient;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly defaultTTL: number = 300; // 5 minutes
  private readonly keyPrefix: string = "dashboard:";

  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0,
  };

  constructor(redis: RedisClient, logger: Logger, metrics: MetricsCollector) {
    this.redis = redis;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, options?: CacheOptions): Promise<T | null> {
    try {
      const fullKey = this.buildKey(key, options?.prefix);
      const value = await RedisClient.getInstance().get(fullKey);

      if (value !== null) {
        this.stats.hits++;
        await this.metrics.recordCounter("cache_hits");

        const parsed = JSON.parse(value);
        this.logger.debug("Cache hit", { key: fullKey });
        return parsed as T;
      } else {
        this.stats.misses++;
        await this.metrics.recordCounter("cache_misses");
        this.logger.debug("Cache miss", { key: fullKey });
        return null;
      }
    } catch (error) {
      this.stats.errors++;
      await this.metrics.recordCounter("cache_errors");
      this.logger.error("Cache get error", error as Error, { key });
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(
    key: string,
    value: any,
    ttl?: number,
    options?: CacheOptions
  ): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, options?.prefix);
      const serialized = JSON.stringify(value);
      const cacheTTL = ttl || options?.ttl || this.defaultTTL;

      await RedisClient.getInstance().setex(fullKey, cacheTTL, serialized);

      this.stats.sets++;
      await this.metrics.recordCounter("cache_sets");

      this.logger.debug("Cache set", { key: fullKey, ttl: cacheTTL });
      return true;
    } catch (error) {
      this.stats.errors++;
      await this.metrics.recordCounter("cache_errors");
      this.logger.error("Cache set error", error as Error, { key });
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string, options?: CacheOptions): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, options?.prefix);
      const result = await RedisClient.getInstance().del(fullKey);

      this.stats.deletes++;
      await this.metrics.recordCounter("cache_deletes");

      this.logger.debug("Cache delete", { key: fullKey, deleted: result > 0 });
      return result > 0;
    } catch (error) {
      this.stats.errors++;
      await this.metrics.recordCounter("cache_errors");
      this.logger.error("Cache delete error", error as Error, { key });
      return false;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async deletePattern(
    pattern: string,
    options?: CacheOptions
  ): Promise<number> {
    try {
      const fullPattern = this.buildKey(pattern, options?.prefix);
      const keys = await RedisClient.getInstance().keys(fullPattern);

      if (keys.length === 0) {
        return 0;
      }

      const result = await RedisClient.getInstance().del(...keys);

      this.stats.deletes += result;
      await this.metrics.recordCounter("cache_pattern_deletes");

      this.logger.debug("Cache pattern delete", {
        pattern: fullPattern,
        deleted: result,
      });
      return result;
    } catch (error) {
      this.stats.errors++;
      await this.metrics.recordCounter("cache_errors");
      this.logger.error("Cache pattern delete error", error as Error, {
        pattern,
      });
      return 0;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string, options?: CacheOptions): Promise<boolean> {
    try {
      const fullKey = this.buildKey(key, options?.prefix);
      const result = await RedisClient.getInstance().exists(fullKey);
      return result > 0;
    } catch (error) {
      this.logger.error("Cache exists check error", error as Error, { key });
      return false;
    }
  }

  /**
   * Increment a counter in cache
   */
  async increment(
    key: string,
    value: number = 1,
    ttl?: number,
    options?: CacheOptions
  ): Promise<number> {
    try {
      const fullKey = this.buildKey(key, options?.prefix);
      const result = await RedisClient.getInstance().incrby(fullKey, value);

      // Set TTL if this is the first increment
      if (result === value && ttl) {
        await RedisClient.getInstance().expire(fullKey, ttl);
      }

      return result;
    } catch (error) {
      this.logger.error("Cache increment error", error as Error, { key });
      return 0;
    }
  }

  /**
   * Get multiple values from cache
   */
  async getMultiple<T>(
    keys: string[],
    options?: CacheOptions
  ): Promise<Record<string, T | null>> {
    try {
      const fullKeys = keys.map((key) => this.buildKey(key, options?.prefix));
      const values = await RedisClient.getInstance().mget(...fullKeys);

      const result: Record<string, T | null> = {};

      keys.forEach((originalKey, index) => {
        const value = values[index];
        if (value !== null) {
          try {
            result[originalKey] = JSON.parse(value) as T;
            this.stats.hits++;
          } catch (error) {
            result[originalKey] = null;
            this.stats.errors++;
          }
        } else {
          result[originalKey] = null;
          this.stats.misses++;
        }
      });

      return result;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Cache getMultiple error", error as Error, { keys });

      // Return empty result for all keys
      const result: Record<string, T | null> = {};
      keys.forEach((key) => {
        result[key] = null;
      });
      return result;
    }
  }

  /**
   * Set multiple values in cache
   */
  async setMultiple(
    data: Record<string, any>,
    ttl?: number,
    options?: CacheOptions
  ): Promise<boolean> {
    try {
      const pipeline = RedisClient.getInstance().pipeline();
      const cacheTTL = ttl || options?.ttl || this.defaultTTL;

      Object.entries(data).forEach(([key, value]) => {
        const fullKey = this.buildKey(key, options?.prefix);
        const serialized = JSON.stringify(value);
        pipeline.setex(fullKey, cacheTTL, serialized);
      });

      await pipeline.exec();

      this.stats.sets += Object.keys(data).length;
      await this.metrics.recordCounter("cache_bulk_sets");

      this.logger.debug("Cache setMultiple", {
        count: Object.keys(data).length,
        ttl: cacheTTL,
      });
      return true;
    } catch (error) {
      this.stats.errors++;
      this.logger.error("Cache setMultiple error", error as Error, {
        keys: Object.keys(data),
      });
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };
  }

  /**
   * Get cache health information
   */
  async getHealth(): Promise<{
    status: string;
    latency?: number;
    stats: CacheStats;
  }> {
    try {
      const startTime = Date.now();
      const testKey = this.buildKey("health_check");

      // Test set/get/delete operations
      await RedisClient.getInstance().setex(testKey, 1, "test");
      const value = await RedisClient.getInstance().get(testKey);
      await RedisClient.getInstance().del(testKey);

      const latency = Date.now() - startTime;
      const status = value === "test" ? "healthy" : "degraded";

      return {
        status,
        latency,
        stats: this.getStats(),
      };
    } catch (error) {
      this.logger.error("Cache health check failed", error as Error);
      return {
        status: "unhealthy",
        stats: this.getStats(),
      };
    }
  }

  /**
   * Clear all cache with dashboard prefix
   */
  async clear(): Promise<number> {
    return this.deletePattern("*");
  }

  /**
   * Build full cache key with prefix
   */
  private buildKey(key: string, prefix?: string): string {
    const keyPrefix = prefix || this.keyPrefix;
    return `${keyPrefix}${key}`;
  }

  /**
   * Cache wrapper function for expensive operations
   */
  async wrap<T>(
    key: string,
    fn: () => Promise<T>,
    ttl?: number,
    options?: CacheOptions
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      return cached;
    }

    // Execute the function and cache the result
    try {
      const result = await fn();
      await this.set(key, result, ttl, options);
      return result;
    } catch (error) {
      this.logger.error("Cache wrap function error", error as Error, { key });
      throw error;
    }
  }
}
