/**
 * User Validation Utilities
 *
 * Shared validation logic to eliminate duplication between services.
 * Follows functional programming principles for testability and reusability.
 */

import type { IUserRepository } from "./interfaces";

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validate username and email uniqueness across both local DB and Keycloak
 */
export async function validateUserUniqueness(
  username: string,
  email: string,
  localUserRepository: IUserRepository,
  keycloakUserService: {
    getUserByUsername(username: string): Promise<any>;
  },
  logger: { warn: (message: string, meta?: any) => void }
): Promise<ValidationResult> {
  try {
    // Check local DB uniqueness
    const existingUserByUsername = await localUserRepository.getUserByUsername(
      username
    );
    if (existingUserByUsername) {
      return {
        isValid: false,
        error: `Username '${username}' already exists`,
      };
    }

    const existingUserByEmail = await localUserRepository.getUserByUsername(
      email
    );
    if (existingUserByEmail) {
      return {
        isValid: false,
        error: `Email '${email}' already exists`,
      };
    }

    // Check Keycloak uniqueness
    try {
      const keycloakUserByUsername =
        await keycloakUserService.getUserByUsername(username);
      if (keycloakUserByUsername) {
        return {
          isValid: false,
          error: `Username '${username}' already exists in Keycloak`,
        };
      }
    } catch (keycloakError) {
      logger.warn("Could not verify Keycloak username uniqueness, proceeding", {
        username,
        error: keycloakError,
      });
      // Don't block registration if Keycloak check fails
    }

    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: `Validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/**
 * Validate user status for authentication
 */
export function validateUserStatus(user: {
  status?: string;
  isDeleted?: boolean;
}): ValidationResult {
  if (user.status === "BANNED") {
    return { isValid: false, error: "User account is banned" };
  }
  if (user.status === "DELETED") {
    return { isValid: false, error: "User account is deleted" };
  }
  if (user.status === "INACTIVE") {
    return { isValid: false, error: "User account is inactive" };
  }
  if (user.isDeleted) {
    return { isValid: false, error: "User account is deleted" };
  }

  return { isValid: true };
}
