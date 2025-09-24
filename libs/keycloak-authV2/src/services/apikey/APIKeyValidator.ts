/**
 * APIKeyValidator - Focused API key validation with security checks
 * 
 * Responsibilities:
 * - API key format validation
 * - Database validation with constant-time security
 * - Cache integration for validation results
 * - Security-focused validation with timing attack protection
 * - Metrics tracking for validation operations
 * 
 * SOLID Principles:
 * - Single Responsibility: Only handles validation logic
 * - Open/Closed: Extensible validation rules
 * - Liskov Substitution: Implements standard validator interface
 * - Interface Segregation: Clean separation of validation concerns
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import { performance } from "perf_hooks";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import type { ILogger, IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient } from "@libs/database";
import type { 
  APIKeyValidationResult, 
  APIKey, 
  UserInfo,
  APIKeyFormatSchema 
} from "./types";
import type { APIKeyCacheManager } from "./APIKeyCacheManager";

export interface APIKeyValidatorConfig {
  readonly enableCache: boolean;
  readonly constantTimeSecurity: boolean;
  readonly cacheTtl: number; // seconds
  readonly maxValidationTime: number; // milliseconds
}

const DEFAULT_VALIDATOR_CONFIG: APIKeyValidatorConfig = {
  enableCache: true,
  constantTimeSecurity: true,
  cacheTtl: 300, // 5 minutes
  maxValidationTime: 5000, // 5 seconds
};

/**
 * High-security API key validator with constant-time guarantees
 */
export class APIKeyValidator {
  private readonly config: APIKeyValidatorConfig;
  
  constructor(
    private readonly logger: ILogger,
    private readonly metrics: IMetricsCollector,
    private readonly dbClient: PostgreSQLClient,
    private readonly cacheManager?: APIKeyCacheManager,
    config: Partial<APIKeyValidatorConfig> = {}
  ) {
    this.config = { ...DEFAULT_VALIDATOR_CONFIG, ...config };
    
    this.logger.info("APIKeyValidator initialized", {
      cacheEnabled: this.config.enableCache && !!this.cacheManager,
      constantTimeSecurity: this.config.constantTimeSecurity,
      cacheTtl: this.config.cacheTtl,
    });
  }

  /**
   * Validate API key with comprehensive security checks
   */
  async validateAPIKey(apiKey: string): Promise<APIKeyValidationResult> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Starting API key validation", { operationId });

      // 1. Format validation using Zod
      const formatResult = await this.validateFormat(apiKey, operationId);
      if (!formatResult.success) {
        return formatResult;
      }

      // 2. Check cache first if enabled
      if (this.config.enableCache && this.cacheManager) {
        const cacheResult = await this.checkCache(apiKey, operationId);
        if (cacheResult) {
          this.metrics.recordTimer(
            "apikey.validator.duration", 
            performance.now() - startTime
          );
          return cacheResult;
        }
      }

      // 3. Perform database validation
      const dbResult = await this.performDatabaseValidation(apiKey, operationId);

      // 4. Cache successful validations if cache is enabled
      if (this.config.enableCache && this.cacheManager && dbResult.success) {
        await this.cacheResult(apiKey, dbResult, operationId);
      }

      // 5. Record metrics
      this.recordMetrics(startTime, dbResult.success, "database");

      return dbResult;
    } catch (error) {
      return this.handleValidationError(error, operationId, startTime);
    }
  }

  /**
   * Validate API key format using Zod schema
   */
  private async validateFormat(
    apiKey: string, 
    operationId: string
  ): Promise<APIKeyValidationResult> {
    try {
      const validationResult = APIKeyFormatSchema.safeParse(apiKey);
      if (!validationResult.success) {
        const errorMessage = `Invalid API key format: ${validationResult.error.issues
          .map((i) => i.message)
          .join(", ")}`;

        this.logger.warn("API key format validation failed", {
          operationId,
          error: errorMessage,
        });

        this.metrics.recordCounter("apikey.validator.format_invalid", 1);

        return {
          success: false,
          error: errorMessage,
        };
      }

      this.metrics.recordCounter("apikey.validator.format_valid", 1);
      return { success: true };
    } catch (error) {
      this.logger.error("Format validation error", { operationId, error });
      this.metrics.recordCounter("apikey.validator.format_error", 1);
      
      return {
        success: false,
        error: "Format validation failed",
      };
    }
  }

  /**
   * Check cache for existing validation result
   */
  private async checkCache(
    apiKey: string, 
    operationId: string
  ): Promise<APIKeyValidationResult | null> {
    if (!this.cacheManager) {
      return null;
    }

    try {
      const cached = await this.cacheManager.getCachedValidation(apiKey);
      if (cached) {
        this.logger.debug("Cache hit for API key validation", { operationId });
        this.metrics.recordCounter("apikey.validator.cache_hit", 1);
        return cached;
      }

      this.metrics.recordCounter("apikey.validator.cache_miss", 1);
      return null;
    } catch (error) {
      this.logger.warn("Cache check failed, proceeding without cache", {
        operationId,
        error,
      });
      this.metrics.recordCounter("apikey.validator.cache_error", 1);
      return null;
    }
  }

  /**
   * Cache validation result
   */
  private async cacheResult(
    apiKey: string, 
    result: APIKeyValidationResult,
    operationId: string
  ): Promise<void> {
    if (!this.cacheManager || !result.success) {
      return;
    }

    try {
      await this.cacheManager.cacheValidation(apiKey, result, this.config.cacheTtl);
      this.logger.debug("Validation result cached", { operationId });
      this.metrics.recordCounter("apikey.validator.cache_set", 1);
    } catch (error) {
      this.logger.warn("Failed to cache validation result", {
        operationId,
        error,
      });
      this.metrics.recordCounter("apikey.validator.cache_set_error", 1);
    }
  }

  /**
   * Perform database validation with constant-time security
   */
  private async performDatabaseValidation(
    apiKey: string,
    operationId: string
  ): Promise<APIKeyValidationResult> {
    try {
      const keyIdentifier = this.extractKeyIdentifier(apiKey);

      this.logger.debug("Performing database validation", {
        operationId,
        keyIdentifier: keyIdentifier.slice(0, 8) + "***",
      });

      // Database lookup with security constraints
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

      // SECURITY: Constant-time validation to prevent timing attacks
      const keyRecord = results[0];
      const validationResult = await this.performConstantTimeValidation(
        apiKey, 
        keyRecord, 
        operationId
      );

      if (!validationResult.success) {
        return validationResult;
      }

      // Build successful validation result
      return this.buildSuccessResult(keyRecord!);
    } catch (error) {
      this.logger.error("Database validation failed", { operationId, error });
      this.metrics.recordCounter("apikey.validator.database_error", 1);
      
      return {
        success: false,
        error: "Database validation failed",
        retryable: this.isRetryableError(error),
      };
    }
  }

  /**
   * Perform constant-time bcrypt validation to prevent timing attacks
   */
  private async performConstantTimeValidation(
    apiKey: string,
    keyRecord: any,
    operationId: string
  ): Promise<APIKeyValidationResult> {
    let isValid = false;
    let validationError: string | null = null;

    if (keyRecord) {
      try {
        // Real bcrypt comparison for valid key records
        isValid = await bcrypt.compare(apiKey, keyRecord.keyHash);
        this.logger.debug("bcrypt comparison completed", {
          operationId,
          keyId: keyRecord.id,
          isValid,
        });
      } catch (bcryptError) {
        validationError = "Authentication error";
        this.logger.warn("bcrypt comparison failed", {
          operationId,
          keyId: keyRecord.id,
          error: bcryptError,
        });
        this.metrics.recordCounter("apikey.validator.bcrypt_error", 1);
      }
    } else {
      // CRITICAL: Always perform bcrypt operation even when no key found
      // This maintains constant time and prevents timing attacks
      if (this.config.constantTimeSecurity) {
        await this.performDummyBcryptOperation();
      }
      
      this.logger.debug("No key record found", { operationId });
      this.metrics.recordCounter("apikey.validator.key_not_found", 1);
    }

    // Return validation result
    if (!keyRecord) {
      return {
        success: false,
        error: "Invalid API key",
      };
    }

    if (!isValid || validationError) {
      this.metrics.recordCounter("apikey.validator.invalid_key", 1);
      return {
        success: false,
        error: validationError || "Invalid API key",
      };
    }

    this.metrics.recordCounter("apikey.validator.valid_key", 1);
    return { success: true };
  }

  /**
   * Extract key identifier for database lookup
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
   * Perform dummy bcrypt operation for constant-time security
   */
  private async performDummyBcryptOperation(): Promise<void> {
    try {
      // Use a fixed dummy hash to compare against
      const dummyHash = "$2b$12$dummy.hash.for.constant.time.validation.purposes.only";
      const dummyKey = "dummy_key_for_timing_attack_prevention";
      
      await bcrypt.compare(dummyKey, dummyHash);
    } catch (error) {
      // Dummy operation errors are expected and ignored
      this.logger.debug("Dummy bcrypt operation completed", { error });
    }
  }

  /**
   * Build successful validation result with user info
   */
  private buildSuccessResult(keyRecord: any): APIKeyValidationResult {
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
  }

  /**
   * Handle validation errors with proper categorization
   */
  private handleValidationError(
    error: unknown,
    operationId: string,
    startTime: number
  ): APIKeyValidationResult {
    let errorMessage = "Validation failed";
    let shouldRetry = false;

    if (error instanceof Error) {
      // Cache-related errors - non-critical, continue without cache
      if (error.message.includes("cache") || error.message.includes("redis")) {
        errorMessage = "Cache service unavailable, validation proceeded without cache";
        shouldRetry = true;
        this.logger.warn("API key validation cache error", {
          operationId,
          error: error.message,
          recoveryAction: "continued_without_cache",
        });
        this.metrics.recordCounter("apikey.validator.cache_error", 1);
      }
      // Database connection errors - critical, suggest retry
      else if (error.message.includes("connection") || error.message.includes("timeout")) {
        errorMessage = "Database connection error, please try again";
        shouldRetry = true;
        this.logger.error("API key validation database error", {
          operationId,
          error: error.message,
          recoveryAction: "retry_recommended",
        });
        this.metrics.recordCounter("apikey.validator.connection_error", 1);
      }
      // bcrypt errors - critical security issue
      else if (error.message.includes("bcrypt")) {
        errorMessage = "Authentication system error";
        this.logger.error("API key validation bcrypt error", {
          operationId,
          error: error.message,
          securityImpact: "high",
        });
        this.metrics.recordCounter("apikey.validator.bcrypt_error", 1);
      }
      // JSON parsing errors - data corruption
      else if (error.message.includes("JSON") || error.message.includes("parse")) {
        errorMessage = "Data format error";
        this.logger.warn("API key validation JSON error", {
          operationId,
          error: error.message,
          dataIntegrity: "compromised",
        });
        this.metrics.recordCounter("apikey.validator.json_error", 1);
      } else {
        errorMessage = "Internal validation error";
        this.logger.error("API key validation unknown error", {
          operationId,
          error,
        });
        this.metrics.recordCounter("apikey.validator.unknown_error", 1);
      }
    }

    this.recordMetrics(startTime, false, "error");

    return {
      success: false,
      error: errorMessage,
      ...(shouldRetry && { retryable: true }),
    };
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const retryablePatterns = [
      "connection",
      "timeout",
      "cache",
      "redis",
      "network",
      "ECONNREFUSED",
      "ETIMEDOUT",
    ];

    return retryablePatterns.some(pattern => 
      error.message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Record validation metrics
   */
  private recordMetrics(startTime: number, success: boolean, source: string): void {
    const duration = performance.now() - startTime;
    
    this.metrics.recordTimer("apikey.validator.duration", duration);
    this.metrics.recordCounter("apikey.validator.validation", 1);
    this.metrics.recordCounter(`apikey.validator.${success ? 'success' : 'failure'}`, 1);
    this.metrics.recordCounter(`apikey.validator.source.${source}`, 1);
    
    // Record slow validation warnings
    if (duration > this.config.maxValidationTime) {
      this.logger.warn("Slow API key validation detected", {
        duration,
        maxValidationTime: this.config.maxValidationTime,
      });
      this.metrics.recordCounter("apikey.validator.slow_validation", 1);
    }
  }

  /**
   * Get validator health status
   */
  async healthCheck(): Promise<{ available: boolean; error?: string }> {
    try {
      // Test database connectivity
      await this.dbClient.query("SELECT 1");
      
      // Test cache if enabled
      if (this.config.enableCache && this.cacheManager) {
        const cacheHealth = await this.cacheManager.healthCheck();
        if (!cacheHealth.available) {
          this.logger.warn("Cache manager not available", {
            error: cacheHealth.error,
          });
        }
      }

      return { available: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Validator health check failed", { error });
      return { available: false, error: errorMessage };
    }
  }
}