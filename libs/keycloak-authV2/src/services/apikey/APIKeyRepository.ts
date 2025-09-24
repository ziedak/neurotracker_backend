/**
 * API Key Repository - Single Responsibility: Database operations
 * 
 * Handles:
 * - CRUD operations for API keys
 * - Database queries and transactions
 * - Data mapping and transformation
 * - Database-specific error handling
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import { PostgreSQLClient } from "@libs/database";
import type { APIKey, APIKeyManagerStats } from "./types";

export class APIKeyRepository {
  private readonly logger: ILogger;
  private readonly dbClient: PostgreSQLClient;

  constructor(
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector
  ) {
    this.logger = logger || createLogger("APIKeyRepository");
    this.dbClient = new PostgreSQLClient(metrics);
  }

  /**
   * Create a new API key in the database
   */
  async createAPIKey(
    keyData: APIKey,
    keyIdentifier: string
  ): Promise<APIKey> {
    try {
      await this.dbClient.executeRaw(
        `INSERT INTO api_keys (
          id, name, "keyHash", "keyIdentifier", "keyPreview", "userId", "storeId", 
          permissions, scopes, "usageCount", "isActive", "expiresAt", 
          "createdAt", "updatedAt", metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          keyData.id,
          keyData.name,
          keyData.keyHash,
          keyIdentifier,
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

      this.logger.info("API key created in database", {
        keyId: keyData.id,
        userId: keyData.userId,
      });

      this.metrics?.recordCounter("apikey.repository.key_created", 1);
      return keyData;
    } catch (error) {
      this.logger.error("Failed to create API key in database", {
        keyId: keyData.id,
        error,
      });
      
      // Enhanced error handling for database operations
      if (error instanceof Error) {
        if (error.message.includes("duplicate key") || error.message.includes("unique constraint")) {
          throw new Error("API key creation failed due to conflict, please try again");
        }
        if (error.message.includes("connection") || error.message.includes("timeout")) {
          throw new Error("Database connection error during key creation");
        }
      }
      
      this.metrics?.recordCounter("apikey.repository.create_error", 1);
      throw error;
    }
  }

  /**
   * Find API key by key identifier for O(1) lookup
   */
  async findByKeyIdentifier(keyIdentifier: string): Promise<APIKey | null> {
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
        WHERE "keyIdentifier" = $1
          AND "isActive" = true 
          AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
          AND "revokedAt" IS NULL
        LIMIT 1
      `,
        [keyIdentifier]
      );

      const keyRecord = results[0];
      if (!keyRecord) {
        this.metrics?.recordCounter("apikey.repository.key_not_found", 1);
        return null;
      }

      this.metrics?.recordCounter("apikey.repository.key_found", 1);
      return this.mapDatabaseRecordToAPIKey(keyRecord);
    } catch (error) {
      this.logger.error("Failed to find API key by identifier", {
        keyIdentifier: keyIdentifier.slice(0, 8) + "***",
        error,
      });
      this.metrics?.recordCounter("apikey.repository.find_error", 1);
      throw new Error("Database error during key lookup");
    }
  }

  /**
   * Get all API keys for a specific user
   */
  async findByUserId(userId: string): Promise<APIKey[]> {
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

      this.metrics?.recordCounter("apikey.repository.user_keys_fetched", 1);
      return results.map((record) => this.mapDatabaseRecordToAPIKey(record, true));
    } catch (error) {
      this.logger.error("Failed to fetch user API keys", { userId, error });
      this.metrics?.recordCounter("apikey.repository.user_keys_error", 1);
      
      if (error instanceof Error) {
        if (error.message.includes("connection") || error.message.includes("timeout")) {
          throw new Error(`Database connection error while fetching API keys for user ${userId}`);
        }
        if (error.message.includes("JSON") || error.message.includes("parse")) {
          throw new Error(`Data corruption detected in API keys for user ${userId}`);
        }
      }
      
      throw new Error(`Failed to fetch API keys for user ${userId}: ${error}`);
    }
  }

  /**
   * Update API key usage statistics
   */
  async updateUsage(keyId: string): Promise<void> {
    try {
      await this.dbClient.executeRaw(
        `UPDATE api_keys 
         SET "usageCount" = "usageCount" + 1, 
             "lastUsedAt" = NOW(), 
             "updatedAt" = NOW() 
         WHERE id = $1`,
        [keyId]
      );

      this.metrics?.recordCounter("apikey.repository.usage_updated", 1);
    } catch (error) {
      this.logger.warn("Failed to update key usage statistics", {
        keyId,
        error,
      });
      this.metrics?.recordCounter("apikey.repository.usage_update_error", 1);
      // Don't throw - usage tracking failures shouldn't break validation
    }
  }

  /**
   * Revoke an API key
   */
  async revokeKey(
    keyId: string,
    revokedBy: string,
    reason?: string
  ): Promise<void> {
    try {
      await this.dbClient.executeRaw(
        `UPDATE api_keys 
         SET "isActive" = false, 
             "revokedAt" = NOW(), 
             "revokedBy" = $2, 
             "updatedAt" = NOW(),
             metadata = COALESCE(metadata, '{}')::jsonb || $3::jsonb
         WHERE id = $1`,
        [keyId, revokedBy, JSON.stringify({ revocationReason: reason })]
      );

      this.logger.info("API key revoked in database", {
        keyId,
        revokedBy,
        reason,
      });

      this.metrics?.recordCounter("apikey.repository.key_revoked", 1);
    } catch (error) {
      this.logger.error("Failed to revoke API key", { keyId, error });
      this.metrics?.recordCounter("apikey.repository.revoke_error", 1);
      
      if (error instanceof Error) {
        if (error.message.includes("no rows affected") || error.message.includes("not found")) {
          throw new Error("API key not found or already revoked");
        }
        if (error.message.includes("connection") || error.message.includes("timeout")) {
          throw new Error("Database connection error during revocation");
        }
      }
      
      throw error;
    }
  }

  /**
   * Get comprehensive API key statistics
   */
  async getStats(): Promise<APIKeyManagerStats> {
    try {
      const statsResult = await this.dbClient.cachedQuery<
        {
          total_keys: number;
          active_keys: number;
          expired_keys: number;
          revoked_keys: number;
        }[]
      >(
        `
        SELECT 
          COUNT(*) as total_keys,
          COUNT(*) FILTER (WHERE "isActive" = true) as active_keys,
          COUNT(*) FILTER (WHERE "expiresAt" < NOW()) as expired_keys,
          COUNT(*) FILTER (WHERE "revokedAt" IS NOT NULL) as revoked_keys
        FROM api_keys
        `,
        []
      );

      const stats = statsResult[0];

      this.metrics?.recordCounter("apikey.repository.stats_fetched", 1);

      return {
        totalKeys: stats?.total_keys || 0,
        activeKeys: stats?.active_keys || 0,
        expiredKeys: stats?.expired_keys || 0,
        revokedKeys: stats?.revoked_keys || 0,
        validationsToday: 0, // This is tracked by usage tracker
        cacheHitRate: 0, // This is tracked by cache manager
        lastResetAt: new Date(),
      };
    } catch (error) {
      this.logger.error("Failed to fetch API key statistics", { error });
      this.metrics?.recordCounter("apikey.repository.stats_error", 1);
      
      // Return empty stats on error rather than throwing
      return {
        totalKeys: 0,
        activeKeys: 0,
        expiredKeys: 0,
        revokedKeys: 0,
        validationsToday: 0,
        cacheHitRate: 0,
        lastResetAt: new Date(),
      };
    }
  }

  /**
   * Health check - test database connectivity
   */
  async healthCheck(): Promise<{ connected: boolean; error?: string }> {
    try {
      await this.dbClient.executeRaw("SELECT 1", []);
      return { connected: true };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : "Unknown database error",
      };
    }
  }

  /**
   * Map database record to APIKey interface
   */
  private mapDatabaseRecordToAPIKey(
    record: any,
    hideKeyHash: boolean = false
  ): APIKey {
    return {
      id: record.id,
      name: record.name,
      keyHash: hideKeyHash ? "" : record.keyHash, // Never expose key hash in list operations
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
    };
  }

  /**
   * Cleanup method for component lifecycle
   */
  cleanup(): void {
    this.logger.info("APIKeyRepository cleanup completed");
  }
}