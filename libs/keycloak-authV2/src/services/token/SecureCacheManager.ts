/**
 * Token Cache Manager Service
 * Handles caching operations for token validation results
 */

import crypto from "crypto";
import { z } from "zod";
import { createLogger } from "@libs/utils";
import { CacheService } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";

// Zod schemas for validation
const CachePrefixSchema = z
  .string()
  .min(1, "Cache prefix must be non-empty")
  .max(50, "Cache prefix too long")
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Cache prefix must contain only alphanumeric characters, underscores, and hyphens"
  );

const TTLSchema = z
  .number()
  .int()
  .min(1, "TTL must be at least 1 second")
  .max(86400, "TTL cannot exceed 24 hours");

export interface CacheResult<T> {
  data?: T;
  hit: boolean;
  source?: string;
}

export class SecureCacheManager {
  private readonly logger = createLogger("SecureCacheManager");
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
  private generateSecureCacheKey(prefix: string, key: string): string {
    // For simple keys (userId:sessionId), avoid expensive hashing
    if (key.length <= 128 && /^[a-zA-Z0-9:_-]+$/.test(key)) {
      return `${prefix}:${key}`;
    }
    // For complex keys, use hashing to prevent collisions
    const hash = crypto.createHash("sha256").update(key).digest("hex");
    return `${prefix}:${hash}`;
  }

  /**
   * Get cached data with generic type support
   */
  async get<T>(prefix: string, key: string): Promise<CacheResult<T>> {
    if (!this.cacheService) {
      return { hit: false };
    }

    // Validate inputs
    try {
      CachePrefixSchema.parse(prefix);
      z.string().min(1).max(8192).parse(key);
    } catch (error) {
      this.logger.warn("Invalid cache get parameters", {
        prefix,
        keyLength: key.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return { hit: false };
    }

    try {
      const cacheKey = this.generateSecureCacheKey(prefix, key);
      const cachedResult = await this.cacheService.get<T>(cacheKey);

      if (cachedResult.data !== null && cachedResult.source !== "miss") {
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
   * Set cached data with generic type support
   */
  async set<T>(
    prefix: string,
    key: string,
    data: T,
    ttl: number
  ): Promise<void> {
    if (!this.cacheService || data === undefined) {
      return;
    }

    // Validate inputs
    try {
      CachePrefixSchema.parse(prefix);
      z.string().min(1).max(8192).parse(key);
      TTLSchema.parse(ttl);
    } catch (error) {
      this.logger.warn("Invalid cache set parameters", {
        prefix,
        keyLength: key.length,
        ttl,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    try {
      const cacheKey = this.generateSecureCacheKey(prefix, key);
      await this.cacheService.set(cacheKey, data, ttl);

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
   * Invalidate cached data
   */
  async invalidate(prefix: string, key: string): Promise<void> {
    if (!this.cacheService) {
      return;
    }

    // Validate inputs
    try {
      CachePrefixSchema.parse(prefix);
      z.string().min(1).max(8192).parse(key);
    } catch (error) {
      this.logger.warn("Invalid cache invalidate parameters", {
        prefix,
        keyLength: key.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    try {
      const cacheKey = this.generateSecureCacheKey(prefix, key);
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
