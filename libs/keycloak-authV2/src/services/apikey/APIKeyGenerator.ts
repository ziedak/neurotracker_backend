/**
 * API Key Generator - Single Responsibility: Secure key generation
 *
 * Handles:
 * - Secure API key generation
 * - Entropy validation and quality checks
 * - Fallback key generation mechanisms
 * - Key format validation
 */

import * as crypto from "crypto";
import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { EntropyTestResult } from "./types";

export class APIKeyGenerator {
  private readonly logger: ILogger;

  constructor(logger?: ILogger, private readonly metrics?: IMetricsCollector) {
    this.logger = logger || createLogger("APIKeyGenerator");
  }

  /**
   * Generate a secure API key with entropy validation and fallback mechanisms
   */
  generateSecureKey(prefix?: string): string {
    try {
      // Primary entropy source - crypto.randomBytes
      const randomBytes = this.generateSecureRandomBytes(32);

      // Validate entropy quality
      if (!this.validateEntropyQuality(randomBytes)) {
        throw new Error("Primary entropy source failed quality check");
      }

      const key = randomBytes.toString("base64url");
      return prefix ? `${prefix}_${key}` : `ak_${key}`;
    } catch (error) {
      this.logger.warn("Primary key generation failed, using fallback", {
        error,
      });
      return this.generateFallbackKey(prefix);
    }
  }

  /**
   * Extract key identifier from API key for database lookup
   * Uses deterministic hash of key prefix for O(1) database queries
   */
  extractKeyIdentifier(apiKey: string): string {
    // Extract first 16 characters (prefix + partial key) for identification
    const keyPrefix = apiKey.length >= 16 ? apiKey.slice(0, 16) : apiKey;

    // Create deterministic hash for database lookup
    return crypto
      .createHash("sha256")
      .update(keyPrefix)
      .digest("hex")
      .slice(0, 32); // 32 character identifier
  }

  /**
   * Test entropy source quality on startup
   */
  async testEntropySource(): Promise<EntropyTestResult> {
    try {
      const testResults = [];

      // Test multiple entropy generation attempts
      for (let i = 0; i < 5; i++) {
        try {
          const testBytes = this.generateSecureRandomBytes(32);
          const isQualityOk = this.validateEntropyQuality(testBytes);
          testResults.push({
            attempt: i + 1,
            success: true,
            quality: isQualityOk,
          });
        } catch (error) {
          testResults.push({
            attempt: i + 1,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const successfulTests = testResults.filter((r) => r.success).length;
      const qualityTests = testResults.filter(
        (r) => r.success && r.quality
      ).length;

      if (successfulTests === 0) {
        return {
          status: "failed",
          details: {
            message: "Entropy source completely failed",
            testResults,
            recommendation:
              "System needs immediate attention - no secure key generation possible",
          },
        };
      } else if (qualityTests < successfulTests * 0.8) {
        return {
          status: "degraded",
          details: {
            message: "Entropy source working but quality concerns detected",
            successfulTests,
            qualityTests,
            testResults,
            recommendation:
              "Monitor system entropy and investigate potential issues",
          },
        };
      } else {
        return {
          status: "healthy",
          details: {
            message: "Entropy source functioning normally",
            successfulTests,
            qualityTests,
            testResults,
          },
        };
      }
    } catch (error) {
      return {
        status: "failed",
        details: {
          message: "Entropy test system failed",
          error: error instanceof Error ? error.message : "Unknown error",
          recommendation: "System entropy testing needs investigation",
        },
      };
    }
  }

  /**
   * Hash API key for cache keys (not for storage)
   */
  hashKey(apiKey: string): string {
    return crypto
      .createHash("sha256")
      .update(apiKey)
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Generate secure random bytes with validation
   */
  private generateSecureRandomBytes(size: number): Buffer {
    try {
      // Use Node.js crypto.randomBytes which uses platform entropy
      const bytes = crypto.randomBytes(size);

      // Basic validation - ensure we got the expected size
      if (bytes.length !== size) {
        throw new Error(`Expected ${size} bytes, got ${bytes.length}`);
      }

      return bytes;
    } catch (error) {
      this.logger.error("Failed to generate random bytes", { size, error });
      throw error;
    }
  }

  /**
   * Validate entropy quality of generated random bytes
   */
  private validateEntropyQuality(bytes: Buffer): boolean {
    try {
      // Check 1: No all-zero bytes (extremely unlikely but possible with bad entropy)
      const allZeros = bytes.every((byte) => byte === 0);
      if (allZeros) {
        this.logger.error("Entropy failure: all-zero bytes detected");
        return false;
      }

      // Check 2: No all-same bytes
      const firstByte = bytes[0];
      const allSame = bytes.every((byte) => byte === firstByte);
      if (allSame) {
        this.logger.error("Entropy failure: all bytes identical", {
          byte: firstByte,
        });
        return false;
      }

      // Check 3: Basic distribution check - ensure reasonable variance
      const byteSet = new Set(bytes);
      const uniqueBytes = byteSet.size;
      const expectedMinUnique = Math.min(bytes.length * 0.5, 128); // At least 50% unique or up to 128 unique values

      if (uniqueBytes < expectedMinUnique) {
        this.logger.warn("Entropy warning: low byte diversity", {
          unique: uniqueBytes,
          expected: expectedMinUnique,
          total: bytes.length,
        });
        // This is a warning, not a failure - continue but log it
      }

      // Check 4: Simple run-length check - detect patterns
      let maxRunLength = 1;
      let currentRunLength = 1;

      for (let i = 1; i < bytes.length; i++) {
        if (bytes[i] === bytes[i - 1]) {
          currentRunLength++;
          maxRunLength = Math.max(maxRunLength, currentRunLength);
        } else {
          currentRunLength = 1;
        }
      }

      // Fail if we have more than 4 consecutive identical bytes (very suspicious)
      if (maxRunLength > 4) {
        this.logger.error("Entropy failure: suspicious run length", {
          maxRunLength,
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error("Entropy validation failed", { error });
      return false;
    }
  }

  /**
   * Generate fallback key using multiple entropy sources
   */
  private generateFallbackKey(prefix?: string): string {
    this.logger.warn(
      "Using fallback key generation - investigate entropy issues"
    );
    this.metrics?.recordCounter("apikey.generator.fallback_generation", 1);

    try {
      // Combine multiple sources for fallback entropy
      const timestamp = Date.now().toString(36);
      const processInfo =
        process.pid.toString(36) + process.uptime().toString(36);
      const random1 = Math.random().toString(36).slice(2);
      const random2 = Math.random().toString(36).slice(2);

      // Try to get some system randomness if available
      let systemRandom = "";
      try {
        systemRandom = crypto.randomBytes(16).toString("hex");
      } catch {
        // If crypto.randomBytes still fails, use Math.random
        systemRandom = (Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
      }

      // Combine all sources
      const combined = `${timestamp}${processInfo}${random1}${random2}${systemRandom}`;

      // Hash the combined data for uniform distribution
      const keyHash = crypto
        .createHash("sha256")
        .update(combined)
        .digest("base64url");

      // Take first 43 characters (standard base64url length for 32 bytes)
      const key = keyHash.slice(0, 43);

      return prefix ? `${prefix}_${key}` : `ak_${key}`;
    } catch (error) {
      this.logger.error("Fallback key generation failed", { error });
      // Last resort - time-based key with warning
      const timeKey =
        Date.now().toString(36) + Math.random().toString(36).slice(2);
      this.metrics?.recordCounter("apikey.generator.emergency_generation", 1);
      return prefix
        ? `${prefix}_emergency_${timeKey}`
        : `ak_emergency_${timeKey}`;
    }
  }

  /**
   * Cleanup method for component lifecycle
   */
  cleanup(): void {
    this.logger.info("APIKeyGenerator cleanup completed");
  }
}
