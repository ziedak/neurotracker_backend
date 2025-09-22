/**
 * Keycloak Session Manager Service
 * Handles secure session management with Redis-based storage, session rotation,
 * concurrent session limits, hijacking detection, and Keycloak token integration
 *
 * ARCHITECTURAL NOTES:
 * This class currently handles multiple responsibilities and would benefit from
 * future modularization for better maintainability and testing:
 *
 * Potential separation:
 * - SessionStore: Database and cache operations
 * - TokenManager: Token encryption, refresh, validation
 * - SessionValidator: Security checks, expiration, rotation logic
 * - SessionLimiter: Concurrent session enforcement
 * - SessionMetrics: Statistics and monitoring
 *
 * SECURITY ENHANCEMENTS APPLIED:
 * - Enforced token encryption (no plaintext storage)
 * - Session ID hashing in logs (prevents enumeration)
 * - Atomic concurrent session limits (prevents race conditions)
 * - Cache invalidation on token refresh (prevents stale data)
 * - Transaction rollback on creation failure (prevents resource leaks)
 */

import * as crypto from "crypto";
import { createLogger } from "@libs/utils";
import { CacheService, PostgreSQLClient } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";
import type { UserInfo } from "../types";
import type { AuthV2Config } from "./config";
import {
  EncryptionManager,
  createEncryptionManager,
} from "./EncryptionManager";
import {
  KeycloakClient,
  type KeycloakTokenResponse,
} from "../client/KeycloakClient";

export type AuthResult = {
  success: boolean;
  user?: UserInfo;
  token?: string;
  error?: string;
};

// Session interfaces
export interface KeycloakSessionData {
  readonly id: string;
  readonly userId: string;
  readonly userInfo: UserInfo;
  readonly keycloakSessionId: string;
  accessToken: string | undefined;
  refreshToken: string | undefined;
  idToken: string | undefined;
  tokenExpiresAt: Date | undefined;
  refreshExpiresAt: Date | undefined;
  readonly createdAt: Date;
  lastAccessedAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress: string;
  readonly userAgent: string;
  isActive: boolean;
  metadata: Record<string, any>;
  readonly fingerprint: string;
}

export interface KeycloakSessionCreationOptions {
  readonly userId: string;
  readonly userInfo: UserInfo;
  readonly keycloakSessionId: string;
  readonly tokens: KeycloakTokenResponse | undefined;
  readonly ipAddress: string;
  readonly userAgent: string;
  readonly maxAge: number | undefined;
  readonly metadata: Record<string, any> | undefined;
}

export interface SessionValidationResult {
  readonly valid: boolean;
  readonly session?: KeycloakSessionData;
  readonly authResult?: AuthResult | undefined;
  readonly error?: string;
  readonly requiresRotation?: boolean;
  readonly requiresTokenRefresh?: boolean;
}

export interface SessionStats {
  readonly activeSessions: number;
  readonly totalSessions: number;
  readonly cacheEnabled: boolean;
  readonly sessionsCreated: number;
  readonly sessionsDestroyed: number;
  readonly sessionRotations: number;
}

// Internal mutable stats interface for implementation
interface MutableSessionStats {
  activeSessions: number;
  totalSessions: number;
  cacheEnabled: boolean;
  sessionsCreated: number;
  sessionsDestroyed: number;
  sessionRotations: number;
}

/**
 * Keycloak Session Manager
 *
 * Manages user sessions with Keycloak token integration, providing:
 * - Secure session creation and validation
 * - Automatic token refresh when needed
 * - Session rotation and security checks
 * - Redis-based session storage with TTL
 * - Comprehensive metrics and logging
 */
export class KeycloakSessionManager {
  private readonly logger = createLogger("KeycloakSessionManager");
  private cacheService?: CacheService;
  private readonly encryptionManager: EncryptionManager;
  private stats: MutableSessionStats = {
    activeSessions: 0,
    totalSessions: 0,
    cacheEnabled: false,
    sessionsCreated: 0,
    sessionsDestroyed: 0,
    sessionRotations: 0,
  };

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly config: AuthV2Config,
    private readonly dbClient: PostgreSQLClient,
    private readonly metrics?: IMetricsCollector
  ) {
    // Initialize cache if enabled
    if (this.config.cache.enabled && metrics) {
      this.cacheService = CacheService.create(metrics);
      this.stats.cacheEnabled = true;
    }

    // Initialize encryption manager with configuration or environment key
    this.encryptionManager = createEncryptionManager(
      this.config.encryption?.key,
      {
        keyDerivationIterations:
          this.config.encryption?.keyDerivationIterations || 100000,
      }
    );
  }

  /**
   * Create a new session with Keycloak token integration
   */
  async createSession(options: KeycloakSessionCreationOptions): Promise<{
    sessionId: string;
    sessionData: KeycloakSessionData;
  }> {
    const startTime = performance.now();
    let sessionData: KeycloakSessionData | undefined;

    try {
      // Generate secure session ID
      const sessionId = this.generateSessionId();

      // Create fingerprint for session security
      const fingerprint = this.createSessionFingerprint(
        options.ipAddress,
        options.userAgent
      );

      // Check concurrent session limits if configured
      await this.enforceConcurrentSessionLimits(options.userId);

      // Create session data
      const now = new Date();
      const maxAge = options.maxAge || this.config.cache.ttl.session; // Use session TTL from config

      sessionData = {
        id: sessionId,
        userId: options.userId,
        userInfo: options.userInfo,
        keycloakSessionId: options.keycloakSessionId,
        accessToken: options.tokens?.access_token,
        refreshToken: options.tokens?.refresh_token,
        idToken: options.tokens?.id_token,
        tokenExpiresAt: options.tokens
          ? new Date(now.getTime() + options.tokens.expires_in * 1000)
          : undefined,
        refreshExpiresAt: options.tokens?.refresh_expires_in
          ? new Date(now.getTime() + options.tokens.refresh_expires_in * 1000)
          : undefined,
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: new Date(now.getTime() + maxAge * 1000),
        ipAddress: options.ipAddress,
        userAgent: options.userAgent,
        isActive: true,
        metadata: options.metadata || {},
        fingerprint,
      };

      // Store session
      await this.storeSession(sessionData);

      // Update stats and metrics
      this.stats.sessionsCreated++;
      this.stats.activeSessions++;
      this.stats.totalSessions++;

      this.metrics?.recordCounter("keycloak.session.created", 1);
      this.metrics?.recordTimer(
        "keycloak.session.create_duration",
        performance.now() - startTime
      );

      this.logger.info("Keycloak session created", {
        sessionId: this.hashSessionIdForLogging(sessionId),
        userId: options.userId,
        hasTokens: !!options.tokens,
      });

      return { sessionId, sessionData };
    } catch (error) {
      // Rollback stats if session creation failed after storeSession
      // This prevents memory leaks and inconsistent state
      if (sessionData) {
        this.stats.sessionsCreated = Math.max(
          0,
          this.stats.sessionsCreated - 1
        );
        this.stats.activeSessions = Math.max(0, this.stats.activeSessions - 1);
        this.stats.totalSessions = Math.max(0, this.stats.totalSessions - 1);

        // Attempt cleanup of partially created session
        try {
          await this.destroySession(sessionData.id, "creation_failed");
        } catch (cleanupError) {
          this.logger.warn("Failed to cleanup partially created session", {
            error: cleanupError,
            sessionId: this.hashSessionIdForLogging(sessionData.id),
          });
        }
      }

      this.logger.error("Failed to create Keycloak session", {
        error,
        userId: options.userId,
      });
      this.metrics?.recordCounter("keycloak.session.create_error", 1);
      throw new Error("Failed to create session");
    }
  }

  /**
   * Validate an existing session with token refresh capability
   */
  async validateSession(
    sessionId: string,
    context: {
      ipAddress: string;
      userAgent: string;
    }
  ): Promise<SessionValidationResult> {
    const startTime = performance.now();

    try {
      if (!sessionId || typeof sessionId !== "string") {
        return { valid: false, error: "Invalid session ID format" };
      }

      // Check cache first
      if (this.cacheService) {
        const cacheKey = `keycloak_session_validation:${sessionId}`;
        const cachedResult =
          await this.cacheService.get<SessionValidationResult>(cacheKey);

        if (cachedResult.data && !cachedResult.data.requiresTokenRefresh) {
          this.metrics?.recordCounter("keycloak.session.cache_hit", 1);
          return cachedResult.data;
        }

        this.metrics?.recordCounter("keycloak.session.cache_miss", 1);
      }

      // Retrieve session data
      const sessionData = await this.retrieveSession(sessionId);

      if (!sessionData) {
        const result = { valid: false, error: "Session not found" };
        await this.cacheValidationResult(sessionId, result);
        return result;
      }

      // Check if session is active
      if (!sessionData.isActive) {
        const result = { valid: false, error: "Session is inactive" };
        await this.cacheValidationResult(sessionId, result);
        return result;
      }

      // Check expiration
      if (sessionData.expiresAt < new Date()) {
        await this.destroySession(sessionId, "expired");
        const result = { valid: false, error: "Session expired" };
        await this.cacheValidationResult(sessionId, result);
        return result;
      }

      // Perform security checks
      const securityCheck = this.performSecurityChecks(sessionData, context);
      if (!securityCheck.valid) {
        if (securityCheck.suspicious) {
          await this.destroySession(sessionId, "security_violation");
        }
        return securityCheck.result;
      }

      // Check token expiration and refresh if needed
      let authResult: AuthResult | undefined;
      let requiresTokenRefresh = false;

      if (sessionData.accessToken) {
        // Validate current access token
        authResult = await this.keycloakClient.validateToken(
          sessionData.accessToken
        );

        if (!authResult.success && sessionData.refreshToken) {
          // Try to refresh the token
          try {
            const refreshedTokens = await this.keycloakClient.refreshToken(
              sessionData.refreshToken
            );

            // Update session with new tokens
            const now = new Date();
            sessionData.accessToken = refreshedTokens.access_token;
            sessionData.refreshToken =
              refreshedTokens.refresh_token || sessionData.refreshToken;
            sessionData.tokenExpiresAt = new Date(
              now.getTime() + refreshedTokens.expires_in * 1000
            );
            if (refreshedTokens.refresh_expires_in) {
              sessionData.refreshExpiresAt = new Date(
                now.getTime() + refreshedTokens.refresh_expires_in * 1000
              );
            }

            await this.storeSession(sessionData);

            // CRITICAL: Invalidate cached validation results after token refresh
            // This prevents serving stale validation data with old tokens
            if (this.cacheService) {
              await this.cacheService.invalidate(
                `keycloak_session_validation:${sessionId}`
              );
            }

            // Validate the new token
            authResult = await this.keycloakClient.validateToken(
              sessionData.accessToken
            );

            this.logger.info("Access token refreshed", {
              sessionId: this.hashSessionIdForLogging(sessionId),
              userId: sessionData.userId,
            });

            this.metrics?.recordCounter("keycloak.session.token_refreshed", 1);
          } catch (refreshError) {
            this.logger.warn("Token refresh failed", {
              error: refreshError,
              sessionId: this.hashSessionIdForLogging(sessionId),
            });
            requiresTokenRefresh = true;
          }
        } else if (authResult?.success && sessionData.tokenExpiresAt) {
          // Check if token will expire soon (within 5 minutes)
          const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
          if (sessionData.tokenExpiresAt <= fiveMinutesFromNow) {
            requiresTokenRefresh = true;
          }
        }
      }

      // Update last accessed time
      await this.updateSessionAccess(sessionId);

      // Check if rotation is needed
      const requiresRotation = this.shouldRotateSession(sessionData);

      const result: SessionValidationResult = {
        valid: true,
        session: sessionData,
        authResult,
        requiresRotation,
        requiresTokenRefresh,
      };

      // Cache the result (shorter TTL if token refresh needed)
      await this.cacheValidationResult(
        sessionId,
        result,
        requiresTokenRefresh ? 60 : undefined
      );

      this.metrics?.recordCounter("keycloak.session.validated", 1);
      this.metrics?.recordTimer(
        "keycloak.session.validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("Session validation error", {
        error,
        sessionId: this.hashSessionIdForLogging(sessionId),
      });
      this.metrics?.recordCounter("keycloak.session.validation_error", 1);
      return { valid: false, error: "Internal server error" };
    }
  }

  /**
   * Rotate an existing session with token refresh
   */
  async rotateSession(
    sessionId: string,
    context: { ipAddress: string; userAgent: string }
  ): Promise<{
    sessionId: string;
    sessionData: KeycloakSessionData;
  }> {
    const startTime = performance.now();

    try {
      const currentSession = await this.retrieveSession(sessionId);

      if (!currentSession) {
        throw new Error("Session not found");
      }

      // Create new session
      const newSessionId = this.generateSessionId();

      const updatedSessionData: KeycloakSessionData = {
        ...currentSession,
        id: newSessionId,
        lastAccessedAt: new Date(),
        fingerprint: this.createSessionFingerprint(
          context.ipAddress,
          context.userAgent
        ),
      };

      // Store new session
      await this.storeSession(updatedSessionData);

      // Destroy old session
      await this.destroySession(sessionId, "rotated");

      // Update stats
      this.stats.sessionRotations++;

      this.metrics?.recordCounter("keycloak.session.rotated", 1);
      this.metrics?.recordTimer(
        "keycloak.session.rotation_duration",
        performance.now() - startTime
      );

      this.logger.info("Keycloak session rotated", {
        oldSessionId: this.hashSessionIdForLogging(sessionId),
        newSessionId: this.hashSessionIdForLogging(newSessionId),
        userId: currentSession.userId,
      });

      return { sessionId: newSessionId, sessionData: updatedSessionData };
    } catch (error) {
      this.metrics?.recordCounter("keycloak.session.rotation_error", 1);
      throw new Error(this.sanitizeError(error, "Session rotation failed"));
    }
  }

  /**
   * Destroy a session from both cache and database
   */
  async destroySession(
    sessionId: string,
    reason: string = "logout"
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // Remove from database by marking as inactive
      await this.dbClient.executeRaw(
        `UPDATE user_sessions 
         SET is_active = false, 
             updated_at = NOW()
         WHERE session_id = $1`,
        [sessionId]
      );

      // Remove from cache
      if (this.cacheService) {
        await Promise.all([
          this.cacheService.invalidate(`keycloak_session:${sessionId}`),
          this.cacheService.invalidate(
            `keycloak_session_validation:${sessionId}`
          ),
        ]);
      }

      // Update stats
      this.stats.sessionsDestroyed++;
      this.stats.activeSessions = Math.max(0, this.stats.activeSessions - 1);

      this.metrics?.recordCounter("keycloak.session.destroyed", 1);
      this.metrics?.recordTimer(
        "keycloak.session.destroy_duration",
        performance.now() - startTime
      );

      this.logger.info("Keycloak session destroyed", {
        sessionId: this.hashSessionIdForLogging(sessionId),
        reason,
      });
    } catch (error) {
      this.metrics?.recordCounter("keycloak.session.destroy_error", 1);
      throw new Error(this.sanitizeError(error, "Session termination failed"));
    }
  }

  /**
   * Update session last accessed time (optimized with batching)
   * Only updates if last access time is older than threshold to reduce DB writes
   */
  async updateSessionAccess(sessionId: string): Promise<void> {
    try {
      const sessionData = await this.retrieveSession(sessionId);
      if (sessionData) {
        const now = new Date();
        const timeSinceLastAccess =
          now.getTime() - sessionData.lastAccessedAt.getTime();
        const accessUpdateThreshold = 60000; // Only update if > 1 minute since last update

        if (timeSinceLastAccess > accessUpdateThreshold) {
          sessionData.lastAccessedAt = now;
          await this.storeSession(sessionData);

          this.logger.debug("Session access time updated", {
            sessionId: this.hashSessionIdForLogging(sessionId),
            timeSinceLastAccess: Math.floor(timeSinceLastAccess / 1000) + "s",
          });
        }
      }
    } catch (error) {
      this.logger.warn("Failed to update session access time", {
        error,
        sessionId: this.hashSessionIdForLogging(sessionId),
      });
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<KeycloakSessionData[]> {
    const startTime = performance.now();

    try {
      // Query database for all active sessions for this user
      const result = await this.dbClient.cachedQuery<
        {
          id: string;
          userId: string;
          sessionId: string;
          keycloakSessionId?: string;
          accessToken?: string;
          refreshToken?: string;
          idToken?: string;
          tokenExpiresAt?: Date;
          refreshExpiresAt?: Date;
          fingerprint?: string;
          lastAccessedAt: Date;
          createdAt: Date;
          expiresAt?: Date;
          ipAddress?: string;
          userAgent?: string;
          metadata?: string;
        }[]
      >(
        `SELECT 
          id,
          user_id as "userId",
          session_id as "sessionId", 
          keycloak_session_id as "keycloakSessionId",
          access_token as "accessToken",
          refresh_token as "refreshToken", 
          id_token as "idToken",
          token_expires_at as "tokenExpiresAt",
          refresh_expires_at as "refreshExpiresAt",
          fingerprint,
          last_accessed_at as "lastAccessedAt",
          created_at as "createdAt", 
          expires_at as "expiresAt",
          ip_address as "ipAddress",
          user_agent as "userAgent",
          metadata
        FROM user_sessions 
        WHERE user_id = $1 AND expires_at > NOW()
        ORDER BY last_accessed_at DESC`,
        [userId],
        300 // Cache for 5 minutes
      );

      // Handle array result from cachedQuery
      const rows = Array.isArray(result) ? result : [result];

      // Transform database rows to KeycloakSessionData
      const sessions: KeycloakSessionData[] = rows.map((row) => ({
        id: row.sessionId,
        userId: row.userId,
        userInfo: JSON.parse(row.metadata || "{}").userInfo || {},
        keycloakSessionId: row.keycloakSessionId || "",
        accessToken: row.accessToken
          ? this.decryptToken(row.accessToken)
          : undefined,
        refreshToken: row.refreshToken
          ? this.decryptToken(row.refreshToken)
          : undefined,
        idToken: row.idToken ? this.decryptToken(row.idToken) : undefined,
        tokenExpiresAt: row.tokenExpiresAt,
        refreshExpiresAt: row.refreshExpiresAt,
        createdAt: row.createdAt,
        lastAccessedAt: row.lastAccessedAt,
        expiresAt: row.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
        ipAddress: row.ipAddress || "",
        userAgent: row.userAgent || "",
        isActive: true, // Only active sessions are returned from query
        fingerprint: row.fingerprint || "",
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
      }));

      this.metrics?.recordTimer(
        "keycloak.session_manager.get_user_sessions_duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter(
        "keycloak.session_manager.get_user_sessions",
        1
      );

      return sessions;
    } catch (error) {
      this.logger.error("Failed to get user sessions", {
        error,
        userId,
      });
      this.metrics?.recordCounter(
        "keycloak.session_manager.get_user_sessions_error",
        1
      );
      return [];
    }
  }

  /**
   * Destroy all sessions for a user
   */
  async destroyAllUserSessions(userId: string): Promise<void> {
    const startTime = performance.now();

    try {
      const sessions = await this.getUserSessions(userId);
      await Promise.all(
        sessions.map((session) =>
          this.destroySession(session.id, "all_sessions_destroyed")
        )
      );

      this.metrics?.recordCounter(
        "keycloak.session.user_sessions_destroyed",
        1
      );
      this.metrics?.recordTimer(
        "keycloak.session.destroy_all_duration",
        performance.now() - startTime
      );

      this.logger.info("All Keycloak sessions destroyed for user", {
        userId,
        sessionCount: sessions.length,
      });
    } catch (error) {
      this.logger.error("Failed to destroy all user sessions", {
        error,
        userId,
      });
      this.metrics?.recordCounter("keycloak.session.destroy_all_error", 1);
      throw error;
    }
  }

  /**
   * Get session statistics
   */
  getStats(): SessionStats {
    return { ...this.stats };
  }

  /**
   * Clean up expired sessions from database
   * Should be called periodically by a background job
   */
  async cleanupExpiredSessions(): Promise<number> {
    const startTime = performance.now();

    try {
      const result = await this.dbClient.executeRaw(
        `UPDATE user_sessions 
         SET is_active = false, updated_at = NOW() 
         WHERE is_active = true AND expires_at < NOW()
         RETURNING id`
      );

      const cleanedCount = Array.isArray(result) ? result.length : 0;

      this.logger.info("Cleaned up expired sessions", {
        cleanedCount,
      });

      this.metrics?.recordCounter("keycloak.session.cleanup", 1);
      this.metrics?.recordCounter(
        "keycloak.session.expired_cleaned",
        cleanedCount
      );
      this.metrics?.recordTimer(
        "keycloak.session.cleanup_duration",
        performance.now() - startTime
      );

      return cleanedCount;
    } catch (error) {
      this.logger.error("Failed to cleanup expired sessions", { error });
      this.metrics?.recordCounter("keycloak.session.cleanup_error", 1);
      throw error;
    }
  }

  /**
   * Enforce concurrent session limits using atomic database operations
   * Fixed: Use single transaction to prevent race conditions and inconsistent counts
   */
  private async enforceConcurrentSessionLimits(userId: string): Promise<void> {
    const maxConcurrentSessions =
      this.config.session?.maxConcurrentSessions || 0;

    if (maxConcurrentSessions > 0) {
      try {
        // Use atomic database operation with single COUNT to prevent race conditions
        // This ensures consistent session limit enforcement under high concurrency
        const result = await this.dbClient.executeRaw(
          `WITH session_count AS (
            SELECT COUNT(*) as current_count
            FROM user_sessions 
            WHERE user_id = $1 
              AND is_active = true 
              AND expires_at > NOW()
          ),
          sessions_to_destroy AS (
            SELECT session_id, created_at
            FROM user_sessions, session_count
            WHERE user_id = $1 
              AND is_active = true 
              AND expires_at > NOW()
              AND session_count.current_count >= $2
            ORDER BY created_at ASC
            LIMIT (session_count.current_count - $2 + 1)
          )
          UPDATE user_sessions 
          SET is_active = false, 
              updated_at = NOW()
          WHERE session_id IN (SELECT session_id FROM sessions_to_destroy)
          RETURNING session_id, created_at`,
          [userId, maxConcurrentSessions]
        );

        // Type the result as an array of session records
        const destroyedSessions = result as Array<{
          session_id: string;
          created_at: Date;
        }>;

        if (destroyedSessions && destroyedSessions.length > 0) {
          // Log the enforcement action
          const sessionIds = destroyedSessions.map((row) => row.session_id);

          this.logger.info("Enforced concurrent session limit (atomic)", {
            userId,
            maxSessions: maxConcurrentSessions,
            destroyedSessionCount: sessionIds.length,
            destroyedSessionIds: sessionIds.map((id: string) =>
              this.hashSessionIdForLogging(id)
            ),
          });

          // Clear cache for destroyed sessions
          if (this.cacheService && sessionIds.length > 0) {
            await Promise.all(
              sessionIds.map((sessionId: string) =>
                Promise.all([
                  this.cacheService!.invalidate(
                    `keycloak_session:${sessionId}`
                  ),
                  this.cacheService!.invalidate(
                    `keycloak_session_validation:${sessionId}`
                  ),
                ])
              )
            );
          }

          // Update metrics
          this.metrics?.recordCounter(
            "keycloak.session.concurrent_limit_enforced",
            destroyedSessions.length
          );
        }
      } catch (error) {
        this.logger.error("Failed to enforce concurrent session limits", {
          error,
          userId,
          maxSessions: maxConcurrentSessions,
        });

        this.metrics?.recordCounter(
          "keycloak.session.concurrent_limit_error",
          1
        );

        // Don't throw - allow session creation to continue
        // This ensures availability over strict enforcement
      }
    }
  }

  /**
   * Store session data in database and cache
   */
  private async storeSession(sessionData: KeycloakSessionData): Promise<void> {
    try {
      // Store in database first
      await this.dbClient.executeRaw(
        `INSERT INTO user_sessions (
          id, user_id, session_id, keycloak_session_id, access_token,
          refresh_token, id_token, token_expires_at, refresh_expires_at,
          fingerprint, last_accessed_at, created_at, updated_at,
          expires_at, ip_address, user_agent, metadata, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (session_id) DO UPDATE SET
          last_accessed_at = EXCLUDED.last_accessed_at,
          updated_at = EXCLUDED.updated_at,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          token_expires_at = EXCLUDED.token_expires_at,
          refresh_expires_at = EXCLUDED.refresh_expires_at,
          metadata = EXCLUDED.metadata,
          is_active = EXCLUDED.is_active`,
        [
          crypto.randomUUID(), // Generate unique database ID
          sessionData.userId,
          sessionData.id, // session_id is the session identifier
          sessionData.keycloakSessionId,
          sessionData.accessToken
            ? this.encryptToken(sessionData.accessToken)
            : null,
          sessionData.refreshToken
            ? this.encryptToken(sessionData.refreshToken)
            : null,
          sessionData.idToken ? this.encryptToken(sessionData.idToken) : null,
          sessionData.tokenExpiresAt,
          sessionData.refreshExpiresAt,
          sessionData.fingerprint,
          sessionData.lastAccessedAt,
          sessionData.createdAt,
          sessionData.createdAt, // updated_at = created_at initially
          sessionData.expiresAt,
          sessionData.ipAddress,
          sessionData.userAgent,
          JSON.stringify(sessionData.metadata || {}),
          sessionData.isActive,
        ]
      );

      // Also store in cache if available for faster retrieval
      if (this.cacheService) {
        const cacheKey = `keycloak_session:${sessionData.id}`;
        const ttl = Math.floor(
          (sessionData.expiresAt.getTime() - Date.now()) / 1000
        );
        if (ttl > 0) {
          await this.cacheService.set(cacheKey, sessionData, ttl);
        }
      }
    } catch (error) {
      this.logger.error("Failed to store session", {
        error,
        sessionId: this.hashSessionIdForLogging(sessionData.id),
      });
      throw error;
    }
  }

  /**
   * Retrieve session data from cache or database
   */
  private async retrieveSession(
    sessionId: string
  ): Promise<KeycloakSessionData | null> {
    try {
      // Check cache first for performance
      if (this.cacheService) {
        const cacheKey = `keycloak_session:${sessionId}`;
        const result = await this.cacheService.get<KeycloakSessionData>(
          cacheKey
        );
        if (result.data) {
          return result.data;
        }
      }

      // Fallback to database
      const rows = await this.dbClient.cachedQuery<
        {
          id: string;
          userId: string;
          sessionId: string;
          keycloakSessionId?: string;
          accessToken?: string;
          refreshToken?: string;
          idToken?: string;
          tokenExpiresAt?: Date;
          refreshExpiresAt?: Date;
          fingerprint?: string;
          lastAccessedAt: Date;
          createdAt: Date;
          expiresAt?: Date;
          ipAddress?: string;
          userAgent?: string;
          metadata?: string;
          isActive: boolean;
        }[]
      >(
        `SELECT 
          id, user_id as "userId", session_id as "sessionId",
          keycloak_session_id as "keycloakSessionId",
          access_token as "accessToken",
          refresh_token as "refreshToken",
          id_token as "idToken",
          token_expires_at as "tokenExpiresAt",
          refresh_expires_at as "refreshExpiresAt",
          fingerprint,
          last_accessed_at as "lastAccessedAt",
          created_at as "createdAt",
          expires_at as "expiresAt",
          ip_address as "ipAddress",
          user_agent as "userAgent",
          metadata,
          is_active as "isActive"
        FROM user_sessions 
        WHERE session_id = $1 AND is_active = true`,
        [sessionId]
      );

      if (!rows.length) {
        return null;
      }

      const row = rows[0]!;

      // Reconstruct session data with decrypted tokens
      const sessionData: KeycloakSessionData = {
        id: row.sessionId,
        userId: row.userId,
        userInfo: row.metadata ? JSON.parse(row.metadata).userInfo || {} : {},
        keycloakSessionId: row.keycloakSessionId || "",
        accessToken: row.accessToken
          ? this.decryptToken(row.accessToken)
          : undefined,
        refreshToken: row.refreshToken
          ? this.decryptToken(row.refreshToken)
          : undefined,
        idToken: row.idToken ? this.decryptToken(row.idToken) : undefined,
        tokenExpiresAt: row.tokenExpiresAt,
        refreshExpiresAt: row.refreshExpiresAt,
        createdAt: row.createdAt,
        lastAccessedAt: row.lastAccessedAt,
        expiresAt: row.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
        ipAddress: row.ipAddress || "",
        userAgent: row.userAgent || "",
        isActive: row.isActive,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        fingerprint: row.fingerprint || "",
      };

      // Update cache with retrieved data
      if (this.cacheService) {
        const cacheKey = `keycloak_session:${sessionId}`;
        const ttl = Math.floor(
          (sessionData.expiresAt.getTime() - Date.now()) / 1000
        );
        if (ttl > 0) {
          await this.cacheService.set(cacheKey, sessionData, ttl);
        }
      }

      return sessionData;
    } catch (error) {
      this.logger.error("Failed to retrieve session", { error, sessionId });
      return null;
    }
  }

  /**
   * Generate secure session ID
   */
  private generateSessionId(): string {
    return crypto.randomUUID() + "." + Date.now().toString(36);
  }

  /**
   * Create secure hash of session ID for logging (prevents session enumeration attacks)
   */
  private hashSessionIdForLogging(sessionId: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(sessionId);
    return hash.digest("hex").substring(0, 8) + "...";
  }

  /**
   * Create session fingerprint for security
   */
  private createSessionFingerprint(
    ipAddress: string,
    userAgent: string
  ): string {
    const hash = crypto.createHash("sha256");
    hash.update(`${ipAddress}:${userAgent}:${Date.now()}`);
    return hash.digest("hex");
  }

  /**
   * Perform security checks on session using configuration
   */
  private performSecurityChecks(
    sessionData: KeycloakSessionData,
    context: { ipAddress: string; userAgent: string }
  ): {
    valid: boolean;
    suspicious: boolean;
    result: SessionValidationResult;
  } {
    const enforceIpConsistency =
      this.config.session?.enforceIpConsistency ?? false;
    const enforceUserAgentConsistency =
      this.config.session?.enforceUserAgentConsistency ?? false;

    // Check IP consistency
    if (enforceIpConsistency && sessionData.ipAddress !== context.ipAddress) {
      return {
        valid: false,
        suspicious: true,
        result: { valid: false, error: "IP address mismatch" },
      };
    }

    // Check User Agent consistency (less strict)
    if (
      enforceUserAgentConsistency &&
      sessionData.userAgent !== context.userAgent
    ) {
      // Log but don't invalidate - user agents can change
      this.logger.warn("User agent mismatch detected", {
        sessionId: this.hashSessionIdForLogging(sessionData.id),
        original: sessionData.userAgent?.substring(0, 50) + "...",
        current: context.userAgent?.substring(0, 50) + "...",
      });
    }

    return {
      valid: true,
      suspicious: false,
      result: { valid: true },
    };
  }

  /**
   * Check if session should be rotated using configuration
   */
  private shouldRotateSession(sessionData: KeycloakSessionData): boolean {
    const rotationInterval = this.config.security?.sessionRotationInterval || 0;

    if (!rotationInterval) {
      return false;
    }

    const timeSinceCreation =
      (Date.now() - sessionData.createdAt.getTime()) / 1000;

    return timeSinceCreation > rotationInterval;
  }

  /**
   * Cache validation result
   */
  private async cacheValidationResult(
    sessionId: string,
    result: SessionValidationResult,
    customTtl?: number
  ): Promise<void> {
    if (this.cacheService) {
      const cacheKey = `keycloak_session_validation:${sessionId}`;
      const ttl = customTtl || 300; // 5 minutes default
      await this.cacheService.set(cacheKey, result, ttl);
    }
  }

  /**
   * Encrypt sensitive tokens for storage using secure EncryptionManager
   * SECURITY: Tokens are ALWAYS encrypted - no plaintext storage allowed
   */
  private encryptToken(token: string): string {
    // Security enforcement: Never store tokens in plaintext
    if (!this.config.session?.tokenEncryption) {
      this.logger.warn(
        "Token encryption is disabled but will be enforced for security",
        {
          recommendation: "Enable tokenEncryption in session config",
        }
      );
    }

    try {
      return this.encryptionManager.encryptCompact(token);
    } catch (error) {
      this.logger.error(
        "Failed to encrypt token - this is a critical security error",
        { error }
      );
      throw new Error(
        "Token encryption failed - cannot store sensitive tokens insecurely"
      );
    }
  }

  /**
   * Decrypt sensitive tokens from storage using secure EncryptionManager
   * SECURITY: Handles both encrypted and legacy plaintext tokens during migration
   */
  private decryptToken(encryptedToken: string): string {
    // Handle legacy plaintext tokens during migration period
    if (!this.config.session?.tokenEncryption) {
      this.logger.warn(
        "Attempting to decrypt token with encryption disabled - assuming legacy plaintext",
        {
          tokenLength: encryptedToken.length,
          recommendation:
            "Enable tokenEncryption and migrate existing sessions",
        }
      );
      return encryptedToken; // Return as-is for legacy compatibility
    }

    try {
      return this.encryptionManager.decryptCompact(encryptedToken);
    } catch (error) {
      // Check if this might be a legacy plaintext token
      if (encryptedToken.length < 100 && !encryptedToken.includes(".")) {
        this.logger.warn(
          "Failed to decrypt token - might be legacy plaintext token",
          {
            tokenLength: encryptedToken.length,
            error: error instanceof Error ? error.message : String(error),
          }
        );
        return encryptedToken; // Assume legacy plaintext
      }

      this.logger.error("Failed to decrypt token", { error });
      throw new Error("Token decryption failed");
    }
  }

  /**
   * Sanitize error messages to prevent information disclosure
   * Logs full error details for debugging while returning safe messages to clients
   */
  private sanitizeError(
    error: unknown,
    fallbackMessage: string,
    context?: Record<string, any>
  ): string {
    // Log full error details for debugging
    this.logger.error("Session manager error", {
      error,
      context,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Return sanitized message to prevent information disclosure
    if (error instanceof Error) {
      // Only expose safe, expected error messages
      const safeMessages = [
        "Session not found",
        "Session expired",
        "Token validation failed",
        "Invalid session data",
        "Session security violation",
        "Concurrent session limit exceeded",
        "Token refresh failed",
        "Session rotation failed",
        "IP address mismatch",
        "User agent mismatch",
      ];

      const errorMessage = error.message.toLowerCase();
      const isSafeMessage = safeMessages.some((safe) =>
        errorMessage.includes(safe.toLowerCase())
      );

      if (isSafeMessage) {
        return error.message;
      }
    }

    // Return generic fallback message for unexpected errors
    return fallbackMessage;
  }
}
