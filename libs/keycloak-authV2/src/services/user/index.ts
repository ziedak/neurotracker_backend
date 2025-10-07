/**
 * Modular User Management System - Index
 * Provides a comprehensive set of services for user and session management,
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
} from "./converters/user-converters";

// Validation Utilities
export {
  validateUserUniqueness,
  validateUserStatus,
  type ValidationResult,
} from "./UserValidation";

// Constants
export {
  CACHE_TTL,
  RETRY_CONFIG,
  SYNC_PRIORITIES,
  HEALTH_THRESHOLDS,
  WORKER_CONFIG,
  QUEUE_CONFIG,
} from "./constants";

// Main Services
export { KeycloakUserService } from "./KeycloakUserService";
export { UserFacade } from "./UserFacade";

// Sync Services (Async Keycloak Synchronization)
export { UserSyncService } from "./sync/UserSyncService";
export { SyncQueue } from "./sync/SyncQueue";
export { SyncMonitor } from "./sync/SyncMonitor";
export type {
  SyncConfig,
  SyncOperation,
  SyncResult,
  SyncStatus,
  HealthStatus,
  QueueStats,
  SyncOperationType,
  SyncOperationStatus,
  UserSyncStatus,
  HealthLevel,
  HealthCheck,
} from "./sync/sync-types";

// Convenience re-exports
export type {
  IClientCredentialsTokenProvider,
  IKeycloakApiClient,
  IUserRepository,
  IRoleManager,
  IUserService,
} from "./interfaces";
