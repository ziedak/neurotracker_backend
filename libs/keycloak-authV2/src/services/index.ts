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
export { SecureCacheManager, type CacheResult } from "./SecureCacheManager";
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

// PKCE Support
export {
  PKCEManager,
  type PKCEPair,
  type PKCEValidationResult,
} from "./PKCEManager";

// Authorization
