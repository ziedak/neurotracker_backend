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

// Re-export AppAbility from ability types for convenience
export type { AppAbility } from "../services/ability/ability.types";
