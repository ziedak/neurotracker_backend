/**
 * Modular Authorization Service exports
 * Clean separation of concerns following SOLID principles
 */

// Main orchestrator
export { AuthorizationService } from "../AuthorizationServiceRefactored";

// Modular components
export { AuthorizationConfigManager } from "./AuthorizationConfigManager";
export { AuthorizationValidator } from "./AuthorizationValidator";
export { ResourceSanitizer } from "./ResourceSanitizer";
export { PendingOperationTracker } from "./PendingOperationTracker";
export { AuthorizationCacheManager } from "./AuthorizationCacheManager";
export { AuthorizationMetrics } from "./AuthorizationMetrics";
export { AuthorizationAuditor } from "./AuthorizationAuditor";
export { AuthorizationEngine } from "./AuthorizationEngine";

// Types
export type { AuthorizationServiceConfig } from "./AuthorizationConfigManager";
export type { PendingOperation } from "./PendingOperationTracker";
export type { ValidationResult } from "./AuthorizationValidator";

// Re-export validation schemas for advanced usage
export {
  authorizationContextSchema,
  actionSchema,
  subjectSchema,
  resourceContextSchema,
  permissionCheckSchema,
  permissionChecksSchema,
} from "./AuthorizationValidator";
