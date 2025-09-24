/**
 * Cache manager for ability factory
 * Handles distributed caching with validation and pattern operations
 */

import { createHash } from "crypto";
import { createLogger } from "@libs/utils";
import type { CacheService } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  AppAbility,
  AuthorizationContext,
} from "../../types/authorization.types";
import type {
  CachedAbility,
  CacheStats,
  HealthCheckResult,
} from "./AbilityFactoryTypes";
import type { AbilityFactoryConstants } from "./AbilityFactoryConfig";
import {
  AbilityCacheError,
  AbilityValidationError,
} from "./AbilityFactoryErrors";
import { createMongoAbility } from "@casl/ability";

export class AbilityCacheManager {
  private readonly logger = createLogger("AbilityCacheManager");

  constructor(
    private readonly cacheService: CacheService,
    private readonly metrics: IMetricsCollector | undefined,
    private readonly constants: AbilityFactoryConstants,
    private readonly cacheTimeout: number
  ) {}

  /**
   * Get cached ability with proper deserialization and validation
   */
  async getCachedAbility(cacheKey: string): Promise<AppAbility | null> {
    try {
      const result = await this.cacheService.get<CachedAbility>(cacheKey);

      if (
        result.data &&
        this.isValidCachedAbility(result.data) &&
        this.isCacheValid(result.data.timestamp)
      ) {
        return this.deserializeAbility(result.data.rules);
      }

      return null;
    } catch (error) {
      // Escalate cache errors instead of hiding them
      throw new AbilityCacheError(
        "Failed to retrieve cached ability",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * Cache ability with proper serialization
   */
  async cacheAbility(
    context: AuthorizationContext,
    ability: AppAbility
  ): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(context);
      const cachedData: CachedAbility = {
        rules: ability.rules,
        timestamp: Date.now(),
        userId: context.userId,
        roles: context.roles,
      };

      const ttlSeconds = Math.floor(this.cacheTimeout / 1000);
      await this.cacheService.set(cacheKey, cachedData, ttlSeconds);

      this.metrics?.recordCounter("authorization.ability.cache_set", 1, {
        userId: context.userId,
      });
    } catch (error) {
      this.logger.warn("Failed to cache ability", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: context.userId,
      });
    }
  }

  /**
   * Generate secure cache key for user context
   */
  getCacheKey(context: AuthorizationContext): string {
    const data = {
      userId: context.userId,
      roles: context.roles.sort(),
      sessionId: context.sessionId, // Include session for uniqueness
      timestamp: Math.floor(
        Date.now() / this.constants.CACHE_ROTATION_INTERVAL_MS
      ), // Cache rotation
    };

    // Use crypto hash instead of predictable base64 encoding
    const hash = createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex")
      .substring(0, 16); // Use first 16 chars for efficiency

    return `ability:${hash}`;
  }

  /**
   * Validate cached ability structure
   */
  private isValidCachedAbility(data: any): data is CachedAbility {
    if (!data || typeof data !== "object") {
      return false;
    }

    return (
      typeof data.timestamp === "number" &&
      typeof data.userId === "string" &&
      Array.isArray(data.roles) &&
      Array.isArray(data.rules) &&
      data.timestamp > 0 &&
      data.userId.length > 0 &&
      data.roles.every((role: any) => typeof role === "string")
    );
  }

  /**
   * Check if cached ability is still valid
   */
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.cacheTimeout;
  }

  /**
   * Deserialize ability from stored format with validation
   */
  private deserializeAbility(rulesJson: string | any[]): AppAbility {
    try {
      let rules: any[];

      if (Array.isArray(rulesJson)) {
        rules = rulesJson;
      } else if (typeof rulesJson === "string") {
        rules = JSON.parse(rulesJson);
        if (!Array.isArray(rules)) {
          throw new AbilityValidationError(
            "Deserialized rules must be an array"
          );
        }
      } else {
        throw new AbilityValidationError("Rules must be string or array");
      }

      return createMongoAbility(rules) as AppAbility;
    } catch (error) {
      this.logger.error("Failed to deserialize ability", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return this.createRestrictiveAbility();
    }
  }

  /**
   * Create a restrictive ability for error cases
   */
  private createRestrictiveAbility(): AppAbility {
    return createMongoAbility([]) as AppAbility;
  }

  /**
   * Clear cached abilities using pattern matching
   */
  async clearCache(userId?: string): Promise<void> {
    try {
      let pattern: string;

      if (userId) {
        // Create pattern to match specific user's abilities
        // Since we hash the userId in getCacheKey, we need to clear all
        pattern = "ability:*";
      } else {
        // Clear all abilities
        pattern = "ability:*";
      }

      const clearedCount = await this.cacheService.invalidatePattern(pattern);

      this.logger.info("Ability cache cleared", {
        userId: userId ? `${userId.substring(0, 8)}***` : "all",
        clearedCount,
      });

      this.metrics?.recordCounter("authorization.ability.cache_cleared", 1, {
        userId: userId || "all",
        clearedCount: clearedCount.toString(),
      });
    } catch (error) {
      this.logger.error("Failed to clear ability cache", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: userId ? `${userId.substring(0, 8)}***` : "all",
      });

      this.metrics?.recordCounter(
        "authorization.ability.cache_clear_error",
        1,
        {
          userId: userId || "all",
        }
      );
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const stats: CacheStats = {
      enabled: true,
      hasCacheService: true,
      pendingComputations: 0, // This will be managed by ComputationTracker
    };

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

    return stats;
  }

  /**
   * Health check for cache service
   */
  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const cacheHealth = await this.cacheService.healthCheck();

      if (cacheHealth.status === "critical") {
        return {
          status: "degraded",
          details: {
            cache: cacheHealth,
            issue: "Cache service is in critical state",
          },
        };
      }

      return {
        status: "healthy",
        details: {
          cache: cacheHealth,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }
}
