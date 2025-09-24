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
export { AdminTokenManager } from "./AdminTokenManager";
export { KeycloakApiClient } from "./KeycloakApiClient";
export { UserRepository } from "./UserRepository";
export { RoleManager } from "./RoleManager";
export { UserInfoConverter } from "./UserInfoConverter";

// Main Service (Facade Pattern)
export { KeycloakUserService } from "./KeycloakUserService";

// Convenience re-exports
export type {
  IAdminTokenManager,
  IKeycloakApiClient,
  IUserRepository,
  IRoleManager,
  IUserInfoConverter,
  IUserService,
} from "./interfaces";
