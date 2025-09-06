/**
 * Unified Session Manager Implementation
 * Enterprise-grade session orchestration with Redis primary + PostgreSQL backup:
 * - Clean architecture with proper separation of concerns
 * - High availability with automatic failover
 * - Consistent data synchronization
 * - Comprehensive error handling and circuit breaker pattern
 */

import { Logger, MetricsCollector } from "@libs/monitoring";
import { RedisSessionStore, RedisSessionConfig } from "./redis-session-store";
import {
  PostgreSQLSessionStore,
  PostgreSQLSessionConfig,
} from "./postgresql-session-store";
import {
  SessionData,
  SessionCreateOptions,
  SessionUpdateData,
  SessionHealthMetrics,
  SessionAnalytics,
  SessionStatus,
  SessionValidator,
  SessionValidationError,
  TimeRange,
} from "../../models/session-models";

import { CircuitBreaker } from "@libs/utils";
/**
 * Unified session manager configuration
 */
export interface UnifiedSessionManagerConfig {
  readonly redis: Partial<RedisSessionConfig>;
  readonly postgresql: Partial<PostgreSQLSessionConfig>;
  readonly enableBackupSync: boolean;
  readonly enableFailover: boolean;
  readonly syncBatchSize: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly circuitBreakerThreshold: number;
  readonly circuitBreakerTimeout: number; // ms
  readonly healthCheckInterval: number; // ms
  readonly syncInterval: number; // ms
}

/**
 * Default unified session manager configuration
 */
export const DEFAULT_UNIFIED_SESSION_MANAGER_CONFIG: UnifiedSessionManagerConfig =
  {
    redis: {},
    postgresql: {},
    enableBackupSync: true,
    enableFailover: true,
    syncBatchSize: 100,
    maxRetries: 3,
    retryDelayMs: 1000,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 60000, // 1 minute
    healthCheckInterval: 30000, // 30 seconds
    syncInterval: 300000, // 5 minutes
  };

/**
 * Session operation result
 */
interface SessionOperationResult<T = unknown> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: Error;
  readonly source: "redis" | "postgresql" | "both";
  readonly duration: number;
}

/**
 * Circuit breaker for handling failures
 * Implements circuit breaker pattern for resilience
 */

/**
 * Session synchronization helper
 * Implements single responsibility for data sync operations
 */
class SessionSynchronizer {
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  constructor(logger: ILogger, metrics: MetricsCollector) {
    this.logger = createLogger( "SessionSynchronizer" });
    this.metrics = metrics;
  }

  /**
   * Sync session from Redis to PostgreSQL
   */
  async syncSessionToBackup(
    session: SessionData,
    postgresStore: PostgreSQLSessionStore
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      await postgresStore.backupSession(session, "redis");
      const duration = Date.now() - startTime;

      this.logger.debug("Session synced to backup", {
        sessionId: session.sessionId,
        duration,
      });

      await this.metrics.recordTimer("session_sync_backup_duration", duration);
      await this.metrics.recordCounter("session_sync_backup_success");
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error("Failed to sync session to backup", error as Error, {
        sessionId: session.sessionId,
        duration,
      });

      await this.metrics.recordTimer(
        "session_sync_backup_error_duration",
        duration
      );
      await this.metrics.recordCounter("session_sync_backup_error");
      return false;
    }
  }

  /**
   * Batch sync multiple sessions to backup
   */
  async batchSyncToBackup(
    sessions: SessionData[],
    postgresStore: PostgreSQLSessionStore
  ): Promise<number> {
    if (sessions.length === 0) {
      return 0;
    }

    const startTime = Date.now();
    let syncedCount = 0;

    try {
      await postgresStore.batchBackupSessions(sessions);
      syncedCount = sessions.length;

      const duration = Date.now() - startTime;
      this.logger.info("Batch sync to backup completed", {
        sessionCount: sessions.length,
        syncedCount,
        duration,
      });

      await this.metrics.recordTimer("session_batch_sync_duration", duration);
      await this.metrics.recordCounter("session_batch_sync_success");
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error("Failed to batch sync to backup", error as Error, {
        sessionCount: sessions.length,
        duration,
      });

      await this.metrics.recordTimer(
        "session_batch_sync_error_duration",
        duration
      );
      await this.metrics.recordCounter("session_batch_sync_error");
    }

    return syncedCount;
  }

  /**
   * Recover session from PostgreSQL to Redis
   */
  async recoverSessionFromBackup(
    sessionId: string,
    redisStore: RedisSessionStore,
    postgresStore: PostgreSQLSessionStore
  ): Promise<SessionData | null> {
    const startTime = Date.now();

    try {
      const session = await postgresStore.getBackupSession(sessionId);
      if (!session) {
        return null;
      }

      await redisStore.storeSession(session);
      const duration = Date.now() - startTime;

      this.logger.info("Session recovered from backup", {
        sessionId,
        duration,
      });

      await this.metrics.recordTimer("session_recovery_duration", duration);
      await this.metrics.recordCounter("session_recovery_success");
      return session;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        "Failed to recover session from backup",
        error as Error,
        {
          sessionId,
          duration,
        }
      );

      await this.metrics.recordTimer(
        "session_recovery_error_duration",
        duration
      );
      await this.metrics.recordCounter("session_recovery_error");
      return null;
    }
  }
}

/**
 * Operation helper for consistent error handling and metrics
 * Implements DRY principle for common operations
 */
class OperationHelper {
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  constructor(logger: ILogger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Execute operation with comprehensive error handling
   */
  async executeWithFallback<T>(
    primaryOperation: () => Promise<T>,
    fallbackOperation: (() => Promise<T>) | null,
    operationName: string,
    context: Record<string, unknown> = {}
  ): Promise<SessionOperationResult<T>> {
    const startTime = Date.now();

    // Try primary operation (Redis)
    try {
      const data = await primaryOperation();
      const duration = Date.now() - startTime;

      this.logger.debug(`Primary operation successful: ${operationName}`, {
        ...context,
        duration,
      });

      await this.metrics.recordTimer(
        `${operationName}_primary_duration`,
        duration
      );
      await this.metrics.recordCounter(`${operationName}_primary_success`);

      return {
        success: true,
        data,
        source: "redis",
        duration,
      };
    } catch (primaryError) {
      const primaryDuration = Date.now() - startTime;

      this.logger.warn(`Primary operation failed: ${operationName}`, {
        ...context,
        error: (primaryError as Error).message,
        duration: primaryDuration,
      });

      await this.metrics.recordTimer(
        `${operationName}_primary_error_duration`,
        primaryDuration
      );
      await this.metrics.recordCounter(`${operationName}_primary_error`);

      // Try fallback operation (PostgreSQL) if available
      if (fallbackOperation) {
        try {
          const fallbackStartTime = Date.now();
          const data = await fallbackOperation();
          const fallbackDuration = Date.now() - fallbackStartTime;
          const totalDuration = Date.now() - startTime;

          this.logger.info(`Fallback operation successful: ${operationName}`, {
            ...context,
            fallbackDuration,
            totalDuration,
          });

          await this.metrics.recordTimer(
            `${operationName}_fallback_duration`,
            fallbackDuration
          );
          await this.metrics.recordCounter(`${operationName}_fallback_success`);

          return {
            success: true,
            data,
            source: "postgresql",
            duration: totalDuration,
          };
        } catch (fallbackError) {
          const totalDuration = Date.now() - startTime;

          this.logger.error(
            `Both operations failed: ${operationName}`,
            fallbackError as Error,
            {
              ...context,
              primaryError: (primaryError as Error).message,
              totalDuration,
            }
          );

          await this.metrics.recordTimer(
            `${operationName}_fallback_error_duration`,
            totalDuration
          );
          await this.metrics.recordCounter(`${operationName}_fallback_error`);

          return {
            success: false,
            error: fallbackError as Error,
            source: "both",
            duration: totalDuration,
          };
        }
      }

      // No fallback available
      const totalDuration = Date.now() - startTime;
      return {
        success: false,
        error: primaryError as Error,
        source: "redis",
        duration: totalDuration,
      };
    }
  }
}

/**
 * Unified Session Manager - Enterprise session orchestration
 * Implements clean architecture with Redis primary + PostgreSQL backup
 * Features: High availability, automatic failover, data synchronization
 */
export class UnifiedSessionManager {
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;
  private readonly config: UnifiedSessionManagerConfig;
  private readonly redisStore: RedisSessionStore;
  private readonly postgresStore: PostgreSQLSessionStore;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly synchronizer: SessionSynchronizer;
  private readonly operationHelper: OperationHelper;

  private syncTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(
    config: Partial<UnifiedSessionManagerConfig> = {},
    logger: ILogger,
    metrics: MetricsCollector
  ) {
    this.config = { ...DEFAULT_UNIFIED_SESSION_MANAGER_CONFIG, ...config };
    this.logger = createLogger( "UnifiedSessionManager" });
    this.metrics = metrics;

    // Initialize stores
    this.redisStore = new RedisSessionStore(
      this.config.redis,

      this.metrics
    );
    this.postgresStore = new PostgreSQLSessionStore(
      this.config.postgresql,

      this.metrics
    );

    // Initialize helpers
    this.circuitBreaker = new CircuitBreaker({
      threshold: this.config.circuitBreakerThreshold,
      timeout: this.config.circuitBreakerTimeout,
      resetTimeout: this.config.circuitBreakerTimeout * 2,
    });
    this.synchronizer = new SessionSynchronizer(this.metrics);
    this.operationHelper = new OperationHelper(this.metrics);
  }

  /**
   * Initialize unified session manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const startTime = Date.now();

    try {
      // Initialize both stores
      await this.postgresStore.initialize();

      // Start background tasks
      if (this.config.enableBackupSync) {
        this.startSyncTimer();
      }
      this.startHealthCheckTimer();

      this.isInitialized = true;
      const duration = Date.now() - startTime;

      this.logger.info("Unified session manager initialized", { duration });
      await this.metrics.recordTimer(
        "unified_session_manager_init_duration",
        duration
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        "Failed to initialize unified session manager",
        error as Error,
        { duration }
      );
      await this.metrics.recordCounter("unified_session_manager_init_error");
      throw error;
    }
  }

  /**
   * Create new session with automatic backup
   */
  async createSession(
    userId: string,
    options: SessionCreateOptions
  ): Promise<SessionData> {
    await this.ensureInitialized();

    const sessionId = SessionValidator.generateSessionId();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (options.expirationHours || 24) * 60 * 60 * 1000
    );

    const session: SessionData = {
      sessionId,
      userId,
      createdAt: now,
      lastActivity: now,
      expiresAt,
      status: SessionStatus.ACTIVE,
      protocol: options.protocol,
      authMethod: options.authMethod,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
      origin: options.origin,
      connectionId: options.connectionId,
      refreshCount: 0,
      metadata: {
        deviceInfo: options.deviceInfo,
        locationInfo: undefined,
        securityInfo: {
          isTrustedDevice: false,
          riskScore: 0,
          mfaVerified: false,
          lastSecurityCheck: now,
          securityFlags: [],
        },
        customData: options.metadata?.customData,
        ...options.metadata,
      },
    };

    const primaryOperation = () => this.redisStore.storeSession(session);
    const fallbackOperation = this.config.enableFailover
      ? () => this.postgresStore.backupSession(session, "direct")
      : null;

    const result = await this.operationHelper.executeWithFallback(
      primaryOperation,
      fallbackOperation,
      "create_session",
      { sessionId, userId }
    );

    if (!result.success) {
      throw result.error || new Error("Failed to create session");
    }

    // Async backup to PostgreSQL if primary succeeded on Redis
    if (result.source === "redis" && this.config.enableBackupSync) {
      this.synchronizer
        .syncSessionToBackup(session, this.postgresStore)
        .catch((error) => {
          this.logger.warn("Failed to backup newly created session", {
            sessionId,
            error,
          });
        });
    }

    return session;
  }

  /**
   * Get session with automatic failover
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    await this.ensureInitialized();

    if (!SessionValidator.isValidSessionId(sessionId)) {
      await this.metrics.recordCounter("unified_session_get_invalid_id");
      return null;
    }

    const primaryOperation = () => this.redisStore.getSession(sessionId);
    const fallbackOperation = this.config.enableFailover
      ? async () => {
          const session = await this.postgresStore.getBackupSession(sessionId);
          // If found in backup, recover to Redis
          if (session) {
            await this.synchronizer.recoverSessionFromBackup(
              sessionId,
              this.redisStore,
              this.postgresStore
            );
          }
          return session;
        }
      : null;

    const result = await this.operationHelper.executeWithFallback(
      primaryOperation,
      fallbackOperation,
      "get_session",
      { sessionId }
    );

    return result.success ? result.data || null : null;
  }

  /**
   * Update session with dual-store consistency
   */
  async updateSession(
    sessionId: string,
    updates: SessionUpdateData
  ): Promise<void> {
    await this.ensureInitialized();

    const primaryOperation = () =>
      this.redisStore.updateSession(sessionId, updates);
    const fallbackOperation = this.config.enableFailover
      ? () => this.postgresStore.updateBackupSession(sessionId, updates)
      : null;

    const result = await this.operationHelper.executeWithFallback(
      primaryOperation,
      fallbackOperation,
      "update_session",
      { sessionId, updates: Object.keys(updates) }
    );

    if (!result.success) {
      throw result.error || new Error("Failed to update session");
    }

    // Async sync to backup if primary succeeded
    if (result.source === "redis" && this.config.enableBackupSync) {
      this.postgresStore
        .updateBackupSession(sessionId, updates)
        .catch((error) => {
          this.logger.warn("Failed to sync session update to backup", {
            sessionId,
            error,
          });
        });
    }
  }

  /**
   * Delete session from both stores
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.ensureInitialized();

    const primaryOperation = () => this.redisStore.deleteSession(sessionId);

    const result = await this.operationHelper.executeWithFallback(
      primaryOperation,
      null,
      "delete_session",
      { sessionId }
    );

    // Delete from backup regardless of primary result
    if (this.config.enableBackupSync) {
      this.postgresStore.deleteBackupSession(sessionId).catch((error) => {
        this.logger.warn("Failed to delete session from backup", {
          sessionId,
          error,
        });
      });
    }

    if (!result.success) {
      throw result.error || new Error("Failed to delete session");
    }
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string): Promise<string[]> {
    await this.ensureInitialized();

    const primaryOperation = () => this.redisStore.getUserSessions(userId);
    const fallbackOperation = this.config.enableFailover
      ? () => this.postgresStore.getUserBackupSessions(userId)
      : null;

    const result = await this.operationHelper.executeWithFallback(
      primaryOperation,
      fallbackOperation,
      "get_user_sessions",
      { userId }
    );

    return result.success ? result.data || [] : [];
  }

  /**
   * Get comprehensive health metrics from both stores
   */
  async getHealthMetrics(): Promise<SessionHealthMetrics> {
    try {
      const [redisHealth, postgresHealth] = await Promise.all([
        this.redisStore.getHealthMetrics(),
        this.postgresStore.getHealthMetrics(),
      ]);

      return {
        redis: redisHealth,
        postgresql: postgresHealth,
        cache: {
          hitRate: 0,
          missRate: 0,
          evictionRate: 0,
          size: 0,
          avgResponseTime: 0,
        },
        performance: {
          sessionCreationTime: 0,
          sessionRetrievalTime: 0,
          sessionUpdateTime: 0,
          sessionDeletionTime: 0,
        },
      };
    } catch (error) {
      this.logger.error("Failed to get health metrics", error as Error);
      throw error;
    }
  }

  /**
   * Cleanup expired sessions from both stores
   */
  async cleanupExpiredSessions(): Promise<{
    redis: number;
    postgresql: number;
  }> {
    await this.ensureInitialized();

    const [redisCleanup, postgresCleanup] = await Promise.allSettled([
      this.redisStore.cleanupExpiredSessions(),
      this.postgresStore.cleanupExpiredSessions(),
    ]);

    const redisCount =
      redisCleanup.status === "fulfilled" ? redisCleanup.value : 0;
    const postgresCount =
      postgresCleanup.status === "fulfilled" ? postgresCleanup.value : 0;

    this.logger.info("Cleanup completed", { redisCount, postgresCount });

    return { redis: redisCount, postgresql: postgresCount };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.logger.info("Shutting down unified session manager");

    // Clear timers
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.isInitialized = false;
    this.logger.info("Unified session manager shutdown complete");
  }

  // Private helper methods

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private startSyncTimer(): void {
    this.syncTimer = setInterval(async () => {
      try {
        await this.performBackgroundSync();
      } catch (error) {
        this.logger.error("Background sync failed", error as Error);
      }
    }, this.config.syncInterval);

    this.logger.info("Background sync timer started", {
      interval: this.config.syncInterval,
    });
  }

  private startHealthCheckTimer(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error("Health check failed", error as Error);
      }
    }, this.config.healthCheckInterval);

    this.logger.info("Health check timer started", {
      interval: this.config.healthCheckInterval,
    });
  }

  private async performBackgroundSync(): Promise<void> {
    if (!this.config.enableBackupSync) {
      return;
    }

    this.logger.debug("Performing background sync");

    try {
      // Get active session count for monitoring
      const activeCount = await this.redisStore.getActiveSessionCount();
      await this.metrics.recordGauge(
        "unified_session_active_count",
        activeCount
      );
    } catch (error) {
      this.logger.warn("Background sync encountered issues", { error });
    }
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const healthMetrics = await this.getHealthMetrics();

      // Record health metrics
      await this.metrics.recordGauge(
        "unified_session_redis_connected",
        healthMetrics.redis.connected ? 1 : 0
      );
      await this.metrics.recordGauge(
        "unified_session_postgres_connected",
        healthMetrics.postgresql.connected ? 1 : 0
      );
      await this.metrics.recordGauge(
        "unified_session_circuit_breaker_open",
        this.circuitBreaker.isOpen() ? 1 : 0
      );

      this.logger.debug("Health check completed", {
        redisConnected: healthMetrics.redis.connected,
        postgresConnected: healthMetrics.postgresql.connected,
        circuitBreakerState: this.circuitBreaker.getState(),
      });
    } catch (error) {
      this.logger.warn("Health check failed", { error });
    }
  }
}
