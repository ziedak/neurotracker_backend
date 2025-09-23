/**
 * Token Cache Manager Service
 * Handles caching operations for token validation results
 */

import crypto from "crypto";
import { createLogger } from "@libs/utils";
import { CacheService } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult } from "../types";

export interface CacheResult<T> {
  data?: T;
  hit: boolean;
  source?: string;
}

export class TokenCacheManager {
  private readonly logger = createLogger("TokenCacheManager");
  private cacheService?: CacheService;

  constructor(
    cacheEnabled: boolean,
    private readonly metrics?: IMetricsCollector
  ) {
    if (cacheEnabled) {
      this.cacheService = CacheService.create(metrics);
    }
  }

  /**
   * Generate secure cache key to prevent collision attacks
   */
  private generateSecureCacheKey(prefix: string, token: string): string {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    return `${prefix}:${hash.slice(0, 32)}`;
  }

  /**
   * Get cached validation result
   */
  async get(prefix: string, token: string): Promise<CacheResult<AuthResult>> {
    if (!this.cacheService) {
      return { hit: false };
    }

    try {
      const cacheKey = this.generateSecureCacheKey(prefix, token);
      const cachedResult = await this.cacheService.get<AuthResult>(cacheKey);

      if (cachedResult.data && cachedResult.source !== "miss") {
        this.metrics?.recordCounter(`token_cache.${prefix}_hit`, 1);
        this.logger.debug("Cache hit", {
          prefix,
          cacheSource: cachedResult.source,
        });

        return {
          data: cachedResult.data,
          hit: true,
          source: cachedResult.source,
        };
      }

      return { hit: false };
    } catch (error) {
      this.logger.warn("Cache get failed", {
        prefix,
        error: error instanceof Error ? error.message : String(error),
      });
      return { hit: false };
    }
  }

  /**
   * Set cached validation result
   */
  async set(
    prefix: string,
    token: string,
    result: AuthResult,
    ttl: number
  ): Promise<void> {
    if (!this.cacheService || !result.success) {
      return;
    }

    try {
      const cacheKey = this.generateSecureCacheKey(prefix, token);
      await this.cacheService.set(cacheKey, result, ttl);

      this.metrics?.recordCounter(`token_cache.${prefix}_set`, 1);

      this.logger.debug("Cache set", {
        prefix,
        ttl,
      });
    } catch (error) {
      this.logger.warn("Cache set failed", {
        prefix,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Invalidate cached result
   */
  async invalidate(prefix: string, token: string): Promise<void> {
    if (!this.cacheService) {
      return;
    }

    try {
      const cacheKey = this.generateSecureCacheKey(prefix, token);
      await this.cacheService.invalidate(cacheKey);

      this.logger.debug("Cache invalidated", { prefix });
    } catch (error) {
      this.logger.warn("Cache invalidation failed", {
        prefix,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if caching is enabled
   */
  get isEnabled(): boolean {
    return !!this.cacheService;
  }
}
