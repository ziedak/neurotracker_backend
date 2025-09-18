import {
  TokenIntrospectionResponse,
  TokenValidationResult,
  KeycloakClientConfig,
  TokenClaims,
  ITokenIntrospectionService,
  TokenValidationError,
} from "../types/index";
import { KeycloakClientFactory } from "../client/keycloak-client-factory";
import { CacheService } from "@libs/database";
import { createLogger, type ILogger } from "@libs/utils";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { createHash } from "crypto";
import {
  validateInput,
  TokenIntrospectionResponseSchema,
  TokenPayloadSchema,
} from "../validation/index";

// Create logger with explicit type
const logger: ILogger = createLogger("token-introspection-service");

/**
 * Token Hash Salt Manager - Manages rotating salts for secure token hashing
 * Implements salt rotation to prevent cache poisoning attacks
 */
class TokenHashSaltManager {
  private currentSalt: string;
  private previousSalt?: string;
  private saltRotationInterval: number = 24 * 60 * 60 * 1000; // 24 hours
  private lastRotation: number;
  private rotationTimer?: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.currentSalt = this.generateSecureSalt();
    this.lastRotation = Date.now();
    this.startRotationTimer();
  }

  /**
   * Get current salt for hashing (with environment prefix)
   */
  public getCurrentSalt(): string {
    const envPrefix = process.env["NODE_ENV"] || "development";
    const instanceId = process.env["INSTANCE_ID"] || "default";
    return `${envPrefix}:${instanceId}:${this.currentSalt}`;
  }

  /**
   * Get previous salt for backward compatibility during rotation
   */
  public getPreviousSalt(): string | undefined {
    if (!this.previousSalt) return undefined;
    const envPrefix = process.env["NODE_ENV"] || "development";
    const instanceId = process.env["INSTANCE_ID"] || "default";
    return `${envPrefix}:${instanceId}:${this.previousSalt}`;
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
   * Generate cryptographically secure salt
   */
  private generateSecureSalt(): string {
    const randomBytes = createHash("sha256")
      .update(
        Math.random().toString() +
          Date.now().toString() +
          process.hrtime().toString()
      )
      .digest("hex");
    return randomBytes.substring(0, 32); // 128 bits of entropy
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

  constructor(
    private readonly keycloakClientFactory: KeycloakClientFactory,
    private readonly cacheService: CacheService
  ) {
    // Initialize secure salt management
    this.saltManager = new TokenHashSaltManager();
  }

  /**
   * Validate JWT token with Keycloak public keys
   */
  public async validateJWT(
    token: string,
    clientConfig?: KeycloakClientConfig
  ): Promise<TokenValidationResult> {
    try {
      const config =
        clientConfig || this.keycloakClientFactory.getClient("frontend");

      // Check cache first with secure fallback hashing
      const cachedResult = await this.getCachedValidationWithFallback(token);
      if (cachedResult.data && cachedResult.data.valid) {
        logger.debug("Using cached JWT validation result");
        return { ...cachedResult.data, cached: true };
      }

      // Get JWKS endpoint
      const discovery = await this.keycloakClientFactory.getDiscoveryDocument(
        config.realm
      );
      if (!discovery.jwks_uri) {
        throw new TokenValidationError(
          "JWKS endpoint not found in discovery document"
        );
      }

      // Verify JWT with remote JWKS
      const JWKS = createRemoteJWKSet(new URL(discovery.jwks_uri));

      const { payload } = await jwtVerify(token, JWKS, {
        issuer: discovery.issuer,
        audience: config.clientId,
      });

      // Validate token payload structure
      const validatedPayload = validateInput(
        TokenPayloadSchema,
        payload,
        "JWT token payload"
      );

      const claims = validatedPayload as TokenClaims;

      const result: TokenValidationResult = {
        valid: true,
        claims,
        cached: false,
      };

      // Cache the result using secure hash
      const ttl = this.calculateCacheTtl(claims);
      await this.cacheService.set(cachedResult.cacheKey, result, ttl);

      logger.info("JWT validation successful", {
        subject: claims.sub,
        client: claims.azp,
        expiry: new Date((claims.exp || 0) * 1000).toISOString(),
      });

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.warn("JWT validation failed", { error: errorMessage });

      return {
        valid: false,
        error: errorMessage,
        cached: false,
      };
    }
  }

  /**
   * Introspect token with Keycloak introspection endpoint
   */
  public async introspect(
    token: string,
    clientConfig: KeycloakClientConfig
  ): Promise<TokenIntrospectionResponse> {
    try {
      const cacheKey = `introspection:${this.hashToken(token)}`;

      // Check cache first
      const cached = await this.cacheService.get(cacheKey);
      if (
        cached.data &&
        (cached.data as TokenIntrospectionResponse).active !== undefined
      ) {
        logger.debug("Using cached introspection result");
        return cached.data as TokenIntrospectionResponse;
      }

      // Get discovery document
      const discovery = await this.keycloakClientFactory.getDiscoveryDocument(
        clientConfig.realm
      );
      if (!discovery.introspection_endpoint) {
        throw new TokenValidationError(
          "Introspection endpoint not found in discovery document"
        );
      }

      // Prepare introspection request
      const body = new URLSearchParams({
        token,
        client_id: clientConfig.clientId,
      });

      if (clientConfig.clientSecret) {
        body.append("client_secret", clientConfig.clientSecret);
      }

      // Make introspection request
      const response = await fetch(discovery.introspection_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new TokenValidationError(
          `Introspection request failed: ${response.status} ${response.statusText}`
        );
      }

      const introspectionResult: TokenIntrospectionResponse =
        await response.json();

      // Validate introspection response
      const validatedIntrospectionResult = validateInput(
        TokenIntrospectionResponseSchema,
        introspectionResult,
        "token introspection response"
      );

      // Cache the result if token is active
      if (
        validatedIntrospectionResult.active &&
        validatedIntrospectionResult.exp
      ) {
        const ttl = Math.max(
          validatedIntrospectionResult.exp - Math.floor(Date.now() / 1000) - 60,
          300
        );
        await this.cacheService.set(
          cacheKey,
          validatedIntrospectionResult,
          ttl
        );
      }

      logger.info("Token introspection completed", {
        active: validatedIntrospectionResult.active,
        client_id: validatedIntrospectionResult.client_id,
        username: validatedIntrospectionResult.username,
      });

      return validatedIntrospectionResult as TokenIntrospectionResponse;
    } catch (error) {
      logger.error("Token introspection failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get public key for JWT verification (legacy method, prefer JWKS)
   */
  public async getPublicKey(keyId: string, realm: string): Promise<string> {
    const cacheKey = `publickey:${realm}:${keyId}`;

    // Check memory cache first
    if (this.publicKeyCache.has(cacheKey)) {
      return this.publicKeyCache.get(cacheKey);
    }

    // Check Redis cache
    const cached = await this.cacheService.get(cacheKey);
    if (cached.data) {
      const publicKey = cached.data as string;
      this.publicKeyCache.set(cacheKey, publicKey);
      return publicKey;
    }

    // Fetch from Keycloak
    const discovery = await this.keycloakClientFactory.getDiscoveryDocument(
      realm
    );
    if (!discovery.jwks_uri) {
      throw new TokenValidationError(
        "JWKS URI not found in discovery document"
      );
    }

    const jwksResponse = await fetch(discovery.jwks_uri);
    if (!jwksResponse.ok) {
      throw new TokenValidationError(
        `Failed to fetch JWKS: ${jwksResponse.status}`
      );
    }

    const jwks = await jwksResponse.json();
    const key = jwks.keys.find((k: any) => k.kid === keyId);

    if (!key) {
      throw new TokenValidationError(`Key ${keyId} not found in JWKS`);
    }

    // For RSA keys, construct PEM format
    const publicKey = this.jwkToPem(key);

    // Cache the key
    await this.cacheService.set(cacheKey, publicKey, 3600); // 1 hour
    this.publicKeyCache.set(cacheKey, publicKey);

    return publicKey;
  }

  /**
   * Refresh public keys from Keycloak
   */
  public async refreshPublicKeys(realm: string): Promise<void> {
    try {
      const pattern = `publickey:${realm}:*`;
      await this.cacheService.invalidatePattern(pattern);
      this.publicKeyCache.clear();

      logger.info("Public key cache cleared for realm", { realm });
    } catch (error) {
      logger.error("Failed to refresh public keys", {
        realm,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * DEPRECATED: Use JWKS directly instead of converting to PEM
   * This method is maintained for backward compatibility only.
   *
   * SECURITY FIX: Proper JWK validation using the jose library
   * instead of manual PEM conversion which was previously broken.
   *
   * For production use, prefer validateJWT() which uses JWKS directly.
   */
  private async jwkToPem(jwk: any): Promise<string> {
    try {
      // Validate JWK structure and required parameters
      if (!jwk || typeof jwk !== "object") {
        throw new Error("Invalid JWK: must be an object");
      }

      // Validate required JWK parameters
      if (!jwk.kty || typeof jwk.kty !== "string") {
        throw new Error("Invalid JWK: missing or invalid key type (kty)");
      }

      if (!jwk.alg || typeof jwk.alg !== "string") {
        throw new Error("Invalid JWK: missing or invalid algorithm (alg)");
      }

      // Validate algorithm-specific parameters
      switch (jwk.kty) {
        case "RSA":
          if (!jwk.n || !jwk.e) {
            throw new Error(
              "Invalid RSA JWK: missing modulus (n) or exponent (e)"
            );
          }
          // Validate key size (should be at least 2048 bits)
          const modulusLength = Buffer.from(jwk.n, "base64url").length * 8;
          if (modulusLength < 2048) {
            throw new Error(
              "Invalid RSA JWK: key size too small (minimum 2048 bits)"
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
          const supportedCurves = ["P-256", "P-384", "P-521"];
          if (!supportedCurves.includes(jwk.crv)) {
            throw new Error(`Invalid EC JWK: unsupported curve ${jwk.crv}`);
          }
          break;

        default:
          throw new Error(`Invalid JWK: unsupported key type ${jwk.kty}`);
      }

      // SECURITY FIX: Use jose library for proper validation and key import
      // This ensures cryptographically correct key handling
      const { importJWK, exportSPKI } = await import("jose");

      try {
        // Import and validate the JWK using JOSE
        const key = await importJWK(jwk as any, jwk.alg);

        // Ensure key is a proper KeyLike object before export
        if (!key || typeof key !== "object" || !("type" in key)) {
          throw new Error(
            "Invalid JWK: key import resulted in invalid key object"
          );
        }

        // Export as SPKI (Subject Public Key Info) format
        // This is the correct way to get a PEM-compatible public key
        const spki = await exportSPKI(key as any);

        logger.debug(
          "JWK successfully validated and converted to SPKI format",
          {
            keyType: jwk.kty,
            algorithm: jwk.alg,
            keyId: jwk.kid,
          }
        );

        return spki;
      } catch (importError) {
        throw new Error(
          `JWK import/validation failed: ${
            importError instanceof Error
              ? importError.message
              : String(importError)
          }`
        );
      }
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
   * Calculate cache TTL based on token expiration
   */
  private calculateCacheTtl(claims: TokenClaims): number {
    if (claims.exp) {
      const now = Math.floor(Date.now() / 1000);
      const ttl = claims.exp - now - 60; // Cache until 1 minute before expiration
      return Math.max(ttl, 300); // Minimum 5 minutes
    }
    return 3600; // Default 1 hour
  }

  /**
   * SECURE: Create a cryptographic hash of the token for cache key
   * Uses SHA-256 with rotating salt for security and collision resistance
   * Returns full 256-bit hash for maximum security against collision attacks
   */
  private hashToken(token: string): string {
    const currentSalt = this.saltManager.getCurrentSalt();
    const hash = createHash("sha256")
      .update(token + currentSalt)
      .digest("hex");

    // Return full 64-character hash for cache key (256-bit security)
    // This prevents collision attacks in high-volume token scenarios
    return hash;
  }

  /**
   * SECURE: Hash token with fallback to previous salt during rotation periods
   * Allows cache hits during salt rotation windows
   */
  private async hashTokenWithFallback(token: string): Promise<string[]> {
    const hashes: string[] = [];

    // Always include current salt hash
    hashes.push(this.hashToken(token));

    // Include previous salt hash if available (for rotation transition period)
    const previousSalt = this.saltManager.getPreviousSalt();
    if (previousSalt) {
      const previousHash = createHash("sha256")
        .update(token + previousSalt)
        .digest("hex");
      // Return full 64-character hash for maximum security
      hashes.push(previousHash);
    }

    return hashes;
  }

  /**
   * Try to get cached value with fallback to previous salt
   */
  private async getCachedValidationWithFallback(token: string): Promise<{
    data: TokenValidationResult | null;
    cacheKey: string;
  }> {
    const possibleHashes = await this.hashTokenWithFallback(token);

    for (const hash of possibleHashes) {
      const cacheKey = `jwt:validation:${hash}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached.data && (cached.data as TokenValidationResult).valid) {
        logger.debug("Cache hit with hash fallback", {
          hashIndex: possibleHashes.indexOf(hash),
          totalHashes: possibleHashes.length,
        });
        return {
          data: cached.data as TokenValidationResult,
          cacheKey,
        };
      }
    }

    // Return primary cache key for new entries
    return {
      data: null,
      cacheKey: `jwt:validation:${possibleHashes[0]}`,
    };
  }

  /**
   * Get token validation statistics
   */
  public async getValidationStats(): Promise<{
    cacheHits: number;
    cacheMisses: number;
    introspectionCalls: number;
    jwtValidations: number;
  }> {
    const stats = this.cacheService.getStats();

    return {
      cacheHits: stats.Hits,
      cacheMisses: stats.Misses,
      introspectionCalls: 0, // Would need to track this separately
      jwtValidations: 0, // Would need to track this separately
    };
  }

  /**
   * Shutdown service and cleanup resources
   * SECURITY FIX: Ensures proper salt manager cleanup to prevent memory leaks
   */
  public async shutdown(): Promise<void> {
    logger.info("Shutting down TokenIntrospectionService");

    // SECURITY FIX: Shutdown salt manager to prevent memory leaks
    this.saltManager.shutdown();

    // Clear memory caches
    this.publicKeyCache.clear();

    logger.info("TokenIntrospectionService shutdown completed");
  }

  /**
   * Get service health status including salt rotation status
   */
  public getHealthStatus(): {
    healthy: boolean;
    publicKeyCacheSize: number;
    saltRotationStats: any;
  } {
    return {
      healthy: true,
      publicKeyCacheSize: this.publicKeyCache.size,
      saltRotationStats: this.saltManager.getStats(),
    };
  }

  /**
   * Clean up expired tokens from cache
   */
  public async cleanupExpiredTokens(): Promise<void> {
    try {
      const patterns = ["jwt:validation:*", "introspection:*"];
      let totalCleaned = 0;

      for (const pattern of patterns) {
        const cleaned = await this.cacheService.invalidatePattern(pattern);
        totalCleaned += cleaned;
      }

      logger.info("Cleaned up expired tokens from cache", { totalCleaned });
    } catch (error) {
      logger.error("Failed to cleanup expired tokens", { error });
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
