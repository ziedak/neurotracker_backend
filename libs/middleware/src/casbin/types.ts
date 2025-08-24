/**
 * @fileoverview Casbin Middleware Types - Enterprise Authorization
 * @module middleware/casbin/types
 * @version 1.0.0
 * @description Type-safe Casbin middleware configuration and interfaces
 */

import type { MiddlewareOptions } from "../types";

/**
 * Casbin authorization result
 */
export interface CasbinAuthResult {
  readonly allowed: boolean;
  readonly reason: string;
  readonly user?: UserContext;
  readonly resource?: string;
  readonly action?: string;
  readonly domain?: string;
  readonly matchedPolicies?: ReadonlyArray<string>;
  readonly appliedRoles?: ReadonlyArray<string>;
  readonly executionTime?: number;
  readonly cached?: boolean;
}

/**
 * Authorization context for permission checks
 */
export interface AuthorizationContext {
  readonly userId: string;
  readonly resource: string;
  readonly action: string;
  readonly tenant?: string;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Policy definition for Casbin
 */
export interface PolicyDefinition {
  readonly subject: string; // user, role
  readonly object: string; // resource
  readonly action: string; // action
  readonly effect?: "allow" | "deny";
  readonly conditions?: Record<string, unknown>;
}

/**
 * Role hierarchy entry
 */
export interface RoleHierarchyEntry {
  readonly childRole: string;
  readonly parentRole: string;
  readonly inherited: boolean;
}

/**
 * Cache configuration for policies
 */
export interface CasbinCacheConfig {
  readonly enabled: boolean;
  readonly ttl: number; // seconds
  readonly maxSize: number;
  readonly keyPrefix: string;
  readonly invalidationStrategy: "manual" | "ttl" | "hybrid";
}

/**
 * Database adapter configuration
 */
export interface DatabaseAdapterConfig {
  readonly autoSave: boolean;
  readonly syncInterval: number; // milliseconds
  readonly batchSize: number;
  readonly connectionTimeout: number;
}

/**
 * Casbin model configuration
 */
export interface CasbinModelConfig {
  readonly requestDefinition: string;
  readonly policyDefinition: string;
  readonly roleDefinition: string;
  readonly policyEffect: string;
  readonly matchers: string;
}

/**
 * Main Casbin middleware configuration
 */
export interface CasbinConfig extends MiddlewareOptions {
  readonly model: CasbinModelConfig;
  readonly cache: CasbinCacheConfig;
  readonly database: DatabaseAdapterConfig;
  readonly policies: {
    readonly autoLoad: boolean;
    readonly watchForChanges: boolean;
    readonly defaultEffect: "allow" | "deny";
    readonly strictMode: boolean;
  };
  readonly authorization: {
    readonly requireAuthentication: boolean;
    readonly defaultRole: string;
    readonly adminRole: string;
    readonly superAdminBypass: boolean;
  };
  readonly performance: {
    readonly enableMetrics: boolean;
    readonly enableTracing: boolean;
    readonly slowQueryThreshold: number; // milliseconds
    readonly maxConcurrentChecks: number;
  };
  readonly fallback: {
    readonly onError: "allow" | "deny" | "throw";
    readonly onDatabaseUnavailable: "allow" | "deny" | "cache_only";
    readonly retryAttempts: number;
    readonly retryDelay: number; // milliseconds
  };
}

/**
 * User context extracted from Lucia session or API key
 */
export interface UserContext {
  readonly id: string;
  readonly email?: string;
  readonly username?: string;
  readonly roles: ReadonlyArray<string>;
  readonly permissions: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
  readonly storeId?: string;
  readonly organizationId?: string;
  readonly sessionId?: string;
  readonly apiKeyId?: string;
}

/**
 * Policy synchronization status
 */
export interface PolicySyncStatus {
  readonly lastSync: Date;
  readonly policyCount: number;
  readonly roleCount: number;
  readonly errors: ReadonlyArray<string>;
  readonly syncDuration: number;
}

/**
 * Casbin metrics for monitoring
 */
export interface CasbinMetrics {
  readonly authorizationChecks: number;
  readonly authorizationDenials: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly policyLoads: number;
  readonly averageResponseTime: number;
  readonly errorRate: number;
  readonly concurrentChecks: number;
}

/**
 * Policy change event
 */
export interface PolicyChangeEvent {
  readonly type: "add" | "remove" | "update";
  readonly policy: PolicyDefinition;
  readonly timestamp: Date;
  readonly userId?: string;
}

/**
 * Resource definition for dynamic permissions
 */
export interface ResourceDefinition {
  readonly name: string;
  readonly pattern: string; // URL pattern or resource pattern
  readonly actions: ReadonlyArray<string>;
  readonly requiredPermissions: ReadonlyArray<string>;
  readonly requiredRoles?: ReadonlyArray<string>;
  readonly conditions?: Record<string, unknown>;
}

/**
 * Permission evaluation result
 */
export interface PermissionEvaluation {
  readonly resource: string;
  readonly action: string;
  readonly granted: boolean;
  readonly reason: string;
  readonly appliedPolicies: ReadonlyArray<string>;
  readonly evaluationTime: number;
}

/**
 * Batch authorization request
 */
export interface BatchAuthRequest {
  readonly userId: string;
  readonly checks: ReadonlyArray<{
    resource: string;
    action: string;
    context?: Record<string, unknown>;
  }>;
}

/**
 * Batch authorization request
 */
export interface BatchAuthRequest {
  readonly subject: string;
  readonly object: string;
  readonly action: string;
  readonly domain?: string;
}

/**
 * Batch authorization result
 */
export interface BatchAuthResult extends BatchAuthRequest {
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * Default Casbin configuration
 */
export const DEFAULT_CASBIN_CONFIG: Omit<CasbinConfig, "name"> = {
  enabled: true,
  priority: 100,
  skipPaths: ["/health", "/metrics", "/docs"],

  model: {
    requestDefinition: "[request_definition]\nr = sub, obj, act",
    policyDefinition: "[policy_definition]\np = sub, obj, act, eft",
    roleDefinition: "[role_definition]\ng = _, _",
    policyEffect:
      "[policy_effect]\ne = some(where (p.eft == allow)) && !some(where (p.eft == deny))",
    matchers:
      "[matchers]\nm = g(r.sub, p.sub) && keyMatch(r.obj, p.obj) && regexMatch(r.act, p.act)",
  },

  cache: {
    enabled: true,
    ttl: 300, // 5 minutes
    maxSize: 10000,
    keyPrefix: "casbin:",
    invalidationStrategy: "hybrid",
  },

  database: {
    autoSave: true,
    syncInterval: 30000, // 30 seconds
    batchSize: 100,
    connectionTimeout: 5000,
  },

  policies: {
    autoLoad: true,
    watchForChanges: true,
    defaultEffect: "deny",
    strictMode: true,
  },

  authorization: {
    requireAuthentication: true,
    defaultRole: "user",
    adminRole: "admin",
    superAdminBypass: true,
  },

  performance: {
    enableMetrics: true,
    enableTracing: true,
    slowQueryThreshold: 100,
    maxConcurrentChecks: 1000,
  },

  fallback: {
    onError: "deny",
    onDatabaseUnavailable: "cache_only",
    retryAttempts: 3,
    retryDelay: 1000,
  },
} as const;
