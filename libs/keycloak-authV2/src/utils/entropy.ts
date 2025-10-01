import * as crypto from "crypto";
import type { ILogger } from "@libs/utils";

export interface EntropyTestResult {
  status: "healthy" | "degraded" | "failed";
  testRuns: number;
  successfulRuns: number;
  qualityScore: number;
  avgGenerationTime: number;
  details: {
    attempts: Array<{
      success: boolean;
      quality: boolean;
      duration: number;
      error?: string;
    }>;
  };
  recommendations: string[];
}

export interface EntropyValidationConfig {
  readonly testCount: number;
  readonly minQualityThreshold: number;
  readonly maxGenerationTime: number;
}

/**
 * Unified entropy testing and validation utilities
 */
export class EntropyUtils {
  private static readonly DEFAULT_CONFIG: EntropyValidationConfig = {
    testCount: 5,
    minQualityThreshold: 80,
    maxGenerationTime: 100,
  };

  /**
   * Generate secure random bytes with validation
   */
  static generateSecureRandomBytes(size: number): Buffer {
    try {
      const bytes = crypto.randomBytes(size);
      if (bytes.length !== size) {
        throw new Error(`Expected ${size} bytes, got ${bytes.length}`);
      }
      return bytes;
    } catch (error) {
      throw new Error(`Failed to generate random bytes: ${error}`);
    }
  }

  /**
   * Comprehensive entropy quality validation
   * Combines pattern detection and statistical analysis
   */
  static validateEntropyQuality(bytes: Buffer): boolean {
    // Check 1: Basic pattern detection
    if (!this.validateBasicPatterns(bytes)) return false;

    // Check 2: Statistical analysis
    if (!this.validateStatisticalProperties(bytes)) return false;

    return true;
  }

  /**
   * Test entropy source quality and performance
   */
  static async testEntropySource(
    logger: ILogger,
    config: Partial<EntropyValidationConfig> = {}
  ): Promise<EntropyTestResult> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    const startTime = performance.now();

    logger.debug("Starting entropy source test");

    const testResults = [];

    // Perform multiple entropy generation tests
    for (let i = 0; i < finalConfig.testCount; i++) {
      const testStartTime = performance.now();

      try {
        const testBytes = this.generateSecureRandomBytes(32);
        const testDuration = performance.now() - testStartTime;
        const quality = this.validateEntropyQuality(testBytes);

        testResults.push({
          success: true,
          quality,
          duration: testDuration,
        });

        logger.debug("Entropy test attempt completed", {
          attempt: i + 1,
          quality,
          duration: testDuration,
        });
      } catch (error) {
        const testDuration = performance.now() - testStartTime;
        testResults.push({
          success: false,
          quality: false,
          duration: testDuration,
          error: error instanceof Error ? error.message : "Unknown error",
        });

        logger.warn("Entropy test attempt failed", {
          attempt: i + 1,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    // Calculate results
    const successfulRuns = testResults.filter((r) => r.success).length;
    const qualityRuns = testResults.filter(
      (r) => r.success && r.quality
    ).length;
    const qualityScore =
      successfulRuns > 0 ? (qualityRuns / successfulRuns) * 100 : 0;
    const avgGenerationTime =
      testResults.reduce((sum, r) => sum + r.duration, 0) / testResults.length;

    // Determine status and recommendations
    const { status, recommendations } = this.evaluateEntropyHealth(
      successfulRuns,
      qualityScore,
      avgGenerationTime,
      finalConfig
    );

    logger.info("Entropy source test completed", {
      status,
      successfulRuns,
      qualityScore: qualityScore.toFixed(1),
      avgGenerationTime: avgGenerationTime.toFixed(1),
      duration: performance.now() - startTime,
    });

    return {
      status,
      testRuns: testResults.length,
      successfulRuns,
      qualityScore,
      avgGenerationTime,
      details: { attempts: testResults },
      recommendations,
    };
  }

  private static validateBasicPatterns(bytes: Buffer): boolean {
    const length = bytes.length;
    if (length < 16) return false;

    // Check for obvious patterns
    const uniqueBytes = new Set(bytes).size;
    if (uniqueBytes < length * 0.6) return false;

    // Check for all-zero or all-same bytes
    const allZeros = bytes.every((byte) => byte === 0);
    if (allZeros) return false;

    const firstByte = bytes[0];
    const allSame = bytes.every((byte) => byte === firstByte);
    if (allSame) return false;

    // Check run-length (suspicious if >4 consecutive identical bytes)
    let maxRunLength = 1;
    let currentRunLength = 1;
    for (let i = 1; i < length; i++) {
      if (bytes[i] === bytes[i - 1]) {
        currentRunLength++;
        maxRunLength = Math.max(maxRunLength, currentRunLength);
      } else {
        currentRunLength = 1;
      }
    }
    if (maxRunLength > 4) return false;

    return true;
  }

  private static validateStatisticalProperties(bytes: Buffer): boolean {
    const length = bytes.length;
    const expected = length / 256;
    const counts = new Array(256).fill(0);

    for (let i = 0; i < length; i++) {
      const byteValue = bytes[i];
      if (byteValue !== undefined) {
        counts[byteValue]++;
      }
    }

    // Chi-square test for randomness
    let chiSquare = 0;
    for (let i = 0; i < 256; i++) {
      const diff = counts[i] - expected;
      chiSquare += (diff * diff) / expected;
    }

    // Accept if chi-square is reasonable (not too perfect, not too random)
    return chiSquare < 400 && chiSquare > 100;
  }

  private static evaluateEntropyHealth(
    successfulRuns: number,
    qualityScore: number,
    avgGenerationTime: number,
    config: EntropyValidationConfig
  ): { status: "healthy" | "degraded" | "failed"; recommendations: string[] } {
    const recommendations: string[] = [];

    if (successfulRuns === 0) {
      return {
        status: "failed",
        recommendations: [
          "Entropy source completely failed - immediate system attention required",
          "Check system entropy pools and hardware random number generators",
        ],
      };
    }

    if (qualityScore < config.minQualityThreshold) {
      recommendations.push(
        `Entropy quality below threshold (${qualityScore.toFixed(1)}% < ${
          config.minQualityThreshold
        }%)`
      );
      recommendations.push(
        "Monitor system entropy and investigate potential issues"
      );
    }

    if (avgGenerationTime > config.maxGenerationTime) {
      recommendations.push(
        `Entropy generation slower than expected (${avgGenerationTime.toFixed(
          1
        )}ms > ${config.maxGenerationTime}ms)`
      );
      recommendations.push("Check system load and entropy pool availability");
    }

    if (recommendations.length === 0) {
      recommendations.push("Entropy source operating within normal parameters");
      return { status: "healthy", recommendations };
    }

    return { status: "degraded", recommendations };
  }
}
