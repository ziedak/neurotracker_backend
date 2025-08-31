/**
 * Core Service Contracts for AuthV3
 *
 * Clean interfaces following SOLID principles with comprehensive
 * coverage of all authentication, security, and enterprise features.
 */

import type {
  User,
  UserId,
  Session,
  SessionId,
  TokenInfo,
  TokenId,
  APIKey,
  APIKeyId,
  DeviceId,
  TenantId,
  LoginRequest,
  LoginResponse,
  AuthStatus,
  TokenType,
  RiskAssessment,
  DeviceInfo,
  AuditEvent,
  AuthEvent,
  SecurityContext,
  RateLimit,
} from "../types/auth.types.js";

// ==============================================================================
// CORE AUTHENTICATION SERVICE CONTRACTS
// ==============================================================================

/**
 * Main authentication service interface
 */
export interface IAuthenticationService {
  /**
   * Authenticate user with credentials and optional MFA
   */
  authenticate(request: LoginRequest): Promise<LoginResponse>;

  /**
   * Verify and refresh access token
   */
  refreshToken(refreshToken: string): Promise<LoginResponse>;

  /**
   * Logout user and invalidate session
   */
  logout(sessionId: SessionId): Promise<void>;

  /**
   * Logout user from all sessions
   */
  logoutAll(userId: UserId): Promise<void>;

  /**
   * Verify token and return user context
   */
  verifyToken(token: string): Promise<TokenInfo | null>;

  /**
   * Check if user is authenticated and active
   */
  isAuthenticated(token: string): Promise<boolean>;
}

/**
 * Credential management service interface
 */
export interface ICredentialService {
  /**
   * Validate user credentials
   */
  validateCredentials(
    identifier: string,
    password: string,
    tenantId?: TenantId
  ): Promise<User | null>;

  /**
   * Hash password with secure algorithm
   */
  hashPassword(password: string): Promise<{ hash: string; salt: string }>;

  /**
   * Verify password against hash
   */
  verifyPassword(
    password: string,
    hash: string,
    salt: string
  ): Promise<boolean>;

  /**
   * Validate password strength
   */
  validatePasswordStrength(
    password: string
  ): Promise<{ valid: boolean; errors: string[] }>;

  /**
   * Change user password
   */
  changePassword(
    userId: UserId,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean>;

  /**
   * Reset password with token
   */
  resetPassword(resetToken: string, newPassword: string): Promise<boolean>;

  /**
   * Generate password reset token
   */
  generateResetToken(email: string): Promise<string | null>;
}

/**
 * Session management service interface
 */
export interface ISessionService {
  /**
   * Create new session
   */
  createSession(userId: UserId, deviceInfo: DeviceInfo): Promise<Session>;

  /**
   * Get session by ID
   */
  getSession(sessionId: SessionId): Promise<Session | null>;

  /**
   * Update session activity
   */
  updateSessionActivity(sessionId: SessionId): Promise<void>;

  /**
   * Terminate session
   */
  terminateSession(sessionId: SessionId): Promise<void>;

  /**
   * Terminate all sessions for user
   */
  terminateAllSessions(userId: UserId): Promise<void>;

  /**
   * Get active sessions for user
   */
  getActiveSessions(userId: UserId): Promise<Session[]>;

  /**
   * Clean expired sessions
   */
  cleanExpiredSessions(): Promise<number>;

  /**
   * Validate session
   */
  validateSession(sessionId: SessionId): Promise<boolean>;
}

/**
 * Token management service interface
 */
export interface ITokenService {
  /**
   * Generate JWT token
   */
  generateToken(
    userId: UserId,
    sessionId: SessionId,
    type: TokenType,
    customClaims?: Record<string, unknown>
  ): Promise<{ token: string; tokenInfo: TokenInfo }>;

  /**
   * Verify and decode JWT token
   */
  verifyToken(token: string): Promise<TokenInfo | null>;

  /**
   * Blacklist token
   */
  blacklistToken(tokenId: TokenId): Promise<void>;

  /**
   * Check if token is blacklisted
   */
  isTokenBlacklisted(tokenId: TokenId): Promise<boolean>;

  /**
   * Clean expired blacklisted tokens
   */
  cleanExpiredBlacklistedTokens(): Promise<number>;

  /**
   * Get token information without verification
   */
  decodeToken(token: string): TokenInfo | null;
}

// ==============================================================================
// MULTI-FACTOR AUTHENTICATION SERVICE CONTRACTS
// ==============================================================================

/**
 * Multi-Factor Authentication service interface
 */
export interface IMFAService {
  /**
   * Generate MFA secret for user
   */
  generateSecret(userId: UserId): Promise<{ secret: string; qrCode: string }>;

  /**
   * Verify MFA token
   */
  verifyToken(
    userId: UserId,
    token: string,
    type: "totp" | "sms" | "backup"
  ): Promise<boolean>;

  /**
   * Enable MFA for user
   */
  enableMFA(userId: UserId, token: string): Promise<{ backupCodes: string[] }>;

  /**
   * Disable MFA for user
   */
  disableMFA(userId: UserId, token: string): Promise<boolean>;

  /**
   * Generate backup codes
   */
  generateBackupCodes(userId: UserId): Promise<string[]>;

  /**
   * Send SMS token
   */
  sendSMSToken(userId: UserId, phoneNumber: string): Promise<boolean>;

  /**
   * Verify SMS token
   */
  verifySMSToken(userId: UserId, token: string): Promise<boolean>;

  /**
   * Check if MFA is enabled for user
   */
  isMFAEnabled(userId: UserId): Promise<boolean>;
}

// ==============================================================================
// API KEY MANAGEMENT SERVICE CONTRACTS
// ==============================================================================

/**
 * API Key management service interface
 */
export interface IAPIKeyService {
  /**
   * Create new API key
   */
  createAPIKey(
    userId: UserId,
    name: string,
    scopes: string[],
    expiresAt?: Date,
    rateLimit?: RateLimit
  ): Promise<{ apiKey: APIKey; key: string }>;

  /**
   * Validate API key
   */
  validateAPIKey(key: string): Promise<APIKey | null>;

  /**
   * Revoke API key
   */
  revokeAPIKey(apiKeyId: APIKeyId): Promise<boolean>;

  /**
   * List user's API keys
   */
  listAPIKeys(userId: UserId): Promise<Omit<APIKey, "keyHash">[]>;

  /**
   * Update API key
   */
  updateAPIKey(
    apiKeyId: APIKeyId,
    updates: Partial<Pick<APIKey, "name" | "scopes" | "isActive" | "expiresAt">>
  ): Promise<boolean>;

  /**
   * Record API key usage
   */
  recordUsage(apiKeyId: APIKeyId, endpoint: string): Promise<void>;

  /**
   * Get API key usage statistics
   */
  getUsageStats(
    apiKeyId: APIKeyId,
    days: number
  ): Promise<{
    totalRequests: number;
    dailyBreakdown: Array<{ date: string; requests: number }>;
  }>;
}

// ==============================================================================
// SECURITY AND RISK ASSESSMENT SERVICE CONTRACTS
// ==============================================================================

/**
 * Risk assessment service interface
 */
export interface IRiskAssessmentService {
  /**
   * Assess login risk
   */
  assessLoginRisk(
    userId: UserId,
    deviceInfo: DeviceInfo
  ): Promise<RiskAssessment>;

  /**
   * Generate device fingerprint
   */
  generateDeviceFingerprint(deviceInfo: DeviceInfo): Promise<string>;

  /**
   * Check for anomalous behavior
   */
  detectAnomalies(userId: UserId, deviceInfo: DeviceInfo): Promise<string[]>;

  /**
   * Update user trust score
   */
  updateTrustScore(
    userId: UserId,
    factor: number,
    reason: string
  ): Promise<number>;

  /**
   * Get user trust score
   */
  getTrustScore(userId: UserId): Promise<number>;

  /**
   * Report suspicious activity
   */
  reportSuspiciousActivity(
    userId: UserId,
    sessionId: SessionId,
    activity: string,
    metadata: Record<string, unknown>
  ): Promise<void>;
}

/**
 * Rate limiting service interface
 */
export interface IRateLimitService {
  /**
   * Check rate limit
   */
  checkRateLimit(
    key: string,
    limit: RateLimit
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: Date;
  }>;

  /**
   * Record rate limit hit
   */
  recordHit(key: string): Promise<void>;

  /**
   * Reset rate limit counter
   */
  resetCounter(key: string): Promise<void>;

  /**
   * Get rate limit status
   */
  getStatus(key: string): Promise<{
    hits: number;
    remaining: number;
    resetTime: Date;
  }>;

  /**
   * Apply penalty (temporary rate limit increase)
   */
  applyPenalty(
    key: string,
    multiplier: number,
    durationMs: number
  ): Promise<void>;
}

// ==============================================================================
// AUDIT AND MONITORING SERVICE CONTRACTS
// ==============================================================================

/**
 * Audit logging service interface
 */
export interface IAuditService {
  /**
   * Log authentication event
   */
  logEvent(event: AuditEvent): Promise<void>;

  /**
   * Create audit event
   */
  createEvent(
    event: AuthEvent,
    userId: UserId | undefined,
    sessionId: SessionId | undefined,
    ipAddress: string,
    userAgent: string,
    success: boolean,
    metadata?: Record<string, unknown>,
    errorMessage?: string
  ): Promise<AuditEvent>;

  /**
   * Get audit events for user
   */
  getUserEvents(
    userId: UserId,
    limit?: number,
    offset?: number
  ): Promise<AuditEvent[]>;

  /**
   * Get audit events by type
   */
  getEventsByType(
    event: AuthEvent,
    limit?: number,
    offset?: number
  ): Promise<AuditEvent[]>;

  /**
   * Search audit events
   */
  searchEvents(
    filters: Partial<
      Pick<AuditEvent, "userId" | "event" | "success" | "tenantId">
    >,
    dateRange?: { from: Date; to: Date },
    limit?: number,
    offset?: number
  ): Promise<AuditEvent[]>;

  /**
   * Get security metrics
   */
  getSecurityMetrics(dateRange: { from: Date; to: Date }): Promise<{
    totalEvents: number;
    failedLogins: number;
    successfulLogins: number;
    mfaUsage: number;
    riskEvents: number;
    topRiskyIPs: Array<{ ip: string; count: number }>;
  }>;
}

// ==============================================================================
// CACHE AND STORAGE SERVICE CONTRACTS
// ==============================================================================

/**
 * Cache service interface for authentication data
 */
export interface IAuthCacheService {
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
   * Increment counter
   */
  increment(key: string, by?: number): Promise<number>;

  /**
   * Set expiration for key
   */
  expire(key: string, ttlSeconds: number): Promise<boolean>;

  /**
   * Get multiple values
   */
  mget<T>(keys: string[]): Promise<(T | null)[]>;

  /**
   * Set multiple values
   */
  mset<T>(
    keyValues: Array<{ key: string; value: T; ttl?: number }>
  ): Promise<void>;

  /**
   * Delete multiple keys
   */
  mdel(keys: string[]): Promise<number>;

  /**
   * Clear all cached data (use with caution)
   */
  clear(): Promise<void>;
}

// ==============================================================================
// REPOSITORY CONTRACTS FOR DATA ACCESS
// ==============================================================================

/**
 * User repository interface
 */
export interface IUserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: string, tenantId?: TenantId): Promise<User | null>;
  findByUsername(username: string, tenantId?: TenantId): Promise<User | null>;
  create(userData: Omit<User, "id" | "createdAt" | "updatedAt">): Promise<User>;
  update(
    id: UserId,
    updates: Partial<Omit<User, "id" | "createdAt">>
  ): Promise<User | null>;
  delete(id: UserId): Promise<boolean>;
  incrementFailedAttempts(id: UserId): Promise<number>;
  resetFailedAttempts(id: UserId): Promise<void>;
  lockAccount(id: UserId, lockUntil: Date): Promise<void>;
}

/**
 * Session repository interface
 */
export interface ISessionRepository {
  findById(id: SessionId): Promise<Session | null>;
  findByUserId(userId: UserId): Promise<Session[]>;
  create(sessionData: Omit<Session, "id" | "createdAt">): Promise<Session>;
  update(
    id: SessionId,
    updates: Partial<Omit<Session, "id" | "createdAt">>
  ): Promise<Session | null>;
  delete(id: SessionId): Promise<boolean>;
  deleteByUserId(userId: UserId): Promise<number>;
  deleteExpired(): Promise<number>;
  updateLastAccess(id: SessionId): Promise<void>;
}

/**
 * API Key repository interface
 */
export interface IAPIKeyRepository {
  findById(id: APIKeyId): Promise<APIKey | null>;
  findByHash(hash: string): Promise<APIKey | null>;
  findByUserId(userId: UserId): Promise<APIKey[]>;
  create(
    apiKeyData: Omit<APIKey, "id" | "createdAt" | "updatedAt">
  ): Promise<APIKey>;
  update(
    id: APIKeyId,
    updates: Partial<Omit<APIKey, "id" | "createdAt">>
  ): Promise<APIKey | null>;
  delete(id: APIKeyId): Promise<boolean>;
  incrementUsage(id: APIKeyId): Promise<void>;
  recordUsage(id: APIKeyId, endpoint: string, timestamp: Date): Promise<void>;
}

// ==============================================================================
// HEALTH AND DIAGNOSTICS SERVICE CONTRACTS
// ==============================================================================

/**
 * Health check service interface
 */
export interface IHealthService {
  /**
   * Check overall health status
   */
  checkHealth(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    services: Record<
      string,
      {
        status: "up" | "down" | "degraded";
        latency?: number;
        error?: string;
      }
    >;
    timestamp: Date;
  }>;

  /**
   * Check specific service health
   */
  checkServiceHealth(serviceName: string): Promise<{
    status: "up" | "down" | "degraded";
    latency?: number;
    error?: string;
  }>;

  /**
   * Get service metrics
   */
  getMetrics(): Promise<{
    activeUsers: number;
    activeSessions: number;
    failedLogins: number;
    successfulLogins: number;
    cacheHitRate: number;
    averageResponseTime: number;
  }>;
}

// ==============================================================================
// EXPORT ALL CONTRACTS
// ==============================================================================

export type {
  IAuthenticationService,
  ICredentialService,
  ISessionService,
  ITokenService,
  IMFAService,
  IAPIKeyService,
  IRiskAssessmentService,
  IRateLimitService,
  IAuditService,
  IAuthCacheService,
  IUserRepository,
  ISessionRepository,
  IAPIKeyRepository,
  IHealthService,
};
