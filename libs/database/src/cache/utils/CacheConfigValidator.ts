/**
 * Cache Configuration Validator
 * Fixes Issue #4: Missing Configuration Validation
 */

import { createLogger } from "@libs/utils";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigValidationOptions {
  strict?: boolean; // Fail on warnings
  autoCorrect?: boolean; // Attempt to fix invalid values
}

/**
 * Validates cache configuration for correctness and optimal performance
 */
export class CacheConfigValidator {
  private readonly logger = createLogger("CacheConfigValidator");

  /**
   * Validate complete cache configuration
   */
  validateCacheConfig(
    config: any,
    options: ConfigValidationOptions = {}
  ): ValidationResult {
    const { strict = false, autoCorrect = false } = options;
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate basic configuration
    this.validateBasicConfig(config, errors, warnings);

    // Validate memory configuration
    if (config.memoryConfig) {
      this.validateMemoryConfig(config.memoryConfig, errors, warnings);
    }

    // Validate compression configuration
    if (config.compressionConfig) {
      this.validateCompressionConfig(
        config.compressionConfig,
        errors,
        warnings
      );
    }

    // Validate warming configuration
    if (config.warmingConfig) {
      this.validateWarmingConfig(config.warmingConfig, errors, warnings);
    }

    // Apply auto-corrections if enabled
    if (autoCorrect && errors.length === 0) {
      this.applyAutoCorrections(config, warnings);
    }

    const valid = errors.length === 0 && (!strict || warnings.length === 0);

    if (!valid) {
      this.logger.error("Cache configuration validation failed", {
        errors,
        warnings,
      });
    } else if (warnings.length > 0) {
      this.logger.warn("Cache configuration has warnings", { warnings });
    }

    return { valid, errors, warnings };
  }

  /**
   * Validate basic cache configuration
   */
  private validateBasicConfig(
    config: any,
    errors: string[],
    warnings: string[]
  ): void {
    // TTL validation
    if (typeof config.defaultTTL !== "number" || config.defaultTTL <= 0) {
      errors.push("defaultTTL must be a positive number");
    } else if (config.defaultTTL < 60) {
      warnings.push(
        "defaultTTL less than 60 seconds may cause frequent cache misses"
      );
    } else if (config.defaultTTL > 86400) {
      warnings.push(
        "defaultTTL greater than 24 hours may cause stale data issues"
      );
    }

    // Enable flag validation
    if (typeof config.enable !== "boolean") {
      errors.push("enable must be a boolean value");
    }

    // Max cache size validation
    if (config.maxMemoryCacheSize) {
      if (
        typeof config.maxMemoryCacheSize !== "number" ||
        config.maxMemoryCacheSize <= 0
      ) {
        errors.push("maxMemoryCacheSize must be a positive number");
      } else if (config.maxMemoryCacheSize < 100) {
        warnings.push(
          "maxMemoryCacheSize less than 100 may limit cache effectiveness"
        );
      } else if (config.maxMemoryCacheSize > 1000000) {
        warnings.push(
          "maxMemoryCacheSize greater than 1M entries may cause memory issues"
        );
      }
    }
  }

  /**
   * Validate memory configuration
   */
  private validateMemoryConfig(
    memoryConfig: any,
    errors: string[],
    warnings: string[]
  ): void {
    // Max memory validation
    if (
      typeof memoryConfig.maxMemoryMB !== "number" ||
      memoryConfig.maxMemoryMB <= 0
    ) {
      errors.push("memoryConfig.maxMemoryMB must be a positive number");
    } else if (memoryConfig.maxMemoryMB < 10) {
      warnings.push("maxMemoryMB less than 10MB may be too restrictive");
    } else if (memoryConfig.maxMemoryMB > 1024) {
      warnings.push(
        "maxMemoryMB greater than 1GB should be carefully monitored"
      );
    }

    // Threshold validation
    if (
      typeof memoryConfig.warningThresholdPercent !== "number" ||
      memoryConfig.warningThresholdPercent < 0 ||
      memoryConfig.warningThresholdPercent > 100
    ) {
      errors.push("warningThresholdPercent must be between 0 and 100");
    }

    if (
      typeof memoryConfig.criticalThresholdPercent !== "number" ||
      memoryConfig.criticalThresholdPercent < 0 ||
      memoryConfig.criticalThresholdPercent > 100
    ) {
      errors.push("criticalThresholdPercent must be between 0 and 100");
    }

    if (
      memoryConfig.criticalThresholdPercent <=
      memoryConfig.warningThresholdPercent
    ) {
      errors.push(
        "criticalThresholdPercent must be greater than warningThresholdPercent"
      );
    }

    // Size calculation interval
    if (
      memoryConfig.sizeCalculationInterval &&
      (typeof memoryConfig.sizeCalculationInterval !== "number" ||
        memoryConfig.sizeCalculationInterval <= 0)
    ) {
      errors.push("sizeCalculationInterval must be a positive number");
    }
  }

  /**
   * Validate compression configuration
   */
  private validateCompressionConfig(
    compressionConfig: any,
    errors: string[],
    warnings: string[]
  ): void {
    // Algorithm validation
    const validAlgorithms = ["gzip", "deflate", "brotli", "lz4", "none"];
    if (!validAlgorithms.includes(compressionConfig.algorithm)) {
      errors.push(
        `Invalid compression algorithm. Must be one of: ${validAlgorithms.join(
          ", "
        )}`
      );
    }

    // Compression level validation
    if (
      typeof compressionConfig.level !== "number" ||
      compressionConfig.level < 1 ||
      compressionConfig.level > 9
    ) {
      errors.push("compression level must be between 1 and 9");
    } else if (compressionConfig.level > 6) {
      warnings.push(
        "compression level > 6 may significantly impact performance"
      );
    }

    // Threshold validation
    if (
      typeof compressionConfig.thresholdBytes !== "number" ||
      compressionConfig.thresholdBytes < 0
    ) {
      errors.push("thresholdBytes must be a non-negative number");
    } else if (compressionConfig.thresholdBytes < 512) {
      warnings.push("thresholdBytes < 512 may compress data with poor ratio");
    }

    // Boolean flags validation
    if (typeof compressionConfig.enableCompression !== "boolean") {
      errors.push("enableCompression must be a boolean");
    }

    if (typeof compressionConfig.fallbackOnError !== "boolean") {
      errors.push("fallbackOnError must be a boolean");
    }
  }

  /**
   * Validate warming configuration
   */
  private validateWarmingConfig(
    warmingConfig: any,
    errors: string[],
    warnings: string[]
  ): void {
    // Background warming interval
    if (
      warmingConfig.backgroundWarmingInterval &&
      (typeof warmingConfig.backgroundWarmingInterval !== "number" ||
        warmingConfig.backgroundWarmingInterval <= 0)
    ) {
      errors.push("backgroundWarmingInterval must be a positive number");
    } else if (warmingConfig.backgroundWarmingInterval < 60) {
      warnings.push(
        "backgroundWarmingInterval < 60 seconds may be too frequent"
      );
    }

    // Max warmup keys
    if (
      warmingConfig.maxWarmupKeys &&
      (typeof warmingConfig.maxWarmupKeys !== "number" ||
        warmingConfig.maxWarmupKeys <= 0)
    ) {
      errors.push("maxWarmupKeys must be a positive number");
    } else if (warmingConfig.maxWarmupKeys > 10000) {
      warnings.push("maxWarmupKeys > 10000 may cause long warmup times");
    }

    // Warmup batch size
    if (
      warmingConfig.warmupBatchSize &&
      (typeof warmingConfig.warmupBatchSize !== "number" ||
        warmingConfig.warmupBatchSize <= 0)
    ) {
      errors.push("warmupBatchSize must be a positive number");
    } else if (warmingConfig.warmupBatchSize > 100) {
      warnings.push("warmupBatchSize > 100 may overwhelm the database");
    }

    // Boolean flags
    [
      "enableBackgroundWarming",
      "adaptiveWarming",
      "enablePatternLearning",
    ].forEach((flag) => {
      if (
        warmingConfig[flag] !== undefined &&
        typeof warmingConfig[flag] !== "boolean"
      ) {
        errors.push(`${flag} must be a boolean`);
      }
    });
  }

  /**
   * Apply automatic corrections to configuration
   */
  private applyAutoCorrections(config: any, warnings: string[]): void {
    // Correct TTL if too low
    if (config.defaultTTL < 60) {
      config.defaultTTL = 300; // 5 minutes
      warnings.push("Auto-corrected defaultTTL to 300 seconds");
    }

    // Correct memory thresholds if invalid
    if (config.memoryConfig) {
      if (
        config.memoryConfig.warningThresholdPercent >=
        config.memoryConfig.criticalThresholdPercent
      ) {
        config.memoryConfig.warningThresholdPercent = 75;
        config.memoryConfig.criticalThresholdPercent = 90;
        warnings.push("Auto-corrected memory thresholds to 75%/90%");
      }
    }

    // Correct compression level if too high
    if (config.compressionConfig && config.compressionConfig.level > 6) {
      config.compressionConfig.level = 6;
      warnings.push("Auto-corrected compression level to 6");
    }
  }

  /**
   * Generate recommended configuration based on environment
   */
  generateRecommendedConfig(
    environment: "development" | "staging" | "production"
  ): any {
    const baseConfig = {
      enable: true,
      defaultTTL: 3600, // 1 hour
    };

    switch (environment) {
      case "development":
        return {
          ...baseConfig,
          maxMemoryCacheSize: 1000,
          memoryConfig: {
            maxMemoryMB: 25,
            warningThresholdPercent: 80,
            criticalThresholdPercent: 95,
          },
          compressionConfig: {
            enableCompression: false, // Disable for faster debugging
          },
          warmingConfig: {
            enableBackgroundWarming: false,
          },
        };

      case "staging":
        return {
          ...baseConfig,
          maxMemoryCacheSize: 5000,
          memoryConfig: {
            maxMemoryMB: 100,
            warningThresholdPercent: 75,
            criticalThresholdPercent: 90,
          },
          compressionConfig: {
            enableCompression: true,
            algorithm: "gzip",
            level: 4,
          },
          warmingConfig: {
            enableBackgroundWarming: true,
            backgroundWarmingInterval: 300,
          },
        };

      case "production":
        return {
          ...baseConfig,
          maxMemoryCacheSize: 50000,
          memoryConfig: {
            maxMemoryMB: 500,
            warningThresholdPercent: 70,
            criticalThresholdPercent: 85,
          },
          compressionConfig: {
            enableCompression: true,
            algorithm: "gzip",
            level: 6,
            thresholdBytes: 1024,
          },
          warmingConfig: {
            enableBackgroundWarming: true,
            backgroundWarmingInterval: 180,
            adaptiveWarming: true,
            enablePatternLearning: true,
          },
        };

      default:
        return baseConfig;
    }
  }
}
