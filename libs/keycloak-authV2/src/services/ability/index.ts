/**
 * Modular AbilityFactory exports
 * Clean separation of concerns following SOLID principles
 */

// Main orchestrator
export { AbilityFactory } from "../AbilityFactoryRefactored";

// Modular components
export { AbilityConfigManager } from "./AbilityFactoryConfig";
export { ComputationTracker } from "./ComputationTracker";
export { AbilityCacheManager } from "./AbilityCacheManager";
export { AbilityBuilderService } from "./AbilityBuilderService";
export { PermissionResolver } from "./PermissionResolver";
export { TemplateProcessor } from "./TemplateProcessor";

// Types
export type {
  AbilityFactoryConfig,
  AbilityFactoryConstants,
} from "./AbilityFactoryConfig";
export type {
  CachedAbility,
  PendingComputation,
  CacheStats,
  HealthCheckResult,
} from "./AbilityFactoryTypes";

// Errors
export {
  AbilityFactoryError,
  AbilityCacheError,
  AbilityValidationError,
  AbilityComputationError,
  TemplateProcessingError,
} from "./AbilityFactoryErrors";
