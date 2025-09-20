import { createLogger } from "@libs/utils";
import { ICacheManager } from "./cache-manager.service";
import type { IRoleHierarchyManager } from "./role-hierarchy-manager.service";

const logger = createLogger("PermissionEvaluator");

export interface RBACDecision {
  allowed: boolean;
  effectiveRoles: string[];
  effectivePermissions: string[];
  matchedPolicies: string[];
  reason?: string;
  context?: Record<string, any>;
}

export interface IPermissionEvaluator {
  checkPermission(
    accessToken: string,
    resource: string,
    permission: string,
    context?: any
  ): Promise<RBACDecision>;
  checkMultiplePermissions(
    accessToken: string,
    checks: Array<{ resource: string; permission: string }>,
    context?: any
  ): Promise<Map<string, RBACDecision>>;
}

export class PermissionEvaluator implements IPermissionEvaluator {
  constructor(
    private cacheManager: ICacheManager,
    private roleHierarchyManager: IRoleHierarchyManager,
    private enablePolicyCaching: boolean = true,
    private permissionCacheTtl: number = 300
  ) {}

  async checkPermission(
    accessToken: string,
    resource: string,
    permission: string,
    _context?: any
  ): Promise<RBACDecision> {
    const cacheKey = this.enablePolicyCaching
      ? `rbac:${resource}:${permission}:${this.getTokenHash(accessToken)}`
      : undefined;

    // Try cache first
    if (cacheKey && this.cacheManager) {
      const cached = await this.cacheManager.get(cacheKey);
      if (cached?.data) {
        logger.debug("RBAC decision from cache", { resource, permission });
        return cached.data as RBACDecision;
      }
    }

    try {
      // Expand roles and permissions
      const userRoles = await this.roleHierarchyManager.getUserEffectiveRoles(
        accessToken
      );
      const effectiveRoles = userRoles;
      const effectivePermissions = this.calculateEffectivePermissions(
        effectiveRoles,
        resource,
        permission
      );

      // Determine final decision
      const allowed = this.hasRequiredPermission(
        effectivePermissions,
        resource,
        permission
      );

      const decision: RBACDecision = {
        allowed,
        effectiveRoles,
        effectivePermissions,
        matchedPolicies: allowed ? ["local_rbac"] : [],
        reason: allowed ? "authorized" : "insufficient permissions",
        context: {
          userRoles,
        },
      };

      // Cache the decision
      if (cacheKey && this.cacheManager) {
        await this.cacheManager.set(
          cacheKey,
          decision,
          this.permissionCacheTtl
        );
      }

      // Audit log
      logger.info("RBAC permission check", {
        resource,
        permission,
        allowed: decision.allowed,
        effectiveRoles: decision.effectiveRoles,
        reason: decision.reason,
      });

      return decision;
    } catch (error) {
      logger.error("RBAC permission check failed", {
        resource,
        permission,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        allowed: false,
        effectiveRoles: [],
        effectivePermissions: [],
        matchedPolicies: [],
        reason: "rbac_check_error",
        context: {
          error: String(error),
        },
      };
    }
  }

  async checkMultiplePermissions(
    accessToken: string,
    checks: Array<{ resource: string; permission: string }>,
    context?: any
  ): Promise<Map<string, RBACDecision>> {
    const results = new Map<string, RBACDecision>();
    for (const { resource, permission } of checks) {
      const key = `${resource}:${permission}`;
      const decision = await this.checkPermission(
        accessToken,
        resource,
        permission,
        context
      );
      results.set(key, decision);
    }
    return results;
  }

  private calculateEffectivePermissions(
    roles: string[],
    _resource: string,
    _permission: string
  ): string[] {
    // This would typically use role definitions to aggregate permissions
    // For now, return roles as permissions for demonstration
    return roles;
  }

  private hasRequiredPermission(
    effectivePermissions: string[],
    resource: string,
    permission: string
  ): boolean {
    const requiredPermission = `${resource}:${permission}`;
    return effectivePermissions.some((perm) => {
      if (perm === requiredPermission) return true;
      if (perm === "*") return true;
      if (perm === `${resource}:*`) return true;
      if (perm === `*:${permission}`) return true;
      return false;
    });
  }

  private getTokenHash(token: string): string {
    // Simple hash for cache key
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = (hash << 5) - hash + token.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString();
  }
}
