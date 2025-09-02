/**
 * @fileoverview Comprehensive input validation and sanitization utilities
 * @module utils/InputValidator
 * @author Enterprise Security Team
 * @since 1.0.0 - Phase 1.2 Input Validation & Sanitization
 */

import { z } from "zod";

/**
 * Email validation schema with comprehensive rules
 */
export const EmailSchema = z
  .string()
  .min(1, "Email is required")
  .max(254, "Email must not exceed 254 characters")
  .email("Invalid email format")
  .regex(
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    "Email contains invalid characters"
  );

/**
 * Username validation schema
 */
export const UsernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(50, "Username must not exceed 50 characters")
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Username can only contain letters, numbers, underscores, and hyphens"
  )
  .regex(/^[a-zA-Z]/, "Username must start with a letter");

/**
 * Name validation schema (first/last name)
 */
export const NameSchema = z
  .string()
  .min(1, "Name must not be empty")
  .max(100, "Name must not exceed 100 characters")
  .regex(/^[a-zA-ZÀ-ÿ\s'-]+$/, "Name contains invalid characters");

/**
 * Phone number validation schema
 */
export const PhoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{1,14}$/, "Invalid phone number format");

/**
 * Entity ID validation schema
 */
export const EntityIdSchema = z
  .string()
  .min(1, "ID cannot be empty")
  .max(50, "ID too long")
  .regex(/^[a-zA-Z0-9_-]+$/, "ID contains invalid characters");

/**
 * Metadata validation schema - prevents XSS in JSON fields
 */
export const MetadataSchema = z.record(z.unknown()).refine((data) => {
  const jsonString = JSON.stringify(data);
  // Check for potential XSS patterns
  const xssPatterns = [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<iframe/gi,
    /<object/gi,
    /<embed/gi,
    /vbscript:/gi,
  ];
  return !xssPatterns.some((pattern) => pattern.test(jsonString));
}, "Metadata contains potentially dangerous content");

/**
 * Input validation result interface
 */
export interface IValidationResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: string[];
}

/**
 * Sanitization options interface
 */
export interface ISanitizationOptions {
  readonly stripHtml?: boolean;
  readonly normalizeWhitespace?: boolean;
  readonly maxLength?: number;
  readonly allowedCharacters?: RegExp;
}

/**
 * Comprehensive input validation and sanitization utility
 *
 * Provides enterprise-grade input validation with XSS protection,
 * SQL injection prevention, and data integrity validation.
 */
export class InputValidator {
  /**
   * Validate email input with comprehensive security checks
   *
   * @param email - Email address to validate
   * @returns Validation result with sanitized email or errors
   */
  public static validateEmail(email: unknown): IValidationResult<string> {
    try {
      if (typeof email !== "string") {
        return {
          success: false,
          errors: ["Email must be a string"],
        };
      }

      // Sanitize input
      const sanitized = this.sanitizeString(email, {
        stripHtml: true,
        normalizeWhitespace: true,
        maxLength: 254,
      });

      // Validate with schema
      const validated = EmailSchema.parse(sanitized);

      return {
        success: true,
        data: validated,
      };
    } catch (error) {
      return {
        success: false,
        errors:
          error instanceof z.ZodError
            ? error.errors.map((e) => e.message)
            : ["Email validation failed"],
      };
    }
  }

  /**
   * Validate username with security restrictions
   *
   * @param username - Username to validate
   * @returns Validation result with sanitized username or errors
   */
  public static validateUsername(username: unknown): IValidationResult<string> {
    try {
      if (typeof username !== "string") {
        return {
          success: false,
          errors: ["Username must be a string"],
        };
      }

      // SECURITY FIX: Check for obviously malicious patterns before processing
      const dangerousPatterns = [
        /<script[^>]*>/i,
        /<[^>]+>/g, // Any HTML tags
        /javascript:/i,
        /data:/i,
        /'|"|;|--|\/\*|\*\//g, // SQL injection patterns
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(username)) {
          return {
            success: false,
            errors: ["Username contains invalid characters"],
          };
        }
      }

      // Sanitize input (normalize whitespace, strip HTML)
      const sanitized = this.sanitizeString(username, {
        stripHtml: true,
        normalizeWhitespace: true,
        maxLength: 50,
      });

      // Final validation with schema
      const validated = UsernameSchema.parse(sanitized);

      return {
        success: true,
        data: validated,
      };
    } catch (error) {
      return {
        success: false,
        errors:
          error instanceof z.ZodError
            ? error.errors.map((e) => e.message)
            : ["Username validation failed"],
      };
    }
  }

  /**
   * Validate name fields (first/last name) with internationalization support
   *
   * @param name - Name to validate
   * @returns Validation result with sanitized name or errors
   */
  public static validateName(name: unknown): IValidationResult<string> {
    try {
      if (typeof name !== "string") {
        return {
          success: false,
          errors: ["Name must be a string"],
        };
      }

      // SECURITY FIX: Check for obviously malicious patterns before processing
      const dangerousPatterns = [
        /<script[^>]*>/i,
        /<[^>]+>/g, // Any HTML tags
        /javascript:/i,
        /data:/i,
        /'|"|;|--|\/\*|\*\//g, // SQL injection patterns
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(name)) {
          return {
            success: false,
            errors: ["Name contains invalid characters"],
          };
        }
      }

      // Sanitize input (normalize whitespace, strip HTML)
      const sanitized = this.sanitizeString(name, {
        stripHtml: true,
        normalizeWhitespace: true,
        maxLength: 100,
      });

      // Final validation with schema
      const validated = NameSchema.parse(sanitized);

      return {
        success: true,
        data: validated,
      };
    } catch (error) {
      return {
        success: false,
        errors:
          error instanceof z.ZodError
            ? error.errors.map((e) => e.message)
            : ["Name validation failed"],
      };
    }
  }

  /**
   * Validate phone number with international format support
   *
   * @param phone - Phone number to validate
   * @returns Validation result with sanitized phone or errors
   */
  public static validatePhone(phone: unknown): IValidationResult<string> {
    try {
      if (typeof phone !== "string") {
        return {
          success: false,
          errors: ["Phone number must be a string"],
        };
      }

      // Remove common formatting characters
      const sanitized = phone.replace(/[\s\-\(\)\.]/g, "");

      const validated = PhoneSchema.parse(sanitized);

      return {
        success: true,
        data: validated,
      };
    } catch (error) {
      return {
        success: false,
        errors:
          error instanceof z.ZodError
            ? error.errors.map((e) => e.message)
            : ["Phone number validation failed"],
      };
    }
  }

  /**
   * Validate entity ID with strict format requirements
   *
   * @param id - Entity ID to validate
   * @returns Validation result with validated ID or errors
   */
  public static validateEntityId(id: unknown): IValidationResult<string> {
    try {
      if (typeof id !== "string") {
        return {
          success: false,
          errors: ["Entity ID must be a string"],
        };
      }

      // SECURITY FIX: Validate BEFORE sanitization to prevent manipulation
      const preValidation = EntityIdSchema.safeParse(id);
      if (!preValidation.success) {
        return {
          success: false,
          errors: preValidation.error.errors.map((e) => e.message),
        };
      }

      // Only sanitize inputs that already pass validation
      const sanitized = this.sanitizeString(id, {
        stripHtml: true,
        normalizeWhitespace: true,
        maxLength: 50,
      });

      // Final validation after sanitization
      const validated = EntityIdSchema.parse(sanitized);

      return {
        success: true,
        data: validated,
      };
    } catch (error) {
      return {
        success: false,
        errors:
          error instanceof z.ZodError
            ? error.errors.map((e) => e.message)
            : ["Entity ID validation failed"],
      };
    }
  }

  /**
   * Validate metadata object with XSS protection
   *
   * @param metadata - Metadata object to validate
   * @returns Validation result with sanitized metadata or errors
   */
  public static validateMetadata(
    metadata: unknown
  ): IValidationResult<Record<string, unknown>> {
    try {
      if (metadata === null || metadata === undefined) {
        return {
          success: true,
          data: {},
        };
      }

      if (typeof metadata !== "object" || Array.isArray(metadata)) {
        return {
          success: false,
          errors: ["Metadata must be an object"],
        };
      }

      // SECURITY FIX: Check for dangerous patterns BEFORE sanitization
      const dangerousPatterns = [
        /<script[^>]*>/i,
        /<iframe[^>]*>/i,
        /<object[^>]*>/i,
        /<embed[^>]*>/i,
        /<applet[^>]*>/i,
        /javascript:/i,
        /data:/i,
        /vbscript:/i,
        /onload=/i,
        /onerror=/i,
        /onclick=/i,
      ];

      const checkForXSS = (obj: Record<string, unknown>): string[] => {
        const violations: string[] = [];

        for (const [key, value] of Object.entries(obj)) {
          const stringValue = String(value);
          for (const pattern of dangerousPatterns) {
            if (pattern.test(stringValue) || pattern.test(key)) {
              violations.push(`Dangerous pattern detected in metadata: ${key}`);
              break;
            }
          }

          // Recursively check nested objects
          if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            violations.push(...checkForXSS(value as Record<string, unknown>));
          }
        }

        return violations;
      };

      const xssViolations = checkForXSS(metadata as Record<string, unknown>);
      if (xssViolations.length > 0) {
        return {
          success: false,
          errors: xssViolations,
        };
      }

      // Deep sanitize metadata values
      const sanitized = this.sanitizeMetadata(
        metadata as Record<string, unknown>
      );

      const validated = MetadataSchema.parse(sanitized);

      return {
        success: true,
        data: validated,
      };
    } catch (error) {
      return {
        success: false,
        errors:
          error instanceof z.ZodError
            ? error.errors.map((e) => e.message)
            : ["Metadata validation failed"],
      };
    }
  }

  /**
   * Sanitize string input with comprehensive options
   *
   * @param input - String to sanitize
   * @param options - Sanitization options
   * @returns Sanitized string
   */
  public static sanitizeString(
    input: string,
    options: ISanitizationOptions = {}
  ): string {
    let sanitized = input;

    // Strip HTML tags if requested
    if (options.stripHtml) {
      sanitized = sanitized.replace(/<[^>]*>/g, "");
    }

    // Normalize whitespace
    if (options.normalizeWhitespace) {
      sanitized = sanitized.trim().replace(/\s+/g, " ");
    }

    // Apply length limit
    if (options.maxLength && sanitized.length > options.maxLength) {
      sanitized = sanitized.substring(0, options.maxLength);
    }

    // Filter allowed characters - only keep characters that match the pattern
    if (options.allowedCharacters) {
      const chars = sanitized.split("");
      // Convert full-string pattern to character-based pattern
      let charPattern = options.allowedCharacters;
      if (
        charPattern.source.startsWith("^") &&
        charPattern.source.endsWith("+$")
      ) {
        // Extract character class from full string pattern like /^[a-zA-Z0-9_-]+$/
        const charClass = charPattern.source.slice(1, -2); // Remove ^ and +$
        charPattern = new RegExp(charClass);
      }

      sanitized = chars.filter((char) => charPattern.test(char)).join("");
    }

    return sanitized;
  }

  /**
   * Deep sanitize metadata object recursively
   *
   * @param obj - Object to sanitize
   * @returns Sanitized object
   */
  private static sanitizeMetadata(
    obj: Record<string, unknown>
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Sanitize key
      const cleanKey = this.sanitizeString(key, {
        stripHtml: true,
        normalizeWhitespace: true,
        maxLength: 100,
        allowedCharacters: /^[a-zA-Z0-9_-]+$/,
      });

      if (cleanKey.length === 0) {
        continue; // Skip invalid keys
      }

      // Sanitize value based on type
      if (typeof value === "string") {
        sanitized[cleanKey] = this.sanitizeString(value, {
          stripHtml: true,
          normalizeWhitespace: true,
          maxLength: 1000,
        });
      } else if (typeof value === "number" || typeof value === "boolean") {
        sanitized[cleanKey] = value;
      } else if (value === null || value === undefined) {
        sanitized[cleanKey] = value;
      } else if (typeof value === "object" && !Array.isArray(value)) {
        sanitized[cleanKey] = this.sanitizeMetadata(
          value as Record<string, unknown>
        );
      } else if (Array.isArray(value)) {
        // Sanitize array elements
        sanitized[cleanKey] = value.map((item) => {
          if (typeof item === "string") {
            return this.sanitizeString(item, {
              stripHtml: true,
              normalizeWhitespace: true,
              maxLength: 500,
            });
          }
          return item;
        });
      }
    }

    return sanitized;
  }

  /**
   * Validate batch input with consistent error handling
   *
   * @param inputs - Array of inputs to validate
   * @param validator - Validation function to apply
   * @returns Array of validation results
   */
  public static validateBatch<T>(
    inputs: unknown[],
    validator: (input: unknown) => IValidationResult<T>
  ): IValidationResult<T[]> {
    const results: T[] = [];
    const errors: string[] = [];

    inputs.forEach((input, index) => {
      try {
        // Ensure proper `this` context by calling bound method
        const result = validator.call(this, input);
        if (result.success && result.data !== undefined) {
          results.push(result.data);
        } else if (result.errors) {
          errors.push(`Item ${index}: ${result.errors.join(", ")}`);
        }
      } catch (error) {
        errors.push(
          `Item ${index}: Validation error - ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    });

    if (errors.length > 0) {
      return {
        success: false,
        errors,
      };
    }

    return {
      success: true,
      data: results,
    };
  }

  /**
   * Check for SQL injection patterns in input
   *
   * @param input - Input to check
   * @returns True if potentially dangerous patterns detected
   */
  public static containsSqlInjection(input: string): boolean {
    const sqlPatterns = [
      /(\b(ALTER|CREATE|DELETE|DROP|EXEC|EXECUTE|INSERT|SELECT|UNION|UPDATE)\b)/gi,
      /(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
      /(\b(OR|AND)\s+['"]\w*['"]\s*=\s*['"])/gi,
      /(\b(SCRIPT|JAVASCRIPT|VBSCRIPT|ONLOAD|ONERROR)\b)/gi,
      /(--|#|\/\*|\*\/)/g,
      /(\bUNION\s+SELECT\b)/gi,
      /(\b(EXEC|EXECUTE)\s+)/gi,
    ];

    return sqlPatterns.some((pattern) => pattern.test(input));
  }

  /**
   * Check for XSS patterns in input
   *
   * @param input - Input to check
   * @returns True if potentially dangerous patterns detected
   */
  public static containsXss(input: string): boolean {
    const xssPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe/gi,
      /<object/gi,
      /<embed/gi,
      /vbscript:/gi,
      /<link/gi,
      /<meta/gi,
      /expression\s*\(/gi,
      /url\s*\(/gi,
    ];

    return xssPatterns.some((pattern) => pattern.test(input));
  }

  /**
   * Comprehensive security validation combining all checks
   *
   * @param input - Input to validate for security threats
   * @returns Security validation result
   */
  public static validateSecurity(input: string): IValidationResult<string> {
    if (this.containsXss(input)) {
      return {
        success: false,
        errors: ["Input contains potentially dangerous XSS patterns"],
      };
    }

    if (this.containsSqlInjection(input)) {
      return {
        success: false,
        errors: ["Input contains potentially dangerous SQL patterns"],
      };
    }

    return {
      success: true,
      data: input,
    };
  }
}
