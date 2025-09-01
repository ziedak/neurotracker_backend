/**
 * Keycloak Authentication Middleware
 *
 * Enterprise-grade Keycloak authentication middleware for Elysiajs+Bun applications.
 * Provides JWT validation, role-based access control, WebSocket support, and comprehensive caching.
 *
 * ## Industry-Standard Implementation
 *
 * This module now includes an industry-standard implementation following:
 * - Dependency injection patterns
 * - Interface segregation principle
 * - Clean architecture principles
 * - Production-ready configuration validation
 * - Comprehensive error handling and metrics
 *
 * @example Industry-Standard Usage:
 * ```typescript
 * import { createKeycloakMiddleware } from '@libs/middleware/keycloak';
 *
 * const middleware = await createKeycloakMiddleware(
 *   logger,
 *   metrics,
 *   redis,
 *   keycloakConfig
 * );
 * ```
 *
 * @example Legacy Usage:
 * ```typescript
 * import { createKeycloakPlugin, keycloakGuards } from '@libs/middleware/keycloak';
 *
 * const keycloakConfig = {
 *   keycloak: {
 *     serverUrl: 'https://keycloak.example.com',
 *     realm: 'my-realm',
 *     clientId: 'my-client',
 *     requireAuth: true,
 *     verifyTokenLocally: true,
 *     publicKey: 'your-public-key'
 *   }
 * };
 *
 * const app = new Elysia()
 *   .use(createKeycloakPlugin(keycloakConfig))
 *   .use(keycloakGuards.authenticated);
 * ```
 */

// =============================================================================
// INDUSTRY-STANDARD IMPLEMENTATION (Recommended)
// =============================================================================

// Core interfaces following interface segregation principle
export * from "./interfaces";

// Industry-standard middleware implementation
export {
  IndustryStandardKeycloakMiddleware,
  type KeycloakAuthenticatedContext,
} from "./industry-standard-middleware";

// Factory patterns for proper dependency injection
export { KeycloakServiceFactory } from "./service-factory";

// Configuration validation
export { KeycloakConfigValidator } from "./config-validator";

// Factory functions for easy middleware creation
export {
  createKeycloakMiddleware,
  createKeycloakMiddlewareWithService,
  createDevKeycloakMiddleware,
  createProdKeycloakMiddleware,
} from "./factory";

// =============================================================================
// LEGACY IMPLEMENTATION (Backward Compatibility)
// =============================================================================

// Core exports
export { KeycloakService } from "./Keycloak.service";
// export {
//   /** @deprecated Use IndustryStandardKeycloakMiddleware instead */
//   KeycloakMiddleware,
//   createKeycloakPlugin,
//   keycloakGuards,
// } from "./Keycloak.middleware.ts.old";
export {
  KeycloakWebSocketMiddleware,
  createKeycloakWebSocketMiddleware,
} from "./websocket.middleware";
export {
  KeycloakConfigManager,
  getKeycloakConfigManager,
  resetKeycloakConfigManager,
  ENVIRONMENT_PRESETS,
} from "./config";

// Type exports
export type {
  KeycloakConfig,
  KeycloakJWTPayload,
  KeycloakUserInfo,
  KeycloakTokenVerification,
  KeycloakAuthContext,
  KeycloakMiddlewareConfig,
  KeycloakWebSocketConfig,
  KeycloakIntrospectionResponse,
  KeycloakServiceResponse,
  JWKS,
  JWK,
  CacheEntry,
  RateLimitResult,
  CircuitBreakerStatus,
  HealthCheckResult,
  KeycloakMetrics,
} from "./types";

export { KeycloakError, KeycloakErrorType } from "./types";

/**
 * Default Keycloak configuration values
 */
export const DEFAULT_KEYCLOAK_CONFIG = {
  rolesClaim: "realm_access.roles",
  usernameClaim: "preferred_username",
  emailClaim: "email",
  groupsClaim: "groups",
  cacheTTL: 300,
  verifyTokenLocally: true,
  enableUserInfoEndpoint: false,
  connectTimeout: 5000,
  readTimeout: 5000,
  requireAuth: true,
  closeOnAuthFailure: true,
} as const;

/**
 * Common Keycloak role mappings for permissions
 */
export const KEYCLOAK_ROLE_PERMISSIONS = {
  admin: [
    "user:read",
    "user:write",
    "user:delete",
    "system:admin",
    "api:full_access",
    "websocket:connect",
    "websocket:send",
    "websocket:receive",
    "websocket:broadcast",
    "websocket:admin",
    "message:*",
  ],
  manager: [
    "user:read",
    "user:write",
    "reports:read",
    "api:write",
    "websocket:connect",
    "websocket:send",
    "websocket:receive",
    "message:chat",
    "message:notification",
    "message:data",
  ],
  user: [
    "user:read",
    "api:read",
    "websocket:connect",
    "websocket:send",
    "websocket:receive",
    "message:chat",
    "message:notification",
  ],
  customer: [
    "user:read",
    "api:read",
    "websocket:connect",
    "websocket:send",
    "websocket:receive",
    "message:chat",
    "message:notification",
  ],
  readonly: ["websocket:connect", "websocket:receive", "message:notification"],
  viewer: ["websocket:connect", "websocket:receive", "message:notification"],
} as const;

/**
 * Common WebSocket message permission mappings
 */
export const WEBSOCKET_MESSAGE_PERMISSIONS = {
  "chat:send": ["message:chat", "websocket:send"],
  "chat:receive": ["message:chat", "websocket:receive"],
  "notification:receive": ["message:notification", "websocket:receive"],
  "data:sync": ["message:data", "websocket:send"],
  "system:broadcast": ["websocket:broadcast", "websocket:admin"],
  "admin:command": ["system:admin", "websocket:admin"],
} as const;

/**
 * Common WebSocket message role requirements
 */
export const WEBSOCKET_MESSAGE_ROLES = {
  "admin:command": ["admin", "administrator"],
  "system:broadcast": ["admin", "manager"],
  "data:sync": ["admin", "manager", "user"],
  "chat:send": ["admin", "manager", "user", "customer"],
  "chat:receive": ["admin", "manager", "user", "customer"],
  "notification:receive": [
    "admin",
    "manager",
    "user",
    "customer",
    "readonly",
    "viewer",
  ],
} as const;

/**
 * Default export: Main factory function for creating industry-standard middleware
 */
export { createKeycloakMiddleware as default } from "./factory";
