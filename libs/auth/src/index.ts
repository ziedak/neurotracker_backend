/**
 * @fileoverview Auth Library - Production-Ready Enhanced JWT Services
 * @version 2.0.0
 *
 * This library provides enterprise-grade JWT authentication services:
 * - Enhanced JWT Service with comprehensive token management
 * - JWT Blacklist Manager for token revocation
 * - Type definitions for JWT and user identity
 */

// ===================================================================
// TYPE DEFINITIONS
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
} from "./services/jwt-blacklist-manager";

// Enhanced JWT Service - Step 2.2
export {
  EnhancedJWTService,
  type EnhancedJWTConfig,
  type TokenGenerationResult,
  type TokenVerificationResult,
  type TokenRotationResult,
  type ServiceHealthStatus,
} from "./services/enhanced-jwt-service-v2";

// JWT Token Rotation Manager - Step 2.3
export {
  JWTRotationManager,
  type JWTRotationConfig,
  type TokenPair,
  type TokenFamily,
  type TokenOperation,
  type TokenRotationResult as RotationResult,
  type TokenReuseDetectionResult,
} from "./services/jwt-rotation-manager";

// ===================================================================
// ENTERPRISE RBAC PERMISSION SYSTEM (Phase 2C - Step 3)
// ===================================================================

// Permission Cache - Step 3.2
export {
  PermissionCache,
  type PermissionCacheConfig,
  type CacheStats,
  DEFAULT_PERMISSION_CACHE_CONFIG,
} from "./services/permission-cache";

// ===================================================================
// CORE SERVICES
// ===================================================================

// User Management Service
export { UserService } from "./services/user.service";
export type { User, UserWithRoles } from "./services/user.service";

// Permission Service - Step 3.3
export {
  PermissionService,
  type PermissionServiceConfig,
  type PermissionCheckResult,
  type ConditionEvaluationResult,
  type BatchPermissionCheckResult,
  type PermissionAssignmentResult,
  type RoleAssignmentResult,
  type PermissionAnalytics,
  DEFAULT_PERMISSION_SERVICE_CONFIG,
} from "./services/permission-service";
export type {
  Permission,
  RolePermissions,
} from "./services/permission.service";

// Core Session Management - alias for UnifiedSessionManager
export { UnifiedSessionManager as SessionManager } from "./services/unified-session-manager";
export type {
  SessionInfo,
  SessionValidationResult,
} from "./services/session.service";

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
} from "./services/redis-session-store";

// PostgreSQL Session Store
export {
  PostgreSQLSessionStore,
  type PostgreSQLSessionConfig,
  DEFAULT_POSTGRESQL_SESSION_CONFIG,
} from "./services/postgresql-session-store";

// Unified Session Manager
export {
  UnifiedSessionManager,
  type UnifiedSessionManagerConfig,
  DEFAULT_UNIFIED_SESSION_MANAGER_CONFIG,
} from "./services/unified-session-manager";
