/**
 * API Key service types
 *
 * Consolidated type definitions for API Key management services
 */

import { z } from "zod";
import type { AuthResult, UserInfo } from "../shared/auth";
import type { ValidationResult, ValidationError } from "../shared/validation";
import type { SecurityAnalysis, SecurityEvent } from "../shared/security";
import type {
  HealthCheckResult,
  SystemHealth,
  PerformanceMetrics,
} from "../common";

/**
 * Core API Key interface
 */
export interface APIKey {
  readonly id: string;
  readonly name: string;
  readonly keyHash: string;
  readonly keyPreview: string;
  readonly userId: string;
  readonly storeId?: string;
  readonly permissions?: string[];
  readonly scopes: string[];
  readonly lastUsedAt?: Date;
  readonly usageCount: number;
  readonly isActive: boolean;
  readonly expiresAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly revokedAt?: Date;
  readonly revokedBy?: string;
  readonly metadata?: Record<string, any>;
}

/**
 * API Key generation options
 */
export interface APIKeyGenerationOptions {
  readonly userId: string;
  readonly name?: string;
  readonly storeId?: string;
  readonly scopes?: string[];
  readonly permissions?: string[];
  readonly expirationDate?: Date;
  readonly prefix?: string;
  readonly metadata?: Record<string, any>;
}

/**
 * API Key validation result
 */
export interface APIKeyValidationResult extends AuthResult {
  readonly keyId?: string;
  readonly keyData?: APIKey;
  readonly retryable?: boolean;
}

/**
 * API Key generation result
 */
export interface GenerationResult {
  readonly success: boolean;
  readonly apiKey?: string;
  readonly keyData?: APIKey;
  readonly error?: string;
}

/**
 * API Key revocation request
 */
export interface RevocationRequest {
  readonly keyId: string;
  readonly revokedBy: string;
  readonly reason?: string;
  readonly metadata?: Record<string, any>;
}

/**
 * API Key revocation result
 */
export interface RevocationResult {
  readonly success: boolean;
  readonly keyId: string;
  readonly revokedAt: Date;
  readonly error?: string;
  readonly recoverable?: boolean;
}

/**
 * API Key manager statistics
 */
export interface APIKeyManagerStats {
  readonly totalKeys: number;
  readonly activeKeys: number;
  readonly expiredKeys: number;
  readonly revokedKeys: number;
  readonly validationsToday: number;
  readonly cacheHitRate: number;
  readonly lastResetAt: Date;
}

/**
 * Storage operation result wrapper
 */
export interface StorageResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly fromCache?: boolean;
  readonly executionTime?: number;
}

/**
 * Monitoring operation result wrapper
 */
export interface MonitoringResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly timestamp: Date;
  readonly duration: number;
}

/**
 * Usage statistics interface
 */
export interface UsageStats {
  readonly keyId: string;
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly averageResponseTime: number;
  readonly lastUsed: Date;
  readonly usagePattern: {
    readonly hourly: number[];
    readonly daily: number[];
    readonly weekly: number[];
  };
}

/**
 * Entropy test result
 */
export interface EntropyTestResult {
  readonly status: "healthy" | "degraded" | "failed";
  readonly score: number;
  readonly details: {
    readonly sourceAvailable: boolean;
    readonly qualityScore: number;
    readonly distributionTest: boolean;
    readonly repetitionTest: boolean;
    readonly testDuration: number;
  };
}

/**
 * API Key operations configuration
 */
export interface APIKeyOperationsConfig {
  readonly defaultKeyLength: number;
  readonly enableFallback: boolean;
  readonly enableCache: boolean;
  readonly constantTimeSecurity: boolean;
  readonly cacheTtl: number;
  readonly maxValidationTime: number;
  readonly maxRotationFrequency: number;
  readonly suspiciousActivityThreshold: number;
  readonly enableThreatDetection: boolean;
  readonly auditRetentionDays: number;
}

/**
 * API Key storage configuration
 */
export interface APIKeyStorageConfig {
  readonly enableTransactions: boolean;
  readonly queryTimeout: number;
  readonly retryAttempts: number;
  readonly retryDelay: number;
  readonly enableCache: boolean;
  readonly cacheTtl: number;
  readonly maxCacheEntries: number;
  readonly cleanupThreshold: number;
  readonly cleanupBatchSize: number;
  readonly enableCacheIntegrity: boolean;
  readonly maxKeyLength: number;
  readonly enableAuditLogging: boolean;
}

/**
 * API Key monitoring configuration
 */
export interface APIKeyMonitoringConfig {
  readonly usage: {
    readonly enableAsyncUpdates: boolean;
    readonly batchUpdateInterval: number;
    readonly maxBatchSize: number;
    readonly enableAnalytics: boolean;
    readonly analyticsRetentionDays: number;
  };
  readonly health: {
    readonly healthCheckInterval: number;
    readonly enableContinuousMonitoring: boolean;
    readonly performanceThresholds: {
      readonly maxResponseTime: number;
      readonly minSuccessRate: number;
      readonly maxErrorRate: number;
      readonly minCacheHitRate: number;
    };
  };
}

/**
 * Validation schemas for API Key types
 */
export const APIKeySchemas = {
  userId: z.string().min(1).max(100).trim(),
  keyId: z.string().uuid(),
  apiKeyFormat: z
    .string()
    .min(10)
    .max(200)
    .regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().max(200).optional(),
  storeId: z.string().min(1).max(100).trim().optional(),
  scope: z.string().min(1).max(50).trim(),
  permission: z.string().min(1).max(100).trim(),
  prefix: z
    .string()
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/)
    .optional(),

  generationOptions: z.object({
    userId: z.string().min(1).max(100).trim(),
    name: z.string().max(200).optional(),
    storeId: z.string().min(1).max(100).trim().optional(),
    scopes: z.array(z.string().min(1).max(50).trim()).max(20).optional(),
    permissions: z.array(z.string().min(1).max(100).trim()).max(50).optional(),
    expirationDate: z
      .date()
      .refine((date) => date > new Date())
      .optional(),
    prefix: z
      .string()
      .max(20)
      .regex(/^[a-zA-Z0-9_]+$/)
      .optional(),
    metadata: z.record(z.any()).optional(),
  }),
};

// Re-export commonly used types for convenience
export type { HealthCheckResult, SystemHealth, PerformanceMetrics };
export type { ValidationResult, ValidationError };
export type { SecurityAnalysis, SecurityEvent };
export type { AuthResult, UserInfo };
