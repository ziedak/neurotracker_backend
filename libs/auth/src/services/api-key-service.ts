/**
 * API Key Management Service
 * Handles API key generation, validation, and lifecycle management
 * Provides secure API key authentication with Redis storage
 */

import { uuidv4 } from "@libs/utils";
import {
  ApiKey,
  ApiKeyCreateData,
  AuthConfig,
  ServiceDependencies,
  AuthError,
} from "../types";

// ===================================================================
// API KEY SERVICE CLASS
// ===================================================================

export class ApiKeyService {
  constructor(private config: AuthConfig, private deps: ServiceDependencies) {}

  /**
   * Create a new API key for user
   */
  async createApiKey(userId: string, data: ApiKeyCreateData): Promise<ApiKey> {
    try {
      const apiKeyId = uuidv4();
      const key = this.generateApiKey();

      const now = new Date();
      const expiresAt =
        data.expiresAt ||
        new Date(
          now.getTime() + 365 * 24 * 60 * 60 * 1000 // 1 year default
        );

      const apiKeyData: Partial<ApiKey> = {
        id: apiKeyId,
        name: data.name,
        key,
        userId,
        permissions: data.permissions,
        isActive: true,
        expiresAt,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      // Don't set lastUsed explicitly - let it be undefined
      const apiKey: ApiKey = apiKeyData as ApiKey;

      // Store API key in Redis
      await this.storeApiKey(apiKey);

      // Store key-to-id mapping for fast lookup
      await this.deps.redis.setex(
        `api_key:${key}`,
        Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
        apiKeyId
      );

      this.deps.monitoring.logger.info("API key created", {
        apiKeyId,
        userId,
        name: data.name,
      });

      return apiKey;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to create API key", {
        userId,
        name: data.name,
        error,
      });
      throw new AuthError("Failed to create API key", "API_KEY_CREATE_FAILED");
    }
  }

  /**
   * Get API key by ID
   */
  async getApiKey(apiKeyId: string): Promise<ApiKey | null> {
    try {
      const apiKeyData = await this.deps.redis.get(`api_key_data:${apiKeyId}`);
      if (!apiKeyData) {
        return null;
      }

      const apiKey: ApiKey = JSON.parse(apiKeyData);

      // Check if API key is expired
      if (!apiKey.expiresAt || new Date() > new Date(apiKey.expiresAt)) {
        await this.deleteApiKey(apiKeyId);
        return null;
      }

      return apiKey;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get API key", {
        apiKeyId,
        error,
      });
      return null;
    }
  }

  /**
   * Get API key by key value
   */
  async getApiKeyByKey(key: string): Promise<ApiKey | null> {
    try {
      const apiKeyId = await this.deps.redis.get(`api_key:${key}`);
      if (!apiKeyId) {
        return null;
      }

      return await this.getApiKey(apiKeyId);
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get API key by key", {
        error,
      });
      return null;
    }
  }

  /**
   * Validate API key and return user ID
   */
  async validateApiKey(
    key: string
  ): Promise<{ userId: string; permissions: string[] } | null> {
    try {
      const apiKey = await this.getApiKeyByKey(key);
      if (!apiKey || !apiKey.isActive) {
        return null;
      }

      // Update usage statistics
      await this.updateApiKeyUsage(apiKey.id);

      return {
        userId: apiKey.userId,
        permissions: apiKey.permissions,
      };
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to validate API key", {
        error,
      });
      return null;
    }
  }

  /**
   * Update API key
   */
  async updateApiKey(
    apiKeyId: string,
    updates: Partial<
      Pick<ApiKey, "name" | "permissions" | "isActive" | "expiresAt">
    >
  ): Promise<boolean> {
    try {
      const apiKey = await this.getApiKey(apiKeyId);
      if (!apiKey) {
        return false;
      }

      // Update fields
      if (updates.name !== undefined) {
        apiKey.name = updates.name;
      }
      if (updates.permissions !== undefined) {
        apiKey.permissions = updates.permissions;
      }
      if (updates.isActive !== undefined) {
        apiKey.isActive = updates.isActive;
      }
      if (updates.expiresAt !== undefined) {
        apiKey.expiresAt = updates.expiresAt;
      }

      apiKey.updatedAt = new Date();

      // Store updated API key
      await this.storeApiKey(apiKey);

      this.deps.monitoring.logger.info("API key updated", {
        apiKeyId,
        updates: Object.keys(updates),
      });

      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to update API key", {
        apiKeyId,
        error,
      });
      return false;
    }
  }

  /**
   * Delete API key
   */
  async deleteApiKey(apiKeyId: string): Promise<boolean> {
    try {
      const apiKey = await this.getApiKey(apiKeyId);
      if (!apiKey) {
        return false;
      }

      // Delete API key data
      await this.deps.redis.del(`api_key_data:${apiKeyId}`);

      // Delete key-to-id mapping
      await this.deps.redis.del(`api_key:${apiKey.key}`);

      this.deps.monitoring.logger.info("API key deleted", {
        apiKeyId,
        key: apiKey.key.substring(0, 8) + "...", // Log partial key for debugging
      });

      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to delete API key", {
        apiKeyId,
        error,
      });
      return false;
    }
  }

  /**
   * Get all API keys for user
   */
  async getUserApiKeys(userId: string): Promise<ApiKey[]> {
    try {
      const pattern = `api_key_data:*`;
      const keys = await this.deps.redis.keys(pattern);

      const userApiKeys: ApiKey[] = [];
      for (const key of keys) {
        const apiKeyData = await this.deps.redis.get(key);
        if (apiKeyData) {
          const apiKey: ApiKey = JSON.parse(apiKeyData);
          if (apiKey.userId === userId) {
            // Check if API key is expired
            if (!apiKey.expiresAt || new Date() <= new Date(apiKey.expiresAt)) {
              userApiKeys.push(apiKey);
            } else {
              // Clean up expired API key
              await this.deps.redis.del(key);
              await this.deps.redis.del(`api_key:${apiKey.key}`);
            }
          }
        }
      }

      return userApiKeys;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get user API keys", {
        userId,
        error,
      });
      return [];
    }
  }

  /**
   * Regenerate API key
   */
  async regenerateApiKey(apiKeyId: string): Promise<ApiKey | null> {
    try {
      const oldApiKey = await this.getApiKey(apiKeyId);
      if (!oldApiKey) {
        return null;
      }

      // Delete old key mapping
      await this.deps.redis.del(`api_key:${oldApiKey.key}`);

      // Generate new key
      const newKey = this.generateApiKey();
      oldApiKey.key = newKey;
      oldApiKey.updatedAt = new Date();

      // Store updated API key
      await this.storeApiKey(oldApiKey);

      // Store new key-to-id mapping
      const ttl = oldApiKey.expiresAt
        ? Math.ceil((oldApiKey.expiresAt.getTime() - Date.now()) / 1000)
        : 365 * 24 * 60 * 60; // 1 year default

      await this.deps.redis.setex(`api_key:${newKey}`, ttl, apiKeyId);

      this.deps.monitoring.logger.info("API key regenerated", {
        apiKeyId,
      });

      return oldApiKey;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to regenerate API key", {
        apiKeyId,
        error,
      });
      return null;
    }
  }

  /**
   * Clean up expired API keys
   */
  async cleanupExpiredApiKeys(): Promise<number> {
    try {
      const pattern = `api_key_data:*`;
      const keys = await this.deps.redis.keys(pattern);

      let cleanedCount = 0;
      for (const key of keys) {
        const apiKeyData = await this.deps.redis.get(key);
        if (apiKeyData) {
          const apiKey: ApiKey = JSON.parse(apiKeyData);
          if (!apiKey.expiresAt || new Date() > new Date(apiKey.expiresAt)) {
            await this.deps.redis.del(key);
            await this.deps.redis.del(`api_key:${apiKey.key}`);
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        this.deps.monitoring.logger.info("Expired API keys cleaned up", {
          count: cleanedCount,
        });
      }

      return cleanedCount;
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to cleanup expired API keys", {
        error,
      });
      return 0;
    }
  }

  /**
   * Get API key statistics
   */
  async getApiKeyStats(): Promise<{
    total: number;
    active: number;
    expired: number;
  }> {
    try {
      const pattern = `api_key_data:*`;
      const keys = await this.deps.redis.keys(pattern);

      let total = 0;
      let active = 0;
      let expired = 0;

      for (const key of keys) {
        const apiKeyData = await this.deps.redis.get(key);
        if (apiKeyData) {
          total++;
          const apiKey: ApiKey = JSON.parse(apiKeyData);
          if (!apiKey.expiresAt || new Date() <= new Date(apiKey.expiresAt)) {
            active++;
          } else {
            expired++;
          }
        }
      }

      return { total, active, expired };
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get API key stats", {
        error,
      });
      return { total: 0, active: 0, expired: 0 };
    }
  }

  // ===================================================================
  // PRIVATE METHODS
  // ===================================================================

  private generateApiKey(): string {
    const prefix = this.config.apiKey.prefix;
    const length = this.config.apiKey.length;
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = prefix;

    for (let i = prefix.length; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
  }

  private async storeApiKey(apiKey: ApiKey): Promise<void> {
    const ttl = apiKey.expiresAt
      ? Math.ceil((apiKey.expiresAt.getTime() - Date.now()) / 1000)
      : 365 * 24 * 60 * 60; // 1 year default

    await this.deps.redis.setex(
      `api_key_data:${apiKey.id}`,
      ttl,
      JSON.stringify(apiKey)
    );
  }

  private async updateApiKeyUsage(apiKeyId: string): Promise<void> {
    try {
      const apiKey = await this.getApiKey(apiKeyId);
      if (apiKey) {
        apiKey.usageCount++;
        apiKey.lastUsed = new Date();
        await this.storeApiKey(apiKey);
      }
    } catch (error) {
      // Don't throw error for usage update failures
      this.deps.monitoring.logger.warn("Failed to update API key usage", {
        apiKeyId,
        error,
      });
    }
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create API key service instance
 */
export function createApiKeyService(
  config: AuthConfig,
  deps: ServiceDependencies
): ApiKeyService {
  return new ApiKeyService(config, deps);
}

/**
 * Validate API key format
 */
export function validateApiKeyFormat(key: string, config: AuthConfig): boolean {
  const prefix = config.apiKey.prefix;
  const expectedLength = config.apiKey.length;

  return (
    key.startsWith(prefix) &&
    key.length === expectedLength &&
    /^[A-Za-z0-9]+$/.test(key.substring(prefix.length))
  );
}

export default ApiKeyService;
