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

/**
 * Session creation options with smart defaults for required DB fields
 */
export interface SessionCreationOptions {
  userId: string;
  sessionId: string;

  // Keycloak-specific
  keycloakSessionId?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  tokenExpiresAt?: Date;
  refreshExpiresAt?: Date;

  // Store-specific (optional - will use default if not provided)
  storeId?: string;
  token?: string; // Session token (will generate if not provided)

  // Common fields
  fingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt?: Date;
  metadata?: unknown;
}

/**
 * Default values for required DB fields
 */
export const DEFAULT_STORE_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Generate a unique session token
 * Format: keycloak_<timestamp>_<random>
 */
function generateSessionToken(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `keycloak_${timestamp}_${random}`;
}

/**
 * Converts SessionCreationOptions to UserSessionCreateInput
 * Handles smart defaults for required DB fields
 * Uses Prisma's relation syntax for foreign keys
 */
export function toUserSessionCreateInput(
  options: SessionCreationOptions
): import("@libs/database").UserSessionCreateInput {
  const storeId = options.storeId || DEFAULT_STORE_ID;
  const token = options.token || generateSessionToken();

  const input: import("@libs/database").UserSessionCreateInput = {
    // Use Prisma relation syntax for foreign keys
    user: { connect: { id: options.userId } },
    store: { connect: { id: storeId } },
    sessionId: options.sessionId,
    token,
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
 * Check if session uses default store
 */
export function isDefaultStore(storeId: string): boolean {
  return storeId === DEFAULT_STORE_ID;
}

/**
 * Check if session is a Keycloak session (vs other types)
 */
export function isKeycloakSession(token: string): boolean {
  return token.startsWith("keycloak_");
}

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

// UserSession validation schema (aligned with DB model)
export const UserSessionSchema = z.object({
  id: z.string().uuid(),
  userId: UserIdSchema,
  storeId: z.string().uuid(),
  sessionId: SessionIdSchema,
  token: z.string().min(1),
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
