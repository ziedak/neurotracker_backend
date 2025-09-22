import { createLogger, type ILogger } from "@libs/utils";
import { type IMetricsCollector } from "@libs/monitoring";
import { randomBytes } from "crypto";
import * as CryptoJS from "crypto-js";

/**
 * Configuration for key derivation
 */
export interface KeyDerivationConfig {
  kdfIterations: number;
  kdfKeyLength: number;
  saltRotationInterval: number;
  enableDualKeySupport: boolean;
  dualKeyTransitionPeriod: number;
  enableMetrics: boolean;
}

/**
 * Salt information for key derivation
 */
export interface SaltInfo {
  currentSalt: string;
  previousSalt?: string;
  version: number;
  lastRotation: number;
}

/**
 * Key derivation service with secure PBKDF2 implementation
 * Handles salt rotation, dual-key support, and performance monitoring
 */
export class KeyDerivationService {
  private logger: ILogger;
  private metrics: IMetricsCollector | undefined;
  private config: KeyDerivationConfig;
  private saltInfo: SaltInfo;

  constructor(config: KeyDerivationConfig, metrics?: IMetricsCollector) {
    this.logger = createLogger("key-derivation-service");
    this.metrics = metrics;
    this.config = config;

    // Initialize salt
    this.saltInfo = {
      currentSalt: this.generateSecureSalt(),
      version: 1,
      lastRotation: Date.now(),
    };

    this.logger.info("KeyDerivationService initialized", {
      config: this.config,
      saltVersion: this.saltInfo.version,
    });
  }

  /**
   * Derive a secure key from the input key
   * Handles salt rotation automatically
   */
  public async deriveKey(key: string): Promise<string> {
    // Check if salt rotation is needed
    if (this.shouldRotateSalt()) {
      await this.rotateSalt();
    }

    return this.deriveKeyWithSalt(key, this.saltInfo.currentSalt);
  }

  /**
   * Derive key with specific salt
   */
  public async deriveKeyWithSalt(key: string, salt: string): Promise<string> {
    const startTime = performance.now();

    try {
      // Use crypto-js PBKDF2 for consistent key derivation
      const derivedKey = CryptoJS.PBKDF2(key, salt, {
        keySize: this.config.kdfKeyLength / 4, // crypto-js uses 32-bit words
        iterations: this.config.kdfIterations,
      });

      // Convert to hex string
      const hexKey = derivedKey.toString(CryptoJS.enc.Hex);

      this.recordMetrics("key_derivation", performance.now() - startTime, {
        iterations: this.config.kdfIterations.toString(),
      });

      return hexKey;
    } catch (error) {
      this.logger.error("Key derivation failed", {
        error: error instanceof Error ? error.message : String(error),
        keyPrefix: this.getKeyPrefix(key),
      });
      throw error;
    }
  }

  /**
   * Try to derive key with both current and previous salt (for dual-key support)
   */
  public async deriveKeyDual(
    key: string
  ): Promise<{ current: string; previous?: string }> {
    const current = await this.deriveKeyWithSalt(
      key,
      this.saltInfo.currentSalt
    );

    let previous: string | undefined;
    if (this.config.enableDualKeySupport && this.saltInfo.previousSalt) {
      previous = await this.deriveKeyWithSalt(key, this.saltInfo.previousSalt);
    }

    if (previous) {
      return { current, previous };
    } else {
      return { current };
    }
  }

  /**
   * Get current salt information
   */
  public getSaltInfo(): SaltInfo {
    return { ...this.saltInfo };
  }

  /**
   * Force salt rotation
   */
  public async forceRotateSalt(): Promise<void> {
    await this.rotateSalt();
  }

  /**
   * Generate cryptographically secure salt
   */
  private generateSecureSalt(): string {
    return randomBytes(32).toString("hex");
  }

  /**
   * Rotate salt with dual-key support
   */
  private async rotateSalt(): Promise<void> {
    const oldSalt = this.saltInfo.currentSalt;

    // Generate new salt
    this.saltInfo.currentSalt = this.generateSecureSalt();
    this.saltInfo.previousSalt = oldSalt;
    this.saltInfo.version++;
    this.saltInfo.lastRotation = Date.now();

    this.logger.info("Salt rotated with dual-key support", {
      oldSaltPrefix: oldSalt.substring(0, 8) + "...",
      newSaltPrefix: this.saltInfo.currentSalt.substring(0, 8) + "...",
      version: this.saltInfo.version,
      transitionPeriod: this.config.dualKeyTransitionPeriod,
    });

    // Schedule cleanup of old salt after transition period
    if (this.config.enableDualKeySupport) {
      setTimeout(() => {
        delete this.saltInfo.previousSalt;
        this.logger.info("Old salt cleanup completed after transition period");
      }, this.config.dualKeyTransitionPeriod);
    }

    this.recordMetrics("salt_rotation", 0, {
      version: this.saltInfo.version.toString(),
      dual_key_enabled: this.config.enableDualKeySupport.toString(),
    });
  }

  /**
   * Check if salt rotation is needed
   */
  private shouldRotateSalt(): boolean {
    return (
      Date.now() - this.saltInfo.lastRotation > this.config.saltRotationInterval
    );
  }

  /**
   * Record performance metrics
   */
  private recordMetrics(
    metricName: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    if (this.config.enableMetrics && this.metrics) {
      try {
        if (metricName.includes("_error")) {
          this.metrics.recordCounter(`key_derivation_${metricName}`, 1, labels);
        } else if (
          metricName.includes("_duration") ||
          metricName === "key_derivation"
        ) {
          this.metrics.recordTimer(
            `key_derivation_${metricName}`,
            value,
            labels
          );
        } else {
          this.metrics.recordCounter(`key_derivation_${metricName}`, 1, labels);
        }
      } catch (error) {
        this.logger.warn("Failed to record key derivation metrics", {
          metric: metricName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Get key prefix for logging
   */
  private getKeyPrefix(key: string): string {
    const parts = key.split(":");
    return parts.length > 0 && parts[0] ? parts[0] : key;
  }
}

/**
 * Factory function to create key derivation service
 */
export const createKeyDerivationService = (
  config: KeyDerivationConfig,
  metrics?: IMetricsCollector
): KeyDerivationService => {
  return new KeyDerivationService(config, metrics);
};
