/**
 * Refactored Token Manager Service
 * Orchestrates focused services for token validation and management
   /**
   * Validate JWT token using signature verification  
   */
import { z } from "zod";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult } from "../../types";
import type { AuthV2Config } from "./config";
import { KeycloakClient } from "../../client/KeycloakClient";

// Import focused services
import { JWTValidator } from "./JWTValidator";
import { SecureCacheManager } from "../SecureCacheManager";
import {
  RefreshTokenManager,
  type RefreshTokenConfig,
  type RefreshTokenEventHandlers,
  type RefreshResult,
  type StoredTokenInfo,
} from "./RefreshTokenManager";
import { RolePermissionExtractor } from "./RolePermissionExtractor";
import type { SessionStore } from "../session/SessionStore";

// Zod schemas for validation
const AuthorizationHeaderSchema = z
  .string()
  .min(1, "Authorization header cannot be empty")
  .max(8192, "Authorization header too large")
  .trim();

// Basic token format validation for extraction
const TokenSchema = z
  .string()
  .min(10, "Token must be at least 10 characters")
  .max(8192, "Token too large (max 8192 characters)");

export interface ITokenManager {
  initialize(
    refreshConfig?: Partial<RefreshTokenConfig>,
    refreshEventHandlers?: RefreshTokenEventHandlers
  ): Promise<void>;
  validateJwt(token: string): Promise<AuthResult>;
  introspectToken(token: string): Promise<AuthResult>;
  validateToken(token: string, useIntrospection?: boolean): Promise<AuthResult>;
  extractBearerToken(authorizationHeader?: string): string | null;
  clearTokenFromMemory(token: string): void;
  hasRole(authResult: AuthResult, role: string): boolean;
  hasAnyRole(authResult: AuthResult, requiredRoles: string[]): boolean;
  hasAllRoles(authResult: AuthResult, requiredRoles: string[]): boolean;
  hasPermission(authResult: AuthResult, permission: string): boolean;
  hasAnyPermission(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean;
  hasAllPermissions(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean;
  isTokenExpired(authResult: AuthResult): boolean;
  getTokenLifetime(authResult: AuthResult): number;
  willExpireSoon(authResult: AuthResult, withinSeconds: number): boolean;
  getStoredTokens(
    userId: string,
    sessionId: string
  ): Promise<StoredTokenInfo | null>;
  refreshUserTokens(userId: string, sessionId: string): Promise<RefreshResult>;
  storeTokensWithRefresh(
    userId: string,
    sessionId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
    refreshExpiresIn?: number
  ): Promise<void>;
  removeStoredTokens(userId: string, sessionId: string): Promise<void>;
  hasValidStoredTokens(userId: string, sessionId: string): Promise<boolean>;
  hasRefreshTokenSupport(): boolean;
  configureRefreshTokens(
    config: Partial<RefreshTokenConfig>,
    eventHandlers?: RefreshTokenEventHandlers
  ): void;
  getRefreshTokenStats(): any;
  dispose(): Promise<void>;
}

export class TokenManager implements ITokenManager {
  private readonly logger = createLogger("TokenManager");
  private jwtValidator!: JWTValidator;
  private readonly cacheManager: SecureCacheManager;
  private _refreshTokenManager: RefreshTokenManager | undefined;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly config: AuthV2Config,
    private readonly metrics?: IMetricsCollector
  ) {
    // Validate required inputs
    if (!keycloakClient) {
      throw new Error("KeycloakClient is required");
    }
    if (!config) {
      throw new Error("Config is required");
    }

    // Initialize lightweight services in constructor
    this.cacheManager = new SecureCacheManager(config.cache.enabled, metrics);
  }

  /**
   * Initialize JWT validator and optional refresh token manager
   * Must be called before using the TokenManager
   * Thread-safe: Multiple concurrent calls will wait for the first initialization
   */
  async initialize(
    refreshConfig: Partial<RefreshTokenConfig> = {},
    refreshEventHandlers: RefreshTokenEventHandlers = {},
    sessionStore?: SessionStore
  ): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Wait for ongoing initialization
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Start initialization
    this.initializationPromise = this.doInitialize(
      refreshConfig,
      refreshEventHandlers,
      sessionStore
    );

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Internal initialization logic
   */
  private async doInitialize(
    refreshConfig: Partial<RefreshTokenConfig>,
    refreshEventHandlers: RefreshTokenEventHandlers,
    sessionStore?: SessionStore
  ): Promise<void> {
    try {
      // Initialize JWT validator with proper configuration
      const jwksEndpoint = this.getJWKSEndpoint();
      if (!jwksEndpoint || !this.config.jwt.issuer) {
        throw new Error(
          "JWKS endpoint and issuer must be configured for JWT validation"
        );
      }

      this.jwtValidator = new JWTValidator(
        jwksEndpoint,
        this.config.jwt.issuer,
        this.config.jwt.audience,
        this.metrics,
        this.cacheManager
      );

      // Initialize refresh token manager if configuration provided and sessionStore available
      if (Object.keys(refreshConfig).length > 0 && sessionStore) {
        const defaultRefreshConfig: RefreshTokenConfig = {
          refreshBuffer: 300,
          enableEncryption: true,
          cleanupInterval: 300000,
          ...refreshConfig,
        };

        this._refreshTokenManager = new RefreshTokenManager(
          this.keycloakClient,
          sessionStore,
          this.cacheManager,
          defaultRefreshConfig,
          refreshEventHandlers,
          this.metrics
        );
      }

      this.initialized = true;

      this.logger.debug("TokenManager initialized", {
        jwksEndpoint,
        cacheEnabled: this.cacheManager.isEnabled,
        hasRefreshSupport: !!this._refreshTokenManager,
      });
    } catch (error) {
      throw new Error(
        `TokenManager initialization failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get JWKS endpoint from configuration
   * NOTE: Default JWKS path follows Keycloak's standard OpenID Connect discovery format
   */
  private getJWKSEndpoint(): string {
    if (this.config.jwt.jwksUrl) {
      return this.config.jwt.jwksUrl;
    } else if (this.config.jwt.issuer) {
      // Standard Keycloak JWKS endpoint pattern
      return `${this.config.jwt.issuer}/protocol/openid_connect/certs`;
    }
    throw new Error(
      "JWKS endpoint must be configured either via 'jwt.jwksUrl' or 'jwt.issuer'"
    );
  }

  /**
   * Check if TokenManager is properly initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        "TokenManager must be initialized before use. Call initialize() first."
      );
    }
  }

  /**
   * Validate JWT token using signature verification
   */
  async validateJwt(token: string): Promise<AuthResult> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      // Check cache first
      if (this.cacheManager.isEnabled) {
        const cachedResult = await this.cacheManager.get<AuthResult>(
          "jwt",
          token
        );
        if (cachedResult.hit && cachedResult.data) {
          this.logger.debug("JWT validation cache hit");
          return cachedResult.data;
        }
      }

      // Use JWT validator
      const result = await this.jwtValidator.validateJWT(token);

      // Cache successful validations
      if (this.cacheManager.isEnabled && result.success) {
        await this.cacheManager.set(
          "jwt",
          token,
          result,
          this.config.cache.ttl.jwt
        );
      }

      this.metrics?.recordCounter("token_manager.jwt_validation", 1);
      this.metrics?.recordTimer(
        "token_manager.jwt_validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("JWT validation failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : "JWT validation failed",
      };
    }
  }

  /**
   * Validate token using Keycloak introspection endpoint
   */
  async introspectToken(token: string): Promise<AuthResult> {
    this.ensureInitialized();
    const startTime = performance.now();

    // Validate token format
    try {
      TokenSchema.parse(token);
    } catch (error) {
      this.logger.error("Token format validation failed", {
        error: error instanceof Error ? error.message : String(error),
        tokenLength: token.length,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Invalid token format",
      };
    }

    try {
      // Check cache first (shorter cache for introspection)
      if (this.cacheManager.isEnabled) {
        const cachedResult = await this.cacheManager.get<AuthResult>(
          "introspect",
          token
        );
        if (cachedResult.hit && cachedResult.data) {
          this.logger.debug("Introspection cache hit");
          return cachedResult.data;
        }
      }

      // Call Keycloak client directly for token introspection
      const result = await this.keycloakClient.introspectToken(token);

      this.logger.debug("Token introspection completed", {
        success: result.success,
        userId: result.user?.id,
      });

      // Cache successful introspections for a short period
      if (this.cacheManager.isEnabled && result.success) {
        await this.cacheManager.set("introspect", token, result, 60); // 1 minute
      }

      this.metrics?.recordCounter("token_manager.introspection", 1);
      this.metrics?.recordTimer(
        "token_manager.introspection_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("Token introspection failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Token introspection failed",
      };
    }
  }

  /**
   * Validate token with fallback strategy (JWT first, then introspection)
   */
  async validateToken(
    token: string,
    useIntrospection = false
  ): Promise<AuthResult> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      let result: AuthResult;

      if (useIntrospection) {
        // Use introspection first
        result = await this.introspectToken(token);

        // Fallback to JWT validation if introspection fails
        if (!result.success) {
          this.logger.debug(
            "Introspection failed, falling back to JWT validation"
          );
          result = await this.validateJwt(token);
        }
      } else {
        // Use JWT validation first
        result = await this.validateJwt(token);

        // Fallback to introspection if JWT validation fails
        if (!result.success) {
          this.logger.debug(
            "JWT validation failed, falling back to introspection"
          );
          result = await this.introspectToken(token);
        }
      }

      this.metrics?.recordCounter("token_manager.validation", 1);
      this.metrics?.recordTimer(
        "token_manager.validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("Token validation failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Token validation failed",
      };
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractBearerToken(authorizationHeader?: string): string | null {
    if (!authorizationHeader) {
      return null;
    }

    // Validate authorization header format
    try {
      AuthorizationHeaderSchema.parse(authorizationHeader);
    } catch (error) {
      this.logger.debug("Invalid authorization header format", {
        error: error instanceof Error ? error.message : String(error),
        headerLength: authorizationHeader.length,
      });
      return null;
    }

    const bearerPrefix = "Bearer ";
    if (!authorizationHeader.startsWith(bearerPrefix)) {
      return null;
    }

    const token = authorizationHeader.slice(bearerPrefix.length).trim();

    // Validate extracted token
    try {
      TokenSchema.parse(token);
      return token;
    } catch (error) {
      this.logger.debug("Invalid token format in Bearer header", {
        error: error instanceof Error ? error.message : String(error),
        tokenLength: token.length,
      });
      return null;
    }
  }
  /**
   * Securely clear token from memory
   * NOTE: JavaScript strings are immutable - this is a best-effort operation
   * and cannot guarantee the original string is cleared from V8's heap.
   * This method is provided for defense-in-depth but should not be relied upon
   * for security-critical token disposal.
   */
  clearTokenFromMemory(token: string): void {
    try {
      // Create a buffer copy and zero it (doesn't affect original string in V8 heap)
      if (typeof token === "string" && token.length > 0) {
        const buffer = Buffer.from(token);
        buffer.fill(0);
      }
    } catch (error) {
      // Silent failure - this is best-effort only
      this.logger.debug("Token memory clearing attempted", { error });
    }
  }
  // Delegate role and permission methods to RolePermissionExtractor
  hasRole(authResult: AuthResult, role: string): boolean {
    return RolePermissionExtractor.hasRole(authResult, role);
  }

  hasAnyRole(authResult: AuthResult, requiredRoles: string[]): boolean {
    return RolePermissionExtractor.hasAnyRole(authResult, requiredRoles);
  }

  hasAllRoles(authResult: AuthResult, requiredRoles: string[]): boolean {
    return RolePermissionExtractor.hasAllRoles(authResult, requiredRoles);
  }

  hasPermission(authResult: AuthResult, permission: string): boolean {
    return RolePermissionExtractor.hasPermission(authResult, permission);
  }

  hasAnyPermission(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean {
    return RolePermissionExtractor.hasAnyPermission(
      authResult,
      requiredPermissions
    );
  }

  hasAllPermissions(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean {
    return RolePermissionExtractor.hasAllPermissions(
      authResult,
      requiredPermissions
    );
  }

  isTokenExpired(authResult: AuthResult): boolean {
    return RolePermissionExtractor.isTokenExpired(authResult);
  }

  getTokenLifetime(authResult: AuthResult): number {
    return RolePermissionExtractor.getTokenLifetime(authResult);
  }

  willExpireSoon(authResult: AuthResult, withinSeconds: number): boolean {
    return RolePermissionExtractor.willExpireSoon(authResult, withinSeconds);
  }

  // Refresh token management methods - delegate to RefreshTokenManager
  async getStoredTokens(
    userId: string,
    sessionId: string
  ): Promise<StoredTokenInfo | null> {
    if (!this._refreshTokenManager) {
      this.logger.debug("Refresh token functionality not configured");
      return null;
    }
    return this._refreshTokenManager.getStoredTokens(userId, sessionId);
  }

  async refreshUserTokens(
    userId: string,
    sessionId: string
  ): Promise<RefreshResult> {
    if (!this._refreshTokenManager) {
      throw new Error("Refresh token functionality not configured");
    }
    return this._refreshTokenManager.refreshUserTokens(userId, sessionId);
  }

  async storeTokensWithRefresh(
    userId: string,
    sessionId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
    refreshExpiresIn?: number
  ): Promise<void> {
    if (!this._refreshTokenManager) {
      throw new Error("Refresh token functionality not configured");
    }
    return this._refreshTokenManager.storeTokensWithRefresh(
      userId,
      sessionId,
      accessToken,
      refreshToken,
      expiresIn,
      refreshExpiresIn
    );
  }

  async removeStoredTokens(userId: string, sessionId: string): Promise<void> {
    if (!this._refreshTokenManager) {
      return;
    }
    return this._refreshTokenManager.removeStoredTokens(userId, sessionId);
  }

  async hasValidStoredTokens(
    userId: string,
    sessionId: string
  ): Promise<boolean> {
    if (!this._refreshTokenManager) {
      return false;
    }
    return this._refreshTokenManager.hasValidStoredTokens(userId, sessionId);
  }

  hasRefreshTokenSupport(): boolean {
    return !!this._refreshTokenManager;
  }

  configureRefreshTokens(
    config: Partial<RefreshTokenConfig>,
    eventHandlers: RefreshTokenEventHandlers = {},
    sessionStore?: SessionStore
  ): void {
    if (!sessionStore) {
      this.logger.warn(
        "Cannot configure refresh tokens without SessionStore (needed for token vault)"
      );
      return;
    }

    const defaultRefreshConfig: RefreshTokenConfig = {
      refreshBuffer: 300,
      enableEncryption: true,
      cleanupInterval: 300000,
      ...config,
    };

    this._refreshTokenManager = new RefreshTokenManager(
      this.keycloakClient,
      sessionStore,
      this.cacheManager,
      defaultRefreshConfig,
      eventHandlers,
      this.metrics
    );

    this.logger.info("Refresh token functionality configured");
  }

  getRefreshTokenStats() {
    if (!this._refreshTokenManager) {
      return null;
    }
    return this._refreshTokenManager.getRefreshTokenStats();
  }

  /**
   * Dispose and cleanup all resources
   * Call this when the application is shutting down or the TokenManager is no longer needed
   */
  async dispose(): Promise<void> {
    this.logger.debug("Disposing TokenManager resources");

    // Dispose refresh token manager if present
    if (this._refreshTokenManager) {
      await this._refreshTokenManager.dispose();
      this._refreshTokenManager = undefined;
    }

    this.initialized = false;
    this.logger.info("TokenManager disposed successfully");
  }
}

/**
 * Create TokenManager with refresh token functionality
 */
export async function createTokenManagerWithRefresh(
  keycloakClient: KeycloakClient,
  config: AuthV2Config,
  refreshConfig: Partial<RefreshTokenConfig> = {},
  metrics?: IMetricsCollector,
  refreshEventHandlers: RefreshTokenEventHandlers = {}
): Promise<TokenManager> {
  const tokenManager = new TokenManager(keycloakClient, config, metrics);
  await tokenManager.initialize(refreshConfig, refreshEventHandlers);
  return tokenManager;
}

/**
 * Create basic TokenManager without refresh functionality
 */
export async function createBasicTokenManager(
  keycloakClient: KeycloakClient,
  config: AuthV2Config,
  metrics?: IMetricsCollector
): Promise<TokenManager> {
  const tokenManager = new TokenManager(keycloakClient, config, metrics);
  await tokenManager.initialize();
  return tokenManager;
}

// Re-export types for convenience
export type {
  RefreshTokenConfig,
  RefreshTokenEventHandlers,
  RefreshResult,
  StoredTokenInfo,
} from "./RefreshTokenManager";
