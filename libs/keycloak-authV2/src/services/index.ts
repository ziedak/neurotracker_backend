/**
export * from "./apikey";

// User Management - Modular SOLID Architecture (Recommended)
export * from "./user";

// Integration Service - Modular SOLID Architecture (Recommended)
export * from "./integration";

// Legacy Monolithic Implementations (Deprecated)
export { KeycloakUserManager } from "./KeycloakUserManager";
export { KeycloakIntegrationService as LegacyKeycloakIntegrationService } from "./KeycloakIntegrationService";ices exports
 */

export * from "./apikey";

// User Management - Modular SOLID Architecture (Recommended)
export * from "./user";

// Legacy Monolithic Implementation (Deprecated)
// export { KeycloakUserManager } from "./KeycloakUserManager.ts.old";

export {
  KeycloakSessionManager,
  type KeycloakSessionData,
  type SessionValidationResult,
  type SessionStats,
} from "./session";

// Token Management (Refactored)
export * from "./token/config";
export {
  TokenManager,
  createBasicTokenManager,
  createTokenManagerWithRefresh,
} from "./token/TokenManager";

// Focused Token Services (can be used independently)
export {
  RefreshTokenManager,
  type StoredTokenInfo,
  type RefreshResult,
  type RefreshTokenConfig,
} from "./token/RefreshTokenManager";

// PKCE Support
export {
  PKCEManager,
  type PKCEPair,
  type PKCEValidationResult,
} from "./PKCEManager";

export * from "./integration";
