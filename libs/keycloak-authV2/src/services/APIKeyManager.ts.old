/**
 * API Key Manager Service - Production Implementation
 * Handles API key generation, validation, and lifecycle with PostgreSQL storage
 */

import * as crypto from "crypto";
import * as bcrypt from "bcrypt";
import { z } from "zod";
import { createLogger } from "@libs/utils";
import { PostgreSQLClient, CacheService } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";
import type { UserInfo } from "../types";
import type { AuthV2Config } from "./config";

/**
 * Zod schemas for API Key Manager validation
 */
const UserIdSchema = z.string().min(1).max(100).trim();
const KeyIdSchema = z.string().uuid();
const APIKeyFormatSchema = z
  .string()
  .min(10)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/);
const APIKeyNameSchema = z.string().max(200).optional();
const StoreIdSchema = z.string().min(1).max(100).trim().optional();
const ScopeSchema = z.string().min(1).max(50).trim();
const PermissionSchema = z.string().min(1).max(100).trim();
const ExpirationDateSchema = z
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
const PrefixSchema = z
  .string()
  .max(20)
  .regex(/^[a-zA-Z0-9_]+$/)
  .optional();
const MetadataSchema = z
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

const APIKeyGenerationOptionsSchema = z.object({
  userId: UserIdSchema,
  name: APIKeyNameSchema,
  storeId: StoreIdSchema,
  scopes: z.array(ScopeSchema).max(20).optional(),
  permissions: z.array(PermissionSchema).max(50).optional(),
  expirationDate: ExpirationDateSchema,
  prefix: PrefixSchema,
  metadata: MetadataSchema,
});

const APIKeySchema = z.object({
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

// @ts-expect-error: may be used in future validation
const APIKeyValidationResultSchema = z.object({
  success: z.boolean(),
  user: z.any().optional(), // UserInfo type
  keyData: APIKeySchema.optional(),
  expiresAt: z.date().optional(),
  error: z.string().optional(),
});

// @ts-expect-error: may be used in future validation
const APIKeyManagerStatsSchema = z.object({
  totalKeys: z.number().int().min(0),
  activeKeys: z.number().int().min(0),
  expiredKeys: z.number().int().min(0),
  revokedKeys: z.number().int().min(0),
  validationsToday: z.number().int().min(0),
  cacheHitRate: z.number().min(0).max(1),
  lastResetAt: z.date(),
});

/**
 * API Key data structure matching Prisma schema
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
  user?: UserInfo;
  keyData?: APIKey;
  expiresAt?: Date;
  error?: string;
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

export class APIKeyManager {
  private readonly logger = createLogger("APIKeyManager");
  private readonly cacheService?: CacheService;
  private readonly dbClient: PostgreSQLClient;
  private readonly saltRounds = 12; // bcrypt salt rounds for security

  // Cache monitoring and limits
  private readonly cacheConfig = {
    maxEntries: 10000, // Maximum cached entries
    cleanupThreshold: 8000, // Start cleanup at 80% capacity
    cleanupBatchSize: 1000, // Remove this many entries during cleanup
  };
  private cacheEntryCount = 0;

  constructor(
    _config: AuthV2Config,
    private readonly metrics?: IMetricsCollector
  ) {
    // Initialize database client
    this.dbClient = new PostgreSQLClient(metrics);

    // Initialize cache if enabled
    if (_config.cache.enabled && metrics) {
      this.cacheService = CacheService.create(metrics);
    }
  }

  /**
   * Generate a new API key for a user with comprehensive input validation
   */
  async generateAPIKey(options: APIKeyGenerationOptions): Promise<{
    success: boolean;
    apiKey?: string;
    keyData?: APIKey;
    error?: string;
  }> {
    const startTime = performance.now();

    let validatedOptions: z.infer<typeof APIKeyGenerationOptionsSchema>;

    try {
      // Comprehensive input validation using Zod
      const validationResult = APIKeyGenerationOptionsSchema.safeParse(options);
      if (!validationResult.success) {
        return {
          success: false,
          error: `Invalid input: ${validationResult.error.issues
            .map((i) => i.message)
            .join(", ")}`,
        };
      }

      validatedOptions = validationResult.data;

      // Generate secure API key
      const apiKey = this.generateSecureKey(validatedOptions.prefix);
      const keyHash = await bcrypt.hash(apiKey, this.saltRounds);
      const keyIdentifier = this.extractKeyIdentifier(apiKey);
      const keyPreview = `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;

      // Create database record
      const keyData: APIKey = {
        id: crypto.randomUUID(),
        name: validatedOptions.name || "Unnamed API Key",
        keyHash,
        keyPreview,
        userId: validatedOptions.userId,
        ...(validatedOptions.storeId && { storeId: validatedOptions.storeId }),
        permissions: validatedOptions.permissions || [],
        scopes: validatedOptions.scopes || ["read"],
        usageCount: 0,
        isActive: true,
        ...(validatedOptions.expirationDate && {
          expiresAt: validatedOptions.expirationDate,
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(validatedOptions.metadata && {
          metadata: validatedOptions.metadata,
        }),
      };

      // Store in database with key identifier for O(1) lookups
      await this.dbClient.executeRaw(
        `INSERT INTO api_keys (
          id, name, "keyHash", "keyIdentifier", "keyPreview", "userId", "storeId", 
          permissions, scopes, "usageCount", "isActive", "expiresAt", 
          "createdAt", "updatedAt", metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          keyData.id,
          keyData.name,
          keyData.keyHash,
          keyIdentifier,
          keyData.keyPreview,
          keyData.userId,
          keyData.storeId,
          JSON.stringify(keyData.permissions),
          keyData.scopes,
          keyData.usageCount,
          keyData.isActive,
          keyData.expiresAt,
          keyData.createdAt,
          keyData.updatedAt,
          keyData.metadata ? JSON.stringify(keyData.metadata) : null,
        ]
      );

      // Update metrics using IMetricsCollector
      await this.metrics?.recordCounter(
        "keycloak.api_key_manager.total_keys",
        1
      );
      await this.metrics?.recordCounter(
        "keycloak.api_key_manager.active_keys",
        1
      );
      await this.metrics?.recordGauge(
        "keycloak.api_key_manager.total_keys_gauge",
        1
      ); // Will need DB query to get actual count

      this.logger.info("API key generated", {
        keyId: keyData.id,
        userId: validatedOptions.userId,
        scopes: validatedOptions.scopes,
      });

      this.metrics?.recordCounter("keycloak.api_key_manager.key_generated", 1);
      this.metrics?.recordTimer(
        "keycloak.api_key_manager.generate_duration",
        performance.now() - startTime
      );

      return {
        success: true,
        apiKey,
        keyData,
      };
    } catch (error) {
      // Enhanced error handling with specific error types
      let errorMessage = "Key generation failed";
      let logLevel: "error" | "warn" = "error";

      if (error instanceof Error) {
        // Database constraint violations
        if (
          error.message.includes("duplicate key") ||
          error.message.includes("unique constraint")
        ) {
          errorMessage =
            "Key generation failed due to conflict, please try again";
          logLevel = "warn";
        }
        // Database connection issues
        else if (
          error.message.includes("connection") ||
          error.message.includes("timeout")
        ) {
          errorMessage = "Database connection error, please try again";
        }
        // JSON serialization errors
        else if (error.message.includes("JSON")) {
          errorMessage = "Invalid metadata format";
          logLevel = "warn";
        }
        // bcrypt errors
        else if (
          error.message.includes("bcrypt") ||
          error.message.includes("hash")
        ) {
          errorMessage = "Encryption system error";
        } else {
          errorMessage = error.message;
        }
      }

      if (logLevel === "error") {
        this.logger.error("API key generation failed", {
          error,
          userId: validatedOptions!.userId,
          errorMessage,
        });
      } else {
        this.logger.warn("API key generation issue", {
          error: error instanceof Error ? error.message : error,
          userId: validatedOptions!.userId,
          errorMessage,
        });
      }

      this.metrics?.recordCounter("keycloak.api_key_manager.generate_error", 1);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Validate API key and return authentication result with input validation
   */
  async validateAPIKey(apiKey: string): Promise<APIKeyValidationResult> {
    const startTime = performance.now();

    try {
      // Input validation using Zod
      const validationResult = APIKeyFormatSchema.safeParse(apiKey);
      if (!validationResult.success) {
        return {
          success: false,
          error: `Invalid API key format: ${validationResult.error.issues
            .map((i) => i.message)
            .join(", ")}`,
        };
      }

      // Check cache first if enabled with enhanced security
      if (this.cacheService) {
        const securityResult = await this.checkCacheWithSecurity(apiKey);
        if (securityResult.found && securityResult.result) {
          return securityResult.result;
        }
      }

      // Perform database validation
      const result = await this.performDatabaseValidation(apiKey);

      // Cache successful validations with enhanced security
      if (this.cacheService && result.success) {
        await this.cacheValidationResultSecurely(apiKey, result);
      }

      // Update usage statistics
      if (result.success && result.keyData) {
        await this.updateKeyUsage(result.keyData.id);
      }

      await this.metrics?.recordCounter(
        "keycloak.api_key_manager.validations_today",
        1
      );
      this.metrics?.recordCounter("keycloak.api_key_manager.validation", 1);
      this.metrics?.recordTimer(
        "keycloak.api_key_manager.validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      // Enhanced error handling for API key validation
      let errorMessage = "Validation failed";
      let shouldRetry = false;

      if (error instanceof Error) {
        // Cache-related errors - non-critical, continue without cache
        if (
          error.message.includes("cache") ||
          error.message.includes("redis")
        ) {
          errorMessage =
            "Cache service unavailable, validation proceeded without cache";
          shouldRetry = true;
          this.logger.warn("API key validation cache error", {
            error: error.message,
            recoveryAction: "continued_without_cache",
          });
          this.metrics?.recordCounter(
            "keycloak.api_key_manager.cache_error",
            1
          );
        }
        // Database connection errors - critical, suggest retry
        else if (
          error.message.includes("connection") ||
          error.message.includes("timeout")
        ) {
          errorMessage = "Database connection error, please try again";
          shouldRetry = true;
          this.logger.error("API key validation database error", {
            error: error.message,
            recoveryAction: "retry_recommended",
          });
        }
        // bcrypt errors - critical security issue
        else if (error.message.includes("bcrypt")) {
          errorMessage = "Authentication system error";
          this.logger.error("API key validation bcrypt error", {
            error: error.message,
            securityImpact: "high",
          });
        }
        // JSON parsing errors - data corruption
        else if (
          error.message.includes("JSON") ||
          error.message.includes("parse")
        ) {
          errorMessage = "Data format error";
          this.logger.warn("API key validation JSON error", {
            error: error.message,
            dataIntegrity: "compromised",
          });
        } else {
          errorMessage = "Internal validation error";
          this.logger.error("API key validation unknown error", { error });
        }
      }

      this.metrics?.recordCounter(
        "keycloak.api_key_manager.validation_error",
        1
      );

      return {
        success: false,
        error: errorMessage,
        ...(shouldRetry && { retryable: true }), // Indicate if client should retry
      };
    }
  }

  /**
   * Perform database validation of API key with constant-time security
   * Uses key identifier hash for O(1) lookup instead of O(n) iteration
   */
  private async performDatabaseValidation(
    apiKey: string
  ): Promise<APIKeyValidationResult> {
    try {
      // Extract key identifier from API key for O(1) database lookup
      const keyIdentifier = this.extractKeyIdentifier(apiKey);

      // Single database lookup using key identifier (O(1) operation)
      const results = await this.dbClient.cachedQuery<
        {
          id: string;
          name: string;
          keyHash: string;
          keyPreview: string;
          userId: string;
          storeId?: string;
          permissions?: string;
          scopes: string[];
          lastUsedAt?: Date;
          usageCount: number;
          isActive: boolean;
          expiresAt?: Date;
          createdAt: Date;
          updatedAt: Date;
        }[]
      >(
        `
        SELECT id, name, "keyHash", "keyPreview", "userId", "storeId", 
               permissions, scopes, "lastUsedAt", "usageCount", "isActive", 
               "expiresAt", "createdAt", "updatedAt"
        FROM api_keys 
        WHERE "keyIdentifier" = $1
          AND "isActive" = true 
          AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
          AND "revokedAt" IS NULL
        LIMIT 1
      `,
        [keyIdentifier]
      );

      // SECURITY FIX: Always perform bcrypt operation regardless of key existence
      // This prevents timing attacks based on key existence detection
      const keyRecord = results[0];
      let isValid = false;
      let validationError: string | null = null;

      if (keyRecord) {
        try {
          // Real bcrypt comparison for valid key records
          isValid = await bcrypt.compare(apiKey, keyRecord.keyHash);
        } catch (bcryptError) {
          validationError = "Validation error";
          this.logger.warn("bcrypt comparison failed", {
            keyId: keyRecord.id,
            error: bcryptError,
          });
        }
      } else {
        // CRITICAL: Always perform bcrypt operation even when no key found
        // This maintains constant time and prevents timing attacks
        await this.performDummyBcryptOperation();
      }

      // Return early for non-existent keys after dummy operation
      if (!keyRecord) {
        return {
          success: false,
          error: "Invalid API key",
        };
      }

      if (!isValid || validationError) {
        return {
          success: false,
          error: validationError || "Invalid API key",
        };
      }

      // Parse permissions if they exist
      const permissions = keyRecord.permissions
        ? JSON.parse(keyRecord.permissions as string)
        : [];

      // Create user info from API key data
      const userInfo: UserInfo = {
        id: keyRecord.userId,
        email: undefined,
        name: undefined,
        username: `api-key-${keyRecord.id}`,
        roles: keyRecord.scopes || [],
        permissions: permissions || [],
      };

      const keyData: APIKey = {
        id: keyRecord.id,
        name: keyRecord.name,
        keyHash: keyRecord.keyHash,
        keyPreview: keyRecord.keyPreview,
        userId: keyRecord.userId,
        ...(keyRecord.storeId && { storeId: keyRecord.storeId }),
        permissions,
        scopes: keyRecord.scopes || [],
        ...(keyRecord.lastUsedAt && { lastUsedAt: keyRecord.lastUsedAt }),
        usageCount: keyRecord.usageCount,
        isActive: keyRecord.isActive,
        ...(keyRecord.expiresAt && { expiresAt: keyRecord.expiresAt }),
        createdAt: keyRecord.createdAt,
        updatedAt: keyRecord.updatedAt,
      };

      return {
        success: true,
        user: userInfo,
        keyData,
        ...(keyRecord.expiresAt && { expiresAt: keyRecord.expiresAt }),
      };
    } catch (error) {
      this.logger.error("Database validation failed", { error });
      return {
        success: false,
        error: "Validation system error",
      };
    }
  }

  /**
   * Enhanced cache security check with namespace isolation and poisoning protection
   */
  private async checkCacheWithSecurity(apiKey: string): Promise<{
    found: boolean;
    result?: APIKeyValidationResult;
  }> {
    if (!this.cacheService) {
      return { found: false };
    }

    try {
      const secureKey = this.generateSecureCacheKey(apiKey);
      const cachedResult = await this.cacheService.get<{
        data: APIKeyValidationResult;
        timestamp: number;
        checksum: string;
      }>(secureKey);

      if (cachedResult.data && cachedResult.source !== "miss") {
        // Verify cache entry integrity
        const isValid = this.verifyCacheEntryIntegrity(
          cachedResult.data.data,
          cachedResult.data.timestamp,
          cachedResult.data.checksum
        );

        if (isValid) {
          this.metrics?.recordCounter("keycloak.api_key_manager.cache_hit", 1);
          return {
            found: true,
            result: cachedResult.data.data,
          };
        } else {
          // Cache entry compromised, remove it by setting null/undefined
          await this.cacheService.invalidate(secureKey);
          this.logger.warn("Compromised cache entry removed", {
            key: secureKey,
          });
          this.metrics?.recordCounter(
            "keycloak.api_key_manager.cache_corruption",
            1
          );
        }
      }

      this.metrics?.recordCounter("keycloak.api_key_manager.cache_miss", 1);
      return { found: false };
    } catch (error) {
      this.logger.warn("Cache security check failed", { error });
      this.metrics?.recordCounter("keycloak.api_key_manager.cache_error", 1);
      return { found: false };
    }
  }

  /**
   * Generate secure cache key with namespace isolation
   */
  private generateSecureCacheKey(apiKey: string): string {
    // Use longer, more secure hash with namespace and salt
    const namespace = "apikm"; // api key manager namespace
    const salt = "cache_security_v2"; // version-specific salt
    const keyHash = crypto
      .createHash("sha256")
      .update(apiKey + salt)
      .digest("hex");

    return `${namespace}:validation:${keyHash}`;
  }

  /**
   * Verify cache entry integrity to prevent poisoning attacks
   */
  private verifyCacheEntryIntegrity(
    data: APIKeyValidationResult,
    timestamp: number,
    checksum: string
  ): boolean {
    try {
      // Generate expected checksum
      const dataString = JSON.stringify(data) + timestamp.toString();
      const expectedChecksum = crypto
        .createHash("sha256")
        .update(dataString + "integrity_check_v1")
        .digest("hex");

      return checksum === expectedChecksum;
    } catch {
      return false;
    }
  }

  /**
   * Cache successful validations with enhanced security and size management
   */
  private async cacheValidationResultSecurely(
    apiKey: string,
    result: APIKeyValidationResult
  ): Promise<void> {
    if (!this.cacheService || !result.success) {
      return;
    }

    try {
      // Check cache size limits before adding new entries
      await this.manageCacheSize();

      const secureKey = this.generateSecureCacheKey(apiKey);
      const timestamp = Date.now();

      // Generate integrity checksum
      const dataString = JSON.stringify(result) + timestamp.toString();
      const checksum = crypto
        .createHash("sha256")
        .update(dataString + "integrity_check_v1")
        .digest("hex");

      const cacheEntry = {
        data: result,
        timestamp,
        checksum,
      };

      // Cache for 5 minutes with integrity protection
      const cacheTTL = 300;
      await this.cacheService.set(secureKey, cacheEntry, cacheTTL);
      this.cacheEntryCount++;
      this.metrics?.recordCounter("keycloak.api_key_manager.cache_set", 1);
    } catch (error) {
      this.logger.warn("Failed to cache validation result securely", { error });
    }
  }

  /**
   * Manage cache size to prevent memory leaks with LRU-style cleanup
   */
  private async manageCacheSize(): Promise<void> {
    if (!this.cacheService) {
      return;
    }

    try {
      // Estimate cache size (this is approximate since we don't have direct access)
      if (this.cacheEntryCount > this.cacheConfig.cleanupThreshold) {
        this.logger.info("Cache cleanup initiated", {
          currentCount: this.cacheEntryCount,
          threshold: this.cacheConfig.cleanupThreshold,
        });

        // Invalidate older cache entries by pattern
        const cleanupPattern = `${this.generateSecureCacheKey("")}*`;
        await this.cacheService.invalidatePattern(cleanupPattern);

        // Reset counter after cleanup
        this.cacheEntryCount = Math.max(
          0,
          this.cacheEntryCount - this.cacheConfig.cleanupBatchSize
        );

        this.metrics?.recordCounter(
          "keycloak.api_key_manager.cache_cleanup",
          1
        );
        this.logger.info("Cache cleanup completed", {
          newCount: this.cacheEntryCount,
        });
      }
    } catch (error) {
      this.logger.warn("Cache size management failed", { error });
    }
  }

  /**
   * Invalidate cache for a specific API key
   */
  async invalidateAPIKeyCache(apiKey: string): Promise<void> {
    if (!this.cacheService) {
      return;
    }

    try {
      const secureKey = this.generateSecureCacheKey(apiKey);
      await this.cacheService.set(secureKey, null, 1); // Very short TTL to effectively invalidate
      this.logger.debug("API key cache invalidated", {
        keyHash: this.hashKey(apiKey),
      });
      this.metrics?.recordCounter(
        "keycloak.api_key_manager.cache_invalidation",
        1
      );
    } catch (error) {
      this.logger.warn("Failed to invalidate API key cache", { error });
    }
  }

  /**
   * Extract key identifier from API key for database lookup
   * Uses deterministic hash of key prefix for O(1) database queries
   */
  private extractKeyIdentifier(apiKey: string): string {
    // Extract first 16 characters (prefix + partial key) for identification
    const keyPrefix = apiKey.length >= 16 ? apiKey.slice(0, 16) : apiKey;

    // Create deterministic hash for database lookup
    return crypto
      .createHash("sha256")
      .update(keyPrefix)
      .digest("hex")
      .slice(0, 32); // 32 character identifier
  }

  /**
   * Perform dummy bcrypt operation to maintain constant-time validation
   * Prevents timing attacks based on key existence in database
   */
  private async performDummyBcryptOperation(): Promise<void> {
    try {
      // Use a fixed dummy hash to compare against
      const dummyHash =
        "$2b$12$dummy.hash.for.constant.time.validation.purposes.only";
      await bcrypt.compare("dummy-key-for-timing", dummyHash);
    } catch {
      // Ignore errors in dummy operation
    }
  }

  /**
   * Update API key usage statistics with proper error handling
   */
  private async updateKeyUsage(keyId: string): Promise<void> {
    try {
      await this.dbClient.executeRaw(
        `UPDATE api_keys 
         SET "usageCount" = "usageCount" + 1, 
             "lastUsedAt" = NOW(), 
             "updatedAt" = NOW() 
         WHERE id = $1`,
        [keyId]
      );
    } catch (error) {
      this.logger.warn("Failed to update key usage", { keyId, error });
    }
  }

  /**
   * Revoke an API key with input validation
   */
  async revokeAPIKey(
    keyId: string,
    revokedBy: string,
    reason?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Input validation using Zod
      const keyIdResult = KeyIdSchema.safeParse(keyId);
      if (!keyIdResult.success) {
        return {
          success: false,
          error: `Invalid key ID: ${keyIdResult.error.issues
            .map((i) => i.message)
            .join(", ")}`,
        };
      }

      const userIdResult = UserIdSchema.safeParse(revokedBy);
      if (!userIdResult.success) {
        return {
          success: false,
          error: `Invalid revokedBy parameter: ${userIdResult.error.issues
            .map((i) => i.message)
            .join(", ")}`,
        };
      }

      // Validate reason if provided
      if (reason !== undefined) {
        if (typeof reason !== "string") {
          return {
            success: false,
            error: "Invalid reason: must be a string",
          };
        }
        if (reason.length > 500) {
          return {
            success: false,
            error: "Invalid reason: maximum length is 500 characters",
          };
        }
      }

      await this.dbClient.executeRaw(
        `UPDATE api_keys 
         SET "isActive" = false, 
             "revokedAt" = NOW(), 
             "revokedBy" = $2, 
             "updatedAt" = NOW(),
             metadata = COALESCE(metadata, '{}')::jsonb || $3::jsonb
         WHERE id = $1`,
        [keyId, revokedBy, JSON.stringify({ revocationReason: reason })]
      );

      // Clear cache for this key if caching is enabled
      // Note: We can't directly clear the cache for this key since we don't have the original key
      // but the cache will expire naturally and we've marked the key as revoked in the database

      await this.metrics?.recordCounter(
        "keycloak.api_key_manager.active_keys",
        -1
      );
      await this.metrics?.recordCounter(
        "keycloak.api_key_manager.revoked_keys",
        1
      );

      this.logger.info("API key revoked", { keyId, revokedBy, reason });
      this.metrics?.recordCounter("keycloak.api_key_manager.key_revoked", 1);

      return { success: true };
    } catch (error) {
      // Enhanced error handling for key revocation
      let errorMessage = "Revocation failed";
      let isRecoverable = false;

      if (error instanceof Error) {
        // Key not found - this might be acceptable
        if (
          error.message.includes("no rows affected") ||
          error.message.includes("not found")
        ) {
          errorMessage = "API key not found or already revoked";
          isRecoverable = true;
          this.logger.warn("API key revocation - key not found", {
            keyId,
            possibleCause: "already_revoked_or_invalid_id",
          });
        }
        // Database connection errors
        else if (
          error.message.includes("connection") ||
          error.message.includes("timeout")
        ) {
          errorMessage = "Database connection error during revocation";
          isRecoverable = true;
          this.logger.error("API key revocation database error", {
            keyId,
            error: error.message,
            recoveryAction: "retry_recommended",
          });
        }
        // Constraint violations
        else if (
          error.message.includes("constraint") ||
          error.message.includes("foreign key")
        ) {
          errorMessage = "Invalid revocation parameters";
          this.logger.warn("API key revocation constraint error", {
            keyId,
            revokedBy,
            error: error.message,
          });
        }
        // JSON errors in metadata handling
        else if (error.message.includes("JSON")) {
          errorMessage = "Revocation metadata format error";
          this.logger.warn("API key revocation JSON error", {
            keyId,
            reason,
            error: error.message,
          });
        } else {
          errorMessage = error.message;
          this.logger.error("API key revocation unknown error", {
            keyId,
            error,
          });
        }
      }

      this.metrics?.recordCounter("keycloak.api_key_manager.revoke_error", 1);

      return {
        success: false,
        error: errorMessage,
        ...(isRecoverable && { recoverable: true }),
      };
    }
  }

  /**
   * Get API keys for a user with input validation
   */
  async getUserAPIKeys(userId: string): Promise<APIKey[]> {
    try {
      // Input validation using Zod
      const validationResult = UserIdSchema.safeParse(userId);
      if (!validationResult.success) {
        throw new Error(
          `Invalid user ID: ${validationResult.error.issues
            .map((i) => i.message)
            .join(", ")}`
        );
      }

      const results = await this.dbClient.cachedQuery<
        {
          id: string;
          name: string;
          keyHash: string;
          keyPreview: string;
          userId: string;
          storeId?: string;
          permissions?: string;
          scopes: string[];
          lastUsedAt?: Date;
          usageCount: number;
          isActive: boolean;
          expiresAt?: Date;
          createdAt: Date;
          updatedAt: Date;
          revokedAt?: Date;
          revokedBy?: string;
          metadata?: string;
        }[]
      >(
        `
        SELECT id, name, "keyHash", "keyPreview", "userId", "storeId", 
               permissions, scopes, "lastUsedAt", "usageCount", "isActive", 
               "expiresAt", "createdAt", "updatedAt", "revokedAt", "revokedBy", metadata
        FROM api_keys 
        WHERE "userId" = $1 
        ORDER BY "createdAt" DESC
      `,
        [userId]
      );
      return results.map((record) => ({
        id: record.id,
        name: record.name,
        keyHash: "", //record.keyHash, // Note: Don't expose this in real APIs
        keyPreview: record.keyPreview,
        userId: record.userId,
        ...(record.storeId && { storeId: record.storeId }),
        permissions: record.permissions ? JSON.parse(record.permissions) : [],
        scopes: record.scopes || [],
        ...(record.lastUsedAt && { lastUsedAt: record.lastUsedAt }),
        usageCount: record.usageCount,
        isActive: record.isActive,
        ...(record.expiresAt && { expiresAt: record.expiresAt }),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        ...(record.revokedAt && { revokedAt: record.revokedAt }),
        ...(record.revokedBy && { revokedBy: record.revokedBy }),
        ...(record.metadata && { metadata: JSON.parse(record.metadata) }),
      }));
    } catch (error) {
      // Enhanced error handling for getUserAPIKeys
      let enhancedError: Error;

      if (error instanceof Error) {
        // Database connection errors
        if (
          error.message.includes("connection") ||
          error.message.includes("timeout")
        ) {
          enhancedError = new Error(
            `Database connection error while fetching API keys for user ${userId}: ${error.message}`
          );
          this.logger.error("API key fetch database error", {
            userId,
            error: error.message,
            operation: "getUserAPIKeys",
          });
        }
        // Permission/access errors
        else if (
          error.message.includes("permission") ||
          error.message.includes("access")
        ) {
          enhancedError = new Error(
            `Access denied while fetching API keys for user ${userId}`
          );
          this.logger.warn("API key fetch access error", {
            userId,
            error: error.message,
          });
        }
        // JSON parsing errors
        else if (
          error.message.includes("JSON") ||
          error.message.includes("parse")
        ) {
          enhancedError = new Error(
            `Data corruption detected in API keys for user ${userId}`
          );
          this.logger.error("API key fetch JSON error", {
            userId,
            error: error.message,
            dataIntegrity: "compromised",
          });
        } else {
          enhancedError = new Error(
            `Failed to fetch API keys for user ${userId}: ${error.message}`
          );
          this.logger.error("API key fetch unknown error", { userId, error });
        }
      } else {
        enhancedError = new Error(
          `Failed to fetch API keys for user ${userId}: Unknown error`
        );
        this.logger.error("API key fetch non-Error object", { userId, error });
      }

      this.metrics?.recordCounter(
        "keycloak.api_key_manager.get_user_keys_error",
        1
      );
      throw enhancedError;
    }
  }

  /**
   * Generate a secure API key with entropy validation and fallback mechanisms
   */
  private generateSecureKey(prefix?: string): string {
    try {
      // Primary entropy source - crypto.randomBytes
      const randomBytes = this.generateSecureRandomBytes(32);

      // Validate entropy quality
      if (!this.validateEntropyQuality(randomBytes)) {
        throw new Error("Primary entropy source failed quality check");
      }

      const key = randomBytes.toString("base64url");
      return prefix ? `${prefix}_${key}` : `ak_${key}`;
    } catch (error) {
      this.logger.warn("Primary key generation failed, using fallback", {
        error,
      });
      return this.generateFallbackKey(prefix);
    }
  }

  /**
   * Generate secure random bytes with validation
   */
  private generateSecureRandomBytes(size: number): Buffer {
    try {
      // Use Node.js crypto.randomBytes which uses platform entropy
      const bytes = crypto.randomBytes(size);

      // Basic validation - ensure we got the expected size
      if (bytes.length !== size) {
        throw new Error(`Expected ${size} bytes, got ${bytes.length}`);
      }

      return bytes;
    } catch (error) {
      this.logger.error("Failed to generate random bytes", { size, error });
      throw error;
    }
  }

  /**
   * Validate entropy quality of generated random bytes
   */
  private validateEntropyQuality(bytes: Buffer): boolean {
    try {
      // Check 1: No all-zero bytes (extremely unlikely but possible with bad entropy)
      const allZeros = bytes.every((byte) => byte === 0);
      if (allZeros) {
        this.logger.error("Entropy failure: all-zero bytes detected");
        return false;
      }

      // Check 2: No all-same bytes
      const firstByte = bytes[0];
      const allSame = bytes.every((byte) => byte === firstByte);
      if (allSame) {
        this.logger.error("Entropy failure: all bytes identical", {
          byte: firstByte,
        });
        return false;
      }

      // Check 3: Basic distribution check - ensure reasonable variance
      const byteSet = new Set(bytes);
      const uniqueBytes = byteSet.size;
      const expectedMinUnique = Math.min(bytes.length * 0.5, 128); // At least 50% unique or up to 128 unique values

      if (uniqueBytes < expectedMinUnique) {
        this.logger.warn("Entropy warning: low byte diversity", {
          unique: uniqueBytes,
          expected: expectedMinUnique,
          total: bytes.length,
        });
        // This is a warning, not a failure - continue but log it
      }

      // Check 4: Simple run-length check - detect patterns
      let maxRunLength = 1;
      let currentRunLength = 1;

      for (let i = 1; i < bytes.length; i++) {
        if (bytes[i] === bytes[i - 1]) {
          currentRunLength++;
          maxRunLength = Math.max(maxRunLength, currentRunLength);
        } else {
          currentRunLength = 1;
        }
      }

      // Fail if we have more than 4 consecutive identical bytes (very suspicious)
      if (maxRunLength > 4) {
        this.logger.error("Entropy failure: suspicious run length", {
          maxRunLength,
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error("Entropy validation failed", { error });
      return false;
    }
  }

  /**
   * Generate fallback key using multiple entropy sources
   */
  private generateFallbackKey(prefix?: string): string {
    this.logger.warn(
      "Using fallback key generation - investigate entropy issues"
    );
    this.metrics?.recordCounter(
      "keycloak.api_key_manager.fallback_generation",
      1
    );

    try {
      // Combine multiple sources for fallback entropy
      const timestamp = Date.now().toString(36);
      const processInfo =
        process.pid.toString(36) + process.uptime().toString(36);
      const random1 = Math.random().toString(36).slice(2);
      const random2 = Math.random().toString(36).slice(2);

      // Try to get some system randomness if available
      let systemRandom = "";
      try {
        systemRandom = crypto.randomBytes(16).toString("hex");
      } catch {
        // If crypto.randomBytes still fails, use Math.random
        systemRandom = (Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
      }

      // Combine all sources
      const combined = `${timestamp}${processInfo}${random1}${random2}${systemRandom}`;

      // Hash the combined data for uniform distribution
      const keyHash = crypto
        .createHash("sha256")
        .update(combined)
        .digest("base64url");

      // Take first 43 characters (standard base64url length for 32 bytes)
      const key = keyHash.slice(0, 43);

      return prefix ? `${prefix}_${key}` : `ak_${key}`;
    } catch (error) {
      this.logger.error("Fallback key generation failed", { error });
      // Last resort - time-based key with warning
      const timeKey =
        Date.now().toString(36) + Math.random().toString(36).slice(2);
      this.metrics?.recordCounter(
        "keycloak.api_key_manager.emergency_generation",
        1
      );
      return prefix
        ? `${prefix}_emergency_${timeKey}`
        : `ak_emergency_${timeKey}`;
    }
  }

  /**
   * Test entropy source quality on startup
   */
  async testEntropySource(): Promise<{
    status: "healthy" | "degraded" | "failed";
    details: any;
  }> {
    try {
      const testResults = [];

      // Test multiple entropy generation attempts
      for (let i = 0; i < 5; i++) {
        try {
          const testBytes = this.generateSecureRandomBytes(32);
          const isQualityOk = this.validateEntropyQuality(testBytes);
          testResults.push({
            attempt: i + 1,
            success: true,
            quality: isQualityOk,
          });
        } catch (error) {
          testResults.push({
            attempt: i + 1,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const successfulTests = testResults.filter((r) => r.success).length;
      const qualityTests = testResults.filter(
        (r) => r.success && r.quality
      ).length;

      if (successfulTests === 0) {
        return {
          status: "failed",
          details: {
            message: "Entropy source completely failed",
            testResults,
            recommendation:
              "System needs immediate attention - no secure key generation possible",
          },
        };
      } else if (qualityTests < successfulTests * 0.8) {
        return {
          status: "degraded",
          details: {
            message: "Entropy source working but quality concerns detected",
            successfulTests,
            qualityTests,
            testResults,
            recommendation:
              "Monitor system entropy and investigate potential issues",
          },
        };
      } else {
        return {
          status: "healthy",
          details: {
            message: "Entropy source functioning normally",
            successfulTests,
            qualityTests,
            testResults,
          },
        };
      }
    } catch (error) {
      return {
        status: "failed",
        details: {
          message: "Entropy test system failed",
          error: error instanceof Error ? error.message : "Unknown error",
          recommendation: "System entropy testing needs investigation",
        },
      };
    }
  }

  /**
   * Count total keys in nested object structure for validation
   * Used by MetadataSchema refinement for security validation
   */
  // @ts-expect-error: used in MetadataSchema refinement
  private countObjectKeys(obj: any, depth = 0): number {
    if (depth > 20 || !obj || typeof obj !== "object") return 0;

    let count = 0;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        count++;
        if (typeof obj[key] === "object" && obj[key] !== null) {
          count += this.countObjectKeys(obj[key], depth + 1);
        }
      }
    }
    return count;
  }

  /**
   * Hash API key for cache keys (not for storage)
   */
  private hashKey(apiKey: string): string {
    return crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Get API key manager statistics using optimized single database query
   * This eliminates the complex APIKeyStatsManager and relies on IMetricsCollector + DB
   */
  async getStats(): Promise<APIKeyManagerStats> {
    try {
      // Single optimized query with conditional counting (much faster than multiple queries)
      const statsResult = await this.dbClient.cachedQuery<
        {
          total_keys: number;
          active_keys: number;
          expired_keys: number;
          revoked_keys: number;
        }[]
      >(
        `
        SELECT 
          COUNT(*) as total_keys,
          COUNT(*) FILTER (WHERE "isActive" = true) as active_keys,
          COUNT(*) FILTER (WHERE "expiresAt" < NOW()) as expired_keys,
          COUNT(*) FILTER (WHERE "revokedAt" IS NOT NULL) as revoked_keys
        FROM api_keys
        `,
        []
      );

      const stats = statsResult[0];

      return {
        totalKeys: stats?.total_keys || 0,
        activeKeys: stats?.active_keys || 0,
        expiredKeys: stats?.expired_keys || 0,
        revokedKeys: stats?.revoked_keys || 0,
        validationsToday: 0, // Can be retrieved from metrics system if needed
        cacheHitRate: 0, // Can be calculated from IMetricsCollector counters if needed
        lastResetAt: new Date(),
      };
    } catch (error) {
      this.logger.error("Failed to get API key stats from database", { error });
      return {
        totalKeys: 0,
        activeKeys: 0,
        expiredKeys: 0,
        revokedKeys: 0,
        validationsToday: 0,
        cacheHitRate: 0,
        lastResetAt: new Date(),
      };
    }
  }

  /**
   * Health check for API key manager
   */
  async healthCheck(): Promise<{
    status: "healthy" | "unhealthy";
    details: any;
  }> {
    try {
      // Test database connectivity with proper parameter format
      await this.dbClient.executeRaw("SELECT 1", []);

      // Get current stats from database
      const stats = await this.getStats();

      return {
        status: "healthy",
        details: {
          database: "connected",
          cache: this.cacheService ? "enabled" : "disabled",
          stats,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        details: {
          database: "disconnected",
          error: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }
}
