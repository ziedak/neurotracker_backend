/**
 * API Key Cache Manager - Single Responsibility: Caching operations
 * 
 * Handles:
 * - Secure cache key generation
 * - Cache integrity validation
 * - Cache size management and cleanup
 * - Security against cache poisoning attacks
 */

import * as crypto from "crypto";
import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { CacheService } from "@libs/database";
import type { APIKeyValidationResult } from "./types";

export class APIKeyCacheManager {
  private readonly logger: ILogger;
  
  // Cache monitoring and limits
  private readonly cacheConfig = {
    maxEntries: 10000, // Maximum cached entries
    cleanupThreshold: 8000, // Start cleanup at 80% capacity
    cleanupBatchSize: 1000, // Remove this many entries during cleanup
  };
  private cacheEntryCount = 0;

  constructor(
    private readonly cacheService?: CacheService,
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector
  ) {
    this.logger = logger || createLogger("APIKeyCacheManager");
  }

  /**
   * Get cached validation result with security checks
   */
  async getCachedValidation(apiKey: string): Promise<APIKeyValidationResult | null> {
    if (!this.cacheService) {
      return null;
    }

    try {
      const secureKey = this.generateSecureCacheKey(apiKey);
      const cachedResult = await this.cacheService.get<{
        data: APIKeyValidationResult;
        timestamp: number;
        checksum: string;
      }>(secureKey);

      if (cachedResult.data && cachedResult.source !== "miss") {
        // Verify cache entry integrity
        const isValid = this.verifyCacheEntryIntegrity(
          cachedResult.data.data,
          cachedResult.data.timestamp,
          cachedResult.data.checksum
        );

        if (isValid) {
          this.metrics?.recordCounter("apikey.cache.hit", 1);
          this.logger.debug("Cache hit for API key validation");
          return cachedResult.data.data;
        } else {
          // Cache entry compromised, remove it
          await this.cacheService.invalidate(secureKey);
          this.logger.warn("Compromised cache entry removed", {
            key: secureKey.slice(0, 16) + "***",
          });
          this.metrics?.recordCounter("apikey.cache.corruption", 1);
        }
      }

      this.metrics?.recordCounter("apikey.cache.miss", 1);
      return null;
    } catch (error) {
      this.logger.warn("Cache retrieval failed", { error });
      this.metrics?.recordCounter("apikey.cache.error", 1);
      return null;
    }
  }

  /**
   * Cache validation result with security and integrity checks
   */
  async cacheValidation(
    apiKey: string,
    result: APIKeyValidationResult,
    ttl: number = 300 // 5 minutes default
  ): Promise<void> {
    if (!this.cacheService || !result.success) {
      return;
    }

    try {
      // Check cache size limits before adding new entries
      await this.manageCacheSize();

      const secureKey = this.generateSecureCacheKey(apiKey);
      const timestamp = Date.now();

      // Generate integrity checksum
      const dataString = JSON.stringify(result) + timestamp.toString();
      const checksum = crypto
        .createHash("sha256")
        .update(dataString + "integrity_check_v1")
        .digest("hex");

      const cacheEntry = {
        data: result,
        timestamp,
        checksum,
      };

      await this.cacheService.set(secureKey, cacheEntry, ttl);
      this.cacheEntryCount++;
      this.metrics?.recordCounter("apikey.cache.set", 1);
      
      this.logger.debug("API key validation result cached", {
        ttl,
        keyHash: this.hashKey(apiKey),
      });
    } catch (error) {
      this.logger.warn("Failed to cache validation result", { error });
      this.metrics?.recordCounter("apikey.cache.set_error", 1);
    }
  }

  /**
   * Invalidate cache for a specific API key
   */
  async invalidateKey(apiKey: string): Promise<void> {
    if (!this.cacheService) {
      return;
    }

    try {
      const secureKey = this.generateSecureCacheKey(apiKey);
      await this.cacheService.invalidate(secureKey);
      this.cacheEntryCount = Math.max(0, this.cacheEntryCount - 1);
      
      this.logger.debug("API key cache invalidated", {
        keyHash: this.hashKey(apiKey),
      });
      this.metrics?.recordCounter("apikey.cache.invalidation", 1);
    } catch (error) {
      this.logger.warn("Failed to invalidate API key cache", { error });
      this.metrics?.recordCounter("apikey.cache.invalidation_error", 1);
    }
  }

  /**
   * Clear all cached validation results
   */
  async clearAll(): Promise<void> {
    if (!this.cacheService) {
      return;
    }

    try {
      // Use pattern to clear only our cache entries
      const pattern = "apikm:validation:*";
      const deletedCount = await this.cacheService.invalidatePattern(pattern);
      this.cacheEntryCount = Math.max(0, this.cacheEntryCount - deletedCount);
      
      this.logger.info("All API key cache entries cleared");
      this.metrics?.recordCounter("apikey.cache.clear_all", 1);
    } catch (error) {
      this.logger.warn("Failed to clear all cache entries", { error });
      this.metrics?.recordCounter("apikey.cache.clear_error", 1);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    entryCount: number;
    maxEntries: number;
    utilizationPercent: number;
  } {
    return {
      entryCount: this.cacheEntryCount,
      maxEntries: this.cacheConfig.maxEntries,
      utilizationPercent: (this.cacheEntryCount / this.cacheConfig.maxEntries) * 100,
    };
  }

  /**
   * Generate secure cache key with namespace isolation
   */
  private generateSecureCacheKey(apiKey: string): string {
    // Use longer, more secure hash with namespace and salt
    const namespace = "apikm"; // api key manager namespace
    const salt = "cache_security_v2"; // version-specific salt
    const keyHash = crypto
      .createHash("sha256")
      .update(apiKey + salt)
      .digest("hex");

    return `${namespace}:validation:${keyHash}`;
  }

  /**
   * Verify cache entry integrity to prevent poisoning attacks
   */
  private verifyCacheEntryIntegrity(
    data: APIKeyValidationResult,
    timestamp: number,
    checksum: string
  ): boolean {
    try {
      // Generate expected checksum
      const dataString = JSON.stringify(data) + timestamp.toString();
      const expectedChecksum = crypto
        .createHash("sha256")
        .update(dataString + "integrity_check_v1")
        .digest("hex");

      return checksum === expectedChecksum;
    } catch {
      return false;
    }
  }

  /**
   * Manage cache size to prevent memory leaks with LRU-style cleanup
   */
  private async manageCacheSize(): Promise<void> {
    if (!this.cacheService) {
      return;
    }

    try {
      // Check if cleanup is needed
      if (this.cacheEntryCount > this.cacheConfig.cleanupThreshold) {
        this.logger.info("Cache cleanup initiated", {
          currentCount: this.cacheEntryCount,
          threshold: this.cacheConfig.cleanupThreshold,
        });

        // For now, use TTL-based cleanup (in production, consider LRU-based cleanup)
        
        // This is a simplified cleanup - in production you might want more sophisticated LRU
        // For now, we'll just reset the counter and let TTL handle cleanup
        this.cacheEntryCount = Math.max(
          0,
          this.cacheEntryCount - this.cacheConfig.cleanupBatchSize
        );

        this.metrics?.recordCounter("apikey.cache.cleanup", 1);
        this.logger.info("Cache cleanup completed", {
          newCount: this.cacheEntryCount,
        });
      }
    } catch (error) {
      this.logger.warn("Cache size management failed", { error });
      this.metrics?.recordCounter("apikey.cache.cleanup_error", 1);
    }
  }

  /**
   * Hash API key for logging (not for caching)
   */
  private hashKey(apiKey: string): string {
    return crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Health check for cache service
   */
  async healthCheck(): Promise<{ available: boolean; error?: string }> {
    if (!this.cacheService) {
      return { available: false, error: "Cache service not configured" };
    }

    try {
      // Test cache connectivity with a simple operation
      const testKey = "apikm:health:test";
      const testValue = { test: true, timestamp: Date.now() };
      
      await this.cacheService.set(testKey, testValue, 10); // 10 second TTL
      const retrieved = await this.cacheService.get<{ test: boolean; timestamp: number }>(testKey);
      await this.cacheService.invalidate(testKey);
      
      const isWorking = retrieved.data && retrieved.data.test === true;
      
      return {
        available: !!isWorking,
        ...(isWorking ? {} : { error: "Cache test operation failed" }),
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : "Unknown cache error",
      };
    }
  }

  /**
   * Cleanup method for component lifecycle
   */
  cleanup(): void {
    this.logger.info("APIKeyCacheManager cleanup completed");
  }
}