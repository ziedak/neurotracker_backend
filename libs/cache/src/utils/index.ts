/**
 * Cache Utils
 * Utility modules for advanced cache functionality
 */

export {
  MemoryTracker,
  type MemoryTrackerConfig,
  type MemoryInfo,
} from "./MemoryTracker";

export { CompressionEngine, type CompressionResult } from "./CompressionEngine";

export {
  CacheOperationLockManager,
  type LockOptions,
  type LockInfo,
} from "./CacheOperationLockManager";

export {
  CacheConfigValidator,
  type ValidationResult,
  type ConfigValidationOptions,
} from "./CacheConfigValidator";

export {
  CacheCoherencyManager,
  type CoherencyEvent,
  type CoherencyConfig,
} from "./CacheCoherencyManager";

export {
  CacheCompressor,
  type CompressionAlgorithm,
  type CompressionConfig,
  type CompressionStats,
  DEFAULT_COMPRESSION_CONFIG,
} from "./CacheCompressor";
