/**
 * Shared validation types
 *
 * Common validation interfaces and utilities used across multiple services
 */

import { z } from "zod";

/**
 * Validation result interface
 * Standard format for validation operation results
 */
export interface ValidationResult<T = any> {
  readonly valid: boolean;
  readonly data?: T;
  readonly errors?: ValidationError[];
  readonly warnings?: ValidationWarning[];
  readonly validatedAt: Date;
}

/**
 * Validation error interface
 */
export interface ValidationError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly value?: any;
  readonly constraint?: string;
}

/**
 * Validation warning interface
 */
export interface ValidationWarning {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly value?: any;
  readonly suggestion?: string;
}

/**
 * Common validation schemas
 * Reusable Zod schemas for consistent validation
 */
export const CommonSchemas = {
  // User ID validation
  userId: z.string().min(1).max(100).trim(),

  // UUID validation
  uuid: z.string().uuid(),

  // Email validation
  email: z.string().email().max(255),

  // URL validation
  url: z.string().url().max(2048),

  // Date validation
  futureDate: z.date().refine((date) => date > new Date(), {
    message: "Date must be in the future",
  }),

  // Metadata validation
  metadata: z
    .record(z.any())
    .refine(
      (metadata) => {
        try {
          const serialized = JSON.stringify(metadata);
          return serialized.length <= 10000;
        } catch {
          return false;
        }
      },
      { message: "Metadata exceeds size limit or contains circular references" }
    )
    .optional(),

  // Permission/scope validation
  permission: z.string().min(1).max(100).trim(),
  scope: z.string().min(1).max(50).trim(),

  // Token validation
  token: z.string().min(10).max(4096),

  // Name validation
  name: z.string().min(1).max(200).trim(),
};

/**
 * Validation configuration interface
 */
export interface ValidationConfig {
  readonly enableStrictMode: boolean;
  readonly allowUnknownFields: boolean;
  readonly maxFieldLength: number;
  readonly maxObjectDepth: number;
  readonly customValidators?: Record<string, (value: any) => boolean>;
}

/**
 * Field validation rule interface
 */
export interface FieldValidationRule {
  readonly field: string;
  readonly required: boolean;
  readonly type: "string" | "number" | "boolean" | "date" | "object" | "array";
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
  readonly customValidator?: (value: any) => boolean;
  readonly errorMessage?: string;
}

/**
 * Schema validation options
 */
export interface SchemaValidationOptions {
  readonly abortEarly: boolean;
  readonly allowUnknown: boolean;
  readonly stripUnknown: boolean;
  readonly context?: Record<string, any>;
}
