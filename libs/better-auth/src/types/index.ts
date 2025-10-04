/**
 * Type definitions for Better-Auth library
 *
 * Comprehensive type system for authentication, authorization,
 * and user management aligned with production database models.
 */

import type { ApiKey, User, Store } from "@libs/database";

import type {
  User as DatabaseUser,
  UserSession as DatabaseSession,
  Role,
  RolePermission,
  ApiKey as DatabaseApiKey,
  UserStatus,
} from "@libs/database";

// ============================================================================
// Core Authentication Types
// ============================================================================

/**
 * Authenticated user with role and permissions
 * Used throughout the application for access control
 */
export interface AuthenticatedUser
  extends Pick<
    DatabaseUser,
    | "id"
    | "email"
    | "username"
    | "firstName"
    | "lastName"
    | "status"
    | "emailVerified"
    | "roleId"
    | "organizationId"
    | "metadata"
  > {
  role?: Role;
  permissions?: RolePermission[];
}

/**
 * Session data with metadata
 */
export interface SessionData
  extends Pick<
    DatabaseSession,
    "id" | "userId" | "expiresAt" | "ipAddress" | "userAgent" | "metadata"
  > {
  user: AuthenticatedUser;
  token: string;
}

/**
 * API Key data structure (aligned with @libs/database ApiKey model)
 */
export interface ApiKeyData
  extends Pick<
    ApiKey,
    | "id"
    | "keyIdentifier"
    | "userId"
    | "expiresAt"
    | "lastUsedAt"
    | "scopes"
    | "permissions"
    | "metadata"
  > {
  /** Name/label for the API key */
  name: string;

  /** User associated with the API key */
  user?: Pick<User, "id" | "email" | "firstName" | "lastName">;

  /** Store associated with the API key (if applicable) */
  store?: Pick<Store, "id"> | null;
}

// ============================================================================
// Authentication Method Types
// ============================================================================

/**
 * Supported authentication methods
 */
export type AuthMethod =
  | "email-password"
  | "bearer-token"
  | "jwt"
  | "api-key"
  | "session";

/**
 * Authentication result returned by all auth methods
 */
export interface AuthResult {
  success: boolean;
  user?: AuthenticatedUser;
  session?: SessionData;
  error?: AuthError;
  metadata?: Record<string, unknown>;
}

/**
 * JWT token payload
 */
export interface JWTPayload {
  sub: string; // user ID
  email: string;
  username?: string;
  roleId?: string;
  organizationId?: string;
  permissions?: string[];
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
  jti?: string;
}

/**
 * Bearer token data
 */
export interface BearerToken {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: "Bearer";
  scope?: string[];
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Better-Auth core configuration
 */
export interface BetterAuthConfig {
  /** Application name */
  appName: string;

  /** Base URL for authentication endpoints */
  baseURL: string;

  /** Secret key for encryption (min 32 characters) */
  secret: string;

  /** Database adapter configuration */
  database: DatabaseConfig;

  /** Email and password authentication */
  emailAndPassword?: EmailPasswordConfig;

  /** Session configuration */
  session?: SessionConfig;

  /** Trust proxy headers */
  trustProxy?: boolean;

  /** Advanced options */
  advanced?: AdvancedConfig;

  /** Plugin configurations */
  plugins?: BetterAuthPlugin[];
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  adapter: "prisma" | "drizzle" | "mongodb";
  client: unknown; // Prisma client, Drizzle instance, or MongoDB client
  provider: "postgresql" | "mysql" | "sqlite" | "mongodb";
}

/**
 * Email and password configuration
 */
export interface EmailPasswordConfig {
  /** Enable email/password authentication */
  enabled: boolean;

  /** Minimum password length */
  minPasswordLength?: number;

  /** Require email verification */
  requireEmailVerification?: boolean;

  /** Send verification email function */
  sendVerificationEmail?: (params: {
    user: AuthenticatedUser;
    url: string;
    token: string;
  }) => Promise<void>;

  /** Password reset configuration */
  passwordReset?: {
    /** Send reset email function */
    sendResetEmail?: (params: {
      user: AuthenticatedUser;
      url: string;
      token: string;
    }) => Promise<void>;

    /** Reset token expiration (ms) */
    expiresIn?: number;
  };
}

/**
 * Session configuration
 */
export interface SessionConfig {
  /** Session expiration time (ms) */
  expiresIn?: number;

  /** Update session on access */
  updateAge?: boolean;

  /** Cookie options */
  cookie?: {
    name?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "strict" | "lax" | "none";
    domain?: string;
    path?: string;
  };
}

/**
 * Advanced configuration options
 */
export interface AdvancedConfig {
  /** Enable debug logging */
  debug?: boolean;

  /** Generate OpenAPI schema */
  generateOpenAPI?: boolean;

  /** Use secure headers */
  useSecureHeaders?: boolean;

  /** CORS origins */
  corsOrigins?: string[];

  /** Rate limiting (use @libs/ratelimit) */
  rateLimit?: {
    enabled: boolean;
  };
}

/**
 * Better-Auth plugin interface
 */
export interface BetterAuthPlugin {
  id: string;
  name: string;
  version?: string;
  schema?: Record<string, unknown>;
  hooks?: PluginHooks;
  endpoints?: PluginEndpoint[];
}

/**
 * Plugin lifecycle hooks
 */
export interface PluginHooks {
  beforeInit?: () => Promise<void> | void;
  afterInit?: () => Promise<void> | void;
  beforeRequest?: (context: RequestContext) => Promise<void> | void;
  afterRequest?: (context: RequestContext) => Promise<void> | void;
}

/**
 * Plugin endpoint definition
 */
export interface PluginEndpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  handler: (context: RequestContext) => Promise<unknown>;
}

// ============================================================================
// Request Context Types
// ============================================================================

/**
 * Request context with authentication data
 */
export interface RequestContext {
  /** Request ID for tracing */
  requestId: string;

  /** HTTP method */
  method: string;

  /** Request path */
  path: string;

  /** Request headers */
  headers: Record<string, string>;

  /** Request body */
  body?: unknown;

  /** Query parameters */
  query?: Record<string, string>;

  /** IP address */
  ipAddress?: string;

  /** User agent */
  userAgent?: string;

  /** Authenticated user (if authenticated) */
  user?: AuthenticatedUser;

  /** Session data (if session-based) */
  session?: SessionData;

  /** API key data (if API key-based) */
  apiKey?: ApiKeyData;

  /** Request timestamp */
  timestamp: Date;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Authentication error codes
 */
export enum AuthErrorCode {
  INVALID_CREDENTIALS = "AUTH_001",
  SESSION_EXPIRED = "AUTH_002",
  INSUFFICIENT_PERMISSIONS = "AUTH_003",
  INVALID_TOKEN = "AUTH_004",
  RATE_LIMIT_EXCEEDED = "AUTH_005",
  ORGANIZATION_ACCESS_DENIED = "AUTH_006",
  INVALID_REQUEST = "AUTH_007",
  RESOURCE_CONFLICT = "AUTH_008",
  RESOURCE_NOT_FOUND = "AUTH_009",
  INTERNAL_ERROR = "AUTH_010",
}

/**
 * Authentication error
 */
export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string,
    public statusCode: number = 401,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AuthError";
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Async result type for operations
 */
export type AsyncResult<T, E = AuthError> = Promise<
  { success: true; data: T } | { success: false; error: E }
>;

/**
 * Pagination options
 */
export interface PaginationOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

// ============================================================================
// Export all types
// ============================================================================

export type {
  DatabaseUser,
  DatabaseSession,
  DatabaseApiKey,
  Role,
  RolePermission,
  UserStatus,
};
