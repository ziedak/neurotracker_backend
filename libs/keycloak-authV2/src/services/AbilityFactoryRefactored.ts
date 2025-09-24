/**
 * CASL Ability Factory Service - Refactored
 *
 * Clean orchestrator following Single Responsibility Principle
 * Delegates specific concerns to focused components
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { CacheService } from "@libs/database";
import type {
  AppAbility,
  AuthorizationContext,
} from "../types/authorization.types";

// Modular components
import {
  AbilityConfigManager,
  type AbilityFactoryConfig,
} from "./ability/AbilityFactoryConfig";
import { ComputationTracker } from "./ability/ComputationTracker";
import { AbilityCacheManager } from "./ability/AbilityCacheManager";
import { AbilityBuilderService } from "./ability/AbilityBuilderService";
import { PermissionResolver } from "./ability/PermissionResolver";
import type {
  CacheStats,
  HealthCheckResult,
} from "./ability/AbilityFactoryTypes";
import { AbilityFactoryError } from "./ability/AbilityFactoryErrors";

/**
 * Refactored AbilityFactory - Clean orchestrator
 *
 * Responsibilities:
 * - Orchestrate ability creation workflow
 * - Input validation
 * - Error handling and metrics
 * - Lifecycle management
 */
export class AbilityFactory {
  private readonly logger = createLogger("AbilityFactory");
  private readonly configManager: AbilityConfigManager;
  private readonly computationTracker: ComputationTracker;
  private readonly cacheManager?: AbilityCacheManager;
  private readonly abilityBuilder: AbilityBuilderService;
  private readonly permissionResolver: PermissionResolver;

  constructor(
    private readonly metrics?: IMetricsCollector,
    private readonly cacheService?: CacheService,
    config: AbilityFactoryConfig = {}
  ) {
    // Initialize configuration
    this.configManager = new AbilityConfigManager(config);
    const constants = this.configManager.getConstants();
    const finalConfig = this.configManager.getConfig();

    // Initialize core components
    this.computationTracker = new ComputationTracker(constants);
    this.abilityBuilder = new AbilityBuilderService(
      metrics,
      constants,
      finalConfig.strictMode
    );
    this.permissionResolver = new PermissionResolver();

    // Initialize cache manager if caching enabled
    if (finalConfig.enableCaching && cacheService) {
      this.cacheManager = new AbilityCacheManager(
        cacheService,
        metrics,
        constants,
        finalConfig.cacheTimeout
      );
    }

    this.logger.debug("AbilityFactory initialized", {
      enableCaching: finalConfig.enableCaching,
      cacheTimeout: finalConfig.cacheTimeout,
      hasCacheService: !!cacheService,
      components: {
        configManager: true,
        computationTracker: true,
        abilityBuilder: true,
        permissionResolver: true,
        cacheManager: !!this.cacheManager,
      },
    });
  }

  /**
   * Create ability for a user context - Main entry point
   */
  async createAbilityForUser(
    context: AuthorizationContext
  ): Promise<AppAbility> {
    // Input validation
    if (!this.isValidContext(context)) {
      this.logger.warn("Invalid context provided to createAbilityForUser", {
        hasUserId: !!context?.userId,
        hasRoles: Array.isArray(context?.roles),
      });
      return this.abilityBuilder.createRestrictiveAbility();
    }

    const config = this.configManager.getConfig();

    // Check cache and race conditions if enabled
    if (config.enableCaching && this.cacheManager) {
      return this.createAbilityWithCaching(context);
    }

    // Direct computation without caching
    return this.computeAbility(context);
  }

  /**
   * Create ability with caching strategy
   */
  private async createAbilityWithCaching(
    context: AuthorizationContext
  ): Promise<AppAbility> {
    const cacheKey = this.cacheManager!.getCacheKey(context);

    // Check for pending computation to prevent duplicate work
    const pendingComputation =
      this.computationTracker.getPendingComputation(cacheKey);
    if (pendingComputation) {
      this.metrics?.recordCounter("authorization.ability.pending_hit", 1, {
        userId: context.userId,
      });
      return pendingComputation;
    }

    // Try cache first
    try {
      const cachedResult = await this.cacheManager!.getCachedAbility(cacheKey);
      if (cachedResult) {
        this.metrics?.recordCounter("authorization.ability.cache_hit", 1, {
          userId: context.userId,
        });
        return cachedResult;
      }
    } catch (cacheError) {
      this.logger.warn("Cache retrieval failed, computing fresh ability", {
        error:
          cacheError instanceof Error ? cacheError.message : "Unknown error",
        userId: context.userId,
      });
    }

    // Create computation promise and track it to prevent race conditions
    const computationPromise = this.computeAbility(context);
    return this.computationTracker.trackComputation(
      cacheKey,
      computationPromise
    );
  }

  /**
   * Validate authorization context
   */
  private isValidContext(context: AuthorizationContext): boolean {
    return !!(context?.userId && Array.isArray(context.roles));
  }

  /**
   * Compute and cache ability
   */
  private async computeAbility(
    context: AuthorizationContext
  ): Promise<AppAbility> {
    const startTime = Date.now();

    try {
      // Build ability using the specialized builder
      const ability = this.abilityBuilder.buildAbility(context);

      // Cache the result if enabled
      if (this.configManager.isCachingEnabled() && this.cacheManager) {
        await this.cacheManager.cacheAbility(context, ability);
      }

      this.metrics?.recordCounter("authorization.ability.created", 1, {
        userId: context.userId,
        rolesCount: context.roles.length.toString(),
      });

      this.metrics?.recordTimer(
        "authorization.ability.computation_time",
        Date.now() - startTime,
        { userId: context.userId }
      );

      return ability;
    } catch (error) {
      this.metrics?.recordCounter("authorization.ability.build_error", 1, {
        userId: context.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      this.logger.error("Failed to compute ability", {
        error: error instanceof Error ? error.message : "Unknown error",
        userId: context.userId,
        roles: context.roles,
      });

      // Return restrictive ability on error
      return this.abilityBuilder.createRestrictiveAbility();
    }
  }

  /**
   * Serialize ability to storable format
   */
  serializeAbility(ability: AppAbility): string {
    return this.abilityBuilder.serializeAbility(ability);
  }

  /**
   * Deserialize ability from stored format
   */
  deserializeAbility(_rulesJson: string | any[]): AppAbility {
    // This method is delegated to the cache manager
    if (this.cacheManager) {
      // We need to expose this method from the cache manager
      throw new AbilityFactoryError("Deserialization requires cache manager");
    }
    return this.abilityBuilder.createRestrictiveAbility();
  }

  /**
   * Clear cached abilities
   */
  async clearCache(userId?: string): Promise<void> {
    if (!this.configManager.isCachingEnabled() || !this.cacheManager) {
      this.logger.debug(
        "Cache clearing skipped - caching disabled or no cache manager"
      );
      return;
    }

    await this.cacheManager.clearCache(userId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    const baseStats: CacheStats = {
      enabled: this.configManager.isCachingEnabled(),
      hasCacheService: !!this.cacheService,
      pendingComputations: this.computationTracker.getPendingCount(),
    };

    if (this.cacheManager) {
      const cacheStats = this.cacheManager.getCacheStats();
      return {
        ...baseStats,
        serviceStats: cacheStats.serviceStats,
      };
    }

    return baseStats;
  }

  /**
   * Health check for ability factory
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const details: any = {
      caching: this.configManager.isCachingEnabled(),
      pendingComputations: this.computationTracker.getPendingCount(),
      components: {
        configManager: true,
        computationTracker: true,
        abilityBuilder: true,
        permissionResolver: true,
        cacheManager: !!this.cacheManager,
      },
    };

    try {
      if (this.cacheManager) {
        const cacheHealth = await this.cacheManager.healthCheck();
        details.cache = cacheHealth.details;

        if (cacheHealth.status === "unhealthy") {
          return {
            status: "degraded",
            details: {
              ...details,
              issue: "Cache manager is unhealthy",
            },
          };
        }
      }

      return {
        status: "healthy",
        details,
      };
    } catch (error) {
      return {
        status: "unhealthy",
        details: {
          ...details,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Get permission changes for granular cache updates
   */
  getPermissionChanges(oldPermissions: any[], newPermissions: any[]) {
    return this.permissionResolver.getPermissionChanges(
      oldPermissions,
      newPermissions
    );
  }

  /**
   * Cleanup method for proper lifecycle management
   */
  async cleanup(): Promise<void> {
    try {
      // Cleanup computation tracker
      this.computationTracker.cleanup();

      this.logger.info("AbilityFactory cleanup completed");
    } catch (error) {
      this.logger.error("Failed to cleanup AbilityFactory", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

// Re-export types for backward compatibility
export type { AbilityFactoryConfig };
