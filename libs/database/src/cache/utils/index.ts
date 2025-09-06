/**
 * Cache Utils
 * Utility modules for advanced cache functionality
 */

export {
  MemoryTracker,
  type MemoryTrackerConfig,
  type MemoryInfo,
} from "./MemoryTracker";

export {
  compressGzip,
  decompressGzip,
  compressDeflate,
  decompressDeflate,
  smartCompress,
  isCompressionWorthwhile,
} from "./CompressionEngine";

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
  compress,
  decompress,
  calculateDataSize,
  type CompressionAlgorithm,
  type CompressionConfig,
  type CompressionStats,
  type CompressionContext,
  type CompressionResult,
  DEFAULT_COMPRESSION_CONFIG,
} from "./CacheCompressor";
