/**
 * @fileoverview Core authentication types and interfaces
 * @module types/core
 * @version 1.0.0
 * @author Enterprise Development Team
 */

// PHASE 1: Database model types aligned with actual Prisma schema
// These interfaces now match the database schema exactly

/**
 * User status enumeration matching Prisma schema
 */
export enum UserStatus {
  ACTIVE = "ACTIVE",
  BANNED = "BANNED",
  INACTIVE = "INACTIVE",
  DELETED = "DELETED",
}

/**
 * User model matching actual Prisma schema exactly
 * Fixed: Added missing enterprise fields for multi-tenant architecture
 */
export interface User {
  // Core user fields
  id: string;
  email: string;
  password: string;
  username: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  lastLoginAt?: Date | null;
  loginCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  isDeleted: boolean;
  metadata?: Record<string, unknown> | null;

  // ENTERPRISE FIELDS - Previously missing from AuthV2
  // Multi-tenant architecture support
  roleId?: string | null; // Single role architecture (Phase 3A)
  storeId?: string | null; // Multi-tenant store context
  organizationId?: string | null; // Organization hierarchy

  // Role management audit trail
  roleAssignedAt?: Date | null; // When current role was assigned
  roleRevokedAt?: Date | null; // When role was revoked (null = active)
  roleAssignedBy?: string | null; // User ID who assigned the role
  roleRevokedBy?: string | null; // User ID who revoked the role
  roleExpiresAt?: Date | null; // Optional role expiration

  // Enterprise audit fields for compliance
  createdBy?: string | null; // User who created this record
  updatedBy?: string | null; // User who last updated this record
  auditLog?: Record<string, unknown> | null; // Audit trail JSON
}

/**
 * Temporary UserSession model for Phase 1 (will use @libs/models in Phase 2)
 */
export interface UserSession {
  id: string;
  userId: string;
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  isActive: boolean;
  endedAt?: Date | null;
}

/**
 * Role model matching actual Prisma schema with enterprise hierarchy
 * Fixed: Added missing hierarchy and enterprise fields
 */
export interface Role {
  // Core role fields
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  category: string;
  level: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown> | null;

  // ENTERPRISE HIERARCHY FIELDS - Previously missing from AuthV2
  version: string; // Role version for change management
  parentRoleIds: string[]; // Array of parent role IDs for inheritance
  childRoleIds: string[]; // Array of child role IDs for delegation
}

/**
 * RolePermission model matching actual Prisma schema exactly
 * Fixed: Added missing enterprise fields for conditional permissions
 */
export interface RolePermission {
  // Core permission fields
  id: string;
  roleId: string;
  resource: string;
  action: string;
  name: string;
  description?: string | null;
  conditions?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;

  // ENTERPRISE PERMISSION FIELDS - Previously missing from AuthV2
  priority: string; // Permission priority (high/medium/low)
  version: string; // Permission version for change management
}

/**
 * Store status enumeration matching Prisma schema
 */
export enum StoreStatus {
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  DELETED = "DELETED",
}

/**
 * Store model matching actual Prisma schema - MISSING from AuthV2
 * Required for multi-tenant architecture support
 */
export interface Store {
  id: string;
  name: string;
  url: string;
  ownerId: string;
  status: StoreStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  isDeleted: boolean;
}

/**
 * Tenant context for multi-tenant operations - MISSING from AuthV2
 * Required for proper data isolation and security
 */
export interface TenantContext {
  userId: string;
  storeId?: string | null;
  organizationId?: string | null;
  roleId?: string | null;
  permissions: ReadonlyArray<string>;
  roles: ReadonlyArray<string>;
}

/**
 * Unique identifier type with strict validation
 */
export type EntityId = string & { readonly __brand: "EntityId" };

/**
 * ISO timestamp type for consistent time handling
 */
export type Timestamp = string & { readonly __brand: "Timestamp" };

/**
 * Secure hash type for password and token storage
 */
export type SecureHash = string & { readonly __brand: "SecureHash" };

/**
 * JWT token type with validation branding
 */
export type JWTToken = string & { readonly __brand: "JWTToken" };

/**
 * API key type with secure branding
 */
export type APIKey = string & { readonly __brand: "APIKey" };

/**
 * Session identifier type
 */
export type SessionId = string & { readonly __brand: "SessionId" };

/**
 * Re-export database models with consistent naming
 * Fixed: Corrected permission model naming and added missing types
 */
export type IUser = User;
export type ISession = UserSession;
export type IRole = Role;
export type IRolePermission = RolePermission; // Fixed: Was incorrectly named IPermission
export type IStore = Store; // Added: Missing multi-tenant type
export type ITenantContext = TenantContext; // Added: Missing tenant context type

// Legacy alias for backward compatibility (will be deprecated)
export type IPermission = RolePermission;

/**
 * Authentication service specific types below
 */

/**
 * Authentication result with comprehensive information
 */
export interface IAuthenticationResult {
  readonly success: boolean;
  readonly user: IUser | null;
  readonly session: ISession | null;
  readonly accessToken: JWTToken | null;
  readonly refreshToken: JWTToken | null;
  readonly expiresAt: Timestamp | null;
  readonly permissions: ReadonlyArray<string>;
  readonly roles: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Authentication context for request processing
 */
export interface IAuthenticationContext {
  readonly user: IUser;
  readonly session: ISession | null;
  readonly permissions: ReadonlyArray<string>;
  readonly roles: ReadonlyArray<string>;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly timestamp: Timestamp;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * JWT payload structure
 */
export interface ITokenPayload {
  readonly sub: string; // Subject (user ID)
  readonly iat: number; // Issued at
  readonly exp: number; // Expiration
  readonly aud: string; // Audience
  readonly iss: string; // Issuer
  readonly jti: string; // JWT ID
  readonly type: "access" | "refresh";
  readonly permissions: ReadonlyArray<string>;
  readonly roles: ReadonlyArray<string>;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Cache entry with TTL support
 */
export interface ICacheEntry<T = unknown> {
  readonly key: string;
  readonly value: T;
  readonly ttl: number;
  readonly createdAt: Timestamp;
  readonly expiresAt: Timestamp;
}

/**
 * Audit event for security tracking
 */
export interface IAuditEvent {
  readonly id: EntityId;
  readonly userId: EntityId | null;
  readonly sessionId: SessionId | null;
  readonly action: string;
  readonly resource: string;
  readonly outcome: "success" | "failure";
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly timestamp: Timestamp;
  readonly details: Readonly<Record<string, unknown>>;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Metrics interface for monitoring
 */
export interface IMetrics {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly timestamp: Timestamp;
  readonly labels: Readonly<Record<string, string>>;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Factory functions for creating branded types
 */
export const createEntityId = (id: string): EntityId => id as EntityId;
export const createSessionId = (id: string): SessionId => id as SessionId;
export const createTimestamp = (date: Date = new Date()): Timestamp =>
  date.toISOString() as Timestamp;
export const createJWTToken = (token: string): JWTToken => token as JWTToken;
export const createAPIKey = (key: string): APIKey => key as APIKey;
export const createSecureHash = (hash: string): SecureHash =>
  hash as SecureHash;

/**
 * Authentication constants
 */
export const AUTH_CONSTANTS = {
  DEFAULT_TOKEN_EXPIRY: 3600, // 1 hour in seconds
  REFRESH_TOKEN_EXPIRY: 604800, // 7 days in seconds
  MAX_SESSION_DURATION: 86400, // 24 hours in seconds
  PASSWORD_MIN_LENGTH: 8,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION: 300, // 5 minutes in seconds
  API_KEY_LENGTH: 32,
  SESSION_ID_LENGTH: 128,
  JWT_ISSUER: "enterprise-auth-v2",
  JWT_AUDIENCE: "enterprise-api",
} as const;

/**
 * Type guards for runtime validation
 */
export const isEntityId = (value: unknown): value is EntityId =>
  typeof value === "string" && value.length > 0;

export const isSessionId = (value: unknown): value is SessionId =>
  typeof value === "string" && value.length > 0;

export const isTimestamp = (value: unknown): value is Timestamp =>
  typeof value === "string" && !isNaN(Date.parse(value));

export const isJWTToken = (value: unknown): value is JWTToken =>
  typeof value === "string" && value.split(".").length === 3;

export const isAPIKey = (value: unknown): value is APIKey =>
  typeof value === "string" && value.length >= 16;

/**
 * Error types for the authentication system
 */
export type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "EXPIRED_TOKEN"
  | "INVALID_TOKEN"
  | "BLACKLISTED_TOKEN"
  | "ACCOUNT_LOCKED"
  | "INSUFFICIENT_PERMISSIONS"
  | "SESSION_EXPIRED"
  | "RATE_LIMITED"
  | "VALIDATION_ERROR"
  | "SERVICE_ERROR";

/**
 * Standard error response format
 */
export interface IAuthError {
  readonly code: AuthErrorCode;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly timestamp: Timestamp;
  readonly traceId: string;
}

/**
 * Authentication error interface (alias for compatibility)
 */
export type IAuthenticationError = IAuthError;
