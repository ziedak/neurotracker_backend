/**
 * Input Validator Component
 * Single Responsibility: Input validation and sanitization using Zod schemas
 */

import { z } from "zod";
import type { IInputValidator, ValidationResult } from "./interfaces";

// Validation Constants
const VALIDATION_LIMITS = {
  USERNAME_MAX_LENGTH: 100,
  PASSWORD_MAX_LENGTH: 1000,
  USER_AGENT_MAX_LENGTH: 1000,
  AUTH_CODE_MAX_LENGTH: 2000,
} as const;

// Input Sanitization Utilities
const sanitizeHtml = (input: string): string => {
  return input.replace(/[<>"'&]/g, (match) => {
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
};

const sanitizeSql = (input: string): string => {
  // Remove or escape SQL injection patterns
  return input
    .replace(/[';-]/g, "") // Remove common SQL injection chars
    .replace(/--/g, "") // Remove SQL comment indicators
    .replace(
      /\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b/gi,
      ""
    ) // Remove SQL keywords
    .trim();
};

const sanitizeInput = (input: string): string => {
  return sanitizeSql(sanitizeHtml(input.trim()));
};

// Zod Validation Schemas with Enhanced Sanitization
/**
 * Input validation schemas using Zod
 */
// Changed from .uuid() to .min(1) because Prisma uses CUID format, not UUID
const SessionIdSchema = z.string().min(1, "Session ID must not be empty");
const UsernameSchema = z
  .string()
  .trim()
  .min(1, "Username cannot be empty")
  .max(
    VALIDATION_LIMITS.USERNAME_MAX_LENGTH,
    `Username too long (max ${VALIDATION_LIMITS.USERNAME_MAX_LENGTH} characters)`
  )
  .regex(/^[a-zA-Z0-9._@-]+$/, "Username contains invalid characters")
  .transform(sanitizeInput);

const PasswordSchema = z
  .string()
  .min(1, "Password cannot be empty")
  .max(
    VALIDATION_LIMITS.PASSWORD_MAX_LENGTH,
    `Password too long (max ${VALIDATION_LIMITS.PASSWORD_MAX_LENGTH} characters)`
  )
  .refine((password) => {
    // Check for suspicious patterns that might indicate injection attempts
    const suspiciousPatterns = /[<>"'`;]/;
    return !suspiciousPatterns.test(password) || password.length > 50;
  }, "Password contains potentially unsafe characters");

const AuthCodeSchema = z
  .string()
  .trim()
  .min(1, "Authorization code cannot be empty")
  .max(VALIDATION_LIMITS.AUTH_CODE_MAX_LENGTH, "Authorization code too long")
  .regex(/^[a-zA-Z0-9._-]+$/, "Authorization code contains invalid characters")
  .transform(sanitizeInput);

const RedirectUriSchema = z
  .string()
  .trim()
  .url("Invalid redirect URI format")
  .transform(sanitizeHtml)
  .refine((uri) => {
    const url = new URL(uri);
    return (
      url.protocol === "https:" ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1"
    );
  }, "Redirect URI must use HTTPS or be localhost");

const ClientContextSchema = z.object({
  ipAddress: z
    .string()
    .min(1, "IP address is required")
    .regex(
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^localhost$/,
      "Invalid IP address format"
    )
    .transform(sanitizeInput),
  userAgent: z
    .string()
    .min(1, "User agent is required")
    .max(VALIDATION_LIMITS.USER_AGENT_MAX_LENGTH, "User agent too long")
    .transform(sanitizeHtml),
  clientId: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeInput(val) : val)),
});

/**
 * Input Validator Component
 * Handles all input validation and sanitization using Zod schemas
 */
export class InputValidator implements IInputValidator {
  /**
   * Validate session ID format (UUID)
   */
  validateSessionId(sessionId: string): boolean {
    return SessionIdSchema.safeParse(sessionId).success;
  }

  /**
   * Validate and sanitize username input
   */
  validateUsername(username: string): ValidationResult {
    const result = UsernameSchema.safeParse(username);
    if (!result.success) {
      return {
        valid: false,
        error: result.error.errors[0]?.message || "Username validation failed",
      };
    }
    return { valid: true, sanitized: result.data };
  }

  /**
   * Validate password input (no sanitization for passwords)
   */
  validatePassword(password: string): ValidationResult {
    const result = PasswordSchema.safeParse(password);
    if (!result.success) {
      return {
        valid: false,
        error: result.error.errors[0]?.message || "Password validation failed",
      };
    }
    return { valid: true }; // No sanitized value for passwords
  }

  /**
   * Validate OAuth authorization code
   */
  validateAuthCode(code: string): ValidationResult {
    const result = AuthCodeSchema.safeParse(code);
    if (!result.success) {
      return {
        valid: false,
        error:
          result.error.errors[0]?.message ||
          "Authorization code validation failed",
      };
    }
    return { valid: true, sanitized: result.data };
  }

  /**
   * Validate redirect URI
   */
  validateRedirectUri(uri: string): ValidationResult {
    const result = RedirectUriSchema.safeParse(uri);
    if (!result.success) {
      return {
        valid: false,
        error:
          result.error.errors[0]?.message || "Redirect URI validation failed",
      };
    }
    return { valid: true, sanitized: result.data };
  }

  /**
   * Validate client context
   */
  validateClientContext(context: any): ValidationResult {
    const result = ClientContextSchema.safeParse(context);
    if (!result.success) {
      return {
        valid: false,
        error:
          result.error.errors[0]?.message || "Client context validation failed",
      };
    }
    return { valid: true };
  }

  /**
   * Sanitize user attributes
   */
  sanitizeAttributes(
    attributes: Record<string, string[]>
  ): Record<string, string[]> {
    const sanitized: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(attributes)) {
      sanitized[sanitizeInput(key)] = values.map((value) =>
        sanitizeInput(value)
      );
    }
    return sanitized;
  }
}
