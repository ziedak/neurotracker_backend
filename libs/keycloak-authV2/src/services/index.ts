/**
 * Keycloak Auth V2 Services Exports
 */

export * from "./apikey";

// Encryption Services (for token vault)
export * from "./encryption";

// Account Service (centralized token vault)
export * from "./account";

// User Management - Modular SOLID Architecture (Recommended)
export * from "./user";

// User Management Facade (Recommended for applications)
export {
  UserFacade,
  type RegisterUserInput,
  type AuthenticationResult,
  type SearchUsersOptions,
} from "./user/UserFacade";

export { UserFacade as UserManagementService } from "./user/UserFacade";

// Session Management
export * from "./session";

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

// Integration Service (with renamed SessionValidator to avoid conflicts)
export { KeycloakIntegrationService } from "./integration/KeycloakIntegrationService";
export { InputValidator } from "./integration/InputValidator";
export { ConfigurationManager } from "./integration/ConfigurationManager";
export { StatisticsCollector } from "./integration/StatisticsCollector";
export { AuthenticationManager } from "./integration/AuthenticationManager";
export { SessionValidator as IntegrationSessionValidator } from "./integration/SessionValidator";
export { UserManager } from "./integration/UserManager";
export { ResourceManager } from "./integration/ResourceManager";
export type {
  IIntegrationService,
  IAuthenticationManager,
  ISessionValidator as IIntegrationSessionValidator,
  IInputValidator,
  IStatisticsCollector,
  IConfigurationManager,
  IUserManager,
  IResourceManager,
  KeycloakConnectionOptions,
  ClientContext,
  LogoutResult,
  ValidationResult,
  IntegrationStats,
} from "./integration/interfaces";
