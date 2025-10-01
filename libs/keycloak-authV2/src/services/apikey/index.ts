// Consolidated components (Phase 2 refactoring)
export { APIKeyOperations } from "./APIKeyOperations";
export { APIKeyStorage } from "./APIKeyStorage";
export { APIKeyMonitoring } from "./APIKeyMonitoring";

// Legacy components (remaining)
export { APIKeyManager } from "./APIKeyManager";


// Consolidated component aliases (for transition)
export { APIKeyOperations as ConsolidatedGenerator } from "./APIKeyOperations";
export { APIKeyOperations as ConsolidatedValidator } from "./APIKeyOperations";
export { APIKeyOperations as ConsolidatedSecurityManager } from "./APIKeyOperations";
export { APIKeyStorage as ConsolidatedRepository } from "./APIKeyStorage";
export { APIKeyStorage as ConsolidatedCacheManager } from "./APIKeyStorage";
export { APIKeyMonitoring as ConsolidatedUsageTracker } from "./APIKeyMonitoring";
export { APIKeyMonitoring as ConsolidatedHealthMonitor } from "./APIKeyMonitoring";
