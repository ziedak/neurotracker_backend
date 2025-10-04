/**
 * SessionStore - Single Responsibility: Database and cache operations
 *
 * Handles:
 * - Database CRUD operations for sessions
 * - Cache management and invalidation
 * - Data mapping and transformation
 * - Storage optimization and batching
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles data storage and retrieval
 * - Open/Closed: Extensible for different storage backends
 * - Liskov Substitution: Implements standard storage interface
 * - Interface Segregation: Clean separation of storage concerns
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import crypto from "crypto";
import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient, CacheService } from "@libs/database";
import type { KeycloakSessionData, HealthCheckResult } from "./sessionTypes";
import {
  KeycloakSessionDataSchema,
  SessionIdSchema,
  UserIdSchema,
} from "./sessionTypes";

/**
 * Database row interface for session data
 */
interface SessionDatabaseRow {
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
}

/**
 * Session Store Configuration
 */
export interface SessionStoreConfig {
  readonly cacheEnabled: boolean;
  readonly defaultCacheTTL: number;
  readonly batchSize: number;
  readonly accessUpdateThreshold: number; // Only update access time if older than this (ms)
}

const DEFAULT_STORE_CONFIG: SessionStoreConfig = {
  cacheEnabled: true,
  defaultCacheTTL: 3600, // 1 hour
  batchSize: 100,
  accessUpdateThreshold: 60000, // 1 minute
};

/**
 * High-performance session storage with caching and optimization
 */
export class SessionStore {
  private readonly logger: ILogger;
  private readonly config: SessionStoreConfig;

  constructor(
    private readonly dbClient: PostgreSQLClient,
    private readonly cacheService?: CacheService,
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    config: Partial<SessionStoreConfig> = {}
  ) {
    this.logger = logger || createLogger("SessionStore");
    this.config = { ...DEFAULT_STORE_CONFIG, ...config };

    this.logger.info("SessionStore initialized", {
      cacheEnabled: this.config.cacheEnabled && !!this.cacheService,
      batchSize: this.config.batchSize,
      accessUpdateThreshold: this.config.accessUpdateThreshold,
    });
  }

  /**
   * Store session data in database and cache
   */
  async storeSession(sessionData: KeycloakSessionData): Promise<void> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Storing session", {
        operationId,
        sessionId: this.hashSessionId(sessionData.id),
        userId: sessionData.userId,
      });

      // Validate session data
      KeycloakSessionDataSchema.parse(sessionData);

      // Store in database with upsert logic
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
          sessionData.accessToken || null,
          sessionData.refreshToken || null,
          sessionData.idToken || null,
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

      // Store in cache if available and configured
      if (this.cacheService && this.config.cacheEnabled) {
        const cacheKey = this.buildSessionCacheKey(sessionData.id);
        const ttl = Math.floor(
          (sessionData.expiresAt.getTime() - Date.now()) / 1000
        );

        if (ttl > 0) {
          await this.cacheService.set(cacheKey, sessionData, ttl);
        }
      }

      // Record metrics
      this.metrics?.recordTimer(
        "session.store.duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("session.stored", 1);

      this.logger.debug("Session stored successfully", {
        operationId,
        sessionId: this.hashSessionId(sessionData.id),
        duration: performance.now() - startTime,
      });
    } catch (error) {
      this.logger.error("Failed to store session", {
        operationId,
        error,
        sessionId: this.hashSessionId(sessionData.id),
      });
      this.metrics?.recordCounter("session.store.error", 1);
      throw error;
    }
  }

  /**
   * Retrieve session data from cache or database
   */
  async retrieveSession(
    sessionId: string
  ): Promise<KeycloakSessionData | null> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Retrieving session", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
      });

      // Validate input
      SessionIdSchema.parse(sessionId);

      // Check cache first if available
      if (this.cacheService && this.config.cacheEnabled) {
        const cacheKey = this.buildSessionCacheKey(sessionId);
        const result = await this.cacheService.get<KeycloakSessionData>(
          cacheKey
        );

        if (result.data) {
          this.metrics?.recordCounter("session.cache_hit", 1);
          this.logger.debug("Session retrieved from cache", {
            operationId,
            sessionId: this.hashSessionId(sessionId),
          });
          return result.data;
        }
      }

      // Fallback to database
      const rows = await this.dbClient.cachedQuery<SessionDatabaseRow[]>(
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
        [sessionId],
        this.config.defaultCacheTTL
      );

      if (!rows.length) {
        this.metrics?.recordCounter("session.not_found", 1);
        return null;
      }

      const sessionRow = rows[0];
      if (!sessionRow) {
        throw new Error("Session data not found after database query");
      }

      const sessionData = this.mapRowToSessionData(sessionRow);

      // Update cache with retrieved data
      if (this.cacheService && this.config.cacheEnabled) {
        const cacheKey = this.buildSessionCacheKey(sessionId);
        const ttl = Math.floor(
          (sessionData.expiresAt.getTime() - Date.now()) / 1000
        );

        if (ttl > 0) {
          await this.cacheService.set(cacheKey, sessionData, ttl);
        }
      }

      this.metrics?.recordCounter("session.cache_miss", 1);
      this.metrics?.recordTimer(
        "session.retrieve.duration",
        performance.now() - startTime
      );

      this.logger.debug("Session retrieved from database", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
        duration: performance.now() - startTime,
      });

      return sessionData;
    } catch (error) {
      this.logger.error("Failed to retrieve session", {
        operationId,
        error,
        sessionId: this.hashSessionId(sessionId),
      });
      this.metrics?.recordCounter("session.retrieve.error", 1);
      return null;
    }
  }

  /**
   * Update session access time (optimized to reduce database writes)
   */
  async updateSessionAccess(sessionId: string): Promise<void> {
    const startTime = performance.now();

    try {
      SessionIdSchema.parse(sessionId);

      // First check if we need to update based on threshold
      const sessionData = await this.retrieveSession(sessionId);
      if (!sessionData) {
        return; // Session not found, nothing to update
      }

      const now = new Date();
      const timeSinceLastAccess =
        now.getTime() - sessionData.lastAccessedAt.getTime();

      // Only update if enough time has passed (reduces DB writes)
      if (timeSinceLastAccess > this.config.accessUpdateThreshold) {
        const updatedSessionData = { ...sessionData, lastAccessedAt: now };
        await this.storeSession(updatedSessionData);

        this.logger.debug("Session access time updated", {
          sessionId: this.hashSessionId(sessionId),
          timeSinceLastAccess: Math.floor(timeSinceLastAccess / 1000) + "s",
        });

        this.metrics?.recordCounter("session.access_updated", 1);
      }

      this.metrics?.recordTimer(
        "session.update_access.duration",
        performance.now() - startTime
      );
    } catch (error) {
      this.logger.warn("Failed to update session access time", {
        error,
        sessionId: this.hashSessionId(sessionId),
      });
      // Don't throw - this is not critical for session functionality
    }
  }

  /**
   * Update session tokens after refresh
   * Used by SessionTokenCoordinator after calling KeycloakClient.refreshToken()
   */
  async updateSessionTokens(
    sessionId: string,
    newTokens: {
      accessToken: string;
      refreshToken?: string;
      expiresAt: Date;
      refreshExpiresAt?: Date;
    }
  ): Promise<void> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Updating session tokens", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
      });

      // Validate input
      SessionIdSchema.parse(sessionId);

      // Retrieve current session
      const session = await this.retrieveSession(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      // Create updated session data (properties are readonly)
      const updatedSession: KeycloakSessionData = {
        ...session,
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken || session.refreshToken,
        expiresAt: newTokens.expiresAt,
        refreshExpiresAt:
          newTokens.refreshExpiresAt || session.refreshExpiresAt,
        lastAccessedAt: new Date(),
      };

      // Store updated session
      await this.storeSession(updatedSession);

      this.logger.info("Session tokens updated successfully", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
        expiresAt: newTokens.expiresAt.toISOString(),
      });

      this.metrics?.recordCounter("session.tokens_updated", 1);
      this.metrics?.recordTimer(
        "session.update_tokens.duration",
        performance.now() - startTime
      );
    } catch (error) {
      this.logger.error("Failed to update session tokens", {
        operationId,
        error,
        sessionId: this.hashSessionId(sessionId),
      });
      this.metrics?.recordCounter("session.update_tokens.error", 1);
      throw error; // Critical operation - throw to caller
    }
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<KeycloakSessionData[]> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Retrieving user sessions", {
        operationId,
        userId,
      });

      UserIdSchema.parse(userId);

      const rows = await this.dbClient.cachedQuery<SessionDatabaseRow[]>(
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
        WHERE user_id = $1 AND is_active = true AND expires_at > NOW()
        ORDER BY last_accessed_at DESC`,
        [userId],
        300 // Cache for 5 minutes
      );

      const sessions = rows.map((row) => this.mapRowToSessionData(row));

      this.metrics?.recordTimer(
        "session.get_user_sessions.duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("session.user_sessions_retrieved", 1);

      this.logger.debug("User sessions retrieved", {
        operationId,
        userId,
        sessionCount: sessions.length,
        duration: performance.now() - startTime,
      });

      return sessions;
    } catch (error) {
      this.logger.error("Failed to get user sessions", {
        operationId,
        error,
        userId,
      });
      this.metrics?.recordCounter("session.get_user_sessions.error", 1);
      return [];
    }
  }

  /**
   * Mark session as inactive (soft delete)
   */
  async markSessionInactive(
    sessionId: string,
    reason: string = "destroyed"
  ): Promise<void> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Marking session inactive", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
        reason,
      });

      SessionIdSchema.parse(sessionId);

      // Update database
      await this.dbClient.executeRaw(
        `UPDATE user_sessions 
         SET is_active = false, 
             updated_at = NOW()
         WHERE session_id = $1`,
        [sessionId]
      );

      // Clear from cache
      await this.invalidateSessionCache(sessionId);

      this.metrics?.recordTimer(
        "session.mark_inactive.duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("session.marked_inactive", 1);

      this.logger.debug("Session marked inactive", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
        reason,
        duration: performance.now() - startTime,
      });
    } catch (error) {
      this.logger.error("Failed to mark session inactive", {
        operationId,
        error,
        sessionId: this.hashSessionId(sessionId),
        reason,
      });
      this.metrics?.recordCounter("session.mark_inactive.error", 1);
      throw error;
    }
  }

  /**
   * Cleanup expired sessions (returns count of cleaned sessions)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Starting expired sessions cleanup", { operationId });

      const result = await this.dbClient.executeRaw(
        `UPDATE user_sessions 
         SET is_active = false, updated_at = NOW() 
         WHERE is_active = true AND expires_at < NOW()
         RETURNING id`
      );

      const cleanedCount = Array.isArray(result) ? result.length : 0;

      this.metrics?.recordTimer(
        "session.cleanup.duration",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("session.cleanup_completed", 1);
      this.metrics?.recordCounter("session.expired_cleaned", cleanedCount);

      this.logger.info("Expired sessions cleanup completed", {
        operationId,
        cleanedCount,
        duration: performance.now() - startTime,
      });

      return cleanedCount;
    } catch (error) {
      this.logger.error("Failed to cleanup expired sessions", {
        operationId,
        error,
      });
      this.metrics?.recordCounter("session.cleanup.error", 1);
      throw error;
    }
  }

  /**
   * Invalidate session cache entries
   */
  async invalidateSessionCache(sessionId: string): Promise<void> {
    if (this.cacheService && this.config.cacheEnabled) {
      try {
        await Promise.all([
          this.cacheService.invalidate(this.buildSessionCacheKey(sessionId)),
          this.cacheService.invalidate(this.buildValidationCacheKey(sessionId)),
        ]);

        this.metrics?.recordCounter("session.cache_invalidated", 1);
      } catch (error) {
        this.logger.warn("Failed to invalidate session cache", {
          error,
          sessionId: this.hashSessionId(sessionId),
        });
      }
    }
  }

  /**
   * Perform health check on storage systems
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      // Test database connectivity
      await this.dbClient.executeRaw("SELECT 1");

      // Test cache if enabled
      let cacheStatus = "disabled";
      if (this.cacheService && this.config.cacheEnabled) {
        const testKey = `health_check_${Date.now()}`;
        await this.cacheService.set(testKey, { test: true }, 10);
        const result = await this.cacheService.get(testKey);
        cacheStatus = result.data ? "healthy" : "unhealthy";
        await this.cacheService.invalidate(testKey);
      }

      const responseTime = performance.now() - startTime;
      const status = cacheStatus === "unhealthy" ? "degraded" : "healthy";

      return {
        status,
        details: {
          database: "healthy",
          cache: cacheStatus,
          responseTime: Math.round(responseTime),
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("Storage health check failed", { error });
      return {
        status: "unhealthy",
        details: {
          database: "unhealthy",
          cache: "unknown",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    activeSessions: number;
    totalSessions: number;
    cacheEnabled: boolean;
  }> {
    try {
      const activeResult = await this.dbClient.executeRaw(
        `SELECT COUNT(*) as count FROM user_sessions 
         WHERE is_active = true AND expires_at > NOW()`
      );

      const totalResult = await this.dbClient.executeRaw(
        `SELECT COUNT(*) as count FROM user_sessions`
      );

      const activeCount = Array.isArray(activeResult)
        ? (activeResult[0] as any)?.count || 0
        : 0;
      const totalCount = Array.isArray(totalResult)
        ? (totalResult[0] as any)?.count || 0
        : 0;

      return {
        activeSessions: activeCount,
        totalSessions: totalCount,
        cacheEnabled: this.config.cacheEnabled && !!this.cacheService,
      };
    } catch (error) {
      this.logger.error("Failed to get storage stats", { error });
      return {
        activeSessions: 0,
        totalSessions: 0,
        cacheEnabled: false,
      };
    }
  }

  /**
   * Private helper methods
   */
  private buildSessionCacheKey(sessionId: string): string {
    return `keycloak_session:${sessionId}`;
  }

  private buildValidationCacheKey(sessionId: string): string {
    return `keycloak_session_validation:${sessionId}`;
  }

  private hashSessionId(sessionId: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(sessionId);
    return hash.digest("hex").substring(0, 8) + "...";
  }

  private mapRowToSessionData(row: SessionDatabaseRow): KeycloakSessionData {
    return {
      id: row.sessionId,
      userId: row.userId,
      userInfo: row.metadata ? JSON.parse(row.metadata).userInfo || {} : {},
      keycloakSessionId: row.keycloakSessionId || "",
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      idToken: row.idToken,
      tokenExpiresAt: row.tokenExpiresAt,
      refreshExpiresAt: row.refreshExpiresAt,
      createdAt: row.createdAt,
      lastAccessedAt: row.lastAccessedAt,
      expiresAt: row.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
      ipAddress: row.ipAddress || "",
      userAgent: row.userAgent || "",
      isActive: row.isActive,
      fingerprint: row.fingerprint || "",
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger.info("SessionStore cleanup completed");
  }
}
