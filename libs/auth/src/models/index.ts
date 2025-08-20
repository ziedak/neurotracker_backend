/**
 * Unified RBAC Models Export - Single Source of Truth
 *
 * Canonical export point for all Role-Based Access Control types.
 * All services and components MUST import RBAC types from this module
 * to ensure consistency and eliminate duplication.
 *
 * @version 3.0.0 - Phase 3A Unification
 */

// Import types for local use in interfaces
import type { Permission, Role } from "./permission-models";

// Core Permission and Role Models (FIRST - Foundation Types)
export {
  Permission,
  Role,
  PermissionCondition,
  PermissionMetadata,
  RoleMetadata,
  ComplianceInfo,
  AuditEntry,
  PermissionValidationResult,
  RoleValidationResult,
  ValidationError,
  ValidationWarning,
  PermissionHierarchyResult,
  ValidationOptions,
  PermissionValidator,
} from "./permission-models";

// Enumerations
export {
  ConditionType,
  ConditionOperator,
  PermissionPriority,
  RoleCategory,
  RoleLevel,
  AuditAction,
  ValidationErrorCode,
  ValidationWarningCode,
} from "./permission-models";

// Session Models
export {
  SessionData,
  SessionStatus,
  SessionAuthMethod,
  SessionProtocol,
  SessionCreateOptions,
} from "./session-models";

// User Models
export {
  User,
  UserStatus,
  CreateUserData,
  UpdateUserData,
  UserSecurityProfile,
  UserLoginHistory,
  UserActivitySummary,
} from "./user-models";

/**
 * Type aliases for backward compatibility during migration
 * @deprecated Use Permission[] directly instead of string[]
 */
export type LegacyPermissions = string[];

/**
 * Utility types for RBAC system
 */
export type PermissionId = string;
export type RoleId = string;
export type UserId = string;
export type ResourcePath = string;
export type ActionName = string;

/**
 * Permission checking helper types
 */
export interface PermissionCheck {
  readonly resource: ResourcePath;
  readonly action: ActionName;
  readonly conditions?: Record<string, unknown>;
}

export interface RoleHierarchyNode {
  readonly role: Role;
  readonly depth: number;
  readonly parents: RoleHierarchyNode[];
  readonly children: RoleHierarchyNode[];
}

/**
 * RBAC Service Interface Types
 */
export interface PermissionServiceInterface {
  getUserPermissions(userId: UserId): Promise<Permission[]>;
  getRolePermissions(roleId: RoleId): Promise<Permission[]>;
  resolveRoleHierarchy(roleId: RoleId): Promise<Role[]>;
  checkPermission(userId: UserId, check: PermissionCheck): Promise<boolean>;
}

export interface RoleServiceInterface {
  getRole(roleId: RoleId): Promise<Role | null>;
  getRoleHierarchy(roleId: RoleId): Promise<RoleHierarchyNode>;
  assignRole(userId: UserId, roleId: RoleId): Promise<void>;
  revokeRole(userId: UserId): Promise<void>;
}

/**
 * Cache Interface Types
 */
export interface PermissionCacheInterface {
  cacheUserPermissions(
    userId: UserId,
    permissions: Permission[]
  ): Promise<void>;
  getUserPermissions(userId: UserId): Promise<Permission[] | undefined>;
  invalidateUserCache(userId: UserId): Promise<void>;
  cacheRolePermissions(
    roleId: RoleId,
    permissions: Permission[]
  ): Promise<void>;
  getRolePermissions(roleId: RoleId): Promise<Permission[] | undefined>;
  invalidateRoleCache(roleId: RoleId): Promise<void>;
}
