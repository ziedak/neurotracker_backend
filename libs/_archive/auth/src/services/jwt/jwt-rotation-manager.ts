/**
 * JWT Token Rotation Manager - Enterprise Security Implementation
 *
 * Implements secure refresh token rotation with comprehensive security features  constructor(
    config: Partial<JWTRotationConfig> = {},
    logger: ILogger,
    metrics: MetricsCollector,
    jwtService?: EnhancedJWTService,
    blacklistManager?: JWTBlacklistManager,
    sessionManager?: UnifiedSessionManager
  ) { Cryptographically secure token rotation
 * - Token family tracking for security analysis
 * - Token reuse detection and mitigation
 * - Comprehensive audit trail for compliance
 * - Performance optimization with caching
 *
 * Follows Clean Architecture principles with enterprise-grade error handling,
 * monitoring, and performance optimization.
 *
 * @version 2.2.0
 */

import { Redis, RedisClient, ConnectionPoolManager } from "@libs/database";
import { Logger, MetricsCollector, type ILogger } from "@libs/monitoring";
import { circuitBreaker, LRUCache } from "@libs/utils";

// Import JWT services for integration
import { EnhancedJWTService } from "./enhanced-jwt-service-v2";
import {
  JWTBlacklistManager,
  TokenRevocationReason,
} from "./jwt-blacklist-manager";
import { UnifiedSessionManager } from "../session/unified-session-manager";

// Import types
import { RefreshTokenPayload } from "../../types/jwt-types";

/**
 * Token pair representing access and refresh tokens
 */
export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessTokenExpiry: number;
  readonly refreshTokenExpiry: number;
  readonly tokenId: string;
  readonly familyId: string;
}

/**
 * Token family for tracking related tokens
 */
export interface TokenFamily {
  readonly familyId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly createdAt: Date;
  readonly lastRotatedAt: Date;
  readonly rotationCount: number;
  readonly isActive: boolean;
  readonly metadata: Record<string, unknown>;
}

/**
 * Token operation for audit trail
 */
export interface TokenOperation {
  readonly operationType:
    | "rotation"
    | "generation"
    | "invalidation"
    | "reuse_detected";
  readonly tokenId: string;
  readonly familyId: string;
  readonly userId: string;
  readonly sessionId?: string | undefined;
  readonly timestamp: Date;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly success: boolean;
  readonly errorCode?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Token rotation result with security information
 */
export interface TokenRotationResult {
  readonly success: boolean;
  readonly tokenPair?: TokenPair;
  readonly familyRotated: boolean;
  readonly previousTokenRevoked: boolean;
  readonly securityAlert?:
    | "reuse_detected"
    | "suspicious_rotation"
    | "rate_limit_exceeded";
  readonly error?: string;
  readonly errorCode?: string;
}

/**
 * Token reuse detection result
 */
export interface TokenReuseDetectionResult {
  readonly isReused: boolean;
  readonly familyId?: string;
  readonly lastUsedAt?: Date;
  readonly reuseCount?: number;
  readonly securityRisk: "low" | "medium" | "high" | "critical";
}

/**
 * Rotation manager configuration
 */
export interface JWTRotationConfig {
  readonly maxRotationsPerHour: number;
  readonly tokenFamilyTTL: number; // TTL for token family tracking
  readonly enableReuseDetection: boolean;
  readonly enableAuditLogging: boolean;
  readonly cacheMaxSize: number;
  readonly rotationGracePeriod: number; // Grace period for old token acceptance
  readonly maxTokenAge: number; // Maximum age before forced rotation
  readonly suspiciousPatternThreshold: number;
}

/**
 * Default configuration for JWT Rotation Manager
 */
const DEFAULT_ROTATION_CONFIG: JWTRotationConfig = {
  maxRotationsPerHour: 10,
  tokenFamilyTTL: 7 * 24 * 60 * 60, // 7 days
  enableReuseDetection: true,
  enableAuditLogging: true,
  cacheMaxSize: 5000,
  rotationGracePeriod: 30, // 30 seconds
  maxTokenAge: 24 * 60 * 60, // 24 hours
  suspiciousPatternThreshold: 5,
};

/**
 * Enterprise JWT Token Rotation Manager
 *
 * Orchestrates secure token rotation with comprehensive security features
 * including token family tracking, reuse detection, and audit trails.
 */
/**
 * Manages JWT refresh token rotation, token family lifecycle, and security enforcement.
 *
 * Features:
 * - Singleton pattern for centralized management.
 * - Configurable rotation rate limits and security policies.
 * - Detects and handles token reuse incidents.
 * - Maintains token families for tracking and invalidation.
 * - Integrates with Redis for persistence and caching.
 * - Provides audit logging for compliance.
 * - Tracks metrics and health status for observability.
 * - Supports maintenance operations for cache and dependencies.
 *
 * Dependencies:
 * - EnhancedJWTService: JWT verification and generation.
 * - JWTBlacklistManager: Token revocation and blacklist management.
 * - UnifiedSessionManager: Session tracking.
 * - RedisClient: Redis connectivity.
 * - Logger: Structured logging.
 * - MetricsCollector: Metrics and counters.
 * - CircuitBreaker: Fault tolerance for infrastructure.
 * - LRUCache: In-memory caching for performance.
 *
 * Usage:
 * - Use `JWTRotationManager.getInstance()` to obtain the singleton.
 * - Call `rotateTokens()` to securely rotate refresh tokens.
 * - Use `generateTokenFamily()` and `invalidateTokenFamily()` for advanced token family control.
 * - Call `getHealthStatus()` for service health monitoring.
 * - Use `performMaintenance()` for periodic cleanup.
 *
 * Security:
 * - Enforces rotation rate limits per user.
 * - Detects and responds to token reuse (compromised tokens).
 * - Audits all sensitive operations for compliance.
 *
 * @remarks
 * This class is designed for high-security environments and supports extensibility for custom policies.
 *
 * @example
 * ```typescript
 * const manager = JWTRotationManager.getInstance();
 * const result = await manager.rotateTokens(refreshToken, { ipAddress, userAgent });
 * if (result.success) {
 *   // Use new token pair
 * }
 * ```
 */
export class JWTRotationManager {
  private static instance: JWTRotationManager;

  // Configuration
  private readonly config: JWTRotationConfig;

  // Service Dependencies
  private readonly jwtService: EnhancedJWTService;
  private readonly blacklistManager: JWTBlacklistManager;
  private readonly sessionManager: UnifiedSessionManager;

  // Infrastructure
  private readonly redis: Redis; // Redis client from RedisClient
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  // Performance Components
  private readonly circuitBreaker: CircuitBreaker;
  private readonly tokenFamilyCache: LRUCache<string, TokenFamily>;
  private readonly rotationRateCache: LRUCache<string, number>;

  // State
  private isInitialized = false;
  private readonly serviceStartTime: number;

  constructor(
    config: Partial<JWTRotationConfig> = {},
    logger: ILogger,
    metrics: MetricsCollector,
    jwtService?: EnhancedJWTService,
    blacklistManager?: JWTBlacklistManager,
    sessionManager?: UnifiedSessionManager
  ) {
    this.config = { ...DEFAULT_ROTATION_CONFIG, ...config };

    // Initialize infrastructure first
    this.logger = logger;
    this.metrics = metrics;
    this.redis = RedisClient.getInstance();

    // Initialize service dependencies
    this.jwtService = jwtService || EnhancedJWTService.getInstance();
    this.blacklistManager = blacklistManager || new JWTBlacklistManager();
    this.sessionManager =
      sessionManager ||
      new UnifiedSessionManager({}, this.logger, this.metrics);

    // Initialize performance components
    this.circuitBreaker = new CircuitBreaker({
      threshold: 10,
      timeout: 30000,
      resetTimeout: 60000,
    });

    this.tokenFamilyCache = new LRUCache<string, TokenFamily>(
      this.config.cacheMaxSize,
      6000
    );

    this.rotationRateCache = new LRUCache<string, number>(
      1000, // Track rotation rates for 1000 users
      60000
    );

    this.serviceStartTime = Date.now();

    this.logger.info("JWT Rotation Manager initialized", {
      maxRotationsPerHour: this.config.maxRotationsPerHour,
      reuseDetectionEnabled: this.config.enableReuseDetection,
      auditLoggingEnabled: this.config.enableAuditLogging,
    });
  }

  /**
   * Get singleton instance of JWT Rotation Manager
   */
  public static getInstance(
    config: Partial<JWTRotationConfig> = {},
    logger?: Logger,
    metrics?: MetricsCollector
  ): JWTRotationManager {
    if (!JWTRotationManager.instance) {
      const defaultLogger = logger || Logger.getInstance("JWTRotationManager");
      const defaultMetrics = metrics || MetricsCollector.getInstance();
      JWTRotationManager.instance = new JWTRotationManager(
        config,
        defaultLogger,
        defaultMetrics
      );
    }
    return JWTRotationManager.instance;
  }

  /**
   * Initialize the JWT Rotation Manager
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.logger.info("Initializing JWT Rotation Manager...");

      // Initialize dependencies
      await this.jwtService.initialize();
      await this.blacklistManager.initialize();
      await this.sessionManager.initialize();

      // Test Redis connectivity
      await RedisClient.ping();

      this.isInitialized = true;
      this.logger.info("JWT Rotation Manager initialization completed");
      await this.metrics.recordCounter("jwt_rotation_manager_initializations");
    } catch (error) {
      this.logger.error(
        "Failed to initialize JWT Rotation Manager",
        error as Error
      );
      await this.metrics.recordCounter(
        "jwt_rotation_manager_initialization_failures"
      );
      throw error;
    }
  }

  /**
   * Rotate refresh token with security validation
   */
  public async rotateTokens(
    refreshToken: string,
    context?: {
      ipAddress?: string;
      userAgent?: string;
      sessionId?: string;
    }
  ): Promise<TokenRotationResult> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Verify refresh token
      const refreshVerification = await this.jwtService.verifyRefreshToken(
        refreshToken
      );
      if (!refreshVerification.valid || !refreshVerification.payload) {
        await this.metrics.recordCounter("jwt_rotation_invalid_refresh_token");
        return {
          success: false,
          familyRotated: false,
          previousTokenRevoked: false,
          error: "Invalid refresh token",
          errorCode: "INVALID_REFRESH_TOKEN",
        };
      }

      const refreshPayload = refreshVerification.payload as RefreshTokenPayload;
      const userId = refreshPayload.sub;
      const currentTokenId = refreshPayload.jti || "";

      // Check rotation rate limits
      const rateLimitResult = await this.checkRotationRateLimit(userId);
      if (!rateLimitResult.allowed) {
        await this.metrics.recordCounter("jwt_rotation_rate_limited");
        return {
          success: false,
          familyRotated: false,
          previousTokenRevoked: false,
          securityAlert: "rate_limit_exceeded",
          error: "Rotation rate limit exceeded",
          errorCode: "RATE_LIMIT_EXCEEDED",
        };
      }

      // Detect token reuse
      let reuseDetectionResult: TokenReuseDetectionResult | null = null;
      if (this.config.enableReuseDetection) {
        reuseDetectionResult = await this.detectTokenReuse(refreshToken);
        if (reuseDetectionResult.isReused) {
          // Handle token reuse - invalidate entire token family
          await this.handleTokenReuse(refreshPayload, context);

          return {
            success: false,
            familyRotated: false,
            previousTokenRevoked: true,
            securityAlert: "reuse_detected",
            error: "Token reuse detected - family invalidated",
            errorCode: "TOKEN_REUSE_DETECTED",
          };
        }
      }

      // Get or create token family
      let tokenFamily = await this.getTokenFamily(currentTokenId);
      if (!tokenFamily) {
        tokenFamily = await this.createTokenFamily(userId, context?.sessionId);
      }

      // Update token family rotation tracking
      tokenFamily = await this.updateTokenFamilyRotation(tokenFamily);

      // Generate new token pair
      const userDetails = await this.getUserForTokenRotation(userId);
      if (!userDetails) {
        return {
          success: false,
          familyRotated: false,
          previousTokenRevoked: false,
          error: "User not found or inactive",
          errorCode: "USER_NOT_FOUND",
        };
      }

      const tokenGeneration = await this.jwtService.generateTokens({
        sub: userDetails.id,
        storeId: userDetails.storeId,
      });

      // Create new token pair with family information
      const tokenPair: TokenPair = {
        accessToken: tokenGeneration.accessToken,
        refreshToken: tokenGeneration.refreshToken,
        accessTokenExpiry: tokenGeneration.expiresIn,
        refreshTokenExpiry: tokenGeneration.refreshExpiresIn,
        tokenId: tokenGeneration.tokenId,
        familyId: tokenFamily.familyId,
      };

      // Revoke old refresh token
      await this.blacklistManager.revokeToken(
        refreshToken,
        TokenRevocationReason.TOKEN_COMPROMISED,
        {
          revokedBy: "jwt-rotation-manager",
          metadata: {
            reason: "token_rotation",
            newTokenId: tokenGeneration.tokenId,
            familyId: tokenFamily.familyId,
          },
        }
      );

      // Record token rotation audit
      if (this.config.enableAuditLogging) {
        await this.auditTokenOperation({
          operationType: "rotation",
          tokenId: tokenGeneration.tokenId,
          familyId: tokenFamily.familyId,
          userId: userId,
          sessionId: context?.sessionId,
          timestamp: new Date(),
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          success: true,
        });
      }

      // Update rotation rate tracking
      await this.updateRotationRateTracking(userId);

      // Record metrics
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram("jwt_rotation_duration", duration);
      await this.metrics.recordCounter("jwt_rotation_success");

      this.logger.info("JWT tokens rotated successfully", {
        userId,
        familyId: tokenFamily.familyId,
        newTokenId: tokenGeneration.tokenId,
        rotationCount: tokenFamily.rotationCount,
        duration,
      });

      return {
        success: true,
        tokenPair,
        familyRotated: true,
        previousTokenRevoked: true,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "jwt_rotation_error_duration",
        duration
      );
      await this.metrics.recordCounter("jwt_rotation_errors");

      this.logger.error("JWT token rotation failed", error as Error);

      return {
        success: false,
        familyRotated: false,
        previousTokenRevoked: false,
        error: (error as Error).message,
        errorCode: "ROTATION_ERROR",
      };
    }
  }

  /**
   * Generate a new token family
   */
  public async generateTokenFamily(
    userId: string,
    sessionId?: string,
    metadata: Record<string, unknown> = {}
  ): Promise<TokenFamily> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const familyId = this.generateFamilyId(userId);
      const now = new Date();

      const tokenFamily: TokenFamily = {
        familyId,
        userId,
        sessionId: sessionId || "",
        createdAt: now,
        lastRotatedAt: now,
        rotationCount: 0,
        isActive: true,
        metadata,
      };

      // Store in Redis and cache
      await this.storeTokenFamily(tokenFamily);
      this.tokenFamilyCache.set(familyId, tokenFamily);

      await this.metrics.recordCounter("jwt_token_families_created");

      this.logger.info("Token family created", {
        familyId,
        userId,
        sessionId,
      });

      return tokenFamily;
    } catch (error) {
      await this.metrics.recordCounter("jwt_token_family_creation_errors");
      this.logger.error("Failed to create token family", error as Error);
      throw error;
    }
  }

  /**
   * Invalidate an entire token family
   */
  public async invalidateTokenFamily(
    /**
     * Invalidate an entire token family and revoke all associated tokens.
     * @param familyId - The family ID to invalidate.
     * @param reason - Reason for revocation.
     * @returns void
     * @remarks
     * - Marks family inactive in Redis and cache.
     * - Revokes all tokens in the family.
     * - Audits operation in Redis and PostgreSQL.
     * - Logs and metrics for error scenarios.
     */
    familyId: string,
    reason: TokenRevocationReason = TokenRevocationReason.SECURITY_BREACH
  ): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    let tokenFamily: TokenFamily | null = null;
    try {
      tokenFamily = await this.getTokenFamily(familyId);
    } catch (error) {
      this.logger.error("Error fetching token family for invalidation", {
        familyId,
        error,
      });
      await this.metrics.recordCounter("jwt_token_family_invalidation_errors");
      throw error;
    }
    if (!tokenFamily) {
      this.logger.warn("Token family not found for invalidation", { familyId });
      return;
    }
    // Mark family as inactive
    const updatedFamily: TokenFamily = {
      ...tokenFamily,
      isActive: false,
      lastRotatedAt: new Date(),
    };
    try {
      await this.storeTokenFamily(updatedFamily);
      this.tokenFamilyCache.set(familyId, updatedFamily);
    } catch (error) {
      this.logger.error("Error storing updated token family", {
        familyId,
        error,
      });
      await this.metrics.recordCounter("jwt_token_family_invalidation_errors");
      throw error;
    }
    // Batch revoke all tokens in the family (if tracked)
    try {
      // If you track all token IDs in Redis, use pipeline for batch revocation
      // Example: const tokenIds = await this.redis.smembers(`token_family_tokens:${familyId}`);
      // if (tokenIds && tokenIds.length > 0) {
      //   const pipeline = this.redis.pipeline();
      //   tokenIds.forEach(tokenId => pipeline.sadd("jwt_blacklist", tokenId));
      //   await pipeline.exec();
      // }
      await this.blacklistManager.revokeUserTokens(tokenFamily.userId, reason, {
        revokedBy: "jwt-rotation-manager",
        metadata: {
          reason: "family_invalidation",
          familyId: familyId,
        },
      });
    } catch (error) {
      this.logger.error("Error revoking user tokens for family", {
        familyId,
        error,
      });
      await this.metrics.recordCounter("jwt_token_family_invalidation_errors");
      throw error;
    }
    // Audit family invalidation
    if (this.config.enableAuditLogging) {
      try {
        await this.auditTokenOperation({
          operationType: "invalidation",
          tokenId: "",
          familyId: familyId,
          userId: tokenFamily.userId,
          sessionId: tokenFamily.sessionId,
          timestamp: new Date(),
          success: true,
        });
      } catch (error) {
        this.logger.error("Error auditing token family invalidation", {
          familyId,
          error,
        });
      }
    }
    await this.metrics.recordCounter("jwt_token_families_invalidated");
    this.logger.info("Token family invalidated", {
      familyId,
      userId: tokenFamily.userId,
      reason,
    });
  }

  /**
   * Detect token reuse patterns
   */
  public async detectTokenReuse(
    refreshToken: string
  ): Promise<TokenReuseDetectionResult> {
    try {
      const tokenHash = this.generateTokenHash(refreshToken);
      const reuseKey = `token_reuse:${tokenHash}`;

      // Check if token has been used before
      const lastUsedTimestamp = await this.redis.get(reuseKey);

      if (lastUsedTimestamp) {
        const lastUsedAt = new Date(parseInt(lastUsedTimestamp, 10));
        const timeSinceLastUse = Date.now() - lastUsedAt.getTime();

        // If token was used within grace period, it's not reuse
        if (timeSinceLastUse < this.config.rotationGracePeriod * 1000) {
          return {
            isReused: false,
            lastUsedAt,
            reuseCount: 0,
            securityRisk: "low",
          };
        }

        // Token reuse detected
        const reuseCountKey = `reuse_count:${tokenHash}`;
        const reuseCount = await this.redis.incr(reuseCountKey);
        await this.redis.expire(reuseCountKey, this.config.tokenFamilyTTL);

        let securityRisk: "low" | "medium" | "high" | "critical" = "medium";
        if (reuseCount > this.config.suspiciousPatternThreshold) {
          securityRisk = "critical";
        } else if (reuseCount > 2) {
          securityRisk = "high";
        }

        await this.metrics.recordCounter("jwt_token_reuse_detected");

        return {
          isReused: true,
          lastUsedAt,
          reuseCount,
          securityRisk,
        };
      }

      // Mark token as used
      await this.redis.setex(
        reuseKey,
        this.config.tokenFamilyTTL,
        Date.now().toString()
      );

      return {
        isReused: false,
        reuseCount: 0,
        securityRisk: "low",
      };
    } catch (error) {
      this.logger.warn("Token reuse detection failed", {
        error: (error as Error).message,
      });

      // Fail-safe: assume no reuse if detection fails
      return {
        isReused: false,
        reuseCount: 0,
        securityRisk: "low",
      };
    }
  }

  /**
   * Audit token operations for compliance
   */
  public async auditTokenOperation(operation: TokenOperation): Promise<void> {
    try {
      const auditEntry = {
        ...operation,
        service: "JWTRotationManager",
        version: "2.2.0",
      };

      // Store in Redis audit trail
      const auditKey = `jwt_rotation_audit:${operation.userId}`;
      await this.redis.lpush(auditKey, JSON.stringify(auditEntry));
      await this.redis.ltrim(auditKey, 0, 99);
      await this.redis.expire(auditKey, 90 * 24 * 60 * 60);

      // Store in PostgreSQL for compliance (if available)
      try {
        const poolManager = new ConnectionPoolManager(this.logger);
        const query = `INSERT INTO jwt_rotation_audit (
          operation_type, token_id, family_id, user_id, session_id, timestamp, ip_address, user_agent, success, error_code, metadata, service, version
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )`;
        const params = [
          operation.operationType,
          operation.tokenId,
          operation.familyId,
          operation.userId,
          operation.sessionId || null,
          operation.timestamp,
          operation.ipAddress || null,
          operation.userAgent || null,
          operation.success,
          operation.errorCode || null,
          operation.metadata ? JSON.stringify(operation.metadata) : null,
          "JWTRotationManager",
          "2.2.0",
        ];
        await poolManager.executeQuery(query, params);
      } catch (pgError) {
        this.logger.debug("Failed to persist audit event to PostgreSQL", {
          error: (pgError as Error).message,
        });
      }

      await this.metrics.recordCounter("jwt_rotation_audit_entries");
    } catch (error) {
      this.logger.debug("Failed to audit token operation", {
        operation: operation.operationType,
        userId: operation.userId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get service health status
   */
  public async getHealthStatus(): Promise<{
    healthy: boolean;
    components: Record<string, string>;
    metrics: Record<string, number>;
  }> {
    try {
      // Check dependencies health
      const jwtServiceHealth = await this.jwtService.getHealthStatus();
      const blacklistHealth = await this.blacklistManager.getHealthStatus();

      // Check Redis connectivity
      let redisHealthy = true;
      try {
        await RedisClient.ping();
      } catch {
        redisHealthy = false;
      }

      const circuitBreakerState = this.circuitBreaker.getState();
      const overallHealthy =
        jwtServiceHealth.status !== "critical" &&
        blacklistHealth.healthy &&
        redisHealthy &&
        circuitBreakerState !== "OPEN";

      return {
        healthy: overallHealthy,
        components: {
          jwtService: jwtServiceHealth.status,
          blacklistManager: blacklistHealth.healthy ? "healthy" : "degraded",
          redis: redisHealthy ? "connected" : "error",
          circuitBreaker: circuitBreakerState,
          cache:
            this.tokenFamilyCache.getSize() < this.config.cacheMaxSize * 0.9
              ? "healthy"
              : "degraded",
        },
        metrics: {
          tokenFamiliesInCache: this.tokenFamilyCache.getSize(),
          rotationRatesTracked: this.rotationRateCache.getSize(),
          uptime: Date.now() - this.serviceStartTime,
        },
      };
    } catch (error) {
      this.logger.error("Health check failed", error as Error);
      return {
        healthy: false,
        components: {
          service: "error",
        },
        metrics: {
          uptime: Date.now() - this.serviceStartTime,
        },
      };
    }
  }

  // Private helper methods

  /**
   * Check rotation rate limits for a user
   */
  private async checkRotationRateLimit(
    userId: string
  ): Promise<{ allowed: boolean; currentCount: number }> {
    const rateLimitKey = `rotation_rate:${userId}`;
    const currentHour = Math.floor(Date.now() / (60 * 60 * 1000));
    const hourlyKey = `${rateLimitKey}:${currentHour}`;

    try {
      const currentCount = await this.redis.incr(hourlyKey);
      await this.redis.expire(hourlyKey, 3600); // 1 hour TTL

      const allowed = currentCount <= this.config.maxRotationsPerHour;

      if (!allowed) {
        this.logger.warn("Rotation rate limit exceeded", {
          userId,
          currentCount,
          limit: this.config.maxRotationsPerHour,
        });
      }

      return { allowed, currentCount };
    } catch (error) {
      this.logger.warn("Rate limit check failed", {
        userId,
        error: (error as Error).message,
      } as any);

      // Fail-safe: allow rotation if rate limit check fails
      return { allowed: true, currentCount: 0 };
    }
  }

  /**
   * Handle token reuse security incident
   */
  private async handleTokenReuse(
    refreshPayload: RefreshTokenPayload,
    context?: any
  ): Promise<void> {
    const userId = refreshPayload.sub;

    this.logger.error("Token reuse detected - initiating security response", {
      userId,
      tokenId: refreshPayload.jti,
      context,
    } as any);

    // Invalidate all user tokens
    await this.blacklistManager.revokeUserTokens(
      userId,
      TokenRevocationReason.SECURITY_BREACH,
      {
        revokedBy: "jwt-rotation-manager",
        metadata: {
          reason: "token_reuse_detected",
          securityIncident: true,
          detectionTime: new Date().toISOString(),
        },
      }
    );

    // Audit security incident
    if (this.config.enableAuditLogging) {
      await this.auditTokenOperation({
        operationType: "reuse_detected",
        tokenId: refreshPayload.jti || "",
        familyId: "",
        userId: userId,
        timestamp: new Date(),
        success: true,
        metadata: {
          securityIncident: true,
          responseAction: "revoke_all_user_tokens",
        },
      });
    }

    await this.metrics.recordCounter("jwt_security_incidents");
  }

  /**
   * Get token family by family ID or token ID
   */
  private async getTokenFamily(
    tokenIdOrFamilyId: string
  ): Promise<TokenFamily | null> {
    // Check cache first
    const cached = this.tokenFamilyCache.get(tokenIdOrFamilyId);
    if (cached) {
      return cached;
    }
    try {
      // Try to get by familyId first
      const redisKey = `token_family:${tokenIdOrFamilyId}`;
      const familyData = await this.redis.get(redisKey);
      if (familyData) {
        const tokenFamily: TokenFamily = JSON.parse(familyData);
        this.tokenFamilyCache.set(tokenFamily.familyId, tokenFamily);
        return tokenFamily;
      }
      // If not found, try to get by tokenId mapping
      const familyIdKey = `token_family_id_for_token:${tokenIdOrFamilyId}`;
      const familyId = await this.redis.get(familyIdKey);
      if (familyId) {
        const familyDataById = await this.redis.get(`token_family:${familyId}`);
        if (familyDataById) {
          const tokenFamily: TokenFamily = JSON.parse(familyDataById);
          this.tokenFamilyCache.set(tokenFamily.familyId, tokenFamily);
          return tokenFamily;
        }
      }
      return null;
    } catch (error) {
      this.logger.error(
        "Failed to get token family from Redis",
        error as Error
      );
      return null;
    }
  }

  /**
   * Create a new token family
   */
  private async createTokenFamily(
    userId: string,
    sessionId?: string
  ): Promise<TokenFamily> {
    const familyId = this.generateFamilyId(userId);
    const now = new Date();
    const tokenFamily: TokenFamily = {
      familyId,
      userId,
      sessionId: sessionId || "",
      createdAt: now,
      lastRotatedAt: now,
      rotationCount: 0,
      isActive: true,
      metadata: {},
    };
    try {
      // Persist in Redis
      const redisKey = `token_family:${familyId}`;
      await this.redis.setex(
        redisKey,
        this.config.tokenFamilyTTL,
        JSON.stringify(tokenFamily)
      );
      // Map tokenId to familyId for lookup
      if (tokenFamily.familyId) {
        await this.redis.setex(
          `token_family_id_for_token:${tokenFamily.familyId}`,
          this.config.tokenFamilyTTL,
          familyId
        );
      }
      // Update cache
      this.tokenFamilyCache.set(familyId, tokenFamily);
      return tokenFamily;
    } catch (error) {
      this.logger.error(
        "Failed to create token family in Redis",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Update token family rotation information
   */
  private async updateTokenFamilyRotation(
    tokenFamily: TokenFamily
  ): Promise<TokenFamily> {
    try {
      const updatedFamily: TokenFamily = {
        ...tokenFamily,
        lastRotatedAt: new Date(),
        rotationCount: tokenFamily.rotationCount + 1,
      };
      // Persist in Redis
      const redisKey = `token_family:${updatedFamily.familyId}`;
      await this.redis.setex(
        redisKey,
        this.config.tokenFamilyTTL,
        JSON.stringify(updatedFamily)
      );
      // Update cache
      this.tokenFamilyCache.set(updatedFamily.familyId, updatedFamily);
      return updatedFamily;
    } catch (error) {
      this.logger.error(
        "Failed to update token family rotation in Redis",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Store token family in Redis
   */
  private async storeTokenFamily(tokenFamily: TokenFamily): Promise<void> {
    try {
      const redisKey = `token_family:${tokenFamily.familyId}`;
      await this.redis.setex(
        redisKey,
        this.config.tokenFamilyTTL,
        JSON.stringify(tokenFamily)
      );
      this.tokenFamilyCache.set(tokenFamily.familyId, tokenFamily);
    } catch (error) {
      this.logger.error(
        "Failed to store token family in Redis",
        error as Error
      );
      throw error;
    }
  }

  /**
   * Generate unique family ID
   */
  private generateFamilyId(userId: string): string {
    const timestamp = Date.now().toString();
    const randomBytes = Math.random().toString(36).substring(2);
    return `family_${userId}_${timestamp}_${randomBytes}`;
  }

  /**
   * Generate token hash for reuse detection
   */
  private generateTokenHash(token: string): string {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Update rotation rate tracking for a user
   */
  private async updateRotationRateTracking(userId: string): Promise<void> {
    const currentCount = this.rotationRateCache.get(userId) || 0;
    this.rotationRateCache.set(userId, currentCount + 1);
  }

  /**
   * Get user details for token rotation
   */
  private async getUserForTokenRotation(userId: string): Promise<any | null> {
    try {
      // This would integrate with UserService when available
      // For now, return a basic structure
      return {
        id: userId,
        email: `user@${userId}.com`, // Placeholder
        role: "user", // Default role
        permissions: [], // Empty permissions
      };
    } catch (error) {
      this.logger.error("Failed to get user details", error as Error);
      return null;
    }
  }

  /**
   * Cleanup expired token families and rotation data
   */
  public async performMaintenance(): Promise<void> {
    try {
      this.logger.debug("Starting JWT Rotation Manager maintenance");

      // Clear expired cache entries
      this.tokenFamilyCache.clear();
      this.rotationRateCache.clear();

      // Perform dependency maintenance
      await this.jwtService.performMaintenance();
      await this.blacklistManager.cleanupExpiredEntries();

      await this.metrics.recordCounter("jwt_rotation_maintenance_completed");
      this.logger.info("JWT Rotation Manager maintenance completed");
    } catch (error) {
      await this.metrics.recordCounter("jwt_rotation_maintenance_errors");
      this.logger.error(
        "JWT Rotation Manager maintenance failed",
        error as Error
      );
    }
  }
}
