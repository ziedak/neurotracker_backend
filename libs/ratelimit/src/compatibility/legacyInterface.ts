/**
 * Rate Limiting Interface Compatibility Layer
 *
 * Provides backward-compatible interfaces while migrating to enterprise cache adapter
 */

import {
  RateLimitResult as NewRateLimitResult,
  RateLimitAlgorithm as NewRateLimitAlgorithm,
  RateLimitingCacheAdapter,
} from "../adapters/RateLimitingCacheAdapter";

/**
 * Legacy rate limit result interface for backward compatibility
 */
export interface LegacyRateLimitResult {
  allowed: boolean;
  totalHits: number; // Maps to (limit - remaining)
  remaining: number;
  resetTime: Date; // Converted from timestamp
  retryAfter?: number;
  algorithm: string; // Converted from enum
  windowStart?: Date; // Calculated from resetTime and window
  windowEnd?: Date; // Set to resetTime
}

/**
 * Legacy configuration interface
 */
export interface LegacyRateLimitConfig {
  algorithm?: "sliding-window" | "token-bucket" | "fixed-window";
  redis?: {
    keyPrefix?: string;
    ttlBuffer?: number;
  };
  circuitBreaker?: {
    errorThreshold: number;
    timeout: number;
    resetTimeout: number;
  };
}

/**
 * Compatibility wrapper that provides legacy interface while using new adapter
 */
export class LegacyCompatibleRateLimit {
  constructor(
    private readonly adapter: RateLimitingCacheAdapter,
    private readonly defaultConfig: LegacyRateLimitConfig = {}
  ) {}

  /**
   * Legacy rate limit check with old interface
   */
  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowMs: number,
    algorithm?: string
  ): Promise<LegacyRateLimitResult> {
    // Map legacy algorithm string to new enum
    const newAlgorithm = this.mapAlgorithm(
      algorithm || this.defaultConfig.algorithm || "sliding-window"
    );

    // Use new adapter
    const newResult = await this.adapter.checkRateLimit(
      key,
      maxRequests,
      windowMs,
      newAlgorithm
    );

    // Convert new result to legacy format
    return this.convertToLegacyResult(newResult, windowMs);
  }

  /**
   * Map legacy algorithm string to new enum
   */
  private mapAlgorithm(algorithm: string): NewRateLimitAlgorithm {
    switch (algorithm) {
      case "sliding-window":
        return "sliding-window";
      case "token-bucket":
        return "token-bucket";
      case "fixed-window":
        return "fixed-window";
      default:
        return "sliding-window";
    }
  }

  /**
   * Convert new result format to legacy format
   */
  private convertToLegacyResult(
    newResult: NewRateLimitResult,
    windowMs: number
  ): LegacyRateLimitResult {
    const resetTime = new Date(newResult.resetTime);
    const windowStart = new Date(newResult.resetTime - windowMs);

    return {
      allowed: newResult.allowed,
      totalHits: newResult.limit - newResult.remaining, // Calculate current hits
      remaining: newResult.remaining,
      resetTime: new Date(newResult.resetTime),
      retryAfter: newResult.retryAfter ?? 0,
      algorithm: newResult.algorithm,
      windowStart: windowStart,
      windowEnd: resetTime,
    };
  }

  /**
   * Get adapter statistics (new feature)
   */
  getStats() {
    return this.adapter.getRateLimitingStats();
  }

  /**
   * Health check (new feature)
   */
  async getHealth() {
    return this.adapter.getHealth();
  }

  /**
   * Cleanup resources
   */
  async destroy() {
    return this.adapter.destroy();
  }
}

/**
 * Temporary export aliases for smooth migration
 */
export type RateLimitResult = LegacyRateLimitResult;
export type RateLimitConfig = LegacyRateLimitConfig;

/**
 * Factory function for creating legacy-compatible rate limiter
 */
export function createLegacyRateLimit(
  adapter: RateLimitingCacheAdapter,
  config?: LegacyRateLimitConfig
): LegacyCompatibleRateLimit {
  return new LegacyCompatibleRateLimit(adapter, config);
}
