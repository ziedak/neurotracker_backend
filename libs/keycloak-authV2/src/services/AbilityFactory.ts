/**
 * CASL Ability Factory Service
 *
 * Creates and manages user abilities using CASL for role-based
 * and attribute-based access control.
 */

import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import type {
  AppAbility,
  AuthorizationContext,
  AbilityFactoryConfig,
  Role,
  Permission,
} from "../types/authorization.types";

export type { AbilityFactoryConfig };
import {
  ROLE_DEFINITIONS,
  getEffectivePermissions,
} from "../config/roles.config";
import type { IMetricsCollector } from "@libs/monitoring";

/**
 * Factory service for creating user abilities
 */
export class AbilityFactory {
  private readonly config: Required<AbilityFactoryConfig>;
  private readonly abilityCache = new Map<
    string,
    { ability: AppAbility; timestamp: number }
  >();

  constructor(
    private readonly metrics?: IMetricsCollector,
    config: AbilityFactoryConfig = {}
  ) {
    this.config = {
      enableCaching: config.enableCaching ?? true,
      cacheTimeout: config.cacheTimeout ?? 300_000, // 5 minutes
      defaultRole: config.defaultRole ?? "guest",
      strictMode: config.strictMode ?? true,
      auditEnabled: config.auditEnabled ?? true,
    };
  }

  /**
   * Create ability for a user context
   */
  createAbilityForUser(context: AuthorizationContext): AppAbility {
    const cacheKey = this.getCacheKey(context);

    // Check cache if enabled
    if (this.config.enableCaching) {
      const cached = this.abilityCache.get(cacheKey);
      if (cached && this.isCacheValid(cached.timestamp)) {
        this.metrics?.recordCounter("authorization.ability.cache_hit", 1, {
          userId: context.userId,
        });
        return cached.ability;
      }
    }

    // Create new ability
    const ability = this.buildAbility(context);

    // Cache if enabled
    if (this.config.enableCaching) {
      this.abilityCache.set(cacheKey, {
        ability,
        timestamp: Date.now(),
      });
      this.metrics?.recordCounter("authorization.ability.cache_miss", 1, {
        userId: context.userId,
      });
    }

    this.metrics?.recordCounter("authorization.ability.created", 1, {
      userId: context.userId,
      rolesCount: context.roles.length.toString(),
    });

    return ability;
  }

  /**
   * Build ability from user context
   */
  private buildAbility(context: AuthorizationContext): AppAbility {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(
      createMongoAbility
    );

    try {
      // Get all effective permissions for user roles
      const permissions = this.getEffectivePermissionsForRoles(context.roles);

      // Apply permissions to ability builder
      for (const permission of permissions) {
        const conditions = this.resolveConditions(
          permission.conditions,
          context
        );

        if (permission.inverted) {
          cannot(permission.action, permission.subject, conditions);
        } else {
          if (permission.fields) {
            can(
              permission.action,
              permission.subject,
              permission.fields,
              conditions
            );
          } else {
            can(permission.action, permission.subject, conditions);
          }
        }
      }

      // Apply additional context-based permissions
      this.applyContextualPermissions(can, context);

      return build() as AppAbility;
    } catch (error) {
      this.metrics?.recordCounter("authorization.ability.build_error", 1, {
        userId: context.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Return restrictive ability on error
      return build() as AppAbility;
    }
  }

  /**
   * Get effective permissions for multiple roles
   */
  private getEffectivePermissionsForRoles(roles: Role[]): Permission[] {
    const allPermissions: Permission[] = [];

    for (const role of roles) {
      if (ROLE_DEFINITIONS[role]) {
        allPermissions.push(...getEffectivePermissions(role));
      }
    }

    // Remove duplicates and resolve conflicts
    return this.deduplicatePermissions(allPermissions);
  }

  /**
   * Resolve permission conditions with user context
   */
  private resolveConditions(
    conditions: Record<string, any> | undefined,
    context: AuthorizationContext
  ): Record<string, any> | undefined {
    if (!conditions) {
      return undefined;
    }

    return this.interpolateVariables(conditions, {
      user: {
        id: context.userId,
        roles: context.roles,
        ...context.attributes,
      },
    });
  }

  /**
   * Interpolate template variables in conditions
   */
  private interpolateVariables(obj: any, variables: Record<string, any>): any {
    if (typeof obj === "string") {
      // Replace ${variable.path} patterns
      return obj.replace(/\$\{([^}]+)\}/g, (match, path) => {
        const value = this.getNestedValue(variables, path);
        return value !== undefined ? value : match;
      });
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.interpolateVariables(item, variables));
    }

    if (obj && typeof obj === "object") {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateVariables(value, variables);
      }
      return result;
    }

    return obj;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  /**
   * Apply additional contextual permissions
   */
  private applyContextualPermissions(
    can: any,
    context: AuthorizationContext
  ): void {
    // Apply session-based permissions
    if (context.sessionId) {
      can("read", "Session", { id: context.sessionId });
      can("delete", "Session", { userId: context.userId });
    }

    // Apply IP-based restrictions if needed
    if (this.config.strictMode && context.ipAddress) {
      // Add IP-based restrictions for sensitive operations
      // This is an example - implement based on your security requirements
    }
  }

  /**
   * Remove duplicate permissions and resolve conflicts
   */
  private deduplicatePermissions(permissions: Permission[]): Permission[] {
    const seen = new Map<string, Permission>();

    for (const permission of permissions) {
      const existing = seen.get(permission.id);

      if (!existing) {
        seen.set(permission.id, permission);
      } else {
        // Handle conflicts - more permissive wins unless explicitly denied
        if (permission.inverted && !existing.inverted) {
          seen.set(permission.id, permission); // Denial takes precedence
        } else if (!permission.inverted && !existing.inverted) {
          // Merge fields if both are grants
          const mergedFields = [
            ...(existing.fields || []),
            ...(permission.fields || []),
          ];
          const uniqueFields =
            mergedFields.length > 0 ? [...new Set(mergedFields)] : undefined;

          seen.set(permission.id, {
            ...existing,
            fields: uniqueFields,
          });
        }
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Generate cache key for user context
   */
  private getCacheKey(context: AuthorizationContext): string {
    const key = `${context.userId}:${context.roles.sort().join(",")}`;
    return `ability:${Buffer.from(key).toString("base64")}`;
  }

  /**
   * Check if cached ability is still valid
   */
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.config.cacheTimeout;
  }

  /**
   * Clear cached abilities
   */
  clearCache(userId?: string): void {
    if (userId) {
      // Clear specific user's cached abilities
      for (const [key] of this.abilityCache) {
        if (key.includes(userId)) {
          this.abilityCache.delete(key);
        }
      }
    } else {
      // Clear all cached abilities
      this.abilityCache.clear();
    }

    this.metrics?.recordCounter("authorization.ability.cache_cleared", 1, {
      userId: userId || "all",
    });
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    hitRate: number;
    oldestEntry: number | null;
  } {
    const now = Date.now();
    let oldestTimestamp: number | null = null;

    for (const [, cached] of this.abilityCache) {
      if (oldestTimestamp === null || cached.timestamp < oldestTimestamp) {
        oldestTimestamp = cached.timestamp;
      }
    }

    return {
      size: this.abilityCache.size,
      hitRate: 0, // Would need to track hits/misses for accurate rate
      oldestEntry: oldestTimestamp ? now - oldestTimestamp : null,
    };
  }
}
