/**
 * RBAC configuration
 */
export interface RBACConfiguration {
  roleHierarchy: RoleHierarchy;
  permissionScopes: PermissionScope[];
  enableCaching?: boolean;
  cacheTTL?: number;
  enablePolicySync?: boolean;
  policySyncInterval?: number;
}

/**
 * Enhanced RBAC Service using Keycloak Authorization Services
 * Provides role hierarchy, dynamic permissions, and policy-based access control
 */

import { createLogger } from "@libs/utils";
import {
  KeycloakAuthorizationServicesClient,
  type AuthorizationContext,
  type PolicyRepresentation,
} from "./keycloak-authorization-services";
import { CacheService } from "@libs/database";

const logger = createLogger("EnhancedRBACService");

/**
 * Role hierarchy definition
 */
export interface RoleHierarchy {
  [role: string]: {
    inherits: string[];
    permissions: string[];
    description?: string;
  };
}

/**
 * Permission scope definition
 */
export interface PermissionScope {
  name: string;
  description: string;
  category: string;
  resources?: string[];
}

/**
 * RBAC check result with detailed information
 */
export interface RBACDecision {
  allowed: boolean;
  effectiveRoles: string[];
  effectivePermissions: string[];
  matchedPolicies: string[];
  reason?: string;
  context?: Record<string, any>;
}

/**
 * RBAC configuration
 */
export interface RBACConfig {
  /** Enable role hierarchy expansion */
  enableRoleHierarchy: boolean;
  /** Enable dynamic permission evaluation */
  enableDynamicPermissions: boolean;
  /** Enable policy caching */
  enablePolicyCaching: boolean;
  /** Cache TTL for role expansions (seconds) */
  roleExpansionCacheTtl: number;
  /** Cache TTL for permission checks (seconds) */
  permissionCacheTtl: number;
  /** Enable audit logging */
  enableAuditLogging: boolean;
}

/**
 * Default RBAC configuration
 */
export const DEFAULT_RBAC_CONFIG: RBACConfig = {
  enableRoleHierarchy: true,
  enableDynamicPermissions: true,
  enablePolicyCaching: true,
  roleExpansionCacheTtl: 1800, // 30 minutes
  permissionCacheTtl: 300, // 5 minutes
  enableAuditLogging: true,
};

/**
 * Enhanced RBAC Service
 */
export class EnhancedRBACService {
  private authzClient: KeycloakAuthorizationServicesClient;
  private cacheService: CacheService | undefined;
  private config: RBACConfig;
  private roleHierarchy: RoleHierarchy;
  private permissionScopes: Map<string, PermissionScope>;

  constructor(
    authzClient: KeycloakAuthorizationServicesClient,
    roleHierarchy: RoleHierarchy = {},
    cacheService?: CacheService,
    config: Partial<RBACConfig> = {}
  ) {
    // Validate required dependencies
    if (!authzClient) {
      throw new Error("EnhancedRBACService requires a valid authzClient");
    }

    this.authzClient = authzClient;
    this.cacheService = cacheService;
    this.roleHierarchy = roleHierarchy;
    this.permissionScopes = new Map();

    // Validate and merge configuration
    const mergedConfig = { ...DEFAULT_RBAC_CONFIG, ...config };
    this.validateConfig(mergedConfig);
    this.config = mergedConfig;

    logger.info("Enhanced RBAC Service initialized", {
      roleHierarchySize: Object.keys(roleHierarchy).length,
      config: this.config,
    });
  }

  /**
   * Validate configuration parameters
   */
  private validateConfig(config: RBACConfig): void {
    if (config.roleExpansionCacheTtl < 0) {
      throw new Error("roleExpansionCacheTtl must be a non-negative number");
    }
    if (config.permissionCacheTtl < 0) {
      throw new Error("permissionCacheTtl must be a non-negative number");
    }
    if (config.roleExpansionCacheTtl > 86400) {
      logger.warn(
        "roleExpansionCacheTtl is very high, consider using a lower value",
        {
          roleExpansionCacheTtl: config.roleExpansionCacheTtl,
        }
      );
    }
  }

  /**
   * Check if user has permission for a resource
   */
  public async checkPermission(
    accessToken: string,
    resource: string,
    action: string,
    context?: AuthorizationContext
  ): Promise<RBACDecision> {
    const cacheKey = this.config.enablePolicyCaching
      ? `rbac:${resource}:${action}:${this.getTokenHash(accessToken)}`
      : undefined;

    // Try cache first
    if (cacheKey && this.cacheService) {
      const cached = await this.cacheService.get(cacheKey);
      if (cached.data) {
        logger.debug("RBAC decision from cache", { resource, action });
        return cached.data as RBACDecision;
      }
    }

    try {
      // Get basic authorization decision
      const authzDecision = await this.authzClient.checkAuthorization(
        accessToken,
        resource,
        [action],
        context
      );

      // If basic check fails and hierarchy is disabled, return early
      if (!authzDecision.granted && !this.config.enableRoleHierarchy) {
        const decision: RBACDecision = {
          allowed: false,
          effectiveRoles: [],
          effectivePermissions: [],
          matchedPolicies: [],
          reason: authzDecision.reason || "access_denied",
        };
        return decision;
      }

      // Extract user roles from token (this would typically come from JWT claims)
      const userRoles = await this.extractUserRoles(accessToken);

      // Expand roles based on hierarchy
      const effectiveRoles = this.config.enableRoleHierarchy
        ? await this.expandRoles(userRoles)
        : userRoles;

      // Calculate effective permissions
      const effectivePermissions = await this.calculateEffectivePermissions(
        effectiveRoles,
        resource,
        action
      );

      // Determine final decision
      const allowed =
        authzDecision.granted ||
        (this.config.enableDynamicPermissions &&
          this.hasRequiredPermission(effectivePermissions, resource, action));

      const decision: RBACDecision = {
        allowed,
        effectiveRoles,
        effectivePermissions,
        matchedPolicies: authzDecision.granted ? ["keycloak_authz"] : [],
        reason: allowed
          ? "authorized"
          : authzDecision.reason || "insufficient_permissions",
        context: {
          originalAuthzDecision: authzDecision,
          userRoles,
          expandedRoles: effectiveRoles.length > userRoles.length,
        },
      };

      // Cache the decision
      if (cacheKey && this.cacheService) {
        await this.cacheService.set(
          cacheKey,
          decision,
          this.config.permissionCacheTtl
        );
      }

      // Audit log if enabled
      if (this.config.enableAuditLogging) {
        logger.info("RBAC permission check", {
          resource,
          action,
          allowed: decision.allowed,
          userId: context?.userId,
          effectiveRoles: decision.effectiveRoles,
          reason: decision.reason,
        });
      }

      return decision;
    } catch (error) {
      logger.error("RBAC permission check failed", {
        resource,
        action,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        allowed: false,
        effectiveRoles: [],
        effectivePermissions: [],
        matchedPolicies: [],
        reason: "rbac_check_error",
        context: { error: String(error) },
      };
    }
  }

  /**
   * Check multiple permissions at once
   */
  public async checkMultiplePermissions(
    accessToken: string,
    checks: Array<{ resource: string; action: string }>,
    context?: AuthorizationContext
  ): Promise<Map<string, RBACDecision>> {
    const results = new Map<string, RBACDecision>();

    // Execute checks in parallel
    const checkPromises = checks.map(async ({ resource, action }) => {
      const key = `${resource}:${action}`;
      const decision = await this.checkPermission(
        accessToken,
        resource,
        action,
        context
      );
      return [key, decision] as const;
    });

    const checkResults = await Promise.all(checkPromises);

    checkResults.forEach(([key, decision]) => {
      results.set(key, decision);
    });

    return results;
  }

  /**
   * Register permission scopes for dynamic evaluation
   */
  public registerPermissionScope(scope: PermissionScope): void {
    this.permissionScopes.set(scope.name, scope);
    logger.debug("Permission scope registered", {
      name: scope.name,
      category: scope.category,
    });
  }

  /**
   * Clear permission scopes to prevent memory leaks
   */
  public clearPermissionScopes(): void {
    const count = this.permissionScopes.size;
    this.permissionScopes.clear();
    logger.debug("Permission scopes cleared", { count });
  }

  /**
   * Get permission scope by name
   */
  public getPermissionScope(name: string): PermissionScope | undefined {
    return this.permissionScopes.get(name);
  }

  /**
   * Get all registered permission scopes
   */
  public getAllPermissionScopes(): PermissionScope[] {
    return Array.from(this.permissionScopes.values());
  }

  /**
   * Update role hierarchy
   */
  public updateRoleHierarchy(newHierarchy: RoleHierarchy): void {
    this.roleHierarchy = { ...this.roleHierarchy, ...newHierarchy };

    // Clear role expansion cache
    if (this.cacheService) {
      this.cacheService.invalidatePattern("role_expansion:*");
    }

    logger.info("Role hierarchy updated", {
      totalRoles: Object.keys(this.roleHierarchy).length,
    });
  }

  /**
   * Get effective roles for a user (with hierarchy expansion)
   */
  public async getUserEffectiveRoles(accessToken: string): Promise<string[]> {
    const userRoles = await this.extractUserRoles(accessToken);
    return this.config.enableRoleHierarchy
      ? await this.expandRoles(userRoles)
      : userRoles;
  }

  /**
   * Setup default role hierarchy for common patterns
   */
  public setupDefaultRoleHierarchy(): void {
    const defaultHierarchy: RoleHierarchy = {
      super_admin: {
        inherits: ["admin"],
        permissions: ["system:*", "user:*", "resource:*"],
        description: "Super administrator with full system access",
      },
      admin: {
        inherits: ["manager"],
        permissions: ["user:manage", "resource:manage", "report:view"],
        description: "System administrator",
      },
      manager: {
        inherits: ["user"],
        permissions: ["resource:create", "resource:update", "user:view"],
        description: "Resource manager",
      },
      user: {
        inherits: [],
        permissions: ["resource:read", "profile:update"],
        description: "Standard user",
      },
      guest: {
        inherits: [],
        permissions: ["resource:read"],
        description: "Guest user with read-only access",
      },
    };

    this.updateRoleHierarchy(defaultHierarchy);
  }

  /**
   * Create authorization policies based on role hierarchy
   */
  public async syncPoliciesToKeycloak(): Promise<void> {
    logger.info("Syncing role hierarchy policies to Keycloak");

    for (const [roleName, roleDefinition] of Object.entries(
      this.roleHierarchy
    )) {
      try {
        // Create role-based policy
        const rolePolicy: PolicyRepresentation = {
          name: `${roleName}-policy`,
          type: "role",
          description:
            roleDefinition.description || `Policy for role: ${roleName}`,
          config: {
            roles: JSON.stringify([{ id: roleName, required: false }]),
          },
        };

        await this.authzClient.createPolicy(rolePolicy);

        // Create policies for inherited roles if they exist
        if (roleDefinition.inherits.length > 0) {
          const inheritancePolicy: PolicyRepresentation = {
            name: `${roleName}-inheritance-policy`,
            type: "role",
            description: `Inheritance policy for ${roleName}`,
            config: {
              roles: JSON.stringify(
                [roleName, ...roleDefinition.inherits].map((role) => ({
                  id: role,
                  required: false,
                }))
              ),
            },
          };

          await this.authzClient.createPolicy(inheritancePolicy);
        }

        logger.debug("Policy synced to Keycloak", { roleName });
      } catch (error) {
        logger.error("Failed to sync policy to Keycloak", {
          roleName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Extract user roles from access token
   */
  private async extractUserRoles(accessToken: string): Promise<string[]> {
    try {
      // Validate JWT structure
      const tokenParts = accessToken.split(".");
      if (tokenParts.length !== 3 || !tokenParts[1]) {
        logger.warn("Invalid JWT token structure", {
          partsCount: tokenParts.length,
        });
        return [];
      }

      // Safely decode JWT payload
      let payload: any;
      try {
        const payloadBase64 = tokenParts[1];
        // Add padding if needed
        const paddedPayload =
          payloadBase64 + "=".repeat((4 - (payloadBase64.length % 4)) % 4);
        payload = JSON.parse(Buffer.from(paddedPayload, "base64").toString());
      } catch (decodeError) {
        logger.warn("Failed to decode JWT payload", {
          error:
            decodeError instanceof Error
              ? decodeError.message
              : String(decodeError),
        });
        return [];
      }

      const roles: string[] = [];

      // Extract realm roles
      if (
        payload.realm_access?.roles &&
        Array.isArray(payload.realm_access.roles)
      ) {
        roles.push(
          ...payload.realm_access.roles.filter(
            (role: any) => typeof role === "string"
          )
        );
      }

      // Extract client roles
      if (
        payload.resource_access &&
        typeof payload.resource_access === "object"
      ) {
        Object.values(payload.resource_access).forEach((clientAccess: any) => {
          if (clientAccess?.roles && Array.isArray(clientAccess.roles)) {
            roles.push(
              ...clientAccess.roles.filter(
                (role: any) => typeof role === "string"
              )
            );
          }
        });
      }

      return [...new Set(roles)]; // Remove duplicates
    } catch (error) {
      logger.error("Failed to extract roles from token", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Expand roles based on hierarchy
   */
  private async expandRoles(userRoles: string[]): Promise<string[]> {
    const cacheKey = `role_expansion:${userRoles.sort().join(":")}`;

    // Try cache first
    if (this.cacheService) {
      const cached = await this.cacheService.get(cacheKey);
      if (cached.data) {
        return cached.data as string[];
      }
    }

    const expandedRoles = new Set(userRoles);

    // Recursively expand roles with proper circular dependency detection
    const expandRole = (roleName: string, visited: Set<string>) => {
      if (visited.has(roleName)) {
        logger.warn("Circular role dependency detected", {
          roleName,
          visited: Array.from(visited),
        });
        return;
      }

      const roleDefinition = this.roleHierarchy[roleName];
      if (!roleDefinition?.inherits?.length) {
        return;
      }

      // Add current role to visited set for this path
      visited.add(roleName);

      roleDefinition.inherits.forEach((inheritedRole) => {
        expandedRoles.add(inheritedRole);
        // Pass the same visited set to detect circular dependencies
        expandRole(inheritedRole, visited);
      });

      // Remove from visited set when backtracking
      visited.delete(roleName);
    };

    userRoles.forEach((role) => expandRole(role, new Set()));
    const result = Array.from(expandedRoles);

    // Cache the result
    if (this.cacheService) {
      await this.cacheService.set(
        cacheKey,
        result,
        this.config.roleExpansionCacheTtl
      );
    }

    return result;
  }

  /**
   * Calculate effective permissions for roles
   */
  private async calculateEffectivePermissions(
    roles: string[],
    _resource: string,
    _action: string
  ): Promise<string[]> {
    const permissions = new Set<string>();

    roles.forEach((role) => {
      const roleDefinition = this.roleHierarchy[role];
      if (roleDefinition?.permissions) {
        roleDefinition.permissions.forEach((permission) => {
          permissions.add(permission);
        });
      }
    });

    return Array.from(permissions);
  }

  /**
   * Check if effective permissions include required permission
   */
  private hasRequiredPermission(
    effectivePermissions: string[],
    resource: string,
    action: string
  ): boolean {
    const requiredPermission = `${resource}:${action}`;
    const wildcardPermission = `${resource}:*`;
    const globalPermission = "system:*";

    return effectivePermissions.some(
      (permission) =>
        permission === requiredPermission ||
        permission === wildcardPermission ||
        permission === globalPermission
    );
  }

  /**
   * Get secure hash of token for caching
   */
  private getTokenHash(token: string): string {
    const crypto = require("crypto");
    return crypto
      .createHash("sha256")
      .update(token)
      .digest("hex")
      .substring(0, 16);
  }
}

/**
 * Create Enhanced RBAC Service
 */
export function createEnhancedRBACService(
  authzClient: KeycloakAuthorizationServicesClient,
  roleHierarchy?: RoleHierarchy,
  cacheService?: CacheService,
  config?: Partial<RBACConfig>
): EnhancedRBACService {
  return new EnhancedRBACService(
    authzClient,
    roleHierarchy,
    cacheService,
    config
  );
}

/**
 * RBAC helper functions
 */
export const RBACHelpers = {
  /**
   * Create a simple role hierarchy
   */
  createSimpleHierarchy(): RoleHierarchy {
    return {
      admin: {
        inherits: ["user"],
        permissions: ["*:*"],
        description: "Administrator with full access",
      },
      user: {
        inherits: [],
        permissions: ["resource:read", "profile:update"],
        description: "Standard user",
      },
    };
  },

  /**
   * Create enterprise role hierarchy
   */
  createEnterpriseHierarchy(): RoleHierarchy {
    return {
      global_admin: {
        inherits: ["tenant_admin"],
        permissions: ["system:*", "tenant:*", "user:*"],
        description: "Global system administrator",
      },
      tenant_admin: {
        inherits: ["department_manager"],
        permissions: ["tenant:manage", "user:manage", "resource:manage"],
        description: "Tenant administrator",
      },
      department_manager: {
        inherits: ["team_lead"],
        permissions: ["department:manage", "user:create", "resource:create"],
        description: "Department manager",
      },
      team_lead: {
        inherits: ["employee"],
        permissions: ["team:manage", "resource:update", "report:view"],
        description: "Team lead",
      },
      employee: {
        inherits: ["guest"],
        permissions: ["resource:read", "profile:update", "task:create"],
        description: "Employee",
      },
      guest: {
        inherits: [],
        permissions: ["resource:read"],
        description: "Guest user",
      },
    };
  },

  /**
   * Validate role hierarchy for circular dependencies
   */
  validateHierarchy(hierarchy: RoleHierarchy): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const validateRole = (roleName: string): boolean => {
      if (recursionStack.has(roleName)) {
        errors.push(`Circular dependency detected: ${roleName}`);
        return false;
      }

      if (visited.has(roleName)) {
        return true;
      }

      visited.add(roleName);
      recursionStack.add(roleName);

      const roleDefinition = hierarchy[roleName];
      if (roleDefinition?.inherits) {
        for (const inheritedRole of roleDefinition.inherits) {
          if (!hierarchy[inheritedRole]) {
            errors.push(
              `Role ${roleName} inherits from undefined role: ${inheritedRole}`
            );
            continue;
          }

          if (!validateRole(inheritedRole)) {
            return false;
          }
        }
      }

      recursionStack.delete(roleName);
      return true;
    };

    Object.keys(hierarchy).forEach(validateRole);

    return {
      valid: errors.length === 0,
      errors,
    };
  },
};
