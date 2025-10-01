/**
 * Role Permission Extractor Utility
 * Handles role and permission validation and extraction
 */

import type { AuthResult } from "../../types";

export class RolePermissionExtractor {
  /**
   * Check if a role is present in user roles
   */
  static hasRole(authResult: AuthResult, role: string): boolean {
    if (!authResult.success || !authResult.user?.roles) {
      return false;
    }

    return (
      authResult.user.roles.includes(role) ||
      authResult.user.roles.includes(`realm:${role}`)
    );
  }

  /**
   * Check if any of the required roles are present
   */
  static hasAnyRole(authResult: AuthResult, requiredRoles: string[]): boolean {
    return requiredRoles.some((role) => this.hasRole(authResult, role));
  }

  /**
   * Check if all required roles are present
   */
  static hasAllRoles(authResult: AuthResult, requiredRoles: string[]): boolean {
    return requiredRoles.every((role) => this.hasRole(authResult, role));
  }

  /**
   * Check if a permission is present
   */
  static hasPermission(authResult: AuthResult, permission: string): boolean {
    if (!authResult.success || !authResult.user?.permissions) {
      return false;
    }

    return authResult.user.permissions.includes(permission);
  }

  /**
   * Check if any of the required permissions are present
   */
  static hasAnyPermission(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean {
    return requiredPermissions.some((permission) =>
      this.hasPermission(authResult, permission)
    );
  }

  /**
   * Check if all required permissions are present
   */
  static hasAllPermissions(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean {
    return requiredPermissions.every((permission) =>
      this.hasPermission(authResult, permission)
    );
  }

  /**
   * Get all realm roles for a user
   */
  static getRealmRoles(authResult: AuthResult): string[] {
    if (!authResult.success || !authResult.user?.roles) {
      return [];
    }

    return authResult.user.roles
      .filter((role) => role.startsWith("realm:"))
      .map((role) => role.substring(6)); // Remove 'realm:' prefix
  }

  /**
   * Get all client/resource roles for a user
   */
  static getClientRoles(authResult: AuthResult): Record<string, string[]> {
    if (!authResult.success || !authResult.user?.roles) {
      return {};
    }

    const clientRoles: Record<string, string[]> = {};

    authResult.user.roles
      .filter((role) => role.includes(":") && !role.startsWith("realm:"))
      .forEach((role) => {
        const [client, roleName] = role.split(":", 2);
        if (client && roleName) {
          if (!clientRoles[client]) {
            clientRoles[client] = [];
          }
          clientRoles[client].push(roleName);
        }
      });

    return clientRoles;
  }

  /**
   * Get all permissions for a user
   */
  static getAllPermissions(authResult: AuthResult): string[] {
    if (!authResult.success || !authResult.user?.permissions) {
      return [];
    }

    return [...authResult.user.permissions];
  }

  /**
   * Check if token is expired based on auth result
   */
  static isTokenExpired(authResult: AuthResult): boolean {
    if (!authResult.success || !authResult.expiresAt) {
      return true;
    }

    return new Date() >= authResult.expiresAt;
  }

  /**
   * Get remaining token lifetime in seconds
   */
  static getTokenLifetime(authResult: AuthResult): number {
    if (!authResult.success || !authResult.expiresAt) {
      return 0;
    }

    const remaining = Math.floor(
      (authResult.expiresAt.getTime() - Date.now()) / 1000
    );
    return Math.max(0, remaining);
  }

  /**
   * Check if token will expire within the specified seconds
   */
  static willExpireSoon(
    authResult: AuthResult,
    withinSeconds: number
  ): boolean {
    const remainingSeconds = this.getTokenLifetime(authResult);
    return remainingSeconds <= withinSeconds;
  }

  /**
   * Extract roles from JWT claims
   */
  static extractRolesFromJWT(claims: Record<string, unknown>): string[] {
    const roles: string[] = [];

    // Extract realm roles
    if (claims["realm_access"] && typeof claims["realm_access"] === "object") {
      const realmAccess = claims["realm_access"] as Record<string, unknown>;
      if (Array.isArray(realmAccess["roles"])) {
        roles.push(
          ...(realmAccess["roles"] as string[]).map((role) => `realm:${role}`)
        );
      }
    }

    // Extract resource/client roles
    if (
      claims["resource_access"] &&
      typeof claims["resource_access"] === "object"
    ) {
      const resourceAccess = claims["resource_access"] as Record<
        string,
        unknown
      >;
      for (const [resource, access] of Object.entries(resourceAccess)) {
        if (access && typeof access === "object") {
          const resourceRoles = (access as Record<string, unknown>)["roles"];
          if (Array.isArray(resourceRoles)) {
            roles.push(
              ...(resourceRoles as string[]).map(
                (role) => `${resource}:${role}`
              )
            );
          }
        }
      }
    }

    return roles;
  }

  /**
   * Extract permissions from JWT claims
   */
  static extractPermissionsFromJWT(claims: Record<string, unknown>): string[] {
    const permissions: string[] = [];

    // Extract from authorization claim (UMA permissions)
    if (
      claims["authorization"] &&
      typeof claims["authorization"] === "object"
    ) {
      const auth = claims["authorization"] as Record<string, unknown>;
      if (Array.isArray(auth["permissions"])) {
        permissions.push(...(auth["permissions"] as string[]));
      }
    }

    // Extract from scope claim
    if (claims["scope"] && typeof claims["scope"] === "string") {
      permissions.push(...(claims["scope"] as string).split(" "));
    }

    return permissions;
  }
}
