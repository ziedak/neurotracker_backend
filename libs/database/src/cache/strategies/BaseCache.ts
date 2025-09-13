// libs/cache/src/strategies/BaseCache.ts
import { createLogger } from "@libs/utils";
import {
  DEFAULT_CACHE_STATS,
  type CacheConfig,
  type CacheHealth,
  type CacheOperationResult,
  type CacheStats,
  type ICache,
} from "../interfaces/ICache";

export abstract class BaseCache<TConfig extends CacheConfig = CacheConfig>
  implements ICache
{
  protected readonly config: TConfig;
  protected stats: CacheStats = { ...DEFAULT_CACHE_STATS };
  protected logger = createLogger(this.constructor.name);

  constructor(config: Partial<TConfig> = {}) {
    this.config = { enable: true, defaultTTL: 3600, ...config } as TConfig;
  }

  // Common implementations
  async isEnabled(): Promise<boolean> {
    return Promise.resolve(this.config.enable);
  }
  getStats(): CacheStats {
    return { ...this.stats };
  }

  async get<T>(key: string): Promise<CacheOperationResult<T>> {
    const startTime = performance.now();
    this.stats.totalRequests++;
    if (!this.isEnabled())
      return {
        data: null,
        source: "miss",
        latency: performance.now() - startTime,
        compressed: false,
      };

    try {
      const result = await this.doGet<T>(key);
      if (result) {
        this.stats.Hits++;
        return { ...result, latency: performance.now() - startTime };
      }
      this.stats.Misses++;
    } catch (error) {
      this.logger.error(`Get error for key: ${key}`, error as Error);
    }
    return {
      data: null,
      source: "miss",
      latency: performance.now() - startTime,
      compressed: false,
    };
  }

  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      await this.doSet(key, data, ttl ?? this.config.defaultTTL);
    } catch (error) {
      this.logger.error(`Set error for key: ${key}`, error as Error);
    }
  }

  async invalidate(key: string): Promise<void> {
    this.stats.invalidations++;
    if (!this.isEnabled()) return;
    try {
      await this.doInvalidate(key);
    } catch (error) {
      this.logger.error(`Invalidate error for key: ${key}`, error as Error);
    }
  }

  async invalidatePattern(pattern: string): Promise<number> {
    if (!this.isEnabled()) return 0;
    try {
      return await this.doInvalidatePattern(pattern);
    } catch (error) {
      this.logger.error(
        `Invalidate pattern error for: ${pattern}`,
        error as Error
      );
      return 0;
    }
  }

  // Abstract methods for subclasses
  protected abstract doGet<T>(
    key: string
  ): Promise<CacheOperationResult<T> | null>;
  protected abstract doSet<T>(key: string, data: T, ttl: number): Promise<void>;
  protected abstract doInvalidate(key: string): Promise<void>;
  protected abstract doInvalidatePattern(pattern: string): Promise<number>;
  abstract healthCheck(): Promise<CacheHealth>;
}
