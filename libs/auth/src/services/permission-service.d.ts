/**
 * CASL-based Permission Service
 * Implements role-based access control using the CASL ability system
 * Provides comprehensive permission management with fine-grained control
 */
import { Action, Resource, Permission, Role, AppAbility, User, AuthContext, ServiceDependencies } from "../types";
export declare class PermissionService {
    private deps;
    private roles;
    constructor(deps: ServiceDependencies);
    /**
     * Create ability instance for a user
     */
    createAbility(user: User): AppAbility;
    /**
     * Check if user can perform action on resource
     */
    can(user: User, action: Action, resource: Resource, subject?: any): boolean;
    /**
     * Check if user cannot perform action on resource
     */
    cannot(user: User, action: Action, resource: Resource, subject?: any): boolean;
    /**
     * Get permitted fields for user on resource
     */
    getPermittedFields(user: User, action: Action, resource: Resource): string[];
    /**
     * Create authorization context for user
     */
    createAuthContext(user: User): AuthContext;
    /**
     * Add or update a role
     */
    addRole(role: Role): void;
    /**
     * Remove a role
     */
    removeRole(roleName: string): void;
    /**
     * Get role by name
     */
    getRole(roleName: string): Role | undefined;
    /**
     * List all roles
     */
    getAllRoles(): Role[];
    /**
     * Add permission to role
     */
    addPermissionToRole(roleName: string, permission: Permission): void;
    /**
     * Remove permission from role
     */
    removePermissionFromRole(roleName: string, permissionId: string): void;
    /**
     * Check if user has role
     */
    userHasRole(user: User, roleName: string): boolean;
    /**
     * Check if user has permission
     */
    userHasPermission(user: User, permission: string): boolean;
    /**
     * Get all permissions for user (from roles + direct)
     */
    getUserPermissions(user: User): string[];
    /**
     * Validate permission format
     */
    validatePermission(permission: Permission): boolean;
    /**
     * Validate role format
     */
    validateRole(role: Role): boolean;
    /**
     * Parse permission string into Permission object
     */
    private parsePermissionString;
    private applyRolePermissions;
    private applyPermission;
    private cacheRole;
    private initializeDefaultRoles;
    private getPermittedFieldsFromAbility;
}
/**
 * Create permission service instance
 */
export declare function createPermissionService(deps: ServiceDependencies): PermissionService;
/**
 * Check permissions with ability
 */
export declare function checkPermissions(ability: AppAbility, action: Action, resource: Resource, subject?: any): boolean;
/**
 * Filter data based on permissions
 */
export declare function filterByPermissions<T extends Record<string, any>>(ability: AppAbility, action: Action, _resource: Resource, data: T[]): T[];
/**
 * Get accessible fields for resource
 */
export declare function getAccessibleFields(ability: AppAbility, action: Action, _resource: Resource): string[];
export default PermissionService;
//# sourceMappingURL=permission-service.d.ts.map