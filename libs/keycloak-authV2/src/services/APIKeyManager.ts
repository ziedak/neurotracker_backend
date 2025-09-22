/**
 * API Key Manager Service - Production Implementation
 * Handles API key generation, validation, and lifecycle with PostgreSQL storage
 */

import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import { createLogger } from "@libs/utils";
import { PostgreSQLClient, CacheService } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";
import type { UserInfo } from "../types";
import type { AuthV2Config } from "./config";

/**
 * API Key data structure matching Prisma schema
 */
export interface APIKey {
  id: string;
  name: string;
  keyHash: string;
  keyPreview: string;
  userId: string;
  storeId?: string;
  permissions?: string[];
  scopes: string[];
  lastUsedAt?: Date;
  usageCount: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
  revokedBy?: string;
  metadata?: Record<string, any>;
}

export interface APIKeyGenerationOptions {
  userId: string;
  name?: string;
  storeId?: string;
  scopes?: string[];
  permissions?: string[];
  expirationDate?: Date;
  prefix?: string;
  metadata?: Record<string, any>;
}

export interface APIKeyValidationResult {
  success: boolean;
  user?: UserInfo;
  keyData?: APIKey;
  expiresAt?: Date;
  error?: string;
}

export interface APIKeyManagerStats {
  totalKeys: number;
  activeKeys: number;
  expiredKeys: number;
  revokedKeys: number;
  validationsToday: number;
  cacheHitRate: number;
}

export class APIKeyManager {
  private readonly logger = createLogger("APIKeyManager");
  private readonly cacheService?: CacheService;
  private readonly dbClient: PostgreSQLClient;
  private readonly saltRounds = 12; // bcrypt salt rounds for security

  private stats: APIKeyManagerStats = {
    totalKeys: 0,
    activeKeys: 0,
    expiredKeys: 0,
    revokedKeys: 0,
    validationsToday: 0,
    cacheHitRate: 0,
  };

  constructor(
    _config: AuthV2Config,
    private readonly metrics?: IMetricsCollector
  ) {
    // Initialize database client
    this.dbClient = new PostgreSQLClient(metrics);

    // Initialize cache if enabled
    if (_config.cache.enabled && metrics) {
      this.cacheService = CacheService.create(metrics);
    }
  }

  /**
   * Generate a new API key for a user
   */
  async generateAPIKey(options: APIKeyGenerationOptions): Promise<{
    success: boolean;
    apiKey?: string;
    keyData?: APIKey;
    error?: string;
  }> {
    const startTime = performance.now();

    try {
      // Generate secure API key
      const apiKey = this.generateSecureKey(options.prefix);
      const keyHash = await bcrypt.hash(apiKey, this.saltRounds);
      const keyPreview = `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;

      // Create database record
      const keyData: APIKey = {
        id: crypto.randomUUID(),
        name: options.name || "Unnamed API Key",
        keyHash,
        keyPreview,
        userId: options.userId,
        ...(options.storeId && { storeId: options.storeId }),
        permissions: options.permissions || [],
        scopes: options.scopes || ["read"],
        usageCount: 0,
        isActive: true,
        ...(options.expirationDate && { expiresAt: options.expirationDate }),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(options.metadata && { metadata: options.metadata }),
      };

      // Store in database
      await this.dbClient.executeRaw(
        `INSERT INTO api_keys (
          id, name, "keyHash", "keyPreview", "userId", "storeId", 
          permissions, scopes, "usageCount", "isActive", "expiresAt", 
          "createdAt", "updatedAt", metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
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
          keyData.metadata ? JSON.stringify(keyData.metadata) : null,
        ]
      );

      // Update stats
      this.stats.totalKeys++;
      this.stats.activeKeys++;

      this.logger.info("API key generated", {
        keyId: keyData.id,
        userId: options.userId,
        scopes: options.scopes,
      });

      this.metrics?.recordCounter("keycloak.api_key_manager.key_generated", 1);
      this.metrics?.recordTimer(
        "keycloak.api_key_manager.generate_duration",
        performance.now() - startTime
      );

      return {
        success: true,
        apiKey,
        keyData,
      };
    } catch (error) {
      this.logger.error("API key generation failed", {
        error,
        userId: options.userId,
      });
      this.metrics?.recordCounter("keycloak.api_key_manager.generate_error", 1);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Key generation failed",
      };
    }
  }

  /**
   * Validate API key and return authentication result
   */
  async validateAPIKey(apiKey: string): Promise<APIKeyValidationResult> {
    const startTime = performance.now();

    try {
      // Check cache first if enabled
      if (this.cacheService) {
        const cacheKey = `api_key_validation:${this.hashKey(apiKey)}`;
        const cachedResult =
          await this.cacheService.get<APIKeyValidationResult>(cacheKey);

        if (cachedResult.data && cachedResult.source !== "miss") {
          this.metrics?.recordCounter("keycloak.api_key_manager.cache_hit", 1);
          return cachedResult.data;
        }
      }

      // Perform database validation
      const result = await this.performDatabaseValidation(apiKey);

      // Cache successful validations for a short period
      if (this.cacheService && result.success) {
        const cacheKey = `api_key_validation:${this.hashKey(apiKey)}`;
        const cacheTTL = 300; // 5 minutes cache for API keys
        await this.cacheService.set(cacheKey, result, cacheTTL);
        this.metrics?.recordCounter("keycloak.api_key_manager.cache_set", 1);
      }

      // Update usage statistics
      if (result.success && result.keyData) {
        await this.updateKeyUsage(result.keyData.id);
      }

      this.stats.validationsToday++;
      this.metrics?.recordCounter("keycloak.api_key_manager.validation", 1);
      this.metrics?.recordTimer(
        "keycloak.api_key_manager.validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("API key validation failed", { error });
      this.metrics?.recordCounter(
        "keycloak.api_key_manager.validation_error",
        1
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : "Validation failed",
      };
    }
  }

  /**
   * Perform database validation of API key
   */
  private async performDatabaseValidation(
    apiKey: string
  ): Promise<APIKeyValidationResult> {
    // Get all active API keys from database
    const results = await this.dbClient.cachedQuery<
      {
        id: string;
        name: string;
        keyHash: string;
        keyPreview: string;
        userId: string;
        storeId?: string;
        permissions?: string;
        scopes: string[];
        lastUsedAt?: Date;
        usageCount: number;
        isActive: boolean;
        expiresAt?: Date;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >(`
      SELECT id, name, "keyHash", "keyPreview", "userId", "storeId", 
             permissions, scopes, "lastUsedAt", "usageCount", "isActive", 
             "expiresAt", "createdAt", "updatedAt"
      FROM api_keys 
      WHERE "isActive" = true 
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
        AND "revokedAt" IS NULL
    `);

    // Check each key against the provided API key using bcrypt
    for (const keyRecord of results) {
      try {
        const isValid = await bcrypt.compare(apiKey, keyRecord.keyHash);

        if (isValid) {
          // Parse permissions if they exist
          const permissions = keyRecord.permissions
            ? JSON.parse(keyRecord.permissions as string)
            : [];

          // Create user info from API key data
          const userInfo: UserInfo = {
            id: keyRecord.userId,
            email: undefined,
            name: undefined,
            username: `api-key-${keyRecord.id}`,
            roles: keyRecord.scopes || [],
            permissions: permissions || [],
          };

          const keyData: APIKey = {
            id: keyRecord.id,
            name: keyRecord.name,
            keyHash: keyRecord.keyHash,
            keyPreview: keyRecord.keyPreview,
            userId: keyRecord.userId,
            ...(keyRecord.storeId && { storeId: keyRecord.storeId }),
            permissions,
            scopes: keyRecord.scopes || [],
            ...(keyRecord.lastUsedAt && { lastUsedAt: keyRecord.lastUsedAt }),
            usageCount: keyRecord.usageCount,
            isActive: keyRecord.isActive,
            ...(keyRecord.expiresAt && { expiresAt: keyRecord.expiresAt }),
            createdAt: keyRecord.createdAt,
            updatedAt: keyRecord.updatedAt,
          };

          return {
            success: true,
            user: userInfo,
            keyData,
            ...(keyRecord.expiresAt && { expiresAt: keyRecord.expiresAt }),
          };
        }
      } catch (bcryptError) {
        // Continue to next key if bcrypt comparison fails
        continue;
      }
    }

    return {
      success: false,
      error: "Invalid API key",
    };
  }

  /**
   * Update API key usage statistics
   */
  private async updateKeyUsage(keyId: string): Promise<void> {
    try {
      await this.dbClient.executeRaw(
        `UPDATE api_keys 
         SET "usageCount" = "usageCount" + 1, 
             "lastUsedAt" = NOW(), 
             "updatedAt" = NOW() 
         WHERE id = $1`,
        keyId
      );
    } catch (error) {
      this.logger.warn("Failed to update key usage", { keyId, error });
    }
  }

  /**
   * Revoke an API key
   */
  async revokeAPIKey(
    keyId: string,
    revokedBy: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.dbClient.executeRaw(
        `UPDATE api_keys 
         SET "isActive" = false, 
             "revokedAt" = NOW(), 
             "revokedBy" = $2, 
             "updatedAt" = NOW(),
             metadata = COALESCE(metadata, '{}')::jsonb || $3::jsonb
         WHERE id = $1`,
        keyId,
        revokedBy,
        JSON.stringify({ revocationReason: reason })
      );

      // Clear cache for this key if caching is enabled
      if (this.cacheService) {
        // We can't directly clear the cache for this key since we don't have the original key
        // but the cache will expire naturally
        this.logger.debug("API key revoked, cache will expire naturally", {
          keyId,
        });
      }

      this.stats.activeKeys--;
      this.stats.revokedKeys++;

      this.logger.info("API key revoked", { keyId, revokedBy, reason });
      this.metrics?.recordCounter("keycloak.api_key_manager.key_revoked", 1);

      return { success: true };
    } catch (error) {
      this.logger.error("API key revocation failed", { keyId, error });
      this.metrics?.recordCounter("keycloak.api_key_manager.revoke_error", 1);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Revocation failed",
      };
    }
  }

  /**
   * Get API keys for a user
   */
  async getUserAPIKeys(userId: string): Promise<APIKey[]> {
    try {
      const results = await this.dbClient.cachedQuery<
        {
          id: string;
          name: string;
          keyHash: string;
          keyPreview: string;
          userId: string;
          storeId?: string;
          permissions?: string;
          scopes: string[];
          lastUsedAt?: Date;
          usageCount: number;
          isActive: boolean;
          expiresAt?: Date;
          createdAt: Date;
          updatedAt: Date;
          revokedAt?: Date;
          revokedBy?: string;
          metadata?: string;
        }[]
      >(
        `
        SELECT id, name, "keyHash", "keyPreview", "userId", "storeId", 
               permissions, scopes, "lastUsedAt", "usageCount", "isActive", 
               "expiresAt", "createdAt", "updatedAt", "revokedAt", "revokedBy", metadata
        FROM api_keys 
        WHERE "userId" = $1 
        ORDER BY "createdAt" DESC
      `,
        [userId]
      );

      return results.map((record) => ({
        id: record.id,
        name: record.name,
        keyHash: record.keyHash, // Note: Don't expose this in real APIs
        keyPreview: record.keyPreview,
        userId: record.userId,
        ...(record.storeId && { storeId: record.storeId }),
        permissions: record.permissions ? JSON.parse(record.permissions) : [],
        scopes: record.scopes || [],
        ...(record.lastUsedAt && { lastUsedAt: record.lastUsedAt }),
        usageCount: record.usageCount,
        isActive: record.isActive,
        ...(record.expiresAt && { expiresAt: record.expiresAt }),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...(record.revokedAt && { revokedAt: record.revokedAt }),
        ...(record.revokedBy && { revokedBy: record.revokedBy }),
        ...(record.metadata && { metadata: JSON.parse(record.metadata) }),
      }));
    } catch (error) {
      this.logger.error("Failed to get user API keys", { userId, error });
      throw error;
    }
  }

  /**
   * Generate a secure API key
   */
  private generateSecureKey(prefix?: string): string {
    const randomBytes = crypto.randomBytes(32);
    const key = randomBytes.toString("base64url");
    return prefix ? `${prefix}_${key}` : `ak_${key}`;
  }

  /**
   * Hash API key for cache keys (not for storage)
   */
  private hashKey(apiKey: string): string {
    return crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Get API key manager statistics
   */
  getStats(): APIKeyManagerStats {
    return { ...this.stats };
  }

  /**
   * Health check for API key manager
   */
  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: any;
  }> {
    try {
      // Test database connectivity
      await this.dbClient.executeRaw("SELECT 1");

      return {
        status: "healthy",
        details: {
          database: "connected",
          cache: this.cacheService ? "enabled" : "disabled",
          stats: this.stats,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        details: {
          database: "disconnected",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }
}
