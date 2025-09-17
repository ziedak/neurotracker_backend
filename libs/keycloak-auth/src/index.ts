/**
 * Keycloak Authentication Library
 * Production-ready authentication for Elysia microservices with WebSocket support
 *
 * @version 1.0.0
 * @author Development Team
 */

// =============================================================================
// Core Types and Interfaces
// =============================================================================
export * from "./types/index";

// =============================================================================
// Client Configuration and Management
// =============================================================================
export {
  KeycloakClientFactory,
  createKeycloakClientFactory,
} from "./client/keycloak-client-factory";

// =============================================================================
// Services
// =============================================================================
export {
  TokenIntrospectionService,
  createTokenIntrospectionService,
} from "./services/token-introspection";

export {
  WebSocketTokenValidator,
  createWebSocketTokenValidator,
} from "./services/websocket-token-validator";

export {
  TokenRefreshManager,
  createTokenRefreshManager,
  getTokenRefreshManager,
  type ManagedToken,
  type TokenRefreshConfig,
  type TokenRefreshEvent,
  type TokenRefreshEventHandler,
  DEFAULT_REFRESH_CONFIG,
} from "./services/token-refresh-manager";

// =============================================================================
// Authorization Services - Phase 4 Complete
// =============================================================================
export {
  KeycloakAuthorizationServicesClient,
  createKeycloakAuthorizationServicesClient,
  AuthorizationHelpers,
  type AuthorizationDecision,
  type ResourceRepresentation,
  type PolicyRepresentation,
  type PermissionTicket,
  type AuthorizationContext,
  type AuthorizationServicesConfig,
  DEFAULT_AUTHZ_CONFIG,
} from "./services/keycloak-authorization-services";

// Enhanced RBAC with Role Hierarchy
export {
  EnhancedRBACService,
  createEnhancedRBACService,
  RBACHelpers,
  type RoleHierarchy,
  type PermissionScope,
  type RBACDecision,
  type RBACConfig,
  DEFAULT_RBAC_CONFIG,
} from "./services/enhanced-rbac";

// =============================================================================
// HTTP Middleware - Phase 2A Complete
// =============================================================================
export {
  KeycloakAuthHttpMiddleware,
  createKeycloakAuthHttpMiddleware,
  KEYCLOAK_AUTH_PRESETS,
  type KeycloakAuthHttpMiddlewareConfig,
} from "./middleware/keycloak-http.middleware";

// =============================================================================
// Elysia Plugin Integration - Phase 2A Complete
// =============================================================================
export {
  keycloakAuth,
  KeycloakAuthPresets,
  createKeycloakAuthPresets,
  getKeycloakUser,
  isAuthenticated,
  hasRole,
  hasAnyRole,
  hasPermission,
  hasAnyPermission,
  type KeycloakElysiaConfig,
  type KeycloakContext,
} from "./middleware/keycloak-elysia.plugin";

// =============================================================================
// Middleware Examples and Patterns
// =============================================================================

// =============================================================================
// WebSocket Middleware - Phase 2B Complete
// =============================================================================
export {
  KeycloakWebSocketMiddleware,
  type KeycloakWebSocketConfig,
  type WebSocketAuthenticationResult,
  type WebSocketConnectionInfo,
} from "./middleware/keycloak-websocket.middleware";

// =============================================================================
// WebSocket Plugin Integration - Phase 2B Complete
// =============================================================================
export {
  keycloakWebSocket,
  KeycloakWebSocketAuthPresets,
  createKeycloakWebSocketAuthPresets,
  getWebSocketAuthContext,
  isWebSocketAuthenticated,
  getWebSocketConnectionId,
  webSocketHasRole,
  webSocketHasPermission,
  sendAuthenticatedMessage,
  type KeycloakWebSocketElysiaConfig,
  type KeycloakWebSocketContext,
  type AuthenticatedWebSocketMessage,
} from "./middleware/keycloak-websocket.plugin";

// =============================================================================
// WebSocket Examples and Usage Patterns
// =============================================================================
export {
  createBasicWebSocketExample,
  createPermissionBasedWebSocketExample,
  createDevelopmentWebSocketExample,
  createCompleteWebSocketServer,
  WEBSOCKET_USAGE_EXAMPLES,
} from "./middleware/websocket-examples";

// =============================================================================
// Utility Functions
// =============================================================================

// PKCE Utilities for Enhanced Security
export {
  generateCodeVerifier,
  generateCodeChallenge,
  generatePKCEPair,
  validateCodeVerifier,
  validateCodeChallenge,
  verifyPKCE,
  PKCEManager,
  addPKCEToAuthorizationUrl,
  getPKCEVerifierForTokenExchange,
  pkceManager,
  type PKCEConfig,
  DEFAULT_PKCE_CONFIG,
} from "./utils/pkce";

/**
 * Extract token from Authorization header
 */
export const extractBearerToken = (authHeader?: string): string | null => {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
};

/**
 * Check if token is expired based on exp claim
 */
export const isTokenExpired = (
  exp?: number,
  bufferSeconds: number = 300
): boolean => {
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + bufferSeconds;
};

/**
 * Extract scopes from token claims
 */
export const extractScopes = (scope?: string): string[] => {
  if (!scope) return ["openid"];
  return scope.split(" ").filter((s) => s.length > 0);
};

/**
 * Check if user has required scopes
 */
export const hasRequiredScopes = (
  userScopes: string[],
  requiredScopes: string[]
): boolean => {
  if (!requiredScopes.length) return true;
  return requiredScopes.every((scope) => userScopes.includes(scope));
};

/**
 * Extract permissions from Keycloak token claims
 */
export const extractPermissions = (claims: any): string[] => {
  const permissions: string[] = [];

  // Extract realm roles
  if (claims.realm_access?.roles) {
    permissions.push(
      ...claims.realm_access.roles.map((role: string) => `realm:${role}`)
    );
  }

  // Extract client roles
  if (claims.resource_access) {
    Object.entries(claims.resource_access).forEach(
      ([clientId, clientAccess]: [string, any]) => {
        if (clientAccess.roles) {
          permissions.push(
            ...clientAccess.roles.map((role: string) => `${clientId}:${role}`)
          );
        }
      }
    );
  }

  return permissions;
};

/**
 * Check if user has required permissions
 */
export const hasRequiredPermissions = (
  userPermissions: string[],
  requiredPermissions: string[]
): boolean => {
  if (!requiredPermissions.length) return true;
  return requiredPermissions.every((permission) =>
    userPermissions.includes(permission)
  );
};

// =============================================================================
// Configuration Helpers
// =============================================================================

/**
 * Create default WebSocket authentication configuration
 */
export const createDefaultWebSocketConfig = (
  overrides: Partial<any> = {}
): any => {
  return {
    connectionAuth: {
      enabled: true,
      methods: ["jwt_token", "api_key"],
      tokenSources: ["header", "query", "cookie"],
      fallbackToAnonymous: false,
    },
    messageAuth: {
      enabled: false,
      validateOnSensitiveActions: true,
      requiredActionsPattern: [/^(subscribe|unsubscribe|publish)$/],
    },
    session: {
      enableRefresh: true,
      refreshInterval: 3600, // 1 hour
      maxIdleTime: 7200, // 2 hours
    },
    ...overrides,
  };
};

/**
 * Create environment configuration from process.env
 */
export const createEnvironmentConfig = (overrides: Partial<any> = {}): any => {
  return {
    KEYCLOAK_SERVER_URL: process.env["KEYCLOAK_SERVER_URL"] || "",
    KEYCLOAK_REALM: process.env["KEYCLOAK_REALM"] || "",
    KEYCLOAK_FRONTEND_CLIENT_ID:
      process.env["KEYCLOAK_FRONTEND_CLIENT_ID"] || "",
    KEYCLOAK_SERVICE_CLIENT_ID: process.env["KEYCLOAK_SERVICE_CLIENT_ID"] || "",
    KEYCLOAK_SERVICE_CLIENT_SECRET:
      process.env["KEYCLOAK_SERVICE_CLIENT_SECRET"] || "",
    KEYCLOAK_TRACKER_CLIENT_ID: process.env["KEYCLOAK_TRACKER_CLIENT_ID"] || "",
    KEYCLOAK_TRACKER_CLIENT_SECRET:
      process.env["KEYCLOAK_TRACKER_CLIENT_SECRET"] || "",
    KEYCLOAK_WEBSOCKET_CLIENT_ID:
      process.env["KEYCLOAK_WEBSOCKET_CLIENT_ID"] || "",
    REDIS_URL: process.env["REDIS_URL"] || "redis://localhost:6379",
    AUTH_CACHE_TTL: process.env["AUTH_CACHE_TTL"] || "3600",
    AUTH_INTROSPECTION_TTL: process.env["AUTH_INTROSPECTION_TTL"] || "300",
    ...overrides,
  };
};

// =============================================================================
// Version Information
// =============================================================================
export const VERSION = "1.0.0";
export const LIBRARY_NAME = "@libs/keycloak-auth";

/**
 * Get library information
 */
export const getLibraryInfo = () => ({
  name: LIBRARY_NAME,
  version: VERSION,
  description:
    "Production-ready Keycloak authentication library with WebSocket support",
  features: [
    "Multi-client Keycloak configuration",
    "JWT token validation with JWKS",
    "Token introspection with caching",
    "WebSocket authentication support",
    "Elysia middleware integration",
    "Redis caching with @libs/database",
    "Comprehensive error handling",
    "TypeScript support with strict types",
  ],
});

// =============================================================================
// Constants
// =============================================================================
export const DEFAULT_TOKEN_CACHE_TTL = 3600; // 1 hour
export const DEFAULT_INTROSPECTION_CACHE_TTL = 300; // 5 minutes
export const MIN_TOKEN_CACHE_TTL = 300; // 5 minutes
export const DEFAULT_WEBSOCKET_REFRESH_INTERVAL = 3600; // 1 hour
export const DEFAULT_WEBSOCKET_MAX_IDLE_TIME = 7200; // 2 hours

/**
 * Common OAuth 2.1 / OpenID Connect scopes
 */
export const COMMON_SCOPES = {
  OPENID: "openid",
  PROFILE: "profile",
  EMAIL: "email",
  OFFLINE_ACCESS: "offline_access",
} as const;

/**
 * Common Keycloak realm roles
 */
export const COMMON_REALM_ROLES = {
  ADMIN: "admin",
  USER: "user",
  MODERATOR: "moderator",
} as const;

/**
 * WebSocket authentication methods
 */
export const WEBSOCKET_AUTH_METHODS = {
  JWT_TOKEN: "jwt_token",
  API_KEY: "api_key",
  SESSION_BASED: "session_based",
} as const;
