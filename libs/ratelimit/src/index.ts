// ===== CORE TYPES =====
export * from "./types";

// ===== ENTERPRISE CACHE ADAPTER (NEW SYSTEM) =====
export {
  RateLimitingCacheAdapter,
  type RateLimitResult as NewRateLimitResult,
  type RateLimitAlgorithm,
  type RateLimitRequest,
  type BatchRateLimitResult,
  type RateLimitingStats,
  type RateLimitingAdapterConfig,
  DEFAULT_RATE_LIMITING_ADAPTER_CONFIG,
} from "./adapters/RateLimitingCacheAdapter";

// ===== CRITICAL PERFORMANCE OPTIMIZATIONS =====
export * from "./scriptManager";
export { SharedScriptManager } from "./scriptManager";

export * from "./batchProcessor";
export {
  BatchRateLimitProcessor,
  type BatchRateLimitRequest,
  type BatchRateLimitResponse,
  type BatchStats,
} from "./batchProcessor";

// ===== MIGRATION COMPATIBILITY LAYER =====
export {
  LegacyCompatibleRateLimit,
  type LegacyRateLimitResult,
  type LegacyRateLimitConfig,
  // Re-export for seamless migration
  type RateLimitResult as CompatibleRateLimitResult,
  type RateLimitConfig as CompatibleRateLimitConfig,
} from "./compatibility/legacyInterface";

// ===== CONFIGURATION MANAGEMENT =====
export * from "./config/rateLimitConfig";
export { RateLimitConfigManager } from "./config/rateLimitConfig";
export { CompleteRateLimitConfig } from "./config/rateLimitConfig";

// ===== MONITORING AND OBSERVABILITY =====
export * from "./rateLimitMonitoring";

// ===== LEGACY IMPLEMENTATIONS (ARCHIVED) =====
// NOTE: Legacy types are now exported from ./types
// TODO: Remove after middleware migration is complete
// TODO: Distributed rate limiting moved to archive - will be implemented in next version

// Legacy configuration exports
export { RateLimitConfig } from "./config/rateLimitConfig";
