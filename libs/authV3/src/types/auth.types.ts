import { z } from "zod";

/**
 * Core Authentication Types for AuthV3
 *
 * Security-first design with strict type validation
 * and comprehensive coverage of all authentication scenarios.
 */

// ==============================================================================
// BRANDED TYPES FOR TYPE SAFETY
// ==============================================================================

/**
 * Branded string types for enhanced type safety
 */
export type UserId = string & { readonly __brand: "UserId" };
export type SessionId = string & { readonly __brand: "SessionId" };
export type TokenId = string & { readonly __brand: "TokenId" };
export type APIKeyId = string & { readonly __brand: "APIKeyId" };
export type DeviceId = string & { readonly __brand: "DeviceId" };
export type TenantId = string & { readonly __brand: "TenantId" };

/**
 * Brand helper functions
 */
export const createUserId = (id: string): UserId => id as UserId;
export const createSessionId = (id: string): SessionId => id as SessionId;
export const createTokenId = (id: string): TokenId => id as TokenId;
export const createAPIKeyId = (id: string): APIKeyId => id as APIKeyId;
export const createDeviceId = (id: string): DeviceId => id as DeviceId;
export const createTenantId = (id: string): TenantId => id as TenantId;

// ==============================================================================
// ZOD SCHEMAS FOR RUNTIME VALIDATION
// ==============================================================================

/**
 * User credential validation schemas
 */
export const CredentialsSchema = z.object({
  identifier: z.string().min(3).max(320), // email or username
  password: z.string().min(8).max(128),
  tenantId: z.string().optional(),
});

export const PasswordStrengthSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must not exceed 128 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(
      /[^A-Za-z0-9]/,
      "Password must contain at least one special character"
    ),
});

/**
 * MFA validation schemas
 */
export const MFATokenSchema = z.object({
  token: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, "MFA token must be 6 digits"),
  type: z.enum(["totp", "sms", "backup"]),
});

export const MFASetupSchema = z.object({
  type: z.enum(["totp", "sms"]),
  phoneNumber: z.string().optional(),
  backupCodes: z.array(z.string()).optional(),
});

// ==============================================================================
// CORE AUTHENTICATION TYPES
// ==============================================================================

/**
 * User authentication information
 */
export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly username?: string;
  readonly passwordHash: string;
  readonly salt: string;
  readonly isActive: boolean;
  readonly isVerified: boolean;
  readonly mfaEnabled: boolean;
  readonly mfaSecret?: string;
  readonly backupCodes?: string[];
  readonly failedLoginAttempts: number;
  readonly lastLoginAt?: Date;
  readonly lockedUntil?: Date;
  readonly tenantId?: TenantId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Session information with security context
 */
export interface Session {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly deviceId: DeviceId;
  readonly userAgent: string;
  readonly ipAddress: string;
  readonly isActive: boolean;
  readonly expiresAt: Date;
  readonly lastAccessedAt: Date;
  readonly createdAt: Date;
  readonly tenantId?: TenantId;
  readonly securityContext: SecurityContext;
}

/**
 * Security context for risk assessment
 */
export interface SecurityContext {
  readonly riskLevel: RiskLevel;
  readonly deviceFingerprint: string;
  readonly geoLocation?: GeoLocation;
  readonly anomalyFlags: AnomalyFlag[];
  readonly trustScore: number; // 0-100
}

/**
 * Geographic location information
 */
export interface GeoLocation {
  readonly country: string;
  readonly region: string;
  readonly city: string;
  readonly timezone: string;
  readonly coordinates?: {
    readonly latitude: number;
    readonly longitude: number;
  };
}

/**
 * JWT token information
 */
export interface TokenInfo {
  readonly id: TokenId;
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly type: TokenType;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly audience: string;
  readonly issuer: string;
  readonly scopes: string[];
  readonly tenantId?: TenantId;
}

/**
 * API Key information
 */
export interface APIKey {
  readonly id: APIKeyId;
  readonly userId: UserId;
  readonly name: string;
  readonly keyHash: string;
  readonly prefix: string; // First 8 chars for identification
  readonly scopes: string[];
  readonly rateLimit?: RateLimit;
  readonly isActive: boolean;
  readonly expiresAt?: Date;
  readonly lastUsedAt?: Date;
  readonly usageCount: number;
  readonly tenantId?: TenantId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ==============================================================================
// ENUMS AND CONSTANTS
// ==============================================================================

/**
 * Authentication result status
 */
export enum AuthStatus {
  SUCCESS = "success",
  INVALID_CREDENTIALS = "invalid_credentials",
  ACCOUNT_LOCKED = "account_locked",
  ACCOUNT_DISABLED = "account_disabled",
  MFA_REQUIRED = "mfa_required",
  MFA_INVALID = "mfa_invalid",
  RATE_LIMITED = "rate_limited",
  EXPIRED_TOKEN = "expired_token",
  INVALID_TOKEN = "invalid_token",
  INSUFFICIENT_PERMISSIONS = "insufficient_permissions",
}

/**
 * Token types
 */
export enum TokenType {
  ACCESS = "access",
  REFRESH = "refresh",
  RESET_PASSWORD = "reset_password",
  VERIFY_EMAIL = "verify_email",
  API_KEY = "api_key",
}

/**
 * Risk assessment levels
 */
export enum RiskLevel {
  VERY_LOW = "very_low",
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Anomaly detection flags
 */
export enum AnomalyFlag {
  NEW_DEVICE = "new_device",
  NEW_LOCATION = "new_location",
  UNUSUAL_TIME = "unusual_time",
  VELOCITY_ANOMALY = "velocity_anomaly",
  SUSPICIOUS_USER_AGENT = "suspicious_user_agent",
  TOR_EXIT_NODE = "tor_exit_node",
  KNOWN_BOT = "known_bot",
  BRUTE_FORCE_PATTERN = "brute_force_pattern",
}

/**
 * Rate limiting configuration
 */
export interface RateLimit {
  readonly requests: number;
  readonly windowMs: number;
  readonly burstLimit?: number;
}

// ==============================================================================
// AUTHENTICATION REQUEST/RESPONSE TYPES
// ==============================================================================

/**
 * Login request
 */
export interface LoginRequest {
  readonly credentials: z.infer<typeof CredentialsSchema>;
  readonly deviceInfo: DeviceInfo;
  readonly mfaToken?: string;
  readonly rememberMe?: boolean;
}

/**
 * Login response
 */
export interface LoginResponse {
  readonly status: AuthStatus;
  readonly user?: Omit<User, "passwordHash" | "salt" | "mfaSecret">;
  readonly tokens?: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresIn: number;
  };
  readonly session?: Pick<Session, "id" | "expiresAt">;
  readonly mfaRequired?: boolean;
  readonly mfaQrCode?: string; // For first-time MFA setup
  readonly riskAssessment?: RiskAssessment;
  readonly message?: string;
}

/**
 * Device information for fingerprinting
 */
export interface DeviceInfo {
  readonly userAgent: string;
  readonly ipAddress: string;
  readonly acceptLanguage?: string;
  readonly timezone?: string;
  readonly screenResolution?: string;
  readonly platform?: string;
}

/**
 * Risk assessment result
 */
export interface RiskAssessment {
  readonly level: RiskLevel;
  readonly score: number;
  readonly factors: string[];
  readonly additionalVerificationRequired: boolean;
  readonly recommendedActions: string[];
}

// ==============================================================================
// SERVICE CONFIGURATION TYPES
// ==============================================================================

/**
 * Authentication service configuration
 */
export interface AuthConfig {
  readonly jwt: JWTConfig;
  readonly session: SessionConfig;
  readonly password: PasswordConfig;
  readonly mfa: MFAConfig;
  readonly rateLimit: RateLimitConfig;
  readonly security: SecurityConfig;
}

/**
 * JWT configuration
 */
export interface JWTConfig {
  readonly secret: string;
  readonly algorithm: "HS256" | "HS384" | "HS512" | "RS256" | "RS384" | "RS512";
  readonly accessTokenTTL: number; // seconds
  readonly refreshTokenTTL: number; // seconds
  readonly issuer: string;
  readonly audience: string;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  readonly ttl: number; // seconds
  readonly extendOnActivity: boolean;
  readonly maxConcurrentSessions: number;
  readonly requireDeviceVerification: boolean;
}

/**
 * Password configuration
 */
export interface PasswordConfig {
  readonly argon2: {
    readonly timeCost: number;
    readonly memoryCost: number;
    readonly parallelism: number;
    readonly hashLength: number;
  };
  readonly lockout: {
    readonly maxAttempts: number;
    readonly lockoutDurationMs: number;
    readonly resetOnSuccess: boolean;
  };
}

/**
 * MFA configuration
 */
export interface MFAConfig {
  readonly issuer: string;
  readonly algorithm: "SHA1" | "SHA256" | "SHA512";
  readonly digits: 6 | 8;
  readonly period: number; // seconds
  readonly window: number; // tolerance window
  readonly backupCodesCount: number;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  readonly login: RateLimit;
  readonly mfa: RateLimit;
  readonly apiKey: RateLimit;
  readonly globalRequestLimit: RateLimit;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
  readonly enableRiskAssessment: boolean;
  readonly allowedOrigins: string[];
  readonly trustedProxies: string[];
  readonly sessionCookieSecure: boolean;
  readonly sessionCookieSameSite: "strict" | "lax" | "none";
  readonly csrfProtection: boolean;
}

// ==============================================================================
// EVENT TYPES FOR AUDIT LOGGING
// ==============================================================================

/**
 * Authentication events for audit logging
 */
export enum AuthEvent {
  LOGIN_SUCCESS = "login_success",
  LOGIN_FAILED = "login_failed",
  LOGIN_LOCKED = "login_locked",
  LOGOUT = "logout",
  TOKEN_REFRESH = "token_refresh",
  TOKEN_REVOKED = "token_revoked",
  SESSION_CREATED = "session_created",
  SESSION_EXPIRED = "session_expired",
  SESSION_TERMINATED = "session_terminated",
  MFA_ENABLED = "mfa_enabled",
  MFA_DISABLED = "mfa_disabled",
  MFA_SUCCESS = "mfa_success",
  MFA_FAILED = "mfa_failed",
  API_KEY_CREATED = "api_key_created",
  API_KEY_DELETED = "api_key_deleted",
  API_KEY_USED = "api_key_used",
  RISK_DETECTED = "risk_detected",
  ACCOUNT_LOCKED = "account_locked",
  ACCOUNT_UNLOCKED = "account_unlocked",
  PASSWORD_CHANGED = "password_changed",
  PASSWORD_RESET_REQUESTED = "password_reset_requested",
  PASSWORD_RESET_COMPLETED = "password_reset_completed",
}

/**
 * Audit event structure
 */
export interface AuditEvent {
  readonly id: string;
  readonly event: AuthEvent;
  readonly userId?: UserId;
  readonly sessionId?: SessionId;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly timestamp: Date;
  readonly tenantId?: TenantId;
  readonly metadata: Record<string, unknown>;
  readonly success: boolean;
  readonly errorMessage?: string;
}

// ==============================================================================
// TYPE VALIDATION HELPERS
// ==============================================================================

/**
 * Type validation functions for runtime type checking
 */
export const TypeValidators = {
  isUser: (obj: unknown): obj is User => {
    return (
      typeof obj === "object" && obj !== null && "id" in obj && "email" in obj
    );
  },

  isSession: (obj: unknown): obj is Session => {
    return (
      typeof obj === "object" && obj !== null && "id" in obj && "userId" in obj
    );
  },

  isValidCredentials: (obj: unknown): boolean => {
    return CredentialsSchema.safeParse(obj).success;
  },

  isValidMFAToken: (obj: unknown): boolean => {
    return MFATokenSchema.safeParse(obj).success;
  },
} as const;

// ==============================================================================
// EXPORT TYPES FOR EXTERNAL USE
// ==============================================================================

export type {
  User,
  Session,
  SecurityContext,
  GeoLocation,
  TokenInfo,
  APIKey,
  LoginRequest,
  LoginResponse,
  DeviceInfo,
  RiskAssessment,
  AuthConfig,
  JWTConfig,
  SessionConfig,
  PasswordConfig,
  MFAConfig,
  RateLimitConfig,
  SecurityConfig,
  AuditEvent,
  RateLimit,
};

export {
  AuthStatus,
  TokenType,
  RiskLevel,
  AnomalyFlag,
  AuthEvent,
  CredentialsSchema,
  PasswordStrengthSchema,
  MFATokenSchema,
  MFASetupSchema,
  TypeValidators,
};
