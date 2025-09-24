/**
 * Shared types and interfaces for API Key management components
 */

import { z } from "zod";

/**
 * Validation schemas exported for reuse
 */
export const UserIdSchema = z.string().min(1).max(100).trim();
export const KeyIdSchema = z.string().uuid();
export const APIKeyFormatSchema = z
  .string()
  .min(10)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const APIKeyNameSchema = z.string().max(200).optional();
export const StoreIdSchema = z.string().min(1).max(100).trim().optional();
export const ScopeSchema = z.string().min(1).max(50).trim();
export const PermissionSchema = z.string().min(1).max(100).trim();
export const ExpirationDateSchema = z
  .date()
  .refine((date) => date > new Date(), {
    message: "Expiration date must be in the future",
  })
  .refine(
    (date) => {
      const tenYearsFromNow = new Date();
      tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
      return date <= tenYearsFromNow;
    },
    {
      message: "Expiration date cannot be more than 10 years in the future",
    }
  )
  .optional();
export const PrefixSchema = z
  .string()
  .max(20)
  .regex(/^[a-zA-Z0-9_]+$/)
  .optional();
export const MetadataSchema = z
  .record(z.any())
  .refine(
    (metadata) => {
      // Check for circular references and excessive nesting
      const seen = new Set();
      const checkCircular = (obj: any, depth = 0): boolean => {
        if (depth > 20) return false;
        if (obj && typeof obj === "object") {
          if (seen.has(obj)) return false;
          seen.add(obj);
          for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
              if (!checkCircular(obj[key], depth + 1)) return false;
            }
          }
          seen.delete(obj);
        }
        return true;
      };

      if (!checkCircular(metadata)) return false;

      // Check object key count
      const countObjectKeys = (obj: any, depth = 0): number => {
        if (depth > 20 || !obj || typeof obj !== "object") return 0;
        let count = 0;
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            count++;
            if (typeof obj[key] === "object" && obj[key] !== null) {
              count += countObjectKeys(obj[key], depth + 1);
            }
          }
        }
        return count;
      };

      if (countObjectKeys(metadata) > 100) return false;

      // Check serialization size
      try {
        const serialized = JSON.stringify(metadata);
        return serialized.length <= 10000;
      } catch {
        return false;
      }
    },
    {
      message:
        "Invalid metadata: contains circular references, excessive nesting, too many keys, or exceeds size limit",
    }
  )
  .optional();

export const APIKeyGenerationOptionsSchema = z.object({
  userId: UserIdSchema,
  name: APIKeyNameSchema,
  storeId: StoreIdSchema,
  scopes: z.array(ScopeSchema).max(20).optional(),
  permissions: z.array(PermissionSchema).max(50).optional(),
  expirationDate: ExpirationDateSchema,
  prefix: PrefixSchema,
  metadata: MetadataSchema,
});

export const APIKeySchema = z.object({
  id: KeyIdSchema,
  name: z.string(),
  keyHash: z.string(),
  keyPreview: z.string(),
  userId: UserIdSchema,
  storeId: StoreIdSchema,
  permissions: z.array(PermissionSchema).optional(),
  scopes: z.array(z.string()),
  lastUsedAt: z.date().optional(),
  usageCount: z.number().int().min(0),
  isActive: z.boolean(),
  expiresAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  revokedAt: z.date().optional(),
  revokedBy: z.string().optional(),
  metadata: MetadataSchema,
});

export const APIKeyManagerStatsSchema = z.object({
  totalKeys: z.number().int().min(0),
  activeKeys: z.number().int().min(0),
  expiredKeys: z.number().int().min(0),
  revokedKeys: z.number().int().min(0),
  validationsToday: z.number().int().min(0),
  cacheHitRate: z.number().min(0).max(1),
  lastResetAt: z.date(),
});

/**
 * Core interfaces
 */
export interface APIKey {
  id: string;
  name: string;
  keyHash: string;
  keyPreview: string;
  userId: string;
  storeId?: string;
  permissions?: string[];
  scopes: string[];
  lastUsedAt?: Date;
  usageCount: number;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  revokedAt?: Date;
  revokedBy?: string;
  metadata?: Record<string, any>;
}

export interface APIKeyGenerationOptions {
  userId: string;
  name?: string;
  storeId?: string;
  scopes?: string[];
  permissions?: string[];
  expirationDate?: Date;
  prefix?: string;
  metadata?: Record<string, any>;
}

export interface APIKeyValidationResult {
  success: boolean;
  user?: any; // UserInfo type from main module
  keyData?: APIKey;
  expiresAt?: Date;
  error?: string;
  retryable?: boolean;
}

export interface APIKeyManagerStats {
  totalKeys: number;
  activeKeys: number;
  expiredKeys: number;
  revokedKeys: number;
  validationsToday: number;
  cacheHitRate: number;
  lastResetAt: Date;
}

export interface GenerationResult {
  success: boolean;
  apiKey?: string;
  keyData?: APIKey;
  error?: string;
}

export interface RevocationResult {
  success: boolean;
  error?: string;
  recoverable?: boolean;
}

export interface EntropyTestResult {
  status: "healthy" | "degraded" | "failed";
  details: any;
}

export interface HealthCheckResult {
  status: "healthy" | "unhealthy";
  details: any;
}
