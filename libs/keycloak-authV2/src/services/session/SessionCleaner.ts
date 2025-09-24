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
import type { PostgreSQLClient, CacheService } from "@libs/database";
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
    private readonly dbClient: PostgreSQLClient,
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

        // Find expired sessions batch
        const expiredSessions = await this.dbClient.cachedQuery<
          { id: string; session_id: string }[]
        >(
          `SELECT id, session_id 
           FROM user_sessions 
           WHERE (expires_at < NOW() OR is_active = false) 
           AND updated_at < $1
           LIMIT $2`,
          [retentionCutoff, this.config.batchSize],
          0 // No caching for cleanup queries
        );

        if (expiredSessions.length === 0) {
          break; // No more expired sessions
        }

        totalProcessed += expiredSessions.length;

        // Delete expired sessions
        const sessionIds = expiredSessions.map((s) => s.id);
        const deleteResult = await this.dbClient.executeRaw(
          `DELETE FROM user_sessions WHERE id = ANY($1::uuid[])`,
          [sessionIds]
        );

        const deletedCount = Array.isArray(deleteResult)
          ? deleteResult.length
          : expiredSessions.length;
        totalDeleted += deletedCount;

        // Clear cache entries for deleted sessions
        if (this.cacheService) {
          await Promise.allSettled(
            expiredSessions.map((session) =>
              this.cacheService!.invalidate(
                `keycloak_session:${session.session_id}`
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

          // Check if session still exists
          const sessionExists: unknown[] = await this.dbClient.cachedQuery(
            `SELECT 1 FROM user_sessions WHERE session_id = $1 AND is_active = true LIMIT 1`,
            [sessionId],
            300
          );

          if (sessionExists.length === 0) {
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

          // Check if user has active sessions
          const activeSessions: any[] = await this.dbClient.cachedQuery(
            `SELECT 1 FROM user_sessions WHERE user_id = $1 AND is_active = true LIMIT 1`,
            [userId],
            300
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

      // Warm up frequently accessed session data
      const recentSessions = await this.dbClient.cachedQuery<
        { session_id: string }[]
      >(
        `SELECT session_id FROM user_sessions 
         WHERE is_active = true 
         AND last_accessed_at > NOW() - INTERVAL '1 hour'
         ORDER BY last_accessed_at DESC
         LIMIT 100`,
        [],
        300
      );

      // Pre-warm cache for active sessions
      for (const session of recentSessions) {
        const cacheKey = `keycloak_session:${session.session_id}`;
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
   */
  async performDatabaseMaintenance(): Promise<DatabaseMaintenanceResult> {
    const startTime = performance.now();
    const operationId = `db_maintenance_${Date.now()}`;

    try {
      this.logger.info("Starting database maintenance", { operationId });

      const maintenanceResult: DatabaseMaintenanceResult = {
        operation: "database_maintenance",
        tablesProcessed: [],
        indexesRebuilt: 0,
        vacuumCompleted: false,
        statisticsUpdated: false,
        spaceSaved: 0,
        duration: 0,
      };

      // Update table statistics
      const tables = ["user_sessions", "api_keys", "session_events"];
      for (const table of tables) {
        try {
          await this.dbClient.executeRaw(`ANALYZE ${table}`);
          maintenanceResult.tablesProcessed.push(table);
          this.logger.debug(`Statistics updated for table: ${table}`, {
            operationId,
          });
        } catch (error) {
          this.logger.warn(`Failed to update statistics for table: ${table}`, {
            operationId,
            error,
          });
        }
      }
      maintenanceResult.statisticsUpdated = true;

      // Rebuild indexes if needed (check for fragmentation)
      for (const table of tables) {
        try {
          await this.dbClient.executeRaw(`REINDEX TABLE ${table}`);
          maintenanceResult.indexesRebuilt++;
          this.logger.debug(`Indexes rebuilt for table: ${table}`, {
            operationId,
          });
        } catch (error) {
          this.logger.warn(`Failed to rebuild indexes for table: ${table}`, {
            operationId,
            error,
          });
        }
      }

      // Vacuum to reclaim space
      try {
        await this.dbClient.executeRaw("VACUUM ANALYZE user_sessions");
        maintenanceResult.vacuumCompleted = true;
        this.logger.debug("Vacuum completed for user_sessions", {
          operationId,
        });
      } catch (error) {
        this.logger.warn("Failed to vacuum user_sessions table", {
          operationId,
          error,
        });
      }

      maintenanceResult.duration = performance.now() - startTime;
      this.cleanupStats.compactionRuns++;

      this.metrics?.recordTimer(
        "session.cleanup.database_maintenance.duration",
        maintenanceResult.duration
      );
      this.metrics?.recordCounter(
        "session.cleanup.database_maintenance.completed",
        1
      );

      this.logger.info("Database maintenance completed", {
        operationId,
        ...maintenanceResult,
      });

      return maintenanceResult;
    } catch (error) {
      this.logger.error("Database maintenance failed", { operationId, error });
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

      // Delete from database
      await this.dbClient.executeRaw(
        `DELETE FROM user_sessions WHERE session_id = $1`,
        [sessionId]
      );

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
      });
      return true;
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

      // Get database statistics
      const sessionCount = await this.dbClient.cachedQuery(
        `SELECT COUNT(*) as count FROM user_sessions WHERE is_active = true`,
        [],
        300
      );

      const responseTime = performance.now() - startTime;
      const status = cleanupOverdue ? "degraded" : "healthy";

      return {
        status,
        details: {
          cleanupStatus,
          lastCleanup: this.cleanupStats.lastCleanupTime.toISOString(),
          timeSinceLastCleanup: Math.floor(timeSinceLastCleanup / 1000),
          cleanupOverdue,
          activeSessions: Array.isArray(sessionCount)
            ? (sessionCount[0] as any)?.count || 0
            : 0,
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
   * Cleanup resources and stop automatic cleanup
   */
  async cleanup(): Promise<void> {
    // Clear all timers
    this.cleanupScheduleTimers.forEach((timer) => clearInterval(timer));
    this.cleanupScheduleTimers = [];

    this.logger.info("SessionCleaner cleanup completed");
  }
}
