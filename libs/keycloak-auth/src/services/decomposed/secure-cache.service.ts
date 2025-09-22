import { CacheService, type CacheOperationResult } from "@libs/database";
import { type IMetricsCollector } from "@libs/monitoring";
import { randomBytes, createHmac } from "crypto";

/**
 * Secure Cache Configuration for Authentication
 */
export interface SecureCacheConfig {
  enable: boolean;
  secretKey?: string; // Optional custom secret, auto-generated if not provided
  salt?: string; // Optional custom salt, auto-generated if not provided
}

/**
 * Secure Cache Service for Authentication
 *
 * High-performance caching service optimized for authentication flows with
 * fast HMAC-SHA256 key derivation and minimal security overhead.
 *
 * Performance: Sub-millisecond cache operations
 * Security: HMAC-SHA256 key derivation prevents key enumeration
 * Simplicity: No complex salt rotation or dual-key support
 */
export class SecureCacheService extends CacheService {
  private secretKey: string;
  private salt: string;

  constructor(
    metrics?: IMetricsCollector,
    config: SecureCacheConfig = { enable: true }
  ) {
    super(metrics);

    // Generate secure keys on startup - persist across service lifetime
    this.secretKey = config.secretKey || this.generateSecureKey();
    this.salt = config.salt || this.generateSalt();

    this.logger.info("SecureCacheService initialized", {
      hasCustomSecret: !!config.secretKey,
      hasCustomSalt: !!config.salt,
    });
  }

  /**
   * Get cached data by key with fast HMAC-SHA256 derivation
   */
  public override async get<T>(key: string): Promise<CacheOperationResult<T>> {
    const startTime = performance.now();

    try {
      if (!this.isValidKey(key)) {
        this.logger.warn("Invalid cache key provided to get", {
          keyLength: key?.length,
        });
        return {
          data: null,
          source: "miss",
          latency: performance.now() - startTime,
          compressed: false,
        };
      }

      const hashedKey = this.deriveKey(key);
      const result = await super.get<T>(hashedKey);

      return {
        data: result.data,
        source: result.source,
        latency: performance.now() - startTime,
        compressed: result.compressed,
      };
    } catch (error) {
      this.logger.error("Cache get operation failed", {
        key: this.getKeyPrefix(key),
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        data: null,
        source: "miss",
        latency: performance.now() - startTime,
        compressed: false,
      };
    }
  }

  /**
   * Set data in cache with fast key derivation
   */
  public override async set<T>(
    key: string,
    data: T,
    ttl?: number
  ): Promise<void> {
    try {
      if (!this.isValidKey(key)) {
        this.logger.warn("Invalid cache key provided to set", {
          keyLength: key?.length,
        });
        return;
      }

      const hashedKey = this.deriveKey(key);
      await super.set(hashedKey, data, ttl);
    } catch (error) {
      this.logger.error("Cache set operation failed", {
        key: this.getKeyPrefix(key),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Delete data from cache
   */
  public async delete(key: string): Promise<boolean> {
    try {
      if (!this.isValidKey(key)) {
        this.logger.warn("Invalid cache key provided to delete", {
          keyLength: key?.length,
        });
        return false;
      }

      const hashedKey = this.deriveKey(key);
      await super.invalidate(hashedKey);
      return true;
    } catch (error) {
      this.logger.error("Cache delete operation failed", {
        key: this.getKeyPrefix(key),
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Fast HMAC-SHA256 key derivation for authentication caching
   */
  private deriveKey(key: string): string {
    const startTime = performance.now();

    try {
      // HMAC-SHA256 with secret key and salt - sub-millisecond performance
      const hmac = createHmac("sha256", this.secretKey);
      hmac.update(key + this.salt);
      const derivedKey = hmac.digest("hex");

      // Log performance for monitoring (only in debug mode for production)
      const duration = performance.now() - startTime;
      if (duration > 1) {
        // Log if derivation takes more than 1ms
        this.logger.warn("Slow key derivation detected", {
          key: this.getKeyPrefix(key),
          duration,
        });
      }

      return derivedKey;
    } catch (error) {
      this.logger.error("Key derivation failed", {
        error: error instanceof Error ? error.message : String(error),
        keyPrefix: this.getKeyPrefix(key),
      });
      throw error;
    }
  }

  /**
   * Generate cryptographically secure secret key
   */
  private generateSecureKey(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Generate cryptographically secure salt
   */
  private generateSalt(): string {
    return randomBytes(16).toString("hex");
  }

  /**
   * Get key prefix for logging (first part before colon)
   */
  private getKeyPrefix(key: string): string {
    const parts = key.split(":");
    return parts.length > 0 && parts[0] ? parts[0] : key;
  }
}

/**
 * Factory function to create secure cache service
 */
export const createSecureCacheService = (
  config?: SecureCacheConfig,
  metrics?: IMetricsCollector
): SecureCacheService => {
  return new SecureCacheService(metrics, config);
};

/**
 * Performance benchmark for secure cache operations
 * Validates that key derivation stays under 1ms for auth performance requirements
 */
export const benchmarkSecureCache = (iterations: number = 1000): void => {
  const cache = new SecureCacheService();
  const testKey = "user:123:session";
  const testData = { token: "jwt.token.here", expires: Date.now() + 3600000 };

  console.log(
    `\n🔍 SecureCache Performance Benchmark (${iterations} iterations)`
  );
  console.log("=".repeat(60));

  // Benchmark key derivation
  const keyDerivationTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    cache["deriveKey"](testKey); // Access private method for benchmark
    keyDerivationTimes.push(performance.now() - start);
  }

  const avgKeyDerivation =
    keyDerivationTimes.reduce((a, b) => a + b, 0) / iterations;
  const maxKeyDerivation = Math.max(...keyDerivationTimes);
  const sortedTimes = [...keyDerivationTimes].sort((a, b) => a - b);
  const p95Index = Math.floor(iterations * 0.95);
  const p95KeyDerivation =
    sortedTimes[p95Index] ?? sortedTimes[sortedTimes.length - 1] ?? 0;

  console.log(`Key Derivation Performance:`);
  console.log(`  Average: ${avgKeyDerivation.toFixed(4)}ms`);
  console.log(`  Max: ${maxKeyDerivation.toFixed(4)}ms`);
  console.log(`  P95: ${p95KeyDerivation.toFixed(4)}ms`);
  console.log(
    `  Status: ${avgKeyDerivation < 1 ? "✅ PASS" : "❌ FAIL"} (< 1ms required)`
  );

  // Benchmark full cache operations (async)
  const cacheOpTimes: number[] = [];
  const benchmarkCacheOps = async () => {
    for (let i = 0; i < Math.min(iterations, 100); i++) {
      // Limit for async ops
      const key = `${testKey}:${i}`;
      const start = performance.now();

      await cache.set(key, testData, 300);
      await cache.get(key);

      cacheOpTimes.push(performance.now() - start);
    }

    const avgCacheOp =
      cacheOpTimes.reduce((a, b) => a + b, 0) / cacheOpTimes.length;
    const maxCacheOp = Math.max(...cacheOpTimes);

    console.log(`\nFull Cache Operation Performance:`);
    console.log(`  Average: ${avgCacheOp.toFixed(4)}ms`);
    console.log(`  Max: ${maxCacheOp.toFixed(4)}ms`);
    console.log(
      `  Status: ${
        avgCacheOp < 5 ? "✅ PASS" : "❌ FAIL"
      } (< 5ms acceptable for auth)`
    );

    console.log(`\n🎯 Auth Performance Requirements:`);
    console.log(
      `  Key Derivation: < 1ms - ${
        avgKeyDerivation < 1 ? "✅ MET" : "❌ NOT MET"
      }`
    );
    console.log(
      `  Cache Operations: < 5ms - ${avgCacheOp < 5 ? "✅ MET" : "❌ NOT MET"}`
    );
  };

  benchmarkCacheOps().catch(console.error);
};
