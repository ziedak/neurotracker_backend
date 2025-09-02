import { RedisClient } from "@libs/database";
import { ILogger } from "@libs/monitoring";
import { OptimizedRedisRateLimit, RateLimitResult } from "../redisRateLimit";
import { SharedScriptManager } from "./scriptManager";
import { LocalRateLimitCache } from "./localCache";
import { CompleteRateLimitConfig } from "../config/rateLimitConfig";

/**
 * Performance metrics for monitoring
 */
export interface PerformanceMetrics {
  totalRequests: number;
  cacheHits: number;
  cacheHitRate: number;
  avgResponseTime: number;
  redisConnections: number;
  scriptCacheHits: number;
  errorRate: number;
}

/**
 * Enhanced rate limiter with performance optimizations
 * - Shared script management across instances
 * - Local caching layer for frequent checks
 * - Connection pooling optimization
 * - Performance metrics collection
 */
export class PerformanceOptimizedRateLimit extends OptimizedRedisRateLimit {
  private readonly localCache: LocalRateLimitCache<RateLimitResult>;
  private readonly sharedScriptManager: SharedScriptManager;
  private readonly performanceMetrics: PerformanceMetrics;
  private cleanupInterval?: NodeJS.Timer;

  constructor(
    config: any, // Legacy config for compatibility
    redisClient: RedisClient,
    logger: ILogger,
    private readonly enableLocalCache: boolean = true,
    private readonly localCacheSize: number = 1000,
    private readonly localCacheTtlMs: number = 5000
  ) {
    super(config, redisClient, logger);

    this.sharedScriptManager = SharedScriptManager.getInstance();
    this.localCache = new LocalRateLimitCache<RateLimitResult>(
      this.localCacheSize,
      this.localCacheTtlMs,
      logger
    );

    this.performanceMetrics = {
      totalRequests: 0,
      cacheHits: 0,
      cacheHitRate: 0,
      avgResponseTime: 0,
      redisConnections: 0,
      scriptCacheHits: 0,
      errorRate: 0,
    };

    // Initialize shared scripts
    this.initializeSharedScripts();

    // Start cleanup interval for local cache
    if (this.enableLocalCache) {
      this.cleanupInterval = this.localCache.startCleanupInterval(30000);
    }
  }

  /**
   * Initialize shared script manager
   */
  private async initializeSharedScripts(): Promise<void> {
    try {
      await this.sharedScriptManager.initialize(this.redisClient, this.logger);
      this.logger.info(
        "Shared scripts initialized for performance optimization"
      );
    } catch (error) {
      this.logger.error("Failed to initialize shared scripts", error);
    }
  }

  /**
   * Enhanced rate limit check with caching
   */
  override async checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number
  ): Promise<RateLimitResult> {
    const startTime = Date.now();
    this.performanceMetrics.totalRequests++;

    try {
      // Check local cache first
      if (this.enableLocalCache) {
        const cacheKey = this.buildCacheKey(key, maxRequests, windowMs);
        const cachedResult = this.localCache.get(cacheKey);

        if (cachedResult && this.isCacheResultValid(cachedResult)) {
          this.performanceMetrics.cacheHits++;
          this.updatePerformanceMetrics(startTime, true);

          this.logger.debug("Cache hit for rate limit check", {
            key,
            cacheKey,
            cachedResult,
          });

          return cachedResult;
        }
      }

      // Perform Redis rate limit check
      const result = await super.checkRateLimit(key, maxRequests, windowMs);

      // Cache the result if enabled and allowed
      if (this.enableLocalCache && result.allowed) {
        const cacheKey = this.buildCacheKey(key, maxRequests, windowMs);
        const cacheTtl = this.calculateCacheTtl(result);
        this.localCache.set(cacheKey, result, cacheTtl);
      }

      this.updatePerformanceMetrics(startTime, false);
      return result;
    } catch (error) {
      this.updatePerformanceMetrics(startTime, false, true);
      throw error;
    }
  }

  /**
   * Build cache key for local caching
   */
  private buildCacheKey(
    key: string,
    maxRequests: number,
    windowMs: number
  ): string {
    return `${key}:${maxRequests}:${windowMs}`;
  }

  /**
   * Check if cached result is still valid
   */
  private isCacheResultValid(result: RateLimitResult): boolean {
    const now = Date.now();

    // Don't use cached result if it's close to reset time
    if (result.resetTime.getTime() - now < 1000) {
      return false;
    }

    // Don't use cached result for denied requests
    if (!result.allowed) {
      return false;
    }

    return true;
  }

  /**
   * Calculate appropriate cache TTL based on result
   */
  private calculateCacheTtl(result: RateLimitResult): number {
    const now = Date.now();
    const timeToReset = result.resetTime.getTime() - now;

    // Cache for shorter time if close to limit
    const utilizationRatio =
      (result.totalHits || 0) / (result.totalHits + result.remaining);

    if (utilizationRatio > 0.8) {
      return Math.min(this.localCacheTtlMs * 0.5, timeToReset * 0.3);
    }

    return Math.min(this.localCacheTtlMs, timeToReset * 0.5);
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(
    startTime: number,
    cacheHit: boolean,
    error: boolean = false
  ): void {
    const responseTime = Date.now() - startTime;

    // Update average response time using moving average
    this.performanceMetrics.avgResponseTime =
      (this.performanceMetrics.avgResponseTime *
        (this.performanceMetrics.totalRequests - 1) +
        responseTime) /
      this.performanceMetrics.totalRequests;

    if (cacheHit) {
      this.performanceMetrics.cacheHitRate =
        this.performanceMetrics.cacheHits /
        this.performanceMetrics.totalRequests;
    }

    if (error) {
      const totalErrors =
        this.performanceMetrics.totalRequests *
          this.performanceMetrics.errorRate +
        1;
      this.performanceMetrics.errorRate =
        totalErrors / this.performanceMetrics.totalRequests;
    }
  }

  /**
   * Get comprehensive performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics & {
    cacheStats: any;
    sharedScriptStats: any;
    redisHealth: any;
  } {
    const cacheStats = this.enableLocalCache
      ? this.localCache.getStats()
      : null;
    const sharedScriptStats = {
      initialized: this.sharedScriptManager.isInitialized(),
      availableScripts: this.sharedScriptManager.getAvailableScripts().length,
    };

    return {
      ...this.performanceMetrics,
      cacheStats,
      sharedScriptStats,
      redisHealth: super.getHealth(),
    };
  }

  /**
   * Warm up the cache with frequently accessed keys
   */
  async warmUpCache(
    keys: Array<{
      key: string;
      maxRequests: number;
      windowMs: number;
    }>
  ): Promise<void> {
    if (!this.enableLocalCache) {
      return;
    }

    const startTime = Date.now();
    this.logger.info("Starting cache warm-up", { keys: keys.length });

    const warmUpPromises = keys.map(async ({ key, maxRequests, windowMs }) => {
      try {
        const result = await super.checkRateLimit(key, maxRequests, windowMs);
        const cacheKey = this.buildCacheKey(key, maxRequests, windowMs);
        const cacheTtl = this.calculateCacheTtl(result);

        this.localCache.set(cacheKey, result, cacheTtl);
        return { success: true, key };
      } catch (error) {
        this.logger.warn("Cache warm-up failed for key", { key, error });
        return { success: false, key };
      }
    });

    const results = await Promise.all(warmUpPromises);
    const successful = results.filter((r) => r.success).length;
    const duration = Date.now() - startTime;

    this.logger.info("Cache warm-up completed", {
      totalKeys: keys.length,
      successful,
      duration,
      cacheSize: this.localCache.getStats().size,
    });
  }

  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    this.performanceMetrics.totalRequests = 0;
    this.performanceMetrics.cacheHits = 0;
    this.performanceMetrics.cacheHitRate = 0;
    this.performanceMetrics.avgResponseTime = 0;
    this.performanceMetrics.errorRate = 0;
  }

  /**
   * Get health status including performance metrics
   */
  override async getHealth(): Promise<any> {
    const baseHealth = await super.getHealth();
    const performanceMetrics = this.getPerformanceMetrics();

    return {
      ...baseHealth,
      performance: {
        enabled: true,
        localCache: {
          enabled: this.enableLocalCache,
          stats: performanceMetrics.cacheStats,
        },
        metrics: performanceMetrics,
        sharedScripts: performanceMetrics.sharedScriptStats,
      },
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval as any);
    }

    if (this.enableLocalCache) {
      this.localCache.clear();
    }

    this.logger.info("Performance optimized rate limiter destroyed");
  }

  /**
   * Factory method for creating performance-optimized instance
   */
  static createOptimized(
    config: any,
    redisClient: RedisClient,
    logger: ILogger,
    performanceConfig?: {
      enableLocalCache?: boolean;
      localCacheSize?: number;
      localCacheTtlMs?: number;
    }
  ): PerformanceOptimizedRateLimit {
    return new PerformanceOptimizedRateLimit(
      config,
      redisClient,
      logger,
      performanceConfig?.enableLocalCache ?? true,
      performanceConfig?.localCacheSize ?? 1000,
      performanceConfig?.localCacheTtlMs ?? 5000
    );
  }

  /**
   * Factory method using environment configuration
   */
  static createFromEnvironmentOptimized(
    environment: string,
    redisClient: RedisClient,
    logger: ILogger,
    customConfig?: Partial<CompleteRateLimitConfig>,
    performanceConfig?: {
      enableLocalCache?: boolean;
      localCacheSize?: number;
      localCacheTtlMs?: number;
    }
  ): PerformanceOptimizedRateLimit {
    // Create base instance using parent factory
    const baseInstance = OptimizedRedisRateLimit.createFromEnvironment(
      environment,
      redisClient,
      logger,
      customConfig
    );

    // Extract config and create optimized instance
    const config = (baseInstance as any)._config || {};

    return new PerformanceOptimizedRateLimit(
      config,
      redisClient,
      logger,
      performanceConfig?.enableLocalCache ?? true,
      performanceConfig?.localCacheSize ?? 1000,
      performanceConfig?.localCacheTtlMs ?? 5000
    );
  }
}
