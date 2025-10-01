/**
 * APIKeyStorage - Consolidated API key storage operations
 *
 * This consolidated component replaces:
 * - APIKeyRepository.ts - Database operations and persistence
 * - APIKeyCacheManager.ts - Caching operations and cache management
 *
 * Responsibilities:
 * - Unified storage interface with cache-through pattern
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
import type { PostgreSQLClient, CacheService } from "@libs/database";
import { APIKey, APIKeyManagerStats } from "./types";

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
    private readonly dbClient: PostgreSQLClient,
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
  async createAPIKey(keyData: APIKey): Promise<StorageResult<APIKey>> {
    const startTime = performance.now();

    try {
      // Validate key data
      this.validateKeyData(keyData);

      // Execute database insert with retry logic
      await this.executeWithRetry(async () => {
        return this.dbClient.executeRaw(
          `INSERT INTO api_keys 
           (id, name, key_hash, key_preview, user_id, store_id, permissions, scopes, 
            usage_count, is_active, expires_at, created_at, updated_at, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          keyData.id,
          keyData.name,
          keyData.keyHash,
          keyData.keyPreview,
          keyData.userId,
          keyData.storeId,
          JSON.stringify(keyData.permissions),
          keyData.scopes,
          keyData.usageCount,
          keyData.isActive,
          keyData.expiresAt,
          keyData.createdAt,
          keyData.updatedAt,
          keyData.metadata ? JSON.stringify(keyData.metadata) : null
        );
      });

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
        data: keyData,
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
  async getAPIKeyById(keyId: string): Promise<StorageResult<APIKey>> {
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

      // Fetch from database
      const result = (await this.dbClient.executeRaw(
        `SELECT ak.*, u.email as user_email 
         FROM api_keys ak
         LEFT JOIN users u ON ak.user_id = u.id
         WHERE ak.id = $1`,
        keyId
      )) as any;

      if (!result.rows || result.rows.length === 0) {
        return {
          success: false,
          error: "API key not found",
          executionTime: performance.now() - startTime,
        };
      }

      const keyData = this.mapDatabaseResult(result.rows[0]);

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
    updates: Partial<APIKey>
  ): Promise<StorageResult<APIKey>> {
    const startTime = performance.now();

    try {
      // Build dynamic update query
      const { query, params } = this.buildUpdateQuery(keyId, updates);

      await this.executeWithRetry(async () => {
        return this.dbClient.executeRaw(query, ...params);
      });

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

      // Return updated key data
      const updatedKey = await this.getAPIKeyById(keyId);
      if (!updatedKey.success || !updatedKey.data) {
        return {
          success: false,
          error: "Failed to retrieve updated API key",
          executionTime,
        };
      }

      return {
        success: true,
        data: updatedKey.data,
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
      const result = await this.executeWithRetry(async () => {
        return this.dbClient.executeRaw(
          `UPDATE api_keys 
           SET is_active = false, revoked_at = CURRENT_TIMESTAMP, revoked_by = $2
           WHERE id = $1 AND is_active = true`,
          keyId,
          deletedBy
        );
      });

      // Clear from cache
      if (this.config.enableCache) {
        await this.invalidateKey(keyId);
      }

      const executionTime = performance.now() - startTime;
      const success = (result as any).rowCount > 0;

      if (success) {
        this.metrics?.recordTimer(
          "apikey.storage.delete_success",
          executionTime
        );
        this.logger.info("API key deleted successfully", {
          keyId,
          deletedBy,
          executionTime,
        });
      }

      if (success) {
        return {
          success: true,
          data: true,
          executionTime,
        };
      } else {
        return {
          success: false,
          data: false,
          error: "Key not found or already deleted",
          executionTime,
        };
      }
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
  ): Promise<StorageResult<APIKey[]>> {
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

      const activeCondition = includeInactive ? "" : "AND ak.is_active = true";
      const result = (await this.dbClient.executeRaw(
        `SELECT ak.*, u.email as user_email 
         FROM api_keys ak
         LEFT JOIN users u ON ak.user_id = u.id
         WHERE ak.user_id = $1 ${activeCondition}
         ORDER BY ak.created_at DESC`,
        userId
      )) as any;

      const keys =
        result.rows?.map((row: any) => this.mapDatabaseResult(row)) || [];

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
      const result = (await this.dbClient.executeRaw(`
        SELECT 
          COUNT(*) as total_keys,
          COUNT(*) FILTER (WHERE is_active = true) as active_keys,
          COUNT(*) FILTER (WHERE expires_at < CURRENT_TIMESTAMP) as expired_keys,
          COUNT(*) FILTER (WHERE revoked_at IS NOT NULL) as revoked_keys,
          COUNT(*) FILTER (WHERE DATE(last_used_at) = CURRENT_DATE) as validations_today
        FROM api_keys
      `)) as any;

      const dbStats = result.rows[0];
      const cacheHitRate = this.calculateCacheHitRate();

      const stats: APIKeyManagerStats = {
        totalKeys: parseInt(dbStats.total_keys),
        activeKeys: parseInt(dbStats.active_keys),
        expiredKeys: parseInt(dbStats.expired_keys),
        revokedKeys: parseInt(dbStats.revoked_keys),
        validationsToday: parseInt(dbStats.validations_today),
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
  private async getCachedKey(keyId: string): Promise<APIKey | null> {
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
  private async setCachedKey(keyId: string, keyData: APIKey): Promise<void> {
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
  private async getCachedUserKeys(userId: string): Promise<APIKey[] | null> {
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
    keys: APIKey[]
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
  private validateKeyData(keyData: APIKey): void {
    if (!keyData.id || !keyData.keyHash || !keyData.userId) {
      throw new Error("Missing required key data");
    }

    if (keyData.keyHash.length > this.config.maxKeyLength) {
      throw new Error("Key hash exceeds maximum length");
    }
  }

  /**
   * Execute database operation with retry logic
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.retryAttempts) {
          this.logger.warn(
            `Database operation failed, retrying (${attempt}/${this.config.retryAttempts})`,
            { error }
          );
          await this.delay(this.config.retryDelay * attempt);
        }
      }
    }

    throw lastError;
  }

  /**
   * Build dynamic update query
   */
  private buildUpdateQuery(
    keyId: string,
    updates: Partial<APIKey>
  ): { query: string; params: any[] } {
    const setParts: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Add each update field
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        setParts.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    });

    // Always update the updated_at timestamp
    setParts.push(`updated_at = CURRENT_TIMESTAMP`);

    // Add keyId as the final parameter
    params.push(keyId);

    const query = `
      UPDATE api_keys 
      SET ${setParts.join(", ")}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    return { query, params };
  }

  /**
   * Map database result to APIKey object
   */
  private mapDatabaseResult(row: any): APIKey {
    return {
      id: row.id,
      name: row.name,
      keyHash: row.key_hash,
      keyPreview: row.key_preview,
      userId: row.user_id,
      storeId: row.store_id,
      permissions: row.permissions ? JSON.parse(row.permissions) : [],
      scopes: row.scopes || [],
      lastUsedAt: row.last_used_at,
      usageCount: row.usage_count || 0,
      isActive: row.is_active,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
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
  private validateAndParseCachedData(cached: string): APIKey | null {
    try {
      const parsed = JSON.parse(cached);

      // Basic validation
      if (!parsed.id || !parsed.keyHash || !parsed.userId) {
        return null;
      }

      return parsed as APIKey;
    } catch (error) {
      this.logger.warn("Invalid cached data format", { error });
      return null;
    }
  }

  /**
   * Serialize data for cache storage
   */
  private serializeForCache(data: APIKey): string {
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

  /**
   * Simple delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
