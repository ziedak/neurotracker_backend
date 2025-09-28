/**
 * User Manager Component
 * Single Responsibility: User management operations (create, retrieve)
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { IUserManager } from "./interfaces";
import type { UserInfo } from "../../types";
import { KeycloakUserService } from "../user/KeycloakUserService";
import type { IInputValidator } from "./interfaces";

/**
 * User Manager Component
 * Handles user creation and retrieval operations
 */
export class UserManager implements IUserManager {
  private readonly logger = createLogger("UserManager");

  constructor(
    private readonly userService: KeycloakUserService,
    private readonly inputValidator: IInputValidator,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Create a new user
   */
  async createUser(userData: {
    username: string;
    email: string;
    firstName?: string;
    lastName?: string;
    password?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    attributes?: Record<string, string[]>;
  }): Promise<{
    success: boolean;
    userId?: string;
    error?: string;
  }> {
    const startTime = performance.now();

    try {
      // Validate and sanitize input data
      const usernameValidation = this.inputValidator.validateUsername(
        userData.username
      );
      if (!usernameValidation.valid) {
        return {
          success: false,
          error: usernameValidation.error || "Invalid username",
        };
      }

      // Email validation (basic format check)
      if (!userData.email || !this.isValidEmail(userData.email)) {
        return {
          success: false,
          error: "Invalid email format",
        };
      }

      // Sanitize user input data, preserving optional field handling
      const sanitizedUserData = {
        username: usernameValidation.sanitized!,
        email: this.sanitizeEmail(userData.email),
        ...(userData.firstName && {
          firstName: this.sanitizeString(userData.firstName),
        }),
        ...(userData.lastName && {
          lastName: this.sanitizeString(userData.lastName),
        }),
        ...(userData.password && { password: userData.password }), // Never sanitize passwords
        ...(userData.enabled !== undefined && { enabled: userData.enabled }),
        ...(userData.emailVerified !== undefined && {
          emailVerified: userData.emailVerified,
        }),
        ...(userData.attributes && {
          attributes: this.inputValidator.sanitizeAttributes(
            userData.attributes
          ),
        }),
      };

      const userId = await this.userService.createUser(sanitizedUserData);

      this.metrics?.recordCounter("keycloak.user.created", 1);
      this.metrics?.recordTimer(
        "keycloak.user.create_duration",
        performance.now() - startTime
      );

      this.logger.info("User created successfully", {
        userId,
        username: sanitizedUserData.username,
      });

      return {
        success: true,
        userId,
      };
    } catch (error) {
      this.logger.error("User creation failed", {
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      });

      this.metrics?.recordCounter("keycloak.user.create_error", 1);

      return {
        success: false,
        error: this.categorizeUserError(error, "creation"),
      };
    }
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<{
    success: boolean;
    user?: UserInfo;
    error?: string;
  }> {
    const startTime = performance.now();

    try {
      // Basic UUID validation for user ID
      if (!this.isValidUserId(userId)) {
        return {
          success: false,
          error: "Invalid user ID format",
        };
      }

      const userInfo = await this.userService.getCompleteUserInfo(userId);

      this.metrics?.recordCounter("keycloak.user.retrieved", 1);
      this.metrics?.recordTimer(
        "keycloak.user.retrieve_duration",
        performance.now() - startTime
      );

      if (userInfo) {
        return {
          success: true,
          user: userInfo,
        };
      } else {
        this.metrics?.recordCounter("keycloak.user.not_found", 1);
        return {
          success: false,
          error: "User not found",
        };
      }
    } catch (error) {
      this.logger.error("User retrieval failed", {
        error: error instanceof Error ? error.message : String(error),
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      });

      this.metrics?.recordCounter("keycloak.user.retrieve_error", 1);

      return {
        success: false,
        error: this.categorizeUserError(error, "retrieval"),
      };
    }
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254; // RFC 5321 limit
  }

  /**
   * Validate user ID format (UUID)
   */
  private isValidUserId(userId: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(userId);
  }

  /**
   * Sanitize email (remove potential issues while preserving format)
   */
  private sanitizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Sanitize string input
   */
  private sanitizeString(input: string): string {
    return input.trim().replace(/[<>"'&]/g, (match) => {
      switch (match) {
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#x27;";
        case "&":
          return "&amp;";
        default:
          return match;
      }
    });
  }

  /**
   * Categorize user operation errors
   */
  private categorizeUserError(
    error: unknown,
    operation: "creation" | "retrieval"
  ): string {
    if (error instanceof Error) {
      if (
        error.message.includes("duplicate") ||
        error.message.includes("already exists")
      ) {
        return operation === "creation"
          ? "Username or email already exists"
          : "User retrieval failed";
      } else if (
        error.message.includes("404") ||
        error.message.includes("not found")
      ) {
        return "User not found";
      } else if (
        error.message.includes("network") ||
        error.message.includes("ENOTFOUND")
      ) {
        return "User service unavailable";
      } else if (error.message.includes("timeout")) {
        return `User ${operation} timeout`;
      } else if (
        error.message.includes("permission") ||
        error.message.includes("403")
      ) {
        return "Insufficient permissions for user operation";
      } else if (error.message.includes("validation")) {
        return "Invalid user data provided";
      }
    }

    return `User ${operation} failed`;
  }
}
