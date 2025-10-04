/**
 * Role Checker - Authorization Logic
 *
 * Purpose: Check user authorization (roles, permissions, access rights)
 * Responsibility: Authorization checks on extracted user data
 *
 * For JWT claims extraction, see:
 * - src/services/token/ClaimsExtractor.ts
 */

import type { AuthResult, UserInfo } from "../../types";

/**
 * Authorization checking utility
 * Works with data already extracted from tokens
 */
export class RoleChecker {
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
   * Get roles for a specific client
   */
  static getClientRolesForClient(
    authResult: AuthResult,
    clientId: string
  ): string[] {
    const allClientRoles = this.getClientRoles(authResult);
    return allClientRoles[clientId] || [];
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
   * Check if user has role (works with UserInfo directly)
   */
  static userHasRole(user: UserInfo, role: string): boolean {
    if (!user.roles) {
      return false;
    }

    return user.roles.includes(role) || user.roles.includes(`realm:${role}`);
  }

  /**
   * Check if user has permission (works with UserInfo directly)
   */
  static userHasPermission(user: UserInfo, permission: string): boolean {
    if (!user.permissions) {
      return false;
    }

    return user.permissions.includes(permission);
  }

  /**
   * Check if user has any of the required roles
   */
  static userHasAnyRole(user: UserInfo, requiredRoles: string[]): boolean {
    return requiredRoles.some((role) => this.userHasRole(user, role));
  }

  /**
   * Check if user has all required roles
   */
  static userHasAllRoles(user: UserInfo, requiredRoles: string[]): boolean {
    return requiredRoles.every((role) => this.userHasRole(user, role));
  }
}
