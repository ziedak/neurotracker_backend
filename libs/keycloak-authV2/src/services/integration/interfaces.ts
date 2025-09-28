/**
 * Interface definitions for Keycloak Integration Service components
 * Following Interface Segregation Principle (ISP) - focused, role-specific interfaces
 */

import type { UserInfo } from "../../types";
import type { KeycloakSessionData, SessionStats } from "../session";

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
 */
export interface IIntegrationService
  extends IAuthenticationManager,
    ISessionValidator,
    IUserManager,
    IResourceManager {
  getStats(): Promise<IntegrationStats>;
}
