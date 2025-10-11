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
  PrismaClient,
} from "@libs/database";
import type { HealthCheckResult } from "./sessionTypes";
import {
  UserIdSchema,
  SessionCreationOptions,
  UserSessionSchema,
  UserSessionWithTokens,
} from "./sessionTypes";
import { z } from "zod";
import { AccountService } from "../account/AccountService";

// Session ID validation (CUID format from Prisma @default(cuid()))
const SessionIdSchema = z.string().min(1, "Session ID must not be empty");

/**
 * Normalize session data - ensures all Date fields are Date objects, not strings
 * This is needed because data from cache or serialization may have Date fields as ISO strings
 * NOTE: Token fields (tokenExpiresAt, refreshExpiresAt) removed - now in Account vault
 */
function normalizeSessionDates(session: UserSession): UserSession {
  return {
    ...session,
    lastAccessedAt:
      session.lastAccessedAt instanceof Date
        ? session.lastAccessedAt
        : new Date(session.lastAccessedAt),
    createdAt:
      session.createdAt instanceof Date
        ? session.createdAt
        : new Date(session.createdAt),
    updatedAt:
      session.updatedAt instanceof Date
        ? session.updatedAt
        : new Date(session.updatedAt),
    expiresAt: session.expiresAt
      ? session.expiresAt instanceof Date
        ? session.expiresAt
        : new Date(session.expiresAt)
      : null,
    endedAt: session.endedAt
      ? session.endedAt instanceof Date
        ? session.endedAt
        : new Date(session.endedAt)
      : null,
  };
}

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
  private readonly accountService: AccountService;

  constructor(
    private readonly userSessionRepo: UserSessionRepository,
    prisma: PrismaClient,
    private readonly cacheService?: CacheService,
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    config: Partial<SessionStoreConfig> = {}
  ) {
    this.logger = logger || createLogger("SessionStore");
    this.config = { ...DEFAULT_STORE_CONFIG, ...config };
    this.accountService = new AccountService(prisma, metrics);

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

        // Update existing session (metadata only - tokens are in vault)
        const session = sessionData as UserSession;
        const updateData: any = {
          lastAccessedAt: session.lastAccessedAt,
          isActive: session.isActive,
        };

        // Only add metadata fields that are defined
        if (session.metadata !== undefined && session.metadata !== null) {
          updateData.metadata = session.metadata;
        }

        await this.userSessionRepo.updateById(session.id, updateData);

        // Return the updated session
        return session;
      } else {
        // Handle creation options - create new session
        const options = sessionData as SessionCreationOptions;

        this.logger.debug("Creating new session with token vault", {
          operationId,
          userId: options.userId,
          hasTokens: !!(options.accessToken && options.refreshToken),
        });

        // 1. Store tokens in vault (if provided)
        let accountId: string | undefined;
        if (options.accessToken && options.refreshToken) {
          const tokenVaultInput: import("../account/AccountService").TokenVaultInput =
            {
              userId: options.userId,
              keycloakUserId: options.keycloakSessionId || options.userId,
              accessToken: options.accessToken,
              refreshToken: options.refreshToken,
              accessTokenExpiresAt:
                options.tokenExpiresAt || new Date(Date.now() + 3600000),
            };

          // Only add optional fields if defined
          if (options.idToken) {
            tokenVaultInput.idToken = options.idToken;
          }
          if (options.refreshExpiresAt) {
            tokenVaultInput.refreshTokenExpiresAt = options.refreshExpiresAt;
          }

          accountId = await this.accountService.storeTokens(tokenVaultInput);

          this.logger.debug("Tokens stored in vault", {
            operationId,
            accountId,
            userId: options.userId,
          });
        }

        // 2. Create session metadata (NO TOKENS in database)
        // Using UserSessionCreateInput (based on UncheckedCreateInput) to set accountId directly
        const createInput: import("@libs/database").UserSessionCreateInput = {
          userId: options.userId,
        };

        // Add accountId if tokens were stored
        if (accountId) {
          createInput.accountId = accountId;
        }

        // Add optional metadata fields
        if (options.keycloakSessionId !== undefined) {
          createInput.keycloakSessionId = options.keycloakSessionId;
        }
        if (options.fingerprint !== undefined) {
          createInput.fingerprint = options.fingerprint;
        }
        if (options.expiresAt !== undefined) {
          createInput.expiresAt = options.expiresAt;
        }
        if (options.ipAddress !== undefined) {
          createInput.ipAddress = options.ipAddress;
        }
        if (options.userAgent !== undefined) {
          createInput.userAgent = options.userAgent;
        }
        if (options.metadata !== undefined) {
          createInput.metadata = options.metadata as any;
        }

        // DO NOT add token fields to database!
        // They are now in the Account vault

        const createdSession = await this.userSessionRepo.create(createInput);

        // Cache metadata only (no tokens)
        await this.cacheSessionMetadata(createdSession);

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
        this.metrics?.recordCounter("session.stored_with_vault", 1);

        this.logger.info("Session created with token vault", {
          operationId,
          sessionId: createdSession.id
            ? this.hashSessionId(createdSession.id)
            : "new-session",
          accountId,
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
   * UPDATED: Now supports includeTokens parameter for token vault integration
   * @param sessionId - Session ID to retrieve
   * @param includeTokens - If true, fetch tokens from vault (default: false)
   */
  async retrieveSession(
    sessionId: string,
    includeTokens = false
  ): Promise<UserSession | null> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Retrieving session", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
        includeTokens,
      });

      // Validate input
      SessionIdSchema.parse(sessionId);

      // Check cache first if available (only if NOT requesting tokens)
      if (!includeTokens && this.cacheService && this.config.cacheEnabled) {
        const cacheKey = this.buildSessionCacheKey(sessionId);
        const result = await this.cacheService.get<UserSession>(cacheKey);

        if (result.data) {
          this.metrics?.recordCounter("session.cache_hit", 1);
          this.logger.debug("Session metadata retrieved from cache", {
            operationId,
            sessionId: this.hashSessionId(sessionId),
          });
          // Normalize dates from cache (may be serialized as strings)
          return normalizeSessionDates(result.data);
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

      // Valid "not found" case - return null
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

      // Fetch tokens from vault if requested
      if (includeTokens && session.accountId) {
        const tokens = await this.accountService.getTokens(session.accountId);
        if (tokens) {
          // Attach tokens to session (for backward compatibility)
          const sessionWithTokens = session as UserSessionWithTokens;
          sessionWithTokens.accessToken = tokens.accessToken ?? undefined;
          sessionWithTokens.refreshToken = tokens.refreshToken ?? undefined;
          sessionWithTokens.idToken = tokens.idToken ?? undefined;
          sessionWithTokens.tokenExpiresAt =
            tokens.accessTokenExpiresAt ?? undefined;
          sessionWithTokens.refreshTokenExpiresAt =
            tokens.refreshTokenExpiresAt ?? undefined;

          this.logger.debug("Tokens retrieved from vault", {
            operationId,
            sessionId: this.hashSessionId(sessionId),
            accountId: session.accountId,
          });
        }
      }

      // Update cache with retrieved metadata (no tokens)
      if (!includeTokens) {
        await this.cacheSessionMetadata(session);
      }

      this.metrics?.recordCounter("session.cache_miss", 1);
      this.metrics?.recordTimer(
        "session.retrieve.duration",
        performance.now() - startTime
      );

      this.logger.debug("Session retrieved from database", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
        includeTokens,
        duration: performance.now() - startTime,
      });

      // Normalize dates from database (Prisma may return Date objects, but ensure consistency)
      return normalizeSessionDates(session);
    } catch (error) {
      // Database error - fail loudly (don't return null)
      this.logger.error("Database error retrieving session", {
        operationId,
        error,
        sessionId: this.hashSessionId(sessionId),
      });
      this.metrics?.recordCounter("session.retrieve.database_error", 1);
      throw new Error(
        `Failed to retrieve session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
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
   * Used by RefreshTokenManager after calling KeycloakClient.refreshToken()
   * UPDATED: Now updates tokens in vault via AccountService instead of database
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
      this.logger.debug("Updating session tokens in vault", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
      });

      // Validate input
      SessionIdSchema.parse(sessionId);

      // Retrieve current session to get accountId
      const session = await this.retrieveSession(sessionId, false);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const accountId = session.accountId;
      if (!accountId) {
        throw new Error(
          `Session ${sessionId} has no accountId (not linked to vault)`
        );
      }

      // Update tokens in vault via AccountService
      const updateInput: import("../account/AccountService").TokenUpdateInput =
        {
          accountId,
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken || "",
          accessTokenExpiresAt: newTokens.expiresAt,
        };

      if (newTokens.refreshExpiresAt) {
        updateInput.refreshTokenExpiresAt = newTokens.refreshExpiresAt;
      }

      await this.accountService.updateTokens(updateInput);

      // Update session metadata (lastAccessedAt only)
      await this.userSessionRepo.updateById(session.id, {
        lastAccessedAt: new Date(),
      });

      // Invalidate cache
      if (this.cacheService && this.config.cacheEnabled) {
        const cacheKey = this.buildSessionCacheKey(sessionId);
        await this.cacheService.invalidate(cacheKey);
      }

      this.logger.info("Session tokens updated in vault successfully", {
        operationId,
        sessionId: this.hashSessionId(sessionId),
        accountId,
        expiresAt: newTokens.expiresAt.toISOString(),
      });

      this.metrics?.recordCounter("session.vault_tokens_updated", 1);
      this.metrics?.recordTimer(
        "session.update_vault_tokens.duration",
        performance.now() - startTime
      );
    } catch (error) {
      this.logger.error("Failed to update session tokens in vault", {
        operationId,
        error,
        sessionId: this.hashSessionId(sessionId),
      });
      this.metrics?.recordCounter("session.update_vault_tokens.error", 1);
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
      // Database error - fail loudly (don't return empty array)
      this.logger.error("Database error retrieving user sessions", {
        operationId,
        error,
        userId,
      });
      this.metrics?.recordCounter(
        "session.get_user_sessions.database_error",
        1
      );
      throw new Error(
        `Failed to retrieve user sessions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
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
        // Clear tokens from vault before marking session inactive
        if (session.accountId) {
          try {
            await this.accountService.clearTokens(session.accountId);
            this.logger.info(
              "Tokens cleared from vault on session termination",
              {
                sessionId: this.hashSessionId(sessionId),
                accountId: session.accountId,
                reason,
              }
            );
          } catch (error) {
            this.logger.error("Failed to clear tokens from vault", {
              error,
              sessionId: this.hashSessionId(sessionId),
              accountId: session.accountId,
            });
            // Continue to mark session inactive even if vault cleanup fails
          }
        }

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
   * Cache session metadata only (NO TOKENS)
   * Part of centralized token vault architecture
   */
  private async cacheSessionMetadata(session: UserSession): Promise<void> {
    if (!this.cacheService || !this.config.cacheEnabled) {
      return;
    }

    const cacheKey = this.buildSessionCacheKey(session.id);
    const expiresAt = session.expiresAt || new Date(Date.now() + 3600000);
    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    if (ttl > 0) {
      // Cache metadata ONLY (no tokens!)
      const metadata = {
        id: session.id,
        userId: session.userId,
        accountId: session.accountId,
        keycloakSessionId: session.keycloakSessionId,
        expiresAt: session.expiresAt,
        lastAccessedAt: session.lastAccessedAt,
        isActive: session.isActive,
        fingerprint: session.fingerprint,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        // NO TOKENS!
      };

      await this.cacheService.set(cacheKey, metadata, ttl);
      this.logger.debug("Session metadata cached (no tokens)", {
        sessionId: this.hashSessionId(session.id),
        ttl,
      });
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
      // CRITICAL: Database error - fail secure (don't return 0)
      // Returning 0 would bypass concurrent session limits
      this.logger.error("Database error getting active session count", {
        userId,
        error,
      });
      this.metrics?.recordCounter("session.count.database_error", 1);
      throw new Error(
        `Failed to get active session count: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
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
      // Database error - fail loudly (used for security control)
      this.logger.error("Database error getting oldest session", {
        userId,
        error,
      });
      throw new Error(
        `Failed to get oldest session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
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
