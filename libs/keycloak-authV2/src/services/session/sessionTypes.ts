/**
 * Shared types and interfaces for Session management components
 *
 * This module provides the foundation types used across all session management
 * components, ensuring type safety and consistency throughout the system.
 */

import { z } from "zod";
import type { UserInfo } from "../../types";
import type { KeycloakTokenResponse } from "../../client/KeycloakClient";

/**
 * Zod validation schemas for runtime type checking
 */

// User ID validation schema
export const UserIdSchema = z.string().uuid("User ID must be a valid UUID");

// Session ID validation schema
export const SessionIdSchema = z
  .string()
  .min(1, "Session ID cannot be empty")
  .max(255, "Session ID too long");

// Token validation schema
export const TokenSchema = z.string().min(10, "Token too short");

// Keycloak session data validation schema
export const KeycloakSessionDataSchema = z.object({
  id: SessionIdSchema,
  userId: UserIdSchema,
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
});

/**
 * Core session data interface
 */
export interface KeycloakSessionData {
  readonly id: string;
  readonly userId: string;
  readonly userInfo: UserInfo;
  readonly keycloakSessionId?: string | undefined;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  readonly idToken?: string | undefined;
  tokenExpiresAt?: Date | undefined;
  readonly refreshExpiresAt?: Date | undefined;
  readonly createdAt: Date;
  readonly lastAccessedAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly isActive: boolean;
  readonly fingerprint: string;
  readonly metadata?: Record<string, any> | undefined;
}

/**
 * Token validation result interface
 */
export interface TokenValidationResult {
  readonly isValid: boolean;
  readonly reason?: string;
  readonly shouldRefresh: boolean;
  readonly expiresAt?: Date;
  readonly payload?: {
    userId: string;
    username?: string;
    email?: string;
    roles: string[];
    scopes: string[];
  };
}

/**
 * Session validation result interface
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
 * Authentication result interface
 */
export interface AuthResult {
  readonly success: boolean;
  readonly sessionId?: string | undefined;
  readonly reason?: string | undefined;
  readonly expiresAt?: Date | undefined;
  readonly userInfo?: UserInfo | undefined;
}

/**
 * Session statistics interface (readonly for external use)
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
 * Mutable session statistics interface (for internal component use)
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
 * Security check result interface
 */
export interface SecurityCheckResult {
  readonly isValid: boolean;
  readonly reason?: string;
  readonly message?: string;
  readonly shouldTerminate: boolean;
}

/**
 * Health check result interface
 */
export interface HealthCheckResult {
  readonly status: "healthy" | "degraded" | "unhealthy";
  readonly details: Record<string, any>;
}

/**
 * Session fingerprint interface
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
 * Session creation options interface
 */
export interface SessionCreationOptions {
  readonly userId: string;
  readonly tokens: KeycloakTokenResponse;
  readonly requestContext: {
    readonly ipAddress: string;
    readonly userAgent: string;
    readonly fingerprint?: Record<string, string>;
  };
}

/**
 * Session cleanup result interface
 */
export interface SessionCleanupResult {
  readonly operation: string;
  readonly recordsDeleted: number;
  readonly duration: number;
  readonly success: boolean;
}

/**
 * Type guards for runtime type checking
 */

/**
 * Type guard to check if object is KeycloakSessionData
 */
export function isKeycloakSessionData(obj: any): obj is KeycloakSessionData {
  try {
    KeycloakSessionDataSchema.parse(obj);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type guard to check if object is valid session validation result
 */
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

/**
 * Type guard to check if object is valid auth result
 */
export function isAuthResult(obj: any): obj is AuthResult {
  return (
    typeof obj === "object" && obj !== null && typeof obj.success === "boolean"
  );
}

/**
 * Type guard to check if object is valid security check result
 */
export function isSecurityCheckResult(obj: any): obj is SecurityCheckResult {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof obj.isValid === "boolean" &&
    typeof obj.shouldTerminate === "boolean"
  );
}
