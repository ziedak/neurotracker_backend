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

// Create logger with explicit type
const logger: ILogger = createLogger("token-introspection-service");

/**
 * Token Introspection Service
 * Handles JWT validation and token introspection with Keycloak
 * Uses existing @libs/database cache infrastructure
 */
export class TokenIntrospectionService implements ITokenIntrospectionService {
  private publicKeyCache = new Map<string, any>();

  constructor(
    private readonly keycloakClientFactory: KeycloakClientFactory,
    private readonly cacheService: CacheService
  ) {}

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
      const cacheKey = `jwt:validation:${this.hashToken(token)}`;

      // Check cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached.data && (cached.data as TokenValidationResult).valid) {
        logger.debug("Using cached JWT validation result");
        return { ...(cached.data as TokenValidationResult), cached: true };
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

      const claims = payload as TokenClaims;

      const result: TokenValidationResult = {
        valid: true,
        claims,
        cached: false,
      };

      // Cache the result
      const ttl = this.calculateCacheTtl(claims);
      await this.cacheService.set(cacheKey, result, ttl);

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

      // Cache the result if token is active
      if (introspectionResult.active && introspectionResult.exp) {
        const ttl = Math.max(
          introspectionResult.exp - Math.floor(Date.now() / 1000) - 60,
          300
        );
        await this.cacheService.set(cacheKey, introspectionResult, ttl);
      }

      logger.info("Token introspection completed", {
        active: introspectionResult.active,
        client_id: introspectionResult.client_id,
        username: introspectionResult.username,
      });

      return introspectionResult;
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
   * Convert JWK to PEM format (simplified implementation)
   */
  private jwkToPem(jwk: any): string {
    // This is a simplified implementation
    // In production, consider using a proper JWK to PEM conversion library
    if (jwk.kty === "RSA") {
      // For RSA keys, we would normally construct a proper PEM
      // For now, return the JWK as a string (this won't work for actual verification)
      return JSON.stringify(jwk);
    }
    throw new TokenValidationError(`Unsupported key type: ${jwk.kty}`);
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
   * Create a hash of the token for cache key (for security)
   */
  private hashToken(token: string): string {
    // Use a simple hash function - in production, consider using crypto.createHash
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
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
