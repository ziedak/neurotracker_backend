/**
 * @fileoverview Casbin Authorization Middleware - Module Exports
 * @module middleware/casbin
 * @version 1.0.0
 * @description Enterprise Casbin middleware with database integration and caching
 */

// Core middleware
export { CasbinMiddleware } from "./CasbinMiddleware";
export { PrismaAdapter } from "./PrismaAdapter";

// Factory functions and presets
export {
  createCasbinMiddleware,
  casbinPresets,
  CasbinPolicyUtils,
  commonResources,
  defaultRolePermissions,
} from "./factory";

// Types
export type {
  CasbinConfig,
  CasbinAuthResult,
  AuthorizationContext,
  UserContext,
  PolicyDefinition,
  RoleHierarchyEntry,
  CasbinCacheConfig,
  DatabaseAdapterConfig,
  CasbinModelConfig,
  CasbinMetrics,
  PolicyChangeEvent,
  ResourceDefinition,
  PermissionEvaluation,
  BatchAuthRequest,
  BatchAuthResult,
  PolicySyncStatus,
} from "./types";

export { DEFAULT_CASBIN_CONFIG } from "./types";
