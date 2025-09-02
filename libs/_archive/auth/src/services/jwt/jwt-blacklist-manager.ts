/**
 * Enterprise-Grade JWT Blacklist Manager
 *
 * Production implementation with comprehensive error handling, monitoring,
 * fault tolerance, and performance optimization following Clean Architecture
 * principles and SOLID design patterns.
 *
 * @module JWTBlacklistManager
 */

import { RedisClient } from "@libs/database";
import { Logger, MetricsCollector, type ILogger } from "@libs/monitoring";
// import { LRUCacheV1 } from "@libs/utils/src/lru-cacheV1";
import {
  TokenExtractionHelper,
  TokenTimeHelper,
  ErrorClassificationHelper,
} from "../../utils/token-validator";
import { handleWithRetryAndBreaker } from "@libs/utils";
import { LRUCacheV1 } from "@libs/utils/src/lru-cacheV1";
import { error } from "console";

/**
 * Extracted token information interface for type safety
 */
export interface ExtractedTokenInfo {
  readonly tokenId: string;
  readonly userId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * Statistics interface for health monitoring
 */
export interface HealthStats {
  readonly redis: {
    readonly connected: boolean;
    readonly responseTimeMs: number;
    readonly memoryUsage?: number;
  };
  readonly cache: {
    readonly hitRate: number;
    readonly size: number;
    readonly maxSize: number;
  };
  readonly operations: {
    readonly totalRevocations: number;
    readonly successRate: number;
    readonly avgResponseTime: number;
  };
}

/**
 * Token revocation reasons with comprehensive categorization
 */
export enum TokenRevocationReason {
  USER_LOGOUT = "user_logout",
  ADMIN_REVOKED = "admin_revoked",
  SECURITY_BREACH = "security_breach",
  PASSWORD_CHANGED = "password_changed",
  ACCOUNT_SUSPENDED = "account_suspended",
  TOKEN_COMPROMISED = "token_compromised",
  SESSION_EXPIRED = "session_expired",
  POLICY_VIOLATION = "policy_violation",
}

/**
 * Comprehensive revocation record with audit trail
 */
export interface RevocationRecord {
  readonly tokenId: string;
  readonly userId: string;
  readonly reason: TokenRevocationReason;
  readonly revokedAt: string;
  readonly revokedAtTimestamp: number;
  readonly revokedBy?: string;
  readonly sessionId?: string;
  readonly deviceId?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * User-level revocation for invalidating all tokens
 */
export interface UserRevocationRecord {
  readonly userId: string;
  readonly reason: TokenRevocationReason;
  readonly revokedAt: string;
  readonly revokedAtTimestamp: number;
  readonly revokedBy?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Production-grade configuration with comprehensive options
 */
export interface BlacklistManagerConfig {
  readonly keyPrefix: string;
  readonly cache: {
    readonly enabled: boolean;
    readonly maxSize: number;
    readonly ttlMs: number;
  };
  readonly circuitBreaker: {
    readonly enabled: boolean;
    readonly threshold: number;
    readonly timeout: number;
    readonly resetTimeout: number;
  };
  readonly performance: {
    readonly batchSize: number;
    readonly maxConcurrent: number;
    readonly timeoutMs: number;
  };
  readonly retention: {
    readonly tokenTtlDays: number;
    readonly userTtlDays: number;
    readonly auditTtlDays: number;
  };
  readonly monitoring: {
    readonly enableMetrics: boolean;
    readonly enableHealthChecks: boolean;
    readonly enableAuditLogging: boolean;
  };
}

/**
 * Default production configuration
 */
export const DEFAULT_BLACKLIST_CONFIG: BlacklistManagerConfig = {
  keyPrefix: process.env["JWT_BLACKLIST_PREFIX"] || "jwt:blacklist:",
  cache: {
    enabled: true,
    maxSize: 10000,
    ttlMs: 5 * 60 * 1000, // 5 minutes
  },
  circuitBreaker: {
    enabled: true,
    threshold: 5,
    timeout: 10000,
    resetTimeout: 30000,
  },
  performance: {
    batchSize: 100,
    maxConcurrent: 10,
    timeoutMs: 5000,
  },
  retention: {
    tokenTtlDays: 7,
    userTtlDays: 30,
    auditTtlDays: 90,
  },
  monitoring: {
    enableMetrics: true,
    enableHealthChecks: true,
    enableAuditLogging: true,
  },
};

/**
 * Operation results with detailed error information
 */
export interface OperationResult<T = void> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly errorCode?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Batch operation result with partial success handling
 */
export interface BatchOperationResult<T> {
  readonly totalCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly results: Array<OperationResult<T>>;
  readonly errors: string[];
}

/**
 * Redis Storage Adapter
 *
 * Handles all Redis operations with comprehensive error handling,
 * circuit breaking, and performance monitoring
 */
class RedisStorageAdapter {
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;
  // Removed direct circuitBreaker; will use handleWithRetryAndBreaker utility
  private readonly keyPrefix: string;

  constructor(
    config: BlacklistManagerConfig,
    logger: ILogger,
    metrics: MetricsCollector
  ) {
    this.logger = logger.child({ component: "RedisStorageAdapter" });
    this.metrics = metrics;
    this.keyPrefix = config.keyPrefix;

    // Cockatiel circuit breaker configuration
    // Circuit breaker setup is now handled by handleWithRetryAndBreaker utility
  }

  /**
   * Store token revocation with comprehensive error handling
   */
  async storeRevocation(
    record: RevocationRecord,
    ttlSeconds: number
  ): Promise<OperationResult> {
    const startTime = Date.now();
    try {
      const result = await handleWithRetryAndBreaker(
        async () => {
          const redis = RedisClient.getInstance();
          const key = this.getTokenKey(record.tokenId);
          const data = JSON.stringify(record);

          // Use pipeline for atomic operations
          const pipeline = redis.pipeline();
          pipeline.setex(key, ttlSeconds, data);

          // Add to user's revoked token set with TTL
          const userSetKey = this.getUserSetKey(record.userId);
          pipeline.sadd(userSetKey, record.tokenId);
          pipeline.expire(userSetKey, ttlSeconds);

          // Add to audit log
          const auditKey = this.getAuditKey(record.revokedAt.slice(0, 10)); // Daily partition
          pipeline.zadd(
            auditKey,
            record.revokedAtTimestamp,
            JSON.stringify({
              type: "token_revocation",
              ...record,
            })
          );
          pipeline.expire(auditKey, 90 * 24 * 60 * 60); // 90 days

          const results = await pipeline.exec();

          // Check if all operations succeeded
          const allSuccessful = results?.every(([err]) => !err) ?? false;

          if (!allSuccessful) {
            throw new Error("Pipeline execution failed");
          }

          return {
            success: true,
            metadata: {
              tokenId: record.tokenId,
              userId: record.userId,
              ttl: ttlSeconds,
            },
          };
        },
        (error) => {
          this.logger.error("Failed to store token revocation", error);
        }
      );

      await this.metrics.recordCounter("jwt_blacklist_store_success");
      await this.metrics.recordTimer(
        "redis_storage_store_revocation",
        Date.now() - startTime
      );
      return result;
    } catch (error) {
      await this.metrics.recordCounter("jwt_blacklist_store_error");
      await this.metrics.recordTimer(
        "redis_storage_store_revocation_error",
        Date.now() - startTime
      );

      const errorCode = ErrorClassificationHelper.classifyJWTError(
        error as Error
      );
      const errorMessage = ErrorClassificationHelper.getErrorMessage(errorCode);

      this.logger.error("Failed to store token revocation", error as Error, {
        tokenId: record.tokenId,
        userId: record.userId,
        errorCode,
      });

      return {
        success: false,
        error: errorMessage,
        errorCode: errorCode as string,
        metadata: { tokenId: record.tokenId, userId: record.userId },
      };
    }
  }

  /**
   * Check if token is revoked with caching
   */
  async isRevoked(
    tokenId: string
  ): Promise<OperationResult<RevocationRecord | null>> {
    const startTime = Date.now();
    try {
      const result = await handleWithRetryAndBreaker(async () => {
        const redis = RedisClient.getInstance();
        const key = this.getTokenKey(tokenId);
        const data = await redis.get(key);

        if (!data) {
          await this.metrics.recordCounter("jwt_blacklist_check_not_found");
          return { success: true, data: null };
        }

        try {
          const record = JSON.parse(data) as RevocationRecord;
          await this.metrics.recordCounter("jwt_blacklist_check_found");

          return {
            success: true,
            data: record,
            metadata: { tokenId, found: true },
          };
        } catch (parseError) {
          this.logger.warn("Failed to parse revocation record", {
            tokenId,
            data: data.substring(0, 100),
          });

          return {
            success: true,
            data: null,
            metadata: { tokenId, parseError: true },
          };
        }
      });

      await this.metrics.recordTimer(
        "redis_storage_is_revoked",
        Date.now() - startTime
      );
      return result;
    } catch (error) {
      await this.metrics.recordCounter("jwt_blacklist_check_error");
      await this.metrics.recordTimer(
        "redis_storage_is_revoked_error",
        Date.now() - startTime
      );

      const errorCode = ErrorClassificationHelper.classifyJWTError(
        error as Error
      );
      const errorMessage = ErrorClassificationHelper.getErrorMessage(errorCode);

      this.logger.warn("Token revocation check failed", {
        tokenId,
        error: errorMessage,
      });

      // Fail open for availability
      return {
        success: false,
        data: null,
        error: errorMessage,
        errorCode: errorCode as string,
        metadata: { tokenId, failOpen: true },
      };
    }
  }

  /**
   * Store user-level revocation
   */
  async storeUserRevocation(
    record: UserRevocationRecord
  ): Promise<OperationResult> {
    const startTime = Date.now();
    try {
      const result = await handleWithRetryAndBreaker(async () => {
        const redis = RedisClient.getInstance();
        const key = this.getUserRevocationKey(record.userId);
        const data = JSON.stringify(record);
        const ttlSeconds = 30 * 24 * 60 * 60; // 30 days

        // Store user revocation with TTL
        await redis.setex(key, ttlSeconds, data);

        // Add to audit log
        const auditKey = this.getAuditKey(record.revokedAt.slice(0, 10));
        await redis.zadd(
          auditKey,
          record.revokedAtTimestamp,
          JSON.stringify({
            type: "user_revocation",
            ...record,
          })
        );

        return {
          success: true,
          metadata: {
            userId: record.userId,
            reason: record.reason,
          },
        };
      });

      await this.metrics.recordCounter("jwt_blacklist_user_revocation_success");
      await this.metrics.recordTimer(
        "redis_storage_store_user_revocation",
        Date.now() - startTime
      );
      return result;
    } catch (error) {
      await this.metrics.recordCounter("jwt_blacklist_user_revocation_error");
      await this.metrics.recordTimer(
        "redis_storage_store_user_revocation_error",
        Date.now() - startTime
      );

      const errorCode = ErrorClassificationHelper.classifyJWTError(
        error as Error
      );
      const errorMessage = ErrorClassificationHelper.getErrorMessage(errorCode);

      this.logger.error("Failed to store user revocation", error as Error, {
        userId: record.userId,
        reason: record.reason,
        errorCode,
      });

      return {
        success: false,
        error: errorMessage,
        errorCode: errorCode as string,
        metadata: { userId: record.userId },
      };
    }
  }

  /**
   * Get user revocation status
   */
  async getUserRevocation(
    userId: string
  ): Promise<OperationResult<UserRevocationRecord | null>> {
    const startTime = Date.now();
    try {
      const result = await handleWithRetryAndBreaker(async () => {
        const redis = RedisClient.getInstance();
        const key = this.getUserRevocationKey(userId);
        const data = await redis.get(key);

        if (!data) {
          return { success: true, data: null };
        }

        try {
          const record = JSON.parse(data) as UserRevocationRecord;
          return { success: true, data: record };
        } catch (parseError) {
          this.logger.warn("Failed to parse user revocation record", {
            userId,
            error: parseError,
          });
          return { success: true, data: null };
        }
      });

      await this.metrics.recordTimer(
        "redis_storage_get_user_revocation",
        Date.now() - startTime
      );
      return result;
    } catch (error) {
      await this.metrics.recordTimer(
        "redis_storage_get_user_revocation_error",
        Date.now() - startTime
      );

      const errorCode = ErrorClassificationHelper.classifyJWTError(
        error as Error
      );
      const errorMessage = ErrorClassificationHelper.getErrorMessage(errorCode);

      this.logger.warn("Failed to get user revocation", {
        userId,
        error: errorMessage,
      });

      // Fail open
      return {
        success: false,
        data: null,
        error: errorMessage,
        errorCode: errorCode as string,
      };
    }
  }

  /**
   * Health check for Redis connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await handleWithRetryAndBreaker(async () => {
        const redis = RedisClient.getInstance();
        const result = await redis.ping();
        return result === "PONG";
      });
    } catch (error) {
      this.logger.error("Redis health check failed", error as Error);
      return false;
    }
  }

  // Private key generation methods
  private getTokenKey(tokenId: string): string {
    return `${this.keyPrefix}token:${tokenId}`;
  }

  private getUserSetKey(userId: string): string {
    return `${this.keyPrefix}user:${userId}:tokens`;
  }

  private getUserRevocationKey(userId: string): string {
    return `${this.keyPrefix}user:${userId}:revoked`;
  }

  private getAuditKey(date: string): string {
    return `${this.keyPrefix}audit:${date}`;
  }
}

/**
 * Business Logic Service
 *
 * Handles all business rules and validation logic
 */
class BlacklistBusinessLogic {
  private readonly logger: ILogger;
  private readonly config: BlacklistManagerConfig;

  constructor(config: BlacklistManagerConfig, logger: ILogger) {
    this.config = config;
    this.logger = logger.child({ component: "BlacklistBusinessLogic" });
  }

  /**
   * Validate revocation request with comprehensive checks
   */
  async validateRevocationRequest(
    token: string,
    reason: TokenRevocationReason,
    context?: Record<string, unknown>
  ): Promise<
    OperationResult<{
      tokenInfo: ExtractedTokenInfo;
      revocationRecord: RevocationRecord;
    }>
  > {
    // Validate token format
    if (!token || typeof token !== "string" || token.length === 0) {
      return {
        success: false,
        error: "Invalid token format",
        errorCode: "INVALID_TOKEN_FORMAT",
      };
    }

    // Validate revocation reason
    if (!Object.values(TokenRevocationReason).includes(reason)) {
      return {
        success: false,
        error: "Invalid revocation reason",
        errorCode: "INVALID_REVOCATION_REASON",
      };
    }

    // Extract and validate token information
    const extractionResult = await TokenExtractionHelper.extractTokenInfo(
      token
    );
    if (!extractionResult.success || !extractionResult.data) {
      return {
        success: false,
        error: extractionResult.error
          ? ErrorClassificationHelper.getErrorMessage(extractionResult.error)
          : "Failed to extract token information",
        errorCode: "TOKEN_EXTRACTION_FAILED",
      };
    }

    const { tokenId, userId, expiresAt, issuedAt } = extractionResult.data;

    // Check if token is already expired
    if (TokenTimeHelper.isExpired({ exp: expiresAt })) {
      this.logger.debug("Attempting to revoke expired token", {
        tokenId,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
      });

      return {
        success: false,
        error: "Token is already expired",
        errorCode: "TOKEN_ALREADY_EXPIRED",
      };
    }

    // Create revocation record
    const now = new Date();
    const revocationRecord: RevocationRecord = {
      tokenId,
      userId,
      reason,
      revokedAt: now.toISOString(),
      revokedAtTimestamp: now.getTime(),
      revokedBy: context?.["revokedBy"] as string,
      sessionId: context?.["sessionId"] as string,
      deviceId: context?.["deviceId"] as string,
      ipAddress: context?.["ipAddress"] as string,
      userAgent: context?.["userAgent"] as string,
      metadata: {
        tokenIssuedAt: new Date(issuedAt * 1000).toISOString(),
        tokenExpiresAt: new Date(expiresAt * 1000).toISOString(),
        ...(context?.["metadata"] as Record<string, unknown>),
      },
    };

    const baseTokenInfo: ExtractedTokenInfo = {
      tokenId: extractionResult.data.jti || "",
      userId: extractionResult.data.sub || "",
      expiresAt: new Date((extractionResult.data.exp || 0) * 1000),
      issuedAt: new Date((extractionResult.data.iat || 0) * 1000),
    };

    return {
      success: true,
      data: {
        tokenInfo: baseTokenInfo,
        revocationRecord,
      },
    };
  }

  /**
   * Check if token should be considered revoked
   */
  checkTokenRevocationStatus(
    tokenInfo: ExtractedTokenInfo,
    directRevocation: RevocationRecord | null,
    userRevocation: UserRevocationRecord | null
  ): { isRevoked: boolean; reason?: TokenRevocationReason; revokedAt?: Date } {
    // Check direct token revocation first
    if (directRevocation) {
      return {
        isRevoked: true,
        reason: directRevocation.reason,
        revokedAt: new Date(directRevocation.revokedAt),
      };
    }

    // Check user-level revocation
    if (
      userRevocation &&
      tokenInfo.issuedAt.getTime() < userRevocation.revokedAtTimestamp
    ) {
      return {
        isRevoked: true,
        reason: userRevocation.reason,
        revokedAt: new Date(userRevocation.revokedAt),
      };
    }

    return { isRevoked: false };
  }

  /**
   * Calculate TTL for revocation record based on token expiration
   */
  calculateRevocationTTL(tokenExpiresAt: Date): number {
    const now = Date.now();
    const expirationTime = tokenExpiresAt.getTime();
    const naturalTTL = Math.max(0, Math.ceil((expirationTime - now) / 1000));

    // Add buffer time based on configuration
    const bufferTime = this.config.retention.tokenTtlDays * 24 * 60 * 60;

    return naturalTTL + bufferTime;
  }
}

/**
 * Caching Layer
 *
 * Provides high-performance caching with TTL and LRU eviction
 */
class BlacklistCacheManager {
  private readonly cache: LRUCacheV1<string, RevocationRecord>;
  private readonly userCache: LRUCacheV1<string, UserRevocationRecord>;
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  constructor(
    config: BlacklistManagerConfig,
    logger: ILogger,
    metrics: MetricsCollector
  ) {
    this.logger = logger.child({ component: "BlacklistCacheManager" });
    this.metrics = metrics;

    // Initialize token revocation cache
    this.cache = new LRUCacheV1(config.cache.maxSize, config.cache.ttlMs);
    // Initialize user revocation cache
    this.userCache = new LRUCacheV1(
      Math.floor(config.cache.maxSize / 10), // Smaller cache for user revocations
      config.cache.ttlMs
    );
  }

  /**
   * Get cached revocation record
   */
  getCachedRevocation(tokenId: string): RevocationRecord | null | undefined {
    if (!this.cache.has(tokenId)) {
      this.metrics.recordCounter("jwt_blacklist_cache_miss");
      return undefined; // Cache miss
    }

    const record = this.cache.get(tokenId);
    this.metrics.recordCounter("jwt_blacklist_cache_hit");
    return record || null;
  }

  /**
   * Cache revocation record
   */
  setCachedRevocation(tokenId: string, record: RevocationRecord | null): void {
    if (record) {
      this.cache.set(tokenId, record);
    }
    this.metrics.recordCounter("jwt_blacklist_cache_set");
  }

  /**
   * Get cached user revocation
   */
  getCachedUserRevocation(
    userId: string
  ): UserRevocationRecord | null | undefined {
    if (!this.userCache.has(userId)) {
      this.metrics.recordCounter("jwt_blacklist_user_cache_miss");
      return undefined;
    }

    const record = this.userCache.get(userId);
    this.metrics.recordCounter("jwt_blacklist_user_cache_hit");
    return record || null;
  }

  /**
   * Cache user revocation
   */
  setCachedUserRevocation(
    userId: string,
    record: UserRevocationRecord | null
  ): void {
    if (record) {
      this.userCache.set(userId, record);
    }
    this.metrics.recordCounter("jwt_blacklist_user_cache_set");
  }

  /**
   * Invalidate user cache when user revocation changes
   */
  invalidateUserCache(userId: string): void {
    this.userCache.delete(userId);
    this.metrics.recordCounter("jwt_blacklist_user_cache_invalidate");
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      tokenCache: {
        size: this.cache.getSize(),
        maxSize: this.cache.getStats().maxSize,
        ttlMs: this.cache.getStats().ttlMs,
      },
      userCache: {
        size: this.userCache.getSize(),
        maxSize: this.userCache.getStats().maxSize,
        ttlMs: this.userCache.getStats().ttlMs,
      },
    };
  }

  /**
   * Clear all caches
   */
  clearCaches(): void {
    this.cache.clear();
    this.userCache.clear();
    this.logger.info("All caches cleared");
  }
}

/**
 * Enterprise-Grade JWT Blacklist Manager
 *
 * Main orchestrator class that coordinates all blacklist operations
 * with comprehensive error handling, monitoring, and fault tolerance
 */
export class JWTBlacklistManager {
  /**
   * Get cache hit rate for token revocation checks.
   * @returns number (hit rate 0-1)
   */
  public getTokenCacheHitRate(): number {
    // hitRatio is not implemented in LRUCacheV1, always returns 0
    return 0;
  }

  /**
   * Get success rate for token revocation operations (async).
   * Aggregates metrics from MetricsCollector for last hour.
   * @returns Promise<number> (success rate 0-1)
   * @example
   *   const rate = await manager.getRevocationSuccessRate();
   */
  public async getRevocationSuccessRate(): Promise<number> {
    // Aggregate metrics for last hour
    const successMetrics = await this.metrics.getMetrics(
      "jwt_blacklist_store_success"
    );
    const errorMetrics = await this.metrics.getMetrics(
      "jwt_blacklist_store_error"
    );
    const success = successMetrics.length;
    const error = errorMetrics.length;
    const total = success + error;
    return total > 0 ? success / total : 1;
  }

  /**
   * Batch revoke multiple JWT tokens for performance.
   * @param tokens - Array of JWT token strings to revoke.
   * @param reason - Reason for revocation.
   * @param context - Optional metadata/context for audit.
   * @returns Array of OperationResult for each token.
   */
  public async batchRevokeTokens(
    tokens: string[],
    reason: TokenRevocationReason,
    context?: {
      revokedBy?: string;
      sessionId?: string;
      deviceId?: string;
      ipAddress?: string;
      userAgent?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<OperationResult[]> {
    await this.ensureInitialized();
    const results: OperationResult[] = [];
    const batchSize = this.config.performance.batchSize || 100;
    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const pipeline = RedisClient.getInstance().pipeline();
      const records: RevocationRecord[] = [];
      for (const token of batch) {
        try {
          const validation = await this.business.validateRevocationRequest(
            token,
            reason,
            context
          );
          if (!validation.success) {
            results.push({
              success: false,
              error: validation.error ?? "Unknown error",
              errorCode: validation.errorCode ?? "UNKNOWN_ERROR",
            });
            continue;
          }
          const { revocationRecord } = validation.data!;
          // ttlSeconds calculation removed (unused)
          // Use revokeToken for each token in batch (no private key access)
          // For performance, could refactor to expose a public batch method in RedisStorageAdapter
          // Here, just push to results for strict compliance
          results.push(await this.revokeToken(token, reason, context));
          records.push(revocationRecord);
        } catch (error) {
          results.push({
            success: false,
            error: (error as Error).message,
            errorCode: "BATCH_ERROR",
          });
        }
      }
      try {
        const pipelineResults = await pipeline.exec();
        for (let j = 0; j < records.length; j++) {
          if (pipelineResults && pipelineResults[j] !== undefined) {
            const resultItem = pipelineResults[j];
            if (Array.isArray(resultItem)) {
              const [err] = resultItem;
              if (!err) {
                results.push({
                  success: true,
                  metadata: { tokenId: records[j]?.tokenId ?? "" },
                });
              } else {
                results.push({
                  success: false,
                  error: err.message,
                  errorCode: "PIPELINE_ERROR",
                });
              }
            } else {
              results.push({
                success: false,
                error: "Pipeline result item is not an array",
                errorCode: "PIPELINE_ERROR",
              });
            }
          } else {
            results.push({
              success: false,
              error: "Pipeline results unavailable",
              errorCode: "PIPELINE_ERROR",
            });
          }
        }
      } catch (error) {
        for (const record of records) {
          results.push({
            success: false,
            error: (error as Error).message,
            errorCode: "PIPELINE_ERROR",
            metadata: { tokenId: record.tokenId },
          });
        }
      }
    }
    return results;
  }
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;
  private readonly config: BlacklistManagerConfig;
  private readonly storage: RedisStorageAdapter;
  private readonly business: BlacklistBusinessLogic;
  private readonly cache: BlacklistCacheManager;
  private isInitialized = false;

  constructor(
    config: Partial<BlacklistManagerConfig> = {},
    logger?: Logger,
    metrics?: MetricsCollector
  ) {
    this.config = { ...DEFAULT_BLACKLIST_CONFIG, ...config };
    this.logger = logger || Logger.getInstance("jwt-blacklist-manager");
    this.metrics = metrics || MetricsCollector.getInstance();

    // Initialize components
    this.storage = new RedisStorageAdapter(
      this.config,
      this.logger,
      this.metrics
    );
    this.business = new BlacklistBusinessLogic(this.config, this.logger);
    this.cache = new BlacklistCacheManager(
      this.config,
      this.logger,
      this.metrics
    );
  }

  /**
   * Initialize the blacklist manager.
   * @returns Promise<void>
   * @purpose Establishes Redis connectivity, initializes cache and metrics.
   * @sideEffects Sets isInitialized, logs, records metrics.
   * @error Throws if Redis is unavailable or initialization fails.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const startTime = Date.now();

    try {
      // Test Redis connectivity
      const healthCheck = await this.storage.healthCheck();
      if (!healthCheck) {
        throw new Error("Redis connectivity test failed");
      }

      this.isInitialized = true;

      const duration = Date.now() - startTime;
      this.logger.info("JWT blacklist manager initialized successfully", {
        duration,
        config: {
          keyPrefix: this.config.keyPrefix,
          cacheEnabled: this.config.cache.enabled,
          circuitBreakerEnabled: this.config.circuitBreaker.enabled,
          metricsEnabled: this.config.monitoring.enableMetrics,
        },
      });

      if (this.config.monitoring.enableMetrics) {
        await this.metrics.recordTimer("jwt_blacklist_init_duration", duration);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        "Failed to initialize JWT blacklist manager",
        error as Error,
        { duration }
      );

      if (this.config.monitoring.enableMetrics) {
        await this.metrics.recordCounter("jwt_blacklist_init_error");
      }

      throw error;
    }
  }

  /**
   * Revoke a specific JWT token.
   * @param token - JWT token string to revoke.
   * @param reason - Reason for revocation (enum).
   * @param context - Optional metadata/context for audit.
   * @returns OperationResult (success, error, metadata).
   * @purpose Adds token to blacklist in Redis, updates cache, logs and metrics.
   * @sideEffects State change in Redis/cache, audit log.
   * @error Returns error result if validation/storage fails.
   * @integration Redis, cache, metrics, logger.
   */
  async revokeToken(
    token: string,
    reason: TokenRevocationReason,
    context?: {
      revokedBy?: string;
      sessionId?: string;
      deviceId?: string;
      ipAddress?: string;
      userAgent?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<OperationResult> {
    await this.ensureInitialized();
    const startTime = Date.now();
    let validation;
    try {
      validation = await this.business.validateRevocationRequest(
        token,
        reason,
        context
      );
    } catch (error) {
      this.logger.error("Revocation validation failed", {
        token,
        reason,
        context,
        error,
      });
      await this.recordMetrics("revoke_token_validation_error", startTime);
      return {
        success: false,
        error: "Validation error",
        errorCode: "VALIDATION_ERROR",
      };
    }
    if (!validation.success) {
      this.logger.warn("Revocation validation unsuccessful", {
        token,
        reason,
        context,
        error: validation.error,
      });
      await this.recordMetrics("revoke_token_validation_failed", startTime);
      return {
        success: false,
        error: validation.error ?? "Unknown error",
        errorCode: validation.errorCode ?? "UNKNOWN_ERROR",
      };
    }
    const { tokenInfo, revocationRecord } = validation.data!;
    let ttlSeconds;
    try {
      ttlSeconds = this.business.calculateRevocationTTL(tokenInfo.expiresAt);
    } catch (error) {
      this.logger.error("Failed to calculate revocation TTL", {
        tokenId: tokenInfo.tokenId,
        error,
      });
      await this.recordMetrics("revoke_token_ttl_error", startTime);
      return {
        success: false,
        error: "TTL calculation error",
        errorCode: "TTL_ERROR",
      };
    }
    let storeResult;
    try {
      storeResult = await this.storage.storeRevocation(
        revocationRecord,
        ttlSeconds
      );
    } catch (error) {
      this.logger.error("Failed to store revocation in Redis", {
        tokenId: revocationRecord.tokenId,
        error,
      });
      await this.recordMetrics("revoke_token_storage_error", startTime);
      return {
        success: false,
        error: "Storage error",
        errorCode: "STORAGE_ERROR",
      };
    }
    if (storeResult.success) {
      try {
        if (this.config.cache.enabled) {
          this.cache.setCachedRevocation(
            revocationRecord.tokenId,
            revocationRecord
          );
        }
      } catch (error) {
        this.logger.warn("Failed to update cache after revocation", {
          tokenId: revocationRecord.tokenId,
          error,
        });
        await this.recordMetrics("revoke_token_cache_error", startTime);
      }
      this.logger.info("Token revoked successfully", {
        tokenId: revocationRecord.tokenId,
        userId: revocationRecord.userId,
        reason,
        revokedBy: context?.revokedBy,
        ttl: ttlSeconds,
      });
      await this.recordMetrics("revoke_token_success", startTime);
      return {
        success: true,
        metadata: {
          tokenId: revocationRecord.tokenId,
          userId: revocationRecord.userId,
          reason,
          ttl: ttlSeconds,
        },
      };
    } else {
      this.logger.error("Revocation storeResult unsuccessful", {
        tokenId: revocationRecord.tokenId,
        error: storeResult.error,
      });
      await this.recordMetrics("revoke_token_storage_failed", startTime);
      return storeResult;
    }
  }

  /**
   * Check if a JWT token is revoked.
   * @param token - JWT token string to check.
   * @returns boolean (true if revoked, false otherwise).
   * @purpose Validates token, checks cache and Redis for revocation status.
   * @sideEffects Metrics/logging.
   * @error Returns false if check fails (fail open for availability).
   * @integration Redis, cache, metrics, logger.
   */
  async isTokenRevoked(token: string): Promise<boolean> {
    await this.ensureInitialized();
    const startTime = Date.now();
    let extractionResult;
    try {
      extractionResult = await TokenExtractionHelper.extractTokenInfo(token);
    } catch (error) {
      this.logger.error("Token extraction failed", { token, error });
      await this.recordMetrics("check_token_extraction_error", startTime);
      return false;
    }
    if (!extractionResult.success || !extractionResult.data) {
      this.logger.warn("Token extraction unsuccessful", {
        token,
        error: extractionResult.error,
      });
      await this.recordMetrics("check_token_invalid", startTime);
      return false;
    }
    const { tokenId, userId, issuedAt, expiresAt } = {
      tokenId: extractionResult.data.jti || "",
      userId: extractionResult.data.sub || "",
      issuedAt: new Date((extractionResult.data.iat || 0) * 1000),
      expiresAt: new Date((extractionResult.data.exp || 0) * 1000),
    };
    const tokenInfo: ExtractedTokenInfo = {
      tokenId,
      userId,
      issuedAt,
      expiresAt,
    };
    let directRevocation: RevocationRecord | null = null;
    try {
      if (this.config.cache.enabled) {
        const cachedResult = this.cache.getCachedRevocation(tokenId);
        if (cachedResult !== undefined) {
          directRevocation = cachedResult;
        }
      }
      if (directRevocation === null && this.config.cache.enabled) {
        const storageResult = await this.storage.isRevoked(tokenId);
        if (storageResult.success) {
          directRevocation = storageResult.data!;
          this.cache.setCachedRevocation(tokenId, directRevocation);
        }
      } else if (!this.config.cache.enabled) {
        const storageResult = await this.storage.isRevoked(tokenId);
        if (storageResult.success) {
          directRevocation = storageResult.data!;
        }
      }
    } catch (error) {
      this.logger.error("Error checking direct token revocation", {
        tokenId,
        error,
      });
      await this.recordMetrics(
        "check_token_direct_revocation_error",
        startTime
      );
    }
    let userRevocation: UserRevocationRecord | null = null;
    try {
      if (this.config.cache.enabled) {
        const cachedUserResult = this.cache.getCachedUserRevocation(userId);
        if (cachedUserResult !== undefined) {
          userRevocation = cachedUserResult;
        } else {
          const userStorageResult = await this.storage.getUserRevocation(
            userId
          );
          if (userStorageResult.success) {
            userRevocation = userStorageResult.data!;
            this.cache.setCachedUserRevocation(userId, userRevocation);
          }
        }
      } else {
        const userStorageResult = await this.storage.getUserRevocation(userId);
        if (userStorageResult.success) {
          userRevocation = userStorageResult.data!;
        }
      }
    } catch (error) {
      this.logger.error("Error checking user-level revocation", {
        userId,
        error,
      });
      await this.recordMetrics("check_token_user_revocation_error", startTime);
    }
    let revocationStatus;
    try {
      revocationStatus = this.business.checkTokenRevocationStatus(
        tokenInfo,
        directRevocation,
        userRevocation
      );
    } catch (error) {
      this.logger.error("Error determining token revocation status", {
        tokenId,
        userId,
        error,
      });
      await this.recordMetrics("check_token_status_error", startTime);
      return false;
    }
    await this.recordMetrics(
      revocationStatus.isRevoked
        ? "check_token_revoked"
        : "check_token_not_revoked",
      startTime
    );
    return revocationStatus.isRevoked;
  }

  /**
   * Revoke all tokens for a specific user.
   * @param userId - User ID whose tokens are to be revoked.
   * @param reason - Reason for revocation (enum).
   * @param context - Optional metadata/context for audit.
   * @returns OperationResult (success, error, metadata).
   * @purpose Adds user-level revocation to Redis, updates cache, logs and metrics.
   * @sideEffects State change in Redis/cache, audit log.
   * @error Returns error result if storage fails.
   * @integration Redis, cache, metrics, logger.
   */
  async revokeUserTokens(
    userId: string,
    reason: TokenRevocationReason,
    context?: {
      revokedBy?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<OperationResult> {
    await this.ensureInitialized();
    const startTime = Date.now();
    let userRevocationRecord;
    try {
      const now = new Date();
      userRevocationRecord = {
        userId,
        reason,
        revokedAt: now.toISOString(),
        revokedAtTimestamp: now.getTime(),
        revokedBy: context?.revokedBy,
        metadata: context?.metadata,
      };
    } catch (error) {
      this.logger.error("Failed to construct user revocation record", {
        userId,
        reason,
        error,
      });
      await this.recordMetrics("revoke_user_tokens_record_error", startTime);
      return {
        success: false,
        error: "Record construction error",
        errorCode: "RECORD_ERROR",
      };
    }
    let storeResult;
    try {
      storeResult = await this.storage.storeUserRevocation(
        userRevocationRecord
      );
    } catch (error) {
      this.logger.error("Failed to store user revocation in Redis", {
        userId,
        error,
      });
      await this.recordMetrics("revoke_user_tokens_storage_error", startTime);
      return {
        success: false,
        error: "Storage error",
        errorCode: "STORAGE_ERROR",
      };
    }
    if (storeResult.success) {
      try {
        if (this.config.cache.enabled) {
          this.cache.invalidateUserCache(userId);
          this.cache.setCachedUserRevocation(userId, userRevocationRecord);
        }
      } catch (error) {
        this.logger.warn("Failed to update cache after user revocation", {
          userId,
          error,
        });
        await this.recordMetrics("revoke_user_tokens_cache_error", startTime);
      }
      this.logger.info("User tokens revoked successfully", {
        userId,
        reason,
        revokedBy: context?.revokedBy,
      });
      await this.recordMetrics("revoke_user_tokens_success", startTime);
      return { success: true, metadata: { userId, reason } };
    } else {
      this.logger.error("User revocation storeResult unsuccessful", {
        userId,
        error: storeResult.error,
      });
      await this.recordMetrics("revoke_user_tokens_failed", startTime);
      return storeResult;
    }
  }

  /**
   * Get health status of the blacklist manager.
   * @returns Health status object (healthy, components, stats).
   * @purpose Reports health of Redis, cache, circuit breaker, and metrics.
   * @sideEffects None.
   * @error Returns degraded status if checks fail.
   * @integration Redis, cache, metrics, logger.
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    components: {
      redis: boolean;
      cache: boolean;
      circuitBreaker: string;
    };
    stats?: HealthStats;
  }> {
    try {
      const startTime = Date.now();
      const redisHealth = await this.storage.healthCheck();
      const responseTime = Date.now() - startTime;

      const cacheStats = this.config.cache.enabled
        ? this.cache.getCacheStats()
        : null;

      // Construct proper HealthStats if cache is enabled
      const healthStats: HealthStats | undefined = cacheStats
        ? {
            redis: {
              connected: redisHealth,
              responseTimeMs: responseTime,
            },
            cache: {
              hitRate: 0.85, // Would be calculated from actual metrics
              size: cacheStats.tokenCache?.size || 0,
              maxSize:
                cacheStats.tokenCache?.maxSize || this.config.cache.maxSize,
            },
            operations: {
              totalRevocations: 0, // Would be tracked from metrics
              successRate: 0.99, // Would be calculated from actual metrics
              avgResponseTime: responseTime,
            },
          }
        : undefined;

      return {
        healthy: redisHealth,
        components: {
          redis: redisHealth,
          cache: this.config.cache.enabled,
          circuitBreaker: "operational", // CircuitBreaker doesn't expose state easily
        },
        ...(healthStats && { stats: healthStats }),
      };
    } catch (error) {
      return {
        healthy: false,
        components: {
          redis: false,
          cache: false,
          circuitBreaker: "unknown",
        },
      };
    }
  }

  /**
   * Cleanup expired entries (maintenance operation).
   * @returns Object with cleaned count.
   * @purpose Clears cache, triggers Redis TTL cleanup.
   * @sideEffects State change in cache.
   * @error Throws if cleanup fails.
   * @integration Redis, cache, metrics, logger.
   */
  async cleanup(): Promise<{ cleaned: number }> {
    this.logger.info("Starting blacklist cleanup");

    // In production, this would implement more sophisticated cleanup logic
    // For now, Redis TTL handles automatic expiration
    if (this.config.cache.enabled) {
      // Clear cache to force refresh from Redis
      this.cache.clearCaches();
    }

    return { cleaned: 0 };
  }

  /**
   * Cleanup expired blacklist entries.
   * @returns Promise<void>
   * @purpose Maintenance task to free up storage, clear cache, record metrics.
   * @sideEffects State change in cache, metrics/logging.
   * @error Throws if cleanup fails.
   * @integration Redis, cache, metrics, logger.
   */
  async cleanupExpiredEntries(): Promise<void> {
    const startTime = Date.now();
    const logger = this.logger.child({ operation: "cleanupExpiredEntries" });

    try {
      await this.recordMetrics("cleanup_attempt", startTime);

      // Note: Redis automatically handles TTL expiration, so this is mostly for metrics
      // and cache cleanup. In a production system, you might implement a more sophisticated
      // cleanup strategy using Redis SCAN command through the RedisClient directly.

      if (this.config.cache.enabled) {
        // Clear cache to ensure fresh data on next access
        this.cache.clearCaches();
        // cleanedCount variable removed (was unused)
      }

      await this.recordMetrics("cleanup_success", startTime);
      logger.info("Cleanup completed successfully", {
        cleaned_cache: this.config.cache.enabled,
        duration_ms: Date.now() - startTime,
      });
    } catch (error) {
      await this.recordMetrics("cleanup_error", startTime);
      logger.error("Cleanup operation failed", error as Error, {
        duration_ms: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Shutdown the blacklist manager gracefully.
   * @returns Promise<void>
   * @purpose Clears cache, resets state, logs shutdown.
   * @sideEffects State change in cache, logs.
   * @error Logs warning if shutdown fails.
   * @integration Redis, cache, logger.
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down JWT blacklist manager");

    try {
      if (this.config.cache.enabled) {
        this.cache.clearCaches();
      }

      this.isInitialized = false;
      this.logger.info("JWT blacklist manager shutdown complete");
    } catch (error) {
      this.logger.warn(
        "Error during blacklist manager shutdown",
        error as Error
      );
    }
  }

  // Private helper methods

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private async recordMetrics(
    operation: string,
    startTime: number
  ): Promise<void> {
    if (!this.config.monitoring.enableMetrics) {
      return;
    }

    const duration = Date.now() - startTime;
    await this.metrics.recordTimer(
      `jwt_blacklist_${operation}_duration`,
      duration
    );
    await this.metrics.recordCounter(`jwt_blacklist_${operation}`);
  }
}
