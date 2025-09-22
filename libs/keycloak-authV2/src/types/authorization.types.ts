/**
 * Authorization system type definitions
 *
 * Defines types for role-based access control (RBAC) and
 * attribute-based access control (ABAC) using CASL.
 */

import type { AbilityBuilder, PureAbility } from "@casl/ability";

/**
 * Available actions in the authorization system
 */
export type Action =
  | "create"
  | "read"
  | "update"
  | "delete"
  | "manage"
  | "execute"
  | "approve"
  | "publish"
  | "archive";

/**
 * Available subjects/resources in the authorization system
 */
export type Subjects =
  | "User"
  | "Project"
  | "Report"
  | "Dashboard"
  | "Settings"
  | "ApiKey"
  | "Session"
  | "all";

/**
 * Application-specific ability type combining actions and subjects
 */
export type AppAbility = PureAbility<[Action, Subjects]>;

/**
 * User roles in the system
 */
export type Role =
  | "admin"
  | "manager"
  | "analyst"
  | "user"
  | "guest"
  | "api_consumer";

/**
 * Permission definition
 */
export interface Permission {
  id: string;
  action: Action;
  subject: Subjects;
  conditions?: Record<string, any>;
  fields?: string[] | undefined;
  inverted?: boolean;
  reason?: string;
}

/**
 * Role definition with hierarchical support
 */
export interface RoleDefinition {
  name: Role;
  permissions: Permission[];
  inherits?: Role[];
  description?: string;
  isSystem?: boolean;
}

/**
 * User context for authorization decisions
 */
export interface AuthorizationContext {
  userId: string;
  roles: Role[];
  permissions?: string[];
  attributes?: Record<string, any>;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Resource context for authorization decisions
 */
export interface ResourceContext {
  type: Subjects;
  id?: string;
  ownerId?: string;
  organizationId?: string;
  metadata?: Record<string, any>;
}

/**
 * Authorization decision result
 */
export interface AuthorizationResult {
  granted: boolean;
  reason?: string;
  requiredPermissions?: string[];
  missingPermissions?: string[];
  context?: {
    action: Action;
    subject: Subjects;
    userId: string;
    timestamp: Date;
  };
}

/**
 * Ability factory configuration
 */
export interface AbilityFactoryConfig {
  enableCaching?: boolean;
  cacheTimeout?: number;
  defaultRole?: Role;
  strictMode?: boolean;
  auditEnabled?: boolean;
}

/**
 * CASL ability builder type helper
 */
export type AppAbilityBuilder = AbilityBuilder<AppAbility>;
