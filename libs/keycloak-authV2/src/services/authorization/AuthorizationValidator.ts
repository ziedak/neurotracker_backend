/**
 * Input validation for authorization operations
 * Handles all Zod schema validation with security-first approach
 */

import { z } from "zod";
import type {
  Action,
  Subjects,
  AuthorizationContext,
  ResourceContext,
} from "../../types/authorization.types";

/**
 * Zod schemas for input validation
 */
export const authorizationContextSchema = z.object({
  userId: z
    .string()
    .min(1, "userId cannot be empty")
    .max(100, "userId too long (max 100 characters)")
    .regex(/^[a-zA-Z0-9._@-]+$/, "userId contains invalid characters"),
  roles: z
    .array(
      z
        .string()
        .min(1, "Role cannot be empty")
        .max(50, "Role name too long (max 50 characters)")
        .regex(/^[a-zA-Z0-9._-]+$/, "Role contains invalid characters")
    )
    .max(50, "Too many roles (max 50)"),
  sessionId: z.string().max(200, "Invalid sessionId format").optional(),
  ipAddress: z.string().max(45, "Invalid ipAddress format").optional(),
  userAgent: z.string().max(500, "Invalid userAgent format").optional(),
});

export const actionSchema = z
  .string()
  .min(1, "Invalid action: must be a non-empty string");

export const subjectSchema = z
  .string()
  .min(1, "Invalid subject: must be a non-empty string");

export const resourceContextSchema = z
  .object({
    type: z.string().optional(),
    id: z.string().optional(),
    ownerId: z.string().optional(),
    organizationId: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .optional();

export const permissionCheckSchema = z.object({
  action: actionSchema,
  subject: subjectSchema,
  resource: resourceContextSchema.optional(),
});

export const permissionChecksSchema = z
  .array(permissionCheckSchema)
  .min(1, "No permission checks specified - access denied by default");

/**
 * Validation result interface
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Authorization input validator
 */
export class AuthorizationValidator {
  /**
   * Validate authorization context using Zod
   */
  validateAuthorizationContext(
    context: AuthorizationContext
  ): ValidationResult {
    const result = authorizationContextSchema.safeParse(context);
    if (!result.success) {
      // Extract the first error message for user-friendly feedback
      const firstError = result.error.issues[0];
      return {
        valid: false,
        reason: firstError?.message || "Invalid authorization context",
      };
    }
    return { valid: true };
  }

  /**
   * Validate action with sanitized error messages
   */
  validateAction(action: Action): ValidationResult {
    const actionValidation = actionSchema.safeParse(action);
    if (!actionValidation.success) {
      return {
        valid: false,
        reason: "Invalid action format", // Sanitized error message
      };
    }
    return { valid: true };
  }

  /**
   * Validate subject with sanitized error messages
   */
  validateSubject(subject: Subjects): ValidationResult {
    const subjectValidation = subjectSchema.safeParse(subject);
    if (!subjectValidation.success) {
      return {
        valid: false,
        reason: "Invalid subject format", // Sanitized error message
      };
    }
    return { valid: true };
  }

  /**
   * Validate resource context if provided
   */
  validateResourceContext(resource?: ResourceContext): ValidationResult {
    if (resource === undefined) {
      return { valid: true };
    }

    const resourceValidation = resourceContextSchema.safeParse(resource);
    if (!resourceValidation.success) {
      return {
        valid: false,
        reason: "Invalid resource context format", // Sanitized error message
      };
    }
    return { valid: true };
  }

  /**
   * Validate permission checks array
   */
  validatePermissionChecks(
    checks: Array<{
      action: Action;
      subject: Subjects;
      resource?: ResourceContext;
    }>
  ): ValidationResult {
    const checksValidation = permissionChecksSchema.safeParse(checks);
    if (!checksValidation.success) {
      return {
        valid: false,
        reason:
          checksValidation.error.issues[0]?.message ||
          "Invalid permission checks",
      };
    }
    return { valid: true };
  }
}
