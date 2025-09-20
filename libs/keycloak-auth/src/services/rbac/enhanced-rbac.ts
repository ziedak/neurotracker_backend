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
import SHA256 from "crypto-js/sha256";
import {
  KeycloakAuthorizationServicesClient,
  type AuthorizationContext,
} from "../keycloak-authorization-services";
import type { PermissionEvaluator } from "./permission-evaluator.service";
import type { PolicySyncService } from "./policy-sync.service";
import type { RoleHierarchyManager } from "./role-hierarchy-manager.service";

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
  roleExpansionCacheTtl: parseInt(
    process.env["RBAC_ROLE_EXPANSION_CACHE_TTL"] || "1800",
    10
  ), // 30 minutes
  permissionCacheTtl: parseInt(
    process.env["RBAC_PERMISSION_CACHE_TTL"] || "300",
    10
  ), // 5 minutes
  enableAuditLogging: true,
};

/**
 * Enhanced RBAC Service
 */
export class EnhancedRBACService {
  private authzClient: KeycloakAuthorizationServicesClient;
  private roleHierarchyManager: RoleHierarchyManager;
  private permissionEvaluator: PermissionEvaluator;
  private policySyncService: PolicySyncService;
  private config: RBACConfig;
  private permissionScopes: Map<string, PermissionScope>;

  constructor(
    authzClient: KeycloakAuthorizationServicesClient,
    roleHierarchyManager: RoleHierarchyManager,
    permissionEvaluator: PermissionEvaluator,
    policySyncService: PolicySyncService,
    config: RBACConfig
  ) {
    if (!authzClient) {
      throw new Error("EnhancedRBACService requires a valid authzClient");
    }
    this.authzClient = authzClient;
    this.roleHierarchyManager = roleHierarchyManager;
    this.permissionEvaluator = permissionEvaluator;
    this.policySyncService = policySyncService;
    this.config = config;
    this.permissionScopes = new Map();
    logger.info("Enhanced RBAC Service initialized (refactored)", {
      config: this.config,
    });
  }
  /**
   * Public method to generate cache key for permission checks (for testing)
   */
  public generateCacheKey(
    accessToken: string,
    resource: string,
    permission: string
  ): string {
    return `rbac:${resource}:${permission}:${this.getTokenHash(accessToken)}`;
  }
  /**
   * Check if user has permission for a resource
   */
  public async checkPermission(
    accessToken: string,
    resource: string,
    permission: string,
    context?: AuthorizationContext
  ): Promise<RBACDecision> {
    return this.permissionEvaluator.checkPermission(
      accessToken,
      resource,
      permission,
      context
    );
  }

  /**
   * Check multiple permissions at once
   */
  public async checkMultiplePermissions(
    accessToken: string,
    checks: Array<{ resource: string; permission: string }>,
    context?: AuthorizationContext
  ): Promise<Map<string, RBACDecision>> {
    return this.permissionEvaluator.checkMultiplePermissions(
      accessToken,
      checks,
      context
    );
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
    this.roleHierarchyManager.updateRoleHierarchy(newHierarchy);
  }

  /**
   * Get effective roles for a user (with hierarchy expansion)
   */
  public async getUserEffectiveRoles(accessToken: string): Promise<string[]> {
    return this.roleHierarchyManager.getUserEffectiveRoles(accessToken);
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
    return this.policySyncService.syncPoliciesToKeycloak(
      this.roleHierarchyManager.getRoleHierarchy(),
      this.authzClient
    );
  }

  /**
   * Get secure hash of token for caching (uses SHA256 for fast hashing, not for security)
   * Note: This is for caching purposes only; do not use for password hashing.
   */
  private getTokenHash(token: string): string {
    // SHA256 returns a WordArray, .toString() gives hex
    return SHA256(token).toString().substring(0, 16);
  }
}

/**
 * Create Enhanced RBAC Service
 */
export function createEnhancedRBACService(
  authzClient: KeycloakAuthorizationServicesClient,
  roleHierarchyManager: RoleHierarchyManager,
  permissionEvaluator: PermissionEvaluator,
  policySyncService: PolicySyncService,
  config?: Partial<RBACConfig>
): EnhancedRBACService {
  const mergedConfig = { ...DEFAULT_RBAC_CONFIG, ...config };
  return new EnhancedRBACService(
    authzClient,
    roleHierarchyManager,
    permissionEvaluator,
    policySyncService,
    mergedConfig
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
