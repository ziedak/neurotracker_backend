/**
 * Refactored Token Manager Service
 * Orchestrates focused services for token validation and management
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult } from "../types";
import type { AuthV2Config } from "./config";
import { KeycloakClient } from "../client/KeycloakClient";

// Import focused services
import { JWTValidator } from "./JWTValidator";
import { SecureCacheManager } from "./SecureCacheManager";
import { TokenIntrospector } from "./TokenIntrospector";
import {
  RefreshTokenManager,
  type RefreshTokenConfig,
  type RefreshTokenEventHandlers,
  type RefreshResult,
  type StoredTokenInfo,
} from "./RefreshTokenManager";
import { RolePermissionExtractor } from "./RolePermissionExtractor";

export class TokenManager {
  private readonly logger = createLogger("TokenManager");
  private readonly jwtValidator: JWTValidator;
  private readonly cacheManager: SecureCacheManager;
  private readonly introspector: TokenIntrospector;
  private refreshTokenManager?: RefreshTokenManager;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly config: AuthV2Config,
    private readonly metrics?: IMetricsCollector,
    refreshConfig: Partial<RefreshTokenConfig> = {},
    refreshEventHandlers: RefreshTokenEventHandlers = {}
  ) {
    // Initialize focused services
    this.cacheManager = new SecureCacheManager(config.cache.enabled, metrics);

    this.introspector = new TokenIntrospector(keycloakClient, metrics);

    // Initialize JWT validator with proper configuration
    const jwksEndpoint = this.getJWKSEndpoint();
    if (jwksEndpoint && config.jwt.issuer) {
      this.jwtValidator = new JWTValidator(
        jwksEndpoint,
        config.jwt.issuer,
        config.jwt.audience,
        metrics
      );
    } else {
      throw new Error(
        "JWKS endpoint and issuer must be configured for JWT validation"
      );
    }

    // Initialize refresh token manager if configuration provided
    if (Object.keys(refreshConfig).length > 0) {
      const defaultRefreshConfig: RefreshTokenConfig = {
        refreshBuffer: 300,
        enableEncryption: true,
        cleanupInterval: 300000,
        ...refreshConfig,
      };

      this.refreshTokenManager = new RefreshTokenManager(
        keycloakClient,
        this.cacheManager,
        defaultRefreshConfig,
        refreshEventHandlers,
        metrics
      );
    }

    this.logger.debug("TokenManager initialized", {
      jwksEndpoint,
      cacheEnabled: this.cacheManager.isEnabled,
      hasRefreshSupport: !!this.refreshTokenManager,
    });
  }

  /**
   * Get JWKS endpoint from configuration
   */
  private getJWKSEndpoint(): string {
    if (this.config.jwt.jwksUrl) {
      return this.config.jwt.jwksUrl;
    } else if (this.config.jwt.issuer) {
      return `${this.config.jwt.issuer}/protocol/openid_connect/certs`;
    }
    throw new Error(
      "JWKS endpoint must be configured either via 'jwt.jwksUrl' or 'jwt.issuer'"
    );
  }

  /**
   * Validate JWT token using signature verification
   */
  async validateJwt(token: string): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      // Check cache first
      if (this.cacheManager.isEnabled) {
        const cachedResult = await this.cacheManager.get("jwt", token);
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
    const startTime = performance.now();

    try {
      // Check cache first (shorter cache for introspection)
      if (this.cacheManager.isEnabled) {
        const cachedResult = await this.cacheManager.get("introspect", token);
        if (cachedResult.hit && cachedResult.data) {
          this.logger.debug("Introspection cache hit");
          return cachedResult.data;
        }
      }

      // Use token introspector
      const result = await this.introspector.introspectToken(token);

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
    if (!this.refreshTokenManager) {
      this.logger.debug("Refresh token functionality not configured");
      return null;
    }
    return this.refreshTokenManager.getStoredTokens(userId, sessionId);
  }

  async refreshUserTokens(
    userId: string,
    sessionId: string
  ): Promise<RefreshResult> {
    if (!this.refreshTokenManager) {
      throw new Error("Refresh token functionality not configured");
    }
    return this.refreshTokenManager.refreshUserTokens(userId, sessionId);
  }

  async storeTokensWithRefresh(
    userId: string,
    sessionId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
    refreshExpiresIn?: number
  ): Promise<void> {
    if (!this.refreshTokenManager) {
      throw new Error("Refresh token functionality not configured");
    }
    return this.refreshTokenManager.storeTokensWithRefresh(
      userId,
      sessionId,
      accessToken,
      refreshToken,
      expiresIn,
      refreshExpiresIn
    );
  }

  async removeStoredTokens(userId: string, sessionId: string): Promise<void> {
    if (!this.refreshTokenManager) {
      return;
    }
    return this.refreshTokenManager.removeStoredTokens(userId, sessionId);
  }

  async hasValidStoredTokens(
    userId: string,
    sessionId: string
  ): Promise<boolean> {
    if (!this.refreshTokenManager) {
      return false;
    }
    return this.refreshTokenManager.hasValidStoredTokens(userId, sessionId);
  }

  hasRefreshTokenSupport(): boolean {
    return !!this.refreshTokenManager;
  }

  configureRefreshTokens(
    config: Partial<RefreshTokenConfig>,
    eventHandlers: RefreshTokenEventHandlers = {}
  ): void {
    const defaultRefreshConfig: RefreshTokenConfig = {
      refreshBuffer: 300,
      enableEncryption: true,
      cleanupInterval: 300000,
      ...config,
    };

    this.refreshTokenManager = new RefreshTokenManager(
      this.keycloakClient,
      this.cacheManager,
      defaultRefreshConfig,
      eventHandlers,
      this.metrics
    );

    this.logger.info("Refresh token functionality configured");
  }

  getRefreshTokenStats() {
    if (!this.refreshTokenManager) {
      return null;
    }
    return this.refreshTokenManager.getRefreshTokenStats();
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
  return new TokenManager(
    keycloakClient,
    config,
    metrics,
    refreshConfig,
    refreshEventHandlers
  );
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

// Re-export types for convenience
export type {
  RefreshTokenConfig,
  RefreshTokenEventHandlers,
  RefreshResult,
  StoredTokenInfo,
} from "./RefreshTokenManager";
