/**
 * Keycloak Authentication Plugin for Elysia
 * Provides seamless integration with Elysia applications using plugin pattern
 */

import { Elysia } from "elysia";
import { type IMetricsCollector } from "@libs/monitoring";

import {
  KeycloakAuthHttpMiddleware,
  type KeycloakAuthHttpMiddlewareConfig,
  createKeycloakAuthHttpMiddleware,
  KEYCLOAK_AUTH_PRESETS,
} from "./keycloak-http.middleware.js";
import {
  IKeycloakClientFactory,
  ITokenIntrospectionService,
  type User,
  type AuthContext,
} from "../types/index.js";

/**
 * Configuration for Keycloak Elysia plugin
 */
export interface KeycloakElysiaConfig extends KeycloakAuthHttpMiddlewareConfig {
  /** Optional plugin name for identification */
  pluginName?: string;
}

/**
 * Extended Elysia context with Keycloak authentication data
 */
export interface KeycloakContext {
  user?: User;
  authContext?: AuthContext;
  keycloakAuth?: {
    method: "jwks" | "introspection" | "anonymous";
    client: "frontend" | "service" | "tracker" | "websocket";
    fromCache?: boolean;
    validationResult?: any;
  };
}

/**
 * Keycloak Authentication Plugin for Elysia
 *
 * Usage:
 * ```typescript
 * import { keycloakAuth } from '@libs/keycloak-auth';
 *
 * const app = new Elysia()
 *   .use(keycloakAuth(config))
 *   .get('/protected', ({ user }) => {
 *     return { message: 'Hello', user: user?.name };
 *   });
 * ```
 */
export function keycloakAuth(
  metrics: IMetricsCollector,
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService,
  config: KeycloakElysiaConfig = {}
) {
  const pluginName = config.pluginName ?? "keycloak-auth";

  // Create the middleware instance
  const middleware = createKeycloakAuthHttpMiddleware(
    metrics,
    keycloakClientFactory,
    tokenIntrospectionService,
    config
  );

  return new Elysia({ name: pluginName }).derive(async ({ request, set }) => {
    try {
      // Authenticate using our middleware
      const authResult = await middleware.authenticate(request);

      // Check authorization if needed
      if (authResult.user || config.requireAuth) {
        await middleware.authorize(authResult);
      }

      // Return authentication data to be merged into Elysia context
      return {
        user: authResult.user ?? undefined,
        authContext: authResult.authContext ?? undefined,
        keycloakAuth: {
          method: authResult.method,
          client: config.keycloakClient ?? "frontend",
          fromCache: authResult.fromCache ?? false,
          validationResult: authResult.validationResult,
        },
      } as Record<string, unknown>;
    } catch (error) {
      if (error instanceof Error) {
        // Map authentication errors to appropriate HTTP status
        if (
          error.message.includes("Unauthorized") ||
          error.name.includes("Unauthorized")
        ) {
          set.status = 401;
          return {
            error: "Unauthorized",
            message: error.message,
          };
        }

        if (
          error.message.includes("Forbidden") ||
          error.name.includes("Forbidden")
        ) {
          set.status = 403;
          return {
            error: "Forbidden",
            message: error.message,
          };
        }
      }

      // Re-throw unexpected errors
      throw error;
    }
  });
}

/**
 * Create Keycloak authentication middleware with preset configurations
 */
export class KeycloakAuthPresets {
  constructor(
    private metrics: IMetricsCollector,
    private keycloakClientFactory: IKeycloakClientFactory,
    private tokenIntrospectionService: ITokenIntrospectionService
  ) {}

  /**
   * Require authentication for all routes
   */
  requireAuth(
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KEYCLOAK_AUTH_PRESETS.requireAuth(client)
    );
  }

  /**
   * Optional authentication (extract user if token provided)
   */
  optionalAuth(
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KEYCLOAK_AUTH_PRESETS.optionalAuth(client)
    );
  }

  /**
   * Admin-only access
   */
  adminOnly(
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KEYCLOAK_AUTH_PRESETS.adminOnly(client)
    );
  }

  /**
   * User or admin access
   */
  userOrAdmin(
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KEYCLOAK_AUTH_PRESETS.userOrAdmin(client)
    );
  }

  /**
   * Service-to-service authentication
   */
  serviceToService() {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KEYCLOAK_AUTH_PRESETS.serviceToService()
    );
  }

  /**
   * Web application configuration
   */
  webApp() {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KEYCLOAK_AUTH_PRESETS.webApp()
    );
  }

  /**
   * Development environment
   */
  development() {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KEYCLOAK_AUTH_PRESETS.development()
    );
  }

  /**
   * Production environment
   */
  production() {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KEYCLOAK_AUTH_PRESETS.production()
    );
  }

  /**
   * Role-based authentication
   */
  requireRoles(
    roles: string[],
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KeycloakAuthHttpMiddleware.createRoleBasedConfig(roles, client)
    );
  }

  /**
   * Permission-based authentication
   */
  requirePermissions(
    permissions: string[],
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      KeycloakAuthHttpMiddleware.createPermissionBasedConfig(
        permissions,
        client
      )
    );
  }

  /**
   * Custom configuration
   */
  custom(config: KeycloakElysiaConfig) {
    return keycloakAuth(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      config
    );
  }
}

/**
 * Helper to create Keycloak authentication presets
 */
export function createKeycloakAuthPresets(
  metrics: IMetricsCollector,
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService
): KeycloakAuthPresets {
  return new KeycloakAuthPresets(
    metrics,
    keycloakClientFactory,
    tokenIntrospectionService
  );
}

/**
 * Utility function to extract user from Elysia context
 */
export function getKeycloakUser(context: KeycloakContext): User | null {
  return context.user ?? null;
}

/**
 * Utility function to check if user is authenticated
 */
export function isAuthenticated(context: KeycloakContext): boolean {
  return !!context.user;
}

/**
 * Utility function to check if user has specific role
 */
export function hasRole(context: KeycloakContext, role: string): boolean {
  return context.user?.roles.includes(role) ?? false;
}

/**
 * Utility function to check if user has any of the specified roles
 */
export function hasAnyRole(context: KeycloakContext, roles: string[]): boolean {
  if (!context.user?.roles) return false;
  return roles.some((role) => context.user!.roles.includes(role));
}

/**
 * Utility function to check if user has specific permission
 */
export function hasPermission(
  context: KeycloakContext,
  permission: string
): boolean {
  return context.user?.permissions.includes(permission) ?? false;
}

/**
 * Utility function to check if user has any of the specified permissions
 */
export function hasAnyPermission(
  context: KeycloakContext,
  permissions: string[]
): boolean {
  if (!context.user?.permissions) return false;
  return permissions.some((permission) =>
    context.user!.permissions.includes(permission)
  );
}

// Export types and utilities
export type { KeycloakAuthHttpMiddlewareConfig };

export {
  KeycloakAuthHttpMiddleware,
  createKeycloakAuthHttpMiddleware,
  KEYCLOAK_AUTH_PRESETS,
};
