/**
 * Keycloak Token Manager Service
 * Handles JWT validation using Keycloak JWKS and introspection endpoints
 *
 * Note: This class handles multiple responsibilities and could benefit from
 * future modularization into separate services:
 * - JWTValidator: Handle JWT signature verification
 * - TokenIntrospector: Handle token introspection
 * - TokenCacheManager: Handle caching operations
 * - RolePermissionExtractor: Handle role/permission extraction
 */

import crypto from "crypto";
import { createLogger } from "@libs/utils";
import { CacheService } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult } from "../types";
import type { AuthV2Config } from "./config";
import {
  KeycloakClient,
  type KeycloakTokenResponse,
} from "../client/KeycloakClient";
import { jwtVerify, createRemoteJWKSet, decodeJwt } from "jose";
import { z } from "zod";
import {
  EncryptionManager,
  createEncryptionManager,
} from "./EncryptionManager";

// Token validation schemas with enhanced security limits
const TokenSchema = z
  .string()
  .min(1, "Token cannot be empty")
  .max(8192, "Token too large (max 8192 characters)")
  .regex(
    /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/,
    "Invalid JWT format - must be a valid JSON Web Token"
  );

// Enhanced error context interface with security considerations
interface TokenValidationContext {
  readonly operation: string;
  readonly tokenLength: number;
  readonly tokenPrefix: string; // Always "***" for security - never actual token content
  readonly timestamp: number;
  readonly cacheEnabled: boolean;
}

/**
 * Stored Token Information with refresh support
 */
export interface StoredTokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  refreshExpiresAt?: Date;
  tokenType: string;
  scope: string;
  userId: string;
  sessionId: string;
  createdAt: Date;
  lastRefreshedAt?: Date;
  refreshCount: number;
}

/**
 * Refresh Result
 */
export interface RefreshResult {
  success: boolean;
  tokens?: KeycloakTokenResponse;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  userId: string;
  sessionId: string;
  timestamp: Date;
  error?: string;
  retryAfter?: number; // seconds to wait before next attempt
}

/**
 * Token Refresh Event
 */
export interface TokenRefreshEvent {
  type?: string;
  userId: string;
  sessionId: string;
  timestamp: Date;
  success: boolean;
  oldAccessToken?: string;
  newTokens?: KeycloakTokenResponse;
  metadata?: {
    expiresAt?: string;
    refreshExpiresAt?: string;
  };
}

/**
 * Token Expiry Event
 */
export interface TokenExpiryEvent {
  userId: string;
  sessionId: string;
  accessToken: string;
  reason: "expired" | "refresh_failed" | "refresh_token_expired";
  timestamp: Date;
}

/**
 * Refresh Token Configuration
 */
export interface RefreshTokenConfig {
  /** Buffer time before token expiration to trigger refresh (seconds) */
  refreshBuffer: number;
  /** Maximum number of refresh attempts before giving up */
  maxRetries: number;
  /** Base delay for exponential backoff (milliseconds) */
  retryBaseDelay: number;
  /** Maximum delay between retries (milliseconds) */
  maxRetryDelay: number;
  /** Whether to enable secure token encryption in storage */
  enableEncryption: boolean;
  /** Encryption key for token storage (32 bytes) */
  encryptionKey?: string;
  /** Cleanup interval for expired tokens (milliseconds) */
  cleanupInterval: number;
}

/**
 * Event Handlers for refresh token operations
 */
export interface RefreshTokenEventHandlers {
  onTokenStored?: (event: TokenRefreshEvent) => Promise<void>;
  onTokenRefreshed?: (event: TokenRefreshEvent) => Promise<void>;
  onTokenExpired?: (event: TokenExpiryEvent) => Promise<void>;
  onRefreshFailed?: (
    userId: string,
    sessionId: string,
    error: string
  ) => Promise<void>;
}

/**
 * Error categorization for enhanced debugging:
 * - VALIDATION_ERROR: Token format or validation errors
 * - NETWORK_ERROR: Network-related failures (JWKS fetch, introspection API)
 * - JWT_ERROR: JWT-specific errors (signature, expiration, claims)
 */

export class TokenManager {
  private readonly logger = createLogger("KeycloakTokenManager");
  private cacheService?: CacheService;
  private jwksEndpoint: string;
  private remoteJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
  private jwksInitPromise: Promise<void> | undefined;

  // Refresh token management
  private refreshTokenConfig: RefreshTokenConfig;
  private refreshEventHandlers: RefreshTokenEventHandlers;
  private refreshTimers = new Map<string, NodeJS.Timeout>();
  private encryptionManager?: EncryptionManager;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly config: AuthV2Config,
    private readonly metrics?: IMetricsCollector,
    refreshConfig: Partial<RefreshTokenConfig> = {},
    refreshEventHandlers: RefreshTokenEventHandlers = {}
  ) {
    // Initialize refresh token configuration
    this.refreshTokenConfig = {
      refreshBuffer: 300, // 5 minutes before expiration
      maxRetries: 3,
      retryBaseDelay: 1000, // 1 second
      maxRetryDelay: 30000, // 30 seconds
      enableEncryption: true,
      cleanupInterval: 300000, // 5 minutes
      ...refreshConfig,
    };

    this.refreshEventHandlers = refreshEventHandlers;

    // Initialize encryption manager if enabled
    if (this.refreshTokenConfig.enableEncryption) {
      this.encryptionManager = createEncryptionManager(
        this.refreshTokenConfig.encryptionKey
      );
    }

    // Initialize cache if enabled in configuration
    if (this.config.cache.enabled) {
      this.cacheService = CacheService.create(metrics);
    }

    // Set up JWKS endpoint for JWT verification - fail fast if not properly configured
    if (this.config.jwt.jwksUrl) {
      this.jwksEndpoint = this.config.jwt.jwksUrl;
    } else if (this.config.jwt.issuer) {
      // Fallback: construct from issuer if available
      this.jwksEndpoint = `${this.config.jwt.issuer}/protocol/openid_connect/certs`;
    } else {
      // Fail fast instead of allowing degraded authentication
      throw new Error(
        "JWKS endpoint must be configured either via 'jwt.jwksUrl' or 'jwt.issuer' in AuthV2Config. JWT validation cannot function without proper JWKS configuration."
      );
    }

    this.logger.debug("TokenManager initialized", {
      jwksEndpoint: this.jwksEndpoint,
      cacheEnabled: !!this.cacheService,
      hasMetrics: !!metrics,
    });
  }

  /**
   * Initialize JWKS for JWT signature verification
   */
  private async initializeJWKS(): Promise<void> {
    try {
      this.remoteJWKS = createRemoteJWKSet(new URL(this.jwksEndpoint));
      this.logger.debug("JWKS initialized successfully", {
        jwksEndpoint: this.jwksEndpoint,
      });
      // Clear the promise to allow garbage collection and prevent memory leaks
      this.jwksInitPromise = undefined;
    } catch (error) {
      // Clear the promise on failure to allow retry
      this.jwksInitPromise = undefined;
      this.logger.error("Failed to initialize JWKS", {
        error: error instanceof Error ? error.message : String(error),
        jwksEndpoint: this.jwksEndpoint,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      });
      throw new Error(
        `Failed to initialize JWT verification: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Ensure JWKS is initialized (thread-safe with mutex pattern)
   */
  private async ensureJWKSInitialized(): Promise<void> {
    if (!this.remoteJWKS) {
      if (!this.jwksInitPromise) {
        this.jwksInitPromise = this.initializeJWKS();
      }
      await this.jwksInitPromise;
    }
  }

  /**
   * Create standardized error result with enhanced error categorization
   */
  private createErrorResult(message: string, error?: unknown): AuthResult {
    // Categorize error type for better logging and debugging
    let errorCategory = "UNKNOWN";
    if (error instanceof Error) {
      if (error.name.includes("JWT") || error.message.includes("JWT")) {
        errorCategory = "JWT_ERROR";
      } else if (
        error.message.includes("network") ||
        error.message.includes("fetch")
      ) {
        errorCategory = "NETWORK_ERROR";
      } else if (error.message.includes("validation")) {
        errorCategory = "VALIDATION_ERROR";
      }
    }

    // Log the categorized error for better debugging
    this.logger.debug("Error categorized", {
      message,
      category: errorCategory,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
    });

    return {
      success: false,
      error: message,
    };
  }

  /**
   * Generate secure cache key to prevent collision attacks
   */
  private generateSecureCacheKey(prefix: string, token: string): string {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    return `${prefix}:${hash.slice(0, 32)}`;
  }

  /**
   * Validate token input using Zod schema
   */
  private validateTokenFormat(token: string): {
    valid: boolean;
    error?: string;
  } {
    const result = TokenSchema.safeParse(token);
    if (!result.success) {
      return {
        valid: false,
        error: result.error.errors[0]?.message || "Invalid token format",
      };
    }
    return { valid: true };
  }

  /**
   * Create validation context for enhanced error logging (lazy and optimized)
   */
  private createValidationContext(
    operation: string,
    token: string
  ): TokenValidationContext {
    // Pre-compute only essential fields, defer expensive operations
    const context: TokenValidationContext = {
      operation,
      tokenLength: token.length,
      tokenPrefix: "***", // Security: Never log actual token content
      timestamp: Date.now(),
      cacheEnabled: !!this.cacheService,
    };
    return context;
  }

  /**
   * Validate JWT token using proper signature verification with JWKS
   */
  async validateJwt(token: string): Promise<AuthResult> {
    const startTime = performance.now();

    // Fast input validation first - fail fast approach
    const tokenValidation = this.validateTokenFormat(token);
    if (!tokenValidation.valid) {
      this.logger.error("Token format validation failed", {
        operation: "jwt_validation",
        error: tokenValidation.error,
        tokenLength: token.length,
      });
      return this.createErrorResult(
        tokenValidation.error || "Token format validation failed"
      );
    }

    const context = this.createValidationContext("jwt_validation", token);

    try {
      if (this.cacheService) {
        const cacheKey = this.generateSecureCacheKey("jwt", token);
        const cachedResult = await this.cacheService.get<AuthResult>(cacheKey);
        if (cachedResult.data && cachedResult.source !== "miss") {
          this.metrics?.recordCounter(
            "keycloak.token_manager.jwt_validation_cache_hit",
            1
          );
          this.logger.debug("JWT validation cache hit", {
            operation: context.operation,
            cacheSource: cachedResult.source,
          });
          return cachedResult.data;
        }
      }

      // Initialize JWKS if not done yet and JWKS URL is available (thread-safe)
      if (!this.remoteJWKS) {
        await this.ensureJWKSInitialized();
      }

      let result: AuthResult;

      // Try signature verification first if JWKS is available
      if (this.remoteJWKS && this.config.jwt.issuer) {
        try {
          const { payload } = await jwtVerify(token, this.remoteJWKS, {
            issuer: this.config.jwt.issuer,
            ...(this.config.jwt.audience && {
              audience: this.config.jwt.audience,
            }),
          });

          // Extract user information from JWT claims
          const claims = payload as Record<string, unknown>;
          result = {
            success: true,
            user: {
              id: claims["sub"] as string,
              username: claims["preferred_username"] as string,
              email: claims["email"] as string,
              name: claims["name"] as string,
              roles: this.extractRoles(claims),
              permissions: this.extractPermissions(claims),
            },
            expiresAt: claims["exp"]
              ? new Date((claims["exp"] as number) * 1000)
              : undefined,
          };

          this.logger.debug("JWT signature verification successful", {
            operation: context.operation,
            userId: result.user?.id,
            username: result.user?.username,
            expiresAt: result.expiresAt,
            issuer: claims["iss"],
            audience: claims["aud"],
          });
        } catch (jwtError) {
          // Log JWT verification failure with details
          const errorMessage =
            jwtError instanceof Error ? jwtError.message : String(jwtError);
          this.logger.error("JWT signature verification failed", {
            operation: context.operation,
            error: errorMessage,
            errorType:
              jwtError instanceof Error
                ? jwtError.constructor.name
                : typeof jwtError,
            tokenLength: context.tokenLength,
            tokenPrefix: context.tokenPrefix,
            hasJWKS: !!this.remoteJWKS,
            jwksEndpoint: this.jwksEndpoint,
          });

          // Fallback to token introspection
          result = await this.introspectToken(token);
        }
      } else {
        // No JWKS available, use Keycloak client validation
        this.logger.debug(
          "Using Keycloak client validation (no JWKS configured)",
          {
            operation: context.operation,
            hasJWKSEndpoint: !!this.jwksEndpoint,
            hasIssuer: !!this.config.jwt.issuer,
          }
        );
        result = await this.keycloakClient.validateToken(token);
      }

      // Cache successful validations for a short period
      if (this.cacheService && result.success) {
        const cacheKey = this.generateSecureCacheKey("jwt", token);
        const cacheTTL = this.config.cache.ttl.jwt;
        await this.cacheService.set(cacheKey, result, cacheTTL);
        this.metrics?.recordCounter(
          "keycloak.token_manager.jwt_validation_cache_set",
          1
        );
      }

      this.metrics?.recordCounter("keycloak.token_manager.jwt_validation", 1);
      this.metrics?.recordTimer(
        "keycloak.token_manager.jwt_validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("JWT validation failed", {
        operation: context.operation,
        error: errorMessage,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        tokenLength: context.tokenLength,
        tokenPrefix: context.tokenPrefix,
        timestamp: context.timestamp,
      });
      this.metrics?.recordCounter(
        "keycloak.token_manager.jwt_validation_error",
        1
      );

      return this.createErrorResult(
        errorMessage || "JWT token validation failed",
        error
      );
    }
  }

  /**
   * Extract roles from JWT claims
   */
  private extractRoles(claims: Record<string, unknown>): string[] {
    const roles: string[] = [];

    // Extract realm roles
    if (claims["realm_access"] && typeof claims["realm_access"] === "object") {
      const realmAccess = claims["realm_access"] as Record<string, unknown>;
      if (Array.isArray(realmAccess["roles"])) {
        roles.push(
          ...(realmAccess["roles"] as string[]).map((role) => `realm:${role}`)
        );
      }
    }

    // Extract resource/client roles
    if (
      claims["resource_access"] &&
      typeof claims["resource_access"] === "object"
    ) {
      const resourceAccess = claims["resource_access"] as Record<
        string,
        unknown
      >;
      for (const [resource, access] of Object.entries(resourceAccess)) {
        if (access && typeof access === "object") {
          const resourceRoles = (access as Record<string, unknown>)["roles"];
          if (Array.isArray(resourceRoles)) {
            roles.push(
              ...(resourceRoles as string[]).map(
                (role) => `${resource}:${role}`
              )
            );
          }
        }
      }
    }

    return roles;
  }

  /**
   * Extract permissions from JWT claims
   */
  private extractPermissions(claims: Record<string, unknown>): string[] {
    const permissions: string[] = [];

    // Extract from authorization claim (UMA permissions)
    if (
      claims["authorization"] &&
      typeof claims["authorization"] === "object"
    ) {
      const auth = claims["authorization"] as Record<string, unknown>;
      if (Array.isArray(auth["permissions"])) {
        permissions.push(...(auth["permissions"] as string[]));
      }
    }

    // Extract from scope claim
    if (claims["scope"] && typeof claims["scope"] === "string") {
      permissions.push(...(claims["scope"] as string).split(" "));
    }

    return permissions;
  }
  /**
   * Validate token using Keycloak introspection endpoint
   */
  async introspectToken(token: string): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      // Check cache first if enabled (shorter cache for introspection as it's typically for opaque tokens)
      if (this.cacheService) {
        const cacheKey = this.generateSecureCacheKey("introspect", token);
        const cachedResult = await this.cacheService.get<AuthResult>(cacheKey);
        if (cachedResult.data && cachedResult.source !== "miss") {
          this.metrics?.recordCounter(
            "keycloak.token_manager.introspection_cache_hit",
            1
          );
          return cachedResult.data;
        }
      }

      // Use Keycloak client for token introspection
      const result = await this.keycloakClient.introspectToken(token);

      // Cache successful introspections for a shorter period (opaque tokens can be revoked)
      if (this.cacheService && result.success) {
        const cacheKey = this.generateSecureCacheKey("introspect", token);
        const cacheTTL = 60; // 1 minute - very short cache for security
        await this.cacheService.set(cacheKey, result, cacheTTL);
        this.metrics?.recordCounter(
          "keycloak.token_manager.introspection_cache_set",
          1
        );
      }

      this.metrics?.recordCounter("keycloak.token_manager.introspection", 1);
      this.metrics?.recordTimer(
        "keycloak.token_manager.introspection_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("Token introspection failed", { error });
      this.metrics?.recordCounter(
        "keycloak.token_manager.introspection_error",
        1
      );

      return this.createErrorResult(
        error instanceof Error ? error.message : "Token introspection failed",
        error
      );
    }
  }

  /**
   * Validate token with fallback strategy (JWT first, then introspection)
   */
  async validateToken(
    token: string,
    useIntrospection = false
  ): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      let result: AuthResult;

      if (useIntrospection) {
        // Use introspection first (useful for opaque tokens)
        result = await this.introspectToken(token);

        // Fallback to JWT validation if introspection fails
        if (!result.success) {
          this.logger.debug(
            "Introspection failed, falling back to JWT validation"
          );
          result = await this.validateJwt(token);
        }
      } else {
        // Use JWT validation first (faster for JWT tokens)
        result = await this.validateJwt(token);

        // Fallback to introspection if JWT validation fails
        if (!result.success) {
          this.logger.debug(
            "JWT validation failed, falling back to introspection"
          );
          result = await this.introspectToken(token);
        }
      }

      this.metrics?.recordCounter("keycloak.token_manager.validation", 1);
      this.metrics?.recordTimer(
        "keycloak.token_manager.validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("Token validation failed", { error });
      this.metrics?.recordCounter("keycloak.token_manager.validation_error", 1);

      return this.createErrorResult(
        error instanceof Error ? error.message : "Token validation failed",
        error
      );
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractBearerToken(authorizationHeader?: string): string | null {
    if (!authorizationHeader || typeof authorizationHeader !== "string") {
      return null;
    }

    const bearerPrefix = "Bearer ";
    if (!authorizationHeader.startsWith(bearerPrefix)) {
      return null;
    }

    const token = authorizationHeader.slice(bearerPrefix.length).trim();
    return token.length > 0 ? token : null;
  }

  /**
   * Check if a role is present in user roles
   */
  hasRole(authResult: AuthResult, role: string): boolean {
    if (!authResult.success || !authResult.user?.roles) {
      return false;
    }

    return (
      authResult.user.roles.includes(role) ||
      authResult.user.roles.includes(`realm:${role}`)
    );
  }

  /**
   * Check if any of the required roles are present
   */
  hasAnyRole(authResult: AuthResult, requiredRoles: string[]): boolean {
    return requiredRoles.some((role) => this.hasRole(authResult, role));
  }

  /**
   * Check if a permission is present
   */
  hasPermission(authResult: AuthResult, permission: string): boolean {
    if (!authResult.success || !authResult.user?.permissions) {
      return false;
    }

    return authResult.user.permissions.includes(permission);
  }

  /**
   * Check if any of the required permissions are present
   */
  hasAnyPermission(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean {
    return requiredPermissions.some((permission) =>
      this.hasPermission(authResult, permission)
    );
  }

  /**
   * Check if token is expired based on auth result
   */
  isTokenExpired(authResult: AuthResult): boolean {
    if (!authResult.success || !authResult.expiresAt) {
      return true;
    }

    return new Date() >= authResult.expiresAt;
  }

  /**
   * Get remaining token lifetime in seconds
   */
  getTokenLifetime(authResult: AuthResult): number {
    if (!authResult.success || !authResult.expiresAt) {
      return 0;
    }

    const remaining = Math.floor(
      (authResult.expiresAt.getTime() - Date.now()) / 1000
    );
    return Math.max(0, remaining);
  }

  // ===== REFRESH TOKEN HELPER METHODS =====

  /**
   * Generate cache key for refresh token storage
   */
  private generateRefreshCacheKey(userId: string, sessionId: string): string {
    const hash = crypto
      .createHash("sha256")
      .update(`${userId}:${sessionId}`)
      .digest("hex");
    return `refresh_tokens:${hash.slice(0, 32)}`;
  }

  /**
   * Encrypt token info for secure storage using EncryptionManager
   */
  private encryptTokenInfo(tokenInfo: StoredTokenInfo): any {
    if (!this.encryptionManager) {
      return tokenInfo; // Return unencrypted if encryption not enabled
    }

    try {
      const serialized = JSON.stringify(tokenInfo, (key, value) => {
        if (key.endsWith("At") && value instanceof Date) {
          return { __type: "Date", value: value.toISOString() };
        }
        return value;
      });

      const encrypted = this.encryptionManager.encryptCompact(serialized);

      return {
        __encrypted: true,
        data: encrypted,
      };
    } catch (error) {
      this.logger.error("Failed to encrypt token info", {
        error: error instanceof Error ? error.message : String(error),
      });
      return tokenInfo; // Fallback to unencrypted
    }
  }

  /**
   * Decrypt token info from storage using EncryptionManager
   */
  private decryptTokenInfo(encryptedData: any): StoredTokenInfo {
    if (!encryptedData.__encrypted || !this.encryptionManager) {
      // Data is not encrypted, return as-is (backward compatibility)
      return this.deserializeTokenInfo(encryptedData);
    }

    try {
      const decrypted = this.encryptionManager.decryptCompact(
        encryptedData.data
      );

      const tokenInfo = JSON.parse(decrypted, (_key, value) => {
        if (value && typeof value === "object" && value.__type === "Date") {
          return new Date(value.value);
        }
        return value;
      });

      return this.deserializeTokenInfo(tokenInfo);
    } catch (error) {
      this.logger.error("Failed to decrypt token info", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("Token decryption failed");
    }
  }

  /**
   * Deserialize token info (convert date strings to Date objects)
   */
  private deserializeTokenInfo(data: any): StoredTokenInfo {
    return {
      ...data,
      expiresAt:
        typeof data.expiresAt === "string"
          ? new Date(data.expiresAt)
          : data.expiresAt,
      refreshExpiresAt: data.refreshExpiresAt
        ? typeof data.refreshExpiresAt === "string"
          ? new Date(data.refreshExpiresAt)
          : data.refreshExpiresAt
        : undefined,
      createdAt:
        typeof data.createdAt === "string"
          ? new Date(data.createdAt)
          : data.createdAt,
      lastRefreshedAt: data.lastRefreshedAt
        ? typeof data.lastRefreshedAt === "string"
          ? new Date(data.lastRefreshedAt)
          : data.lastRefreshedAt
        : undefined,
    };
  }

  /**
   * Schedule automatic token refresh
   */
  private scheduleTokenRefresh(
    userId: string,
    sessionId: string,
    expiresAt: Date
  ): void {
    const refreshKey = `${userId}:${sessionId}`;

    // Cancel existing timer if any
    if (this.refreshTimers.has(refreshKey)) {
      clearTimeout(this.refreshTimers.get(refreshKey)!);
    }

    // Calculate refresh time (buffer before expiration)
    const refreshTime = new Date(
      expiresAt.getTime() - this.refreshTokenConfig.refreshBuffer * 1000
    );
    const delay = Math.max(0, refreshTime.getTime() - Date.now());

    if (delay === 0) {
      // Token is already expired or about to expire, refresh immediately
      this.logger.debug("Token expires soon, refreshing immediately", {
        userId,
        sessionId,
        expiresAt: expiresAt.toISOString(),
      });

      this.refreshUserTokens(userId, sessionId).catch((error) => {
        this.logger.error("Immediate refresh failed", {
          userId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    // Schedule refresh
    const timer = setTimeout(async () => {
      this.logger.debug("Scheduled token refresh triggered", {
        userId,
        sessionId,
        scheduledFor: refreshTime.toISOString(),
      });

      try {
        await this.refreshUserTokens(userId, sessionId);
      } catch (error) {
        this.logger.error("Scheduled refresh failed", {
          userId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.refreshTimers.delete(refreshKey);
      }
    }, delay);

    this.refreshTimers.set(refreshKey, timer);

    this.logger.debug("Token refresh scheduled", {
      userId,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      refreshAt: refreshTime.toISOString(),
      delayMs: delay,
    });
  }

  /**
   * Get stored tokens with automatic refresh if needed
   * Only available when RefreshTokenManager is configured
   */
  async getStoredTokens(
    userId: string,
    sessionId: string
  ): Promise<StoredTokenInfo | null> {
    if (!this.refreshTokenConfig) {
      this.logger.debug(
        "Refresh token functionality not configured. Cannot retrieve stored tokens."
      );
      return null;
    }

    try {
      const cacheKey = this.generateRefreshCacheKey(userId, sessionId);
      const cachedResult = await this.cacheService?.get<string>(cacheKey);

      if (!cachedResult?.data) {
        return null;
      }

      const encryptedInfo = JSON.parse(cachedResult.data);
      return this.decryptTokenInfo(encryptedInfo);
    } catch (error) {
      this.logger.error("Failed to get stored tokens", {
        userId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Manually refresh tokens for a user session
   * Only available when RefreshTokenManager is configured
   */
  async refreshUserTokens(
    userId: string,
    sessionId: string
  ): Promise<RefreshResult> {
    if (!this.refreshTokenConfig) {
      throw new Error(
        "Refresh token functionality not configured. Cannot refresh tokens."
      );
    }

    const tokenInfo = await this.getStoredTokens(userId, sessionId);
    if (!tokenInfo) {
      return {
        success: false,
        error: "No stored tokens found",
        userId,
        sessionId,
        timestamp: new Date(),
      };
    }

    try {
      // Use KeycloakClient to refresh the token
      const refreshResult = await this.keycloakClient.refreshToken(
        tokenInfo.refreshToken
      );

      if (!refreshResult.access_token) {
        return {
          success: false,
          error: "Token refresh failed",
          userId,
          sessionId,
          timestamp: new Date(),
        };
      }

      // Store the new tokens
      await this.storeTokensWithRefresh(
        userId,
        sessionId,
        refreshResult.access_token,
        refreshResult.refresh_token || tokenInfo.refreshToken,
        refreshResult.expires_in,
        refreshResult.refresh_expires_in
      );

      this.logger.info("Tokens refreshed successfully", {
        userId,
        sessionId,
      });

      return {
        success: true,
        tokens: refreshResult,
        accessToken: refreshResult.access_token,
        refreshToken: refreshResult.refresh_token || tokenInfo.refreshToken,
        expiresIn: refreshResult.expires_in,
        userId,
        sessionId,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error("Token refresh failed", {
        userId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        userId,
        sessionId,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Remove stored tokens and cancel automatic refresh
   * Only available when RefreshTokenManager is configured
   */
  async removeStoredTokens(userId: string, sessionId: string): Promise<void> {
    if (!this.refreshTokenConfig) {
      this.logger.debug(
        "Refresh token functionality not configured. No stored tokens to remove."
      );
      return;
    }

    const cacheKey = this.generateRefreshCacheKey(userId, sessionId);
    await this.cacheService?.invalidate(cacheKey);

    // Cancel any scheduled refresh
    const refreshKey = `${userId}:${sessionId}`;
    if (this.refreshTimers.has(refreshKey)) {
      clearTimeout(this.refreshTimers.get(refreshKey)!);
      this.refreshTimers.delete(refreshKey);
    }

    this.logger.debug("Stored tokens removed", {
      userId,
      sessionId,
    });
  }

  /**
   * Check if stored tokens exist and are valid
   * Only available when RefreshTokenManager is configured
   */
  async hasValidStoredTokens(
    userId: string,
    sessionId: string
  ): Promise<boolean> {
    if (!this.refreshTokenConfig) {
      return false;
    }

    const tokenInfo = await this.getStoredTokens(userId, sessionId);
    if (!tokenInfo) {
      return false;
    }

    const now = new Date();

    // Check if access token is still valid
    if (tokenInfo.expiresAt > now) {
      return true;
    }

    // Check if refresh token is still valid
    if (tokenInfo.refreshExpiresAt && tokenInfo.refreshExpiresAt > now) {
      return true;
    }

    return false;
  }

  /**
   * Check if RefreshTokenManager is available
   */
  hasRefreshTokenSupport(): boolean {
    return !!this.refreshTokenConfig;
  }

  /**
   * Configure refresh token functionality
   */
  configureRefreshTokens(
    config: Partial<RefreshTokenConfig>,
    eventHandlers: RefreshTokenEventHandlers = {}
  ): void {
    // Merge with default config
    const defaultRefreshConfig: Omit<RefreshTokenConfig, "encryptionKey"> & {
      encryptionKey?: string;
    } = {
      refreshBuffer: 300, // 5 minutes
      maxRetries: 3,
      retryBaseDelay: 1000, // 1 second
      maxRetryDelay: 30000, // 30 seconds
      enableEncryption: false,
      cleanupInterval: 300000, // 5 minutes
    };

    this.refreshTokenConfig = {
      ...defaultRefreshConfig,
      ...config,
    } as RefreshTokenConfig;
    this.refreshEventHandlers = eventHandlers;

    if (
      this.refreshTokenConfig.enableEncryption &&
      this.refreshTokenConfig.encryptionKey
    ) {
      this.encryptionManager = createEncryptionManager(
        this.refreshTokenConfig.encryptionKey
      );
    }

    this.logger.info("Refresh token functionality configured", {
      refreshBuffer: this.refreshTokenConfig.refreshBuffer,
      maxRetries: this.refreshTokenConfig.maxRetries,
      enableEncryption: this.refreshTokenConfig.enableEncryption,
      cleanupInterval: this.refreshTokenConfig.cleanupInterval,
    });
  }

  /**
   * Store tokens with refresh token support
   */
  async storeTokensWithRefresh(
    userId: string,
    sessionId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
    refreshExpiresIn?: number
  ): Promise<void> {
    if (!this.refreshTokenConfig) {
      throw new Error("Refresh token functionality not configured");
    }

    // Parse access token to get expiration info using jose library
    let decodedToken: any = {};
    try {
      const payload = decodeJwt(accessToken);
      decodedToken = payload;
    } catch (error) {
      this.logger.warn("Could not parse access token payload", { error });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresIn * 1000);
    const refreshExpiresAt = refreshExpiresIn
      ? new Date(now.getTime() + refreshExpiresIn * 1000)
      : undefined;

    const tokenInfo: StoredTokenInfo = {
      accessToken,
      refreshToken,
      expiresAt,
      tokenType: "Bearer",
      scope: decodedToken.scope || "",
      userId,
      sessionId,
      createdAt: now,
      refreshCount: 0,
    };

    // Add refreshExpiresAt only if it exists
    if (refreshExpiresAt) {
      (tokenInfo as any).refreshExpiresAt = refreshExpiresAt;
    }

    // Store encrypted token info
    const cacheKey = this.generateRefreshCacheKey(userId, sessionId);
    const encryptedInfo = this.encryptTokenInfo(tokenInfo);

    await this.cacheService?.set(
      cacheKey,
      JSON.stringify(encryptedInfo),
      Math.floor(this.refreshTokenConfig.cleanupInterval / 1000)
    );

    // Schedule automatic refresh
    this.scheduleTokenRefresh(userId, sessionId, expiresAt);

    // Emit token stored event
    if (this.refreshEventHandlers?.onTokenStored) {
      const event: TokenRefreshEvent = {
        type: "token_stored",
        userId,
        sessionId,
        timestamp: now,
        success: true,
        metadata: {
          expiresAt: expiresAt.toISOString(),
          ...(refreshExpiresAt && {
            refreshExpiresAt: refreshExpiresAt.toISOString(),
          }),
        },
      };

      try {
        await this.refreshEventHandlers.onTokenStored(event);
      } catch (error) {
        this.logger.error("Token stored event handler failed", {
          userId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info("Tokens stored with refresh support", {
      userId,
      sessionId,
      expiresAt: expiresAt.toISOString(),
      refreshExpiresAt: refreshExpiresAt?.toISOString(),
      hasRefreshToken: !!refreshToken,
    });
  }

  /**
   * Get refresh token manager statistics
   * Only available when refresh token functionality is configured
   */
  getRefreshTokenStats() {
    if (!this.refreshTokenConfig) {
      return null;
    }

    return {
      enabled: true,
      config: this.refreshTokenConfig,
      activeTimers: this.refreshTimers.size,
    };
  }
}

/**
 * Create TokenManager with refresh token functionality
 */
export function createTokenManagerWithRefresh(
  keycloakClient: KeycloakClient,
  config: AuthV2Config,
  refreshConfig: Partial<RefreshTokenConfig> = {},
  metrics?: IMetricsCollector,
  refreshEventHandlers: RefreshTokenEventHandlers = {}
): TokenManager {
  // Create token manager with refresh functionality directly integrated
  const tokenManager = new TokenManager(keycloakClient, config, metrics);

  // Configure refresh token functionality
  tokenManager.configureRefreshTokens(refreshConfig, refreshEventHandlers);

  return tokenManager;
}

/**
 * Create basic TokenManager without refresh functionality
 */
export function createBasicTokenManager(
  keycloakClient: KeycloakClient,
  config: AuthV2Config,
  metrics?: IMetricsCollector
): TokenManager {
  return new TokenManager(keycloakClient, config, metrics);
}
