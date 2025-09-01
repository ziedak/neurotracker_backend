/**
 * Cache Warming Manager
 * Orchestrates multiple cache warming strategies
 */

import { type ILogger } from "@libs/monitoring";
import { inject } from "@libs/utils";
import type {
  ICache,
  CacheWarmingConfig,
  CacheWarmingResult,
  WarmupDataProvider,
} from "../interfaces/ICache";
import { StaticCacheWarmingStrategy } from "./StaticCacheWarmingStrategy";
import { AdaptiveCacheWarmingStrategy } from "./AdaptiveCacheWarmingStrategy";
import { BackgroundCacheWarmingStrategy } from "./BackgroundCacheWarmingStrategy";

/**
 * Manager for cache warming strategies
 */
export class CacheWarmingManager {
  private strategies: Map<string, any> = new Map();
  private backgroundStrategy?: BackgroundCacheWarmingStrategy;

  constructor(
    @inject("ILogger") private readonly logger: ILogger,
    private readonly config: CacheWarmingConfig = {}
  ) {
    this.logger = logger.child({ service: "CacheWarmingManager" });
    this.initializeStrategies();
  }

  /**
   * Initialize warming strategies
   */
  private initializeStrategies(): void {
    // Static strategy for predefined keys
    this.strategies.set("static", new StaticCacheWarmingStrategy(this.logger));

    // Adaptive strategy for learning from access patterns
    if (this.config.adaptiveWarming !== false) {
      this.strategies.set(
        "adaptive",
        new AdaptiveCacheWarmingStrategy(this.logger)
      );
    }

    // Background strategy for periodic warming
    if (this.config.enableBackgroundWarming) {
      this.backgroundStrategy = new BackgroundCacheWarmingStrategy(
        this.logger,
        this.config.backgroundWarmingInterval || 300
      );
      this.strategies.set("background", this.backgroundStrategy);
    }
  }

  /**
   * Warm up cache using specified strategy
   */
  async warmup(
    cache: ICache,
    provider: WarmupDataProvider,
    strategyName: string = "static"
  ): Promise<CacheWarmingResult> {
    const strategy = this.strategies.get(strategyName);

    if (!strategy) {
      const error = `Unknown warming strategy: ${strategyName}`;
      this.logger.error(error);
      return {
        success: false,
        keysProcessed: 0,
        keysFailed: 0,
        duration: 0,
        errors: [error],
      };
    }

    this.logger.info("Starting cache warmup", { strategy: strategyName });
    const result = await strategy.warmup(cache, provider);

    this.logger.info("Cache warmup completed", {
      strategy: strategyName,
      success: result.success,
      keysProcessed: result.keysProcessed,
      duration: Math.round(result.duration),
    });

    return result;
  }

  /**
   * Warm up cache using all available strategies
   */
  async warmupAll(
    cache: ICache,
    provider: WarmupDataProvider
  ): Promise<Map<string, CacheWarmingResult>> {
    const results = new Map<string, CacheWarmingResult>();

    for (const [name, strategy] of this.strategies.entries()) {
      try {
        const result = await strategy.warmup(cache, provider);
        results.set(name, result);
      } catch (error) {
        this.logger.error(`Strategy ${name} failed`, error as Error);
        results.set(name, {
          success: false,
          keysProcessed: 0,
          keysFailed: 0,
          duration: 0,
          errors: [error instanceof Error ? error.message : String(error)],
        });
      }
    }

    return results;
  }

  /**
   * Start background warming
   */
  startBackgroundWarming(cache: ICache, provider: WarmupDataProvider): void {
    if (this.backgroundStrategy) {
      this.backgroundStrategy.startBackgroundWarming(cache, provider);
    } else {
      this.logger.warn("Background warming not enabled");
    }
  }

  /**
   * Stop background warming
   */
  stopBackgroundWarming(): void {
    if (this.backgroundStrategy) {
      this.backgroundStrategy.stopBackgroundWarming();
    }
  }

  /**
   * Record access pattern for adaptive learning
   */
  recordAccess(key: string, latency: number): void {
    const adaptiveStrategy = this.strategies.get(
      "adaptive"
    ) as AdaptiveCacheWarmingStrategy;
    if (adaptiveStrategy) {
      adaptiveStrategy.recordAccess(key, latency);
    }
  }

  /**
   * Get recommended keys from all strategies
   */
  getRecommendedKeys(): Map<string, string[]> {
    const recommendations = new Map<string, string[]>();

    for (const [name, strategy] of this.strategies.entries()) {
      const keys = strategy.getRecommendedKeys();
      if (keys.length > 0) {
        recommendations.set(name, keys);
      }
    }

    return recommendations;
  }

  /**
   * Get warming statistics
   */
  getStats(): {
    strategies: string[];
    backgroundStatus?: any;
    adaptiveStats?: any;
  } {
    const stats: any = {
      strategies: Array.from(this.strategies.keys()),
    };

    if (this.backgroundStrategy) {
      stats.backgroundStatus = this.backgroundStrategy.getStatus();
    }

    const adaptiveStrategy = this.strategies.get(
      "adaptive"
    ) as AdaptiveCacheWarmingStrategy;
    if (adaptiveStrategy) {
      stats.adaptiveStats = adaptiveStrategy.getAccessPatternStats();
    }

    return stats;
  }
}
