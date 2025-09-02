/**
 * Core authentication types and interfaces for AuthV2 library
 * Provides type definitions for users, tokens, permissions, and authentication methods
 */

export enum AuthMethod {
  JWT = "jwt",
  BASIC = "basic",
  API_KEY = "api_key",
  KEYCLOAK = "keycloak",
}

export enum AuthProvider {
  LOCAL = "local",
  KEYCLOAK = "keycloak",
  LDAP = "ldap",
  OAUTH2 = "oauth2",
}

export interface IAuthUser {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  permissions: string[];
  provider: AuthProvider;
  providerId?: string;
  isActive: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
  password?: string; // For local authentication
}

export interface IAuthToken {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: Date;
  scope?: string;
  userId: string;
  clientId?: string;
  issuedAt: Date;
}

export interface IAuthConfig {
  // Keycloak Configuration
  keycloak: {
    url: string;
    realm: string;
    clientId: string;
    clientSecret?: string;
    publicKey?: string;
  };

  // JWT Configuration
  jwt: {
    secret: string;
    issuer: string;
    audience: string;
    expiresIn: string;
    refreshExpiresIn: string;
    algorithm: string;
  };

  // Session Configuration
  session: {
    secret: string;
    maxAge: number;
    secure: boolean;
    httpOnly: boolean;
    sameSite: "strict" | "lax" | "none";
  };

  // API Key Configuration
  apiKey: {
    headerName: string;
    prefix?: string;
    hashRounds: number;
  };

  // Rate Limiting
  rateLimit: {
    windowMs: number;
    maxAttempts: number;
    blockDuration: number;
  };

  // Redis Configuration (optional)
  redis?: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix: string;
  };
}

export interface IPermission {
  id: string;
  name: string;
  description?: string;
  resource: string;
  action: string;
  scope?: string;
  conditions?: Record<string, any>;
}

export interface IRole {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  parentRole?: string;
  isSystemRole: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAuthRequest {
  method: AuthMethod;
  credentials: Record<string, any>;
  headers: Record<string, string>;
  ip?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

export interface IAuthResponse {
  success: boolean;
  user?: IAuthUser;
  token?: IAuthToken;
  error?: IAuthError;
  metadata?: Record<string, any>;
}

export interface IAuthError {
  code: string;
  message: string;
  statusCode: number;
  details?: Record<string, any>;
}

export interface ISession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  lastActivity: Date;
  ipAddress?: string;
  userAgent?: string;
  isActive: boolean;
  metadata?: Record<string, any>;
}

export interface IApiKey {
  id: string;
  key: string;
  hashedKey: string;
  name: string;
  description?: string;
  userId: string;
  permissions: string[];
  expiresAt?: Date;
  lastUsed?: Date;
  usageCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAuthContext {
  user: IAuthUser;
  token: IAuthToken;
  session?: ISession;
  permissions: string[];
  roles: string[];
  metadata?: Record<string, any>;
}

export interface IAuthMiddlewareOptions {
  methods?: AuthMethod[];
  requiredPermissions?: string[];
  requiredRoles?: string[];
  optionalAuth?: boolean;
  skipPaths?: string[];
  rateLimit?: boolean;
}

export interface IElysiaAuthContext {
  user: IAuthUser;
  token: IAuthToken;
  session?: ISession;
  permissions: string[];
  roles: string[];
  metadata?: Record<string, any>;
}

// ElysiaJS-specific types
export interface IElysiaAuthPlugin {
  name: string;
  config: IAuthConfig;
  authenticate: (request: any) => Promise<IAuthResponse>;
  authorize: (context: IElysiaAuthContext, permissions: string[]) => boolean;
  getUser: (token: string) => Promise<IAuthUser | null>;
  refreshToken: (refreshToken: string) => Promise<IAuthToken | null>;
}

export interface IElysiaWebSocketAuth {
  connectionId: string;
  user: IAuthUser;
  token: IAuthToken;
  permissions: string[];
  roles: string[];
  subscribedChannels: string[];
  heartbeatInterval?: number;
  authenticate: (data: any) => Promise<boolean>;
  authorize: (channel: string, action: string) => boolean;
}

// Error Codes
export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID: "TOKEN_INVALID",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  USER_INACTIVE: "USER_INACTIVE",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  API_KEY_INVALID: "API_KEY_INVALID",
  KEYCLOAK_ERROR: "KEYCLOAK_ERROR",
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

// Utility Types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type AuthResult<T = any> =
  | { success: true; data: T }
  | { success: false; error: IAuthError };

// Export error classes
export * from "./errors.js";
