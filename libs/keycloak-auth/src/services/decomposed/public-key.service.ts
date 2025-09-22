import { createLogger, type ILogger } from "@libs/utils";
import { CacheService } from "@libs/database";
import { KeycloakClientFactory } from "../../client/keycloak-client-factory";
import { ServiceHealth, IBaseService, ServiceConfig } from "./interfaces";

/**
 * Public key cache entry
 */
export interface PublicKeyEntry {
  key: string;
  keyId: string;
  realm: string;
  cachedAt: number;
  expiresAt?: number;
}

/**
 * Public key fetch result
 */
export interface PublicKeyResult {
  key: string;
  keyId: string;
  realm: string;
  cached: boolean;
  fetchDuration: number;
}

/**
 * Public key service configuration
 */
export interface PublicKeyServiceConfig {
  cacheTtl: number;
  enableMemoryCache: boolean;
  maxMemoryCacheSize: number;
  enableDetailedLogging: boolean;
}

/**
 * Interface for public key service
 */
export interface IPublicKeyService extends IBaseService {
  /**
   * Get public key for JWT verification
   */
  getPublicKey(keyId: string, realm: string): Promise<PublicKeyResult>;

  /**
   * Refresh public keys for realm
   */
  refreshPublicKeys(realm: string): Promise<number>;

  /**
   * Check if key exists in cache
   */
  hasKey(keyId: string, realm: string): Promise<boolean>;

  /**
   * Get cache statistics
   */
  getCacheStats(): {
   cacheSize: number;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
  };

  /**
   * Clear all cached keys
   */
  clearCache(): Promise<void>;
}

/**
 * Public Key Service
 *
 * Manages public key fetching, caching, and conversion for JWT verification.
 * Extracts public key management concerns from the main TokenIntrospectionService
 * to provide better separation of concerns and reusability.
 *
 * Features:
 * - Multi-level caching (memory + Redis)
 * - JWKS endpoint integration
 * - Key conversion and validation
 * - Cache management and statistics
 * - Error handling and logging
 */
export class PublicKeyService implements IPublicKeyService {
  private logger: ILogger;
  private config: PublicKeyServiceConfig;
  private serviceConfig: ServiceConfig;

  // Statistics
  private stats = {
    redisHits: 0,
    redisMisses: 0,
    fetches: 0,
    fetchSuccesses: 0,
    fetchFailures: 0,
    refreshes: 0,
    cacheClears: 0,
  };

  constructor(
    private readonly keycloakClientFactory: KeycloakClientFactory,
    private readonly cacheService: CacheService,
    config?: Partial<PublicKeyServiceConfig>
  ) {
    this.logger = createLogger("public-key-service");

    this.config = {
      cacheTtl: 3600, // 1 hour
      enableMemoryCache: true,
      maxMemoryCacheSize: 100,
      enableDetailedLogging: false,
      ...config,
    };

    this.serviceConfig = {
      enabled: true,
      environment: process.env["NODE_ENV"] || "development",
      instanceId: process.env["INSTANCE_ID"] || "default",
    };

    this.logger.info("PublicKeyService initialized", {
      config: this.config,
    });
  }

  /**
   * Get public key for JWT verification
   *
   * @param keyId - Key ID (kid) from JWT header
   * @param realm - Keycloak realm
   * @returns Promise<PublicKeyResult> - Public key with metadata
   *
   * @throws {Error} When key cannot be retrieved or converted
   */
  public async getPublicKey(
    keyId: string,
    realm: string
  ): Promise<PublicKeyResult> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(keyId, realm);

    this.stats.fetches++;

    try {
      // Check Redis cache
      const cacheResult = await this.cacheService.get<PublicKeyEntry>(cacheKey);
      if (cacheResult.data) {
        this.stats.redisHits++;

        return {
          key: cacheResult.data.key,
          keyId,
          realm,
          cached: true,
          fetchDuration: Date.now() - startTime,
        };
      }

      this.stats.redisMisses++;

      // Fetch from Keycloak
      const result = await this.fetchPublicKey(keyId, realm);
      const fetchDuration = Date.now() - startTime;

      // Cache the result
      const entry: PublicKeyEntry = {
        key: result.key,
        keyId,
        realm,
        cachedAt: Date.now(),
        expiresAt: Date.now() + this.config.cacheTtl * 1000,
      };

      await this.cacheService.set(cacheKey, entry, this.config.cacheTtl);

      this.stats.fetchSuccesses++;

      this.logger.debug("Public key fetched and cached", {
        keyId,
        realm,
        duration: fetchDuration,
      });

      return {
        ...result,
        cached: false,
        fetchDuration,
      };
    } catch (error) {
      this.stats.fetchFailures++;
      this.logger.error("Failed to get public key", {
        keyId,
        realm,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Refresh public keys for realm
   *
   * @param realm - Keycloak realm to refresh
   * @returns Promise<number> - Number of keys refreshed
   */
  public async refreshPublicKeys(realm: string): Promise<number> {
    this.stats.refreshes++;

    try {
      const pattern = `publickey:${realm}:*`;
      const invalidated = await this.cacheService.invalidatePattern(pattern);

      this.logger.info("Public keys refreshed for realm", {
        realm,
        invalidated,
      });

      return invalidated;
    } catch (error) {
      this.logger.error("Failed to refresh public keys", {
        realm,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if key exists in cache
   *
   * @param keyId - Key ID to check
   * @param realm - Keycloak realm
   * @returns Promise<boolean> - True if key exists and is valid
   */
  public async hasKey(keyId: string, realm: string): Promise<boolean> {
    const cacheKey = this.getCacheKey(keyId, realm);

    // Check Redis cache
    const redisResult = await this.cacheService.get(cacheKey);
    return !!(
      redisResult.data && this.isValidEntry(redisResult.data as PublicKeyEntry)
    );
  }

  /**
   * Get cache statistics
   *
   * @returns Cache statistics
   */
  public getCacheStats(): {
    cacheSize: number;
    totalHits: number;
    totalMisses: number;
    hitRate: number;
  } {
    const totalHits = this.stats.redisHits;
    const totalMisses = this.stats.redisMisses;

    const hitRate =
      totalHits + totalMisses > 0
        ? Math.round((totalHits / (totalHits + totalMisses)) * 100 * 100) / 100
        : 0;

    return {
      cacheSize: 0, // Would need to query Redis for actual count
      totalHits,
      totalMisses,
      hitRate,
    };
  }

  /**
   * Clear all cached keys
   */
  public async clearCache(): Promise<void> {
    this.stats.cacheClears++;

    try {
      // Clear Redis cache with pattern
      await this.cacheService.invalidatePattern("publickey:*");

      this.logger.info("Public key cache cleared");
    } catch (error) {
      this.logger.error("Failed to clear public key cache", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get service health status
   */
  public getHealthStatus(): ServiceHealth {
    const uptime =
      Date.now() -
      (process.uptime() ? Date.now() - process.uptime() * 1000 : 0);
    let details = this.cacheService.getStats();
    return {
      healthy: true,
      status: "healthy",
      uptimeSeconds: Math.floor(uptime / 1000),
      lastCheck: Date.now(),
      details: {
        ...details,
        stats: this.stats,
      },
    };
  }

  /**
   * Get service configuration
   */
  public getConfig(): ServiceConfig {
    return this.serviceConfig;
  }

  /**
   * Shutdown service
   */
  public async shutdown(): Promise<void> {
    this.logger.info("Shutting down PublicKeyService");
  }

  /**
   * Fetch public key from Keycloak JWKS endpoint
   */
  private async fetchPublicKey(
    keyId: string,
    realm: string
  ): Promise<{ key: string; keyId: string; realm: string }> {
    // Get discovery document
    const discovery = await this.keycloakClientFactory.getDiscoveryDocument(
      realm
    );

    if (!discovery.jwks_uri) {
      throw new Error(`JWKS endpoint not found for realm '${realm}'`);
    }

    // Fetch JWKS
    const jwksResponse = await fetch(discovery.jwks_uri);
    if (!jwksResponse.ok) {
      throw new Error(
        `Failed to fetch JWKS for realm '${realm}' (HTTP ${jwksResponse.status})`
      );
    }

    const jwks = await jwksResponse.json();
    const jwk = jwks.keys.find((k: any) => k.kid === keyId);

    if (!jwk) {
      throw new Error(
        `Public key '${keyId}' not found in JWKS for realm '${realm}'`
      );
    }

    // Convert JWK to PEM
    const publicKey = await this.jwkToPem(jwk);

    return {
      key: publicKey,
      keyId,
      realm,
    };
  }

  /**
   * Convert JWK to PEM format
   */
  private async jwkToPem(jwk: any): Promise<string> {
    try {
      // Validate JWK structure
      if (!jwk || typeof jwk !== "object") {
        throw new Error("Invalid JWK: must be an object");
      }

      if (!jwk.kty || typeof jwk.kty !== "string") {
        throw new Error("Invalid JWK: missing or invalid key type (kty)");
      }

      // Use jose library for proper key conversion
      const { importJWK, exportSPKI } = await import("jose");

      const key = await importJWK(jwk as any, jwk.alg || "RS256");
      const spki = await exportSPKI(key as any);

      return spki;
    } catch (error) {
      throw new Error(
        `JWK conversion failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get cache key for public key
   */
  private getCacheKey(keyId: string, realm: string): string {
    return `publickey:${realm}:${keyId}`;
  }

  /**
   * Check if cache entry is still valid
   */
  private isValidEntry(entry: PublicKeyEntry): boolean {
    if (!entry.expiresAt) return true;
    return Date.now() < entry.expiresAt;
  }
}

/**
 * Factory function to create public key service
 */
export const createPublicKeyService = (
  keycloakClientFactory: KeycloakClientFactory,
  cacheService: CacheService,
  config?: Partial<PublicKeyServiceConfig>
): PublicKeyService => {
  return new PublicKeyService(keycloakClientFactory, cacheService, config);
};
