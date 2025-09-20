import { createLogger } from "@libs/utils";

export interface RoleHierarchy {
  [role: string]: {
    inherits: string[];
    permissions: string[];
    description?: string;
  };
}

const logger = createLogger("RoleHierarchyManager");

export interface IRoleHierarchyManager {
  expandRoles(userRoles: string[]): Promise<string[]>;
  updateRoleHierarchy(newHierarchy: RoleHierarchy): void;
  getUserEffectiveRoles(accessToken: string): Promise<string[]>;
  getRoleHierarchy(): RoleHierarchy;
}

export class RoleHierarchyManager implements IRoleHierarchyManager {
  private roleHierarchy: RoleHierarchy = {};
  private readonly MAX_DEPTH = 10;

  constructor(initialHierarchy?: RoleHierarchy) {
    if (initialHierarchy) {
      this.roleHierarchy = { ...initialHierarchy };
    }
  }

  updateRoleHierarchy(newHierarchy: RoleHierarchy): void {
    this.roleHierarchy = { ...this.roleHierarchy, ...newHierarchy };
    logger.info("Role hierarchy updated", {
      totalRoles: Object.keys(this.roleHierarchy).length,
    });
  }

  async expandRoles(userRoles: string[]): Promise<string[]> {
    const expandedRoles = new Set(userRoles);

    // Recursively expand roles with circular dependency and depth detection
    const expandRole = (
      roleName: string,
      visited: Set<string>,
      depth: number
    ) => {
      if (depth > this.MAX_DEPTH) {
        logger.warn("Max role expansion depth reached", { roleName, depth });
        return;
      }
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
      visited.add(roleName);
      roleDefinition.inherits.forEach((inheritedRole) => {
        expandedRoles.add(inheritedRole);
        expandRole(inheritedRole, visited, depth + 1);
      });
      visited.delete(roleName);
    };

    userRoles.forEach((role) => expandRole(role, new Set(), 0));
    return Array.from(expandedRoles);
  }

  async getUserEffectiveRoles(accessToken: string): Promise<string[]> {
    const userRoles = this.extractUserRoles(accessToken);
    return this.expandRoles(userRoles);
  }

  getRoleHierarchy(): RoleHierarchy {
    return { ...this.roleHierarchy };
  }

  /**
   * Extract user roles from access token (JWT)
   */
  private extractUserRoles(accessToken: string): string[] {
    try {
      const tokenParts = accessToken.split(".");
      if (
        tokenParts.length !== 3 ||
        !tokenParts[0] ||
        !tokenParts[1] ||
        !tokenParts[2]
      ) {
        logger.warn("Invalid JWT token structure", {
          partsCount: tokenParts.length,
        });
        return [];
      }
      let payload: any;
      try {
        const payloadBase64 = tokenParts[1];
        if (!/^[A-Za-z0-9-_]+$/.test(payloadBase64)) {
          throw new Error("JWT payload is not valid base64url");
        }
        const paddedPayload =
          payloadBase64 + "=".repeat((4 - (payloadBase64.length % 4)) % 4);
        const decoded = Buffer.from(paddedPayload, "base64").toString();
        payload = JSON.parse(decoded);
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
      return [...new Set(roles)];
    } catch (error) {
      logger.error("Failed to extract roles from token", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
