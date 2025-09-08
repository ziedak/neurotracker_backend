/**

 * Phase 3.1.2: Enterprise-grade adapter combining cache library with rate limiting
 */

import {
  CacheOperationLockManager,
  CacheService,
  CacheConfigValidator,
} from "@libs/database";
import { createLogger } from "@libs/utils";
import type { RateLimitResult } from "../types";

/**
 * Rate limiting algorithms supported
 */
export type RateLimitAlgorithm =
  | "fixed-window"
  | "sliding-window"
  | "token-bucket"
  | "leaky-bucket";

/**
 * Rate limit request for batch operations
 */
export interface RateLimitRequest {
  identifier: string;
  limit: number;
  windowMs: number;
  algorithm?: RateLimitAlgorithm;
  weight?: number;
}

/**
 * Batch processing result
 */
export interface BatchRateLimitResult {
  results: RateLimitResult[];
  totalResponseTime: number;
  cacheHitRate: number;
  errorCount: number;
}

/**
 * Rate limiting statistics
 */
export interface RateLimitingStats {
  totalRequests: number;
  allowedRequests: number;
  blockedRequests: number;
  averageResponseTime: number;
  cacheHitRate: number;
  algorithmDistribution: Record<RateLimitAlgorithm, number>;
  memoryUsage: {
    currentMB: number;
    peakMB: number;
    utilizationPercent: number;
  };
}

/**
 * Configuration for rate limiting adapter
 */
export interface RateLimitingAdapterConfig {
  defaultAlgorithm: RateLimitAlgorithm;
  enableBatchProcessing: boolean;
  maxBatchSize: number;
  enableMetrics: boolean;
  enableCompression: boolean;
  compressionThreshold: number;
  keyPrefix: string;
  ttlBufferMs: number;
  lockTimeoutMs: number;
  enableCoherency: boolean;
}

/**
 * Default configuration optimized for rate limiting
 */
export const DEFAULT_RATE_LIMITING_ADAPTER_CONFIG: RateLimitingAdapterConfig = {
  defaultAlgorithm: "sliding-window",
  enableBatchProcessing: true,
  maxBatchSize: 100,
  enableMetrics: true,
  enableCompression: true,
  compressionThreshold: 1024,
  keyPrefix: "rl:",
  ttlBufferMs: 1000,
  lockTimeoutMs: 100,
  enableCoherency: true,
};

/**
 * Enterprise-grade rate limiting cache adapter
 * Combines cache library features with optimized rate limiting algorithms
 */
export class RateLimitingCacheAdapter {
  private readonly config: RateLimitingAdapterConfig;
  private readonly stats: RateLimitingStats;
  private readonly lockManager: CacheOperationLockManager;
  private readonly logger = createLogger("RateLimitingCacheAdapter");

  constructor(
    private readonly cacheService: CacheService,
    private readonly configValidator: CacheConfigValidator,

    config: Partial<RateLimitingAdapterConfig> = {}
  ) {
    this.config = { ...DEFAULT_RATE_LIMITING_ADAPTER_CONFIG, ...config };

    this.lockManager = new CacheOperationLockManager();

    // Initialize statistics
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      algorithmDistribution: {
        "fixed-window": 0,
        "sliding-window": 0,
        "token-bucket": 0,
        "leaky-bucket": 0,
      },
      memoryUsage: {
        currentMB: 0,
        peakMB: 0,
        utilizationPercent: 0,
      },
    };

    this.validateConfiguration();
    this.logger.info("RateLimitingCacheAdapter initialized", {
      config: this.config,
    });
  }

  /**
   * Check rate limit with enterprise cache features
   */
  async checkRateLimit(
    identifier: string,
    limit: number,
    windowMs: number,
    algorithm: RateLimitAlgorithm = this.config.defaultAlgorithm
  ): Promise<RateLimitResult> {
    const startTime = performance.now();
    const key = this.generateCacheKey(identifier, algorithm, windowMs);

    try {
      // Use lock manager to prevent race conditions
      const result = await this.lockManager.acquireLock(
        key,
        "rate-limit-check",
        async () => {
          return await this.executeRateLimitCheck(
            key,
            identifier,
            limit,
            windowMs,
            algorithm
          );
        },
        { timeout: this.config.lockTimeoutMs }
      );

      const responseTime = performance.now() - startTime;
      const completeResult = {
        ...result,
        responseTime,
      };
      this.updateStatistics(completeResult, responseTime, algorithm);

      return completeResult;
    } catch (error) {
      this.logger.error("Rate limit check failed", {
        identifier,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return safe default on error
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime: Date.now() + windowMs,
        algorithm,
        cached: false,
        responseTime: performance.now() - startTime,
        totalHits: 0,
        windowStart: Date.now(),
        windowEnd: Date.now() + windowMs,
      };
    }
  }

  /**
   * Batch rate limit checks for high performance
   */
  async checkMultipleRateLimits(
    requests: RateLimitRequest[]
  ): Promise<BatchRateLimitResult> {
    if (!this.config.enableBatchProcessing) {
      throw new Error("Batch processing is disabled");
    }

    if (requests.length > this.config.maxBatchSize) {
      throw new Error(
        `Batch size ${requests.length} exceeds maximum ${this.config.maxBatchSize}`
      );
    }

    const startTime = performance.now();
    const results: RateLimitResult[] = [];
    let cacheHits = 0;
    let errorCount = 0;

    // Process requests in parallel for maximum performance
    const batchPromises = requests.map(async (request) => {
      try {
        const result = await this.checkRateLimit(
          request.identifier,
          request.limit,
          request.windowMs,
          request.algorithm
        );

        if (result.cached) cacheHits++;
        return result;
      } catch (error) {
        errorCount++;
        this.logger.warn("Batch rate limit check failed", {
          identifier: request.identifier,
          error: error instanceof Error ? error.message : String(error),
        });

        return {
          allowed: false,
          limit: request.limit,
          remaining: 0,
          resetTime: Date.now() + request.windowMs,
          algorithm: request.algorithm || this.config.defaultAlgorithm,
          cached: false,
          responseTime: 0,
          totalHits: 0,
          windowStart: Date.now(),
          windowEnd: Date.now() + request.windowMs,
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    const totalResponseTime = performance.now() - startTime;
    const cacheHitRate = requests.length > 0 ? cacheHits / requests.length : 0;

    this.logger.debug("Batch rate limit check completed", {
      batchSize: requests.length,
      totalResponseTime,
      cacheHitRate,
      errorCount,
    });

    return {
      results,
      totalResponseTime,
      cacheHitRate,
      errorCount,
    };
  }

  /**
   * Execute the actual rate limit check with algorithm-specific logic
   */
  private async executeRateLimitCheck(
    key: string,
    _identifier: string, // Prefixed with _ to indicate intentionally unused
    limit: number,
    windowMs: number,
    algorithm: RateLimitAlgorithm
  ): Promise<Omit<RateLimitResult, "responseTime">> {
    switch (algorithm) {
      case "fixed-window":
        return await this.checkFixedWindow(key, limit, windowMs);

      case "sliding-window":
        return await this.checkSlidingWindow(key, limit, windowMs);

      case "token-bucket":
        return await this.checkTokenBucket(key, limit, windowMs);

      case "leaky-bucket":
        return await this.checkLeakyBucket(key, limit, windowMs);

      default:
        throw new Error(`Unsupported rate limiting algorithm: ${algorithm}`);
    }
  }

  /**
   * Fixed window algorithm implementation
   */
  private async checkFixedWindow(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<Omit<RateLimitResult, "responseTime">> {
    const windowKey = this.alignToFixedWindow(key, windowMs);
    const ttl = this.calculateOptimalTTL(windowMs);

    // Try to get current count from cache
    const cacheResult = await this.cacheService.get<number>(windowKey);
    const currentCount = cacheResult.data || 0;
    const cached = cacheResult.source !== "miss";

    if (currentCount >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime: this.getNextWindowStart(windowMs),
        algorithm: "fixed-window",
        cached,
        totalHits: currentCount,
        windowStart: Math.floor(Date.now() / windowMs) * windowMs,
        windowEnd: this.getNextWindowStart(windowMs),
      };
    }

    // Increment counter
    const newCount = currentCount + 1;
    await this.cacheService.set(windowKey, newCount, ttl);

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - newCount),
      resetTime: this.getNextWindowStart(windowMs),
      algorithm: "fixed-window",
      cached,
      totalHits: newCount,
      windowStart: Math.floor(Date.now() / windowMs) * windowMs,
      windowEnd: this.getNextWindowStart(windowMs),
    };
  }

  /**
   * Sliding window algorithm implementation with compression
   */
  private async checkSlidingWindow(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<Omit<RateLimitResult, "responseTime">> {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get sliding window data
    const cacheResult = await this.cacheService.get<number[]>(key);
    const slidingData = cacheResult.data || [];
    const cached = cacheResult.source !== "miss";

    // Filter entries within the sliding window
    const validEntries = slidingData.filter(
      (timestamp: number) => timestamp > windowStart
    );

    if (validEntries.length >= limit) {
      const resetTime =
        validEntries.length > 0
          ? (validEntries[0] || now) + windowMs
          : now + windowMs;
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime,
        algorithm: "sliding-window",
        cached,
        totalHits: validEntries.length,
        windowStart,
        windowEnd: Date.now() + windowMs,
      };
    }

    // Add current timestamp
    validEntries.push(now);

    // Store with standard cache API
    const ttl = this.calculateOptimalTTL(windowMs);
    await this.cacheService.set(key, validEntries, ttl);

    const resetTime =
      validEntries.length > 1
        ? (validEntries[0] || now) + windowMs
        : now + windowMs;
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - validEntries.length),
      resetTime,
      algorithm: "sliding-window",
      cached,
      totalHits: validEntries.length,
      windowStart,
      windowEnd: Date.now() + windowMs,
    };
  }

  /**
   * Token bucket algorithm implementation
   */
  private async checkTokenBucket(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<Omit<RateLimitResult, "responseTime">> {
    const now = Date.now();
    const refillRate = limit / windowMs; // tokens per millisecond

    // Get current bucket state
    const cacheResult = await this.cacheService.get<{
      tokens: number;
      lastRefill: number;
    }>(key);

    const bucketData = cacheResult.data || { tokens: limit, lastRefill: now };
    const cached = cacheResult.source !== "miss";

    // Calculate tokens to add since last refill
    const timePassed = now - bucketData.lastRefill;
    const tokensToAdd = Math.floor(timePassed * refillRate);
    const currentTokens = Math.min(limit, bucketData.tokens + tokensToAdd);

    if (currentTokens < 1) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime: Date.now() + Math.ceil((1 - currentTokens) / refillRate),
        retryAfter: Math.ceil((1 - currentTokens) / refillRate),
        algorithm: "token-bucket",
        cached,
        totalHits: limit - Math.floor(currentTokens),
        windowStart: Date.now() - windowMs,
        windowEnd: Date.now() + windowMs,
      };
    }

    // Consume one token
    const newTokens = currentTokens - 1;
    const ttl = this.calculateOptimalTTL(windowMs * 2); // Longer TTL for token buckets

    await this.cacheService.set(
      key,
      {
        tokens: newTokens,
        lastRefill: now,
      },
      ttl
    );

    return {
      allowed: true,
      limit,
      remaining: Math.floor(newTokens),
      resetTime: Date.now() + Math.ceil((limit - newTokens) / refillRate),
      algorithm: "token-bucket",
      cached,
      totalHits: limit - Math.floor(newTokens),
      windowStart: Date.now() - windowMs,
      windowEnd: Date.now() + windowMs,
    };
  }

  /**
   * Leaky bucket algorithm implementation
   */
  private async checkLeakyBucket(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<Omit<RateLimitResult, "responseTime">> {
    const now = Date.now();
    const leakRate = limit / windowMs; // requests per millisecond

    // Get current bucket state
    const cacheResult = await this.cacheService.get<{
      volume: number;
      lastLeak: number;
    }>(key);

    const bucketData = cacheResult.data || { volume: 0, lastLeak: now };
    const cached = cacheResult.source !== "miss";

    // Calculate volume reduction since last leak
    const timePassed = now - bucketData.lastLeak;
    const volumeReduction = timePassed * leakRate;
    const currentVolume = Math.max(0, bucketData.volume - volumeReduction);

    if (currentVolume >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime:
          Date.now() + Math.ceil((currentVolume - limit + 1) / leakRate),
        retryAfter: Math.ceil((currentVolume - limit + 1) / leakRate),
        algorithm: "leaky-bucket",
        cached,
        totalHits: Math.floor(currentVolume),
        windowStart: Date.now() - windowMs,
        windowEnd: Date.now() + windowMs,
      };
    }

    // Add request to bucket
    const newVolume = currentVolume + 1;
    const ttl = this.calculateOptimalTTL(windowMs * 2);

    await this.cacheService.set(
      key,
      {
        volume: newVolume,
        lastLeak: now,
      },
      ttl
    );

    return {
      allowed: true,
      limit,
      remaining: Math.floor(limit - newVolume),
      resetTime: Date.now() + Math.ceil(newVolume / leakRate),
      algorithm: "leaky-bucket",
      cached,
      totalHits: Math.floor(newVolume),
      windowStart: Date.now() - windowMs,
      windowEnd: Date.now() + windowMs,
    };
  }

  /**
   * Generate optimized cache key for rate limiting
   */
  private generateCacheKey(
    identifier: string,
    algorithm: RateLimitAlgorithm,
    windowMs: number
  ): string {
    const sanitizedId = identifier.replace(/[^a-zA-Z0-9_-]/g, "_");
    return `${this.config.keyPrefix}${algorithm}:${windowMs}:${sanitizedId}`;
  }

  /**
   * Align key to fixed window boundaries
   */
  private alignToFixedWindow(key: string, windowMs: number): string {
    const now = Date.now();
    const windowStart = Math.floor(now / windowMs) * windowMs;
    return `${key}:${windowStart}`;
  }

  /**
   * Calculate optimal TTL with buffer
   */
  private calculateOptimalTTL(windowMs: number): number {
    return windowMs + this.config.ttlBufferMs;
  }

  /**
   * Get next window start time
   */
  private getNextWindowStart(windowMs: number): number {
    const now = Date.now();
    return Math.ceil(now / windowMs) * windowMs;
  }

  /**
   * Update adapter statistics
   */
  private updateStatistics(
    result: RateLimitResult,
    responseTime: number,
    algorithm: RateLimitAlgorithm
  ): void {
    if (!this.config.enableMetrics) return;

    this.stats.totalRequests++;

    if (result.allowed) {
      this.stats.allowedRequests++;
    } else {
      this.stats.blockedRequests++;
    }

    if (result.cached) {
      const hitRate =
        (this.stats.cacheHitRate * (this.stats.totalRequests - 1) + 1) /
        this.stats.totalRequests;
      this.stats.cacheHitRate = hitRate;
    }

    // Update average response time
    this.stats.averageResponseTime =
      (this.stats.averageResponseTime * (this.stats.totalRequests - 1) +
        responseTime) /
      this.stats.totalRequests;

    // Update algorithm distribution
    this.stats.algorithmDistribution[algorithm]++;

    // Update memory usage (periodic)
    if (this.stats.totalRequests % 100 === 0) {
      this.updateMemoryStats();
    }
  }

  /**
   * Update memory usage statistics
   */
  private updateMemoryStats(): void {
    const stats = this.cacheService.getStats();
    this.stats.memoryUsage = {
      currentMB: stats.memoryUsage / (1024 * 1024), // Convert bytes to MB
      peakMB: Math.max(
        this.stats.memoryUsage.peakMB,
        stats.memoryUsage / (1024 * 1024)
      ),
      utilizationPercent: Math.min(
        100,
        (stats.memoryUsage / (50 * 1024 * 1024)) * 100
      ), // Assume 50MB max
    };
  }

  /**
   * Validate adapter configuration
   */
  private validateConfiguration(): void {
    const validation = this.configValidator.validateCacheConfig({
      defaultAlgorithm: this.config.defaultAlgorithm,
      enableBatchProcessing: this.config.enableBatchProcessing,
      maxBatchSize: this.config.maxBatchSize,
      compressionThreshold: this.config.compressionThreshold,
      lockTimeoutMs: this.config.lockTimeoutMs,
    });

    if (!validation.valid) {
      throw new Error(
        `Invalid rate limiting adapter configuration: ${validation.errors.join(
          ", "
        )}`
      );
    }

    if (validation.warnings.length > 0) {
      this.logger.warn("Rate limiting adapter configuration warnings", {
        warnings: validation.warnings,
      });
    }
  }

  /**
   * Reset rate limit for specific identifier
   */
  async resetRateLimit(
    identifier: string,
    algorithm?: RateLimitAlgorithm
  ): Promise<void> {
    const keyPattern = algorithm
      ? `${this.config.keyPrefix}${algorithm}:*:${identifier.replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        )}`
      : `${this.config.keyPrefix}*:${identifier.replace(
          /[^a-zA-Z0-9_-]/g,
          "_"
        )}`;

    await this.cacheService.invalidatePattern(keyPattern);

    this.logger.info("Rate limit reset", { identifier, algorithm });
  }

  /**
   * Warmup rate limiting keys for better performance
   */
  async warmupRateLimitKeys(identifiers: string[]): Promise<void> {
    const warmupPromises = identifiers.map(async (identifier) => {
      const key = this.generateCacheKey(
        identifier,
        this.config.defaultAlgorithm,
        60000
      );

      // Pre-populate with zero values to establish cache presence
      await this.cacheService.set(key, [], this.calculateOptimalTTL(60000));
    });

    await Promise.all(warmupPromises);

    this.logger.info("Rate limit keys warmed up", {
      count: identifiers.length,
    });
  }

  /**
   * Get comprehensive adapter statistics
   */
  getRateLimitingStats(): RateLimitingStats {
    this.updateMemoryStats();
    return { ...this.stats };
  }

  /**
   * Get cache service health status
   */
  async getHealth(): Promise<{
    healthy: boolean;
    cacheServiceHealth: any;
    adapterStats: RateLimitingStats;
  }> {
    const cacheHealth = await this.cacheService.healthCheck();
    const adapterStats = this.getRateLimitingStats();

    return {
      healthy:
        cacheHealth.status === "healthy" &&
        adapterStats.memoryUsage.utilizationPercent < 90,
      cacheServiceHealth: cacheHealth,
      adapterStats,
    };
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    // Cleanup the lock manager and its background timers
    this.lockManager.destroy();

    this.logger.info("RateLimitingCacheAdapter destroyed");
  }
}
