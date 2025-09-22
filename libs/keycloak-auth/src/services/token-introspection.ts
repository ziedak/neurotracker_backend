import {
  TokenIntrospectionResponse,
  TokenValidationResult,
  KeycloakClientConfig,
  ITokenIntrospectionService,
  TokenValidationError,
} from "../types/index";
import { KeycloakClientFactory } from "../client/keycloak-client-factory";
import { CacheService } from "@libs/database";
import { createLogger, type ILogger } from "@libs/utils";
import { createHash, randomBytes } from "crypto";

// Import decomposed services
import {
  ITokenMetric,
  ITokenIntrospectionClient,
  ITokenCacheService,
  IPublicKeyService,
  ITokenValidationOrchestrator,
  createDecomposedTokenServices,
} from "./decomposed";
import { MetricsOperation } from "./decomposed/token-metrics.service";
import type { IMetricsCollector } from "@libs/monitoring";

// Create logger with explicit type
const logger: ILogger = createLogger("token-introspection-service");

/**
 * Configuration constants for Token Introspection Service
 */
const TOKEN_INTROSPECTION_CONSTANTS = {
  // Salt rotation configuration
  SALT_ROTATION_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
  SALT_LENGTH: 32, // 128 bits of entropy

  // Admin token buffer time
  ADMIN_TOKEN_BUFFER_TIME: 60000, // 1 minute in milliseconds

  // Cryptographic constants
  MIN_RSA_KEY_SIZE: 2048, // Minimum RSA key size in bits
  SUPPORTED_EC_CURVES: ["P-256", "P-384", "P-521"] as const,

  // Cache TTL values (in seconds)
  PUBLIC_KEY_CACHE_TTL: 3600, // 1 hour
  DEFAULT_CACHE_TTL: 300, // 5 minutes
  MIN_CACHE_TTL: 60, // 1 minute
  INTROSPECTION_CACHE_BUFFER: 60, // 1 minute buffer before expiration

  // Token hash configuration
  TOKEN_HASH_LENGTH: 32, // 128 bits for collision resistance

  // Environment defaults
  DEFAULT_ENVIRONMENT: "development",
  DEFAULT_INSTANCE_ID: "default",

  // Security thresholds
  MAX_DEPTH_WARNING: 10, // Maximum recursion depth warning
  MIN_INTROSPECTION_CACHE_TTL: 300, // Minimum 5 minutes for introspection cache
} as const;

/**
 * Configuration class for Token Introspection Service
 * Centralizes environment variable access and configuration management
 */
class TokenIntrospectionConfig {
  readonly environment: string;
  readonly instanceId: string;
  readonly saltRotationInterval: number;
  readonly enableDetailedLogging: boolean;
  readonly enableMetrics: boolean;
  readonly enableCacheWarming: boolean;
  readonly maxCacheSize: number;

  constructor() {
    this.environment =
      process.env["NODE_ENV"] ||
      TOKEN_INTROSPECTION_CONSTANTS.DEFAULT_ENVIRONMENT;
    this.instanceId =
      process.env["INSTANCE_ID"] ||
      TOKEN_INTROSPECTION_CONSTANTS.DEFAULT_INSTANCE_ID;
    this.saltRotationInterval = parseInt(
      process.env["TOKEN_INTROSPECTION_SALT_ROTATION_INTERVAL"] ||
        TOKEN_INTROSPECTION_CONSTANTS.SALT_ROTATION_INTERVAL.toString(),
      10
    );
    this.enableDetailedLogging =
      process.env["TOKEN_INTROSPECTION_DETAILED_LOGGING"] === "true";
    this.enableMetrics =
      process.env["TOKEN_INTROSPECTION_ENABLE_METRICS"] !== "false";
    this.enableCacheWarming =
      process.env["TOKEN_INTROSPECTION_ENABLE_CACHE_WARMING"] === "true";
    this.maxCacheSize = parseInt(
      process.env["TOKEN_INTROSPECTION_MAX_CACHE_SIZE"] || "1000",
      10
    );
  }

  /**
   * Get the full instance identifier for salt generation
   */
  public getInstanceIdentifier(): string {
    return `${this.environment}:${this.instanceId}`;
  }

  /**
   * Check if we're in production environment
   */
  public isProduction(): boolean {
    return this.environment === "production";
  }

  /**
   * Check if we're in development environment
   */
  public isDevelopment(): boolean {
    return this.environment === "development";
  }

  /**
   * Get configuration summary for logging
   */
  public getConfigSummary(): Record<string, any> {
    return {
      environment: this.environment,
      instanceId: this.instanceId,
      saltRotationInterval: this.saltRotationInterval,
      enableDetailedLogging: this.enableDetailedLogging,
      enableMetrics: this.enableMetrics,
      enableCacheWarming: this.enableCacheWarming,
      maxCacheSize: this.maxCacheSize,
    };
  }
}

/**
 * Token Hash Salt Manager - Manages rotating salts for secure token hashing
 * Implements salt rotation to prevent cache poisoning attacks
 */
class TokenHashSaltManager {
  private currentSalt: string;
  private previousSalt?: string;
  private saltRotationInterval: number;
  private lastRotation: number;
  private rotationTimer?: ReturnType<typeof setInterval> | undefined;
  private config: TokenIntrospectionConfig;

  constructor(config: TokenIntrospectionConfig) {
    this.config = config;
    this.saltRotationInterval = config.saltRotationInterval;
    this.currentSalt = this.generateSecureSalt();
    this.lastRotation = Date.now();
    this.startRotationTimer();
  }

  /**
   * Get current salt for hashing (with environment prefix)
   */
  public getCurrentSalt(): string {
    return `${this.config.getInstanceIdentifier()}:${this.currentSalt}`;
  }

  /**
   * Get previous salt for backward compatibility during rotation
   */
  public getPreviousSalt(): string | undefined {
    if (!this.previousSalt) return undefined;
    return `${this.config.getInstanceIdentifier()}:${this.previousSalt}`;
  }

  /**
   * Force salt rotation (useful for security incidents)
   */
  public rotateSalt(): void {
    this.previousSalt = this.currentSalt;
    this.currentSalt = this.generateSecureSalt();
    this.lastRotation = Date.now();

    logger.info("Salt rotated for enhanced security", {
      rotationTime: new Date(this.lastRotation).toISOString(),
      hasPreviousSalt: !!this.previousSalt,
    });
  }

  /**
   * Generate cryptographically secure salt using crypto.randomBytes
   * Provides 128 bits of entropy for maximum security
   */
  private generateSecureSalt(): string {
    return randomBytes(TOKEN_INTROSPECTION_CONSTANTS.SALT_LENGTH).toString(
      "hex"
    );
  }

  /**
   * Start automatic salt rotation timer
   */
  private startRotationTimer(): void {
    this.rotationTimer = setInterval(() => {
      this.rotateSalt();
    }, this.saltRotationInterval);

    // Don't prevent process exit
    this.rotationTimer.unref();
  }

  /**
   * Cleanup on shutdown - SECURITY FIX for memory leak prevention
   * Ensures proper timer cleanup during service restarts
   */
  public shutdown(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = undefined;

      logger.info("Salt rotation timer cleaned up successfully", {
        lastRotation: new Date(this.lastRotation).toISOString(),
      });
    }
  }

  /**
   * Get salt rotation statistics
   */
  public getStats(): {
    lastRotation: string;
    nextRotation: string;
    rotationInterval: number;
    hasPreviousSalt: boolean;
  } {
    const nextRotation = this.lastRotation + this.saltRotationInterval;
    return {
      lastRotation: new Date(this.lastRotation).toISOString(),
      nextRotation: new Date(nextRotation).toISOString(),
      rotationInterval: this.saltRotationInterval / 1000, // in seconds
      hasPreviousSalt: !!this.previousSalt,
    };
  }
}

/**
 * Token Introspection Service
 * Handles JWT validation and token introspection with Keycloak
 * Uses existing @libs/database cache infrastructure
 */
export class TokenIntrospectionService implements ITokenIntrospectionService {
  private publicKeyCache = new Map<string, any>();
  private saltManager: TokenHashSaltManager;
  private config: TokenIntrospectionConfig;
  private enableCacheWarming: boolean;

  // Decomposed services
  private metric: IMetricsCollector;
  private introspectionClient: ITokenIntrospectionClient;
  private cacheServiceInternal: ITokenCacheService;
  private publicKeyService: IPublicKeyService;
  private validationOrchestrator: ITokenValidationOrchestrator;

  constructor(
    private readonly keycloakClientFactory: KeycloakClientFactory,
    private readonly cacheService: CacheService
  ) {
    // Initialize configuration
    this.config = new TokenIntrospectionConfig();
    this.enableCacheWarming = this.config.enableCacheWarming;

    // Initialize secure salt management
    this.saltManager = new TokenHashSaltManager(this.config);

    // Initialize decomposed services
    const services = createDecomposedTokenServices(
      this.keycloakClientFactory,
      this.cacheService
    );
    this.metric = services.metrics;
    this.introspectionClient = services.client;
    this.cacheServiceInternal = services.cache;
    this.publicKeyService = services.publicKey;
    this.validationOrchestrator = services.orchestrator;

    // Log configuration on startup
    logger.info("TokenIntrospectionService initialized", {
      config: this.config.getConfigSummary(),
    });
  }

  /**
   * Validate JWT token with Keycloak public keys using JWKS
   *
   * This method performs comprehensive JWT validation including:
   * - Token signature verification using Keycloak's JWKS
   * - Issuer and audience validation
   * - Token expiration checking
   * - Secure caching with salt rotation
   *
   * @param token - The JWT token to validate
   * @param clientConfig - Optional Keycloak client configuration. If not provided, uses default frontend client
   * @returns Promise<TokenValidationResult> - Validation result with claims if successful
   *
   * @throws {TokenValidationError} When token validation fails
   * @throws {Error} When JWKS endpoint is not available or network errors occur
   *
   * @example
   * ```typescript
   * const result = await service.validateJWT(token);
   * if (result.valid) {
   *   console.log('Token is valid for user:', result.claims.sub);
   * } else {
   *   console.log('Token validation failed:', result.error);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // With custom client configuration
   * const config = { clientId: 'my-client', realm: 'my-realm' };
   * const result = await service.validateJWT(token, config);
   * ```
   */
  public async validateJWT(
    token: string,
    clientConfig?: KeycloakClientConfig
  ): Promise<TokenValidationResult> {
    this.metric.recordOperation(MetricsOperation.JWT_VALIDATION);

    try {
      const config = this.getClientConfig(clientConfig);

      // Use the validation orchestrator for complete JWT validation
      const result = await this.validationOrchestrator.validateJWT(
        token,
        config
      );

      if (result.valid) {
        this.metric.recordOperation(MetricsOperation.JWT_VALIDATION_SUCCESS);
      } else {
        this.metric.recordOperation(MetricsOperation.JWT_VALIDATION_FAILURE);
      }

      return result;
    } catch (error) {
      this.metric.recordOperation(MetricsOperation.JWT_VALIDATION_FAILURE);
      return this.handleValidationError(error);
    }
  }

  /**
   * Get client configuration, using default if not provided
   */
  private getClientConfig(
    clientConfig?: KeycloakClientConfig
  ): KeycloakClientConfig {
    return clientConfig || this.keycloakClientFactory.getClient("frontend");
  }

  /**
   * Handle JWT validation errors
   */
  private handleValidationError(error: unknown): TokenValidationResult {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("JWT validation failed", { error: errorMessage });

    return {
      valid: false,
      error: errorMessage,
      cached: false,
    };
  }

  /**
   * Introspect token with Keycloak introspection endpoint
   *
   * This method performs OAuth 2.0 token introspection by calling Keycloak's
   * introspection endpoint to validate opaque tokens and retrieve token metadata.
   * Results are cached for performance and automatically invalidated based on token expiration.
   *
   * @param token - The opaque token to introspect
   * @param clientConfig - Keycloak client configuration with credentials for introspection
   * @returns Promise<TokenIntrospectionResponse> - Introspection result with token metadata
   *
   * @throws {TokenValidationError} When introspection fails or endpoint is unavailable
   * @throws {Error} When network errors occur or response validation fails
   *
   * @example
   * ```typescript
   * const config = {
   *   clientId: 'my-client',
   *   clientSecret: 'secret',
   *   realm: 'my-realm'
   * };
   * const result = await service.introspect(token, config);
   *
   * if (result.active) {
   *   console.log('Token is active for user:', result.username);
   *   console.log('Scopes:', result.scope);
   * } else {
   *   console.log('Token is inactive');
   * }
   * ```
   *
   * @note Requires client credentials with introspection permission
   * @note Results are cached based on token expiration time
   */
  public async introspect(
    token: string,
    clientConfig: KeycloakClientConfig
  ): Promise<TokenIntrospectionResponse> {
    this.metric.recordOperation(MetricsOperation.INTROSPECTION_CALL);

    try {
      // Check cache first
      const cacheKey = `introspection:${this.hashToken(token)}`;
      const cachedResult =
        await this.cacheServiceInternal.get<TokenIntrospectionResponse>(
          cacheKey
        );

      if (cachedResult.hit && cachedResult.data) {
        this.metric.recordOperation(MetricsOperation.CACHE_HIT);
        logger.debug("Using cached introspection result");
        return cachedResult.data;
      }

      this.metric.recordOperation(MetricsOperation.CACHE_MISS);

      // Create introspection request
      const request = {
        token,
        clientId: clientConfig.clientId,
        clientSecret: clientConfig.clientSecret,
        realm: clientConfig.realm,
      };

      // Use the introspection client
      const result = await this.introspectionClient.introspect(request);

      // Cache the result if active
      if (result.response.active && result.response.exp) {
        const ttl = Math.max(
          result.response.exp -
            Math.floor(Date.now() / 1000) -
            TOKEN_INTROSPECTION_CONSTANTS.INTROSPECTION_CACHE_BUFFER, // 1 minute before expiration
          TOKEN_INTROSPECTION_CONSTANTS.MIN_INTROSPECTION_CACHE_TTL // Minimum cache TTL
        );
        await this.cacheServiceInternal.set(cacheKey, result.response, ttl);
      }

      this.metric.recordOperation(MetricsOperation.INTROSPECTION_SUCCESS);

      return result.response;
    } catch (error) {
      this.metric.recordOperation(MetricsOperation.INTROSPECTION_FAILURE);
      logger.error("Token introspection failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get public key for JWT verification (legacy method, prefer JWKS)
   *
   * @deprecated Use validateJWT() method instead for modern JWKS-based validation.
   * This method is maintained for backward compatibility only.
   *
   * Retrieves RSA/EC public key from Keycloak's JWKS endpoint and converts it to PEM format.
   * Keys are cached in memory and Redis for performance. This method is primarily used
   * by legacy JWT validation implementations that don't use the jose library.
   *
   * @param keyId - The Key ID (kid) of the public key to retrieve
   * @param realm - The Keycloak realm where the key is located
   * @returns Promise<string> - PEM-formatted public key
   *
   * @throws {TokenValidationError} When key is not found or JWKS fetch fails
   * @throws {Error} When key conversion fails or network errors occur
   *
   * @example
   * ```typescript
   * // Legacy usage - prefer validateJWT() instead
   * const publicKey = await service.getPublicKey('abc123', 'my-realm');
   * console.log('Public key:', publicKey);
   * ```
   *
   * @note This method may be removed in future versions
   * @note For new implementations, use validateJWT() with JWKS validation
   */
  public async getPublicKey(keyId: string, realm: string): Promise<string> {
    this.metric.recordOperation(MetricsOperation.PUBLIC_KEY_FETCH);

    try {
      const result = await this.publicKeyService.getPublicKey(keyId, realm);

      this.metric.recordOperation(MetricsOperation.PUBLIC_KEY_FETCH_SUCCESS);

      return result.key;
    } catch (error) {
      this.metric.recordOperation(MetricsOperation.PUBLIC_KEY_FETCH_FAILURE);
      throw error;
    }
  }

  /**
   * Validate JWK structure and required parameters
   */
  private validateJwkStructure(jwk: any): void {
    if (!jwk || typeof jwk !== "object") {
      throw new Error("Invalid JWK: must be an object");
    }

    if (!jwk.kty || typeof jwk.kty !== "string") {
      throw new Error("Invalid JWK: missing or invalid key type (kty)");
    }

    if (!jwk.alg || typeof jwk.alg !== "string") {
      throw new Error("Invalid JWK: missing or invalid algorithm (alg)");
    }
  }

  /**
   * Validate algorithm-specific JWK parameters
   */
  private validateJwkAlgorithm(jwk: any): void {
    switch (jwk.kty) {
      case "RSA":
        if (!jwk.n || !jwk.e) {
          throw new Error(
            "Invalid RSA JWK: missing modulus (n) or exponent (e)"
          );
        }
        // Validate key size (should be at least 2048 bits)
        const modulusLength = Buffer.from(jwk.n, "base64url").length * 8;
        if (modulusLength < TOKEN_INTROSPECTION_CONSTANTS.MIN_RSA_KEY_SIZE) {
          throw new Error(
            `Invalid RSA JWK: key size too small (minimum ${TOKEN_INTROSPECTION_CONSTANTS.MIN_RSA_KEY_SIZE} bits)`
          );
        }
        break;

      case "EC":
        if (!jwk.crv || !jwk.x || !jwk.y) {
          throw new Error(
            "Invalid EC JWK: missing curve (crv), x, or y coordinate"
          );
        }
        // Validate supported curves
        const supportedCurves =
          TOKEN_INTROSPECTION_CONSTANTS.SUPPORTED_EC_CURVES;
        if (!supportedCurves.includes(jwk.crv)) {
          throw new Error(`Invalid EC JWK: unsupported curve ${jwk.crv}`);
        }
        break;

      default:
        throw new Error(`Invalid JWK: unsupported key type ${jwk.kty}`);
    }
  }

  /**
   * Import and validate JWK using JOSE library
   */
  private async importAndValidateJwk(jwk: any): Promise<any> {
    const { importJWK } = await import("jose");

    try {
      const key = await importJWK(jwk as any, jwk.alg);

      // Ensure key is a proper KeyLike object before export
      if (!key || typeof key !== "object" || !("type" in key)) {
        throw new Error(
          "Invalid JWK: key import resulted in invalid key object"
        );
      }

      return key;
    } catch (importError) {
      throw new Error(
        `JWK import/validation failed: ${
          importError instanceof Error
            ? importError.message
            : String(importError)
        }`
      );
    }
  }

  /**
   * Export JWK to SPKI PEM format
   */
  private async exportJwkToPem(key: any, jwk: any): Promise<string> {
    const { exportSPKI } = await import("jose");

    const spki = await exportSPKI(key as any);

    logger.debug("JWK successfully validated and converted to SPKI format", {
      keyType: jwk.kty,
      algorithm: jwk.alg,
      keyId: jwk.kid,
    });

    return spki;
  }

  async jwkToPem(jwk: any): Promise<string> {
    try {
      // Validate JWK structure and required parameters
      this.validateJwkStructure(jwk);

      // Validate algorithm-specific parameters
      this.validateJwkAlgorithm(jwk);

      // Import and validate the JWK using JOSE
      const key = await this.importAndValidateJwk(jwk);

      // Export as SPKI (Subject Public Key Info) format
      return await this.exportJwkToPem(key, jwk);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("JWK validation and conversion failed", {
        error: errorMessage,
        jwkAlg: jwk?.alg,
        jwkKty: jwk?.kty,
      });
      throw new TokenValidationError(`JWK validation failed: ${errorMessage}`);
    }
  }

  /**
   * Refresh public keys from Keycloak
   *
   * Clears all cached public keys for the specified realm from both memory and Redis cache.
   * This forces fresh key retrieval on the next getPublicKey() call. Useful when Keycloak
   * keys have been rotated or updated.
   *
   * @param realm - The Keycloak realm to refresh keys for
   * @returns Promise<void>
   *
   * @throws {Error} When cache invalidation fails
   *
   * @example
   * ```typescript
   * // Force refresh of public keys after Keycloak key rotation
   * await service.refreshPublicKeys('my-realm');
   * console.log('Public keys refreshed');
   * ```
   *
   * @note This only affects the legacy getPublicKey() method
   * @note JWKS-based validation automatically handles key rotation
   */
  public async refreshPublicKeys(realm: string): Promise<void> {
    await this.publicKeyService.refreshPublicKeys(realm);
  }

  /**
   * SECURE: Create a cryptographic hash of the token for cache key
   * Uses SHA-256 with rotating salt for security and collision resistance
   * Returns 128-bit hash for strong collision resistance
   */
  private hashToken(token: string): string {
    const currentSalt = this.saltManager.getCurrentSalt();
    const hash = createHash("sha256")
      .update(token + currentSalt)
      .digest("hex");

    // Return 128-bit hash (32 characters) for strong collision resistance
    // This provides excellent security against collision attacks
    return hash.substring(0, TOKEN_INTROSPECTION_CONSTANTS.TOKEN_HASH_LENGTH);
  }

  /**
   * Get token validation statistics
   *
   * Returns comprehensive metrics about token validation operations including:
   * - Cache hit/miss rates
   * - Success/failure counts for different operations
   * - Performance metrics and uptime
   * - Calculated rates and percentages
   *
   * @returns Promise<object> - Statistics object with detailed metrics
   *
   * @example
   * ```typescript
   * const stats = await service.getValidationStats();
   * console.log(`Cache hit rate: ${stats.cacheHitRate}%`);
   * console.log(`JWT validations: ${stats.jwtValidations}`);
   * console.log(`Uptime: ${stats.uptimeSeconds} seconds`);
   * ```
   *
   * @note Metrics are collected in-memory and reset when service restarts
   * @note Rates are calculated as percentages with 2 decimal precision
   */
  public async getValidationStats(): Promise<{
    cacheHits: number;
    cacheMisses: number;
    introspectionCalls: number;
    jwtValidations: number;
    jwtValidationSuccesses: number;
    jwtValidationFailures: number;
    introspectionSuccesses: number;
    introspectionFailures: number;
    publicKeyFetches: number;
    publicKeyFetchSuccesses: number;
    publicKeyFetchFailures: number;
    cacheHitRate: number;
    jwtValidationSuccessRate: number;
    introspectionSuccessRate: number;
    publicKeyFetchSuccessRate: number;
    uptimeSeconds: number;
  }> {
    const stats = this.metric.getStats();

    return {
      cacheHits: stats.cacheHits,
      cacheMisses: stats.cacheMisses,
      introspectionCalls: stats.introspectionCalls,
      jwtValidations: stats.jwtValidations,
      jwtValidationSuccesses: stats.jwtValidationSuccesses,
      jwtValidationFailures: stats.jwtValidationFailures,
      introspectionSuccesses: stats.introspectionSuccesses,
      introspectionFailures: stats.introspectionFailures,
      publicKeyFetches: stats.publicKeyFetches,
      publicKeyFetchSuccesses: stats.publicKeyFetchSuccesses,
      publicKeyFetchFailures: stats.publicKeyFetchFailures,
      cacheHitRate: stats.cacheHitRate,
      jwtValidationSuccessRate: stats.jwtValidationSuccessRate,
      introspectionSuccessRate: stats.introspectionSuccessRate,
      publicKeyFetchSuccessRate: stats.publicKeyFetchSuccessRate,
      uptimeSeconds: stats.uptimeSeconds,
    };
  }

  /**
   * Reset metrics counters
   *
   * Resets all internal metrics counters to zero and updates the reset timestamp.
   * This is useful for getting fresh metrics data or for testing purposes.
   * The reset affects all operation counters and recalculates uptime.
   *
   * @returns void
   *
   * @example
   * ```typescript
   * // Reset metrics for fresh monitoring data
   * service.resetMetrics();
   * console.log('Metrics reset successfully');
   * ```
   *
   * @note This resets all counters including successes, failures, and cache stats
   * @note Uptime counter is also reset to current time
   * @note Use with caution in production as it clears historical data
   */
  public resetMetrics(): void {
    this.metric.resetMetrics();
  }
  /**
   * Shutdown service and cleanup resources
   *
   * Performs graceful shutdown of the token introspection service including:
   * - Stopping salt rotation timers to prevent memory leaks
   * - Clearing in-memory caches
   * - Logging shutdown completion
   *
   * This method should be called when the service is no longer needed
   * to ensure proper cleanup of resources and timers.
   *
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * // Graceful shutdown
   * await service.shutdown();
   * console.log('Service shut down successfully');
   * ```
   *
   * @note Safe to call multiple times
   * @note After shutdown, the service should not be used
   */
  public async shutdown(): Promise<void> {
    logger.info("Shutting down TokenIntrospectionService");

    // SECURITY FIX: Shutdown salt manager to prevent memory leaks
    this.saltManager.shutdown();

    // Shutdown decomposed services
    await Promise.all([
      this.metric.resetMetrics(), // Reset metrics on shutdown
      this.publicKeyService.shutdown(),
      this.validationOrchestrator.shutdown(),
      this.cacheServiceInternal.clear(),
    ]);

    // Clear memory caches
    this.publicKeyCache.clear();

    logger.info("TokenIntrospectionService shutdown completed");
  }

  /**
   * Get service health status including salt rotation status
   *
   * Returns the current health status of the token introspection service including:
   * - Overall service health
   * - Memory cache size
   * - Salt rotation statistics and timing
   *
   * This method can be used for health checks and monitoring dashboards.
   *
   * @returns object - Health status information
   *
   * @example
   * ```typescript
   * const health = service.getHealthStatus();
   * if (health.healthy) {
   *   console.log('Service is healthy');
   *   console.log('Memory cache size:', health.publicKeyCacheSize);
   *   console.log('Next salt rotation:', health.saltRotationStats.nextRotation);
   * } else {
   *   console.log('Service is unhealthy');
   * }
   * ```
   *
   * @note This is a synchronous method for fast health checks
   * @note Salt rotation stats include timing information for monitoring
   */
  public getHealthStatus(): {
    healthy: boolean;
    publicKeyCacheSize: number;
    saltRotationStats: any;
  } {
    const publicKeyHealth = this.publicKeyService.getHealthStatus();
    const orchestratorHealth = this.validationOrchestrator.getHealthStatus();

    return {
      healthy: publicKeyHealth.healthy && orchestratorHealth.healthy,
      publicKeyCacheSize: this.publicKeyService.getCacheStats().memoryCacheSize,
      saltRotationStats: this.saltManager.getStats(),
    };
  }

  /**
   * Clean up expired tokens from cache
   *
   * Removes expired token validation results and introspection data from cache.
   * This helps maintain cache efficiency and prevents memory bloat from stale data.
   * The cleanup targets both JWT validation cache and introspection result cache.
   *
   * @returns Promise<void>
   *
   * @throws {Error} When cache cleanup operations fail
   *
   * @example
   * ```typescript
   * // Periodic cleanup (e.g., daily cron job)
   * await service.cleanupExpiredTokens();
   * console.log('Expired tokens cleaned up');
   * ```
   *
   * @note This method uses pattern-based cache invalidation
   * @note Safe to run periodically or on-demand
   * @note Does not affect active/valid cached tokens
   */
  public async cleanupExpiredTokens(): Promise<void> {
    try {
      const patterns = ["jwt:validation:*", "introspection:*"];
      let totalCleaned = 0;

      for (const pattern of patterns) {
        const cleaned = await this.cacheServiceInternal.invalidatePattern(
          pattern
        );
        totalCleaned += cleaned;
      }

      logger.info("Cleaned up expired tokens from cache", { totalCleaned });
    } catch (error) {
      logger.error("Failed to cleanup expired tokens", { error });
    }
  }

  /**
   * Warm up cache with frequently used public keys
   *
   * Pre-loads commonly used public keys into cache to improve performance.
   * This is useful for high-traffic scenarios where the same keys are used frequently.
   * Only runs if cache warming is enabled in configuration.
   *
   * @param commonRealms - Array of realm names to warm up
   * @param commonKeyIds - Array of key IDs to warm up (optional)
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * // Warm up cache for common realms
   * await service.warmUpCache(['my-realm', 'admin-realm']);
   * console.log('Cache warmed up successfully');
   * ```
   *
   * @note Only works if TOKEN_INTROSPECTION_ENABLE_CACHE_WARMING=true
   * @note Safe to call multiple times
   * @note Improves cold start performance
   */
  public async warmUpCache(
    commonRealms: string[],
    commonKeyIds?: string[]
  ): Promise<void> {
    if (!this.enableCacheWarming) {
      logger.debug("Cache warming disabled, skipping warm-up");
      return;
    }

    logger.info("Starting cache warm-up", {
      realms: commonRealms.length,
      keyIds: commonKeyIds?.length || 0,
    });

    try {
      for (const realm of commonRealms) {
        if (commonKeyIds && commonKeyIds.length > 0) {
          // Warm up specific key IDs
          for (const keyId of commonKeyIds) {
            try {
              await this.publicKeyService.getPublicKey(keyId, realm);
              logger.debug("Warmed up public key", { keyId, realm });
            } catch (error) {
              logger.warn("Failed to warm up public key", {
                keyId,
                realm,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        } else {
          // Warm up discovery document and common keys
          try {
            const discovery =
              await this.keycloakClientFactory.getDiscoveryDocument(realm);

            if (discovery.jwks_uri) {
              // This will populate the JWKS cache
              await this.publicKeyService.refreshPublicKeys(realm);
              logger.debug("Warmed up JWKS for realm", { realm });
            }
          } catch (error) {
            logger.warn("Failed to warm up realm", {
              realm,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      logger.info("Cache warm-up completed", {
        realmsProcessed: commonRealms.length,
      });
    } catch (error) {
      logger.error("Cache warm-up failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Factory function to create token introspection service
 */
export const createTokenIntrospectionService = (
  keycloakClientFactory: KeycloakClientFactory,
  cacheService: CacheService
): TokenIntrospectionService => {
  return new TokenIntrospectionService(keycloakClientFactory, cacheService);
};
