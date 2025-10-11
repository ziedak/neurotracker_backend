/**
 * Better-Auth Authentication Models
 *
 * This module exports TypeScript interfaces and types for Better-Auth
 * authentication system, including Account (OAuth) and Verification models.
 *
 * @module models/auth
 */

import type { User, UserSession } from "./user";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

/**
 * Account Model - OAuth Provider Accounts & Token Vault
 *
 * Stores OAuth provider account data for social login integrations.
 * Links user accounts from various external providers (Google, GitHub, Keycloak, etc.)
 * NOW ALSO serves as the centralized token vault for secure token storage.
 */
export interface Account {
  /** Unique account identifier */
  id: string;

  /** Provider-specific account ID */
  accountId: string;

  /** Provider name (google, github, keycloak, etc.) */
  providerId: string;

  /** User ID this account belongs to */
  userId: string;

  /** OAuth access token (AES-256-GCM encrypted) - Single Source of Truth */
  accessToken?: string | null;

  /** OAuth refresh token (AES-256-GCM encrypted) - Single Source of Truth */
  refreshToken?: string | null;

  /** OAuth ID token (AES-256-GCM encrypted) - Single Source of Truth */
  idToken?: string | null;

  /** Access token expiration timestamp */
  accessTokenExpiresAt?: Date | null;

  /** Refresh token expiration timestamp */
  refreshTokenExpiresAt?: Date | null;

  /** OAuth scopes granted */
  scope?: string | null;

  /** Token type (usually "Bearer") - NEW */
  tokenType?: string | null;

  /** Password hash (for email/password provider) */
  password?: string | null;

  /** Account creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Last token refresh timestamp - NEW for monitoring */
  lastTokenRefresh?: Date | null;

  /** User relation */
  user?: User;

  /** Sessions using this account's tokens - NEW for vault pattern */
  sessions?: UserSession[];
}

/**
 * Verification Model - Email Verification & Password Reset Tokens
 *
 * Stores temporary verification tokens for:
 * - Email verification
 * - Password reset flows
 * - Account activation
 */
export interface Verification {
  /** Unique verification identifier */
  id: string;

  /** Identifier (email or other) being verified */
  identifier: string;

  /** Verification token value */
  value: string;

  /** Token expiration timestamp */
  expiresAt: Date;

  /** Token creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

// ============================================================================
// Input Types for Create/Update Operations
// ============================================================================

/**
 * Account creation input type
 */
export type AccountCreateInput = Omit<
  Prisma.AccountCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

/**
 * Account update input type
 */
export type AccountUpdateInput = Prisma.AccountUpdateInput;

/**
 * Verification creation input type
 */
export type VerificationCreateInput = Omit<
  Prisma.VerificationCreateInput,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

/**
 * Verification update input type
 */
export type VerificationUpdateInput = Prisma.VerificationUpdateInput;

// ============================================================================
// Filter Types for Queries
// ============================================================================

/**
 * Account filter options
 */
export interface AccountFilters {
  providerId?: string;
  userId?: string;
  hasAccessToken?: boolean;
  hasRefreshToken?: boolean;
  accessTokenExpired?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
}

/**
 * Verification filter options
 */
export interface VerificationFilters {
  identifier?: string;
  expired?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

/**
 * Account creation validation schema
 */
export const AccountCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  accountId: z.string().min(1).max(255),
  providerId: z.string().min(1).max(255),
  userId: z.string().uuid(),
  accessToken: z.string().nullable().optional(),
  refreshToken: z.string().nullable().optional(),
  idToken: z.string().nullable().optional(),
  accessTokenExpiresAt: z.date().nullable().optional(),
  refreshTokenExpiresAt: z.date().nullable().optional(),
  scope: z.string().nullable().optional(),
  tokenType: z.string().max(50).nullable().optional(), // NEW
  password: z.string().min(8).max(255).nullable().optional(),
  lastTokenRefresh: z.date().nullable().optional(), // NEW
});

/**
 * Account update validation schema
 */
export const AccountUpdateInputSchema = z.object({
  accountId: z.string().min(1).max(255).optional(),
  providerId: z.string().min(1).max(255).optional(),
  userId: z.string().uuid().optional(),
  accessToken: z.string().nullable().optional(),
  refreshToken: z.string().nullable().optional(),
  idToken: z.string().nullable().optional(),
  accessTokenExpiresAt: z.date().nullable().optional(),
  refreshTokenExpiresAt: z.date().nullable().optional(),
  scope: z.string().nullable().optional(),
  tokenType: z.string().max(50).nullable().optional(), // NEW
  password: z.string().min(8).max(255).nullable().optional(),
  lastTokenRefresh: z.date().nullable().optional(), // NEW
});

/**
 * Verification creation validation schema
 */
export const VerificationCreateInputSchema = z.object({
  id: z.string().uuid().optional(),
  identifier: z.string().email().or(z.string().min(1).max(255)),
  value: z.string().min(1).max(255),
  expiresAt: z.date(),
});

/**
 * Verification update validation schema
 */
export const VerificationUpdateInputSchema = z.object({
  identifier: z.string().email().or(z.string().min(1).max(255)).optional(),
  value: z.string().min(1).max(255).optional(),
  expiresAt: z.date().optional(),
});

/**
 * Helper type: Account with relations
 */
export type AccountWithUser = Account & {
  user: User;
};

/**
 * Helper type: Account without sensitive data
 */
export type AccountPublic = Omit<
  Account,
  "accessToken" | "refreshToken" | "idToken" | "password"
>;
