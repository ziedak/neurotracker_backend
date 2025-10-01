/**
 * Ability service types
 *
 * Consolidated type definitions for ability/authorization services
 */

import type { HealthCheckResult } from "../common";
import type { UserInfo } from "../shared/auth";

/**
 * Application ability interface
 * Represents the authorization capabilities for a user
 */
export interface AppAbility {
  readonly rules: AbilityRule[];
  readonly userId: string;
  readonly roles: Role[];
  readonly createdAt: Date;
  readonly expiresAt?: Date;
}

/**
 * Individual ability rule
 */
export interface AbilityRule {
  readonly action: string;
  readonly subject: string;
  readonly conditions?: Record<string, any>;
  readonly inverted: boolean;
  readonly reason?: string;
}

/**
 * Role definition
 */
export interface Role {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions: Permission[];
  readonly priority: number;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Permission definition
 */
export interface Permission {
  readonly id: string;
  readonly name: string;
  readonly action: string;
  readonly resource: string;
  readonly conditions?: Record<string, any>;
  readonly description?: string;
}

/**
 * Cached ability data
 */
export interface CachedAbility {
  readonly rules: AbilityRule[];
  readonly timestamp: number;
  readonly userId: string;
  readonly roles: Role[];
  readonly expiresAt: number;
  readonly version: string;
}

/**
 * Pending computation tracking
 */
export interface PendingComputation {
  readonly promise: Promise<AppAbility>;
  readonly timestamp: number;
  readonly timeout: NodeJS.Timeout;
  readonly userId: string;
  readonly requestId: string;
}

/**
 * Ability cache statistics
 */
export interface AbilityCacheStats {
  readonly enabled: boolean;
  readonly hasCacheService: boolean;
  readonly pendingComputations: number;
  readonly totalComputations: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly averageComputationTime: number;
  readonly lastCleanup: Date;
  readonly serviceStats?: any;
}

/**
 * Authorization context
 */
export interface AuthorizationContext {
  readonly user: UserInfo;
  readonly ability: AppAbility;
  readonly computedAt: Date;
  readonly source: "cache" | "computed" | "fallback";
  readonly cacheKey: string;
}

/**
 * Authorization check result
 */
export interface AuthorizationResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly matchedRule?: AbilityRule;
  readonly context: AuthorizationContext;
  readonly checkedAt: Date;
  readonly performance: {
    readonly duration: number;
    readonly cacheHit: boolean;
  };
}

/**
 * Ability factory configuration
 */
export interface AbilityFactoryConfig {
  readonly cache: {
    readonly enabled: boolean;
    readonly ttl: number;
    readonly maxEntries: number;
    readonly cleanupInterval: number;
  };
  readonly computation: {
    readonly timeout: number;
    readonly retryAttempts: number;
    readonly retryDelay: number;
    readonly enableFallback: boolean;
  };
  readonly roles: {
    readonly refreshInterval: number;
    readonly enableHierarchy: boolean;
    readonly defaultRole: string;
  };
}

/**
 * Role hierarchy definition
 */
export interface RoleHierarchy {
  readonly parentRole: string;
  readonly childRole: string;
  readonly level: number;
  readonly inherited: boolean;
}

/**
 * Permission check options
 */
export interface PermissionCheckOptions {
  readonly strict: boolean;
  readonly includeInherited: boolean;
  readonly contextData?: Record<string, any>;
  readonly bypassCache: boolean;
}

/**
 * Ability computation metrics
 */
export interface AbilityMetrics {
  readonly totalComputations: number;
  readonly successfulComputations: number;
  readonly failedComputations: number;
  readonly cacheHitRate: number;
  readonly averageComputationTime: number;
  readonly peakComputationTime: number;
  readonly timeoutCount: number;
  readonly fallbackCount: number;
  readonly lastReset: Date;
}

/**
 * Type guards and utility functions
 */
export function isAppAbility(obj: any): obj is AppAbility {
  return (
    typeof obj === "object" &&
    obj !== null &&
    Array.isArray(obj.rules) &&
    typeof obj.userId === "string" &&
    Array.isArray(obj.roles) &&
    obj.createdAt instanceof Date
  );
}

export function isCachedAbility(obj: any): obj is CachedAbility {
  return (
    typeof obj === "object" &&
    obj !== null &&
    Array.isArray(obj.rules) &&
    typeof obj.timestamp === "number" &&
    typeof obj.userId === "string" &&
    Array.isArray(obj.roles)
  );
}

export function isAuthorizationResult(obj: any): obj is AuthorizationResult {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof obj.allowed === "boolean" &&
    obj.checkedAt instanceof Date &&
    obj.context &&
    obj.performance
  );
}

// Re-export commonly used types
export type { HealthCheckResult };
export type { UserInfo };
