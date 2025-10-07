/**
 * Interface definitions for Keycloak Integration Service components
 * Following Interface Segregation Principle (ISP) - focused, role-specific interfaces
 */

import type { UserInfo } from "../../types";
import type { KeycloakSessionData, SessionStats } from "../session";
import type { ApiKey } from "@libs/database";

// Core Domain Models
export interface ClientContext {
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly clientId?: string;
}

export interface AuthenticationResult {
  success: boolean;
  user?: UserInfo;
  tokens?: {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    refresh_expires_in?: number;
  };
  session?: {
    sessionId: string;
    sessionData: KeycloakSessionData;
  };
  error?: string;
  requiresMFA?: boolean;
  redirectUrl?: string;
}

export interface LogoutResult {
  success: boolean;
  loggedOut: boolean;
  sessionDestroyed: boolean;
  keycloakLogout: boolean;
  keycloakLogoutError?: string;
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  sanitized?: string;
  error?: string;
}

export interface IntegrationStats {
  session: SessionStats;
  client: {
    discoveryLoaded: boolean;
    cacheEnabled: boolean;
    requestCount: number;
  };
  token: {
    cacheHits: number;
    cacheMisses: number;
    validationCount: number;
    jwksLoaded: boolean;
  };
  apiKey?: {
    totalKeys: number;
    activeKeys: number;
    revokedKeys: number;
    expiredKeys: number;
    validationCount: number;
    cacheHitRate: number;
  };
}

// Component Interfaces (ISP Compliance)

/**
 * Interface for authentication flow management
 */
export interface IAuthenticationManager {
  authenticateWithPassword(
    username: string,
    password: string,
    clientContext: ClientContext
  ): Promise<AuthenticationResult>;

  authenticateWithCode(
    code: string,
    redirectUri: string,
    clientContext: ClientContext,
    codeVerifier?: string
  ): Promise<AuthenticationResult>;
}

/**
 * Interface for session validation and management
 */
export interface ISessionValidator {
  validateSession(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    }
  ): Promise<{
    valid: boolean;
    session?: KeycloakSessionData;
    refreshed?: boolean;
    error?: string;
  }>;

  logout(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    },
    options?: {
      logoutFromKeycloak?: boolean;
      destroyAllSessions?: boolean;
    }
  ): Promise<LogoutResult>;
}

/**
 * Interface for comprehensive session management
 * Extends ISessionValidator with additional session lifecycle operations
 */
export interface ISessionManager extends ISessionValidator {
  createSession(
    userId: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      idToken?: string;
      expiresAt: Date;
      refreshExpiresAt?: Date;
    },
    requestContext: {
      ipAddress: string;
      userAgent: string;
      fingerprint?: Record<string, string>;
    }
  ): Promise<{
    success: boolean;
    sessionId?: string;
    sessionData?: KeycloakSessionData;
    error?: string;
  }>;

  getSession(sessionId: string): Promise<{
    success: boolean;
    session?: KeycloakSessionData;
    error?: string;
  }>;

  updateSession(
    sessionId: string,
    updates: {
      lastActivity?: Date;
      metadata?: Record<string, any>;
    }
  ): Promise<{
    success: boolean;
    error?: string;
  }>;

  refreshSessionTokens(sessionId: string): Promise<{
    success: boolean;
    tokens?: {
      accessToken: string;
      refreshToken?: string;
      expiresAt: Date;
    };
    error?: string;
  }>;

  invalidateSession(sessionId: string): Promise<{
    success: boolean;
    error?: string;
  }>;

  listUserSessions(userId: string): Promise<{
    success: boolean;
    sessions?: KeycloakSessionData[];
    error?: string;
  }>;

  getSessionStats(): Promise<SessionStats>;
}

/**
 * Interface for input validation and sanitization
 */
export interface IInputValidator {
  validateSessionId(sessionId: string): boolean;
  validateUsername(username: string): ValidationResult;
  validatePassword(password: string): ValidationResult;
  validateAuthCode(code: string): ValidationResult;
  validateRedirectUri(uri: string): ValidationResult;
  validateClientContext(context: any): ValidationResult;
  sanitizeAttributes(
    attributes: Record<string, string[]>
  ): Record<string, string[]>;
}

/**
 * Interface for statistics collection and caching
 */
export interface IStatisticsCollector {
  getStats(): Promise<IntegrationStats>;
  clearCache(): void;
  getResourceStats(): {
    connections: {
      keycloak: boolean;
      database: boolean;
      sessions: number;
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
    };
    uptime: number;
  };
}

/**
 * Interface for service configuration management
 */
export interface IConfigurationManager {
  createBaseConfiguration(hasMetrics: boolean): any;
  getKeycloakConnectionOptions(): KeycloakConnectionOptions;
  getCacheConfiguration(): {
    ttl: Record<string, number>;
    enabled: boolean;
  };
  getSecurityConfiguration(): {
    constantTimeComparison: boolean;
    apiKeyHashRounds: number;
    sessionRotationInterval: number;
  };
}

/**
 * Interface for API Key management operations
 */
export interface IAPIKeyManager {
  createAPIKey(options: {
    userId: string;
    name: string;
    scopes?: string[];
    permissions?: string[];
    expiresAt?: Date;
    storeId?: string;
    prefix?: string;
  }): Promise<{
    success: boolean;
    apiKey?: ApiKey;
    rawKey?: string;
    error?: string;
  }>;

  validateAPIKey(apiKey: string): Promise<{
    valid: boolean;
    keyData?: ApiKey;
    error?: string;
  }>;

  revokeAPIKey(
    keyId: string,
    reason: string
  ): Promise<{
    success: boolean;
    error?: string;
  }>;

  listAPIKeys(userId: string): Promise<{
    success: boolean;
    keys?: ApiKey[];
    error?: string;
  }>;

  getAPIKey(keyId: string): Promise<{
    success: boolean;
    key?: ApiKey;
    error?: string;
  }>;

  updateAPIKey(
    keyId: string,
    updates: {
      name?: string;
      scopes?: string[];
      permissions?: string[];
      expiresAt?: Date;
    }
  ): Promise<{
    success: boolean;
    key?: ApiKey;
    error?: string;
  }>;

  rotateAPIKey(
    keyId: string,
    options?: { expiresAt?: Date }
  ): Promise<{
    success: boolean;
    newKey?: ApiKey;
    rawKey?: string;
    error?: string;
  }>;

  deleteAPIKey(keyId: string): Promise<{
    success: boolean;
    error?: string;
  }>;

  getAPIKeyStats(): Promise<{
    totalKeys: number;
    activeKeys: number;
    revokedKeys: number;
    expiredKeys: number;
    validationCount: number;
    cacheHitRate: number;
  }>;
}

/**
 * Interface for user management operations
 */
export interface IUserManager {
  createUser(userData: {
    username: string;
    email: string;
    firstName?: string;
    lastName?: string;
    password?: string;
    enabled?: boolean;
    emailVerified?: boolean;
    attributes?: Record<string, string[]>;
  }): Promise<{
    success: boolean;
    userId?: string;
    error?: string;
  }>;

  getUser(userId: string): Promise<{
    success: boolean;
    user?: UserInfo;
    error?: string;
  }>;
}

/**
 * Batch operation result for tracking success/failures
 */
export interface BatchOperationResult<T = any> {
  success: boolean;
  successCount: number;
  failureCount: number;
  results: Array<{
    success: boolean;
    data?: T;
    error?: string;
    index: number;
  }>;
  errors?: Array<{
    index: number;
    error: string;
  }>;
}

/**
 * User attributes for custom metadata
 */
export interface UserAttributes {
  [key: string]: string | string[] | number | boolean;
}

/**
 * Advanced search filters for users
 */
export interface AdvancedUserSearchFilters {
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  attributes?: Record<string, string>;
  roleNames?: string[];
  groupNames?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  lastLoginAfter?: Date;
  lastLoginBefore?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Interface for enhanced user management operations
 */
export interface IEnhancedUserManager {
  // Batch operations
  batchRegisterUsers(
    users: Array<{
      username: string;
      email: string;
      password: string;
      firstName?: string;
      lastName?: string;
      attributes?: UserAttributes;
    }>
  ): Promise<BatchOperationResult<UserInfo>>;

  batchUpdateUsers(
    updates: Array<{
      userId: string;
      data: {
        email?: string;
        firstName?: string;
        lastName?: string;
        enabled?: boolean;
        attributes?: UserAttributes;
      };
    }>
  ): Promise<BatchOperationResult<UserInfo>>;

  batchDeleteUsers(
    userIds: string[],
    deletedBy: string
  ): Promise<BatchOperationResult<void>>;

  batchAssignRoles(
    assignments: Array<{
      userId: string;
      roleNames: string[];
    }>
  ): Promise<BatchOperationResult<void>>;

  // Attribute management
  getUserAttributes(userId: string): Promise<{
    success: boolean;
    attributes?: UserAttributes;
    error?: string;
  }>;

  setUserAttributes(
    userId: string,
    attributes: UserAttributes
  ): Promise<{
    success: boolean;
    error?: string;
  }>;

  updateUserAttributes(
    userId: string,
    attributes: Partial<UserAttributes>
  ): Promise<{
    success: boolean;
    error?: string;
  }>;

  deleteUserAttributes(
    userId: string,
    attributeKeys: string[]
  ): Promise<{
    success: boolean;
    error?: string;
  }>;

  // Advanced search
  searchUsersAdvanced(filters: AdvancedUserSearchFilters): Promise<{
    success: boolean;
    users?: UserInfo[];
    totalCount?: number;
    error?: string;
  }>;

  // User groups management
  getUserGroups(userId: string): Promise<{
    success: boolean;
    groups?: Array<{ id: string; name: string; path: string }>;
    error?: string;
  }>;

  addUserToGroups(
    userId: string,
    groupIds: string[]
  ): Promise<{
    success: boolean;
    error?: string;
  }>;

  removeUserFromGroups(
    userId: string,
    groupIds: string[]
  ): Promise<{
    success: boolean;
    error?: string;
  }>;
}

/**
 * Interface for resource management and cleanup
 */
export interface IResourceManager {
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
  getResourceStats(): {
    connections: {
      keycloak: boolean;
      database: boolean;
      sessions: number;
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
    };
    uptime: number;
  };
}

// Configuration Types
export interface KeycloakConnectionOptions {
  readonly serverUrl: string;
  readonly realm: string;
  readonly clientId: string;
  readonly clientSecret?: string;
}

/**
 * Main integration service interface
 * Provides comprehensive authentication, session, user, and API key management
 */
export interface IIntegrationService
  extends IAuthenticationManager,
    ISessionManager,
    IAPIKeyManager,
    IUserManager,
    IEnhancedUserManager,
    IResourceManager {
  getStats(): Promise<IntegrationStats>;
}
