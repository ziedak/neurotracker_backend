/**
 * Shared types and interfaces for Session management components
 *
 * This module provides the foundation types used across all session management
 * components, ensuring type safety and consistency throughout the system.
 *
 * SOURCE OF TRUTH: Database models (@libs/database)
 * All session operations use UserSession directly from Prisma schema
 */

import { z } from "zod";

// Re-export database types as primary and ONLY types
export type {
  UserSession,
  UserSessionCreateInput,
  UserSessionUpdateInput,
  SessionLog,
  SessionLogCreateInput,
  SessionLogUpdateInput,
} from "@libs/database";

// Type aliases for backward compatibility
export type KeycloakSessionData = import("@libs/database").UserSession;

/**
 * Session creation options with smart defaults for required DB fields
 */
export interface SessionCreationOptions {
  userId: string;

  // Keycloak-specific
  keycloakSessionId?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  tokenExpiresAt?: Date;
  refreshExpiresAt?: Date;

  // Common fields
  fingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt?: Date;
  metadata?: unknown;
}

/**
 * Converts SessionCreationOptions to UserSessionCreateInput
 * Handles smart defaults for required DB fields
 * Uses Prisma's relation syntax for foreign keys
 */
export function toUserSessionCreateInput(
  options: SessionCreationOptions
): import("@libs/database").UserSessionCreateInput {
  const input: import("@libs/database").UserSessionCreateInput = {
    // Use Prisma relation syntax for foreign keys
    user: { connect: { id: options.userId } },
  };

  // Add optional fields only if defined (to satisfy exactOptionalPropertyTypes)
  if (options.keycloakSessionId !== undefined) {
    input.keycloakSessionId = options.keycloakSessionId;
  }
  if (options.accessToken !== undefined) {
    input.accessToken = options.accessToken;
  }
  if (options.refreshToken !== undefined) {
    input.refreshToken = options.refreshToken;
  }
  if (options.idToken !== undefined) {
    input.idToken = options.idToken;
  }
  if (options.tokenExpiresAt !== undefined) {
    input.tokenExpiresAt = options.tokenExpiresAt;
  }
  if (options.refreshExpiresAt !== undefined) {
    input.refreshExpiresAt = options.refreshExpiresAt;
  }
  if (options.fingerprint !== undefined) {
    input.fingerprint = options.fingerprint;
  }
  if (options.expiresAt !== undefined) {
    input.expiresAt = options.expiresAt;
  }
  if (options.ipAddress !== undefined) {
    input.ipAddress = options.ipAddress;
  }
  if (options.userAgent !== undefined) {
    input.userAgent = options.userAgent;
  }
  if (options.metadata !== undefined) {
    input.metadata = options.metadata as any;
  }

  return input;
}

/**
 * Check if session is a Keycloak session (has Keycloak session ID)
 */
export function isKeycloakSession(
  session: import("@libs/database").UserSession
): boolean {
  return (
    session.keycloakSessionId !== null &&
    session.keycloakSessionId !== undefined
  );
}

/**
 * Zod validation schemas for runtime type checking
 */

// User ID validation schema (CUIDs from Prisma)
export const UserIdSchema = z.string().min(1, "User ID must not be empty");

// UserSession validation schema (aligned with DB model - CUIDs not UUIDs)
export const UserSessionSchema = z.object({
  id: z.string().min(1),
  userId: UserIdSchema,
  keycloakSessionId: z.string().nullable().optional(),
  accessToken: z.string().nullable().optional(),
  refreshToken: z.string().nullable().optional(),
  idToken: z.string().nullable().optional(),
  tokenExpiresAt: z.date().nullable().optional(),
  refreshExpiresAt: z.date().nullable().optional(),
  fingerprint: z.string().nullable().optional(),
  lastAccessedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
  expiresAt: z.date().nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  isActive: z.boolean(),
  endedAt: z.date().nullable().optional(),
});

/**
 * Session validation result interface
 */
export interface SessionValidationResult {
  readonly isValid: boolean;
  readonly reason?: string;
  readonly timestamp: Date;
  readonly shouldTerminate?: boolean;
  readonly shouldRefreshToken?: boolean;
  readonly sessionData?: import("@libs/database").UserSession;
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
 * Import and re-export standardized health check interface from common types
 */
export type { HealthCheckResult } from "../../types/common";

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
