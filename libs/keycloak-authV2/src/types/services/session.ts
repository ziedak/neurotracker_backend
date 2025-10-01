/**
 * Session service types
 *
 * Consolidated type definitions for session management services
 */

import { z } from "zod";
import type { AuthResult, UserInfo } from "../shared/auth";
import type { ValidationResult } from "../shared/validation";
import type { HealthCheckResult } from "../common";

/**
 * Core session data interface
 */
export interface KeycloakSessionData {
  readonly id: string;
  readonly userId: string;
  readonly userInfo: UserInfo;
  readonly keycloakSessionId?: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly idToken?: string;
  readonly tokenExpiresAt?: Date;
  readonly refreshExpiresAt?: Date;
  readonly createdAt: Date;
  readonly lastAccessedAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly isActive: boolean;
  readonly fingerprint: string;
  readonly metadata?: Record<string, any>;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  readonly isValid: boolean;
  readonly reason?: string;
  readonly shouldRefresh: boolean;
  readonly expiresAt?: Date;
  readonly payload?: {
    readonly userId: string;
    readonly username?: string;
    readonly email?: string;
    readonly roles: string[];
    readonly scopes: string[];
  };
}

/**
 * Session validation result
 */
export interface SessionValidationResult {
  readonly isValid: boolean;
  readonly reason?: string;
  readonly timestamp: Date;
  readonly shouldTerminate?: boolean;
  readonly shouldRefreshToken?: boolean;
  readonly sessionData?: KeycloakSessionData;
  readonly expirationTime?: Date;
  readonly sessionAge?: number;
  readonly idleTime?: number;
  readonly maxIdleTime?: number;
  readonly nextValidation?: Date;
  readonly activeSessionCount?: number;
  readonly maxAllowed?: number;
}

/**
 * Session statistics
 */
export interface SessionStats {
  readonly activeSessions: number;
  readonly totalSessions: number;
  readonly sessionsCreated: number;
  readonly sessionsExpired: number;
  readonly averageSessionDuration: number;
  readonly peakConcurrentSessions: number;
  readonly successfulLogins: number;
  readonly failedLogins: number;
  readonly tokenRefreshCount: number;
  readonly securityViolations: number;
}

/**
 * Mutable session statistics (for internal use)
 */
export interface MutableSessionStats {
  activeSessions: number;
  totalSessions: number;
  sessionsCreated: number;
  sessionsExpired: number;
  averageSessionDuration: number;
  peakConcurrentSessions: number;
  successfulLogins: number;
  failedLogins: number;
  tokenRefreshCount: number;
  securityViolations: number;
}

/**
 * Security check result
 */
export interface SecurityCheckResult {
  readonly isValid: boolean;
  readonly reason?: string;
  readonly message?: string;
  readonly shouldTerminate: boolean;
}

/**
 * Session fingerprint
 */
export interface SessionFingerprint {
  readonly userAgent: string;
  readonly acceptLanguage: string;
  readonly acceptEncoding: string;
  readonly screenResolution?: string;
  readonly timezone?: string;
  readonly platform?: string;
}

/**
 * Session creation options
 */
export interface SessionCreationOptions {
  readonly userId: string;
  readonly tokens: any; // KeycloakTokenResponse
  readonly requestContext: {
    readonly ipAddress: string;
    readonly userAgent: string;
    readonly fingerprint?: Record<string, string>;
  };
}

/**
 * Session cleanup result
 */
export interface SessionCleanupResult {
  readonly operation: string;
  readonly recordsDeleted: number;
  readonly duration: number;
  readonly success: boolean;
}

/**
 * Session configuration interfaces
 */
export interface SessionConfig {
  readonly maxIdleTime: number;
  readonly maxSessionTime: number;
  readonly enableFingerprinting: boolean;
  readonly enableSecurityChecks: boolean;
  readonly cleanupInterval: number;
  readonly extendOnActivity: boolean;
}

/**
 * Validation schemas for session types
 */
export const SessionSchemas = {
  userId: z.string().uuid("User ID must be a valid UUID"),
  sessionId: z.string().min(1, "Session ID cannot be empty").max(255),
  token: z.string().min(10, "Token too short"),

  sessionData: z.object({
    id: z.string().min(1).max(255),
    userId: z.string().uuid(),
    userInfo: z.record(z.any()),
    keycloakSessionId: z.string().optional(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    idToken: z.string().optional(),
    tokenExpiresAt: z.date().optional(),
    refreshExpiresAt: z.date().optional(),
    createdAt: z.date(),
    lastAccessedAt: z.date(),
    expiresAt: z.date(),
    ipAddress: z.string(),
    userAgent: z.string(),
    isActive: z.boolean(),
    fingerprint: z.string(),
    metadata: z.record(z.any()).optional().default({}),
  }),
};

/**
 * Type guards for runtime type checking
 */
export function isKeycloakSessionData(obj: any): obj is KeycloakSessionData {
  try {
    SessionSchemas.sessionData.parse(obj);
    return true;
  } catch {
    return false;
  }
}

export function isSessionValidationResult(
  obj: any
): obj is SessionValidationResult {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof obj.isValid === "boolean" &&
    obj.timestamp instanceof Date
  );
}

export function isAuthResult(obj: any): obj is AuthResult {
  return (
    typeof obj === "object" && obj !== null && typeof obj.success === "boolean"
  );
}

export function isSecurityCheckResult(obj: any): obj is SecurityCheckResult {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof obj.isValid === "boolean" &&
    typeof obj.shouldTerminate === "boolean"
  );
}

// Re-export commonly used types
export type { HealthCheckResult };
export type { AuthResult, UserInfo };
export type { ValidationResult };
