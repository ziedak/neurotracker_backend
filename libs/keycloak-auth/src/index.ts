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
// Authorization Services
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
} from "./services/rbac/enhanced-rbac";

// =============================================================================
// HTTP Middleware
// =============================================================================
export {
  KeycloakAuthHttpMiddleware,
  createKeycloakAuthHttpMiddleware,
  KEYCLOAK_AUTH_PRESETS,
  type KeycloakAuthHttpMiddlewareConfig,
} from "./middleware/keycloak-http.middleware";

// =============================================================================
// Elysia Plugin Integration
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
// WebSocket Middleware
// =============================================================================
export {
  KeycloakWebSocketMiddleware,
  type KeycloakWebSocketConfig,
  type WebSocketAuthenticationResult,
  type WebSocketConnectionInfo,
} from "./middleware/keycloak-websocket.middleware";

// =============================================================================
// WebSocket Plugin Integration
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

export {
  extractBearerToken,
  isTokenExpired,
  extractScopes,
  hasRequiredScopes,
  extractPermissions,
  hasRequiredPermissions,
} from "./utils/access";

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
