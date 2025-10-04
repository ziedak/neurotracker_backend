/**
 * Validation Utilities
 *
 * Input validation functions for authentication operations
 * Uses Zod for robust schema validation
 */

import { z } from "zod";
import { InvalidRequestError } from "./errors";

/**
 * Email validation schema
 */
export const emailSchema = z
  .string()
  .email("Invalid email address")
  .min(3, "Email must be at least 3 characters")
  .max(255, "Email must not exceed 255 characters")
  .toLowerCase()
  .trim();

/**
 * Password validation schema
 * Requirements: 8-128 chars, at least one uppercase, lowercase, number, special char
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must not exceed 128 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character"
  );

/**
 * Username validation schema
 */
export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(50, "Username must not exceed 50 characters")
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Username can only contain letters, numbers, hyphens, and underscores"
  )
  .trim();

/**
 * Organization ID validation schema (CUID)
 */
export const organizationIdSchema = z
  .string()
  .regex(/^[a-z0-9]{25}$/, "Invalid organization ID format");

/**
 * User ID validation schema (CUID)
 */
export const userIdSchema = z
  .string()
  .regex(/^[a-z0-9]{25}$/, "Invalid user ID format");

/**
 * API Key validation schema
 */
export const apiKeySchema = z
  .string()
  .min(32, "API key must be at least 32 characters")
  .max(128, "API key must not exceed 128 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid API key format");

/**
 * JWT token validation schema
 */
export const jwtTokenSchema = z
  .string()
  .min(20, "JWT token must be at least 20 characters")
  .regex(
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    "Invalid JWT format"
  );

/**
 * Permissions array validation schema
 */
export const permissionsSchema = z
  .array(z.string().min(1).max(100))
  .min(0)
  .max(100);

/**
 * Role validation schema
 */
export const roleSchema = z.enum(["ADMIN", "USER", "MODERATOR", "GUEST"]);

/**
 * Login credentials validation schema
 */
export const loginCredentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

/**
 * Registration data validation schema
 */
export const registrationDataSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z
    .string()
    .min(1, "Name is required")
    .max(255, "Name must not exceed 255 characters")
    .trim()
    .optional(),
  username: usernameSchema.optional(),
});

/**
 * Password reset request validation schema
 */
export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

/**
 * Password reset confirmation validation schema
 */
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: passwordSchema,
});

/**
 * Update profile validation schema
 */
export const updateProfileSchema = z.object({
  name: z
    .string()
    .min(1, "Name must not be empty")
    .max(255, "Name must not exceed 255 characters")
    .trim()
    .optional(),
  username: usernameSchema.optional(),
  email: emailSchema.optional(),
});

/**
 * Organization creation validation schema
 */
export const createOrganizationSchema = z.object({
  name: z
    .string()
    .min(1, "Organization name is required")
    .max(255, "Organization name must not exceed 255 characters")
    .trim(),
  slug: z
    .string()
    .min(3, "Organization slug must be at least 3 characters")
    .max(50, "Organization slug must not exceed 50 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Organization slug can only contain lowercase letters, numbers, and hyphens"
    )
    .trim()
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Pagination validation schema
 */
export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

/**
 * Generic validator wrapper
 */
export class Validator {
  /**
   * Validate data against a Zod schema
   */
  static validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
    try {
      return schema.parse(data);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new InvalidRequestError(
          "Validation failed",
          error.errors.map((e: z.ZodIssue) => ({
            path: e.path.join("."),
            message: e.message,
          }))
        );
      }
      throw error;
    }
  }

  /**
   * Safely parse data (returns result object instead of throwing)
   */
  static safeParse<T>(
    schema: z.ZodSchema<T>,
    data: unknown
  ): { success: true; data: T } | { success: false; errors: string[] } {
    const result = schema.safeParse(data);

    if (result.success) {
      return { success: true, data: result.data };
    }

    return {
      success: false,
      errors: result.error.errors.map(
        (e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`
      ),
    };
  }

  /**
   * Validate email format
   */
  static validateEmail(email: string): boolean {
    return emailSchema.safeParse(email).success;
  }

  /**
   * Validate password strength
   */
  static validatePassword(password: string): boolean {
    return passwordSchema.safeParse(password).success;
  }

  /**
   * Validate username format
   */
  static validateUsername(username: string): boolean {
    return usernameSchema.safeParse(username).success;
  }

  /**
   * Validate API key format
   */
  static validateApiKey(apiKey: string): boolean {
    return apiKeySchema.safeParse(apiKey).success;
  }

  /**
   * Validate JWT token format
   */
  static validateJwtToken(token: string): boolean {
    return jwtTokenSchema.safeParse(token).success;
  }

  /**
   * Validate permissions array
   */
  static validatePermissions(permissions: string[]): boolean {
    return permissionsSchema.safeParse(permissions).success;
  }

  /**
   * Check if user has required permissions
   */
  static hasPermissions(
    userPermissions: string[],
    requiredPermissions: string[]
  ): boolean {
    return requiredPermissions.every((permission) =>
      userPermissions.includes(permission)
    );
  }

  /**
   * Check if user has at least one of the required permissions
   */
  static hasAnyPermission(
    userPermissions: string[],
    requiredPermissions: string[]
  ): boolean {
    return requiredPermissions.some((permission) =>
      userPermissions.includes(permission)
    );
  }
}
