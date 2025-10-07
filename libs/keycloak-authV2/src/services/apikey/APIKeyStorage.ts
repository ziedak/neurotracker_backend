/**
 * APIKeyStorage - Consolidated API key storage operations
 *
 * This consolidated component replaces:
 * - APIKeyRepository.ts - Database operations and persistence
 * - APIKeyCacheManager.ts - Caching operations and cache management
 *
 * Responsibilities:
 * - Unified      // Use repository to update the API key
      const updatedApiKey = await this.apiKeyRepository.updateById(id, updates);with cache-through pattern
 * - Database operations for API keys (CRUD operations)
 * - Cache operations with security and integrity validation
 * - Transaction management and data consistency
 * - Cache invalidation and cleanup strategies
 * - Storage performance monitoring and optimization
 *
 * SOLID Principles:
 * - Single Responsibility: Handles all API key storage concerns (DB + Cache)
 * - Open/Closed: Extensible for new storage backends and cache strategies
 * - Liskov Substitution: Implements standard storage interfaces
 * - Interface Segregation: Clean separation between DB and cache operations
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import * as crypto from "crypto";
import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { CacheService } from "@libs/database";
import type {
  ApiKey,
  ApiKeyCreateInput,
  ApiKeyUpdateInput,
} from "@libs/database";
import { ApiKeyCreateInputSchema } from "@libs/database";
import type { IApiKeyRepository } from "@libs/database/src/postgress/repositories/apiKey";
import { APIKeyManagerStats } from "./types";

// ==================== INTERFACES ====================

export interface APIKeyStorageConfig {
  // Database config
  readonly enableTransactions: boolean;
  readonly queryTimeout: number;
  readonly retryAttempts: number;
  readonly retryDelay: number;

  // Cache config
  readonly enableCache: boolean;
  readonly cacheTtl: number; // seconds
  readonly maxCacheEntries: number;
  readonly cleanupThreshold: number; // percentage (0-100)
  readonly cleanupBatchSize: number;

  // Security config
  readonly enableCacheIntegrity: boolean;
  readonly maxKeyLength: number;
  readonly enableAuditLogging: boolean;
}

export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  fromCache?: boolean;
  executionTime?: number;
}

export interface CacheStats {
  totalEntries: number;
  hitRate: number;
  missRate: number;
  evictions: number;
  errors: number;
  lastCleanup: Date | null;
  memoryUsage: number; // approximate bytes
}

export interface BulkOperationResult {
  totalProcessed: number;
  successful: number;
  failed: number;
  errors: string[];
  executionTime: number;
}

// ==================== DEFAULT CONFIGURATION ====================

const DEFAULT_STORAGE_CONFIG: APIKeyStorageConfig = {
  // Database
  enableTransactions: true,
  queryTimeout: 5000, // 5 seconds
  retryAttempts: 3,
  retryDelay: 1000, // 1 second

  // Cache
  enableCache: true,
  cacheTtl: 300, // 5 minutes
  maxCacheEntries: 10000,
  cleanupThreshold: 80, // 80%
  cleanupBatchSize: 1000,

  // Security
  enableCacheIntegrity: true,
  maxKeyLength: 500,
  enableAuditLogging: true,
};

/**
 * Consolidated API key storage handling database and cache operations
 */
export class APIKeyStorage {
  private readonly logger: ILogger;
  private readonly config: APIKeyStorageConfig;
  private cacheEntryCount = 0;
  private cacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    errors: 0,
    lastCleanup: null as Date | null,
  };

  constructor(
    private readonly apiKeyRepository: IApiKeyRepository,
    private readonly cacheService?: CacheService,
    private readonly metrics?: IMetricsCollector,
    logger?: ILogger,
    config?: Partial<APIKeyStorageConfig>
  ) {
    this.logger = logger || createLogger("APIKeyStorage");
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
  }

  // ==================== DATABASE OPERATIONS ====================

  /**
   * Create new API key in database with cache invalidation
   */
  async createAPIKey(keyData: ApiKey): Promise<StorageResult<ApiKey>> {
    const startTime = performance.now();

    try {
      // Validate key data using Zod schema
      this.validateKeyData(keyData);

      // Convert to repository input format
      const createInput = {
        id: keyData.id,
        name: keyData.name,
        keyHash: keyData.keyHash,
        keyIdentifier: keyData.keyIdentifier,
        keyPreview: keyData.keyPreview,
        userId: keyData.userId,
        storeId: keyData.storeId || undefined,
        permissions: keyData.permissions || undefined,
        scopes: keyData.scopes,
        lastUsedAt: keyData.lastUsedAt || undefined,
        usageCount: keyData.usageCount,
        isActive: keyData.isActive,
        expiresAt: keyData.expiresAt || undefined,
        revokedAt: keyData.revokedAt || undefined,
        revokedBy: keyData.revokedBy || undefined,
        metadata: keyData.metadata || undefined,
      } as ApiKeyCreateInput;

      // Create using repository
      const createdKey = await this.apiKeyRepository.create(createInput);

      // Invalidate related cache entries
      if (this.config.enableCache) {
        await this.invalidateUserCache(keyData.userId);
      }

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer("apikey.storage.create_success", executionTime);
      this.logger.info("API key created successfully", {
        keyId: keyData.id,
        userId: keyData.userId,
        executionTime,
      });

      return {
        success: true,
        data: createdKey,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.metrics?.recordCounter("apikey.storage.create_failure");
      this.logger.error("Failed to create API key", {
        keyId: keyData.id,
        error,
        executionTime,
      });

      return {
        success: false,
        error: this.normalizeError(error),
        executionTime,
      };
    }
  }

  /**
   * Retrieve API key by ID with cache-through pattern
   */
  async getAPIKeyById(keyId: string): Promise<StorageResult<ApiKey>> {
    const startTime = performance.now();

    try {
      // Check cache first if enabled
      if (this.config.enableCache) {
        const cached = await this.getCachedKey(keyId);
        if (cached) {
          this.cacheStats.hits++;
          this.metrics?.recordCounter("apikey.storage.cache_hit");

          return {
            success: true,
            data: cached,
            fromCache: true,
            executionTime: performance.now() - startTime,
          };
        }
        this.cacheStats.misses++;
      }

      // Fetch from repository
      const keyData = await this.apiKeyRepository.findById(keyId);

      if (!keyData) {
        return {
          success: false,
          error: "API key not found",
          executionTime: performance.now() - startTime,
        };
      }

      // Cache the result if enabled
      if (this.config.enableCache) {
        await this.setCachedKey(keyId, keyData);
      }

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer("apikey.storage.get_success", executionTime);

      return {
        success: true,
        data: keyData,
        fromCache: false,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.metrics?.recordCounter("apikey.storage.get_failure");
      this.logger.error("Failed to retrieve API key", {
        keyId,
        error,
        executionTime,
      });

      return {
        success: false,
        error: this.normalizeError(error),
        executionTime,
      };
    }
  }

  /**
   * Update API key with cache invalidation
   */
  async updateAPIKey(
    keyId: string,
    updates: Partial<ApiKey>
  ): Promise<StorageResult<ApiKey>> {
    const startTime = performance.now();

    try {
      // Update using repository
      const updatedKey = await this.apiKeyRepository.updateById(
        keyId,
        updates as ApiKeyUpdateInput
      );

      // Invalidate cache
      if (this.config.enableCache) {
        await this.invalidateKey(keyId);
        if (updates.userId) {
          await this.invalidateUserCache(updates.userId);
        }
      }

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer("apikey.storage.update_success", executionTime);
      this.logger.info("API key updated successfully", {
        keyId,
        executionTime,
      });

      return {
        success: true,
        data: updatedKey,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.metrics?.recordCounter("apikey.storage.update_failure");
      this.logger.error("Failed to update API key", {
        keyId,
        error,
        executionTime,
      });

      return {
        success: false,
        error: this.normalizeError(error),
        executionTime,
      };
    }
  }

  /**
   * Delete API key (soft delete) with cache cleanup
   */
  async deleteAPIKey(
    keyId: string,
    deletedBy: string
  ): Promise<StorageResult<boolean>> {
    const startTime = performance.now();

    try {
      // Use repository to revoke the API key
      await this.apiKeyRepository.revokeById(keyId);

      // Clear from cache
      if (this.config.enableCache) {
        await this.invalidateKey(keyId);
      }

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer("apikey.storage.delete_success", executionTime);
      this.logger.info("API key deleted successfully", {
        keyId,
        deletedBy,
        executionTime,
      });

      return {
        success: true,
        data: true,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.metrics?.recordCounter("apikey.storage.delete_failure");
      this.logger.error("Failed to delete API key", {
        keyId,
        error,
        executionTime,
      });

      return {
        success: false,
        error: this.normalizeError(error),
        executionTime,
      };
    }
  }

  /**
   * Get API keys by user ID with caching
   */
  async getAPIKeysByUserId(
    userId: string,
    includeInactive = false
  ): Promise<StorageResult<ApiKey[]>> {
    const startTime = performance.now();

    try {
      // Check cache first
      if (this.config.enableCache && !includeInactive) {
        const cached = await this.getCachedUserKeys(userId);
        if (cached) {
          this.cacheStats.hits++;
          return {
            success: true,
            data: cached,
            fromCache: true,
            executionTime: performance.now() - startTime,
          };
        }
        this.cacheStats.misses++;
      }

      // Use repository to get API keys by user
      const keys = includeInactive
        ? await this.apiKeyRepository.findByUser(userId)
        : await this.apiKeyRepository.findActiveByUser(userId);

      // Cache active keys only
      if (this.config.enableCache && !includeInactive) {
        await this.setCachedUserKeys(userId, keys);
      }

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer(
        "apikey.storage.get_user_keys_success",
        executionTime
      );

      return {
        success: true,
        data: keys,
        fromCache: false,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.metrics?.recordCounter("apikey.storage.get_user_keys_failure");
      this.logger.error("Failed to retrieve user API keys", {
        userId,
        error,
        executionTime,
      });

      return {
        success: false,
        error: this.normalizeError(error),
        executionTime,
      };
    }
  }

  /**
   * Get storage statistics and metrics
   */
  async getStorageStats(): Promise<StorageResult<APIKeyManagerStats>> {
    const startTime = performance.now();

    try {
      // Use repository to get API key statistics
      const dbStats = await this.apiKeyRepository.getApiKeyStats();
      const cacheHitRate = this.calculateCacheHitRate();

      const stats: APIKeyManagerStats = {
        totalKeys: dbStats.total,
        activeKeys: dbStats.active,
        expiredKeys: dbStats.expired,
        revokedKeys: dbStats.revoked,
        validationsToday: 0, // TODO: Implement in repository if needed
        cacheHitRate,
        lastResetAt: new Date(), // TODO: Track actual reset time
      };

      const executionTime = performance.now() - startTime;
      return {
        success: true,
        data: stats,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.logger.error("Failed to retrieve storage stats", {
        error,
        executionTime,
      });

      return {
        success: false,
        error: this.normalizeError(error),
        executionTime,
      };
    }
  }

  // ==================== CACHE OPERATIONS ====================

  /**
   * Get cached API key by ID
   */
  private async getCachedKey(keyId: string): Promise<ApiKey | null> {
    if (!this.cacheService || !this.config.enableCache) return null;

    try {
      const cacheKey = this.generateCacheKey("key", keyId);
      const cached = await this.cacheService.get(cacheKey);

      if (cached && cached.data) {
        return this.validateAndParseCachedData(cached.data as string);
      }

      return null;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.warn("Cache retrieval failed", { keyId, error });
      return null;
    }
  }

  /**
   * Cache API key data
   */
  private async setCachedKey(keyId: string, keyData: ApiKey): Promise<void> {
    if (!this.cacheService || !this.config.enableCache) return;

    try {
      const cacheKey = this.generateCacheKey("key", keyId);
      const serialized = this.serializeForCache(keyData);

      await this.cacheService.set(cacheKey, serialized, this.config.cacheTtl);
      this.incrementCacheCount();
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.warn("Cache storage failed", { keyId, error });
    }
  }

  /**
   * Get cached user keys
   */
  private async getCachedUserKeys(userId: string): Promise<ApiKey[] | null> {
    if (!this.cacheService || !this.config.enableCache) return null;

    try {
      const cacheKey = this.generateCacheKey("user_keys", userId);
      const cached = await this.cacheService.get(cacheKey);

      if (cached && cached.data) {
        const parsed = JSON.parse(cached.data as string);
        return Array.isArray(parsed) ? parsed : null;
      }

      return null;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.warn("User keys cache retrieval failed", { userId, error });
      return null;
    }
  }

  /**
   * Cache user keys
   */
  private async setCachedUserKeys(
    userId: string,
    keys: ApiKey[]
  ): Promise<void> {
    if (!this.cacheService || !this.config.enableCache) return;

    try {
      const cacheKey = this.generateCacheKey("user_keys", userId);
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(keys),
        this.config.cacheTtl
      );
      this.incrementCacheCount();
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.warn("User keys cache storage failed", { userId, error });
    }
  }

  /**
   * Invalidate specific key cache
   */
  private async invalidateKey(keyId: string): Promise<void> {
    if (!this.cacheService || !this.config.enableCache) return;

    try {
      const cacheKey = this.generateCacheKey("key", keyId);
      await this.cacheService.invalidate(cacheKey);
      this.decrementCacheCount();
    } catch (error) {
      this.logger.warn("Cache invalidation failed", { keyId, error });
    }
  }

  /**
   * Invalidate user cache entries
   */
  private async invalidateUserCache(userId: string): Promise<void> {
    if (!this.cacheService || !this.config.enableCache) return;

    try {
      const userKeysKey = this.generateCacheKey("user_keys", userId);
      await this.cacheService.invalidate(userKeysKey);
      this.decrementCacheCount();
    } catch (error) {
      this.logger.warn("User cache invalidation failed", { userId, error });
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return {
      totalEntries: this.cacheEntryCount,
      hitRate: this.calculateCacheHitRate(),
      missRate: this.calculateCacheMissRate(),
      evictions: this.cacheStats.evictions,
      errors: this.cacheStats.errors,
      lastCleanup: this.cacheStats.lastCleanup,
      memoryUsage: this.estimateMemoryUsage(),
    };
  }

  // ==================== HELPER METHODS ====================

  /**
   * Validate API key data before database operations
   */
  private validateKeyData(keyData: ApiKey): void {
    // Use the comprehensive Zod validation from the model
    ApiKeyCreateInputSchema.parse({
      id: keyData.id,
      name: keyData.name,
      keyHash: keyData.keyHash,
      keyIdentifier: keyData.keyIdentifier,
      keyPreview: keyData.keyPreview,
      userId: keyData.userId,
      storeId: keyData.storeId,
      permissions: keyData.permissions,
      scopes: keyData.scopes,
      lastUsedAt: keyData.lastUsedAt,
      usageCount: keyData.usageCount,
      isActive: keyData.isActive,
      expiresAt: keyData.expiresAt,
      revokedAt: keyData.revokedAt,
      revokedBy: keyData.revokedBy,
      metadata: keyData.metadata,
    });
  }

  /**
   * Generate secure cache key
   */
  private generateCacheKey(prefix: string, identifier: string): string {
    const hash = crypto
      .createHash("sha256")
      .update(identifier)
      .digest("hex")
      .substring(0, 16);
    return `apikey:${prefix}:${hash}`;
  }

  /**
   * Validate and parse cached data
   */
  private validateAndParseCachedData(cached: string): ApiKey | null {
    try {
      const parsed = JSON.parse(cached);

      // Basic validation
      if (!parsed.id || !parsed.keyHash || !parsed.userId) {
        return null;
      }

      return parsed as ApiKey;
    } catch (error) {
      this.logger.warn("Invalid cached data format", { error });
      return null;
    }
  }

  /**
   * Serialize data for cache storage
   */
  private serializeForCache(data: ApiKey): string {
    return JSON.stringify(data);
  }

  /**
   * Normalize error messages
   */
  private normalizeError(error: unknown): string {
    if (error instanceof Error) {
      if (
        error.message.includes("duplicate key") ||
        error.message.includes("unique constraint")
      ) {
        return "Operation failed due to conflict, please try again";
      }
      if (
        error.message.includes("connection") ||
        error.message.includes("timeout")
      ) {
        return "Database connection issue, please try again";
      }
      return error.message;
    }
    return "Unknown storage error occurred";
  }

  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): number {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return total > 0 ? (this.cacheStats.hits / total) * 100 : 0;
  }

  /**
   * Calculate cache miss rate
   */
  private calculateCacheMissRate(): number {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return total > 0 ? (this.cacheStats.misses / total) * 100 : 0;
  }

  /**
   * Estimate memory usage (rough approximation)
   */
  private estimateMemoryUsage(): number {
    // Rough estimate: 2KB per cached entry
    return this.cacheEntryCount * 2048;
  }

  /**
   * Increment cache entry count with cleanup check
   */
  private incrementCacheCount(): void {
    this.cacheEntryCount++;

    const threshold =
      (this.config.maxCacheEntries * this.config.cleanupThreshold) / 100;
    if (this.cacheEntryCount > threshold) {
      this.performCacheCleanup();
    }
  }

  /**
   * Decrement cache entry count
   */
  private decrementCacheCount(): void {
    this.cacheEntryCount = Math.max(0, this.cacheEntryCount - 1);
  }

  /**
   * Perform cache cleanup (stub for future implementation)
   */
  private performCacheCleanup(): void {
    // TODO: Implement LRU-style cleanup
    this.logger.info("Cache cleanup triggered", {
      currentEntries: this.cacheEntryCount,
      threshold: this.config.cleanupThreshold,
    });

    this.cacheStats.lastCleanup = new Date();
    // For now, just log the cleanup event
    // Future implementation would remove least recently used entries
  }
}
