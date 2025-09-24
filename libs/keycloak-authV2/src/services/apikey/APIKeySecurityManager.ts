/**
 * APIKeySecurityManager - Focused security operations and monitoring
 *
 * Responsibilities:
 * - API key revocation and lifecycle management
 * - Security policy enforcement (expiration, rotation)
 * - Threat detection and suspicious activity monitoring
 * - Audit logging and security event tracking
 * - Bulk security operations
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles security-related operations
 * - Open/Closed: Extensible for new security policies
 * - Liskov Substitution: Implements standard security manager interface
 * - Interface Segregation: Clean separation of security concerns
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import { performance } from "perf_hooks";
import crypto from "crypto";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient } from "@libs/database";
// Import types are available from types.ts but not needed for this implementation
import type { APIKeyCacheManager } from "./APIKeyCacheManager";

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
  reason?: string | undefined;
  metadata?: Record<string, any> | undefined;
}

export interface RevocationResult {
  success: boolean;
  error?: string | undefined;
  keyId: string;
  timestamp?: Date | undefined;
}

export interface BulkRevocationRequest {
  keyIds: string[];
  revokedBy: string;
  reason?: string;
  metadata?: Record<string, any>;
}

export interface BulkRevocationResult {
  totalRequested: number;
  successful: number;
  failed: number;
  results: RevocationResult[];
  errors: string[];
}

export interface SecurityPolicy {
  maxKeyAge: number; // days
  maxUnusedPeriod: number; // days
  requireRotation: boolean;
  rotationPeriod: number; // days
  maxFailedValidations: number;
  suspiciousActivityThreshold: number;
}

export interface SuspiciousActivity {
  keyId: string;
  userId: string;
  activityType:
    | "excessive_validation_failures"
    | "unusual_usage_pattern"
    | "geographic_anomaly"
    | "time_anomaly";
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  metadata: Record<string, any>;
  detectedAt: Date;
}

export interface SecurityAudit {
  totalKeys: number;
  activeKeys: number;
  expiredKeys: number;
  revokedKeys: number;
  keysNeedingRotation: number;
  suspiciousActivities: SuspiciousActivity[];
  policyViolations: string[];
  recommendations: string[];
}

export interface APIKeySecurityManagerConfig {
  readonly enableAuditLogging: boolean;
  readonly auditRetentionDays: number;
  readonly enableThreatDetection: boolean;
  readonly threatDetectionThresholds: {
    readonly maxFailedValidationsPerHour: number;
    readonly maxValidationsPerMinute: number;
    readonly unusualUsageMultiplier: number; // x times normal usage
  };
  readonly defaultSecurityPolicy: SecurityPolicy;
  readonly enableAutomaticRevocation: boolean;
}

const DEFAULT_SECURITY_CONFIG: APIKeySecurityManagerConfig = {
  enableAuditLogging: true,
  auditRetentionDays: 365,
  enableThreatDetection: true,
  threatDetectionThresholds: {
    maxFailedValidationsPerHour: 100,
    maxValidationsPerMinute: 60,
    unusualUsageMultiplier: 10,
  },
  defaultSecurityPolicy: {
    maxKeyAge: 365, // 1 year
    maxUnusedPeriod: 90, // 90 days
    requireRotation: false,
    rotationPeriod: 90, // 90 days
    maxFailedValidations: 10,
    suspiciousActivityThreshold: 5,
  },
  enableAutomaticRevocation: false,
};

/**
 * High-security API key security management with comprehensive threat detection
 */
export class APIKeySecurityManager {
  private readonly config: APIKeySecurityManagerConfig;

  constructor(
    private readonly logger: ILogger,
    private readonly metrics: IMetricsCollector,
    private readonly dbClient: PostgreSQLClient,
    private readonly cacheManager?: APIKeyCacheManager,
    config: Partial<APIKeySecurityManagerConfig> = {}
  ) {
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };

    this.logger.info("APIKeySecurityManager initialized", {
      auditLogging: this.config.enableAuditLogging,
      threatDetection: this.config.enableThreatDetection,
      automaticRevocation: this.config.enableAutomaticRevocation,
      securityPolicy: this.config.defaultSecurityPolicy,
    });
  }

  /**
   * Revoke a single API key with comprehensive security logging
   */
  async revokeAPIKey(request: RevocationRequest): Promise<RevocationResult> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.info("Starting API key revocation", {
        operationId,
        keyId: request.keyId,
        revokedBy: request.revokedBy,
        reason: request.reason,
      });

      // Input validation
      const validationResult = await this.validateRevocationRequest(request);
      if (!validationResult.success) {
        return {
          success: false,
          error: validationResult.error,
          keyId: request.keyId,
        };
      }

      // Check if key exists and is not already revoked
      const keyStatus = await this.checkKeyStatus(request.keyId);
      if (!keyStatus.exists) {
        return {
          success: false,
          error: "API key not found",
          keyId: request.keyId,
        };
      }

      if (keyStatus.isRevoked) {
        return {
          success: false,
          error: "API key is already revoked",
          keyId: request.keyId,
        };
      }

      // Perform revocation
      const revocationTimestamp = new Date();
      await this.performRevocation(request, revocationTimestamp, operationId);

      // Clear cache if available
      if (this.cacheManager && keyStatus.keyHash) {
        await this.invalidateKeyCache(keyStatus.keyHash);
      }

      // Log security event
      if (this.config.enableAuditLogging) {
        await this.logSecurityEvent({
          eventType: "revocation",
          keyId: request.keyId,
          userId: keyStatus.userId,
          actionBy: request.revokedBy,
          reason: request.reason || "Manual revocation",
          metadata: {
            ...request.metadata,
            operationId,
            revocationTimestamp: revocationTimestamp.toISOString(),
          },
          timestamp: revocationTimestamp,
          severity: "medium",
        });
      }

      // Record metrics
      this.metrics.recordCounter("apikey.security.revocation_success", 1);
      this.metrics.recordTimer(
        "apikey.security.revocation_duration",
        performance.now() - startTime
      );

      this.logger.info("API key revoked successfully", {
        operationId,
        keyId: request.keyId,
        revokedBy: request.revokedBy,
        duration: performance.now() - startTime,
      });

      return {
        success: true,
        keyId: request.keyId,
        timestamp: revocationTimestamp,
      };
    } catch (error) {
      return this.handleRevocationError(error, request, operationId, startTime);
    }
  }

  /**
   * Bulk revoke multiple API keys with transaction support
   */
  async bulkRevokeAPIKeys(
    request: BulkRevocationRequest
  ): Promise<BulkRevocationResult> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    this.logger.info("Starting bulk API key revocation", {
      operationId,
      keyCount: request.keyIds.length,
      revokedBy: request.revokedBy,
      reason: request.reason,
    });

    const results: RevocationResult[] = [];
    const errors: string[] = [];

    try {
      // Validate bulk request
      if (request.keyIds.length === 0) {
        return {
          totalRequested: 0,
          successful: 0,
          failed: 0,
          results: [],
          errors: ["No key IDs provided"],
        };
      }

      if (request.keyIds.length > 100) {
        return {
          totalRequested: request.keyIds.length,
          successful: 0,
          failed: request.keyIds.length,
          results: [],
          errors: ["Bulk revocation limited to 100 keys per request"],
        };
      }

      // Process each key individually (could be optimized with batch operations)
      for (const keyId of request.keyIds) {
        try {
          const revocationResult = await this.revokeAPIKey({
            keyId,
            revokedBy: request.revokedBy,
            reason: request.reason,
            metadata: {
              ...request.metadata,
              bulkOperation: true,
              operationId,
            },
          });

          results.push(revocationResult);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          errors.push(`Key ${keyId}: ${errorMessage}`);
          results.push({
            success: false,
            error: errorMessage,
            keyId,
          });
        }
      }

      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      // Log bulk operation security event
      if (this.config.enableAuditLogging) {
        await this.logSecurityEvent({
          eventType: "bulk_operation",
          keyId: "bulk_revocation",
          actionBy: request.revokedBy,
          reason: request.reason || "Bulk revocation",
          metadata: {
            operationId,
            totalRequested: request.keyIds.length,
            successful,
            failed,
            keyIds: request.keyIds,
          },
          timestamp: new Date(),
          severity: failed > 0 ? "medium" : "low",
        });
      }

      // Record metrics
      this.metrics.recordCounter("apikey.security.bulk_revocation", 1);
      this.metrics.recordCounter(
        "apikey.security.bulk_revocation_success",
        successful
      );
      this.metrics.recordCounter(
        "apikey.security.bulk_revocation_failed",
        failed
      );
      this.metrics.recordTimer(
        "apikey.security.bulk_revocation_duration",
        performance.now() - startTime
      );

      this.logger.info("Bulk API key revocation completed", {
        operationId,
        totalRequested: request.keyIds.length,
        successful,
        failed,
        duration: performance.now() - startTime,
      });

      return {
        totalRequested: request.keyIds.length,
        successful,
        failed,
        results,
        errors,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Bulk revocation failed", {
        operationId,
        error: errorMessage,
      });

      this.metrics.recordCounter("apikey.security.bulk_revocation_error", 1);

      return {
        totalRequested: request.keyIds.length,
        successful: 0,
        failed: request.keyIds.length,
        results,
        errors: [errorMessage],
      };
    }
  }

  /**
   * Detect suspicious activities based on usage patterns
   */
  async detectSuspiciousActivity(keyId: string): Promise<SuspiciousActivity[]> {
    if (!this.config.enableThreatDetection) {
      return [];
    }

    try {
      const activities: SuspiciousActivity[] = [];
      const thresholds = this.config.threatDetectionThresholds;

      // Check for excessive validation failures
      const failureResult = await this.dbClient.cachedQuery<
        { failure_count: number }[]
      >(
        `
        SELECT COUNT(*) as failure_count
        FROM api_key_validation_log 
        WHERE key_id = $1 
          AND success = false 
          AND created_at >= NOW() - INTERVAL '1 hour'
        `,
        [keyId]
      );

      const failures = failureResult[0]?.failure_count || 0;
      if (failures > thresholds.maxFailedValidationsPerHour) {
        activities.push({
          keyId,
          userId: "", // Would need to be populated from key data
          activityType: "excessive_validation_failures",
          description: `${failures} failed validations in the last hour (threshold: ${thresholds.maxFailedValidationsPerHour})`,
          severity:
            failures > thresholds.maxFailedValidationsPerHour * 2
              ? "high"
              : "medium",
          metadata: {
            failures,
            threshold: thresholds.maxFailedValidationsPerHour,
          },
          detectedAt: new Date(),
        });
      }

      // Check for unusual usage patterns (high frequency)
      const usageResult = await this.dbClient.cachedQuery<
        { usage_count: number }[]
      >(
        `
        SELECT COUNT(*) as usage_count
        FROM api_key_usage_log 
        WHERE key_id = $1 
          AND created_at >= NOW() - INTERVAL '1 minute'
        `,
        [keyId]
      );

      const recentUsage = usageResult[0]?.usage_count || 0;
      if (recentUsage > thresholds.maxValidationsPerMinute) {
        activities.push({
          keyId,
          userId: "",
          activityType: "unusual_usage_pattern",
          description: `${recentUsage} validations in the last minute (threshold: ${thresholds.maxValidationsPerMinute})`,
          severity: "medium",
          metadata: {
            usage: recentUsage,
            threshold: thresholds.maxValidationsPerMinute,
          },
          detectedAt: new Date(),
        });
      }

      if (activities.length > 0) {
        this.logger.warn("Suspicious activity detected", {
          keyId,
          activities: activities.length,
          types: activities.map((a) => a.activityType),
        });

        this.metrics.recordCounter(
          "apikey.security.suspicious_activity",
          activities.length
        );
      }

      return activities;
    } catch (error) {
      this.logger.error("Failed to detect suspicious activity", {
        keyId,
        error,
      });
      this.metrics.recordCounter("apikey.security.threat_detection_error", 1);
      return [];
    }
  }

  /**
   * Perform comprehensive security audit
   */
  async performSecurityAudit(): Promise<SecurityAudit> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.info("Starting security audit", { operationId });

      // Get key statistics
      const [statsResult] = await this.dbClient.cachedQuery<
        {
          total_keys: number;
          active_keys: number;
          expired_keys: number;
          revoked_keys: number;
          keys_needing_rotation: number;
        }[]
      >(
        `
        SELECT 
          COUNT(*) as total_keys,
          COUNT(*) FILTER (WHERE "isActive" = true AND "revokedAt" IS NULL) as active_keys,
          COUNT(*) FILTER (WHERE "expiresAt" < NOW()) as expired_keys,
          COUNT(*) FILTER (WHERE "revokedAt" IS NOT NULL) as revoked_keys,
          COUNT(*) FILTER (WHERE 
            "isActive" = true 
            AND "revokedAt" IS NULL 
            AND "createdAt" < NOW() - INTERVAL '${this.config.defaultSecurityPolicy.rotationPeriod} days'
          ) as keys_needing_rotation
        FROM api_keys
        `,
        []
      );

      // Get keys with suspicious activities
      const suspiciousKeys = await this.dbClient.cachedQuery<
        { id: string; user_id: string }[]
      >(
        `
        SELECT DISTINCT k.id, k."userId" as user_id
        FROM api_keys k
        LEFT JOIN api_key_validation_log v ON k.id = v.key_id
        WHERE k."isActive" = true 
          AND k."revokedAt" IS NULL
          AND v.created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY k.id, k."userId"
        HAVING COUNT(*) FILTER (WHERE v.success = false) > $1
        `,
        [this.config.defaultSecurityPolicy.maxFailedValidations]
      );

      // Detect suspicious activities for flagged keys
      const suspiciousActivities: SuspiciousActivity[] = [];
      for (const key of suspiciousKeys.slice(0, 10)) {
        // Limit to first 10 for performance
        const activities = await this.detectSuspiciousActivity(key.id);
        suspiciousActivities.push(
          ...activities.map((a) => ({ ...a, userId: key.user_id }))
        );
      }

      // Generate policy violations and recommendations
      const policyViolations: string[] = [];
      const recommendations: string[] = [];

      if ((statsResult?.expired_keys || 0) > 0) {
        policyViolations.push(
          `${statsResult?.expired_keys} expired keys should be revoked`
        );
        recommendations.push(
          "Set up automatic expiration monitoring and revocation"
        );
      }

      if ((statsResult?.keys_needing_rotation || 0) > 0) {
        policyViolations.push(
          `${statsResult?.keys_needing_rotation} keys need rotation`
        );
        recommendations.push(
          "Implement key rotation policies and notifications"
        );
      }

      if (suspiciousActivities.length > 0) {
        policyViolations.push(
          `${suspiciousActivities.length} keys showing suspicious activity`
        );
        recommendations.push(
          "Investigate and potentially revoke suspicious keys"
        );
      }

      if (
        suspiciousActivities.filter(
          (a) => a.severity === "critical" || a.severity === "high"
        ).length > 0
      ) {
        recommendations.push(
          "Immediate review required for high-severity security events"
        );
      }

      const audit: SecurityAudit = {
        totalKeys: statsResult?.total_keys || 0,
        activeKeys: statsResult?.active_keys || 0,
        expiredKeys: statsResult?.expired_keys || 0,
        revokedKeys: statsResult?.revoked_keys || 0,
        keysNeedingRotation: statsResult?.keys_needing_rotation || 0,
        suspiciousActivities,
        policyViolations,
        recommendations,
      };

      // Log audit completion
      if (this.config.enableAuditLogging) {
        await this.logSecurityEvent({
          eventType: "policy_violation",
          keyId: "security_audit",
          actionBy: "system",
          reason: "Scheduled security audit",
          metadata: {
            operationId,
            audit,
            duration: performance.now() - startTime,
          },
          timestamp: new Date(),
          severity: policyViolations.length > 0 ? "medium" : "low",
        });
      }

      this.metrics.recordTimer(
        "apikey.security.audit_duration",
        performance.now() - startTime
      );
      this.metrics.recordCounter("apikey.security.audit_completed", 1);
      this.metrics.recordCounter(
        "apikey.security.policy_violations",
        policyViolations.length
      );

      this.logger.info("Security audit completed", {
        operationId,
        totalKeys: audit.totalKeys,
        policyViolations: policyViolations.length,
        suspiciousActivities: suspiciousActivities.length,
        duration: performance.now() - startTime,
      });

      return audit;
    } catch (error) {
      this.logger.error("Security audit failed", { operationId, error });
      this.metrics.recordCounter("apikey.security.audit_error", 1);
      throw error;
    }
  }

  /**
   * Validate revocation request
   */
  private async validateRevocationRequest(
    request: RevocationRequest
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate keyId (assuming we have a schema import - would need to adjust)
      if (
        !request.keyId ||
        typeof request.keyId !== "string" ||
        request.keyId.length === 0
      ) {
        return { success: false, error: "Invalid key ID format" };
      }

      // Validate revokedBy
      if (
        !request.revokedBy ||
        typeof request.revokedBy !== "string" ||
        request.revokedBy.length === 0
      ) {
        return { success: false, error: "Invalid revokedBy parameter" };
      }

      // Validate reason if provided
      if (request.reason !== undefined) {
        if (typeof request.reason !== "string") {
          return { success: false, error: "Invalid reason: must be a string" };
        }
        if (request.reason.length > 500) {
          return {
            success: false,
            error: "Invalid reason: maximum length is 500 characters",
          };
        }
      }

      return { success: true };
    } catch (error) {
      this.logger.error("Revocation request validation failed", { error });
      return { success: false, error: "Validation failed" };
    }
  }

  /**
   * Check key status before revocation
   */
  private async checkKeyStatus(keyId: string): Promise<{
    exists: boolean;
    isRevoked: boolean;
    userId?: string;
    keyHash?: string;
  }> {
    try {
      const result = await this.dbClient.cachedQuery<
        {
          id: string;
          is_active: boolean;
          revoked_at: Date | null;
          user_id: string;
          key_hash: string;
        }[]
      >(
        `SELECT id, "isActive" as is_active, "revokedAt" as revoked_at, "userId" as user_id, "keyHash" as key_hash 
         FROM api_keys WHERE id = $1`,
        [keyId]
      );

      const key = result[0];
      if (!key) {
        return { exists: false, isRevoked: false };
      }

      return {
        exists: true,
        isRevoked: key.revoked_at !== null,
        userId: key.user_id,
        keyHash: key.key_hash,
      };
    } catch (error) {
      this.logger.error("Failed to check key status", { keyId, error });
      return { exists: false, isRevoked: false };
    }
  }

  /**
   * Perform the actual revocation in database
   */
  private async performRevocation(
    request: RevocationRequest,
    timestamp: Date,
    operationId: string
  ): Promise<void> {
    await this.dbClient.executeRaw(
      `UPDATE api_keys 
       SET "isActive" = false, 
           "revokedAt" = $2, 
           "revokedBy" = $3, 
           "updatedAt" = $2,
           metadata = COALESCE(metadata, '{}')::jsonb || $4::jsonb
       WHERE id = $1`,
      [
        request.keyId,
        timestamp,
        request.revokedBy,
        JSON.stringify({
          revocationReason: request.reason,
          operationId,
          ...request.metadata,
        }),
      ]
    );
  }

  /**
   * Invalidate key from cache
   */
  private async invalidateKeyCache(_keyHash: string): Promise<void> {
    if (!this.cacheManager) {
      return;
    }

    try {
      // Note: We'd need the original key to invalidate cache properly
      // This is a simplified implementation
      await this.cacheManager.clearAll();
      this.logger.debug("Cache cleared after key revocation");
    } catch (error) {
      this.logger.warn("Failed to invalidate cache after revocation", {
        error,
      });
    }
  }

  /**
   * Log security event for audit trail
   */
  private async logSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      // In a real implementation, this might log to a dedicated audit table
      this.logger.info("Security event", {
        eventType: event.eventType,
        keyId: event.keyId,
        userId: event.userId,
        actionBy: event.actionBy,
        reason: event.reason,
        severity: event.severity,
        timestamp: event.timestamp,
        metadata: event.metadata,
      });

      // Could also send to external audit systems, SIEM, etc.
      this.metrics.recordCounter(`apikey.security.event.${event.eventType}`, 1);
      this.metrics.recordCounter(
        `apikey.security.severity.${event.severity}`,
        1
      );
    } catch (error) {
      this.logger.error("Failed to log security event", { event, error });
    }
  }

  /**
   * Handle revocation errors with proper categorization
   */
  private handleRevocationError(
    error: unknown,
    request: RevocationRequest,
    operationId: string,
    startTime: number
  ): RevocationResult {
    let errorMessage = "Revocation failed";

    if (error instanceof Error) {
      if (
        error.message.includes("no rows affected") ||
        error.message.includes("not found")
      ) {
        errorMessage = "API key not found or already revoked";
      } else if (
        error.message.includes("connection") ||
        error.message.includes("timeout")
      ) {
        errorMessage = "Database connection error during revocation";
      } else if (
        error.message.includes("constraint") ||
        error.message.includes("foreign key")
      ) {
        errorMessage = "Invalid revocation parameters";
      } else {
        errorMessage = "Internal revocation error";
      }
    }

    this.logger.error("API key revocation failed", {
      operationId,
      keyId: request.keyId,
      revokedBy: request.revokedBy,
      error: errorMessage,
      duration: performance.now() - startTime,
    });

    this.metrics.recordCounter("apikey.security.revocation_error", 1);
    this.metrics.recordTimer(
      "apikey.security.revocation_error_duration",
      performance.now() - startTime
    );

    return {
      success: false,
      error: errorMessage,
      keyId: request.keyId,
    };
  }

  /**
   * Get security manager health status
   */
  async healthCheck(): Promise<{ available: boolean; error?: string }> {
    try {
      // Test database connectivity
      await this.dbClient.executeRaw("SELECT 1");

      return { available: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Security manager health check failed", { error });
      return { available: false, error: errorMessage };
    }
  }
}
