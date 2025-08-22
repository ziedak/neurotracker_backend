/**
 * @fileoverview Simple Rate Limit Manager - Minimal Implementation
 * @module services/auth/SimpleRateLimitManager
 * @version 1.0.0
 */

import { ICacheService } from "../../contracts/services";
import { RateLimitError } from "../../errors/core";

/**
 * Simple rate limit manager with basic rate limiting
 */
export class SimpleRateLimitManager {
  private readonly cacheService: ICacheService;
  private readonly maxAttempts = 5;
  private readonly windowMs = 900000; // 15 minutes

  constructor(cacheService: ICacheService) {
    this.cacheService = cacheService;
  }

  /**
   * Enforce rate limiting for authentication attempts
   */
  async enforceRateLimit(identifier: string, method: string): Promise<void> {
    const key = `rate_limit:${method}:${identifier}`;

    try {
      const attemptsData = await this.cacheService.get(key);
      const attempts = typeof attemptsData === "number" ? attemptsData : 0;

      if (attempts >= this.maxAttempts) {
        const retryAfter = Math.ceil(this.windowMs / 1000); // Convert to seconds
        throw new RateLimitError(
          retryAfter,
          this.maxAttempts,
          0,
          new Date(Date.now() + this.windowMs),
          { identifier, method, attempts }
        );
      }

      // Increment attempts
      await this.cacheService.set(
        key,
        attempts + 1,
        Math.floor(this.windowMs / 1000)
      );
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw error;
      }
      // If cache fails, allow the request to continue
      console.warn("Rate limiting cache error:", error);
    }
  }

  /**
   * Clear rate limits for a user (for admin functions)
   */
  async clearRateLimits(identifier: string): Promise<void> {
    try {
      const patterns = [
        `rate_limit:password:${identifier}`,
        `rate_limit:apikey:${identifier}`,
        `rate_limit:jwt:${identifier}`,
      ];

      await Promise.all(
        patterns.map((pattern) => this.cacheService.delete(pattern))
      );
    } catch (error) {
      console.warn("Failed to clear rate limits:", error);
    }
  }
}
