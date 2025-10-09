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
import type {
  CacheService,
  UserSessionRepository,
  UserSession,
} from "@libs/database";
import type { HealthCheckResult } from "./sessionTypes";
import {
  UserIdSchema,
  SessionCreationOptions,
  toUserSessionCreateInput,
  UserSessionSchema,
} from "./sessionTypes";
import { z } from "zod";

// Session ID validation (CUID format from Prisma @default(cuid()))
const SessionIdSchema = z.string().min(1, "Session ID must not be empty");

/**
 * @deprecated Using UserSession type from @libs/database instead
 * Database row interface - no longer used after repository refactoring
 */
// interface SessionDatabaseRow { ... }

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
 * REFACTORED: Now uses repository pattern instead of raw SQL
 */
export class SessionStore {
  private readonly logger: ILogger;
  private readonly config: SessionStoreConfig;

  constructor(
    private readonly userSessionRepo: UserSessionRepository,
    private readonly cacheService?: CacheService,
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    config: Partial<SessionStoreConfig> = {}
  ) {
    this.logger = logger || createLogger("SessionStore");
    this.config = { ...DEFAULT_STORE_CONFIG, ...config };

    this.logger.info("SessionStore initialized with repository pattern", {
      cacheEnabled: this.config.cacheEnabled && !!this.cacheService,
      batchSize: this.config.batchSize,
      accessUpdateThreshold: this.config.accessUpdateThreshold,
    });
  }

  /**
   * Store session data in database and cache
   * REFACTORED: Now uses repository pattern with upsert logic
   * Accepts either full UserSession or SessionCreationOptions
   * Returns the created/updated session
   */
  async storeSession(
    sessionData: UserSession | SessionCreationOptions
  ): Promise<UserSession> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    // Determine if we have a full UserSession or just creation options
    const isFullSession = "id" in sessionData && "createdAt" in sessionData;
    const sessionId = isFullSession
      ? (sessionData as UserSession).id
      : undefined;

    try {
      this.logger.debug("Storing session", {
        operationId,
        sessionId: sessionId ? this.hashSessionId(sessionId) : "new-session",
        userId: sessionData.userId,
      });

      if (isFullSession) {
        // Validate full UserSession
        UserSessionSchema.parse(sessionData);

        // Update existing session
        const session = sessionData as UserSession;
        const updateData: any = {
          lastAccessedAt: session.lastAccessedAt,
          isActive: session.isActive,
        };

        // Only add fields that are not undefined/null
        if (session.accessToken !== undefined && session.accessToken !== null) {
          updateData.accessToken = session.accessToken;
        }
        if (
          session.refreshToken !== undefined &&
          session.refreshToken !== null
        ) {
          updateData.refreshToken = session.refreshToken;
        }
        if (
          session.tokenExpiresAt !== undefined &&
          session.tokenExpiresAt !== null
        ) {
          updateData.tokenExpiresAt = session.tokenExpiresAt;
        }
        if (
          session.refreshExpiresAt !== undefined &&
          session.refreshExpiresAt !== null
        ) {
          updateData.refreshExpiresAt = session.refreshExpiresAt;
        }
        if (session.metadata !== undefined && session.metadata !== null) {
          updateData.metadata = session.metadata;
        }

        await this.userSessionRepo.updateById(session.id, updateData);

        // Return the updated session
        return session;
      } else {
        // Handle creation options - create new session
        const options = sessionData as SessionCreationOptions;

        // Create new session
        const createInput = toUserSessionCreateInput(options);
        const createdSession = await this.userSessionRepo.create(createInput);

        // Invalidate session count cache (session created)
        await this.invalidateSessionCountCache(
          options.userId,
          options.fingerprint
        );

        // Record metrics
        this.metrics?.recordTimer(
          "session.store.duration",
          performance.now() - startTime
        );
        this.metrics?.recordCounter("session.stored", 1);

        this.logger.debug("Session stored successfully", {
          operationId,
          sessionId: createdSession.id
            ? this.hashSessionId(createdSession.id)
            : "new-session",
          duration: performance.now() - startTime,
        });

        // Return the created session
        return createdSession as UserSession;
      }
    } catch (error) {
      this.logger.error("Failed to store session", {
        operationId,
        error,
        sessionId: isFullSession
          ? this.hashSessionId((sessionData as UserSession).id)
          : "new-session",
      });
      this.metrics?.recordCounter("session.store.error", 1);
      throw error; // Re-throw to let caller handle it
    }
  }

  /**
   * Retrieve session data from cache or database
   * REFACTORED: Now returns UserSession directly from database
   */
  async retrieveSession(sessionId: string): Promise<UserSession | null> {
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
        const result = await this.cacheService.get<UserSession>(cacheKey);

        if (result.data) {
          this.metrics?.recordCounter("session.cache_hit", 1);
          this.logger.debug("Session retrieved from cache", {
            operationId,
            sessionId: this.hashSessionId(sessionId),
          });
          return result.data;
        }
      }

      // Fallback to database using repository
      this.logger.debug("Querying database for session", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
      });

      const session = await this.userSessionRepo.findBySessionToken(sessionId);

      this.logger.debug("Database query result", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
        found: !!session,
        isActive: session?.isActive,
      });

      if (!session || !session.isActive) {
        this.logger.warn("Session not found or inactive", {
          operationId,
          sessionId: this.hashSessionId(sessionId),
          found: !!session,
          isActive: session?.isActive,
        });
        this.metrics?.recordCounter("session.not_found", 1);
        return null;
      }

      // Update cache with retrieved data
      if (this.cacheService && this.config.cacheEnabled) {
        const cacheKey = this.buildSessionCacheKey(sessionId);
        const expiresAt = session.expiresAt || new Date(Date.now() + 3600000);
        const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

        if (ttl > 0) {
          await this.cacheService.set(cacheKey, session, ttl);
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

      return session;
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

      // Update session with new tokens
      const updateData: any = {
        accessToken: newTokens.accessToken,
        tokenExpiresAt: newTokens.expiresAt,
        lastAccessedAt: new Date(),
      };

      // Handle nullable fields properly
      if (
        newTokens.refreshToken !== undefined &&
        newTokens.refreshToken !== null
      ) {
        updateData.refreshToken = newTokens.refreshToken;
      } else if (newTokens.refreshToken === null) {
        // Explicitly set to null if provided as null
        updateData.refreshToken = null;
      } else {
        // Keep existing refresh token if not provided
        updateData.refreshToken = session.refreshToken;
      }

      if (
        newTokens.refreshExpiresAt !== undefined &&
        newTokens.refreshExpiresAt !== null
      ) {
        updateData.refreshExpiresAt = newTokens.refreshExpiresAt;
      } else if (newTokens.refreshExpiresAt === null) {
        updateData.refreshExpiresAt = null;
      } else {
        updateData.refreshExpiresAt = session.refreshExpiresAt;
      }

      await this.userSessionRepo.updateById(session.id, updateData);

      // Invalidate cache
      if (this.cacheService && this.config.cacheEnabled) {
        const cacheKey = this.buildSessionCacheKey(sessionId);
        await this.cacheService.invalidate(cacheKey);
      }

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
   * REFACTORED: Now uses repository pattern and returns UserSession[]
   */
  async getUserSessions(userId: string): Promise<UserSession[]> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Retrieving user sessions", {
        operationId,
        userId,
      });

      UserIdSchema.parse(userId);

      // Use repository to get active sessions
      const sessions = await this.userSessionRepo.findActiveByUserId(userId, {
        orderBy: { lastAccessedAt: "desc" },
      });

      this.logger.debug("User sessions retrieved", {
        operationId,
        userId,
        count: sessions.length,
        duration: performance.now() - startTime,
      });

      this.metrics?.recordTimer(
        "session.get_user_sessions.duration",
        performance.now() - startTime
      );

      return sessions;
    } catch (error) {
      this.logger.error("Failed to retrieve user sessions", {
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
   * REFACTORED: Now uses repository pattern
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

      // Find and update session using repository
      const session = await this.userSessionRepo.findBySessionToken(sessionId);
      if (session) {
        await this.userSessionRepo.updateById(session.id, {
          isActive: false,
        });

        // Invalidate session count cache (session terminated)
        await this.invalidateSessionCountCache(
          session.userId,
          session.fingerprint || undefined
        );
      }

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
   * REFACTORED: Now uses repository pattern
   */
  async cleanupExpiredSessions(): Promise<number> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Starting expired sessions cleanup", { operationId });

      // Use repository to cleanup expired sessions
      const result = await this.userSessionRepo.cleanupExpiredSessions();
      const cleanedCount = result.count;

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
   * REFACTORED: Repository pattern - simplified database test
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      // Test database connectivity by counting sessions (lightweight query)
      await this.userSessionRepo.count();

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
   * REFACTORED: Now uses repository pattern
   */
  async getStorageStats(): Promise<{
    activeSessions: number;
    totalSessions: number;
    cacheEnabled: boolean;
  }> {
    try {
      // Use repository count methods
      const totalCount = await this.userSessionRepo.count();
      const activeCount = await this.userSessionRepo.count({
        where: {
          isActive: true,
          expiresAt: {
            gt: new Date(),
          },
        },
      });

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
   * Get active session count for user (CACHED for performance)
   * Used for concurrent session limiting without slow queries
   *
   * @param userId - User ID to count sessions for
   * @param deviceFingerprint - Optional device fingerprint to filter by
   * @returns Number of active sessions
   */
  async getActiveSessionCount(
    userId: string,
    deviceFingerprint?: string
  ): Promise<number> {
    const cacheKey = `session:count:${userId}:${deviceFingerprint || "all"}`;

    try {
      // Try cache first (5ms)
      if (this.cacheService && this.config.cacheEnabled) {
        const cached = await this.cacheService.get<number>(cacheKey);
        if (cached.data !== null) {
          this.metrics?.recordCounter("session.count.cache_hit", 1);
          return cached.data;
        }
      }

      // Cache miss - query database (1000ms)
      this.metrics?.recordCounter("session.count.cache_miss", 1);
      const count = await this.userSessionRepo.count({
        where: {
          userId,
          isActive: true,
          expiresAt: { gt: new Date() },
          ...(deviceFingerprint && { fingerprint: deviceFingerprint }),
        },
      });

      // Cache for 30 seconds (balance freshness vs performance)
      if (this.cacheService && this.config.cacheEnabled) {
        await this.cacheService.set(cacheKey, count, 30);
      }

      return count;
    } catch (error) {
      this.logger.error("Failed to get active session count", {
        userId,
        error,
      });
      return 0;
    }
  }

  /**
   * Get oldest session for user (for concurrent limit enforcement)
   *
   * @param userId - User ID to get oldest session for
   * @returns Oldest active session or null
   */
  async getOldestSession(userId: string): Promise<UserSession | null> {
    try {
      const sessions = await this.userSessionRepo.findMany({
        where: {
          userId,
          isActive: true,
          expiresAt: { gt: new Date() },
        },
        orderBy: {
          createdAt: "asc", // Oldest first
        },
        take: 1,
      });

      return sessions[0] || null;
    } catch (error) {
      this.logger.error("Failed to get oldest session", { userId, error });
      return null;
    }
  }

  /**
   * Invalidate session count cache when creating/terminating sessions
   *
   * @param userId - User ID to invalidate cache for
   * @param deviceFingerprint - Optional device fingerprint
   */
  private async invalidateSessionCountCache(
    userId: string,
    deviceFingerprint?: string
  ): Promise<void> {
    if (!this.cacheService || !this.config.cacheEnabled) {
      return;
    }

    try {
      const patterns = [
        `session:count:${userId}:all`,
        `session:count:${userId}:${deviceFingerprint || "*"}`,
      ];

      await this.cacheService.mInvalidate(patterns);
      this.metrics?.recordCounter("session.count.cache_invalidated", 1);
    } catch (error) {
      this.logger.error("Failed to invalidate session count cache", {
        userId,
        error,
      });
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

  /**
   * @deprecated Replaced by userSessionToSessionData helper from sessionTypes
   * Kept for reference but no longer used
   */
  // private mapRowToSessionData(row: SessionDatabaseRow): SessionData { ... }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger.info("SessionStore cleanup completed");
  }
}
