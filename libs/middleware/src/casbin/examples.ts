/**
 * @fileoverview Casbin Middleware Usage Examples
 * @module middleware/casbin/examples
 * @version 1.0.0
 * @description Comprehensive examples for using Casbin middleware with Lucia auth
 */

import type { PrismaClient } from "@libs/database";
import { Logger } from "@libs/monitoring";
import { createCasbinMiddleware, casbinPresets } from "./factory";
import type { CasbinConfig } from "./types";

/**
 * Example 1: Basic setup with default configuration
 */
export async function basicCasbinSetup(prisma: PrismaClient, redis?: any) {
  const middleware = createCasbinMiddleware(
    {
      name: "BasicCasbin",
      enabled: true,
      skipPaths: ["/health", "/metrics", "/docs"],
    },
    prisma,
    Logger.getInstance("CasbinExample"),
    undefined,
    redis
  );

  return middleware;
}

/**
 * Example 2: Production setup with full configuration
 */
export async function productionCasbinSetup(prisma: PrismaClient, redis: any) {
  const middleware = casbinPresets.production(prisma, redis, {
    // Override specific settings
    skipPaths: ["/health", "/metrics", "/swagger"],
    policies: {
      autoLoad: true,
      watchForChanges: true,
      defaultEffect: "deny",
      strictMode: true,
    },
    performance: {
      enableMetrics: true,
      enableTracing: true,
      slowQueryThreshold: 50,
      maxConcurrentChecks: 10000,
    },
  });

  return middleware;
}

/**
 * Example 3: Development setup with relaxed policies
 */
export async function developmentCasbinSetup(prisma: PrismaClient) {
  const middleware = casbinPresets.development(prisma, {
    // Additional skip paths for development
    skipPaths: [
      "/health",
      "/metrics",
      "/docs",
      "/swagger",
      "/test",
      "/dev",
      "/api/v1/dev/*",
    ],
    fallback: {
      onError: "allow",
      onDatabaseUnavailable: "allow",
      retryAttempts: 1,
      retryDelay: 500,
    },
  });

  return middleware;
}

/**
 * Example 4: API-specific setup for microservices
 */
export async function apiCasbinSetup(prisma: PrismaClient) {
  const middleware = casbinPresets.api(prisma, {
    authorization: {
      requireAuthentication: true,
      defaultRole: "api_client",
      adminRole: "service_admin",
      superAdminBypass: false,
    },
    cache: {
      enabled: true,
      ttl: 900, // 15 minutes for API
      maxSize: 50000,
      keyPrefix: "casbin:api:",
      invalidationStrategy: "hybrid",
    },
  });

  return middleware;
}

/**
 * Example 5: Custom model configuration
 */
export async function customModelCasbinSetup(prisma: PrismaClient) {
  const customConfig: Partial<CasbinConfig> = {
    model: {
      requestDefinition: "[request_definition]\nr = sub, obj, act, tenant",
      policyDefinition: "[policy_definition]\np = sub, obj, act, eft, tenant",
      roleDefinition: "[role_definition]\ng = _, _\ng2 = _, _, _", // Multi-tenancy
      policyEffect:
        "[policy_effect]\ne = some(where (p.eft == allow)) && !some(where (p.eft == deny))",
      matchers:
        "[matchers]\nm = g(r.sub, p.sub) && g2(r.sub, p.tenant, r.tenant) && keyMatch(r.obj, p.obj) && regexMatch(r.act, p.act)",
    },
    policies: {
      autoLoad: true,
      watchForChanges: true,
      defaultEffect: "deny",
      strictMode: true,
    },
  };

  const middleware = createCasbinMiddleware(
    customConfig,
    prisma,
    Logger.getInstance("CasbinCustomModel")
  );

  return middleware;
}

/**
 * Example 6: Integration with Lucia auth session
 */
export class LuciaCasbinIntegration {
  private casbinMiddleware: any;
  private lucia: any; // Lucia instance

  constructor(casbinMiddleware: any, lucia: any) {
    this.casbinMiddleware = casbinMiddleware;
    this.lucia = lucia;
  }

  /**
   * Middleware wrapper that integrates Lucia session validation with Casbin authorization
   */
  public middleware() {
    return async (context: any, next: () => Promise<void>) => {
      try {
        // First validate Lucia session
        const sessionId = this.extractSessionId(context);
        if (sessionId) {
          const sessionValidation = await this.lucia.validateSession(sessionId);
          if (sessionValidation.session && sessionValidation.user) {
            // Add validated user to context for Casbin
            context.user = {
              id: sessionValidation.user.id,
              email: sessionValidation.user.email,
              username: sessionValidation.user.username,
              roles: sessionValidation.user.roles || [],
              permissions: sessionValidation.user.permissions || [],
              sessionId: sessionValidation.session.id,
            };
          }
        }

        // Then run Casbin authorization
        return await this.casbinMiddleware.execute(context, next);
      } catch (error) {
        console.error("Lucia-Casbin integration error:", error);
        throw error;
      }
    };
  }

  private extractSessionId(context: any): string | null {
    const authHeader = context.request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    const cookies = context.request.headers.cookie;
    if (cookies) {
      const sessionMatch = cookies.match(/lucia-session=([^;]+)/);
      return sessionMatch ? sessionMatch[1] : null;
    }

    return null;
  }
}

/**
 * Example 7: Role-based middleware factory
 */
export function createRoleBasedCasbinMiddleware(
  requiredRoles: string[],
  prisma: PrismaClient,
  redis?: any
) {
  const config: Partial<CasbinConfig> = {
    authorization: {
      requireAuthentication: true,
      defaultRole: "user",
      adminRole: "admin",
      superAdminBypass: true,
    },
    // Custom validation for required roles
    skipPaths: [],
  };

  const middleware = createCasbinMiddleware(
    config,
    prisma,
    undefined,
    undefined,
    redis
  );

  // Return wrapped middleware that checks roles
  return {
    ...middleware,
    async execute(context: any): Promise<void> {
      // First run standard Casbin check
      await middleware.execute(context);

      // If we get here without exception, Casbin check passed
      // Do additional role validation
      const user = context.user;
      if (user && requiredRoles.length > 0) {
        const hasRequiredRole = requiredRoles.some(
          (role) => user.roles.includes(role) || user.roles.includes("admin")
        );

        if (!hasRequiredRole) {
          throw new Error(
            `Insufficient roles. Required: ${requiredRoles.join(", ")}`
          );
        }
      }
    },
  };
}

/**
 * Example 8: Permission-based middleware factory
 */
export function createPermissionBasedCasbinMiddleware(
  requiredPermissions: string[],
  prisma: PrismaClient,
  redis?: any
) {
  const config: Partial<CasbinConfig> = {
    authorization: {
      requireAuthentication: true,
      defaultRole: "user",
      adminRole: "admin",
      superAdminBypass: true,
    },
  };

  const middleware = createCasbinMiddleware(
    config,
    prisma,
    undefined,
    undefined,
    redis
  );

  return {
    ...middleware,
    async execute(context: any): Promise<void> {
      // First run standard Casbin check
      await middleware.execute(context);

      // If we get here without exception, Casbin check passed
      // Do additional permission validation
      const user = context.user;
      if (user && requiredPermissions.length > 0) {
        const hasRequiredPermission = requiredPermissions.some(
          (permission) =>
            user.permissions.includes(permission) ||
            user.permissions.includes("*") ||
            user.roles.includes("admin")
        );

        if (!hasRequiredPermission) {
          throw new Error(
            `Insufficient permissions. Required: ${requiredPermissions.join(
              ", "
            )}`
          );
        }
      }
    },
  };
}

/**
 * Example usage in Elysia application
 */
export function elysiaUsageExample() {
  return `
import { Elysia } from 'elysia';
import { PrismaClient } from '@libs/database';
import { createCasbinMiddleware, casbinPresets } from '@libs/middleware';

const app = new Elysia();
const prisma = new PrismaClient();
const redis = null; // Your Redis client

// Basic setup
const basicCasbin = createCasbinMiddleware({
  name: 'BasicAuth',
  skipPaths: ['/health', '/public/*']
}, prisma, redis);

// Production setup
const prodCasbin = casbinPresets.production(prisma, redis);

// Apply middleware
app
  .use(basicCasbin.middleware())
  .get('/protected', ({ user }) => {
    return { message: 'Access granted', user: user.id };
  })
  .get('/admin', ({ user, authResult }) => {
    return { 
      message: 'Admin access', 
      user: user.id,
      policies: authResult.matchedPolicies 
    };
  });

export default app;
  `;
}

/**
 * Example database policy setup
 */
export async function setupDatabasePolicies(prisma: PrismaClient) {
  // This would typically be done through database migrations or admin interface

  // Create roles
  await prisma.role.createMany({
    data: [
      {
        name: "admin",
        displayName: "Administrator",
        description: "Full system access",
        category: "system",
        level: 1,
        isActive: true,
      },
      {
        name: "user",
        displayName: "Regular User",
        description: "Standard user access",
        category: "user",
        level: 5,
        isActive: true,
      },
      {
        name: "analyst",
        displayName: "Data Analyst",
        description: "Analytics and reporting access",
        category: "functional",
        level: 3,
        isActive: true,
      },
    ],
    skipDuplicates: true,
  });

  // Get created roles
  const adminRole = await prisma.role.findUnique({ where: { name: "admin" } });
  const userRole = await prisma.role.findUnique({ where: { name: "user" } });
  const analystRole = await prisma.role.findUnique({
    where: { name: "analyst" },
  });

  if (!adminRole || !userRole || !analystRole) {
    throw new Error("Failed to create required roles");
  }

  // Create permissions
  const permissions = [
    // Admin permissions
    { roleId: adminRole.id, resource: "*", action: "*", name: "admin:all" },

    // User permissions
    {
      roleId: userRole.id,
      resource: "users",
      action: "get",
      name: "users:read",
    },
    {
      roleId: userRole.id,
      resource: "users",
      action: "put",
      name: "users:update",
    },
    { roleId: userRole.id, resource: "carts", action: "*", name: "carts:all" },
    {
      roleId: userRole.id,
      resource: "orders",
      action: "get",
      name: "orders:read",
    },
    {
      roleId: userRole.id,
      resource: "orders",
      action: "post",
      name: "orders:create",
    },

    // Analyst permissions
    {
      roleId: analystRole.id,
      resource: "analytics",
      action: "get",
      name: "analytics:read",
    },
    {
      roleId: analystRole.id,
      resource: "reports",
      action: "get",
      name: "reports:read",
    },
    {
      roleId: analystRole.id,
      resource: "reports",
      action: "post",
      name: "reports:create",
    },
  ];

  await prisma.rolePermission.createMany({
    data: permissions.map((p) => ({
      ...p,
      description: `${p.name} permission`,
      priority: "medium",
      version: "1.0.0",
    })),
    skipDuplicates: true,
  });

  console.log("Database policies setup completed");
}
