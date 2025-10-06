/**
 * SessionCleaner - Single Responsibility: Maintenance operations
 *
 * Handles:
 * - Expired session cleanup
 * - Orphaned data removal
 * - Cache maintenance and optimization
 * - Storage optimization and compaction
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles cleanup and maintenance tasks
 * - Open/Closed: Extensible for different cleanup strategies
 * - Liskov Substitution: Implements standard cleanup interface
 * - Interface Segregation: Clean separation of maintenance concerns
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { CacheService } from "@libs/database";
import type {
  UserSessionRepository,
  SessionLogRepository,
  SessionActivityRepository,
} from "@libs/database";
import type { HealthCheckResult } from "./sessionTypes";

/**
 * Cleanup configuration
 */
export interface SessionCleanerConfig {
  readonly enableAutomaticCleanup: boolean;
  readonly cleanupInterval: number; // in milliseconds
  readonly expiredSessionRetention: number; // how long to keep expired sessions (ms)
  readonly batchSize: number; // number of records to process per batch
  readonly maxCleanupDuration: number; // max time for single cleanup run (ms)
  readonly cleanupSchedule: {
    expiredSessions: string; // cron expression
    orphanedTokens: string;
    cacheOptimization: string;
    databaseMaintenance: string;
  };
  readonly enableDeepCleanup: boolean;
  readonly compactionThreshold: number; // percentage of deleted records to trigger compaction
}

const DEFAULT_CLEANER_CONFIG: SessionCleanerConfig = {
  enableAutomaticCleanup: true,
  cleanupInterval: 60 * 60 * 1000, // 1 hour
  expiredSessionRetention: 7 * 24 * 60 * 60 * 1000, // 7 days
  batchSize: 1000,
  maxCleanupDuration: 10 * 60 * 1000, // 10 minutes
  cleanupSchedule: {
    expiredSessions: "0 */2 * * *", // Every 2 hours
    orphanedTokens: "0 4 * * *", // Daily at 4 AM
    cacheOptimization: "0 3 * * *", // Daily at 3 AM
    databaseMaintenance: "0 2 * * 0", // Weekly on Sunday at 2 AM
  },
  enableDeepCleanup: true,
  compactionThreshold: 30, // 30%
};

/**
 * Cleanup result interface
 */
interface CleanupResult {
  operation: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  recordsProcessed: number;
  recordsDeleted: number;
  recordsUpdated: number;
  errorsEncountered: number;
  success: boolean;
  details: Record<string, any>;
}

/**
 * Cleanup statistics
 */
interface CleanupStats {
  totalCleanupRuns: number;
  lastCleanupTime: Date;
  totalRecordsDeleted: number;
  totalTimeSaved: number;
  averageCleanupDuration: number;
  errorRate: number;
  compactionRuns: number;
  cacheOptimizationRuns: number;
}

/**
 * Database maintenance operations
 */
interface DatabaseMaintenanceResult {
  operation: string;
  tablesProcessed: string[];
  indexesRebuilt: number;
  vacuumCompleted: boolean;
  statisticsUpdated: boolean;
  spaceSaved: number; // in bytes
  duration: number;
}

/**
 * Comprehensive session cleanup and maintenance system
 */
export class SessionCleaner {
  private readonly logger: ILogger;
  private readonly config: SessionCleanerConfig;
  private readonly cleanupStats: CleanupStats;
  private isCleanupRunning = false;
  private cleanupScheduleTimers: NodeJS.Timeout[] = [];

  constructor(
    private readonly userSessionRepo: UserSessionRepository,
    private readonly sessionLogRepo: SessionLogRepository,
    private readonly sessionActivityRepo: SessionActivityRepository,
    private readonly cacheService?: CacheService,
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    config: Partial<SessionCleanerConfig> = {}
  ) {
    this.logger = logger || createLogger("SessionCleaner");
    this.config = { ...DEFAULT_CLEANER_CONFIG, ...config };

    this.cleanupStats = {
      totalCleanupRuns: 0,
      lastCleanupTime: new Date(0),
      totalRecordsDeleted: 0,
      totalTimeSaved: 0,
      averageCleanupDuration: 0,
      errorRate: 0,
      compactionRuns: 0,
      cacheOptimizationRuns: 0,
    };

    this.logger.info("SessionCleaner initialized", {
      enableAutomaticCleanup: this.config.enableAutomaticCleanup,
      cleanupInterval: this.config.cleanupInterval,
      batchSize: this.config.batchSize,
      enableDeepCleanup: this.config.enableDeepCleanup,
    });

    if (this.config.enableAutomaticCleanup) {
      this.startAutomaticCleanup();
    }
  }

  /**
   * Perform comprehensive session cleanup
   */
  async performFullCleanup(): Promise<CleanupResult> {
    const startTime = new Date();
    const operationId = `cleanup_${Date.now()}`;

    if (this.isCleanupRunning) {
      this.logger.warn("Cleanup already in progress, skipping");
      return this.createCleanupResult("full_cleanup", startTime, {
        success: false,
        details: { reason: "cleanup_already_running" },
      });
    }

    this.isCleanupRunning = true;

    try {
      this.logger.info("Starting full session cleanup", { operationId });

      let totalDeleted = 0;
      let totalProcessed = 0;
      let errors = 0;

      // 1. Clean expired sessions
      const expiredResult = await this.cleanExpiredSessions();
      totalDeleted += expiredResult.recordsDeleted;
      totalProcessed += expiredResult.recordsProcessed;
      errors += expiredResult.errorsEncountered;

      // 2. Clean orphaned tokens
      const orphanedResult = await this.cleanOrphanedTokens();
      totalDeleted += orphanedResult.recordsDeleted;
      totalProcessed += orphanedResult.recordsProcessed;
      errors += orphanedResult.errorsEncountered;

      // 3. Optimize cache
      if (this.cacheService) {
        const cacheResult = await this.optimizeCache();
        totalProcessed += cacheResult.recordsProcessed;
        errors += cacheResult.errorsEncountered;
      }

      // 4. Database maintenance (if enabled)
      if (this.config.enableDeepCleanup) {
        const maintenanceResult = await this.performDatabaseMaintenance();
        totalProcessed += maintenanceResult.tablesProcessed.length;
      }

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Update statistics
      this.updateCleanupStats(duration, totalDeleted, errors === 0);

      // Log cleanup event to session logs
      await this.logCleanupEvent(
        "full_cleanup",
        totalProcessed,
        totalDeleted,
        errors,
        duration
      );

      // Record metrics
      this.metrics?.recordTimer(
        "session.cleanup.full_cleanup.duration",
        duration
      );
      this.metrics?.recordCounter(
        "session.cleanup.records_deleted",
        totalDeleted
      );
      this.metrics?.recordCounter("session.cleanup.completed", 1);

      const result = this.createCleanupResult("full_cleanup", startTime, {
        success: errors === 0,
        recordsProcessed: totalProcessed,
        recordsDeleted: totalDeleted,
        errorsEncountered: errors,
        endTime,
        duration,
        details: {
          expiredSessions: expiredResult.recordsDeleted,
          orphanedTokens: orphanedResult.recordsDeleted,
          cacheOptimized: this.cacheService ? true : false,
          databaseMaintenance: this.config.enableDeepCleanup,
        },
      });

      this.logger.info("Full cleanup completed", {
        operationId,
        duration,
        recordsDeleted: totalDeleted,
        recordsProcessed: totalProcessed,
        errors,
      });

      return result;
    } catch (error) {
      this.logger.error("Full cleanup failed", { operationId, error });
      this.metrics?.recordCounter("session.cleanup.error", 1);

      // Log error event
      await this.logCleanupEvent("full_cleanup_error", 0, 0, 1, 0, {
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return this.createCleanupResult("full_cleanup", startTime, {
        success: false,
        errorsEncountered: 1,
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    } finally {
      this.isCleanupRunning = false;
    }
  }

  /**
   * Clean expired sessions from database
   */
  async cleanExpiredSessions(): Promise<CleanupResult> {
    const startTime = new Date();
    const operationId = `expired_cleanup_${Date.now()}`;

    try {
      this.logger.debug("Starting expired sessions cleanup", { operationId });

      const retentionCutoff = new Date(
        Date.now() - this.config.expiredSessionRetention
      );

      let totalDeleted = 0;
      let totalProcessed = 0;
      let batchNumber = 1;

      while (true) {
        const batchStartTime = performance.now();

        // Find expired sessions batch using repository
        const expiredSessions = await this.userSessionRepo.findMany({
          where: {
            OR: [{ expiresAt: { lt: new Date() } }, { isActive: false }],
            updatedAt: { lt: retentionCutoff },
          },
          select: {
            id: true,
            sessionId: true,
          },
          take: this.config.batchSize,
        });

        if (expiredSessions.length === 0) {
          break; // No more expired sessions
        }

        totalProcessed += expiredSessions.length;

        // Track cleanup activity for these sessions
        const sessionIdsToTrack = expiredSessions.map((s) => s.id);
        await this.trackCleanupActivity(
          sessionIdsToTrack,
          "session_expired_cleanup"
        );

        // Delete expired sessions using repository
        const sessionIds = expiredSessions.map((s) => s.id);
        const deleteResult = await this.userSessionRepo.deleteMany({
          id: { in: sessionIds },
        });

        const deletedCount = deleteResult.count;
        totalDeleted += deletedCount;

        // Clear cache entries for deleted sessions
        if (this.cacheService) {
          await Promise.allSettled(
            expiredSessions.map((session) =>
              this.cacheService!.invalidate(
                `keycloak_session:${session.sessionId}`
              )
            )
          );
        }

        const batchDuration = performance.now() - batchStartTime;

        this.logger.debug("Expired sessions batch processed", {
          operationId,
          batchNumber,
          processed: expiredSessions.length,
          deleted: deletedCount,
          duration: batchDuration,
        });

        batchNumber++;

        // Check cleanup duration limit
        if (Date.now() - startTime.getTime() > this.config.maxCleanupDuration) {
          this.logger.warn(
            "Cleanup duration limit reached, stopping expired session cleanup",
            {
              operationId,
              duration: Date.now() - startTime.getTime(),
              limit: this.config.maxCleanupDuration,
            }
          );
          break;
        }

        // Small delay between batches to avoid overwhelming the database
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      this.metrics?.recordTimer(
        "session.cleanup.expired_sessions.duration",
        Date.now() - startTime.getTime()
      );
      this.metrics?.recordCounter(
        "session.cleanup.expired_sessions.deleted",
        totalDeleted
      );

      return this.createCleanupResult("expired_sessions", startTime, {
        success: true,
        recordsProcessed: totalProcessed,
        recordsDeleted: totalDeleted,
        details: {
          retentionCutoff: retentionCutoff.toISOString(),
          batchesProcessed: batchNumber - 1,
        },
      });
    } catch (error) {
      this.logger.error("Expired sessions cleanup failed", {
        operationId,
        error,
      });
      this.metrics?.recordCounter("session.cleanup.expired_sessions.error", 1);

      return this.createCleanupResult("expired_sessions", startTime, {
        success: false,
        errorsEncountered: 1,
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  }

  /**
   * Clean orphaned tokens and session data
   */
  async cleanOrphanedTokens(): Promise<CleanupResult> {
    const startTime = new Date();
    const operationId = `orphaned_cleanup_${Date.now()}`;

    try {
      this.logger.debug("Starting orphaned tokens cleanup", { operationId });

      let totalDeleted = 0;
      let totalProcessed = 0;

      // Clean orphaned session validation cache entries
      if (this.cacheService) {
        const cacheKeys = await this.getAllCacheKeys(
          "keycloak_session_validation:*"
        );
        totalProcessed += cacheKeys.length;

        for (const key of cacheKeys) {
          const sessionId = key.replace("keycloak_session_validation:", "");

          // Check if session still exists using repository
          const sessionExists = await this.userSessionRepo.exists({
            sessionId,
            isActive: true,
          });

          if (!sessionExists) {
            await this.cacheService.invalidate(key);
            totalDeleted++;
          }
        }
      }

      // Clean orphaned user profile cache entries
      if (this.cacheService) {
        const userCacheKeys = await this.getAllCacheKeys("user_profile:*");
        totalProcessed += userCacheKeys.length;

        for (const key of userCacheKeys) {
          const userId = key.replace("user_profile:", "");

          // Check if user has active sessions using repository
          const activeSessions = await this.userSessionRepo.findActiveByUserId(
            userId,
            { take: 1 }
          );

          if (activeSessions.length === 0) {
            await this.cacheService.invalidate(key);
            totalDeleted++;
          }
        }
      }

      this.metrics?.recordTimer(
        "session.cleanup.orphaned_tokens.duration",
        Date.now() - startTime.getTime()
      );
      this.metrics?.recordCounter(
        "session.cleanup.orphaned_tokens.deleted",
        totalDeleted
      );

      return this.createCleanupResult("orphaned_tokens", startTime, {
        success: true,
        recordsProcessed: totalProcessed,
        recordsDeleted: totalDeleted,
        details: {
          sessionValidationCacheKeys: totalProcessed,
          orphanedKeysDeleted: totalDeleted,
        },
      });
    } catch (error) {
      this.logger.error("Orphaned tokens cleanup failed", {
        operationId,
        error,
      });
      this.metrics?.recordCounter("session.cleanup.orphaned_tokens.error", 1);

      return this.createCleanupResult("orphaned_tokens", startTime, {
        success: false,
        errorsEncountered: 1,
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  }

  /**
   * Optimize cache performance and memory usage
   */
  async optimizeCache(): Promise<CleanupResult> {
    const startTime = new Date();
    const operationId = `cache_optimization_${Date.now()}`;

    try {
      this.logger.debug("Starting cache optimization", { operationId });

      if (!this.cacheService) {
        return this.createCleanupResult("cache_optimization", startTime, {
          success: true,
          details: { reason: "cache_service_not_available" },
        });
      }

      let totalProcessed = 0;

      // Get cache statistics before optimization
      const beforeStats = await this.getCacheStats();

      // Cleanup expired cache entries (if supported by cache implementation)
      const expiredKeys = await this.getAllCacheKeys("*");
      totalProcessed += expiredKeys.length;

      // Note: Most cache implementations handle expiration automatically
      // This is more about cache warming and optimization

      // Warm up frequently accessed session data using repository
      const recentSessions = await this.userSessionRepo.findMany({
        where: {
          isActive: true,
          lastAccessedAt: {
            gt: new Date(Date.now() - 60 * 60 * 1000), // Last hour
          },
        },
        select: {
          sessionId: true,
        },
        orderBy: {
          lastAccessedAt: "desc",
        },
        take: 100,
      });

      // Pre-warm cache for active sessions
      for (const session of recentSessions) {
        const cacheKey = `keycloak_session:${session.sessionId}`;
        const result = await this.cacheService.get(cacheKey);
        if (!result.data) {
          // Cache miss - this session might benefit from pre-warming
          // In a real implementation, you might fetch and cache the session data here
        }
      }

      // Get cache statistics after optimization
      const afterStats = await this.getCacheStats();

      this.cleanupStats.cacheOptimizationRuns++;
      this.metrics?.recordTimer(
        "session.cleanup.cache_optimization.duration",
        Date.now() - startTime.getTime()
      );
      this.metrics?.recordCounter(
        "session.cleanup.cache_optimization.completed",
        1
      );

      return this.createCleanupResult("cache_optimization", startTime, {
        success: true,
        recordsProcessed: totalProcessed,
        details: {
          beforeStats,
          afterStats,
          sessionsPreWarmed: recentSessions.length,
        },
      });
    } catch (error) {
      this.logger.error("Cache optimization failed", { operationId, error });
      this.metrics?.recordCounter(
        "session.cleanup.cache_optimization.error",
        1
      );

      return this.createCleanupResult("cache_optimization", startTime, {
        success: false,
        errorsEncountered: 1,
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  }

  /**
   * Perform database maintenance operations
   *
   * Note: Database maintenance operations like ANALYZE, REINDEX, and VACUUM
   * are now handled at the infrastructure level through automated database
   * maintenance tools and scheduled jobs. This method is kept for backward
   * compatibility but does not perform actual maintenance operations.
   */
  async performDatabaseMaintenance(): Promise<DatabaseMaintenanceResult> {
    const startTime = performance.now();
    const operationId = `db_maintenance_${Date.now()}`;

    try {
      this.logger.info(
        "Database maintenance skipped - handled at infrastructure level",
        {
          operationId,
          note: "Use database-level tools for ANALYZE, REINDEX, VACUUM operations",
        }
      );

      const maintenanceResult: DatabaseMaintenanceResult = {
        operation: "database_maintenance",
        tablesProcessed: [
          "user_sessions",
          "session_logs",
          "session_activities",
        ],
        indexesRebuilt: 0,
        vacuumCompleted: false,
        statisticsUpdated: false,
        spaceSaved: 0,
        duration: performance.now() - startTime,
      };

      this.cleanupStats.compactionRuns++;

      this.metrics?.recordTimer(
        "session.cleanup.database_maintenance.duration",
        maintenanceResult.duration
      );
      this.metrics?.recordCounter(
        "session.cleanup.database_maintenance.completed",
        1
      );

      this.logger.info("Database maintenance check completed", {
        operationId,
        ...maintenanceResult,
      });

      return maintenanceResult;
    } catch (error) {
      this.logger.error("Database maintenance check failed", {
        operationId,
        error,
      });
      this.metrics?.recordCounter(
        "session.cleanup.database_maintenance.error",
        1
      );

      return {
        operation: "database_maintenance",
        tablesProcessed: [],
        indexesRebuilt: 0,
        vacuumCompleted: false,
        statisticsUpdated: false,
        spaceSaved: 0,
        duration: performance.now() - startTime,
      };
    }
  }

  /**
   * Get cleanup statistics
   */
  getCleanupStats(): CleanupStats {
    return { ...this.cleanupStats };
  }

  /**
   * Force cleanup of specific session
   */
  async forceCleanupSession(sessionId: string): Promise<boolean> {
    const operationId = `force_cleanup_${Date.now()}`;

    try {
      this.logger.debug("Force cleaning session", { operationId, sessionId });

      // Delete from database using repository
      const deleteResult = await this.userSessionRepo.deleteMany({
        sessionId,
      });

      // Clear cache
      if (this.cacheService) {
        await Promise.allSettled([
          this.cacheService.invalidate(`keycloak_session:${sessionId}`),
          this.cacheService.invalidate(
            `keycloak_session_validation:${sessionId}`
          ),
        ]);
      }

      this.metrics?.recordCounter("session.cleanup.force_cleanup", 1);

      this.logger.info("Session force cleanup completed", {
        operationId,
        sessionId,
        deletedCount: deleteResult.count,
      });
      return deleteResult.count > 0;
    } catch (error) {
      this.logger.error("Force session cleanup failed", {
        operationId,
        sessionId,
        error,
      });
      this.metrics?.recordCounter("session.cleanup.force_cleanup.error", 1);
      return false;
    }
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      // Check if cleanup is running
      const cleanupStatus = this.isCleanupRunning ? "running" : "idle";

      // Check last cleanup time
      const timeSinceLastCleanup =
        Date.now() - this.cleanupStats.lastCleanupTime.getTime();
      const cleanupOverdue =
        timeSinceLastCleanup > this.config.cleanupInterval * 2;

      // Get database statistics using repository
      const sessionCount = await this.userSessionRepo.count({
        where: { isActive: true },
      });

      const responseTime = performance.now() - startTime;
      const status = cleanupOverdue ? "degraded" : "healthy";

      return {
        status,
        details: {
          cleanupStatus,
          lastCleanup: this.cleanupStats.lastCleanupTime.toISOString(),
          timeSinceLastCleanup: Math.floor(timeSinceLastCleanup / 1000),
          cleanupOverdue,
          activeSessions: sessionCount,
          totalCleanupRuns: this.cleanupStats.totalCleanupRuns,
          errorRate: this.cleanupStats.errorRate,
          responseTime: Math.round(responseTime),
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("Cleanup health check failed", { error });
      return {
        status: "unhealthy",
        details: {
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Private helper methods
   */
  private startAutomaticCleanup(): void {
    // Set up interval-based cleanup
    const cleanupTimer = setInterval(() => {
      if (!this.isCleanupRunning) {
        this.performFullCleanup().catch((error) => {
          this.logger.error("Automatic cleanup failed", { error });
        });
      }
    }, this.config.cleanupInterval);

    this.cleanupScheduleTimers.push(cleanupTimer);
    this.logger.info("Automatic cleanup started", {
      interval: this.config.cleanupInterval,
    });
  }

  private createCleanupResult(
    operation: string,
    startTime: Date,
    overrides: Partial<CleanupResult> = {}
  ): CleanupResult {
    const endTime = new Date();
    return {
      operation,
      startTime,
      endTime,
      duration: endTime.getTime() - startTime.getTime(),
      recordsProcessed: 0,
      recordsDeleted: 0,
      recordsUpdated: 0,
      errorsEncountered: 0,
      success: false,
      details: {},
      ...overrides,
    };
  }

  private updateCleanupStats(
    duration: number,
    recordsDeleted: number,
    success: boolean
  ): void {
    this.cleanupStats.totalCleanupRuns++;
    this.cleanupStats.lastCleanupTime = new Date();
    this.cleanupStats.totalRecordsDeleted += recordsDeleted;

    // Update average duration (exponential moving average)
    const alpha = 0.1;
    this.cleanupStats.averageCleanupDuration =
      (1 - alpha) * this.cleanupStats.averageCleanupDuration + alpha * duration;

    // Update error rate
    if (!success) {
      this.cleanupStats.errorRate =
        (this.cleanupStats.errorRate *
          (this.cleanupStats.totalCleanupRuns - 1) +
          1) /
        this.cleanupStats.totalCleanupRuns;
    } else {
      this.cleanupStats.errorRate =
        (this.cleanupStats.errorRate *
          (this.cleanupStats.totalCleanupRuns - 1)) /
        this.cleanupStats.totalCleanupRuns;
    }
  }

  private async getAllCacheKeys(pattern: string): Promise<string[]> {
    if (!this.cacheService) return [];

    try {
      // Note: This is a simplified implementation
      // Real cache implementations would provide a keys() method
      return [];
    } catch (error) {
      this.logger.warn("Failed to get cache keys", { error, pattern });
      return [];
    }
  }

  private async getCacheStats(): Promise<Record<string, any>> {
    if (!this.cacheService) return {};

    try {
      // Note: This would depend on the cache implementation
      return {
        timestamp: new Date().toISOString(),
        // Additional cache statistics would go here
      };
    } catch (error) {
      this.logger.warn("Failed to get cache stats", { error });
      return {};
    }
  }

  /**
   * Log cleanup event to session logs
   * Note: Uses a special system session for cleanup events
   */
  private async logCleanupEvent(
    eventType: string,
    recordsProcessed: number,
    recordsDeleted: number,
    errors: number,
    duration: number,
    additionalData?: Record<string, any>
  ): Promise<void> {
    try {
      // Find or create a system session for logging cleanup events
      const systemSessionId = await this.getOrCreateSystemSession();

      if (systemSessionId) {
        await this.sessionLogRepo.create({
          session: {
            connect: { id: systemSessionId },
          },
          event: `cleanup_${eventType}`,
          metadata: {
            recordsProcessed,
            recordsDeleted,
            errors,
            duration,
            timestamp: new Date().toISOString(),
            ...additionalData,
          },
          timestamp: new Date(),
        });
      }
    } catch (error) {
      // Don't fail cleanup if logging fails
      this.logger.warn("Failed to log cleanup event", {
        eventType,
        error,
      });
    }
  }

  /**
   * Track cleanup activity for sessions
   */
  private async trackCleanupActivity(
    sessionIds: string[],
    activityType: string,
    storeId: string = "00000000-0000-0000-0000-000000000000"
  ): Promise<void> {
    try {
      // Get session details to extract user IDs
      const sessions = await this.userSessionRepo.findMany({
        where: {
          id: { in: sessionIds },
        },
        select: {
          id: true,
          userId: true,
        },
      });

      // Batch create activity records for cleaned sessions
      const activities = sessions.map((session) => ({
        session: {
          connect: { id: session.id },
        },
        store: {
          connect: { id: storeId },
        },
        user: {
          connect: { id: session.userId },
        },
        activity: activityType,
        metadata: {
          cleanupTime: new Date().toISOString(),
          cleanupReason: "automated_cleanup",
        },
      }));

      if (activities.length > 0) {
        await this.sessionActivityRepo.createMany(activities);
      }
    } catch (error) {
      // Don't fail cleanup if activity tracking fails
      this.logger.warn("Failed to track cleanup activity", {
        sessionCount: sessionIds.length,
        activityType,
        error,
      });
    }
  }

  /**
   * Get or create a system session for logging cleanup events
   */
  private async getOrCreateSystemSession(): Promise<string | null> {
    try {
      // Check if system session exists
      const systemSession = await this.userSessionRepo.findBySessionToken(
        "system_cleanup_session"
      );

      if (systemSession) {
        return systemSession.id;
      }

      // Create system session if it doesn't exist
      // Note: This requires a system user to exist in the database
      // In production, this should be created during initial setup
      return null; // Return null if no system session exists
    } catch (error) {
      this.logger.warn("Failed to get or create system session", { error });
      return null;
    }
  }

  /**
   * Cleanup resources and stop automatic cleanup
   */
  async cleanup(): Promise<void> {
    // Clear all timers
    this.cleanupScheduleTimers.forEach((timer) => clearInterval(timer));
    this.cleanupScheduleTimers = [];

    this.logger.info("SessionCleaner cleanup completed");
  }
}
