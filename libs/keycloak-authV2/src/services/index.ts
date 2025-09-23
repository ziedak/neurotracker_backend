/**
 * Services exports
 */

export * from "./config";
export * from "./APIKeyManager";
export { KeycloakUserManager } from "./KeycloakUserManager";
export {
  KeycloakSessionManager,
  type KeycloakSessionData,
  type KeycloakSessionCreationOptions,
  type SessionValidationResult,
  type SessionStats,
} from "./KeycloakSessionManager";

// Token Management (Refactored)
export {
  TokenManager,
  createTokenManagerWithRefresh,
  createBasicTokenManager,
} from "./TokenManagerRefactored";

// Legacy Token Management (for backward compatibility)
export { TokenManager as LegacyTokenManager } from "./KeycloakTokenManager";

// Focused Token Services (can be used independently)
export { JWTValidator } from "./JWTValidator";
export { TokenCacheManager, type CacheResult } from "./TokenCacheManager";
export { TokenIntrospector } from "./TokenIntrospector";
export {
  RefreshTokenManager,
  type StoredTokenInfo,
  type RefreshResult,
  type TokenRefreshEvent,
  type TokenExpiryEvent,
  type RefreshTokenConfig,
  type RefreshTokenEventHandlers,
} from "./RefreshTokenManager";
export { RolePermissionExtractor } from "./RolePermissionExtractor";

// WebSocket Authentication
export {
  WebSocketAuthService,
  createWebSocketAuthService,
  type WebSocketConnection,
  type WebSocketAuthResult,
  type WebSocketConfig,
  type WebSocketHooks,
  type AuthenticatedMessage,
} from "./WebSocketAuthService";

// PKCE Support
export {
  PKCEManager,
  type PKCEPair,
  type PKCEValidationResult,
} from "./PKCEManager";

// Authorization
export { AuthorizationService } from "./AuthorizationService";
