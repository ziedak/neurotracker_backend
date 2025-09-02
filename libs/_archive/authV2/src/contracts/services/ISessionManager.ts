import {
  IAuthenticationContext,
  SessionId,
  JWTToken,
  EntityId,
} from "../../types/core";

import { IEnhancedUser, IEnhancedSession } from "../../types/enhanced";

/**
 * Session creation options
 */
export interface ISessionCreationOptions {
  readonly user: IEnhancedUser;
  readonly context?: IAuthenticationContext;
  readonly expirationTime?: number;
  readonly permissions?: ReadonlyArray<string>;
  readonly metadata?: Record<string, unknown>;
  readonly rememberMe?: boolean;
}

/**
 * Session validation result
 */
export interface ISessionValidationResult {
  readonly isValid: boolean;
  readonly session?: IEnhancedSession;
  readonly user?: IEnhancedUser;
  readonly reason?: string;
  readonly needsRefresh?: boolean;
}

/**
 * Session statistics interface
 */
export interface ISessionStatistics {
  readonly totalActiveSessions: number;
  readonly userActiveSessions: number;
  readonly averageSessionDuration: number;
  readonly sessionsCreatedToday: number;
  readonly sessionsExpiredToday: number;
}

/**
 * Session manager service interface
 * Handles session lifecycle, encryption, caching, and security
 * Following Single Responsibility Principle - focused on session management only
 */
export interface ISessionManager {
  /**
   * Create a new authenticated session
   */
  createSession(options: ISessionCreationOptions): Promise<IEnhancedSession>;

  /**
   * Validate an existing session
   */
  validateSession(sessionId: SessionId): Promise<ISessionValidationResult>;

  /**
   * Refresh a session extending its expiration
   */
  refreshSession(
    sessionId: SessionId,
    extendBy?: number
  ): Promise<IEnhancedSession>;

  /**
   * Destroy a specific session
   */
  destroySession(sessionId: SessionId): Promise<boolean>;

  /**
   * Destroy all sessions for a user
   */
  destroyUserSessions(userId: EntityId): Promise<number>;

  /**
   * Get active sessions for a user
   */
  getUserSessions(userId: EntityId): Promise<ReadonlyArray<IEnhancedSession>>;

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): Promise<number>;

  /**
   * Check if session is cached
   */
  isCached(sessionId: SessionId): Promise<boolean>;

  /**
   * Cache authentication result for session
   */
  cacheAuthResult(
    sessionId: SessionId,
    result: {
      readonly user: IEnhancedUser;
      readonly permissions: ReadonlyArray<string>;
      readonly token?: JWTToken;
    },
    ttl?: number
  ): Promise<void>;

  /**
   * Get cached authentication result
   */
  getCachedAuthResult(sessionId: SessionId): Promise<{
    readonly user: IEnhancedUser;
    readonly permissions: ReadonlyArray<string>;
    readonly token?: JWTToken;
  } | null>;

  /**
   * Get session statistics
   */
  getSessionStatistics(userId?: EntityId): Promise<ISessionStatistics>;

  /**
   * Check for concurrent session limit violations
   */
  checkConcurrentSessionLimit(
    userId: EntityId,
    maxSessions: number
  ): Promise<boolean>;

  /**
   * Update session metadata
   */
  updateSessionMetadata(
    sessionId: SessionId,
    metadata: Record<string, unknown>
  ): Promise<boolean>;
}
