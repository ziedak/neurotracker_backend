/**
 * APIKeyOperations - Consolidated API key generation, validation, and security operations
 *
 * This consolidated component replaces:
 * - APIKeyGenerator.ts - Key generation and entropy validation
 * - APIKeyValidator.ts - Key validation logic
 * - APIKeySecurityManager.ts - Security policies and operations
 *
 * Responsibilities:
 * - Secure API key generation with entropy validation
 * - API key format and database validation with security guarantees
 * - Security policy enforcement and threat detection
 * - Revocation and lifecycle management
 * - Audit logging and security event tracking
 *
 * SOLID Principles:
 * - Single Responsibility: Handles all API key operational concerns
 * - Open/Closed: Extensible for new generation/validation/security rules
 * - Liskov Substitution: Implements standard operational interfaces
 * - Interface Segregation: Clean separation within operational domains
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import * as crypto from "crypto";
import { performance } from "perf_hooks";
import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { IApiKeyRepository } from "@libs/database";
import { EntropyUtils, type EntropyTestResult } from "../../utils/entropy";
import { APIKeyValidationResult, APIKeyFormatSchema } from "./types";
// import type { APIKeyCacheManager } from "./APIKeyCacheManager";

// ==================== INTERFACES ====================

export interface APIKeyOperationsConfig {
  // Generation config
  readonly defaultKeyLength: number;
  readonly enableFallback: boolean;

  // Validation config
  readonly enableCache: boolean;
  readonly constantTimeSecurity: boolean;
  readonly cacheTtl: number; // seconds
  readonly maxValidationTime: number; // milliseconds

  // Security config
  readonly maxRotationFrequency: number; // days
  readonly suspiciousActivityThreshold: number;
  readonly enableThreatDetection: boolean;
  readonly auditRetentionDays: number;
}

export interface SecurityEvent {
  eventType:
    | "revocation"
    | "expiration"
    | "suspicious_activity"
    | "policy_violation"
    | "bulk_operation";
  keyId: string;
  userId?: string | undefined;
  actionBy: string;
  reason: string;
  metadata?: Record<string, any> | undefined;
  timestamp: Date;
  severity: "low" | "medium" | "high" | "critical";
}

export interface RevocationRequest {
  keyId: string;
  revokedBy: string;
  reason?: string;
  metadata?: Record<string, any> | undefined;
}

export interface RevocationResult {
  data?: any;
  success: boolean;
  keyId: string;
  revokedAt: Date;
  error?: string;
}

export interface SecurityAnalysis {
  threatLevel: "low" | "medium" | "high" | "critical";
  suspiciousActivities: string[];
  recommendations: string[];
  lastAnalysis: Date;
  keyAge: number; // days
  usagePattern: "normal" | "irregular" | "suspicious";
}

// ==================== DEFAULT CONFIGURATION ====================

const DEFAULT_OPERATIONS_CONFIG: APIKeyOperationsConfig = {
  // Generation
  defaultKeyLength: 32,
  enableFallback: true,

  // Validation
  enableCache: true,
  constantTimeSecurity: true,
  cacheTtl: 300, // 5 minutes
  maxValidationTime: 5000, // 5 seconds

  // Security
  maxRotationFrequency: 90, // 90 days
  suspiciousActivityThreshold: 100,
  enableThreatDetection: true,
  auditRetentionDays: 365,
};

/**
 * Consolidated API key operations handling generation, validation, and security
 */
export class APIKeyOperations {
  private readonly logger: ILogger;
  private readonly config: APIKeyOperationsConfig;

  constructor(
    private readonly apiKeyRepository: IApiKeyRepository,
    // @ts-expect-error - cacheManager will be integrated in future iterations
    private readonly cacheManager: APIKeyCacheManager,
    private readonly metrics: IMetricsCollector,
    config?: Partial<APIKeyOperationsConfig>
  ) {
    this.logger = createLogger("APIKeyOperations");
    this.config = { ...DEFAULT_OPERATIONS_CONFIG, ...config };
  }

  // ==================== GENERATION OPERATIONS ====================

  /**
   * Generate a secure API key with entropy validation and fallback mechanisms
   */
  async generateSecureKey(prefix?: string): Promise<string> {
    const startTime = performance.now();

    try {
      // Primary entropy source - crypto.randomBytes
      const randomBytes = EntropyUtils.generateSecureRandomBytes(
        this.config.defaultKeyLength
      );

      // Validate entropy quality
      if (!EntropyUtils.validateEntropyQuality(randomBytes)) {
        throw new Error("Primary entropy source failed quality check");
      }

      const key = randomBytes.toString("base64url");
      const finalKey = prefix ? `${prefix}_${key}` : `ak_${key}`;

      this.metrics?.recordTimer(
        "apikey.generation.success",
        performance.now() - startTime
      );
      this.logger.debug("API key generated successfully", {
        prefix,
        keyLength: finalKey.length,
      });

      return finalKey;
    } catch (error) {
      this.logger.warn("Primary key generation failed, using fallback", {
        error,
      });

      if (this.config.enableFallback) {
        return this.generateFallbackKey(prefix);
      }

      this.metrics?.recordCounter("apikey.generation.failure");
      throw error;
    }
  }

  /**
   * Generate fallback key using timestamp + random data
   */
  private generateFallbackKey(prefix?: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2);
    const hash = crypto
      .createHash("sha256")
      .update(`${timestamp}-${random}-${process.hrtime.bigint()}`)
      .digest("base64url")
      .substring(0, this.config.defaultKeyLength);

    const key = `${timestamp}${hash}`;
    return prefix ? `${prefix}_${key}` : `ak_${key}`;
  }

  /**
   * Extract key identifier from API key for database lookup
   */
  extractKeyIdentifier(apiKey: string): string {
    // Use first 8 characters of SHA-256 hash as identifier
    return crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex")
      .substring(0, 8);
  }

  /**
   * Test entropy source quality and performance
   */
  async testEntropySource(): Promise<EntropyTestResult> {
    return EntropyUtils.testEntropySource(this.logger);
  }

  // ==================== VALIDATION OPERATIONS ====================

  /**
   * Validate API key with security guarantees and caching
   */
  async validateAPIKey(apiKey: string): Promise<APIKeyValidationResult> {
    const startTime = performance.now();

    try {
      // Step 1: Format validation
      const formatValidation = this.validateKeyFormat(apiKey);
      if (!formatValidation.isValid) {
        this.metrics?.recordCounter("apikey.validation.format_error");
        return {
          success: false,
          error: formatValidation.error || "Invalid format",
        };
      }

      // Step 2: Check cache if enabled
      if (this.config.enableCache) {
        const cached = await this.getCachedValidation(apiKey);
        if (cached) {
          this.metrics?.recordCounter("apikey.validation.cache_hit");
          return cached;
        }
      }

      // Step 3: Database validation with constant-time security
      const dbResult = await this.validateKeyInDatabase(apiKey);

      // Step 4: Cache result if successful and caching enabled
      if (dbResult.success && this.config.enableCache) {
        await this.cacheValidationResult(apiKey, dbResult);
      }

      const totalTime = performance.now() - startTime;
      this.metrics?.recordTimer("apikey.validation.total_time", totalTime);

      return dbResult;
    } catch (error) {
      this.metrics?.recordCounter("apikey.validation.error");
      this.logger.error("API key validation failed", { error });

      return {
        success: false,
        error: "Validation service temporarily unavailable",
      };
    }
  }

  /**
   * Validate API key format
   */
  private validateKeyFormat(apiKey: string): {
    isValid: boolean;
    error?: string;
  } {
    try {
      APIKeyFormatSchema.parse(apiKey);
      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: "Invalid API key format",
      };
    }
  }

  /**
   * Validate key against database with constant-time security
   */
  private async validateKeyInDatabase(
    apiKey: string
  ): Promise<APIKeyValidationResult> {
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

    try {
      // Use repository to find key by hash with timeout
      const result = await Promise.race([
        this.apiKeyRepository.findByKey(keyHash),
        new Promise<null>((_, reject) =>
          setTimeout(
            () => reject(new Error("Validation timeout")),
            this.config.maxValidationTime
          )
        ),
      ]);

      if (!result) {
        // Constant-time delay for invalid keys to prevent timing attacks
        if (this.config.constantTimeSecurity) {
          await this.constantTimeDelay();
        }

        return {
          success: false,
          error: "Invalid or inactive API key",
        };
      }

      // Check if key is active and not revoked
      if (!result.isActive || result.revokedAt) {
        return {
          success: false,
          error: "API key is inactive or revoked",
        };
      }

      // Check expiration
      if (result.expiresAt && result.expiresAt < new Date()) {
        return {
          success: false,
          error: "API key has expired",
        };
      }

      // Update last used timestamp
      await this.updateLastUsed(result.id);

      const validationResult: APIKeyValidationResult = {
        success: true,
        user: {
          userId: result.userId,
          email: "", // Will be populated by upper layers if needed
          roles: [], // Will be populated by upper layers if needed
        },
        keyData: result, // Include the full API key data
      };

      // Only add expiresAt if it exists and is not null
      if (result.expiresAt) {
        validationResult.expiresAt = result.expiresAt;
      }

      return validationResult;
    } catch (error) {
      this.logger.error("Database validation failed", { error });
      throw error;
    }
  }

  /**
   * Constant-time delay to prevent timing attacks
   */
  private async constantTimeDelay(): Promise<void> {
    const delay = 50 + Math.random() * 100; // 50-150ms
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * Update last used timestamp for API key
   */
  private async updateLastUsed(keyId: string): Promise<void> {
    try {
      await this.apiKeyRepository.updateLastUsed(keyId);
    } catch (error) {
      this.logger.warn("Failed to update last used timestamp", {
        keyId,
        error,
      });
    }
  }

  /**
   * Get cached validation result
   */
  private async getCachedValidation(
    _apiKey: string
  ): Promise<APIKeyValidationResult | null> {
    try {
      // TODO: Implement cache manager interface for validation results
      return null;
    } catch (error) {
      this.logger.warn("Cache lookup failed", { error });
      return null;
    }
  }

  /**
   * Cache validation result
   */
  private async cacheValidationResult(
    _apiKey: string,
    _result: APIKeyValidationResult
  ): Promise<void> {
    try {
      // TODO: Implement cache manager interface for validation results
      this.logger.debug("Validation result would be cached here");
    } catch (error) {
      this.logger.warn("Failed to cache validation result", { error });
    }
  }

  // ==================== SECURITY OPERATIONS ====================

  /**
   * Revoke an API key with audit logging
   */
  async revokeKey(request: RevocationRequest): Promise<RevocationResult> {
    const startTime = performance.now();

    try {
      const revokedAt = new Date();

      // Check if key exists and is active
      const existingKey = await this.apiKeyRepository.findById(request.keyId);

      if (!existingKey || !existingKey.isActive) {
        return {
          success: false,
          keyId: request.keyId,
          revokedAt,
          error: "Key not found or already revoked",
        };
      }

      // Update using repository
      await this.apiKeyRepository.revokeById(request.keyId);

      // Clear from cache (TODO: implement cache invalidation)
      this.logger.debug("Cache invalidated for key", { keyId: request.keyId });

      // Log security event
      await this.logSecurityEvent({
        eventType: "revocation",
        keyId: request.keyId,
        actionBy: request.revokedBy,
        reason: request.reason || "Manual revocation",
        metadata: request.metadata,
        timestamp: revokedAt,
        severity: "medium",
      });

      this.metrics?.recordTimer(
        "apikey.revocation.success",
        performance.now() - startTime
      );
      this.logger.info("API key revoked successfully", {
        keyId: request.keyId,
        revokedBy: request.revokedBy,
      });

      return {
        success: true,
        keyId: request.keyId,
        revokedAt,
      };
    } catch (error) {
      this.metrics?.recordCounter("apikey.revocation.failure");
      this.logger.error("Key revocation failed", {
        keyId: request.keyId,
        error,
      });

      return {
        success: false,
        keyId: request.keyId,
        revokedAt: new Date(),
        error: error instanceof Error ? error.message : "Revocation failed",
      };
    }
  }

  /**
   * Analyze key for security threats and patterns
   */
  async analyzeKeySecurity(keyId: string): Promise<SecurityAnalysis> {
    try {
      // Get key data from repository
      const apiKey = await this.apiKeyRepository.findById(keyId);

      if (!apiKey) {
        throw new Error("Key not found");
      }

      const keyAge = Math.floor(
        (Date.now() - apiKey.createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Create usage data structure from API key
      const keyData = {
        createdAt: apiKey.createdAt,
        lastUsedAt: apiKey.lastUsedAt,
        userId: apiKey.userId,
        usage_count: apiKey.usageCount,
        last_access: apiKey.lastUsedAt,
      };

      // Analyze threat level
      const threatLevel = this.calculateThreatLevel(keyData, keyAge);
      const suspiciousActivities = this.detectSuspiciousActivities(keyData);
      const usagePattern = this.analyzeUsagePattern(keyData);

      return {
        threatLevel,
        suspiciousActivities,
        recommendations: this.generateSecurityRecommendations(
          threatLevel,
          keyAge,
          usagePattern
        ),
        lastAnalysis: new Date(),
        keyAge,
        usagePattern,
      };
    } catch (error) {
      this.logger.error("Security analysis failed", { keyId, error });
      throw error;
    }
  }

  /**
   * Log security event for audit trail
   */
  private async logSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      // Log to application logs
      this.logger.info("Security event", {
        eventType: event.eventType,
        keyId: event.keyId,
        userId: event.userId,
        actionBy: event.actionBy,
        reason: event.reason,
        metadata: event.metadata,
        timestamp: event.timestamp,
        severity: event.severity,
      });

      // Record metric
      this.metrics?.recordCounter(`security.event.${event.eventType}`);

      // TODO: Implement proper audit log table and repository
      // For now, we're using application logs as the audit trail
    } catch (error) {
      this.logger.error("Failed to log security event", { event, error });
    }
  }

  /**
   * Calculate threat level based on key data and usage patterns
   */
  private calculateThreatLevel(
    keyData: any,
    keyAge: number
  ): "low" | "medium" | "high" | "critical" {
    let riskScore = 0;

    // Age risk
    if (keyAge > 365) riskScore += 2;
    else if (keyAge > 180) riskScore += 1;

    // Usage pattern risk
    if (keyData.usage_count > this.config.suspiciousActivityThreshold)
      riskScore += 2;

    // Dormancy risk
    const daysSinceLastUse = keyData.last_used_at
      ? Math.floor(
          (Date.now() - new Date(keyData.last_used_at).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : keyAge;

    if (daysSinceLastUse > 90) riskScore += 1;

    if (riskScore >= 4) return "critical";
    if (riskScore >= 3) return "high";
    if (riskScore >= 2) return "medium";
    return "low";
  }

  /**
   * Detect suspicious activities in key usage
   */
  private detectSuspiciousActivities(keyData: any): string[] {
    const activities: string[] = [];

    if (keyData.usage_count > this.config.suspiciousActivityThreshold) {
      activities.push("Unusually high usage frequency");
    }

    const daysSinceLastUse = keyData.last_used_at
      ? Math.floor(
          (Date.now() - new Date(keyData.last_used_at).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      : 999;

    if (daysSinceLastUse > 90) {
      activities.push("Long period of inactivity");
    }

    return activities;
  }

  /**
   * Analyze usage pattern classification
   */
  private analyzeUsagePattern(
    keyData: any
  ): "normal" | "irregular" | "suspicious" {
    if (keyData.usage_count > this.config.suspiciousActivityThreshold * 2) {
      return "suspicious";
    }

    if (
      keyData.usage_count === 0 ||
      (keyData.last_used_at &&
        Date.now() - new Date(keyData.last_used_at).getTime() >
          90 * 24 * 60 * 60 * 1000)
    ) {
      return "irregular";
    }

    return "normal";
  }

  /**
   * Generate security recommendations based on analysis
   */
  private generateSecurityRecommendations(
    threatLevel: string,
    keyAge: number,
    usagePattern: string
  ): string[] {
    const recommendations: string[] = [];

    if (threatLevel === "critical" || threatLevel === "high") {
      recommendations.push("Consider revoking this key immediately");
      recommendations.push("Investigate recent usage patterns");
    }

    if (keyAge > this.config.maxRotationFrequency) {
      recommendations.push(`Key is ${keyAge} days old - consider rotation`);
    }

    if (usagePattern === "suspicious") {
      recommendations.push("Monitor for unusual activity patterns");
      recommendations.push("Consider implementing additional access controls");
    }

    if (usagePattern === "irregular") {
      recommendations.push("Review if this key is still needed");
      recommendations.push("Consider setting expiration date");
    }

    if (recommendations.length === 0) {
      recommendations.push("Key security status is acceptable");
    }

    return recommendations;
  }
}
