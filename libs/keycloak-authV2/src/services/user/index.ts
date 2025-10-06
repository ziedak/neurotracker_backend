/**
 * Modular User Management System - Index
 *
 * Exports all components following SOLID principles:
 * - Focused, single-responsibility classes
 * - Interface-based abstractions
 * - Composable architecture
 */

// Interfaces (ISP - Interface Segregation Principle)
export * from "./interfaces";

// Core Components
export {
  ClientCredentialsTokenProvider,
  createAdminTokenProvider,
} from "./ClientCredentialsTokenProvider";
export { KeycloakUserClient } from "./KeycloakUserClient";
export { RoleManager } from "./RoleManager";

// Data Conversion Utilities (Replaces UserInfoConverter)
export {
  keycloakUserToUserInfo,
  userInfoToKeycloakUser,
} from "./user-converters";

/**
 * @deprecated Use `keycloakUserToUserInfo` and `userInfoToKeycloakUser` utility functions instead.
 * This class-based converter will be removed in the next major version.
 *
 * Migration:
 * ```typescript
 * // Old way (300+ lines, duplication with KeycloakClient)
 * const converter = new UserInfoConverter();
 * const userInfo = converter.convertToUserInfo(user, roles, permissions);
 *
 * // New way (50 lines, pure functions, zero duplication)
 * import { keycloakUserToUserInfo } from '@libs/keycloak-authV2';
 * const userInfo = keycloakUserToUserInfo(user, roles, permissions);
 * ```
 */

// Main Services
export { KeycloakUserService } from "./KeycloakUserService";
export { UserFacade } from "./UserFacade";

// Backward compatibility exports (DEPRECATED)
/** @deprecated Use KeycloakUserClient instead */
export { KeycloakUserClient as UserRepository } from "./KeycloakUserClient";
/** @deprecated Use KeycloakUserService instead */
export { KeycloakUserService as UserService } from "./KeycloakUserService";
/** @deprecated Use UserFacade instead */
export { UserFacade as UserManagementService } from "./UserFacade";

// Convenience re-exports
export type {
  IClientCredentialsTokenProvider,
  IAdminTokenManager, // Deprecated - for backward compatibility
  IKeycloakApiClient,
  IUserRepository,
  IRoleManager,
  IUserInfoConverter, // Deprecated - use utility functions instead
  IUserService,
} from "./interfaces";
