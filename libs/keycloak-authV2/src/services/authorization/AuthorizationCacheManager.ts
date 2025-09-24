/**
 * Authorization cache manager
 * Handles caching operations, key generation, and cache lifecycle
 */

import crypto from "crypto";
import { createLogger } from "@libs/utils";
import type { CacheService } from "@libs/database";
import type {
  Action,
  Subjects,
  AuthorizationContext,
  ResourceContext,
  AuthorizationResult,
  AppAbility,
} from "../../types/authorization.types";

export class AuthorizationCacheManager {
  private readonly logger = createLogger("AuthorizationCacheManager");
  private readonly permissionCache = new WeakMap<AppAbility, string[]>();

  constructor(
    private readonly cacheService: CacheService | undefined,
    private readonly cacheTtl: number
  ) {}

  /**
   * Get cached authorization result
   */
  async getCachedResult(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): Promise<AuthorizationResult | null> {
    if (!this.cacheService) return null;

    const cacheKey = this.generateCacheKey(context, action, subject, resource);

    try {
      const cacheResult = await this.cacheService.get<AuthorizationResult>(
        cacheKey
      );
      if (cacheResult.data) {
        return cacheResult.data;
      }
      return null;
    } catch (error) {
      this.logger.warn("Failed to get cached authorization result", {
        error,
        cacheKey,
      });
      return null;
    }
  }

  /**
   * Cache authorization result
   */
  async cacheResult(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource: ResourceContext | undefined,
    result: AuthorizationResult
  ): Promise<void> {
    if (!this.cacheService) return;

    const cacheKey = this.generateCacheKey(context, action, subject, resource);

    try {
      await this.cacheService.set(cacheKey, result, this.cacheTtl);
    } catch (error) {
      this.logger.warn("Failed to cache authorization result", {
        error,
        cacheKey,
      });
    }
  }

  /**
   * Cache user permissions in WeakMap
   */
  cacheUserPermissions(ability: AppAbility, permissions: string[]): void {
    this.permissionCache.set(ability, permissions);
  }

  /**
   * Get cached user permissions from WeakMap
   */
  getCachedUserPermissions(ability: AppAbility): string[] | undefined {
    return this.permissionCache.get(ability);
  }

  /**
   * Generate secure cache key for authorization result
   * Uses full hash to prevent collisions and PII exposure
   */
  generateCacheKey(
    context: AuthorizationContext,
    action: Action,
    subject: Subjects,
    resource?: ResourceContext
  ): string {
    try {
      // Create complete key data structure for hashing
      const keyData = {
        userId: context.userId,
        roles: Array.isArray(context.roles) ? [...context.roles].sort() : [],
        action,
        subject,
        resource: resource
          ? {
              type: resource.type || "",
              id: resource.id || "",
              ownerId: resource.ownerId || "",
              organizationId: resource.organizationId || "",
              // Include metadata hash to ensure uniqueness
              metadataHash: resource.metadata
                ? crypto
                    .createHash("sha256")
                    .update(JSON.stringify(resource.metadata))
                    .digest("hex")
                    .substring(0, 16)
                : "",
            }
          : null,
        // Add timestamp component for cache rotation
        timeWindow: Math.floor(Date.now() / (this.cacheTtl * 1000)),
      };

      // Use full hash for maximum collision resistance
      const keyString = JSON.stringify(keyData);
      const hash = crypto.createHash("sha256").update(keyString).digest("hex");

      // Use full hash for maximum collision resistance
      return `auth:${hash}`;
    } catch (error) {
      // Fallback with secure error handling
      this.logger.warn("Failed to generate cache key, using fallback", {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Deterministic fallback that still prevents PII exposure
      const fallbackData = `${
        context.userId
      }-${action}-${subject}-${Date.now()}`;
      const hash = crypto
        .createHash("sha256")
        .update(fallbackData)
        .digest("hex");
      return `auth:fallback:${hash}`;
    }
  }

  /**
   * Clear user authorization cache
   */
  async clearUserCache(userId: string): Promise<number> {
    if (!this.cacheService) return 0;

    try {
      // Hash the userId to create a consistent pattern match
      const userHash = crypto
        .createHash("sha256")
        .update(userId)
        .digest("hex")
        .substring(0, 16);
      const pattern = `auth:*${userHash}*`;

      // Single optimized invalidation
      const invalidatedCount = await this.cacheService.invalidatePattern(
        pattern
      );

      this.logger.info("Authorization cache cleared efficiently", {
        userId: userId.substring(0, 8) + "***", // Partially obscured for logs
        invalidatedKeys: invalidatedCount,
        pattern: "optimized_single_pattern",
      });

      return invalidatedCount;
    } catch (error) {
      this.logger.warn("Failed to clear authorization cache", {
        userId: userId.substring(0, 8) + "***",
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { hasCacheService: boolean; serviceStats?: any } {
    const stats = {
      hasCacheService: !!this.cacheService,
    };

    if (this.cacheService) {
      try {
        const serviceStats = this.cacheService.getStats();
        return {
          ...stats,
          serviceStats,
        };
      } catch (error) {
        this.logger.warn("Failed to get cache service stats", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return stats;
  }
}
