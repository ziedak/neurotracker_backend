/**
 * Authentication Types for Modern Oslo-based Auth System
 *
 * Provides comprehensive type definitions for session management,
 * user authentication, and security features.
 */

import type { User, UserSession, Role } from "@libs/database";

/**
 * Session creation options
 */
export interface SessionCreateOptions {
  readonly userId: string;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly expiresInHours?: number | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

/**
 * Session validation result
 */
export interface SessionValidationResult {
  readonly session: UserSession | null;
  readonly user: User | null;
  readonly isValid: boolean;
  readonly reason?: SessionInvalidReason;
}

/**
 * Reasons for session invalidation
 */
export enum SessionInvalidReason {
  NOT_FOUND = "not_found",
  EXPIRED = "expired",
  INACTIVE = "inactive",
  USER_DELETED = "user_deleted",
  USER_BANNED = "user_banned",
  IP_MISMATCH = "ip_mismatch",
  INVALID_TOKEN = "invalid_token",
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  readonly sessionExpiresInHours: number;
  readonly cleanupIntervalMinutes: number;
  readonly maxSessionsPerUser: number;
  readonly strictIpCheck: boolean;
  readonly jwtSecret: string;
  readonly cookieOptions: CookieOptions;
  readonly rateLimiting: RateLimitConfig;
}

/**
 * Cookie configuration for session tokens
 */
export interface CookieOptions {
  readonly name: string;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "strict" | "lax" | "none";
  readonly maxAge: number;
  readonly path: string;
  readonly domain?: string;
}

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  readonly maxAttempts: number;
  readonly windowMinutes: number;
  readonly blockDurationMinutes: number;
}

/**
 * User authentication payload
 */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly username: string;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly status: string;
  readonly role?: Role | undefined;
  readonly storeId?: string | undefined;
  readonly emailVerified: boolean;
  readonly lastLoginAt?: Date | undefined;
}

/**
 * Session token payload (for JWT)
 */
export interface SessionTokenPayload {
  readonly sessionId: string;
  readonly userId: string;
  readonly iat: number;
  readonly exp: number;
}

/**
 * Authentication context for middleware
 */
export interface AuthContext {
  readonly user: AuthUser | null;
  readonly session: UserSession | null;
  readonly isAuthenticated: boolean;
  readonly token?: string;
}

/**
 * Login credentials
 */
export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
  readonly rememberMe?: boolean;
}

/**
 * Password validation requirements
 */
export interface PasswordRequirements {
  readonly minLength: number;
  readonly requireUppercase: boolean;
  readonly requireLowercase: boolean;
  readonly requireNumbers: boolean;
  readonly requireSpecialChars: boolean;
}

/**
 * Authentication events for audit logging
 */
export enum AuthEvent {
  LOGIN_SUCCESS = "login_success",
  LOGIN_FAILED = "login_failed",
  LOGOUT = "logout",
  SESSION_CREATED = "session_created",
  SESSION_EXPIRED = "session_expired",
  SESSION_REVOKED = "session_revoked",
  PASSWORD_CHANGED = "password_changed",
  RATE_LIMITED = "rate_limited",
  IP_BLOCKED = "ip_blocked",
}

/**
 * Audit log entry for authentication events
 */
export interface AuthAuditEntry {
  readonly event: AuthEvent;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly timestamp: Date;
  readonly metadata?: Record<string, unknown>;
  readonly success: boolean;
  readonly errorReason?: string;
}

/**
 * RBAC permission check result
 */
export interface PermissionCheckResult {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly requiredRole?: string;
  readonly userRole?: string;
}

/**
 * Security headers configuration
 */
export interface SecurityHeaders {
  readonly contentSecurityPolicy?: string;
  readonly strictTransportSecurity?: string;
  readonly xFrameOptions?: string;
  readonly xContentTypeOptions?: string;
  readonly referrerPolicy?: string;
}

/**
 * Multi-factor authentication support
 */
export interface MFAConfig {
  readonly enabled: boolean;
  readonly issuer: string;
  readonly windowSize: number;
  readonly gracePeriodMinutes: number;
}
