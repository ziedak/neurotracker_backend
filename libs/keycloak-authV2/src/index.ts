/**
 * Keycloak Authentication Library V2
 * Production-ready Keycloak integration with OIDC flows, security best practices,
 * and seamless integration with the existing microservices architecture.
 */

// =============================================================================
// Core Types and Interfaces
// =============================================================================
export * from "./types";

// =============================================================================
// Keycloak Client and Factory
// =============================================================================
export {
  KeycloakClient,
  type KeycloakRealmConfig,
  type KeycloakClientOptions,
  type KeycloakDiscoveryDocument,
  type KeycloakTokenResponse,
  type KeycloakUserInfo,
  type KeycloakIntrospectionResponse,
  type AuthenticationFlow,
} from "./client/KeycloakClient";

export {
  KeycloakClientFactory,
  createKeycloakClientFactory,
  createEnvironmentConfig,
  type KeycloakMultiClientConfig,
  type KeycloakEnvironmentConfig,
  type ClientType,
} from "./client/KeycloakClientFactory";

// =============================================================================
// Services
// =============================================================================
export { TokenManager as KeycloakTokenManager } from "./services/KeycloakTokenManager";

export {
  APIKeyManager,
  type APIKey,
  type APIKeyGenerationOptions,
  type APIKeyValidationResult,
  type APIKeyManagerStats,
} from "./services/APIKeyManager";

export {
  KeycloakSessionManager as SessionManager,
  type KeycloakSessionData as SessionData,
  type KeycloakSessionCreationOptions as SessionCreationOptions,
  type SessionValidationResult,
  type SessionStats,
} from "./services/KeycloakSessionManager";

export {
  AuthorizationService,
  type AuthorizationServiceConfig,
} from "./services/AuthorizationServiceRefactored";

export { AbilityFactory, type AbilityFactoryConfig } from "./services/ability";

export {
  type AuthV2Config,
  createAuthV2Config,
  loadConfigFromEnv,
} from "./services/config";

// =============================================================================
// Authorization Types and Configuration
// =============================================================================
export * from "./types/authorization.types";

export {
  ROLE_DEFINITIONS,
  getRolesInHierarchicalOrder,
  getEffectivePermissions,
  roleInheritsFrom,
} from "./config/roles.config";

// =============================================================================
// Security Audit Logging
// =============================================================================
export {
  SecurityAuditLogger,
  createSecurityAuditLogger,
  SecurityEventType,
  SecurityEventSeverity,
  type SecurityEvent,
  type AuthenticationEvent,
  type AuthorizationEvent,
  type SessionEvent,
  type SecurityViolationEvent,
  type SecurityAuditConfig,
  DEFAULT_SECURITY_AUDIT_CONFIG,
} from "./security/SecurityAuditLogger";

export {
  SecurityAuditIntegration,
  createSecurityAuditIntegration,
} from "./security/SecurityAuditIntegration";

// =============================================================================
// Version and Library Information
// =============================================================================
export const VERSION = "2.0.0";
export const LIBRARY_NAME = "@libs/keycloak-authV2";

/**
 * Get library information
 */
export const getLibraryInfo = () => ({
  name: LIBRARY_NAME,
  version: VERSION,
  description:
    "Production-ready Keycloak authentication library V2 with OIDC flows and security best practices",
  features: [
    "Full Keycloak OIDC integration",
    "Multiple authentication flows (authorization_code, client_credentials, etc.)",
    "JWT validation with JWKS",
    "Token introspection with caching",
    "Multi-client configuration support",
    "Session management with Redis",
    "API key authentication",
    "Security best practices enforcement",
    "Comprehensive caching strategy",
    "TypeScript support with strict types",
    "Integration with existing @libs architecture",
  ],
});

// =============================================================================
// Helper Functions and Utilities
// =============================================================================

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(
  authorizationHeader?: string
): string | null {
  if (!authorizationHeader || typeof authorizationHeader !== "string") {
    return null;
  }

  const bearerPrefix = "Bearer ";
  if (!authorizationHeader.startsWith(bearerPrefix)) {
    return null;
  }

  const token = authorizationHeader.slice(bearerPrefix.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Check if user has specific role
 */
export function hasRole(userRoles: string[], requiredRole: string): boolean {
  return (
    userRoles.includes(requiredRole) ||
    userRoles.includes(`realm:${requiredRole}`)
  );
}

/**
 * Check if user has any of the required roles
 */
export function hasAnyRole(
  userRoles: string[],
  requiredRoles: string[]
): boolean {
  return requiredRoles.some((role) => hasRole(userRoles, role));
}

/**
 * Check if user has specific permission
 */
export function hasPermission(
  userPermissions: string[],
  requiredPermission: string
): boolean {
  return userPermissions.includes(requiredPermission);
}

/**
 * Check if user has any of the required permissions
 */
export function hasAnyPermission(
  userPermissions: string[],
  requiredPermissions: string[]
): boolean {
  return requiredPermissions.some((permission) =>
    hasPermission(userPermissions, permission)
  );
}

// =============================================================================
// Constants
// =============================================================================

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
 * Authentication flow types
 */
export const AUTH_FLOWS = {
  AUTHORIZATION_CODE: "authorization_code",
  CLIENT_CREDENTIALS: "client_credentials",
  DIRECT_GRANT: "direct_grant",
  REFRESH_TOKEN: "refresh_token",
} as const;

/**
 * Client types
 */
export const CLIENT_TYPES = {
  FRONTEND: "frontend",
  SERVICE: "service",
  WEBSOCKET: "websocket",
  ADMIN: "admin",
  TRACKER: "tracker",
} as const;

/**
 * Default configuration values
 */
export const DEFAULTS = {
  CACHE_TTL: 3600, // 1 hour
  INTROSPECTION_CACHE_TTL: 300, // 5 minutes
  DISCOVERY_CACHE_TTL: 3600, // 1 hour
  JWKS_CACHE_TTL: 3600, // 1 hour
  USER_INFO_CACHE_TTL: 300, // 5 minutes
  HTTP_TIMEOUT: 10000, // 10 seconds
  HTTP_RETRIES: 3,
  CLOCK_SKEW: 30, // 30 seconds
} as const;
