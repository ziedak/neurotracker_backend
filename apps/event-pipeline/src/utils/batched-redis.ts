import { RedisClient } from "@libs/database";
import { Logger } from "@libs/monitoring";

/**
 * Optimized batch operations for Redis
 * Reduces network overhead by grouping operations
 */
export class BatchedRedisOperations {
  private redis: any;
  private logger: Logger;

  constructor(redisClient?: any) {
    this.redis = redisClient || RedisClient.getInstance();
    this.logger = Logger.getInstance("BatchedRedisOperations");
  }

  /**
   * Batch duplicate check for multiple events
   * Returns array of boolean values indicating duplicates
   */
  async batchDuplicateCheck(eventKeys: string[]): Promise<boolean[]> {
    if (eventKeys.length === 0) return [];

    try {
      const pipeline = this.redis.pipeline();

      // Add all exists commands to pipeline
      eventKeys.forEach((key) => {
        pipeline.exists(key);
      });

      const results = await pipeline.exec();

      // Extract boolean results
      const duplicates = results.map((result: any) => {
        const [error, value] = result;
        if (error) {
          this.logger.warn("Redis exists check failed", {
            error: error.message,
          });
          return false; // Assume not duplicate on error
        }
        return value === 1;
      });

      this.logger.debug("Batch duplicate check completed", {
        totalKeys: eventKeys.length,
        duplicatesFound: duplicates.filter((d: boolean) => d).length,
      });

      return duplicates;
    } catch (error) {
      this.logger.error("Batch duplicate check failed", error as Error);
      // Return all false on error (assume no duplicates)
      return new Array(eventKeys.length).fill(false);
    }
  }

  /**
   * Batch cache events for deduplication
   * Sets multiple event keys with expiration
   */
  async batchCacheEvents(
    eventData: Array<{ key: string; value: string; ttl?: number }>
  ): Promise<void> {
    if (eventData.length === 0) return;

    try {
      const pipeline = this.redis.pipeline();

      // Add all setex commands to pipeline
      eventData.forEach(({ key, value, ttl = 3600 }) => {
        pipeline.setex(key, ttl, value);
      });

      await pipeline.exec();

      this.logger.debug("Batch cache completed", {
        totalEvents: eventData.length,
      });
    } catch (error) {
      this.logger.error("Batch cache failed", error as Error);
      throw error;
    }
  }

  /**
   * Batch operations for complete event processing
   * Combines duplicate check and caching in optimal way
   */
  async batchProcessEvents(
    events: Array<{
      key: string;
      value: string;
      ttl?: number;
    }>
  ): Promise<Array<{ key: string; isDuplicate: boolean; cached: boolean }>> {
    if (events.length === 0) return [];

    const eventKeys = events.map((e) => e.key);

    // First, check for duplicates
    const duplicates = await this.batchDuplicateCheck(eventKeys);

    // Prepare events to cache (non-duplicates only)
    const eventsToCache = events.filter((_, index) => !duplicates[index]);

    // Cache non-duplicate events
    if (eventsToCache.length > 0) {
      await this.batchCacheEvents(eventsToCache);
    }

    // Return results
    return events.map((event, index) => ({
      key: event.key,
      isDuplicate: duplicates[index],
      cached: !duplicates[index],
    }));
  }

  /**
   * Get multiple values efficiently
   */
  async batchGet(keys: string[]): Promise<Array<string | null>> {
    if (keys.length === 0) return [];

    try {
      return await this.redis.mget(...keys);
    } catch (error) {
      this.logger.error("Batch get failed", error as Error);
      return new Array(keys.length).fill(null);
    }
  }

  /**
   * Set multiple key-value pairs efficiently
   */
  async batchSet(keyValuePairs: Record<string, string>): Promise<void> {
    const entries = Object.entries(keyValuePairs);
    if (entries.length === 0) return;

    try {
      const pipeline = this.redis.pipeline();

      entries.forEach(([key, value]) => {
        pipeline.set(key, value);
      });

      await pipeline.exec();
    } catch (error) {
      this.logger.error("Batch set failed", error as Error);
      throw error;
    }
  }
}
