// Enhanced JWT Service: Proper token generation, verification, and refresh capabilities
// Flexible Guards: Works with any framework that provides headers and set objects
// Password Security: Industry-standard password hashing and validation
// Role-Based Access: Support for roles and granular permissions
// Refresh Tokens: Secure token refresh mechanism
// Unified Authentication Context: Cross-protocol auth support for HTTP and WebSocket

// JWT Service
// const jwtService = JWTService.getInstance();
// const tokens = await jwtService.generateTokens({
//   sub: 'user123',
//   email: 'user@example.com',
//   role: 'customer',
//   permissions: ['read:profile']
// });

//  Password Service
// const hashedPassword = await PasswordService.hash('plaintext');
// const isValid = await PasswordService.verify('plaintext', hashedPassword);

//  Guards
// const payload = await requireAuth(context);
// const adminPayload = await requireRole(context, 'admin');

// Unified Auth Context
// const factory = AuthContextFactory.create(jwtService, permissionService, userService);
// const authResult = await factory.authenticate(context);
// if (authResult.success) {
//   const unifiedContext = authResult.context;
//   const canAccess = unifiedContext.canAccess('resource', 'action');
// }

export {
  JWTService,
  createJWTPlugin,
  createRefreshJWTPlugin,
  jwtConfig,
  refreshTokenConfig,
} from "./jwt";
export type { JWTPayload, RefreshTokenPayload } from "./jwt";

export {
  AuthGuard,
  authGuard,
  requireAuth,
  requireRole,
  requirePermission,
  optionalAuth,
} from "./guards";
export type { AuthContext } from "./guards";

export {
  MiddlewareAuthGuard,
  type MiddlewareAuthResult,
  type AuthorizationRequirements,
} from "./middleware-guard";

export { PasswordService } from "./password";

// Production Services exports
export { UserService } from "./services/user.service";
export type { User, UserWithRoles } from "./services/user.service";

export { SessionManager } from "./services/session.service";
export type {
  SessionInfo,
  SessionValidationResult,
} from "./services/session.service";

export { PermissionService } from "./services/permission.service";
export type {
  Permission,
  RolePermissions,
} from "./services/permission.service";

export { AuthenticationService } from "./services/authentication.service";
export type {
  LoginCredentials,
  LoginResult,
  RegisterUserData,
  RegisterResult,
  RefreshTokenResult,
} from "./services/authentication.service";

// Unified Authentication Context exports
export {
  UnifiedAuthContextImpl,
  type UnifiedAuthContext,
  type UserIdentity,
  type SessionData,
  type TokenInfo,
  type HTTPAuthContext,
  type WebSocketAuthContext,
  type SerializableAuthContext,
  type UserRole,
  type UserStatus,
  type AuthMethod,
  type ContextCreateOptions,
  type ContextValidationResult,
} from "./unified-context";

export {
  UnifiedAuthContextBuilder,
  AuthContextUtils,
  type WebSocketContextInput,
} from "./context-builder";

export {
  AuthContextFactory,
  type AuthResult,
  type PermissionService as IPermissionService,
  type UserService as IUserService,
  type SessionManager as ISessionManager,
} from "./context-factory";

// Enterprise Session Management Models and Services
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

export {
  RedisSessionStore,
  type RedisSessionConfig,
  DEFAULT_REDIS_SESSION_CONFIG,
} from "./services/redis-session-store";

export {
  PostgreSQLSessionStore,
  type PostgreSQLSessionConfig,
  DEFAULT_POSTGRESQL_SESSION_CONFIG,
} from "./services/postgresql-session-store";

export {
  UnifiedSessionManager,
  type UnifiedSessionManagerConfig,
  DEFAULT_UNIFIED_SESSION_MANAGER_CONFIG,
} from "./services/unified-session-manager";

// Enhanced JWT Token Management - Step 2.1
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

// TODO: Enhanced JWT Service (Step 2.2)
/*
export {
  EnhancedJWTService,
  SecurityLevel,
  TokenValidationError,
  type EnhancedJWTPayload,
  type TokenGenerationOptions,
  type TokenValidationResult,
  type EnhancedJWTServiceConfig,
  DEFAULT_ENHANCED_JWT_CONFIG,
} from "./services/enhanced-jwt-service";
*/

// TODO: Enhanced JWT Token Manager (Step 2.2)
/*
export {
  JWTTokenManager,
  TokenLifecycleEvent,
  type TokenCreationContext,
  type TokenValidationContext,
  type TokenRotationPolicy,
  type JWTTokenManagerConfig,
  DEFAULT_TOKEN_MANAGER_CONFIG,
  type TokenCreationResult,
  type TokenRefreshResult,
  type TokenAnalytics,
} from "./services/jwt-token-manager";
*/
