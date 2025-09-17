/**
 * CASL-based Permission Service
 * Implements role-based access control using the CASL ability system
 * Provides comprehensive permission management with fine-grained control
 */
import { AbilityBuilder, PureAbility } from "@casl/ability";
// ===================================================================
// PERMISSION SERVICE CLASS
// ===================================================================
export class PermissionService {
    deps;
    roles = new Map();
    constructor(deps) {
        this.deps = deps;
        this.initializeDefaultRoles();
    }
    /**
     * Create ability instance for a user
     */
    createAbility(user) {
        const { can, cannot, build } = new AbilityBuilder(PureAbility);
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
    can(user, action, resource, subject) {
        const ability = this.createAbility(user);
        return ability.can(action, subject || resource);
    }
    /**
     * Check if user cannot perform action on resource
     */
    cannot(user, action, resource, subject) {
        const ability = this.createAbility(user);
        return ability.cannot(action, subject || resource);
    }
    /**
     * Get permitted fields for user on resource
     */
    getPermittedFields(user, action, resource) {
        const ability = this.createAbility(user);
        return this.getPermittedFieldsFromAbility(ability, action, resource);
    }
    /**
     * Create authorization context for user
     */
    createAuthContext(user) {
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
    addRole(role) {
        this.roles.set(role.name, role);
        this.cacheRole(role);
    }
    /**
     * Remove a role
     */
    removeRole(roleName) {
        this.roles.delete(roleName);
        this.deps.redis.del(`role:${roleName}`);
    }
    /**
     * Get role by name
     */
    getRole(roleName) {
        return this.roles.get(roleName);
    }
    /**
     * List all roles
     */
    getAllRoles() {
        return Array.from(this.roles.values());
    }
    /**
     * Add permission to role
     */
    addPermissionToRole(roleName, permission) {
        const role = this.roles.get(roleName);
        if (role) {
            role.permissions.push(permission);
            this.cacheRole(role);
        }
    }
    /**
     * Remove permission from role
     */
    removePermissionFromRole(roleName, permissionId) {
        const role = this.roles.get(roleName);
        if (role) {
            role.permissions = role.permissions.filter((p) => `${p.action}:${p.resource}` !== permissionId);
            this.cacheRole(role);
        }
    }
    /**
     * Check if user has role
     */
    userHasRole(user, roleName) {
        return user.roles.includes(roleName);
    }
    /**
     * Check if user has permission
     */
    userHasPermission(user, permission) {
        return user.permissions.includes(permission);
    }
    /**
     * Get all permissions for user (from roles + direct)
     */
    getUserPermissions(user) {
        const rolePermissions = new Set();
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
    validatePermission(permission) {
        return !!(permission.action &&
            permission.resource &&
            typeof permission.action === "string" &&
            typeof permission.resource === "string");
    }
    /**
     * Validate role format
     */
    validateRole(role) {
        return !!(role.id &&
            role.name &&
            Array.isArray(role.permissions) &&
            typeof role.id === "string" &&
            typeof role.name === "string");
    }
    /**
     * Parse permission string into Permission object
     */
    parsePermissionString(permissionStr) {
        const parts = permissionStr.split(":");
        if (parts.length !== 2)
            return null;
        const [action, resource] = parts;
        if (!action || !resource)
            return null;
        return { action: action, resource: resource };
    }
    // ===================================================================
    // PRIVATE METHODS
    // ===================================================================
    applyRolePermissions(can, _cannot, role) {
        for (const permission of role.permissions) {
            this.applyPermission(can, _cannot, permission);
        }
    }
    applyPermission(can, _cannot, permission) {
        const { action, resource, conditions } = permission;
        if (conditions) {
            can(action, resource, conditions);
        }
        else {
            can(action, resource);
        }
    }
    async cacheRole(role) {
        try {
            await this.deps.redis.setex(`role:${role.name}`, 3600, // 1 hour
            JSON.stringify(role));
        }
        catch (error) {
            this.deps.monitoring.logger.warn("Failed to cache role", {
                role: role.name,
                error,
            });
        }
    }
    initializeDefaultRoles() {
        // Admin role with full access
        const adminRole = {
            id: "admin",
            name: "admin",
            description: "Administrator with full system access",
            permissions: [{ action: "manage", resource: "all" }],
        };
        // User role with basic access
        const userRole = {
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
        const guestRole = {
            id: "guest",
            name: "guest",
            description: "Guest user with minimal access",
            permissions: [{ action: "read", resource: "user" }],
        };
        this.addRole(adminRole);
        this.addRole(userRole);
        this.addRole(guestRole);
    }
    getPermittedFieldsFromAbility(ability, action, resource) {
        // Simple implementation without @casl/ability/extra
        // In a real implementation, you might want to define field permissions explicitly
        const rules = ability.rules.filter((rule) => rule.action === action &&
            (rule.subject === resource || rule.subject === "all"));
        const fields = new Set();
        for (const rule of rules) {
            if (rule.fields) {
                const ruleFields = Array.isArray(rule.fields)
                    ? rule.fields
                    : [rule.fields];
                ruleFields.forEach((field) => fields.add(field));
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
export function createPermissionService(deps) {
    return new PermissionService(deps);
}
/**
 * Check permissions with ability
 */
export function checkPermissions(ability, action, resource, subject) {
    return ability.can(action, subject || resource);
}
/**
 * Filter data based on permissions
 */
export function filterByPermissions(ability, action, _resource, data) {
    return data.filter((item) => ability.can(action, item));
}
/**
 * Get accessible fields for resource
 */
export function getAccessibleFields(ability, action, _resource) {
    // Simple implementation - in production you might want more sophisticated field-level permissions
    const rules = ability.rules.filter((rule) => rule.action === action &&
        (rule.subject === _resource || rule.subject === "all"));
    const fields = new Set();
    for (const rule of rules) {
        if (rule.fields) {
            const ruleFields = Array.isArray(rule.fields)
                ? rule.fields
                : [rule.fields];
            ruleFields.forEach((field) => fields.add(field));
        }
    }
    return Array.from(fields);
}
// ===================================================================
// DEFAULT EXPORT
// ===================================================================
export default PermissionService;
//# sourceMappingURL=permission-service.js.map