/**
 * @fileoverview Auth Library - Production-Ready Enhanced JWT Services
 * @version 3.0.0 - Phase 3A RBAC Unification
 *
 * This library provides enterprise-grade JWT authentication services:
 * - Enhanced JWT Service with comprehensive token management
 * - JWT Blacklist Manager for token revocation
 * - Unified RBAC models with single source of truth
 * - Type definitions for JWT and user identity
 */

// ===================================================================
// UNIFIED RBAC MODELS - SINGLE SOURCE OF TRUTH (Phase 3A)
// ===================================================================

// Export all canonical RBAC types from unified models
export * from "./models";

// ===================================================================
// TYPE DEFINITIONS (Legacy - maintained for backward compatibility)
// ===================================================================

// JWT Types
export type { JWTPayload, RefreshTokenPayload } from "./types/jwt-types";

// Unified Context Types
export type {
  UserIdentity,
  UserRole,
  UserStatus,
} from "./types/unified-context-types";

// ===================================================================
// ENHANCED JWT SERVICES (Phase 2C - Steps 2.1, 2.2 & 2.3)
// ===================================================================

// JWT Blacklist Manager - Step 2.1
export {
  JWTBlacklistManager,
  TokenRevocationReason,
  type RevocationRecord,
  type UserRevocationRecord,
  type BlacklistManagerConfig,
  type ExtractedTokenInfo,
  type HealthStats,
  DEFAULT_BLACKLIST_CONFIG,
  type OperationResult,
  type BatchOperationResult,
} from "./services/jwt/jwt-blacklist-manager";

// Enhanced JWT Service - Step 2.2
export {
  EnhancedJWTService,
  type EnhancedJWTConfig,
  type TokenGenerationResult,
  type TokenVerificationResult,
  type TokenRotationResult,
  type ServiceHealthStatus,
} from "./services/jwt/enhanced-jwt-service-v2";

// JWT Token Rotation Manager - Step 2.3
export {
  JWTRotationManager,
  type JWTRotationConfig,
  type TokenPair,
  type TokenFamily,
  type TokenOperation,
  type TokenRotationResult as RotationResult,
  type TokenReuseDetectionResult,
} from "./services/jwt/jwt-rotation-manager";

// ===================================================================
// ENTERPRISE RBAC PERMISSION SYSTEM (Phase 2C - Step 3)
// ===================================================================

// Permission Cache - Step 3.2
// export {
//   PermissionCache,
//   type PermissionCacheConfig,
//   type CacheStats,
//   DEFAULT_PERMISSION_CACHE_CONFIG,
// } from "./services/permission-cache.ts.old";

// ===================================================================
// AUTHENTICATION GUARDS AND MIDDLEWARE
// ===================================================================

// Core Guards
export {
  AuthGuard,
  requireAuth,
  requireRole,
  requirePermission,
  optionalAuth,
} from "./guards";
export type { AuthContext } from "./guards";

// Middleware Guards
export {
  MiddlewareAuthGuard,
  type MiddlewareAuthResult,
  type AuthorizationRequirements,
} from "./middleware-guard";

// Context System
export {
  UnifiedAuthContextBuilder,
  type WebSocketContextInput,
} from "./context-builder";

export {
  AuthContextFactory,
  type AuthResult,
  type PermissionService as IPermissionServiceInterface,
  type UserService as IUserServiceInterface,
  type SessionManager as ISessionManagerInterface,
} from "./context-factory";

export {
  UnifiedAuthContext,
  UnifiedAuthContextImpl,
  type HTTPAuthContext,
  type WebSocketAuthContext,
  type SerializableAuthContext,
  type ContextValidationResult,
  type ContextCreateOptions,
  type SessionData,
  type TokenInfo,
  type AuthMethod,
  type SessionProtocol,
} from "./unified-context";

// Authentication Service
export {
  AuthenticationService,
  type LoginCredentials,
  type LoginResult,
  type RegisterUserData,
  type RegisterResult,
  type RefreshTokenResult,
} from "./services/authentication.service";

// ===================================================================
// CORE SERVICES
// ===================================================================

// User Management Service - Step 4.1
export {
  UserService,
  type IUserService,
  type UserSecurityProfile,
  createUserService,
} from "./services/user-service";

// Password Service - Supporting Step 4.1
export {
  PasswordService,
  type IPasswordService,
  type PasswordStrengthResult,
  createPasswordService,
} from "./services/password/password-service";

// API Key Service - Step 5.1
export {
  APIKeyService,
  type IAPIKeyService,
  type APIKey,
  type APIKeyOptions,
  type APIKeyValidation,
  type APIKeyUsage,
  type APIKeyAnalytics,
  type RateLimitResult,
  APIKeyStatus,
  APIKeyScope,
  RateLimitStatus,
  createAPIKeyService,
} from "./services/api-key-service";

// User Models
export {
  type User,
  type CreateUserData,
  type UpdateUserData,
  type UserLoginHistory,
  type UserActivitySummary,
} from "./models/user-models";

// Legacy User Service (keeping for compatibility)
// export { UserService as LegacyUserService } from "./services/user.service.ts.old";
// export type {
//   User as LegacyUser,
//   UserWithRoles,
// } from "./services/user.service.ts.old";

// Permission Service - Step 3.3
// export {
//   PermissionService,
//   type PermissionServiceConfig,
//   type PermissionCheckResult,
//   type ConditionEvaluationResult,
//   type BatchPermissionCheckResult,
//   type PermissionAssignmentResult,
//   type RoleAssignmentResult,
//   type PermissionAnalytics,
//   DEFAULT_PERMISSION_SERVICE_CONFIG,
// } from "./services/permission-service.ts.old";
// export type {
//   Permission,
//   RolePermissions,
// } from "./services/permission.service.ts.old";

// Core Session Management - alias for UnifiedSessionManager
export { UnifiedSessionManager as SessionManager } from "./services/session/unified-session-manager";
export type {
  SessionInfo,
  SessionValidationResult,
} from "./services/session/session.service";

// Enterprise Session Models
export {
  SessionAuthMethod,
  type SessionProtocol as EnterpriseSessionProtocol,
  SessionStatus,
  SessionValidator,
  SessionValidationError,
  type SessionData as EnterpriseSessionData,
  type SessionCreateOptions,
  type SessionUpdateData,
  type SessionMetadata,
  type DeviceInfo,
  type LocationInfo,
  type SecurityInfo,
  type SessionAnalytics,
  type SessionHealthMetrics,
  type RedisHealthMetrics,
  type PostgreSQLHealthMetrics,
  type CacheHealthMetrics,
  type PerformanceMetrics,
  type TimeRange,
} from "./models/session-models";

// Redis Session Store
export {
  RedisSessionStore,
  type RedisSessionConfig,
  DEFAULT_REDIS_SESSION_CONFIG,
} from "./services/session/redis-session-store";

// PostgreSQL Session Store
export {
  PostgreSQLSessionStore,
  type PostgreSQLSessionConfig,
  DEFAULT_POSTGRESQL_SESSION_CONFIG,
} from "./services/session/postgresql-session-store";

// Unified Session Manager
export {
  UnifiedSessionManager,
  type UnifiedSessionManagerConfig,
  DEFAULT_UNIFIED_SESSION_MANAGER_CONFIG,
} from "./services/session/unified-session-manager";

// ===================================================================
// PERFORMANCE OPTIMIZATION SERVICES (Phase 1)
// ===================================================================

// Performance Benchmarking
export {
  PerformanceBenchmark,
  type PerformanceMetrics as AuthPerformanceMetrics,
  type BenchmarkResult,
  type SystemBaseline,
} from "./services/performance-benchmark";

// Authentication Cache Service
export {
  AuthCacheService,
  type CacheConfig as AuthCacheConfig,
  type CacheStats as AuthCacheStats,
  type CacheOperationResult,
  DEFAULT_CACHE_CONFIG,
} from "./services/auth-cache.service";

// Phase 1 Optimization Service
export {
  Phase1OptimizationService,
  type Phase1Results,
} from "./services/phase1-optimization.service";
