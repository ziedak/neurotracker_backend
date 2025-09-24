/**
 * UserInfoConverter - Single Responsibility: Data transformation between formats
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles data transformation
 * - Open/Closed: Extensible for new transformation strategies
 * - Liskov Substitution: Can be replaced with different converter implementations
 * - Interface Segregation: Focused on conversion operations only
 * - Dependency Inversion: No external dependencies (pure transformation logic)
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { UserInfo } from "../../types";
import type { IUserInfoConverter, KeycloakUser } from "./interfaces";

export class UserInfoConverter implements IUserInfoConverter {
  private readonly logger: ILogger = createLogger("UserInfoConverter");

  /**
   * Convert Keycloak user to internal UserInfo format
   */
  convertToUserInfo(
    keycloakUser: KeycloakUser,
    roles: string[] = [],
    permissions: string[] = []
  ): UserInfo {
    try {
      if (!keycloakUser.id) {
        throw new Error("Keycloak user must have an ID");
      }

      const userInfo: UserInfo = {
        id: keycloakUser.id,
        username: keycloakUser.username,
        email: keycloakUser.email,
        name: this.buildDisplayName(keycloakUser),
        roles: this.normalizeRoles(roles),
        permissions: this.normalizePermissions(permissions),
        metadata: this.buildMetadata(keycloakUser),
      };

      this.logger.debug("User converted to UserInfo", {
        userId: userInfo.id,
        username: userInfo.username,
        roleCount: userInfo.roles.length,
        permissionCount: userInfo.permissions.length,
      });

      return userInfo;
    } catch (error) {
      this.logger.error("Failed to convert Keycloak user to UserInfo", {
        error,
        username: keycloakUser.username,
        userId: keycloakUser.id,
      });
      throw error;
    }
  }

  /**
   * Convert multiple Keycloak users to UserInfo format
   */
  convertMultipleToUserInfo(
    keycloakUsers: KeycloakUser[],
    rolesMap: Record<string, string[]> = {},
    permissionsMap: Record<string, string[]> = {}
  ): UserInfo[] {
    return keycloakUsers
      .filter((user) => user.id) // Filter out users without IDs
      .map((user) =>
        this.convertToUserInfo(
          user,
          rolesMap[user.id!] || [],
          permissionsMap[user.id!] || []
        )
      );
  }

  /**
   * Extract roles from Keycloak user representation
   */
  extractRolesFromKeycloakUser(keycloakUser: KeycloakUser): string[] {
    const roles: string[] = [];

    // Add realm roles with prefix
    if (keycloakUser.realmRoles) {
      roles.push(...keycloakUser.realmRoles.map((role) => `realm:${role}`));
    }

    // Add client roles with prefix
    if (keycloakUser.clientRoles) {
      for (const [clientId, clientRoles] of Object.entries(
        keycloakUser.clientRoles
      )) {
        roles.push(...clientRoles.map((role) => `client:${clientId}:${role}`));
      }
    }

    return this.normalizeRoles(roles);
  }

  /**
   * Build UserInfo from Keycloak user with embedded roles
   */
  convertKeycloakUserWithEmbeddedRoles(keycloakUser: KeycloakUser): UserInfo {
    const roles = this.extractRolesFromKeycloakUser(keycloakUser);
    const permissions = this.derivePermissionsFromRoles(roles);

    return this.convertToUserInfo(keycloakUser, roles, permissions);
  }

  /**
   * Convert UserInfo back to Keycloak user format (for updates)
   */
  convertToKeycloakUser(userInfo: UserInfo): Partial<KeycloakUser> {
    const nameParts = this.parseDisplayName(userInfo.name);

    return {
      ...(userInfo.username && { username: userInfo.username }),
      ...(userInfo.email && { email: userInfo.email }),
      ...(nameParts.firstName && { firstName: nameParts.firstName }),
      ...(nameParts.lastName && { lastName: nameParts.lastName }),
      ...(userInfo.metadata?.["enabled"] !== undefined && {
        enabled: userInfo.metadata["enabled"] as boolean,
      }),
      ...(userInfo.metadata?.["emailVerified"] !== undefined && {
        emailVerified: userInfo.metadata["emailVerified"] as boolean,
      }),
      ...(userInfo.metadata?.["attributes"] && {
        attributes: userInfo.metadata["attributes"] as Record<string, string[]>,
      }),
    };
  }

  // Private utility methods

  private buildDisplayName(keycloakUser: KeycloakUser): string | undefined {
    const nameParts = [keycloakUser.firstName, keycloakUser.lastName].filter(
      Boolean
    );

    return nameParts.length > 0 ? nameParts.join(" ") : undefined;
  }

  private parseDisplayName(displayName: string | undefined): {
    firstName?: string;
    lastName?: string;
  } {
    if (!displayName) {
      return {};
    }

    const parts = displayName.trim().split(/\s+/);

    if (parts.length === 1) {
      return parts[0] ? { firstName: parts[0] } : {};
    }

    if (parts.length === 2) {
      return {
        ...(parts[0] && { firstName: parts[0] }),
        ...(parts[1] && { lastName: parts[1] }),
      };
    }

    // For names with more than 2 parts, take first as firstName and rest as lastName
    return {
      ...(parts[0] && { firstName: parts[0] }),
      lastName: parts.slice(1).join(" "),
    };
  }

  private buildMetadata(keycloakUser: KeycloakUser): Record<string, any> {
    return {
      enabled: keycloakUser.enabled,
      emailVerified: keycloakUser.emailVerified,
      createdTimestamp: keycloakUser.createdTimestamp,
      attributes: keycloakUser.attributes,
    };
  }

  private normalizeRoles(roles: string[]): string[] {
    return [...new Set(roles)] // Remove duplicates
      .filter(Boolean) // Remove empty/falsy roles
      .sort(); // Sort for consistency
  }

  private normalizePermissions(permissions: string[]): string[] {
    return [...new Set(permissions)] // Remove duplicates
      .filter(Boolean) // Remove empty/falsy permissions
      .sort(); // Sort for consistency
  }

  private derivePermissionsFromRoles(roles: string[]): string[] {
    // This is a simplified permission derivation
    // In a real implementation, you would have role-to-permission mappings
    const permissions: string[] = [];

    for (const role of roles) {
      if (role.includes("admin")) {
        permissions.push(
          "user:read",
          "user:write",
          "user:delete",
          "role:manage"
        );
      } else if (role.includes("manager")) {
        permissions.push("user:read", "user:write");
      } else if (role.includes("user")) {
        permissions.push("user:read");
      }

      // Add more role-to-permission mappings as needed
    }

    return this.normalizePermissions(permissions);
  }

  /**
   * Validate UserInfo data integrity
   */
  validateUserInfo(userInfo: UserInfo): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!userInfo.id) {
      errors.push("User ID is required");
    }

    if (!userInfo.username) {
      errors.push("Username is required");
    }

    if (userInfo.email && !this.isValidEmail(userInfo.email)) {
      errors.push("Invalid email format");
    }

    if (!Array.isArray(userInfo.roles)) {
      errors.push("Roles must be an array");
    }

    if (!Array.isArray(userInfo.permissions)) {
      errors.push("Permissions must be an array");
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Build user summary for logging/debugging
   */
  buildUserSummary(userInfo: UserInfo): Record<string, any> {
    return {
      id: userInfo.id,
      username: userInfo.username,
      email: userInfo.email
        ? userInfo.email.replace(/(.{3}).*(@.*)/, "$1***$2")
        : undefined,
      name: userInfo.name,
      roleCount: userInfo.roles.length,
      permissionCount: userInfo.permissions.length,
      enabled: userInfo.metadata?.["enabled"],
      emailVerified: userInfo.metadata?.["emailVerified"],
    };
  }
}
