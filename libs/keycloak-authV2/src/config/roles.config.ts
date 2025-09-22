/**
 * Role definitions and permissions configuration
 *
 * Defines the role hierarchy and permissions for the authorization system.
 * Uses a clean, maintainable structure that supports role inheritance.
 */

import type {
  Action,
  Subjects,
  Permission,
  RoleDefinition,
  Role,
} from "../types/authorization.types";

/**
 * Helper function to create permission objects
 */
function createPermission(
  action: Action,
  subject: Subjects,
  options: {
    conditions?: Record<string, any>;
    fields?: string[];
    inverted?: boolean;
    reason?: string;
  } = {}
): Permission {
  return {
    id: `${action}_${subject}`,
    action,
    subject,
    ...options,
  };
}

/**
 * Base permissions available to all authenticated users
 */
const BASE_PERMISSIONS: Permission[] = [
  createPermission("read", "User", {
    conditions: { id: "${user.id}" },
    reason: "Users can read their own profile",
  }),
  createPermission("update", "User", {
    conditions: { id: "${user.id}" },
    fields: ["name", "email", "preferences"],
    reason: "Users can update their own basic profile",
  }),
  createPermission("read", "Session", {
    conditions: { userId: "${user.id}" },
    reason: "Users can view their own sessions",
  }),
];

/**
 * API consumer permissions for service-to-service communication
 */
const API_CONSUMER_PERMISSIONS: Permission[] = [
  ...BASE_PERMISSIONS,
  createPermission("read", "Project", {
    conditions: { public: true },
    reason: "API consumers can read public projects",
  }),
  createPermission("read", "Report", {
    conditions: { public: true },
    reason: "API consumers can read public reports",
  }),
];

/**
 * Regular user permissions
 */
const USER_PERMISSIONS: Permission[] = [
  ...BASE_PERMISSIONS,
  createPermission("read", "Project", {
    conditions: {
      $or: [
        { ownerId: "${user.id}" },
        { collaborators: { $in: ["${user.id}"] } },
        { public: true },
      ],
    },
    reason: "Users can read owned, collaborated, or public projects",
  }),
  createPermission("create", "Project", {
    reason: "Users can create new projects",
  }),
  createPermission("update", "Project", {
    conditions: { ownerId: "${user.id}" },
    reason: "Users can update their own projects",
  }),
  createPermission("read", "Report", {
    conditions: {
      $or: [{ ownerId: "${user.id}" }, { public: true }],
    },
    reason: "Users can read their own or public reports",
  }),
  createPermission("create", "Report", {
    reason: "Users can create reports",
  }),
];

/**
 * Analyst permissions - enhanced data access
 */
const ANALYST_PERMISSIONS: Permission[] = [
  ...USER_PERMISSIONS,
  createPermission("read", "Dashboard", {
    reason: "Analysts can access analytical dashboards",
  }),
  createPermission("create", "Dashboard", {
    reason: "Analysts can create custom dashboards",
  }),
  createPermission("execute", "Report", {
    reason: "Analysts can execute advanced reports",
  }),
  createPermission("read", "Project", {
    conditions: { department: "${user.department}" },
    reason: "Analysts can read projects in their department",
  }),
];

/**
 * Manager permissions - team and resource management
 */
const MANAGER_PERMISSIONS: Permission[] = [
  ...ANALYST_PERMISSIONS,
  createPermission("manage", "Project", {
    conditions: { department: "${user.department}" },
    reason: "Managers can manage projects in their department",
  }),
  createPermission("approve", "Report", {
    reason: "Managers can approve reports for publication",
  }),
  createPermission("read", "User", {
    conditions: { department: "${user.department}" },
    fields: ["id", "name", "email", "role", "department"],
    reason: "Managers can read team member profiles",
  }),
  createPermission("update", "User", {
    conditions: {
      department: "${user.department}",
      role: { $nin: ["admin", "manager"] },
    },
    fields: ["role", "permissions"],
    reason: "Managers can update team member permissions",
  }),
];

/**
 * Admin permissions - full system access
 */
const ADMIN_PERMISSIONS: Permission[] = [
  createPermission("manage", "all", {
    reason: "Administrators have full system access",
  }),
];

/**
 * Role definitions with inheritance hierarchy
 */
export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  guest: {
    name: "guest",
    permissions: [],
    description: "Guest user with minimal access",
    isSystem: false,
  },

  api_consumer: {
    name: "api_consumer",
    permissions: API_CONSUMER_PERMISSIONS,
    description: "API consumer for service-to-service communication",
    isSystem: true,
  },

  user: {
    name: "user",
    permissions: USER_PERMISSIONS,
    description: "Regular user with basic project access",
    isSystem: false,
  },

  analyst: {
    name: "analyst",
    permissions: ANALYST_PERMISSIONS,
    inherits: ["user"],
    description: "Data analyst with enhanced analytical capabilities",
    isSystem: false,
  },

  manager: {
    name: "manager",
    permissions: MANAGER_PERMISSIONS,
    inherits: ["analyst"],
    description: "Manager with team and resource management capabilities",
    isSystem: false,
  },

  admin: {
    name: "admin",
    permissions: ADMIN_PERMISSIONS,
    description: "System administrator with full access",
    isSystem: true,
  },
};

/**
 * Get all roles in hierarchical order (dependencies first)
 */
export function getRolesInHierarchicalOrder(): Role[] {
  return ["guest", "api_consumer", "user", "analyst", "manager", "admin"];
}

/**
 * Get all permissions for a role including inherited permissions
 */
export function getEffectivePermissions(role: Role): Permission[] {
  const roleDefinition = ROLE_DEFINITIONS[role];
  if (!roleDefinition) {
    return [];
  }

  const permissions = [...roleDefinition.permissions];

  // Add inherited permissions
  if (roleDefinition.inherits) {
    for (const inheritedRole of roleDefinition.inherits) {
      permissions.push(...getEffectivePermissions(inheritedRole));
    }
  }

  // Remove duplicates based on permission id
  return permissions.filter(
    (permission, index, self) =>
      index === self.findIndex((p) => p.id === permission.id)
  );
}

/**
 * Check if a role inherits from another role
 */
export function roleInheritsFrom(role: Role, targetRole: Role): boolean {
  const roleDefinition = ROLE_DEFINITIONS[role];
  if (!roleDefinition?.inherits) {
    return false;
  }

  return (
    roleDefinition.inherits.includes(targetRole) ||
    roleDefinition.inherits.some((inheritedRole) =>
      roleInheritsFrom(inheritedRole, targetRole)
    )
  );
}
