/**
 * Background Cache Warming Strategy
 * Runs cache warming in the background at regular intervals
 */

import { type ILogger } from "@libs/monitoring";
import { inject } from "@libs/utils";
import type {
  ICache,
  CacheWarmingResult,
  WarmupDataProvider,
} from "../interfaces/ICache";
import { BaseCacheWarmingStrategy } from "./BaseCacheWarmingStrategy";

/**
 * Background warming strategy that runs periodically
 */
export class BackgroundCacheWarmingStrategy extends BaseCacheWarmingStrategy {
  readonly name = "Background";

  private intervalId?: NodeJS.Timeout;
  private readonly intervalSeconds: number;
  private readonly maxConcurrentWarmups: number;
  private activeWarmups: number = 0;

  constructor(
    @inject("ILogger") logger: ILogger,
    intervalSeconds: number = 300, // 5 minutes
    maxConcurrentWarmups: number = 1
  ) {
    super(logger);
    this.intervalSeconds = intervalSeconds;
    this.maxConcurrentWarmups = maxConcurrentWarmups;
  }

  async warmup(
    cache: ICache,
    provider: WarmupDataProvider
  ): Promise<CacheWarmingResult> {
    if (this.activeWarmups >= this.maxConcurrentWarmups) {
      this.logger.warn("Maximum concurrent warmups reached, skipping", {
        active: this.activeWarmups,
        max: this.maxConcurrentWarmups,
      });

      return {
        success: false,
        keysProcessed: 0,
        keysFailed: 0,
        duration: 0,
        errors: ["Maximum concurrent warmups reached"],
      };
    }

    this.activeWarmups++;
    const keys = await provider.getWarmupKeys().catch(() => []);

    try {
      const result = await this.executeWarmup(cache, provider, keys);
      return result;
    } finally {
      this.activeWarmups--;
    }
  }

  getRecommendedKeys(): string[] {
    // Background strategy recommends keys based on warming frequency and patterns
    // These are commonly warmed keys across different data providers
    return [
      "system:config",
      "app:settings",
      "cache:metadata",
      "performance:metrics",
      "user:defaults",
      "session:config",
    ];
  }

  /**
   * Start background warming
   */
  startBackgroundWarming(cache: ICache, provider: WarmupDataProvider): void {
    if (this.intervalId) {
      this.logger.warn("Background warming already running");
      return;
    }

    this.logger.info("Starting background cache warming", {
      intervalSeconds: this.intervalSeconds,
    });

    this.intervalId = setInterval(async () => {
      try {
        await this.warmup(cache, provider);
      } catch (error) {
        this.logger.error("Background warmup failed", error as Error);
      }
    }, this.intervalSeconds * 1000);
  }

  /**
   * Stop background warming
   */
  stopBackgroundWarming(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined as any;
      this.logger.info("Stopped background cache warming");
    }
  }

  /**
   * Check if background warming is running
   */
  isRunning(): boolean {
    return this.intervalId !== undefined;
  }

  /**
   * Get background warming status
   */
  getStatus(): {
    isRunning: boolean;
    intervalSeconds: number;
    activeWarmups: number;
    maxConcurrentWarmups: number;
  } {
    return {
      isRunning: this.isRunning(),
      intervalSeconds: this.intervalSeconds,
      activeWarmups: this.activeWarmups,
      maxConcurrentWarmups: this.maxConcurrentWarmups,
    };
  }
}
