/**
 * @fileoverview Service contracts for enterprise authentication system
 * @module contracts/services
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type {
  EntityId,
  SessionId,
  JWTToken,
  APIKey,
  IAuthenticationResult,
  IAuthenticationContext,
  IAuditEvent,
} from "../types/core";

import type {
  IEnhancedUser,
  IEnhancedSession,
  IEnhancedRole,
  IEnhancedPermission,
  IBatchOperationResult,
  ICacheStatistics,
  IServiceHealth,
} from "../types/enhanced";

/**
 * User service contract for comprehensive user management
 */
export interface IUserService {
  /**
   * Find user by ID with caching
   */
  findById(userId: EntityId): Promise<IEnhancedUser | null>;

  /**
   * Find user by email with caching
   */
  findByEmail(email: string): Promise<IEnhancedUser | null>;

  /**
   * Find user by username with caching
   */
  findByUsername(username: string): Promise<IEnhancedUser | null>;

  /**
   * Find multiple users by IDs (batch operation)
   */
  findByIds(
    userIds: ReadonlyArray<EntityId>
  ): Promise<IBatchOperationResult<IEnhancedUser>>;

  /**
   * Create new user with validation
   */
  create(userData: IUserCreateData): Promise<IEnhancedUser>;

  /**
   * Update user information
   */
  update(userId: EntityId, updateData: IUserUpdateData): Promise<IEnhancedUser>;

  /**
   * Soft delete user
   */
  delete(userId: EntityId): Promise<boolean>;

  /**
   * Verify user credentials
   */
  verifyCredentials(
    email: string,
    password: string
  ): Promise<ICredentialVerificationResult>;

  /**
   * Update user password with security checks
   */
  updatePassword(
    userId: EntityId,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean>;

  /**
   * Get user activity summary
   */
  getActivitySummary(
    userId: EntityId,
    days?: number
  ): Promise<IUserActivitySummary>;

  /**
   * Warm cache with frequently accessed users
   */
  warmCache(userIds: ReadonlyArray<EntityId>): Promise<void>;

  /**
   * Clear user from cache
   */
  clearCache(userId: EntityId): Promise<void>;

  /**
   * Get cache statistics
   */
  getCacheStats(): Promise<ICacheStatistics>;

  /**
   * Health check
   */
  getHealth(): Promise<IServiceHealth>;
}

/**
 * Session service contract for session lifecycle management
 */
export interface ISessionService {
  /**
   * Create new session
   */
  create(sessionData: ISessionCreateData): Promise<IEnhancedSession>;

  /**
   * Find session by ID
   */
  findById(sessionId: SessionId): Promise<IEnhancedSession | null>;

  /**
   * Find active sessions for user
   */
  findActiveByUserId(
    userId: EntityId
  ): Promise<ReadonlyArray<IEnhancedSession>>;

  /**
   * Validate session and update last access
   */
  validate(sessionId: SessionId): Promise<ISessionValidationResult>;

  /**
   * Update session information
   */
  update(
    sessionId: SessionId,
    updateData: ISessionUpdateData
  ): Promise<IEnhancedSession>;

  /**
   * End session (logout)
   */
  end(sessionId: SessionId): Promise<boolean>;

  /**
   * End all sessions for user
   */
  endAllForUser(userId: EntityId): Promise<number>;

  /**
   * Cleanup expired sessions
   */
  cleanupExpired(): Promise<number>;

  /**
   * Get session analytics
   */
  getAnalytics(userId: EntityId, days?: number): Promise<ISessionAnalytics>;

  /**
   * Health check
   */
  getHealth(): Promise<IServiceHealth>;
}

/**
 * JWT service contract for token management
 */
export interface IJWTService {
  /**
   * Generate JWT token
   */
  generate(payload: IJWTGeneratePayload): Promise<IJWTGenerateResult>;

  /**
   * Verify JWT token
   */
  verify(token: JWTToken): Promise<IJWTVerifyResult>;

  /**
   * Refresh JWT token
   */
  refresh(refreshToken: JWTToken): Promise<IJWTRefreshResult>;

  /**
   * Blacklist JWT token
   */
  blacklist(token: JWTToken, reason: string): Promise<boolean>;

  /**
   * Check if token is blacklisted
   */
  isBlacklisted(token: JWTToken): Promise<boolean>;

  /**
   * Batch verify tokens
   */
  verifyBatch(
    tokens: ReadonlyArray<JWTToken>
  ): Promise<IBatchOperationResult<IJWTVerifyResult>>;

  /**
   * Get token health information
   */
  getTokenHealth(token: JWTToken): Promise<ITokenHealthInfo>;

  /**
   * Cleanup expired tokens from blacklist
   */
  cleanupBlacklist(): Promise<number>;

  /**
   * Health check
   */
  getHealth(): Promise<IServiceHealth>;
}

/**
 * Permission service contract for RBAC management
 */
export interface IPermissionService {
  /**
   * Check if user has permission
   */
  hasPermission(
    userId: EntityId,
    resource: string,
    action: string,
    context?: Record<string, unknown>
  ): Promise<boolean>;

  /**
   * Check multiple permissions (batch)
   */
  hasPermissions(
    userId: EntityId,
    permissions: ReadonlyArray<IPermissionCheck>
  ): Promise<IBatchOperationResult<boolean>>;

  /**
   * Get user permissions
   */
  getUserPermissions(
    userId: EntityId
  ): Promise<ReadonlyArray<IEnhancedPermission>>;

  /**
   * Get user roles
   */
  getUserRoles(userId: EntityId): Promise<ReadonlyArray<IEnhancedRole>>;

  /**
   * Assign role to user
   */
  assignRole(userId: EntityId, roleId: EntityId): Promise<boolean>;

  /**
   * Remove role from user
   */
  removeRole(userId: EntityId, roleId: EntityId): Promise<boolean>;

  /**
   * Get role hierarchy
   */
  getRoleHierarchy(roleId: EntityId): Promise<IRoleHierarchyInfo>;

  /**
   * Resolve permissions with inheritance
   */
  resolvePermissions(userId: EntityId): Promise<ReadonlyArray<string>>;

  /**
   * Cache permission check result
   */
  cachePermissionResult(
    userId: EntityId,
    resource: string,
    action: string,
    result: boolean
  ): Promise<void>;

  /**
   * Clear permission cache for user
   */
  clearUserPermissionCache(userId: EntityId): Promise<void>;

  /**
   * Get permission analytics
   */
  getPermissionAnalytics(
    userId: EntityId,
    days?: number
  ): Promise<IPermissionAnalytics>;

  /**
   * Health check
   */
  getHealth(): Promise<IServiceHealth>;
}

/**
 * API Key service contract for API key management
 */
export interface IAPIKeyService {
  /**
   * Generate new API key
   */
  generate(keyData: IAPIKeyGenerateData): Promise<IAPIKeyGenerateResult>;

  /**
   * Validate API key
   */
  validate(key: APIKey): Promise<IAPIKeyValidationResult>;

  /**
   * Find API key by ID
   */
  findById(keyId: EntityId): Promise<IAPIKeyInfo | null>;

  /**
   * Find API keys for user
   */
  findByUserId(userId: EntityId): Promise<ReadonlyArray<IAPIKeyInfo>>;

  /**
   * Update API key
   */
  update(keyId: EntityId, updateData: IAPIKeyUpdateData): Promise<IAPIKeyInfo>;

  /**
   * Rotate API key
   */
  rotate(keyId: EntityId): Promise<IAPIKeyGenerateResult>;

  /**
   * Revoke API key
   */
  revoke(keyId: EntityId, reason: string): Promise<boolean>;

  /**
   * Check rate limit for key
   */
  checkRateLimit(key: APIKey): Promise<IRateLimitResult>;

  /**
   * Get usage statistics
   */
  getUsageStats(keyId: EntityId, days?: number): Promise<IAPIKeyUsageStats>;

  /**
   * Health check
   */
  getHealth(): Promise<IServiceHealth>;
}

/**
 * Authentication service contract for orchestrating authentication flows
 */
export interface IAuthenticationService {
  /**
   * Authenticate user with credentials
   */
  authenticate(
    credentials: IAuthenticationCredentials
  ): Promise<IAuthenticationResult>;

  /**
   * Register new user
   */
  register(registrationData: IRegistrationData): Promise<IRegistrationResult>;

  /**
   * Validate authentication context
   */
  validateContext(
    context: IAuthenticationContext
  ): Promise<IAuthenticationResult>;

  /**
   * Refresh authentication
   */
  refresh(refreshToken: JWTToken): Promise<IAuthenticationResult>;

  /**
   * Logout user
   */
  logout(context: IAuthenticationContext): Promise<boolean>;

  /**
   * Change user password
   */
  changePassword(
    context: IAuthenticationContext,
    passwordData: IPasswordChangeData
  ): Promise<boolean>;

  /**
   * Get authentication context by session
   */
  getContextBySession(
    sessionId: SessionId
  ): Promise<IAuthenticationContext | null>;

  /**
   * Get authentication context by JWT
   */
  getContextByJWT(token: JWTToken): Promise<IAuthenticationContext | null>;

  /**
   * Get authentication context by API key
   */
  getContextByAPIKey(key: APIKey): Promise<IAuthenticationContext | null>;

  /**
   * Health check
   */
  getHealth(): Promise<IServiceHealth>;
}

/**
 * Cache service contract for authentication caching
 */
export interface ICacheService {
  /**
   * Get cached value
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set cached value with TTL
   */
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;

  /**
   * Delete cached value
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if key exists
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get cache statistics
   */
  getStats(): Promise<ICacheStatistics>;

  /**
   * Clear cache by pattern
   */
  clearPattern(pattern: string): Promise<number>;

  /**
   * Health check
   */
  getHealth(): Promise<IServiceHealth>;
}

/**
 * Audit service contract for security event tracking
 */
export interface IAuditService {
  /**
   * Log audit event
   */
  log(event: IAuditEvent): Promise<void>;

  /**
   * Log authentication event
   */
  logAuthEvent(
    userId: EntityId | null,
    action: string,
    result: "success" | "failure",
    metadata?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Get audit events for user
   */
  getUserEvents(
    userId: EntityId,
    limit?: number,
    offset?: number
  ): Promise<ReadonlyArray<IAuditEvent>>;

  /**
   * Search audit events
   */
  search(criteria: IAuditSearchCriteria): Promise<ReadonlyArray<IAuditEvent>>;

  /**
   * Health check
   */
  getHealth(): Promise<IServiceHealth>;
}

// Supporting interfaces and types

export interface IUserCreateData {
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface IUserUpdateData {
  readonly email?: string;
  readonly username?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly isActive?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface ICredentialVerificationResult {
  readonly isValid: boolean;
  readonly user: IEnhancedUser | null;
  readonly failureReason: string | null;
  readonly requiresPasswordReset: boolean;
  readonly lockUntil: Date | null;
}

export interface IUserActivitySummary {
  readonly userId: EntityId;
  readonly totalLogins: number;
  readonly lastLogin: Date | null;
  readonly averageSessionDuration: number;
  readonly totalSessions: number;
  readonly failedLoginAttempts: number;
  readonly uniqueDevices: number;
  readonly suspiciousActivities: number;
}

export interface ISessionCreateData {
  readonly userId: EntityId;
  readonly deviceId: string;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ISessionUpdateData {
  readonly lastAccessedAt?: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface ISessionValidationResult {
  readonly isValid: boolean;
  readonly session: IEnhancedSession | null;
  readonly failureReason: string | null;
  readonly remainingTtl: number;
}

export interface ISessionAnalytics {
  readonly userId: EntityId;
  readonly totalSessions: number;
  readonly activeSessions: number;
  readonly averageDuration: number;
  readonly deviceBreakdown: Record<string, number>;
  readonly locationBreakdown: Record<string, number>;
}

export interface IJWTGeneratePayload {
  readonly userId: EntityId;
  readonly sessionId?: SessionId;
  readonly permissions?: ReadonlyArray<string>;
  readonly roles?: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
  readonly expiresIn?: string;
}

export interface IJWTGenerateResult {
  readonly token: JWTToken;
  readonly refreshToken: JWTToken;
  readonly expiresAt: Date;
  readonly tokenId: string;
}

export interface IJWTVerifyResult {
  readonly isValid: boolean;
  readonly payload: any;
  readonly failureReason: string | null;
  readonly isBlacklisted: boolean;
  readonly expiresAt: Date | null;
}

export interface IJWTRefreshResult {
  readonly success: boolean;
  readonly newToken: JWTToken | null;
  readonly newRefreshToken: JWTToken | null;
  readonly expiresAt: Date | null;
  readonly failureReason: string | null;
}

export interface ITokenHealthInfo {
  readonly isValid: boolean;
  readonly isExpired: boolean;
  readonly isBlacklisted: boolean;
  readonly expiresAt: Date | null;
  readonly remainingTtl: number;
  readonly usage: number;
}

export interface IPermissionCheck {
  readonly resource: string;
  readonly action: string;
  readonly context?: Record<string, unknown>;
}

export interface IRoleHierarchyInfo {
  readonly roleId: EntityId;
  readonly level: number;
  readonly parentRoles: ReadonlyArray<EntityId>;
  readonly childRoles: ReadonlyArray<EntityId>;
  readonly inheritedPermissions: ReadonlyArray<string>;
  readonly directPermissions: ReadonlyArray<string>;
}

export interface IPermissionAnalytics {
  readonly userId: EntityId;
  readonly totalChecks: number;
  readonly deniedChecks: number;
  readonly topResources: ReadonlyArray<{ resource: string; count: number }>;
  readonly topActions: ReadonlyArray<{ action: string; count: number }>;
}

export interface IAPIKeyGenerateData {
  readonly userId: EntityId;
  readonly name: string;
  readonly scopes: ReadonlyArray<string>;
  readonly expiresAt?: Date;
  readonly rateLimit?: {
    readonly requestsPerHour: number;
    readonly requestsPerDay: number;
    readonly burstLimit: number;
  };
  readonly metadata?: Record<string, unknown>;
}

export interface IAPIKeyGenerateResult {
  readonly keyId: EntityId;
  readonly key: APIKey;
  readonly hashedKey: string;
  readonly expiresAt: Date | null;
}

export interface IAPIKeyValidationResult {
  readonly isValid: boolean;
  readonly keyInfo: IAPIKeyInfo | null;
  readonly failureReason: string | null;
  readonly rateLimitStatus: IRateLimitResult;
}

export interface IAPIKeyInfo {
  readonly id: EntityId;
  readonly name: string;
  readonly userId: EntityId;
  readonly scopes: ReadonlyArray<string>;
  readonly isActive: boolean;
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly usageCount: number;
}

export interface IAPIKeyUpdateData {
  readonly name?: string;
  readonly scopes?: ReadonlyArray<string>;
  readonly isActive?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface IRateLimitResult {
  readonly allowed: boolean;
  readonly remainingRequests: number;
  readonly resetTime: Date;
  readonly retryAfter: number | null;
}

export interface IAPIKeyUsageStats {
  readonly keyId: EntityId;
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly averageResponseTime: number;
  readonly requestsByDay: ReadonlyArray<{ date: string; count: number }>;
  readonly topEndpoints: ReadonlyArray<{ endpoint: string; count: number }>;
}

export interface IAuthenticationCredentials {
  readonly type: "email" | "username" | "api_key";
  readonly identifier: string;
  readonly password?: string;
  readonly apiKey?: APIKey;
  readonly deviceInfo?: IDeviceInfo;
  readonly metadata?: Record<string, unknown>;
}

export interface IRegistrationData {
  readonly email: string;
  readonly username: string;
  readonly password: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly acceptedTerms: boolean;
  readonly deviceInfo?: IDeviceInfo;
  readonly metadata?: Record<string, unknown>;
}

export interface IRegistrationResult {
  readonly success: boolean;
  readonly user: IEnhancedUser | null;
  readonly authenticationResult: IAuthenticationResult | null;
  readonly failureReason: string | null;
  readonly validationErrors: ReadonlyArray<string>;
}

export interface IPasswordChangeData {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmNewPassword: string;
}

export interface IDeviceInfo {
  readonly deviceId: string;
  readonly platform: string;
  readonly browser: string;
  readonly version: string;
  readonly isMobile: boolean;
  readonly screenResolution: string;
  readonly timezone: string;
}

export interface IAuditSearchCriteria {
  readonly userId?: EntityId;
  readonly action?: string;
  readonly result?: "success" | "failure";
  readonly dateRange?: {
    readonly start: Date;
    readonly end: Date;
  };
  readonly ipAddress?: string;
  readonly limit?: number;
  readonly offset?: number;
}

// Re-export shared interfaces from enhanced types
export type {
  IBatchOperationResult,
  ICacheStatistics,
  IServiceHealth,
} from "../types/enhanced";
