/**
 * Keycloak Authentication Service
 *
 * Provides JWT validation, user info retrieval, and token management
 * with caching and comprehensive error handling for production use.
 */

import { type ILogger, MetricsCollector, RateLimiter } from "@libs/monitoring";
import { executeWithRetryAndBreaker, inject, injectable } from "@libs/utils";
import { RedisClient } from "@libs/database";
import {
  HttpStatus,
  sendHttpRequestWithRetryAndBreaker,
  sendHttpRequestForJson,
} from "@libs/messaging";
import { createHash } from "crypto";
import {
  KeycloakConfig,
  KeycloakJWTPayload,
  KeycloakUserInfo,
  KeycloakTokenVerification,
  KeycloakIntrospectionResponse,
  KeycloakServiceResponse,
  JWKS,
  JWK,
  KeycloakError,
  KeycloakErrorType,
} from "./types";

/**
 * Keycloak Authentication Service
 */
@injectable()
export class KeycloakService {
  private readonly config: KeycloakConfig;
  private readonly rateLimiter: RateLimiter;
  private publicKey?: string | undefined;
  private jwksCache: Map<string, { key: string; expiresAt: number }> =
    new Map();
  private inMemoryCache: Map<string, { data: any; expiresAt: number }> =
    new Map();
  private joseModule: typeof import("jose") | null = null;
  private isJoseAvailable = false;

  constructor(
    @inject("RedisClient") private redis: RedisClient,
    @inject("Logger") private logger: ILogger,
    @inject("MetricsCollector") private metrics: MetricsCollector,
    config: KeycloakConfig
  ) {
    this.config = this.validateConfig(config);
    this.rateLimiter = new RateLimiter();

    this.publicKey = config.publicKey;

    // Initialize jose module check
    this.initializeJose();

    this.logger.info("Keycloak service initialized", {
      serverUrl: config.serverUrl,
      realm: config.realm,
      clientId: config.clientId,
      verifyTokenLocally: config.verifyTokenLocally ?? true,
      cacheTTL: config.cacheTTL ?? 300,
      joseAvailable: this.isJoseAvailable,
    });
  }

  /**
   * Validate and normalize configuration
   */
  private validateConfig(config: KeycloakConfig): KeycloakConfig {
    if (!config.serverUrl) {
      throw new KeycloakError(
        "Keycloak server URL is required",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }
    if (!config.realm) {
      throw new KeycloakError(
        "Keycloak realm is required",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }
    if (!config.clientId) {
      throw new KeycloakError(
        "Keycloak client ID is required",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    const serverUrl = config.serverUrl.replace(/\/$/, "");
    const jwksUri =
      config.jwksUri ||
      `${serverUrl}/realms/${config.realm}/protocol/openid_connect/certs`;

    return {
      ...config,
      serverUrl,
      jwksUri,
      rolesClaim: config.rolesClaim || "realm_access.roles",
      usernameClaim: config.usernameClaim || "preferred_username",
      emailClaim: config.emailClaim || "email",
      groupsClaim: config.groupsClaim || "groups",
      cacheTTL: config.cacheTTL || 300,
      verifyTokenLocally: config.verifyTokenLocally ?? true,
      connectTimeout: config.connectTimeout || 5000,
      readTimeout: config.readTimeout || 5000,
    };
  }

  /**
   * Initialize jose module with proper error handling
   */
  private async initializeJose(): Promise<void> {
    try {
      this.joseModule = await import("jose");
      this.isJoseAvailable = true;
      this.logger.info("Jose module loaded successfully");
    } catch (error) {
      this.isJoseAvailable = false;
      this.logger.error(
        "Jose module not available - local token verification disabled",
        error as Error
      );
    }
  }

  /**
   * Create namespaced cache key
   */
  private createCacheKey(type: string, identifier: string): string {
    const namespace = this.config.realm;
    const hashedId = this.hashToken(identifier);
    return `keycloak:${namespace}:${type}:${hashedId}`;
  }

  /**
   * Safe cache operation with fallback to in-memory
   */
  private async safeGetCache(key: string): Promise<string | null> {
    try {
      // Try Redis first
      const result = await this.redis.safeGet(key);
      await this.metrics.recordCounter("keycloak_cache_redis_hit");
      return result;
    } catch (error) {
      this.logger.warn(
        "Redis cache get failed, checking in-memory cache",
        error as Error
      );
      await this.metrics.recordCounter("keycloak_cache_redis_miss");

      // Fallback to in-memory cache
      const cached = this.inMemoryCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        await this.metrics.recordCounter("keycloak_cache_memory_hit");
        return JSON.stringify(cached.data);
      }

      await this.metrics.recordCounter("keycloak_cache_memory_miss");
      return null;
    }
  }

  /**
   * Safe cache set operation with fallback to in-memory
   */
  private async safeSetCache(
    key: string,
    value: string,
    ttlSeconds: number
  ): Promise<void> {
    try {
      // Try Redis first
      await this.redis.safeSet(key, value, ttlSeconds);
      await this.metrics.recordCounter("keycloak_cache_redis_set");
    } catch (error) {
      this.logger.warn(
        "Redis cache set failed, using in-memory cache",
        error as Error
      );
      await this.metrics.recordCounter("keycloak_cache_redis_set_failed");

      // Fallback to in-memory cache
      const expiresAt = Date.now() + ttlSeconds * 1000;
      this.inMemoryCache.set(key, { data: JSON.parse(value), expiresAt });
      await this.metrics.recordCounter("keycloak_cache_memory_set");
    }
  }

  /**
   * Verify JWT token with rate limiting and circuit breaker
   */
  async verifyToken(token: string): Promise<KeycloakTokenVerification> {
    const startTime = Date.now();
    const clientId = this.config.clientId;

    try {
      // Rate limiting check
      const rateLimitResult = await this.rateLimiter.checkRateLimit(
        `keycloak_verify:${clientId}`,
        100, // 100 verifications per minute
        60000
      );

      if (!rateLimitResult.allowed) {
        await this.metrics.recordCounter("keycloak_verify_rate_limited");
        throw new KeycloakError(
          "Rate limit exceeded for token verification",
          KeycloakErrorType.RATE_LIMITED
        );
      }

      const cacheKey = this.createCacheKey("token", token);

      // Check cache first
      const cachedRaw = await this.safeGetCache(cacheKey);
      if (cachedRaw) {
        const cached: KeycloakTokenVerification = JSON.parse(cachedRaw);
        await this.metrics.recordTimer(
          "keycloak_verify_duration",
          Date.now() - startTime,
          {
            source: "cache",
            valid: cached.valid.toString(),
          }
        );

        this.logger.debug("Token verification result from cache", {
          valid: cached.valid,
          source: "cache",
        });
        return cached;
      }

      // Perform verification with circuit breaker
      const result = await executeWithRetryAndBreaker(
        async () => {
          if (this.config.verifyTokenLocally && this.isJoseAvailable) {
            return await this.verifyTokenLocally(token);
          } else {
            return await this.verifyTokenRemotely(token);
          }
        },
        (error) => {
          this.logger.error("Token verification failed", error as Error);
        }
      );

      // Cache the result
      if (result.valid && result.payload) {
        const ttl = Math.min(
          result.payload.exp - Math.floor(Date.now() / 1000),
          this.config.cacheTTL!
        );
        if (ttl > 0) {
          await this.safeSetCache(cacheKey, JSON.stringify(result), ttl);
        }
      }

      await this.metrics.recordTimer(
        "keycloak_verify_duration",
        Date.now() - startTime,
        {
          source: result.source,
          valid: result.valid.toString(),
        }
      );
      await this.metrics.recordCounter("keycloak_verify_success");

      return result;
    } catch (error) {
      await this.metrics.recordTimer(
        "keycloak_verify_duration",
        Date.now() - startTime,
        {
          source: "error",
          valid: "false",
        }
      );
      await this.metrics.recordCounter("keycloak_verify_failed", 1, {
        error_type: error instanceof KeycloakError ? error.type : "unknown",
      });

      this.logger.error("Token verification failed", error as Error);

      if (error instanceof KeycloakError) {
        return {
          valid: false,
          error: error.message,
          source: this.config.verifyTokenLocally ? "local" : "remote",
        };
      }

      return {
        valid: false,
        error: (error as Error).message,
        source: this.config.verifyTokenLocally ? "local" : "remote",
      };
    }
  }

  /**
   * Verify token locally using public key or JWKS with enhanced security
   */
  private async verifyTokenLocally(
    token: string
  ): Promise<KeycloakTokenVerification> {
    if (!this.isJoseAvailable || !this.joseModule) {
      throw new KeycloakError(
        "Jose module not available - cannot perform local verification",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    try {
      // Parse JWT header to get algorithm and key ID
      const [headerB64] = token.split(".");
      if (!headerB64) {
        throw new KeycloakError(
          "Invalid JWT format - missing header",
          KeycloakErrorType.INVALID_TOKEN
        );
      }

      const header = JSON.parse(Buffer.from(headerB64, "base64").toString());

      // Validate algorithm security
      const allowedAlgorithms = [
        "RS256",
        "RS384",
        "RS512",
        "PS256",
        "PS384",
        "PS512",
        "ES256",
        "ES384",
        "ES512",
      ];
      if (!header.alg || !allowedAlgorithms.includes(header.alg)) {
        throw new KeycloakError(
          `Unsupported or insecure JWT algorithm: ${
            header.alg
          }. Allowed: ${allowedAlgorithms.join(", ")}`,
          KeycloakErrorType.INVALID_SIGNATURE
        );
      }

      // Get public key for verification
      let publicKey = this.publicKey;
      if (!publicKey && header.kid) {
        const pk = await this.getPublicKeyFromJWKS(header.kid);
        publicKey = pk === null ? undefined : pk;
      }
      if (!publicKey) {
        throw new KeycloakError(
          "No public key available for token verification",
          KeycloakErrorType.CONFIGURATION_ERROR
        );
      }

      // Verify token signature and decode payload
      const payload = await this.decodeAndVerifyToken(
        token,
        publicKey,
        header.alg
      );

      // Enhanced payload validation
      await this.validateTokenPayload(payload);

      // Get user info from payload
      const userInfo = this.extractUserInfoFromPayload(payload);

      return {
        valid: true,
        payload,
        userInfo,
        source: "local",
      };
    } catch (error) {
      if (error instanceof KeycloakError) {
        throw error;
      }
      throw new KeycloakError(
        `Local token verification failed: ${(error as Error).message}`,
        KeycloakErrorType.INVALID_TOKEN
      );
    }
  }

  /**
   * Verify token remotely using Keycloak introspection endpoint with circuit breaker
   */
  private async verifyTokenRemotely(
    token: string
  ): Promise<KeycloakTokenVerification> {
    try {
      const response =
        await sendHttpRequestWithRetryAndBreaker<KeycloakIntrospectionResponse>(
          {
            method: "POST",
            url: `${this.config.serverUrl}/realms/${this.config.realm}/protocol/openid_connect/token/introspect`,
            data: (() => {
              const params = new URLSearchParams({
                token: token,
                client_id: this.config.clientId,
              });
              if (this.config.clientSecret) {
                params.append("client_secret", this.config.clientSecret);
              }
              return params;
            })(),
          }
        );

      if (response.status < 200 || response.status >= 300) {
        throw new KeycloakError(
          `Introspection request failed: HTTP ${response.status}`,
          KeycloakErrorType.CONNECTION_ERROR,
          response.status
        );
      }

      const data: KeycloakIntrospectionResponse = response.data;

      if (!data.active) {
        return {
          valid: false,
          error: "Token is not active",
          source: "remote",
        };
      }

      // Convert introspection response to JWT payload format
      const payload: KeycloakJWTPayload = {
        sub: data.sub ?? "",
        iss: data.iss ?? "",
        aud: data.aud ?? "",
        exp: data.exp ?? 0,
        iat: data.iat ?? 0,
        jti: data.jti ?? "",
        typ: "Bearer",
        preferred_username: data.preferred_username ?? "",
        email: data.email ?? "",
        name: data.name ?? "",
        given_name: data.given_name ?? "",
        family_name: data.family_name ?? "",
        realm_access: data.realm_access ?? { roles: [] },
        resource_access: data.resource_access ?? {},
        groups: data.groups ?? [],
      };

      const userInfo = this.extractUserInfoFromPayload(payload);

      return {
        valid: true,
        payload,
        userInfo,
        source: "remote",
      };
    } catch (error) {
      if (error instanceof KeycloakError) {
        throw error;
      }
      throw new KeycloakError(
        `Remote token verification failed: ${(error as Error).message}`,
        KeycloakErrorType.CONNECTION_ERROR
      );
    }
    // });
  }

  /**
   * Get public key from JWKS endpoint
   */
  private async getPublicKeyFromJWKS(keyId: string): Promise<string | null> {
    try {
      const cacheKey = `keycloak:jwks:${this.config.realm}`;
      let jwksRaw = await this.redis.safeGet(cacheKey);
      let jwks: JWKS | null = null;
      if (jwksRaw) {
        jwks = JSON.parse(jwksRaw);
      }
      if (!jwks) {
        jwks = await sendHttpRequestForJson<JWKS>({
          url: this.config.jwksUri!,
        });
        await this.redis.safeSet(
          cacheKey,
          JSON.stringify(jwks),
          this.config.cacheTTL!
        );
      }
      const key = jwks!.keys.find((k) => k.kid === keyId);
      if (!key) {
        throw new Error(`Key with ID ${keyId} not found in JWKS`);
      }

      // Validate key properties for security
      if (!key.use || key.use !== "sig") {
        this.logger.warn("JWK key without signature use found", {
          kid: keyId,
          use: key.use,
        });
      }

      if (!key.alg) {
        this.logger.warn("JWK key without algorithm specified", { kid: keyId });
      }

      return await this.jwkToPublicKey(key);
    } catch (error) {
      this.logger.error("Failed to get public key from JWKS", error as Error, {
        keyId,
        jwksUri: this.config.jwksUri,
      });
      return null;
    }
  }

  /**
   * Convert JWK to PEM public key format using proper cryptographic methods
   */
  private async jwkToPublicKey(jwk: JWK): Promise<string> {
    if (jwk.kty !== "RSA" && jwk.kty !== "EC") {
      throw new Error(
        `Unsupported key type: ${jwk.kty}. Only RSA and EC are supported.`
      );
    }

    try {
      // Use jose library for secure JWK to PEM conversion
      const { importJWK, exportSPKI } = await import("jose");
      const keyObject = await importJWK(jwk, jwk.alg);
      if (typeof keyObject === "object" && "type" in keyObject) {
        const pem = await exportSPKI(keyObject as any);
        // Validate the converted key
        if (!pem.includes("-----BEGIN PUBLIC KEY-----")) {
          throw new Error("Invalid PEM format generated from JWK");
        }
        return pem;
      } else {
        throw new Error("importJWK did not return a valid KeyLike object");
      }
    } catch (error) {
      this.logger.error("Failed to convert JWK to PEM", error as Error, {
        kid: jwk.kid,
      });
      throw new KeycloakError(
        `JWK to PEM conversion failed: ${(error as Error).message}`,
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }
  }

  /**
   * Decode and verify JWT token
   */
  private async decodeAndVerifyToken(
    token: string,
    publicKey: string,
    algorithm: string
  ): Promise<KeycloakJWTPayload> {
    // Production-grade JWT verification using 'jose'
    // Only RS256/PS256/ES256 algorithms are allowed for Keycloak
    // Throws KeycloakError on any verification or claim failure
    let jwtVerify;
    try {
      jwtVerify = await import("jose").then((mod) => mod.jwtVerify);
    } catch (err) {
      throw new KeycloakError(
        "Missing 'jose' library for JWT verification",
        KeycloakErrorType.CONFIGURATION_ERROR
      );
    }

    try {
      // Convert PEM public key to CryptoKey
      const { importSPKI } = await import("jose");
      const cryptoKey = await importSPKI(publicKey, algorithm);

      // Verify JWT signature and decode
      const { payload } = await jwtVerify(token, cryptoKey, {
        algorithms: [algorithm],
        clockTolerance: 60, // allow 60s clock skew
      });

      // Validate required claims
      const now = Math.floor(Date.now() / 1000);
      if (typeof payload.exp !== "number" || payload.exp < now) {
        throw new KeycloakError(
          "Token has expired",
          KeycloakErrorType.TOKEN_EXPIRED
        );
      }
      if (typeof payload.iat !== "number" || payload.iat > now + 60) {
        throw new KeycloakError(
          "Token used before valid",
          KeycloakErrorType.INVALID_TOKEN
        );
      }
      // Enforce issuer, audience, and other claims as needed
      // (Issuer/audience checked in validateTokenPayload)

      return payload as KeycloakJWTPayload;
    } catch (err) {
      throw new KeycloakError(
        `JWT verification failed: ${(err as Error).message}`,
        KeycloakErrorType.INVALID_SIGNATURE
      );
    }
  }

  /**
   * Enhanced token payload validation against configuration
   */
  private async validateTokenPayload(
    payload: KeycloakJWTPayload
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // Enhanced time-based validations
    if (!payload.exp || payload.exp <= now) {
      throw new KeycloakError(
        "Token has expired",
        KeycloakErrorType.TOKEN_EXPIRED
      );
    }

    if (!payload.iat || payload.iat > now + 300) {
      // Allow 5 minutes clock skew
      throw new KeycloakError(
        "Token issued in the future",
        KeycloakErrorType.INVALID_TOKEN
      );
    }

    if (payload["nbf"] && payload["nbf"] > now + 300) {
      throw new KeycloakError(
        "Token not yet valid",
        KeycloakErrorType.INVALID_TOKEN
      );
    }

    // Validate issuer
    const expectedIssuer = `${this.config.serverUrl}/realms/${this.config.realm}`;
    if (payload.iss !== expectedIssuer) {
      throw new KeycloakError(
        `Invalid token issuer: expected ${expectedIssuer}, got ${payload.iss}`,
        KeycloakErrorType.INVALID_ISSUER
      );
    }

    // Enhanced audience validation
    if (Array.isArray(payload.aud)) {
      if (!payload.aud.includes(this.config.clientId)) {
        throw new KeycloakError(
          `Token not issued for this client: ${this.config.clientId}`,
          KeycloakErrorType.INVALID_AUDIENCE
        );
      }
    } else if (payload.aud && payload.aud !== this.config.clientId) {
      throw new KeycloakError(
        `Token not issued for this client: ${this.config.clientId}`,
        KeycloakErrorType.INVALID_AUDIENCE
      );
    }

    // Validate required claims
    if (!payload.sub) {
      throw new KeycloakError(
        "Token missing required 'sub' claim",
        KeycloakErrorType.INVALID_TOKEN
      );
    }

    if (!payload.jti) {
      throw new KeycloakError(
        "Token missing required 'jti' claim",
        KeycloakErrorType.INVALID_TOKEN
      );
    }

    // Check for token reuse (optional - requires blacklist implementation)
    await this.metrics.recordCounter("keycloak_token_validated");
  }

  /**
   * Extract user information from JWT payload
   */
  private extractUserInfoFromPayload(
    payload: KeycloakJWTPayload
  ): KeycloakUserInfo {
    const roles: string[] = [];
    const groups: string[] = [];
    const clientRoles: Record<string, string[]> = {};

    // Extract realm roles
    if (payload.realm_access?.roles) {
      roles.push(...payload.realm_access.roles);
    }

    // Extract client roles
    if (payload.resource_access) {
      Object.entries(payload.resource_access).forEach(([client, access]) => {
        if (access.roles) {
          clientRoles[client] = access.roles;
          if (client === this.config.clientId) {
            roles.push(...access.roles);
          }
        }
      });
    }

    // Extract groups
    if (payload.groups) {
      groups.push(...payload.groups);
    }

    return {
      sub: payload.sub ?? "",
      email: payload.email ?? "",
      emailVerified: payload.email_verified ?? false,
      name: payload.name ?? "",
      preferredUsername: payload.preferred_username ?? "",
      givenName: payload.given_name ?? "",
      familyName: payload.family_name ?? "",
      roles: [...new Set(roles)], // Remove duplicates
      groups: [...new Set(groups)], // Remove duplicates
      clientRoles,
      attributes: {
        sessionId: payload.session_state,
        authTime: payload.auth_time,
        nonce: payload.nonce,
        scope: payload.scope,
      },
    };
  }

  /**
   * Get user information from Keycloak UserInfo endpoint
   */
  async getUserInfo(
    token: string
  ): Promise<KeycloakServiceResponse<KeycloakUserInfo>> {
    try {
      const cacheKey = `keycloak:userinfo:${this.hashToken(token)}`;
      const cachedRaw = await this.redis.safeGet(cacheKey);
      if (cachedRaw) {
        const cached: KeycloakUserInfo = JSON.parse(cachedRaw);
        return {
          success: true,
          data: cached,
          cached: true,
          source: "cache",
        };
      }
      const userInfoUrl = `${this.config.serverUrl}/realms/${this.config.realm}/protocol/openid_connect/userinfo`;
      const userInfoData = await sendHttpRequestForJson({
        url: userInfoUrl,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const userInfo = this.mapUserInfoResponse(userInfoData);
      await this.redis.safeSet(
        cacheKey,
        JSON.stringify(userInfo),
        this.config.cacheTTL!
      );
      return {
        success: true,
        data: userInfo,
        cached: false,
        source: "remote",
      };
    } catch (error) {
      this.logger.error("Failed to get user info", error as Error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Map UserInfo endpoint response to KeycloakUserInfo
   */
  private mapUserInfoResponse(data: any): KeycloakUserInfo {
    return {
      sub: data.sub ?? "",
      email: data.email ?? "",
      emailVerified: data.email_verified ?? false,
      name: data.name ?? "",
      preferredUsername: data.preferred_username ?? "",
      givenName: data.given_name ?? "",
      familyName: data.family_name ?? "",
      roles: data.realm_access?.roles || [],
      groups: data.groups || [],
      clientRoles: data.resource_access || {},
      attributes: {
        locale: data.locale,
        zoneinfo: data.zoneinfo,
        updatedAt: data.updated_at,
      },
    };
  }

  /**
   * Create a secure hash of the token for caching
   */
  private hashToken(token: string): string {
    return createHash("sha256")
      .update(token)
      .update(this.config.clientId)
      .digest("hex")
      .substring(0, 32);
  }

  /**
   * Get cache statistics using efficient Redis operations
   */
  async getCacheStats(): Promise<Record<string, number>> {
    const stats = { tokenCacheSize: 0, userInfoCacheSize: 0, jwksCacheSize: 0 };

    try {
      // Use SCAN instead of KEYS for better performance
      const scanPromises = [
        this.scanKeys("keycloak:token:*"),
        this.scanKeys("keycloak:userinfo:*"),
        this.scanKeys("keycloak:jwks:*"),
      ];

      const [tokenCount, userInfoCount, jwksCount] = await Promise.all(
        scanPromises
      );

      return {
        tokenCacheSize: tokenCount ?? 0,
        userInfoCacheSize: userInfoCount ?? 0,
        jwksCacheSize: jwksCount ?? 0,
        memoryJwksCache: this.jwksCache.size,
      };
    } catch (error) {
      this.logger.error("Failed to get cache statistics", error as Error);
      return stats;
    }
  }

  /**
   * Clear all caches efficiently using pipeline operations
   */
  async clearCache(): Promise<void> {
    try {
      // Clear Redis caches using pattern-based deletion
      const patterns = [
        "keycloak:token:*",
        "keycloak:userinfo:*",
        "keycloak:jwks:*",
      ];

      for (const pattern of patterns) {
        const keys = await this.scanKeys(pattern);
        if (keys > 0) {
          // Use SCAN with UNLINK for non-blocking deletion
          await this.deleteKeysByPattern(pattern);
        }
      }

      // Clear in-memory cache and clean up expired entries
      this.jwksCache.clear();

      this.logger.info("All Keycloak caches cleared successfully");
    } catch (error) {
      this.logger.error("Failed to clear caches", error as Error);
      throw new KeycloakError(
        "Cache clearing failed",
        KeycloakErrorType.CONNECTION_ERROR
      );
    }
  }

  /**
   * Efficiently count keys matching a pattern using SCAN
   */
  private async scanKeys(pattern: string): Promise<number> {
    let cursor = "0";
    let count = 0;

    do {
      const result = await this.redis.safeScan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = result[0];
      count += result[1].length;
    } while (cursor !== "0");

    return count;
  }

  /**
   * Delete keys by pattern efficiently
   */
  private async deleteKeysByPattern(pattern: string): Promise<void> {
    let cursor = "0";
    const pipeline = await this.redis.safePipeline();

    do {
      const result = await this.redis.safeScan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        1000
      );
      cursor = result[0];
      const keys = result[1];

      if (keys.length > 0) {
        pipeline.unlink(...keys);
      }
    } while (cursor !== "0");

    await pipeline.exec();
  }

  /**
   * Clean up expired JWKS cache entries
   */
  public cleanupJwksCache(): void {
    const now = Date.now();
    for (const [kid, entry] of this.jwksCache.entries()) {
      if (entry.expiresAt < now) {
        this.jwksCache.delete(kid);
        this.logger.debug("Removed expired JWKS cache entry", { kid });
      }
    }
  }

  /**
   * Get health status of the Keycloak service
   */
  async getHealthStatus(): Promise<{
    status: "healthy" | "unhealthy";
    details: any;
  }> {
    try {
      // Check Redis connectivity
      await this.redis.ping();

      // Circuit breaker is disabled for now
      const cbStatus = "disabled";

      // Check JWKS endpoint accessibility
      const jwksResponse = await sendHttpRequestWithRetryAndBreaker({
        url: this.config.jwksUri!,
        method: "HEAD",
      });

      return {
        status: "healthy",
        details: {
          redis: "connected",
          circuitBreaker: cbStatus,
          jwksEndpoint: HttpStatus.isSuccess(jwksResponse.status)
            ? "accessible"
            : "error",
          cacheStats: await this.getCacheStats(),
        },
      };
    } catch (error) {
      this.logger.error("Health check failed", error as Error);
      return {
        status: "unhealthy",
        details: {
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Destroy the service and clean up resources
   */
  async destroy(): Promise<void> {
    try {
      await this.clearCache();
      // Circuit breaker cleanup disabled
      // this.circuitBreaker.destroy?.();
      this.logger.info("Keycloak service destroyed successfully");
    } catch (error) {
      this.logger.error("Error during service destruction", error as Error);
    }
  }
}
