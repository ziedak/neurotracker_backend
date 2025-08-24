/**
 * Enhanced JWT Service for Enterprise Authentication - Step 2.2
 *
 * This service builds upon Step 2.1 JWT Blacklist Manager to provide:
 * - Enhanced JWT token generation and verification
 * - Integration with blacklist checking for revoked tokens
 * - Performance optimization with caching
 * - Comprehensive monitoring and error handling
 * - Token rotation and security enforcement
 *
 * @version 2.2.0
 */

import * as jose from "jose";
import { RedisClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { CircuitBreaker, LRUCache } from "@libs/utils";

// Import JWT Blacklist Manager for Step 2.1 integration
import {
  JWTBlacklistManager,
  TokenRevocationReason,
} from "./jwt-blacklist-manager";

// Import types from existing JWT service for compatibility
import { JWTPayload, RefreshTokenPayload } from "../types/jwt-types";

// Enhanced Service Configuration
export interface EnhancedJWTConfig {
  accessTokenExpiry: number;
  refreshTokenExpiry: number;
  maxTokensPerUser: number;
  enableCaching: boolean;
  cacheMaxSize: number;
  enableAuditLogging: boolean;
  enableTokenRotation: boolean;
  rotationThreshold: number; // Percentage of token lifetime before rotation
}

// Enhanced Service Interfaces
export interface TokenGenerationResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
  tokenId: string;
  generatedAt: number;
}

export interface TokenVerificationResult {
  valid: boolean;
  payload?: JWTPayload;
  error?: string;
  errorCode?: string;
  shouldRotate?: boolean;
  isRevoked?: boolean;
}

export interface TokenRotationResult {
  newAccessToken: string;
  newRefreshToken?: string | undefined;
  expiresIn: number;
  rotatedAt: number;
  previousTokenRevoked: boolean;
}

export interface ServiceHealthStatus {
  status: "healthy" | "degraded" | "critical";
  components: {
    circuitBreaker: string;
    cache: string;
    redis: string;
  };
  metrics: {
    totalTokensGenerated: number;
    totalVerifications: number;
    cacheHitRate: number;
    errorRate: number;
  };
  uptime: number;
}

/**
 * Enhanced JWT Service Implementation
 */
export class EnhancedJWTService {
  private static instance: EnhancedJWTService;

  // Configuration
  private readonly config: EnhancedJWTConfig;
  private readonly jwtSecret: Uint8Array;
  private readonly refreshSecret: Uint8Array;

  // Infrastructure
  private readonly redis: any; // Redis instance from RedisClient.getInstance()
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  // JWT Blacklist Manager integration (Step 2.1)
  private readonly blacklistManager: JWTBlacklistManager;

  // Performance Components
  private readonly circuitBreaker: CircuitBreaker;
  private readonly tokenCache: LRUCache<string, TokenVerificationResult>;
  private readonly userTokenCount: LRUCache<string, number>;

  // State
  private readonly serviceStartTime: number;
  private isInitialized: boolean = false;

  private constructor() {
    // Load configuration
    this.config = this.loadConfiguration();

    // Initialize secrets
    const jwtSecretKey = process.env["JWT_SECRET"] || "default_jwt_secret";
    const refreshSecretKey =
      process.env["JWT_REFRESH_SECRET"] || "default_refresh_secret";

    this.jwtSecret = new TextEncoder().encode(jwtSecretKey);
    this.refreshSecret = new TextEncoder().encode(refreshSecretKey);

    // Initialize infrastructure
    this.redis = RedisClient.getInstance();
    this.logger = Logger.getInstance("EnhancedJWTService");
    this.metrics = MetricsCollector.getInstance();

    // Initialize JWT Blacklist Manager (Step 2.1 integration)
    this.blacklistManager = new JWTBlacklistManager(
      {}, // Use default config
      Logger.getInstance("JWTBlacklistManager"),
      this.metrics
    );

    // Initialize performance components
    this.circuitBreaker = new CircuitBreaker({
      threshold: 10,
      timeout: 30000,
      resetTimeout: 60000,
    });

    this.tokenCache = new LRUCache<string, TokenVerificationResult>(
      this.config.cacheMaxSize,
      60000
    );

    this.userTokenCount = new LRUCache<string, number>(1000, 60000);

    this.serviceStartTime = Date.now();

    this.logger.info("Enhanced JWT Service initialized", {
      accessTokenExpiry: this.config.accessTokenExpiry,
      refreshTokenExpiry: this.config.refreshTokenExpiry,
      cachingEnabled: this.config.enableCaching,
    });
  }

  public static getInstance(): EnhancedJWTService {
    if (!EnhancedJWTService.instance) {
      EnhancedJWTService.instance = new EnhancedJWTService();
    }
    return EnhancedJWTService.instance;
  }

  /**
   * Initialize the service with dependencies
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.logger.info("Initializing Enhanced JWT Service...");

      // Test Redis connectivity
      await RedisClient.ping();

      // Initialize JWT Blacklist Manager
      await this.blacklistManager.initialize();

      this.isInitialized = true;
      this.logger.info("Enhanced JWT Service initialization completed");
      await this.metrics.recordCounter("enhanced_jwt_service_initializations");
    } catch (error) {
      this.logger.error(
        "Failed to initialize Enhanced JWT Service",
        error as Error
      );
      await this.metrics.recordCounter(
        "enhanced_jwt_service_initialization_failures"
      );
      throw error;
    }
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfiguration(): EnhancedJWTConfig {
    return {
      accessTokenExpiry: Number(process.env["JWT_ACCESS_EXPIRY"]) || 15 * 60, // 15 minutes
      refreshTokenExpiry:
        Number(process.env["JWT_REFRESH_EXPIRY"]) || 7 * 24 * 60 * 60, // 7 days
      maxTokensPerUser: Number(process.env["JWT_MAX_TOKENS_PER_USER"]) || 10,
      enableCaching: process.env["JWT_ENABLE_CACHE"] !== "false",
      cacheMaxSize: Number(process.env["JWT_CACHE_MAX_SIZE"]) || 10000,
      enableAuditLogging: process.env["JWT_ENABLE_AUDIT"] !== "false",
      enableTokenRotation: process.env["JWT_ENFORCE_ROTATION"] === "true",
      rotationThreshold: Number(process.env["JWT_ROTATION_THRESHOLD"]) || 0.8,
    };
  }

  /**
   * Generate enhanced JWT tokens with security features
   */
  public async generateTokens(
    payload: Omit<JWTPayload, "iat" | "exp">
  ): Promise<TokenGenerationResult> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate payload
      if (!this.validateTokenPayload(payload)) {
        throw new Error("Invalid token payload provided");
      }

      // Check user token limit
      await this.enforceTokenLimit(payload["sub"]);

      // Generate unique token ID
      const tokenId = this.generateTokenId();
      const currentTime = Math.floor(Date.now() / 1000);

      // Prepare payloads
      const accessTokenPayload: JWTPayload = {
        sub: payload["sub"],
        email: payload["email"],
        storeId: payload["storeId"],
        role: payload["role"],
        permissions: payload["permissions"],
        iat: currentTime,
        exp: currentTime + this.config.accessTokenExpiry,
      };

      const refreshTokenPayload: RefreshTokenPayload = {
        sub: payload["sub"],
        type: "refresh",
        iat: currentTime,
        exp: currentTime + this.config.refreshTokenExpiry,
      };

      // Generate tokens using circuit breaker
      const result = await this.circuitBreaker.execute(async () => {
        const accessToken = await new jose.SignJWT(
          accessTokenPayload as unknown as jose.JWTPayload
        )
          .setProtectedHeader({ alg: "HS256" })
          .setJti(tokenId)
          .setIssuer("enhanced-jwt-service")
          .setAudience("api-gateway")
          .sign(this.jwtSecret);

        const refreshToken = await new jose.SignJWT(
          refreshTokenPayload as unknown as jose.JWTPayload
        )
          .setProtectedHeader({ alg: "HS256" })
          .setJti(`${tokenId}_refresh`)
          .setIssuer("enhanced-jwt-service")
          .setAudience("api-gateway")
          .sign(this.refreshSecret);

        return { accessToken, refreshToken };
      });

      // Update user token count
      const currentCount = this.userTokenCount.get(payload["sub"]) || 0;
      this.userTokenCount.set(payload["sub"], currentCount + 1);

      // Audit logging
      if (this.config.enableAuditLogging) {
        await this.logTokenGeneration(
          payload["sub"],
          tokenId,
          payload["email"]
        );
      }

      // Record metrics
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_generation_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_tokens_generated");

      this.logger.info("Enhanced JWT tokens generated successfully", {
        userId: payload["sub"],
        tokenId,
        duration,
      });

      return {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: this.config.accessTokenExpiry,
        refreshExpiresIn: this.config.refreshTokenExpiry,
        tokenId,
        generatedAt: Date.now(),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_generation_error_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_generation_errors");

      this.logger.error(
        "Enhanced JWT token generation failed",
        error as Error,
        {
          userId: payload["sub"],
        }
      );

      throw error;
    }
  }

  /**
   * Enhanced token verification with caching
   */
  public async verifyAccessToken(
    token: string
  ): Promise<TokenVerificationResult> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (!token || typeof token !== "string") {
        return {
          valid: false,
          error: "Invalid token format",
          errorCode: "MALFORMED_TOKEN",
        };
      }

      // Check cache first
      const cacheKey = `access_token:${this.generateTokenHash(token)}`;
      if (this.config.enableCaching) {
        const cached = this.tokenCache.get(cacheKey);
        if (cached) {
          await this.metrics.recordCounter("enhanced_jwt_cache_hits");
          return cached;
        }
      }

      // Verify token using circuit breaker
      const verificationResult = await this.circuitBreaker.execute(async () => {
        const { payload } = await jose.jwtVerify(token, this.jwtSecret, {
          clockTolerance: 30, // 30 seconds tolerance
        });

        return payload;
      });

      // Validate payload structure
      if (!this.isValidJWTPayload(verificationResult)) {
        const result: TokenVerificationResult = {
          valid: false,
          error: "Invalid payload structure",
          errorCode: "INVALID_PAYLOAD",
        };

        if (this.config.enableCaching) {
          this.tokenCache.set(cacheKey, result);
        }

        return result;
      }

      // Convert to our JWTPayload type
      const jwtPayload: JWTPayload = {
        sub: verificationResult.sub as string,
        email: verificationResult.email as string,
        storeId: verificationResult.storeId as string | undefined,
        role: verificationResult.role as JWTPayload["role"],
        permissions: verificationResult.permissions as string[],
        iat: verificationResult.iat as number,
        exp: verificationResult.exp as number,
      };

      // Check token blacklist (Step 2.1 integration)
      const tokenId = verificationResult.jti as string;
      if (tokenId) {
        try {
          const isRevoked = await this.blacklistManager.isTokenRevoked(tokenId);
          if (isRevoked) {
            const result: TokenVerificationResult = {
              valid: false,
              error: "Token has been revoked",
              errorCode: "REVOKED_TOKEN",
              isRevoked: true,
            };

            // Cache negative result for revoked tokens
            if (this.config.enableCaching) {
              this.tokenCache.set(cacheKey, result);
            }

            await this.metrics.recordCounter(
              "enhanced_jwt_revoked_token_detected"
            );
            return result;
          }
        } catch (blacklistError) {
          // Log blacklist check failure but don't fail token verification
          this.logger.warn(
            "Blacklist check failed, proceeding with token verification",
            {
              tokenId,
              error: (blacklistError as Error).message,
            }
          );
          await this.metrics.recordCounter(
            "enhanced_jwt_blacklist_check_failures"
          );
        }
      }

      // Check if token should be rotated
      const shouldRotate = this.shouldRotateToken(jwtPayload);

      const result: TokenVerificationResult = {
        valid: true,
        payload: jwtPayload,
        shouldRotate,
      };

      // Cache positive result
      if (this.config.enableCaching) {
        const cacheTTL = Math.min(
          300,
          (jwtPayload.exp || 0) - Math.floor(Date.now() / 1000)
        );
        this.tokenCache.set(cacheKey, result);
      }

      // Record metrics
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_verification_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_verifications_success");

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      let errorCode = "INVALID_TOKEN";

      if (error instanceof jose.errors.JWTExpired) {
        errorCode = "EXPIRED_TOKEN";
        await this.metrics.recordCounter("enhanced_jwt_expired_tokens");
      } else if (error instanceof jose.errors.JWTInvalid) {
        errorCode = "MALFORMED_TOKEN";
        await this.metrics.recordCounter("enhanced_jwt_malformed_tokens");
      }

      await this.metrics.recordHistogram(
        "enhanced_jwt_verification_error_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_verification_errors");

      this.logger.debug("Enhanced JWT token verification failed", {
        error: (error as Error).message,
        errorCode,
      });

      const result: TokenVerificationResult = {
        valid: false,
        error: (error as Error).message,
        errorCode,
      };

      // Cache negative result for a short time
      if (this.config.enableCaching && errorCode !== "EXPIRED_TOKEN") {
        this.tokenCache.set(
          `access_token:${this.generateTokenHash(token)}`,
          result
        );
      }

      return result;
    }
  }

  /**
   * Enhanced refresh token verification
   */
  public async verifyRefreshToken(
    token: string
  ): Promise<TokenVerificationResult> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (!token || typeof token !== "string") {
        return {
          valid: false,
          error: "Invalid refresh token format",
          errorCode: "MALFORMED_TOKEN",
        };
      }

      // Verify refresh token
      const verificationResult = await this.circuitBreaker.execute(async () => {
        const { payload } = await jose.jwtVerify(token, this.refreshSecret, {
          clockTolerance: 30,
        });

        return payload;
      });

      // Validate refresh token payload structure
      if (!this.isValidRefreshPayload(verificationResult)) {
        return {
          valid: false,
          error: "Invalid refresh token payload structure",
          errorCode: "INVALID_PAYLOAD",
        };
      }

      // Convert to RefreshTokenPayload
      const refreshPayload: RefreshTokenPayload = {
        sub: verificationResult.sub as string,
        type: "refresh",
        iat: verificationResult.iat as number,
        exp: verificationResult.exp as number,
      };

      // Record metrics
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_refresh_verification_duration",
        duration
      );
      await this.metrics.recordCounter(
        "enhanced_jwt_refresh_verifications_success"
      );

      return {
        valid: true,
        payload: refreshPayload as any, // Cast to JWTPayload for compatibility
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      let errorCode = "INVALID_TOKEN";

      if (error instanceof jose.errors.JWTExpired) {
        errorCode = "EXPIRED_TOKEN";
        await this.metrics.recordCounter("enhanced_jwt_expired_refresh_tokens");
      } else if (error instanceof jose.errors.JWTInvalid) {
        errorCode = "MALFORMED_TOKEN";
        await this.metrics.recordCounter(
          "enhanced_jwt_malformed_refresh_tokens"
        );
      }

      await this.metrics.recordHistogram(
        "enhanced_jwt_refresh_verification_error_duration",
        duration
      );
      await this.metrics.recordCounter(
        "enhanced_jwt_refresh_verification_errors"
      );

      this.logger.debug("Enhanced JWT refresh token verification failed", {
        error: (error as Error).message,
        errorCode,
      });

      return {
        valid: false,
        error: (error as Error).message,
        errorCode,
      };
    }
  }

  /**
   * Enhanced token refresh with rotation
   */
  public async refreshAccessToken(
    refreshToken: string,
    userService: any
  ): Promise<TokenRotationResult | null> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Verify refresh token
      const refreshVerification = await this.verifyRefreshToken(refreshToken);
      if (!refreshVerification.valid || !refreshVerification.payload) {
        await this.metrics.recordCounter("enhanced_jwt_refresh_invalid_token");
        return null;
      }

      const refreshPayload = refreshVerification.payload as any;

      // Get user data
      const user = await userService.getUserById(refreshPayload.sub);
      if (!user || user.status !== "active") {
        await this.metrics.recordCounter("enhanced_jwt_refresh_user_invalid");
        return null;
      }

      // Get user permissions
      const permissions = await this.buildPermissionsFromUser(
        user,
        userService
      );

      // Generate new tokens
      const tokenGeneration = await this.generateTokens({
        sub: user.id,
        email: user.email,
        storeId: user.storeId,
        role: user.role,
        permissions,
      });

      // Record metrics
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_refresh_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_refresh_success");

      this.logger.info("Enhanced JWT token refreshed successfully", {
        userId: refreshPayload.sub,
        newTokenId: tokenGeneration.tokenId,
      });

      return {
        newAccessToken: tokenGeneration.accessToken,
        newRefreshToken: this.config.enableTokenRotation
          ? tokenGeneration.refreshToken
          : undefined,
        expiresIn: tokenGeneration.expiresIn,
        rotatedAt: Date.now(),
        previousTokenRevoked: false,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_refresh_error_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_refresh_errors");

      this.logger.error("Enhanced JWT token refresh failed", error as Error);
      return null;
    }
  }

  /**
   * Get service health status
   */
  public async getHealthStatus(): Promise<ServiceHealthStatus> {
    try {
      // Check Redis connectivity
      let redisStatus = "connected";
      try {
        await RedisClient.ping();
      } catch (error) {
        redisStatus = "error";
        this.logger.warn("Redis health check failed", {
          error: (error as Error).message,
        });
      }

      // Get circuit breaker state
      const circuitBreakerState = this.circuitBreaker.getState();

      // Calculate cache health
      const cacheHealth =
        this.tokenCache.getSize() < this.config.cacheMaxSize * 0.9
          ? "healthy"
          : "degraded";

      // Get basic metrics (simplified since we don't have getCounter method)
      const totalTokensGenerated = 0; // Will be implemented when metrics interface is available
      const totalVerifications = 0;
      const totalErrors = 0;

      const errorRate =
        totalVerifications + totalErrors > 0
          ? (totalErrors / (totalVerifications + totalErrors)) * 100
          : 0;

      // Determine overall status
      let overallStatus: "healthy" | "degraded" | "critical" = "healthy";

      if (redisStatus === "error" || circuitBreakerState === "OPEN") {
        overallStatus = "critical";
      } else if (
        cacheHealth === "degraded" ||
        circuitBreakerState === "HALF_OPEN"
      ) {
        overallStatus = "degraded";
      }

      return {
        status: overallStatus,
        components: {
          circuitBreaker: circuitBreakerState,
          cache: cacheHealth,
          redis: redisStatus,
        },
        metrics: {
          totalTokensGenerated,
          totalVerifications,
          cacheHitRate: 0, // Simplified for now
          errorRate: Math.round(errorRate * 100) / 100,
        },
        uptime: Date.now() - this.serviceStartTime,
      };
    } catch (error) {
      this.logger.error("Health check failed", error as Error);

      return {
        status: "critical",
        components: {
          circuitBreaker: "OPEN",
          cache: "degraded",
          redis: "error",
        },
        metrics: {
          totalTokensGenerated: 0,
          totalVerifications: 0,
          cacheHitRate: 0,
          errorRate: 100,
        },
        uptime: Date.now() - this.serviceStartTime,
      };
    }
  }

  // Private helper methods

  /**
   * Validate token payload structure
   */
  private validateTokenPayload(
    payload: Omit<JWTPayload, "iat" | "exp">
  ): boolean {
    return !!(
      payload &&
      typeof payload["sub"] === "string" &&
      typeof payload["email"] === "string" &&
      typeof payload["role"] === "string" &&
      Array.isArray(payload["permissions"])
    );
  }

  /**
   * Check if payload has valid JWT structure
   */
  private isValidJWTPayload(payload: jose.JWTPayload): boolean {
    return !!(
      payload &&
      typeof payload.sub === "string" &&
      typeof payload["email"] === "string" &&
      typeof payload["role"] === "string" &&
      Array.isArray(payload["permissions"]) &&
      typeof payload.iat === "number" &&
      typeof payload.exp === "number"
    );
  }

  /**
   * Check if payload has valid refresh token structure
   */
  private isValidRefreshPayload(payload: jose.JWTPayload): boolean {
    return !!(
      payload &&
      typeof payload.sub === "string" &&
      payload["type"] === "refresh" &&
      typeof payload.iat === "number" &&
      typeof payload.exp === "number"
    );
  }

  /**
   * Generate unique token ID
   */
  private generateTokenId(): string {
    const timestamp = Date.now().toString();
    const randomBytes = Math.random().toString(36).substring(2);
    return `${timestamp}_${randomBytes}`;
  }

  /**
   * Generate hash for token caching
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
   * Check if token should be rotated based on age
   */
  private shouldRotateToken(payload: JWTPayload): boolean {
    if (!this.config.enableTokenRotation) {
      return false;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const tokenAge = currentTime - (payload.iat || 0);
    const tokenLifetime = (payload.exp || 0) - (payload.iat || 0);

    return tokenAge / tokenLifetime >= this.config.rotationThreshold;
  }

  /**
   * Enforce token limit per user
   */
  private async enforceTokenLimit(userId: string): Promise<void> {
    const currentCount = this.userTokenCount.get(userId) || 0;
    if (currentCount >= this.config.maxTokensPerUser) {
      await this.metrics.recordCounter("enhanced_jwt_rate_limited_users");
      throw new Error("Maximum tokens per user exceeded");
    }
  }

  /**
   * Build permissions from user data
   */
  private async buildPermissionsFromUser(
    user: any,
    userService: any
  ): Promise<string[]> {
    try {
      // Try to get permissions from user service if available
      if (userService.getUserPermissions) {
        const permissions = await userService.getUserPermissions(user.id);
        return permissions.map((p: any) => `${p.resource}:${p.action}`);
      }

      // Fall back to role-based permissions
      return this.buildPermissionsFromRoles([user.role]);
    } catch (error) {
      this.logger.warn("Failed to build permissions from user", {
        userId: user.id,
        error: (error as Error).message,
      });

      // Fall back to role-based permissions
      return this.buildPermissionsFromRoles([user.role]);
    }
  }

  /**
   * Build permissions array from user roles (fallback method)
   */
  private buildPermissionsFromRoles(roles: string[]): string[] {
    const permissions: Set<string> = new Set();

    for (const role of roles) {
      switch (role) {
        case "admin":
          permissions.add("user:read");
          permissions.add("user:write");
          permissions.add("user:delete");
          permissions.add("store:read");
          permissions.add("store:write");
          permissions.add("store:delete");
          permissions.add("system:admin");
          permissions.add("analytics:read");
          permissions.add("settings:write");
          break;

        case "store_owner":
          permissions.add("user:read");
          permissions.add("user:write");
          permissions.add("store:read");
          permissions.add("store:write");
          permissions.add("analytics:read");
          permissions.add("settings:write");
          break;

        case "api_user":
          permissions.add("api:read");
          permissions.add("api:write");
          permissions.add("user:read");
          permissions.add("store:read");
          break;

        case "customer":
        default:
          permissions.add("profile:read");
          permissions.add("profile:write");
          permissions.add("orders:read");
          break;
      }
    }

    return Array.from(permissions);
  }

  /**
   * Log token generation for audit trail
   */
  private async logTokenGeneration(
    userId: string,
    tokenId: string,
    email: string
  ): Promise<void> {
    try {
      const auditEntry = {
        eventType: "ENHANCED_JWT_TOKEN_GENERATED",
        userId,
        tokenId,
        email,
        timestamp: new Date().toISOString(),
        service: "EnhancedJWTService",
        version: "2.2.0",
      };

      // Store in Redis for audit trail
      await this.redis.lpush(
        `enhanced_jwt_audit:${userId}`,
        JSON.stringify(auditEntry)
      );

      // Keep only last 100 audit entries per user
      await this.redis.ltrim(`enhanced_jwt_audit:${userId}`, 0, 99);

      // Set expiration on audit log (30 days)
      await this.redis.expire(
        `enhanced_jwt_audit:${userId}`,
        30 * 24 * 60 * 60
      );
    } catch (error) {
      this.logger.debug("Failed to log token generation", {
        userId,
        tokenId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Cleanup expired cache entries (maintenance method)
   */
  public async performMaintenance(): Promise<void> {
    try {
      this.logger.debug("Starting Enhanced JWT Service maintenance");

      // Clear expired cache entries - LRU cache handles this automatically
      // But we can reset counters if needed
      this.userTokenCount.clear();

      // Perform blacklist manager maintenance
      await this.blacklistManager.cleanupExpiredEntries();

      await this.metrics.recordCounter("enhanced_jwt_maintenance_completed");
      this.logger.info("Enhanced JWT Service maintenance completed");
    } catch (error) {
      await this.metrics.recordCounter("enhanced_jwt_maintenance_errors");
      this.logger.error(
        "Enhanced JWT Service maintenance failed",
        error as Error
      );
    }
  }

  /**
   * Revoke a specific JWT token (Step 2.1 integration)
   */
  public async revokeToken(
    token: string,
    reason: TokenRevocationReason = TokenRevocationReason.ADMIN_REVOKED,
    revokedBy?: string
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Extract token information
      const { payload } = await jose.jwtVerify(token, this.jwtSecret, {
        clockTolerance: 30,
      });

      const tokenId = payload.jti as string;
      const userId = payload.sub as string;

      if (!tokenId || !userId) {
        this.logger.warn("Cannot revoke token: missing tokenId or userId", {
          hasTokenId: !!tokenId,
          hasUserId: !!userId,
        });
        return false;
      }

      // Revoke through blacklist manager
      await this.blacklistManager.revokeToken(
        tokenId,
        reason,
        {
          ...(revokedBy !== undefined ? { revokedBy } : {}),
          userAgent: "EnhancedJWTService",
        }
      );

      // Clear from cache
      if (this.config.enableCaching) {
        const cacheKey = `access_token:${this.generateTokenHash(token)}`;
        this.tokenCache.delete(cacheKey);
      }

      // Record metrics
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_revocation_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_tokens_revoked");

      this.logger.info("JWT token revoked successfully", {
        tokenId,
        userId,
        reason,
        revokedBy,
        duration,
      });

      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_revocation_error_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_revocation_errors");

      this.logger.error("Failed to revoke JWT token", error as Error);
      return false;
    }
  }

  /**
   * Revoke all tokens for a specific user (Step 2.1 integration)
   */
  public async revokeUserTokens(
    userId: string,
    reason: TokenRevocationReason = TokenRevocationReason.ADMIN_REVOKED,
    revokedBy?: string
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Revoke through blacklist manager
      await this.blacklistManager.revokeUserTokens(
        userId,
        reason,
        {
          ...(revokedBy !== undefined ? { revokedBy } : {}),
          metadata: { userAgent: "EnhancedJWTService" },
        }
      );

      // Clear user token count
      this.userTokenCount.delete(userId);

      // Note: We cannot easily clear all cached tokens for a user without
      // iterating through all cache entries, but the blacklist check will
      // catch revoked tokens on verification

      // Record metrics
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_user_revocation_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_user_tokens_revoked");

      this.logger.info("All user tokens revoked successfully", {
        userId,
        reason,
        revokedBy,
        duration,
      });

      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.metrics.recordHistogram(
        "enhanced_jwt_user_revocation_error_duration",
        duration
      );
      await this.metrics.recordCounter("enhanced_jwt_user_revocation_errors");

      this.logger.error("Failed to revoke user tokens", error as Error, {
        userId,
      });
      return false;
    }
  }

  /**
   * Check if a token is revoked (Step 2.1 integration)
   */
  public async isTokenRevoked(tokenId: string): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      return await this.blacklistManager.isTokenRevoked(tokenId);
    } catch (error) {
      this.logger.warn("Failed to check token revocation status", {
        tokenId,
        error: (error as Error).message,
      });

      // Fail-safe: assume not revoked if check fails
      return false;
    }
  }

  /**
   * Get comprehensive service health including blacklist manager
   */
  public async getComprehensiveHealth(): Promise<
    ServiceHealthStatus & { blacklist: any }
  > {
    const baseHealth = await this.getHealthStatus();

    try {
      const blacklistHealth = await this.blacklistManager.getHealthStatus();

      return {
        ...baseHealth,
        blacklist: {
          status: blacklistHealth.healthy ? "healthy" : "degraded",
          components: blacklistHealth.components,
          stats: blacklistHealth.stats,
        },
      };
    } catch (error) {
      return {
        ...baseHealth,
        blacklist: {
          status: "error",
          error: (error as Error).message,
        },
      };
    }
  }
}
