// ===== CORE TYPES =====
export * from "./types";

// ===== ENTERPRISE CACHE ADAPTER (NEW SYSTEM) =====
export {
  RateLimitingCacheAdapter,
  type RateLimitAlgorithm,
  type RateLimitRequest,
  type BatchRateLimitResult,
  type RateLimitingStats,
  type RateLimitingAdapterConfig,
  DEFAULT_RATE_LIMITING_ADAPTER_CONFIG,
} from "./adapters/RateLimitingCacheAdapter";

// ===== CRITICAL PERFORMANCE OPTIMIZATIONS =====
export * from "./performance/scriptManager";
export { SharedScriptManager } from "./performance/scriptManager";

export * from "./performance/batchProcessor";
export {
  BatchRateLimitProcessor,
  type BatchRateLimitRequest,
  type BatchRateLimitResponse,
  type BatchStats,
} from "./performance/batchProcessor";

// ===== CONFIGURATION MANAGEMENT =====
// export * from "./config/rateLimitConfig";
export { RateLimitConfigManager } from "./config/rateLimitConfig";
export { CompleteRateLimitConfig } from "./config/rateLimitConfig";

// ===== MONITORING AND OBSERVABILITY =====
export * from "./rateLimitMonitoring";
