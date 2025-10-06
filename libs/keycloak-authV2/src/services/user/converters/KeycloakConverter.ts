/**
 * KeycloakConverter - Keycloak API ↔ Database User Type Mapping
 *
 * Purpose: Convert between Keycloak Admin API format and database User types
 * Philosophy: Reuse existing @libs/database types, NO custom domain models
 *
 * Architecture:
 * - Keycloak API (KeycloakUser) ←→ Database (User, UserCreateInput, UserUpdateInput)
 * - Database types are source of truth
 * - This converter handles ONLY Keycloak-specific transformations
 */

import type {
  User,
  UserCreateInput,
  UserUpdateInput,
  UserStatus,
} from "@libs/database";
import type { KeycloakUser } from "../interfaces";

/**
 * KeycloakConverter Namespace
 * All Keycloak ↔ Database conversion functions
 */
export namespace KeycloakConverter {
  /**
   * Convert Keycloak user to Database User format
   * Used when syncing FROM Keycloak TO local database
   *
   * @param kcUser - Keycloak user representation
   * @returns Partial User object (for updates or comparison)
   */
  export function toUser(kcUser: KeycloakUser): Partial<User> {
    const user: Partial<User> = {
      username: kcUser.username,
      email: kcUser.email ?? "",
      firstName: kcUser.firstName ?? null,
      lastName: kcUser.lastName ?? null,
      emailVerified: kcUser.emailVerified ?? false,
      // Map Keycloak enabled → Database status
      status: computeStatusFromKeycloak(kcUser),
      // Keycloak doesn't track these, keep DB values
      // password, phone, phoneVerified, loginCount, etc. maintained by DB
    };

    // Only include ID if it exists
    if (kcUser.id) {
      user.id = kcUser.id;
    }

    return user;
  }

  /**
   * Convert UserCreateInput to Keycloak user format
   * Used when creating user in Keycloak during sync
   *
   * @param input - Database user creation input
   * @returns Keycloak user representation for Admin API
   */
  export function toKeycloakCreate(input: UserCreateInput): KeycloakUser {
    const kcUser: KeycloakUser = {
      username: input.username,
      email: input.email,
      firstName: input.firstName ?? undefined,
      lastName: input.lastName ?? undefined,
      enabled: computeEnabledFromStatus(input.status),
      emailVerified: input.emailVerified ?? false,
      attributes: {},
    };

    // Add password as credential if provided
    if (input.password) {
      kcUser.credentials = [
        {
          type: "password",
          value: input.password,
          temporary: false,
        },
      ];
    }

    // Store additional metadata in Keycloak attributes
    if (input.phone) {
      kcUser.attributes = {
        ...kcUser.attributes,
        phone: [input.phone],
      };
    }

    // Note: storeId and organizationId handled via Prisma relations in database
    // Not directly accessible in UserCreateInput, must be set via relations

    return kcUser;
  }

  /**
   * Convert UserUpdateInput to Keycloak update format
   * Used when updating user in Keycloak during sync
   *
   * @param input - Database user update input
   * @returns Partial Keycloak user with only changed fields
   */
  export function toKeycloakUpdate(
    input: UserUpdateInput
  ): Partial<KeycloakUser> {
    const updates: Partial<KeycloakUser> = {};

    // Map direct fields
    if (input.username && typeof input.username === "string") {
      updates.username = input.username;
    }

    if (input.email && typeof input.email === "string") {
      updates.email = input.email;
    }

    if (input.firstName !== undefined) {
      updates.firstName =
        typeof input.firstName === "string" ? input.firstName : undefined;
    }

    if (input.lastName !== undefined) {
      updates.lastName =
        typeof input.lastName === "string" ? input.lastName : undefined;
    }

    if (
      input.emailVerified !== undefined &&
      typeof input.emailVerified === "boolean"
    ) {
      updates.emailVerified = input.emailVerified;
    }

    // Map status to enabled
    if (input.status && typeof input.status === "string") {
      updates.enabled = computeEnabledFromStatus(input.status as UserStatus);
    }

    // Handle phone attribute
    if (input.phone !== undefined) {
      const attributes: Record<string, string[]> = updates.attributes || {};
      attributes["phone"] =
        typeof input.phone === "string" ? [input.phone] : [];
      updates.attributes = attributes;
    }

    // Note: storeId and organizationId handled via Prisma relations
    // Not directly in UserUpdateInput

    return updates;
  }

  /**
   * Helper: Compute enabled status for Keycloak from Database status
   *
   * @param status - Database user status (optional, defaults to ACTIVE)
   * @returns Keycloak enabled boolean
   */
  export function computeEnabledFromStatus(
    status?: UserStatus | string
  ): boolean {
    if (!status) return true; // Default to enabled

    // Use string comparison instead of enum
    switch (status) {
      case "ACTIVE":
        return true;
      case "INACTIVE":
      case "BANNED":
      case "DELETED":
      case "PENDING":
        return false;
      default:
        return true; // Default to enabled for unknown status
    }
  }

  /**
   * Helper: Compute Database status from Keycloak enabled flag
   *
   * @param kcUser - Keycloak user representation
   * @returns Database UserStatus enum
   */
  export function computeStatusFromKeycloak(kcUser: KeycloakUser): UserStatus {
    // If explicitly disabled, mark as INACTIVE
    if (kcUser.enabled === false) {
      return "INACTIVE";
    }

    // If enabled (or undefined, which means enabled), mark as ACTIVE
    return "ACTIVE";
  }

  /**
   * Helper: Check if user is active in database
   *
   * @param user - Database User
   * @returns True if user is active and not deleted
   */
  export function isUserActive(user: User): boolean {
    return (
      user.status === "ACTIVE" &&
      !user.isDeleted &&
      (user.deletedAt === null || user.deletedAt === undefined)
    );
  }

  /**
   * Helper: Compute enabled status from full User object
   * More comprehensive than computeEnabledFromStatus
   *
   * @param user - Database User
   * @returns Keycloak enabled boolean
   */
  export function computeEnabled(user: User): boolean {
    // User is enabled only if ACTIVE and NOT deleted
    return user.status === "ACTIVE" && !user.isDeleted;
  }

  /**
   * Helper: Build full name from User object
   *
   * @param user - Database User
   * @returns Full name or username fallback
   */
  export function buildFullName(user: User): string {
    const parts = [user.firstName, user.lastName].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : user.username;
  }

  /**
   * Helper: Extract Keycloak user ID from User
   * In our architecture, Keycloak ID = Database ID (synced)
   *
   * @param user - Database User
   * @returns Keycloak user ID (same as database ID)
   */
  export function getKeycloakId(user: User): string {
    return user.id;
  }

  /**
   * Helper: Check if user should be synced to Keycloak
   * Some users might be local-only (e.g., system users)
   *
   * @param user - Database User
   * @returns True if user should be synced to Keycloak
   */
  export function shouldSyncToKeycloak(user: User): boolean {
    // Don't sync deleted users
    if (user.isDeleted || user.deletedAt) {
      return false;
    }

    // Don't sync system users (if we add that flag later)
    // For now, sync all non-deleted users
    return true;
  }

  /**
   * Helper: Extract phone from Keycloak attributes
   *
   * @param kcUser - Keycloak user representation
   * @returns Phone number or null
   */
  export function extractPhone(kcUser: KeycloakUser): string | null {
    if (!kcUser.attributes?.["phone"]) return null;
    const phoneArray = kcUser.attributes["phone"];
    return Array.isArray(phoneArray) && phoneArray.length > 0
      ? phoneArray[0] ?? null
      : null;
  }

  /**
   * Helper: Extract storeId from Keycloak attributes
   *
   * @param kcUser - Keycloak user representation
   * @returns Store ID or null
   */
  export function extractStoreId(kcUser: KeycloakUser): string | null {
    if (!kcUser.attributes?.["storeId"]) return null;
    const storeIdArray = kcUser.attributes["storeId"];
    return Array.isArray(storeIdArray) && storeIdArray.length > 0
      ? storeIdArray[0] ?? null
      : null;
  }

  /**
   * Helper: Extract organizationId from Keycloak attributes
   *
   * @param kcUser - Keycloak user representation
   * @returns Organization ID or null
   */
  export function extractOrganizationId(kcUser: KeycloakUser): string | null {
    if (!kcUser.attributes?.["organizationId"]) return null;
    const orgIdArray = kcUser.attributes["organizationId"];
    return Array.isArray(orgIdArray) && orgIdArray.length > 0
      ? orgIdArray[0] ?? null
      : null;
  }
}
