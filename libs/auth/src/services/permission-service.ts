/**
 * CASL-based Permission Service
 * Implements role-based access control using the CASL ability system
 * Provides comprehensive permission management with fine-grained control
 */

import { AbilityBuilder, PureAbility } from "@casl/ability";
import {
  Action,
  Resource,
  Permission,
  Role,
  AppAbility,
  User,
  AuthContext,
  ServiceDependencies,
} from "../types";

// ===================================================================
// PERMISSION SERVICE CLASS
// ===================================================================

export class PermissionService {
  private roles: Map<string, Role> = new Map();

  constructor(private deps: ServiceDependencies) {
    this.initializeDefaultRoles();
  }

  /**
   * Create ability instance for a user
   */
  createAbility(user: User): AppAbility {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(
      PureAbility as any
    );

    // Add permissions based on user's roles
    for (const roleName of user.roles) {
      const role = this.roles.get(roleName);
      if (role) {
        this.applyRolePermissions(can, cannot, role);
      }
    }

    // Add direct user permissions
    for (const permission of user.permissions) {
      const permObj = this.parsePermissionString(permission);
      if (permObj) {
        this.applyPermission(can, cannot, permObj);
      }
    }

    return build();
  }

  /**
   * Check if user can perform action on resource
   */
  can(user: User, action: Action, resource: Resource, subject?: any): boolean {
    const ability = this.createAbility(user);
    return ability.can(action, subject || resource);
  }

  /**
   * Check if user cannot perform action on resource
   */
  cannot(
    user: User,
    action: Action,
    resource: Resource,
    subject?: any
  ): boolean {
    const ability = this.createAbility(user);
    return ability.cannot(action, subject || resource);
  }

  /**
   * Get permitted fields for user on resource
   */
  getPermittedFields(user: User, action: Action, resource: Resource): string[] {
    const ability = this.createAbility(user);
    return this.getPermittedFieldsFromAbility(ability, action, resource);
  }

  /**
   * Create authorization context for user
   */
  createAuthContext(user: User): AuthContext {
    const ability = this.createAbility(user);

    return {
      user,
      permissions: user.permissions,
      roles: user.roles,
      ability,
      isAuthenticated: true,
    };
  }

  /**
   * Add or update a role
   */
  addRole(role: Role): void {
    this.roles.set(role.name, role);
    this.cacheRole(role);
  }

  /**
   * Remove a role
   */
  removeRole(roleName: string): void {
    this.roles.delete(roleName);
    this.deps.redis.del(`role:${roleName}`);
  }

  /**
   * Get role by name
   */
  getRole(roleName: string): Role | undefined {
    return this.roles.get(roleName);
  }

  /**
   * List all roles
   */
  getAllRoles(): Role[] {
    return Array.from(this.roles.values());
  }

  /**
   * Add permission to role
   */
  addPermissionToRole(roleName: string, permission: Permission): void {
    const role = this.roles.get(roleName);
    if (role) {
      role.permissions.push(permission);
      this.cacheRole(role);
    }
  }

  /**
   * Remove permission from role
   */
  removePermissionFromRole(roleName: string, permissionId: string): void {
    const role = this.roles.get(roleName);
    if (role) {
      role.permissions = role.permissions.filter(
        (p) => `${p.action}:${p.resource}` !== permissionId
      );
      this.cacheRole(role);
    }
  }

  /**
   * Check if user has role
   */
  userHasRole(user: User, roleName: string): boolean {
    return user.roles.includes(roleName);
  }

  /**
   * Check if user has permission
   */
  userHasPermission(user: User, permission: string): boolean {
    return user.permissions.includes(permission);
  }

  /**
   * Get all permissions for user (from roles + direct)
   */
  getUserPermissions(user: User): string[] {
    const rolePermissions = new Set<string>();

    // Add permissions from roles
    for (const roleName of user.roles) {
      const role = this.roles.get(roleName);
      if (role) {
        for (const permission of role.permissions) {
          rolePermissions.add(`${permission.action}:${permission.resource}`);
        }
      }
    }

    // Add direct permissions
    for (const permission of user.permissions) {
      rolePermissions.add(permission);
    }

    return Array.from(rolePermissions);
  }

  /**
   * Validate permission format
   */
  validatePermission(permission: Permission): boolean {
    return !!(
      permission.action &&
      permission.resource &&
      typeof permission.action === "string" &&
      typeof permission.resource === "string"
    );
  }

  /**
   * Validate role format
   */
  validateRole(role: Role): boolean {
    return !!(
      role.id &&
      role.name &&
      Array.isArray(role.permissions) &&
      typeof role.id === "string" &&
      typeof role.name === "string"
    );
  }

  /**
   * Parse permission string into Permission object
   */
  private parsePermissionString(permissionStr: string): Permission | null {
    const parts = permissionStr.split(":");
    if (parts.length !== 2) return null;

    const [action, resource] = parts;
    if (!action || !resource) return null;

    return { action: action as Action, resource: resource as Resource };
  }

  // ===================================================================
  // PRIVATE METHODS
  // ===================================================================

  private applyRolePermissions(can: any, _cannot: any, role: Role): void {
    for (const permission of role.permissions) {
      this.applyPermission(can, _cannot, permission);
    }
  }

  private applyPermission(
    can: any,
    _cannot: any,
    permission: Permission
  ): void {
    const { action, resource, conditions } = permission;

    if (conditions) {
      can(action, resource, conditions);
    } else {
      can(action, resource);
    }
  }

  private async cacheRole(role: Role): Promise<void> {
    try {
      await this.deps.redis.setex(
        `role:${role.name}`,
        3600, // 1 hour
        JSON.stringify(role)
      );
    } catch (error) {
      this.deps.monitoring.logger.warn("Failed to cache role", {
        role: role.name,
        error,
      });
    }
  }

  private initializeDefaultRoles(): void {
    // Admin role with full access
    const adminRole: Role = {
      id: "admin",
      name: "admin",
      description: "Administrator with full system access",
      permissions: [{ action: "manage", resource: "all" }],
    };

    // User role with basic access
    const userRole: Role = {
      id: "user",
      name: "user",
      description: "Standard user with basic access",
      permissions: [
        { action: "read", resource: "user" },
        { action: "update", resource: "user" },
        { action: "read", resource: "session" },
        { action: "read", resource: "api_key" },
      ],
    };

    // Guest role with minimal access
    const guestRole: Role = {
      id: "guest",
      name: "guest",
      description: "Guest user with minimal access",
      permissions: [{ action: "read", resource: "user" }],
    };

    this.addRole(adminRole);
    this.addRole(userRole);
    this.addRole(guestRole);
  }

  private getPermittedFieldsFromAbility(
    ability: AppAbility,
    action: Action,
    resource: Resource
  ): string[] {
    // Simple implementation without @casl/ability/extra
    // In a real implementation, you might want to define field permissions explicitly
    const rules = ability.rules.filter(
      (rule: any) =>
        rule.action === action &&
        (rule.subject === resource || rule.subject === "all")
    );

    const fields = new Set<string>();
    for (const rule of rules) {
      if (rule.fields) {
        const ruleFields = Array.isArray(rule.fields)
          ? rule.fields
          : [rule.fields];
        ruleFields.forEach((field: string) => fields.add(field));
      }
    }

    return Array.from(fields);
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create permission service instance
 */
export function createPermissionService(
  deps: ServiceDependencies
): PermissionService {
  return new PermissionService(deps);
}

/**
 * Check permissions with ability
 */
export function checkPermissions(
  ability: AppAbility,
  action: Action,
  resource: Resource,
  subject?: any
): boolean {
  return ability.can(action, subject || resource);
}

/**
 * Filter data based on permissions
 */
export function filterByPermissions<T extends Record<string, any>>(
  ability: AppAbility,
  action: Action,
  _resource: Resource,
  data: T[]
): T[] {
  return data.filter((item) => ability.can(action, item));
}

/**
 * Get accessible fields for resource
 */
export function getAccessibleFields(
  ability: AppAbility,
  action: Action,
  _resource: Resource
): string[] {
  // Simple implementation - in production you might want more sophisticated field-level permissions
  const rules = ability.rules.filter(
    (rule: any) =>
      rule.action === action &&
      (rule.subject === _resource || rule.subject === "all")
  );

  const fields = new Set<string>();
  for (const rule of rules) {
    if (rule.fields) {
      const ruleFields = Array.isArray(rule.fields)
        ? rule.fields
        : [rule.fields];
      ruleFields.forEach((field: string) => fields.add(field));
    }
  }

  return Array.from(fields);
}

// ===================================================================
// DEFAULT EXPORT
// ===================================================================

export default PermissionService;
