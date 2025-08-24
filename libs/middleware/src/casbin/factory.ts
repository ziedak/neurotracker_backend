/**
 * @fileoverview Casbin Middleware Factory and Utilities
 * @module middleware/casbin/factory
 * @version 1.0.0
 * @description Factory functions and utilities for creating Casbin middleware instances
 */

import type { PrismaClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { CasbinMiddleware } from "./CasbinMiddleware";
import type {
  CasbinConfig,
  ResourceDefinition,
  PolicyDefinition,
} from "./types";
import { DEFAULT_CASBIN_CONFIG } from "./types";

/**
 * Factory function to create Casbin middleware instance
 */
export function createCasbinMiddleware(
  config: Partial<CasbinConfig>,
  prisma: PrismaClient,
  logger?: Logger,
  metrics?: MetricsCollector,
  redis?: any
): CasbinMiddleware {
  const fullConfig: CasbinConfig = {
    name: "CasbinMiddleware",
    ...DEFAULT_CASBIN_CONFIG,
    ...config,
  };

  const middlewareLogger = logger || Logger.getInstance("CasbinMiddleware");

  return new CasbinMiddleware(
    fullConfig,
    prisma,
    middlewareLogger,
    metrics,
    redis
  );
}

/**
 * Create Casbin middleware with predefined configurations
 */
export const casbinPresets = {
  /**
   * Strict security configuration
   */
  strict: (
    prisma: PrismaClient,
    overrides?: Partial<CasbinConfig>
  ): CasbinMiddleware => {
    const config: Partial<CasbinConfig> = {
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
        superAdminBypass: false, // No bypass for strict mode
      },
      cache: {
        enabled: true,
        ttl: 60, // 1 minute cache
        maxSize: 1000,
        keyPrefix: "casbin:strict:",
        invalidationStrategy: "ttl",
      },
      fallback: {
        onError: "deny",
        onDatabaseUnavailable: "deny",
        retryAttempts: 3,
        retryDelay: 1000,
      },
      ...overrides,
    };

    return createCasbinMiddleware(
      config,
      prisma,
      Logger.getInstance("CasbinMiddleware:Strict")
    );
  },

  /**
   * Development configuration with relaxed policies
   */
  development: (
    prisma: PrismaClient,
    overrides?: Partial<CasbinConfig>
  ): CasbinMiddleware => {
    const config: Partial<CasbinConfig> = {
      policies: {
        autoLoad: true,
        watchForChanges: true,
        defaultEffect: "allow", // More permissive for development
        strictMode: false,
      },
      authorization: {
        requireAuthentication: false, // Allow anonymous access
        defaultRole: "developer",
        adminRole: "admin",
        superAdminBypass: true,
      },
      cache: {
        enabled: false, // Disable cache for development
        ttl: 300,
        maxSize: 100,
        keyPrefix: "casbin:dev:",
        invalidationStrategy: "manual",
      },
      fallback: {
        onError: "allow", // Allow on error for development
        onDatabaseUnavailable: "allow",
        retryAttempts: 1,
        retryDelay: 500,
      },
      skipPaths: [
        "/health",
        "/metrics",
        "/docs",
        "/swagger",
        "/api/v1/dev",
        "/test",
      ],
      ...overrides,
    };

    return createCasbinMiddleware(
      config,
      prisma,
      Logger.getInstance("CasbinMiddleware:Dev")
    );
  },

  /**
   * Production configuration with optimized performance
   */
  production: (
    prisma: PrismaClient,
    redis: any,
    overrides?: Partial<CasbinConfig>
  ): CasbinMiddleware => {
    const config: Partial<CasbinConfig> = {
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
      cache: {
        enabled: true,
        ttl: 300, // 5 minutes
        maxSize: 50000,
        keyPrefix: "casbin:prod:",
        invalidationStrategy: "hybrid",
      },
      performance: {
        enableMetrics: true,
        enableTracing: true,
        slowQueryThreshold: 50,
        maxConcurrentChecks: 5000,
      },
      fallback: {
        onError: "deny",
        onDatabaseUnavailable: "cache_only",
        retryAttempts: 3,
        retryDelay: 1000,
      },
      skipPaths: ["/health", "/metrics"],
      ...overrides,
    };

    return createCasbinMiddleware(
      config,
      prisma,
      Logger.getInstance("CasbinMiddleware:Prod"),
      MetricsCollector.getInstance(),
      redis
    );
  },

  /**
   * API-specific configuration for service-to-service communication
   */
  api: (
    prisma: PrismaClient,
    overrides?: Partial<CasbinConfig>
  ): CasbinMiddleware => {
    const config: Partial<CasbinConfig> = {
      policies: {
        autoLoad: true,
        watchForChanges: false, // Static policies for APIs
        defaultEffect: "deny",
        strictMode: true,
      },
      authorization: {
        requireAuthentication: true,
        defaultRole: "api",
        adminRole: "service_admin",
        superAdminBypass: false,
      },
      cache: {
        enabled: true,
        ttl: 600, // 10 minutes - longer cache for API
        maxSize: 10000,
        keyPrefix: "casbin:api:",
        invalidationStrategy: "ttl",
      },
      performance: {
        enableMetrics: true,
        enableTracing: false, // Reduce overhead for high-volume APIs
        slowQueryThreshold: 10,
        maxConcurrentChecks: 10000,
      },
      ...overrides,
    };

    return createCasbinMiddleware(
      config,
      prisma,
      Logger.getInstance("CasbinMiddleware:API")
    );
  },
};

/**
 * Utility functions for policy management
 */
export class CasbinPolicyUtils {
  /**
   * Convert REST resource definitions to Casbin policies
   */
  static convertResourcesToPolicies(
    resources: ResourceDefinition[],
    roleName: string
  ): PolicyDefinition[] {
    const policies: PolicyDefinition[] = [];

    for (const resource of resources) {
      for (const action of resource.actions) {
        if (resource.requiredPermissions.length === 0) {
          // Direct resource-action permission
          policies.push({
            subject: roleName,
            object: resource.name,
            action,
            effect: "allow",
            ...(resource.conditions && { conditions: resource.conditions }),
          });
        } else {
          // Check if role has required permissions
          for (const permission of resource.requiredPermissions) {
            const [permResource, permAction] = permission.split(":");
            if (permResource && permAction) {
              policies.push({
                subject: roleName,
                object: permResource,
                action: permAction,
                effect: "allow",
                ...(resource.conditions && { conditions: resource.conditions }),
              });
            }
          }
        }
      }
    }

    return policies;
  }

  /**
   * Generate common REST API policies for a resource
   */
  static generateRestPolicies(
    resourceName: string,
    roleName: string,
    permissions: {
      read?: boolean;
      create?: boolean;
      update?: boolean;
      delete?: boolean;
      list?: boolean;
    } = {}
  ): PolicyDefinition[] {
    const policies: PolicyDefinition[] = [];

    if (permissions.read !== false) {
      policies.push({
        subject: roleName,
        object: resourceName,
        action: "get",
        effect: "allow",
      });
    }

    if (permissions.list !== false) {
      policies.push({
        subject: roleName,
        object: resourceName,
        action: "list",
        effect: "allow",
      });
    }

    if (permissions.create) {
      policies.push({
        subject: roleName,
        object: resourceName,
        action: "post",
        effect: "allow",
      });
    }

    if (permissions.update) {
      policies.push({
        subject: roleName,
        object: resourceName,
        action: "put",
        effect: "allow",
      });
      policies.push({
        subject: roleName,
        object: resourceName,
        action: "patch",
        effect: "allow",
      });
    }

    if (permissions.delete) {
      policies.push({
        subject: roleName,
        object: resourceName,
        action: "delete",
        effect: "allow",
      });
    }

    return policies;
  }

  /**
   * Generate hierarchical role policies
   */
  static generateHierarchicalPolicies(
    roleHierarchy: Record<string, string[]>
  ): PolicyDefinition[] {
    const policies: PolicyDefinition[] = [];

    for (const [childRole, parentRoles] of Object.entries(roleHierarchy)) {
      for (const parentRole of parentRoles) {
        policies.push({
          subject: childRole,
          object: parentRole,
          action: "inherit",
          effect: "allow",
        });
      }
    }

    return policies;
  }

  /**
   * Generate tenant-specific policies
   */
  static generateTenantPolicies(
    roleName: string,
    tenantId: string,
    resources: string[]
  ): PolicyDefinition[] {
    const policies: PolicyDefinition[] = [];

    for (const resource of resources) {
      policies.push({
        subject: roleName,
        object: `${resource}:tenant:${tenantId}`,
        action: "*",
        effect: "allow",
        conditions: { tenant: tenantId },
      });
    }

    return policies;
  }
}

/**
 * Common resource definitions for e-commerce applications
 */
export const commonResources: Record<string, ResourceDefinition> = {
  users: {
    name: "users",
    pattern: "/api/*/users/*",
    actions: ["get", "post", "put", "patch", "delete", "list"],
    requiredPermissions: ["users:read", "users:write", "users:delete"],
  },

  products: {
    name: "products",
    pattern: "/api/*/products/*",
    actions: ["get", "post", "put", "patch", "delete", "list"],
    requiredPermissions: ["products:read", "products:write", "products:delete"],
  },

  carts: {
    name: "carts",
    pattern: "/api/*/carts/*",
    actions: ["get", "post", "put", "patch", "delete", "list"],
    requiredPermissions: ["carts:read", "carts:write"],
  },

  orders: {
    name: "orders",
    pattern: "/api/*/orders/*",
    actions: ["get", "post", "put", "patch", "list"],
    requiredPermissions: ["orders:read", "orders:write"],
  },

  analytics: {
    name: "analytics",
    pattern: "/api/*/analytics/*",
    actions: ["get", "list"],
    requiredPermissions: ["analytics:read"],
    requiredRoles: ["analyst", "admin"],
  },

  admin: {
    name: "admin",
    pattern: "/api/*/admin/*",
    actions: ["get", "post", "put", "patch", "delete", "list"],
    requiredPermissions: ["admin:*"],
    requiredRoles: ["admin"],
  },
};

/**
 * Default role permissions for e-commerce applications
 */
export const defaultRolePermissions = {
  admin: CasbinPolicyUtils.generateRestPolicies("*", "admin", {
    read: true,
    create: true,
    update: true,
    delete: true,
    list: true,
  }),

  user: [
    ...CasbinPolicyUtils.generateRestPolicies("users", "user", {
      read: true,
      update: true,
    }),
    ...CasbinPolicyUtils.generateRestPolicies("carts", "user", {
      read: true,
      create: true,
      update: true,
      delete: true,
      list: true,
    }),
    ...CasbinPolicyUtils.generateRestPolicies("orders", "user", {
      read: true,
      create: true,
      list: true,
    }),
  ],

  analyst: [
    ...CasbinPolicyUtils.generateRestPolicies("analytics", "analyst", {
      read: true,
      list: true,
    }),
    ...CasbinPolicyUtils.generateRestPolicies("reports", "analyst", {
      read: true,
      create: true,
      list: true,
    }),
  ],

  service: [
    ...CasbinPolicyUtils.generateRestPolicies("api", "service", {
      read: true,
      create: true,
      update: true,
    }),
  ],
};
