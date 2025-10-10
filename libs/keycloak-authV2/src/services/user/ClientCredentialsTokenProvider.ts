/**
 * ClientCredentialsTokenProvider - Enterprise-grade admin token management
 *
 * Purpose: Manages OAuth2 Client Credentials flow tokens for Keycloak Admin API
 *
 * Key Features:
 * - Automatic token refresh with safety buffer
 * - Multi-layer caching (memory + Redis) via SecureCacheManager
 * - Comprehensive JWT validation (signature, claims, scopes)
 * - Comprehensive metrics and monitoring
 * - Thread-safe token acquisition
 * - Retry logic with exponential backoff for transient failures
 * - Configurable token scopes and retry strategies
 *
 * Token Validation (Enterprise-Grade):
 * - JWT signature verification using JWKS
 * - Claims validation (issuer, audience, expiry)
 * - Scope validation against required scopes
 * - Replay attack protection via jti/iat claims
 * - Comprehensive error handling and metrics
 *
 * Architecture:
 * - Leverages SecureCacheManager for enterprise-grade caching (no duplicate memory layer)
 * - Uses JWTValidator for comprehensive token validation (same as TokenManager)
 * - Thread-safe token acquisition prevents concurrent refreshes
 * - Exponential backoff retry strategy for resilience
 *
 * SOLID Principles:
 * - Single Responsibility: Only manages client credentials tokens
 * - Open/Closed: Extensible through configuration
 * - Dependency Inversion: Depends on KeycloakClient, SecureCacheManager, and JWTValidator abstractions
 */ import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  KeycloakClient,
  KeycloakTokenResponse,
} from "../../client/KeycloakClient";
import { SecureCacheManager } from "../SecureCacheManager";
import { JWTValidator } from "../token/JWTValidator";
import { RETRY_CONFIG } from "./constants";

/**
 * Configuration for client credentials token provider
 */
interface ClientCredentialsConfig {
  /** Required OAuth2 scopes for admin operations */
  requiredScopes: string[];
  /** Safety buffer in seconds before token expiry (default: 30) */
  safetyBufferSeconds: number;
  /** Enable secure token caching (default: true) */
  enableCaching: boolean;
  /** Cache TTL in seconds (default: calculated from token expiry) */
  cacheTtl?: number;
  /** Maximum retry attempts for token acquisition (default: 3) */
  maxRetries: number;
  /** Retry delay in milliseconds (default: 1000) */
  retryDelayMs: number;
  /** Enable JWT signature validation (default: true) */
  enableJwtValidation: boolean;
  /** JWKS endpoint for JWT validation (required if enableJwtValidation is true) */
  jwksEndpoint?: string;
  /** Expected JWT issuer (required if enableJwtValidation is true) */
  issuer?: string;
  /** Expected JWT audience (optional) */
  audience?: string;
}

/**
 * Default scopes for client credentials flow
 * NOTE: These are OAuth scopes, not Keycloak admin role names.
 * Admin permissions should be assigned to the service account via Keycloak admin console.
 *
 * For accessing Keycloak Admin API, the service account needs realm-management client roles assigned:
 * - manage-users, view-users, query-users (for user management)
 * - manage-realm, view-realm (for realm management)
 * - manage-clients (for client management)
 * - query-groups (for group management)
 */
export const DEFAULT_ADMIN_SCOPES = ["openid", "profile", "email"];

/**
 * Interface for admin token management (replaces IAdminTokenManager)
 */
export interface IClientCredentialsTokenProvider {
  getValidToken(): Promise<string>;
  invalidateToken(): Promise<void>;
  getTokenInfo(): Promise<TokenInfo | null>;
}

/**
 * Token information with expiration details
 */
interface TokenInfo {
  expiresAt: Date;
  scopes: string[];
  issuedAt: Date;
  timeToExpiry: number; // seconds
}

/**
 * ClientCredentialsTokenProvider - Production-grade admin token management
 */
export class ClientCredentialsTokenProvider
  implements IClientCredentialsTokenProvider
{
  private readonly logger: ILogger = createLogger(
    "ClientCredentialsTokenProvider"
  );
  private readonly cacheManager: SecureCacheManager;
  private readonly config: ClientCredentialsConfig;
  private readonly cacheKey = "keycloak_admin_token";
  private jwtValidator?: JWTValidator;

  // Thread-safety: Prevent concurrent token refreshes
  private refreshPromise?: Promise<KeycloakTokenResponse> | undefined;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    config: Partial<ClientCredentialsConfig> = {},
    private readonly metrics?: IMetricsCollector
  ) {
    // Merge with defaults
    const baseConfig = {
      requiredScopes: config.requiredScopes || DEFAULT_ADMIN_SCOPES,
      safetyBufferSeconds: config.safetyBufferSeconds ?? 30,
      enableCaching: config.enableCaching ?? true,
      maxRetries: config.maxRetries ?? RETRY_CONFIG.MAX_ATTEMPTS,
      retryDelayMs: config.retryDelayMs ?? RETRY_CONFIG.BASE_DELAY_MS,
      enableJwtValidation: config.enableJwtValidation ?? true,
    };

    // Handle optional properties with exactOptionalPropertyTypes: true
    this.config = {
      ...baseConfig,
      ...(config.jwksEndpoint !== undefined && {
        jwksEndpoint: config.jwksEndpoint,
      }),
      ...(config.issuer !== undefined && { issuer: config.issuer }),
      ...(config.audience !== undefined && { audience: config.audience }),
      ...(config.cacheTtl !== undefined && { cacheTtl: config.cacheTtl }),
    } as ClientCredentialsConfig;

    // Initialize cache manager
    this.cacheManager = new SecureCacheManager(
      this.config.enableCaching,
      metrics
    );

    // Initialize JWT validator if enabled
    if (this.config.enableJwtValidation) {
      if (!this.config.jwksEndpoint || !this.config.issuer) {
        throw new Error(
          "JWT validation enabled but jwksEndpoint or issuer not provided"
        );
      }
      this.jwtValidator = new JWTValidator(
        this.config.jwksEndpoint,
        this.config.issuer,
        this.config.audience,
        metrics,
        this.cacheManager
      );
    }

    this.logger.debug("ClientCredentialsTokenProvider initialized", {
      scopes: this.config.requiredScopes,
      safetyBuffer: this.config.safetyBufferSeconds,
      cachingEnabled: this.config.enableCaching,
      jwtValidationEnabled: this.config.enableJwtValidation,
    });
  }

  /**
   * Get a valid admin token with automatic refresh
   * Thread-safe: Concurrent calls will wait for the same token acquisition
   */
  async getValidToken(): Promise<string> {
    const startTime = performance.now();

    this.logger.info("🎯 getValidToken called", {
      cachingEnabled: this.config.enableCaching,
    });

    try {
      // Check secure cache (handles multi-layer: memory + Redis)
      if (this.config.enableCaching) {
        this.logger.info("🔍 Checking cache for token");
        const cachedToken = await this.getCachedToken();
        if (cachedToken) {
          this.logger.info("✅ Found cached token", {
            hasAccessToken: !!cachedToken.access_token,
            accessTokenLength: cachedToken.access_token?.length,
            accessTokenType: typeof cachedToken.access_token,
            expiresIn: cachedToken.expires_in,
            tokenKeys: Object.keys(cachedToken),
          });
          if (!cachedToken.access_token) {
            this.logger.error(
              "❌ CRITICAL: Cached token has no access_token field!"
            );
          } else {
            this.metrics?.recordCounter("client_credentials.cache_hit", 1);
            return cachedToken.access_token;
          }
        }
        this.logger.info("❌ No cached token found");
      }

      // Acquire new token (with thread-safety)
      this.logger.info("🔐 Acquiring new token");
      const token = await this.acquireToken();
      this.logger.info("✅ Token acquired successfully");

      this.metrics?.recordCounter("client_credentials.token_acquired", 1);
      this.metrics?.recordTimer(
        "client_credentials.acquisition_duration",
        performance.now() - startTime
      );

      return token.access_token;
    } catch (error) {
      this.metrics?.recordCounter("client_credentials.acquisition_error", 1);
      this.logger.error("❌ Failed to get valid admin token", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        scopes: this.config.requiredScopes,
      });
      throw new Error(
        `Failed to authenticate with Keycloak Admin API: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Invalidate current token (forces refresh on next request)
   */
  async invalidateToken(): Promise<void> {
    this.logger.debug("Invalidating admin token");

    // Clear cache (multi-layer: memory + Redis)
    if (this.config.enableCaching) {
      await this.cacheManager.invalidate("admin_token", this.cacheKey);
    }

    this.metrics?.recordCounter("client_credentials.token_invalidated", 1);
    this.logger.info("Admin token invalidated");
  }

  /**
   * Get current token information (for monitoring/debugging)
   */
  async getTokenInfo(): Promise<TokenInfo | null> {
    try {
      const cached = await this.cacheManager.get<KeycloakTokenResponse>(
        "admin_token",
        this.cacheKey
      );

      if (!cached.hit || !cached.data) {
        return null;
      }

      const token = cached.data;
      const now = new Date();
      const expiryTime = this.calculateExpiry(token);
      const timeToExpiry = Math.floor(
        (expiryTime.getTime() - now.getTime()) / 1000
      );

      return {
        expiresAt: expiryTime,
        scopes: this.config.requiredScopes,
        issuedAt: new Date(
          now.getTime() - (token.expires_in - timeToExpiry) * 1000
        ),
        timeToExpiry: Math.max(0, timeToExpiry),
      };
    } catch (error) {
      this.logger.warn("Failed to get token info", { error });
      return null;
    }
  }

  // ==================== Private Methods ====================

  /**
   * Get token from secure cache with comprehensive validation
   */
  private async getCachedToken(): Promise<KeycloakTokenResponse | null> {
    try {
      this.logger.info("📦 getCachedToken: Starting cache lookup");
      const cached = await this.cacheManager.get<KeycloakTokenResponse>(
        "admin_token",
        this.cacheKey
      );

      this.logger.info("📦 getCachedToken: Cache lookup result", {
        hit: cached.hit,
        hasData: !!cached.data,
      });

      if (cached.hit && cached.data) {
        // Verify cached token is not expired
        const expiryTime = this.calculateExpiry(cached.data);
        if (new Date() >= expiryTime) {
          this.logger.info("⏰ Cached token expired", {
            expiresAt: expiryTime.toISOString(),
          });
          return null;
        }

        // Comprehensive JWT validation if enabled
        if (this.config.enableJwtValidation && this.jwtValidator) {
          this.logger.info("🔐 Validating cached token JWT");
          const validationResult = await this.validateTokenJWT(
            cached.data.access_token
          );
          if (!validationResult) {
            this.logger.warn("Cached token failed JWT validation");
            this.metrics?.recordCounter(
              "client_credentials.jwt_validation_failed",
              1
            );
            return null;
          }
          this.metrics?.recordCounter(
            "client_credentials.jwt_validation_success",
            1
          );
        }

        this.logger.info("✅ getCachedToken: Returning valid cached token");
        return cached.data;
      }

      this.logger.info("❌ getCachedToken: No valid cached token found");
      return null;
    } catch (error) {
      this.logger.error("❌ getCachedToken: Error during cache lookup", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return null;
    }
  }

  /**
   * Validate JWT token using comprehensive signature and claims validation
   */
  private async validateTokenJWT(accessToken: string): Promise<boolean> {
    if (!this.jwtValidator) {
      return true; // Skip validation if not enabled
    }

    try {
      const result = await this.jwtValidator.validateJWT(accessToken);

      if (!result.success) {
        this.logger.error("JWT validation failed", {
          error: result.error,
        });
        return false;
      }

      // Validate token has required scopes
      const tokenScopes = this.extractScopesFromJWT(accessToken);
      const hasRequiredScopes = this.config.requiredScopes.every((scope) =>
        tokenScopes.includes(scope)
      );

      if (!hasRequiredScopes) {
        this.logger.error("Token missing required scopes", {
          required: this.config.requiredScopes,
          actual: tokenScopes,
        });
        return false;
      }

      this.logger.debug("JWT validation successful", {
        userId: result.user?.id,
        scopes: tokenScopes,
      });

      return true;
    } catch (error) {
      this.logger.error("JWT validation error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Extract scopes from JWT token (from scope claim)
   */
  private extractScopesFromJWT(token: string): string[] {
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || !parts[1]) {
        return [];
      }

      const payload = JSON.parse(
        Buffer.from(parts[1], "base64").toString("utf-8")
      );

      // Keycloak can store scopes in 'scope' (space-separated) or 'scopes' (array)
      if (typeof payload.scope === "string") {
        return payload.scope.split(" ");
      }
      if (Array.isArray(payload.scopes)) {
        return payload.scopes;
      }

      return [];
    } catch (error) {
      this.logger.warn("Failed to extract scopes from JWT", { error });
      return [];
    }
  }

  /**
   * Acquire new token with retry logic and thread-safety
   */
  private async acquireToken(): Promise<KeycloakTokenResponse> {
    // Thread-safety: If another acquisition is in progress, wait for it
    if (this.refreshPromise) {
      this.logger.debug("Waiting for existing token acquisition");
      return this.refreshPromise;
    }

    // Start new acquisition with proper locking
    this.refreshPromise = this.performTokenAcquisition();

    try {
      const token = await this.refreshPromise;
      return token;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  /**
   * Perform actual token acquisition with retry logic
   */
  private async performTokenAcquisition(): Promise<KeycloakTokenResponse> {
    let lastError: Error | undefined;

    this.logger.info("🚀 STARTING performTokenAcquisition", {
      maxRetries: this.config.maxRetries,
      scopes: this.config.requiredScopes,
    });

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        this.logger.info("🔄 Attempting token acquisition", {
          attempt,
          maxRetries: this.config.maxRetries,
          scopes: this.config.requiredScopes,
        });

        this.logger.info(
          "📞 Calling keycloakClient.authenticateClientCredentials"
        );
        const token = await this.keycloakClient.authenticateClientCredentials(
          this.config.requiredScopes
        );
        this.logger.info(
          "✅ keycloakClient.authenticateClientCredentials returned"
        );

        this.logger.info("Client credentials token acquired", {
          expiresIn: token.expires_in,
          scopes: this.config.requiredScopes,
          attempt,
          tokenLength: token.access_token?.length,
          tokenPrefix: token.access_token
            ? token.access_token.substring(0, 50) + "..."
            : "NO_TOKEN",
          hasRefreshToken: !!token.refresh_token,
        }); // Update cache (multi-layer: memory + Redis)
        await this.updateCache(token);

        return token;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.error("❌ Token acquisition attempt failed", {
          attempt,
          error: lastError.message,
          stack: lastError.stack,
        });

        this.logger.warn("Token acquisition failed", {
          attempt,
          maxRetries: this.config.maxRetries,
          error: lastError.message,
          willRetry: attempt < this.config.maxRetries,
        });

        // Retry with exponential backoff
        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    throw new Error(
      `Failed to acquire token after ${this.config.maxRetries} attempts: ${lastError?.message}`
    );
  }

  /**
   * Update cache with new token
   */
  private async updateCache(token: KeycloakTokenResponse): Promise<void> {
    if (!this.config.enableCaching) {
      return;
    }

    try {
      const ttl =
        this.config.cacheTtl ??
        token.expires_in - this.config.safetyBufferSeconds;

      await this.cacheManager.set("admin_token", this.cacheKey, token, ttl);

      const expiryTime = this.calculateExpiry(token);
      this.logger.debug("Cache updated", {
        ttl,
        expiresIn: token.expires_in,
        expiresAt: expiryTime.toISOString(),
      });
    } catch (error) {
      this.logger.warn("Failed to update cache", { error });
      // Non-critical: Continue even if cache update fails
    }
  }

  /**
   * Calculate token expiry time with safety buffer
   */
  private calculateExpiry(token: KeycloakTokenResponse): Date {
    const now = new Date();
    const expiryMs =
      (token.expires_in - this.config.safetyBufferSeconds) * 1000;
    return new Date(now.getTime() + expiryMs);
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Dispose and cleanup resources
   */
  async dispose(): Promise<void> {
    this.logger.debug("Disposing ClientCredentialsTokenProvider");

    await this.invalidateToken();
    this.refreshPromise = undefined;

    this.logger.info("ClientCredentialsTokenProvider disposed");
  }
}

/**
 * Factory function to create ClientCredentialsTokenProvider with defaults
 *
 * @param keycloakClient - Keycloak client instance
 * @param scopes - Required OAuth2 scopes (defaults to DEFAULT_ADMIN_SCOPES)
 * @param jwksEndpoint - JWKS endpoint for JWT validation (required for validation)
 * @param issuer - Expected JWT issuer (required for validation)
 * @param metrics - Metrics collector instance
 */
export function createAdminTokenProvider(
  keycloakClient: KeycloakClient,
  scopes?: string[],
  jwksEndpoint?: string,
  issuer?: string,
  metrics?: IMetricsCollector
): ClientCredentialsTokenProvider {
  const config: Partial<ClientCredentialsConfig> = {
    requiredScopes: scopes || DEFAULT_ADMIN_SCOPES,
    safetyBufferSeconds: 30,
    enableCaching: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    enableJwtValidation: !!(jwksEndpoint && issuer),
  };

  // Only add optional properties if they're defined (exactOptionalPropertyTypes: true)
  if (jwksEndpoint !== undefined) {
    config.jwksEndpoint = jwksEndpoint;
  }
  if (issuer !== undefined) {
    config.issuer = issuer;
  }

  return new ClientCredentialsTokenProvider(keycloakClient, config, metrics);
}
