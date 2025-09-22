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

// Token Management
export {
  TokenManager,
  createTokenManagerWithRefresh,
  createBasicTokenManager,
} from "./KeycloakTokenManager";

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
