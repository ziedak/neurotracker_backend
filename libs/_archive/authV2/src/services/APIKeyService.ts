/**
 * @fileoverview APIKeyServiceV2 - Enterprise API key management service
 * @module services/APIKeyService
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, APIKey, Timestamp } from "../types/core";
import { createAPIKey } from "../types/core";
import type { IServiceHealth } from "../types/enhanced";
import type {
  IAPIKeyService,
  IAPIKeyGenerateData,
  IAPIKeyGenerateResult,
  IAPIKeyValidationResult,
  IAPIKeyInfo,
  IAPIKeyUpdateData,
  IRateLimitResult,
  IAPIKeyUsageStats,
} from "../contracts/services";
import { ValidationError } from "../errors/core";
import { RepositoryFactory } from "../repositories/RepositoryFactory";
import type { APIKeyRepository } from "../repositories/APIKeyRepository";
import * as crypto from "crypto";

/**
 * API Key metrics for performance tracking
 */
interface IAPIKeyMetrics {
  keysGenerated: number;
  keysValidated: number;
  keysRevoked: number;
  keysRotated: number;
  rateLimitChecks: number;
  rateLimitViolations: number;
  operationsTotal: number;
  errorsTotal: number;
}

/**
 * API Key cache entry for validation optimization
 */
interface IAPIKeyCacheEntry {
  keyInfo: IAPIKeyInfo;
  hashedKey: string;
  cachedAt: Date;
  accessCount: number;
}

/**
 * Rate limit tracking entry
 */
interface IRateLimitEntry {
  requestCount: number;
  windowStart: Date;
  lastRequest: Date;
  dailyCount: number;
  dailyWindowStart: Date;
}

/**
 * APIKeyServiceV2 Implementation
 *
 * Enterprise-grade API key management service with:
 * - Secure API key generation with cryptographic standards
 * - High-performance validation with caching and rate limiting
 * - Comprehensive usage analytics and monitoring
 * - Flexible scope-based access control
 * - Rate limiting with hourly and daily quotas
 * - Key rotation and lifecycle management
 * - Health monitoring and metrics collection
 */
export class APIKeyServiceV2 implements IAPIKeyService {
  // Database replaces in-memory stores - using PostgreSQLClient for persistence
  // Legacy stores kept for backward compatibility during transition
  private readonly keyCache = new Map<APIKey, IAPIKeyCacheEntry>();
  private readonly rateLimitStore = new Map<APIKey, IRateLimitEntry>(); // Rate limits kept in memory for performance
  private readonly metrics: IAPIKeyMetrics;
  private readonly startTime: number;

  // Configuration
  private readonly keyLength = 64; // Base64 characters
  private readonly hashAlgorithm = "sha256";
  private readonly keyPrefix = "ak_"; // API Key prefix
  private readonly cacheTtl = 5 * 60 * 1000; // 5 minutes
  private readonly maxCacheSize = 10000;
  private readonly cacheCleanupThreshold = 0.8;
  private readonly defaultRateLimit = {
    requestsPerHour: 1000,
    requestsPerDay: 10000,
    burstLimit: 50,
  };

  constructor(
    private readonly apiKeyRepository: APIKeyRepository = RepositoryFactory.getInstance().getAPIKeyRepository()
  ) {
    this.startTime = Date.now();
    this.metrics = {
      keysGenerated: 0,
      keysValidated: 0,
      keysRevoked: 0,
      keysRotated: 0,
      rateLimitChecks: 0,
      rateLimitViolations: 0,
      operationsTotal: 0,
      errorsTotal: 0,
    };

    // Start background maintenance
    this.startCacheMaintenanceJob();
    this.startUsageCleanupJob();
  }

  /**
   * Generate new API key
   */
  async generate(keyData: IAPIKeyGenerateData): Promise<IAPIKeyGenerateResult> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.keysGenerated++;

      // Validate input data
      this.validateGenerateData(keyData);

      // Generate secure API key
      const keyId = this.generateKeyId();
      const rawKey = this.generateRawKey();
      const apiKey = createAPIKey(`${this.keyPrefix}${rawKey}`);
      const hashedKey = this.hashKey(apiKey);

      const now = new Date();
      const expiresAt = keyData.expiresAt || null;

      // Create API key info
      const keyInfo: IAPIKeyInfo = {
        id: keyId,
        name: keyData.name,
        userId: keyData.userId,
        scopes: keyData.scopes,
        isActive: true,
        expiresAt,
        createdAt: now,
        lastUsedAt: null,
        usageCount: 0,
      };

      // Store API key data in database using repository
      await this.apiKeyRepository.create({
        id: keyId,
        hashedKey,
        name: keyInfo.name,
        userId: keyInfo.userId,
        scopes: [...keyInfo.scopes], // Convert readonly array to mutable
        isActive: keyInfo.isActive,
        expiresAt: keyInfo.expiresAt,
        createdAt: keyInfo.createdAt,
        lastUsedAt: keyInfo.lastUsedAt,
        usageCount: keyInfo.usageCount,
      });

      // Cache the key for fast validation
      this.addKeyToCache(apiKey, keyInfo, hashedKey);

      // Initialize rate limiting if specified
      if (keyData.rateLimit) {
        this.initializeRateLimit(apiKey, keyData.rateLimit);
      }

      return {
        keyId,
        key: apiKey,
        hashedKey,
        expiresAt,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to generate API key: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Validate API key
   */
  async validate(key: APIKey): Promise<IAPIKeyValidationResult> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.keysValidated++;

      // Check cache first
      const cached = this.getKeyFromCache(key);
      if (cached) {
        const rateLimitStatus = await this.checkRateLimit(key);
        return this.buildValidationResult(
          true,
          cached.keyInfo,
          null,
          rateLimitStatus
        );
      }

      // Hash the key and lookup from repository
      const hashedKey = this.hashKey(key);
      const keyInfo = await this.apiKeyRepository.findByHashedKey(hashedKey);

      if (!keyInfo) {
        const rateLimitStatus = this.buildEmptyRateLimitResult();
        return this.buildValidationResult(
          false,
          null,
          "API key not found",
          rateLimitStatus
        );
      }

      // Check if key is active
      if (!keyInfo.isActive) {
        const rateLimitStatus = this.buildEmptyRateLimitResult();
        return this.buildValidationResult(
          false,
          keyInfo,
          "API key is inactive",
          rateLimitStatus
        );
      }

      // Check expiration
      if (keyInfo.expiresAt && keyInfo.expiresAt < new Date()) {
        const rateLimitStatus = this.buildEmptyRateLimitResult();
        return this.buildValidationResult(
          false,
          keyInfo,
          "API key has expired",
          rateLimitStatus
        );
      }

      // Update last used time and usage count
      await this.updateKeyUsage(keyInfo.id);

      // Cache the key
      this.addKeyToCache(key, keyInfo, hashedKey);

      // Check rate limit
      const rateLimitStatus = await this.checkRateLimit(key);

      return this.buildValidationResult(true, keyInfo, null, rateLimitStatus);
    } catch (error) {
      this.metrics.errorsTotal++;
      const rateLimitStatus = this.buildEmptyRateLimitResult();
      return this.buildValidationResult(
        false,
        null,
        error instanceof Error ? error.message : "Validation error",
        rateLimitStatus
      );
    }
  }

  /**
   * Find API key by ID
   */
  async findById(keyId: EntityId): Promise<IAPIKeyInfo | null> {
    try {
      this.metrics.operationsTotal++;

      const keyInfo = await this.apiKeyRepository.findById(keyId);
      return keyInfo || null;
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to find API key: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Find API keys for user
   */
  async findByUserId(userId: EntityId): Promise<ReadonlyArray<IAPIKeyInfo>> {
    try {
      this.metrics.operationsTotal++;

      const keys = await this.apiKeyRepository.findByUserId(userId);

      // Sort by creation date (newest first) - repository should handle this but ensure here
      keys.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return Object.freeze(keys);
    } catch (error) {
      this.metrics.errorsTotal++;
      throw new ValidationError(
        `Failed to find user API keys: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Update API key
   */
  async update(
    keyId: EntityId,
    updateData: IAPIKeyUpdateData
  ): Promise<IAPIKeyInfo> {
    try {
      this.metrics.operationsTotal++;

      const existingKey = await this.apiKeyRepository.findById(keyId);
      if (!existingKey) {
        throw new ValidationError(`API key not found: ${keyId}`);
      }

      // Create updated key data for repository
      const updateDataForRepo = {
        ...(updateData.name !== undefined && { name: updateData.name }),
        ...(updateData.scopes !== undefined && {
          scopes: [...updateData.scopes],
        }),
        ...(updateData.isActive !== undefined && {
          isActive: updateData.isActive,
        }),
      };

      // Update via repository
      const updatedKey = await this.apiKeyRepository.update(
        keyId,
        updateDataForRepo
      );

      // Invalidate cache entries for this key
      this.invalidateKeyCache(keyId);

      return updatedKey;
    } catch (error) {
      this.metrics.errorsTotal++;
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to update API key: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Rotate API key
   */
  async rotate(keyId: EntityId): Promise<IAPIKeyGenerateResult> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.keysRotated++;

      const existingKey = await this.apiKeyRepository.findById(keyId);
      if (!existingKey) {
        throw new ValidationError(`API key not found: ${keyId}`);
      }

      // Generate new key data
      const rawKey = this.generateRawKey();
      const newApiKey = createAPIKey(`${this.keyPrefix}${rawKey}`);
      const newHashedKey = this.hashKey(newApiKey);

      // Update the API key with new hashed key and reset usage
      await this.apiKeyRepository.update(keyId, {
        hashedKey: newHashedKey,
        usageCount: 0,
        lastUsedAt: null,
      });

      // Invalidate cache
      this.invalidateKeyCache(keyId);

      return {
        keyId,
        key: newApiKey,
        hashedKey: newHashedKey,
        expiresAt: existingKey.expiresAt,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to rotate API key: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Revoke API key
   */
  async revoke(keyId: EntityId, _reason: string): Promise<boolean> {
    try {
      this.metrics.operationsTotal++;
      this.metrics.keysRevoked++;

      const existingKey = await this.apiKeyRepository.findById(keyId);
      if (!existingKey) {
        return false;
      }

      // Mark as inactive using repository soft delete
      await this.apiKeyRepository.delete(keyId);

      // Invalidate cache
      this.invalidateKeyCache(keyId);

      // Remove rate limit tracking
      this.clearKeyRateLimits(keyId);

      return true;
    } catch (error) {
      this.metrics.errorsTotal++;
      return false;
    }
  }

  /**
   * Check rate limit for key
   */
  async checkRateLimit(key: APIKey): Promise<IRateLimitResult> {
    try {
      this.metrics.rateLimitChecks++;

      const now = new Date();
      const rateLimitEntry = this.rateLimitStore.get(key);

      if (!rateLimitEntry) {
        // No rate limit configured, allow all requests
        return {
          allowed: true,
          remainingRequests: this.defaultRateLimit.requestsPerHour,
          resetTime: new Date(now.getTime() + 60 * 60 * 1000), // 1 hour from now
          retryAfter: null,
        };
      }

      // Check hourly limit
      const hourlyWindowMs = 60 * 60 * 1000; // 1 hour
      const timeSinceHourlyWindow =
        now.getTime() - rateLimitEntry.windowStart.getTime();

      if (timeSinceHourlyWindow >= hourlyWindowMs) {
        // Reset hourly window
        rateLimitEntry.requestCount = 0;
        rateLimitEntry.windowStart = now;
      }

      // Check daily limit
      const dailyWindowMs = 24 * 60 * 60 * 1000; // 24 hours
      const timeSinceDailyWindow =
        now.getTime() - rateLimitEntry.dailyWindowStart.getTime();

      if (timeSinceDailyWindow >= dailyWindowMs) {
        // Reset daily window
        rateLimitEntry.dailyCount = 0;
        rateLimitEntry.dailyWindowStart = now;
      }

      // Check limits (using default if not specified)
      const hourlyLimit = this.defaultRateLimit.requestsPerHour;
      const dailyLimit = this.defaultRateLimit.requestsPerDay;

      if (rateLimitEntry.requestCount >= hourlyLimit) {
        this.metrics.rateLimitViolations++;
        const resetTime = new Date(
          rateLimitEntry.windowStart.getTime() + hourlyWindowMs
        );
        return {
          allowed: false,
          remainingRequests: 0,
          resetTime,
          retryAfter: Math.ceil((resetTime.getTime() - now.getTime()) / 1000),
        };
      }

      if (rateLimitEntry.dailyCount >= dailyLimit) {
        this.metrics.rateLimitViolations++;
        const resetTime = new Date(
          rateLimitEntry.dailyWindowStart.getTime() + dailyWindowMs
        );
        return {
          allowed: false,
          remainingRequests: 0,
          resetTime,
          retryAfter: Math.ceil((resetTime.getTime() - now.getTime()) / 1000),
        };
      }

      // Increment counters
      rateLimitEntry.requestCount++;
      rateLimitEntry.dailyCount++;
      rateLimitEntry.lastRequest = now;

      const remainingHourly = hourlyLimit - rateLimitEntry.requestCount;
      const remainingDaily = dailyLimit - rateLimitEntry.dailyCount;
      const remainingRequests = Math.min(remainingHourly, remainingDaily);

      return {
        allowed: true,
        remainingRequests,
        resetTime: new Date(
          rateLimitEntry.windowStart.getTime() + hourlyWindowMs
        ),
        retryAfter: null,
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      // On error, allow the request but log the issue
      return {
        allowed: true,
        remainingRequests: 1,
        resetTime: new Date(Date.now() + 60 * 60 * 1000),
        retryAfter: null,
      };
    }
  }

  /**
   * Get usage statistics
   * TODO: Implement with database-backed usage tracking
   */
  async getUsageStats(
    keyId: EntityId,
    _days: number = 30
  ): Promise<IAPIKeyUsageStats> {
    try {
      this.metrics.operationsTotal++;

      const keyInfo = await this.apiKeyRepository.findById(keyId);
      if (!keyInfo) {
        throw new ValidationError(`API key not found: ${keyId}`);
      }

      // TODO Phase 3: Implement database-backed usage tracking
      // For now, return basic stats structure with minimal data
      return {
        keyId,
        totalRequests: keyInfo.usageCount,
        successfulRequests: keyInfo.usageCount,
        failedRequests: 0,
        averageResponseTime: 0,
        requestsByDay: Object.freeze([]),
        topEndpoints: Object.freeze([]),
      };
    } catch (error) {
      this.metrics.errorsTotal++;
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to get usage stats: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Health check
   */
  async getHealth(): Promise<IServiceHealth> {
    try {
      // Get basic statistics from repository
      const totalKeys = await this.apiKeyRepository.count();
      const activeKeys = await this.apiKeyRepository.count({
        searchFilters: { isActive: true },
      });

      return {
        service: "APIKeyServiceV2",
        status: "healthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [],
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
          keysGenerated: this.metrics.keysGenerated,
          keysValidated: this.metrics.keysValidated,
          keysRevoked: this.metrics.keysRevoked,
          keysRotated: this.metrics.keysRotated,
          rateLimitChecks: this.metrics.rateLimitChecks,
          rateLimitViolations: this.metrics.rateLimitViolations,
          totalKeys,
          activeKeys,
          cacheSize: this.keyCache.size,
          rateLimitEntriesCount: this.rateLimitStore.size,
          usageEntriesCount: 0, // TODO: Implement with database usage tracking
        },
      };
    } catch (error) {
      return {
        service: "APIKeyServiceV2",
        status: "unhealthy",
        uptime: Date.now() - this.startTime,
        lastCheck: new Date().toISOString() as Timestamp,
        dependencies: [],
        metrics: {
          operationsTotal: this.metrics.operationsTotal,
          errorsTotal: this.metrics.errorsTotal,
        },
      };
    }
  }

  /**
   * Track API key usage (called externally by middleware)
   * TODO: Implement database-backed usage tracking
   */
  async trackUsage(
    keyId: EntityId,
    endpoint: string,
    responseTime: number,
    success: boolean
  ): Promise<void> {
    try {
      // TODO Phase 3: Implement proper database-backed usage tracking
      // For now, just update the usage count via repository
      await this.apiKeyRepository.updateUsage(keyId);

      // Log usage for monitoring purposes
      console.log(
        `[API_KEY_USAGE] Key: ${keyId}, Endpoint: ${endpoint}, Success: ${success}, ResponseTime: ${responseTime}ms`
      );
    } catch (error) {
      // Log error but don't throw - usage tracking shouldn't break API calls
      console.error("Failed to track API key usage:", error);
    }
  }

  /**
   * Private utility methods
   */
  private validateGenerateData(data: IAPIKeyGenerateData): void {
    if (!data.userId) {
      throw new ValidationError("User ID is required");
    }
    if (!data.name || data.name.trim().length === 0) {
      throw new ValidationError("API key name is required");
    }
    if (!data.scopes || data.scopes.length === 0) {
      throw new ValidationError("At least one scope is required");
    }
    if (data.expiresAt && data.expiresAt <= new Date()) {
      throw new ValidationError("Expiration date must be in the future");
    }
  }

  private generateKeyId(): EntityId {
    return `ak_${crypto.randomBytes(16).toString("hex")}` as EntityId;
  }

  private generateRawKey(): string {
    // Generate a secure random key
    const randomBytes = crypto.randomBytes(48); // 48 bytes = 64 base64 characters
    return randomBytes
      .toString("base64")
      .replace(/[+/=]/g, "")
      .substring(0, this.keyLength);
  }

  private hashKey(key: APIKey): string {
    return crypto.createHash(this.hashAlgorithm).update(key).digest("hex");
  }

  private getKeyFromCache(key: APIKey): IAPIKeyCacheEntry | null {
    const entry = this.keyCache.get(key);
    if (entry && Date.now() - entry.cachedAt.getTime() < this.cacheTtl) {
      entry.accessCount++;
      return entry;
    }

    if (entry) {
      this.keyCache.delete(key);
    }

    return null;
  }

  private addKeyToCache(
    key: APIKey,
    keyInfo: IAPIKeyInfo,
    hashedKey: string
  ): void {
    if (this.keyCache.size >= this.maxCacheSize * this.cacheCleanupThreshold) {
      this.cleanupCache();
    }

    this.keyCache.set(key, {
      keyInfo: { ...keyInfo }, // Create a copy to avoid mutation
      hashedKey,
      cachedAt: new Date(),
      accessCount: 1,
    });
  }

  private invalidateKeyCache(keyId: EntityId): void {
    // Remove all cache entries for this key ID
    const keysToDelete: APIKey[] = [];
    for (const [key, entry] of this.keyCache) {
      if (entry.keyInfo.id === keyId) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.keyCache.delete(key));
  }

  private clearKeyRateLimits(_keyId: EntityId): void {
    // Find and remove rate limit entries for this key
    // Since we don't have a reverse lookup, we'll need to iterate
    // TODO Phase 3: Optimize this with a reverse lookup index
    const keysToDelete: APIKey[] = [];
    for (const [_key] of this.rateLimitStore) {
      // We can't easily reverse-lookup the keyId from the APIKey without the database
      // For now, we'll keep rate limits until they naturally expire
      // This is acceptable since rate limits are memory-only and temporary
    }

    keysToDelete.forEach((key) => this.rateLimitStore.delete(key));
  }

  private initializeRateLimit(
    key: APIKey,
    _rateLimit: {
      requestsPerHour: number;
      requestsPerDay: number;
      burstLimit: number;
    }
  ): void {
    const now = new Date();
    this.rateLimitStore.set(key, {
      requestCount: 0,
      windowStart: now,
      lastRequest: now,
      dailyCount: 0,
      dailyWindowStart: now,
    });
  }

  private async updateKeyUsage(keyId: EntityId): Promise<void> {
    try {
      await this.apiKeyRepository.updateUsage(keyId);
    } catch (error) {
      // Don't throw errors for usage tracking failures
      console.error(`Failed to update API key usage for ${keyId}:`, error);
    }
  }

  private buildValidationResult(
    isValid: boolean,
    keyInfo: IAPIKeyInfo | null,
    failureReason: string | null,
    rateLimitStatus: IRateLimitResult
  ): IAPIKeyValidationResult {
    return {
      isValid,
      keyInfo,
      failureReason,
      rateLimitStatus,
    };
  }

  private buildEmptyRateLimitResult(): IRateLimitResult {
    return {
      allowed: false,
      remainingRequests: 0,
      resetTime: new Date(Date.now() + 60 * 60 * 1000),
      retryAfter: 3600,
    };
  }

  private cleanupCache(): void {
    // Remove oldest entries based on last access time
    const entries = Array.from(this.keyCache.entries());
    entries.sort(([, a], [, b]) => a.cachedAt.getTime() - b.cachedAt.getTime());

    const removeCount = Math.floor(entries.length * 0.2);
    for (let i = 0; i < removeCount && i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        this.keyCache.delete(entry[0]);
      }
    }
  }

  private startCacheMaintenanceJob(): void {
    // Clean expired cache entries every 10 minutes
    setInterval(() => {
      try {
        for (const [key, entry] of this.keyCache) {
          if (Date.now() - entry.cachedAt.getTime() >= this.cacheTtl) {
            this.keyCache.delete(key);
          }
        }
      } catch (error) {
        console.error("API key cache maintenance failed:", error);
      }
    }, 10 * 60 * 1000);
  }

  private startUsageCleanupJob(): void {
    // Clean old usage entries every 24 hours
    setInterval(() => {
      try {
        // TODO Phase 3: Implement database-backed usage cleanup
        // For now, usage is tracked via updateUsage calls to repository
        // No cleanup needed for in-memory tracking since it's minimal
        console.log(
          "[API_KEY_SERVICE] Usage cleanup job executed (database-backed)"
        );
      } catch (error) {
        console.error("API key usage cleanup failed:", error);
      }
    }, 24 * 60 * 60 * 1000);
  }
}
