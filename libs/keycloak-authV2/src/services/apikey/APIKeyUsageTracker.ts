/**
 * APIKeyUsageTracker - Focused usage tracking and analytics
 *
 * Responsibilities:
 * - Track API key usage (usage count, last used timestamp)
 * - Generate usage analytics and statistics
 * - Rate limiting integration (usage-based limits)
 * - Usage pattern analysis
 * - Metrics and monitoring integration
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles usage tracking and analytics
 * - Open/Closed: Extensible for new usage metrics
 * - Liskov Substitution: Implements standard usage tracker interface
 * - Interface Segregation: Clean separation of usage concerns
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import { performance } from "perf_hooks";
import crypto from "crypto";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient } from "@libs/database";

export interface UsageStats {
  totalUsage: number;
  dailyUsage: number;
  weeklyUsage: number;
  monthlyUsage: number;
  averageUsagePerDay: number;
  lastUsedAt?: Date | undefined;
  firstUsedAt?: Date | undefined;
}

export interface APIKeyUsageInfo {
  keyId: string;
  name: string;
  userId: string;
  usageCount: number;
  lastUsedAt?: Date;
  createdAt: Date;
}

export interface UsageAnalytics {
  totalKeys: number;
  activeKeys: number;
  keysUsedToday: number;
  keysUsedThisWeek: number;
  keysUsedThisMonth: number;
  totalUsage: number;
  averageUsagePerKey: number;
  mostUsedKeys: APIKeyUsageInfo[];
  leastUsedKeys: APIKeyUsageInfo[];
  usageTrends: {
    daily: number[];
    weekly: number[];
    monthly: number[];
  };
}

export interface APIKeyUsageTrackerConfig {
  readonly enableAsyncUpdates: boolean;
  readonly batchUpdateInterval: number; // milliseconds
  readonly maxBatchSize: number;
  readonly enableUsageAnalytics: boolean;
  readonly analyticsRetentionDays: number;
}

const DEFAULT_USAGE_TRACKER_CONFIG: APIKeyUsageTrackerConfig = {
  enableAsyncUpdates: true,
  batchUpdateInterval: 5000, // 5 seconds
  maxBatchSize: 100,
  enableUsageAnalytics: true,
  analyticsRetentionDays: 90,
};

interface PendingUsageUpdate {
  keyId: string;
  timestamp: Date;
  operationId: string;
}

/**
 * High-performance usage tracking with batch updates and analytics
 */
export class APIKeyUsageTracker {
  private readonly config: APIKeyUsageTrackerConfig;
  private readonly pendingUpdates = new Map<string, PendingUsageUpdate>();
  private batchTimer?: NodeJS.Timeout | undefined;

  constructor(
    private readonly logger: ILogger,
    private readonly metrics: IMetricsCollector,
    private readonly dbClient: PostgreSQLClient,
    config: Partial<APIKeyUsageTrackerConfig> = {}
  ) {
    this.config = { ...DEFAULT_USAGE_TRACKER_CONFIG, ...config };

    this.logger.info("APIKeyUsageTracker initialized", {
      asyncUpdates: this.config.enableAsyncUpdates,
      batchInterval: this.config.batchUpdateInterval,
      maxBatchSize: this.config.maxBatchSize,
      analyticsEnabled: this.config.enableUsageAnalytics,
    });

    // Start batch update processing if async updates are enabled
    if (this.config.enableAsyncUpdates) {
      this.startBatchProcessing();
    }

    // Setup cleanup on process exit
    process.on("SIGINT", () => this.cleanup());
    process.on("SIGTERM", () => this.cleanup());
  }

  /**
   * Track API key usage (async or sync based on configuration)
   */
  async trackUsage(keyId: string, operationId?: string): Promise<void> {
    const startTime = performance.now();
    const opId = operationId || crypto.randomUUID();

    try {
      this.logger.debug("Tracking API key usage", { keyId, operationId: opId });

      if (this.config.enableAsyncUpdates) {
        await this.trackUsageAsync(keyId, opId);
      } else {
        await this.trackUsageSync(keyId, opId);
      }

      this.metrics.recordTimer(
        "apikey.usage_tracker.track_duration",
        performance.now() - startTime
      );
      this.metrics.recordCounter("apikey.usage_tracker.usage_tracked", 1);
    } catch (error) {
      this.logger.error("Failed to track API key usage", {
        keyId,
        operationId: opId,
        error,
      });
      this.metrics.recordCounter("apikey.usage_tracker.track_error", 1);
      throw error;
    }
  }

  /**
   * Track usage asynchronously with batching
   */
  private async trackUsageAsync(
    keyId: string,
    operationId: string
  ): Promise<void> {
    // Add to pending updates queue
    this.pendingUpdates.set(keyId, {
      keyId,
      timestamp: new Date(),
      operationId,
    });

    this.logger.debug("Usage update queued for batch processing", {
      keyId,
      operationId,
      queueSize: this.pendingUpdates.size,
    });

    // Process immediately if batch is full
    if (this.pendingUpdates.size >= this.config.maxBatchSize) {
      await this.processPendingUpdates();
    }
  }

  /**
   * Track usage synchronously (direct database update)
   */
  private async trackUsageSync(
    keyId: string,
    operationId: string
  ): Promise<void> {
    try {
      const result = await this.dbClient.executeRaw(
        `UPDATE api_keys 
         SET "usageCount" = "usageCount" + 1, 
             "lastUsedAt" = NOW(), 
             "updatedAt" = NOW() 
         WHERE id = $1`,
        [keyId]
      );

      this.logger.debug("Usage updated synchronously", {
        keyId,
        operationId,
        result: typeof result,
      });
      this.metrics.recordCounter("apikey.usage_tracker.sync_update", 1);
    } catch (error) {
      this.logger.error("Synchronous usage update failed", {
        keyId,
        operationId,
        error,
      });
      this.metrics.recordCounter("apikey.usage_tracker.sync_update_error", 1);
      throw error;
    }
  }

  /**
   * Process pending usage updates in batch
   */
  private async processPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0) {
      return;
    }

    const updates = Array.from(this.pendingUpdates.values());
    this.pendingUpdates.clear();

    const startTime = performance.now();

    try {
      this.logger.debug("Processing batch usage updates", {
        batchSize: updates.length,
      });

      // Group updates by keyId to handle multiple updates for same key
      const groupedUpdates = new Map<string, PendingUsageUpdate[]>();
      for (const update of updates) {
        if (!groupedUpdates.has(update.keyId)) {
          groupedUpdates.set(update.keyId, []);
        }
        groupedUpdates.get(update.keyId)!.push(update);
      }

      // Build batch update query using CASE statements for efficiency
      const keyIds = Array.from(groupedUpdates.keys());
      const caseStatements = keyIds.map((keyId, index) => {
        const keyUpdates = groupedUpdates.get(keyId)!;
        const incrementCount = keyUpdates.length;
        const latestTimestamp = keyUpdates.reduce(
          (latest, update) =>
            update.timestamp > latest ? update.timestamp : latest,
          keyUpdates[0]?.timestamp || new Date()
        );

        return {
          keyId,
          incrementCount,
          timestamp: latestTimestamp.toISOString(),
          paramIndex: index + 1,
        };
      });

      if (caseStatements.length > 0) {
        // Build efficient batch update query
        const updateQuery = `
          UPDATE api_keys SET
            "usageCount" = "usageCount" + CASE id
              ${caseStatements
                .map(
                  (stmt) =>
                    `WHEN $${stmt.paramIndex} THEN ${stmt.incrementCount}`
                )
                .join(" ")}
            END,
            "lastUsedAt" = CASE id
              ${caseStatements
                .map(
                  (stmt) =>
                    `WHEN $${stmt.paramIndex} THEN '${stmt.timestamp}'::timestamp`
                )
                .join(" ")}
            END,
            "updatedAt" = NOW()
          WHERE id IN (${caseStatements
            .map((stmt) => `$${stmt.paramIndex}`)
            .join(", ")})
        `;

        const parameters = caseStatements.map((stmt) => stmt.keyId);

        const result = await this.dbClient.executeRaw(updateQuery, parameters);

        this.logger.info("Batch usage updates processed", {
          batchSize: updates.length,
          uniqueKeys: keyIds.length,
          result: typeof result,
          duration: performance.now() - startTime,
        });

        this.metrics.recordTimer(
          "apikey.usage_tracker.batch_duration",
          performance.now() - startTime
        );
        this.metrics.recordCounter(
          "apikey.usage_tracker.batch_updates",
          keyIds.length
        );
        this.metrics.recordCounter("apikey.usage_tracker.batch_processed", 1);
      }
    } catch (error) {
      this.logger.error("Batch usage updates failed", {
        batchSize: updates.length,
        error,
      });
      this.metrics.recordCounter("apikey.usage_tracker.batch_error", 1);

      // Re-queue failed updates (with limit to prevent infinite loops)
      const retryUpdates = updates.slice(0, Math.min(updates.length, 10));
      for (const update of retryUpdates) {
        this.pendingUpdates.set(update.keyId, update);
      }

      throw error;
    }
  }

  /**
   * Start batch processing timer
   */
  private startBatchProcessing(): void {
    this.batchTimer = setInterval(async () => {
      try {
        await this.processPendingUpdates();
      } catch (error) {
        this.logger.warn("Batch processing timer error", { error });
      }
    }, this.config.batchUpdateInterval);

    this.logger.debug("Batch processing timer started", {
      interval: this.config.batchUpdateInterval,
    });
  }

  /**
   * Get usage statistics for a specific API key
   */
  async getUsageStats(keyId: string): Promise<UsageStats | null> {
    try {
      const result = await this.dbClient.cachedQuery<
        {
          usage_count: number;
          last_used_at?: Date;
          created_at: Date;
          daily_usage: number;
          weekly_usage: number;
          monthly_usage: number;
        }[]
      >(
        `
        SELECT 
          k."usageCount" as usage_count,
          k."lastUsedAt" as last_used_at,
          k."createdAt" as created_at,
          COALESCE(daily.usage_count, 0) as daily_usage,
          COALESCE(weekly.usage_count, 0) as weekly_usage,
          COALESCE(monthly.usage_count, 0) as monthly_usage
        FROM api_keys k
        LEFT JOIN (
          SELECT key_id, COUNT(*) as usage_count
          FROM api_key_usage_log 
          WHERE key_id = $1 AND created_at >= CURRENT_DATE
          GROUP BY key_id
        ) daily ON daily.key_id = k.id
        LEFT JOIN (
          SELECT key_id, COUNT(*) as usage_count
          FROM api_key_usage_log 
          WHERE key_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
          GROUP BY key_id
        ) weekly ON weekly.key_id = k.id
        LEFT JOIN (
          SELECT key_id, COUNT(*) as usage_count
          FROM api_key_usage_log 
          WHERE key_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY key_id
        ) monthly ON monthly.key_id = k.id
        WHERE k.id = $1
        `,
        [keyId]
      );

      const stats = result[0];
      if (!stats) {
        return null;
      }

      // Calculate average usage per day
      const daysSinceCreation = Math.max(
        1,
        Math.floor(
          (Date.now() - stats.created_at.getTime()) / (1000 * 60 * 60 * 24)
        )
      );

      return {
        totalUsage: stats.usage_count,
        dailyUsage: stats.daily_usage,
        weeklyUsage: stats.weekly_usage,
        monthlyUsage: stats.monthly_usage,
        averageUsagePerDay: stats.usage_count / daysSinceCreation,
        lastUsedAt: stats.last_used_at,
        firstUsedAt: stats.created_at,
      };
    } catch (error) {
      this.logger.error("Failed to get usage stats", { keyId, error });
      this.metrics.recordCounter("apikey.usage_tracker.stats_error", 1);
      return null;
    }
  }

  /**
   * Get comprehensive usage analytics
   */
  async getUsageAnalytics(limit: number = 10): Promise<UsageAnalytics> {
    if (!this.config.enableUsageAnalytics) {
      throw new Error("Usage analytics is disabled");
    }

    try {
      const startTime = performance.now();

      // Get overall statistics
      const [overallStats] = await this.dbClient.cachedQuery<
        {
          total_keys: number;
          active_keys: number;
          keys_used_today: number;
          keys_used_week: number;
          keys_used_month: number;
          total_usage: number;
        }[]
      >(
        `
        SELECT 
          COUNT(*) as total_keys,
          COUNT(*) FILTER (WHERE "isActive" = true) as active_keys,
          COUNT(*) FILTER (WHERE "lastUsedAt" >= CURRENT_DATE) as keys_used_today,
          COUNT(*) FILTER (WHERE "lastUsedAt" >= CURRENT_DATE - INTERVAL '7 days') as keys_used_week,
          COUNT(*) FILTER (WHERE "lastUsedAt" >= CURRENT_DATE - INTERVAL '30 days') as keys_used_month,
          COALESCE(SUM("usageCount"), 0) as total_usage
        FROM api_keys
        WHERE "revokedAt" IS NULL
        `,
        []
      );

      // Get most used keys
      const mostUsedKeys = await this.dbClient.cachedQuery<APIKeyUsageInfo[]>(
        `
        SELECT id as "keyId", name, "userId", "usageCount", "lastUsedAt", "createdAt"
        FROM api_keys 
        WHERE "isActive" = true AND "revokedAt" IS NULL
        ORDER BY "usageCount" DESC 
        LIMIT $1
        `,
        [limit]
      );

      // Get least used keys (but with some usage)
      const leastUsedKeys = await this.dbClient.cachedQuery<APIKeyUsageInfo[]>(
        `
        SELECT id as "keyId", name, "userId", "usageCount", "lastUsedAt", "createdAt"
        FROM api_keys 
        WHERE "isActive" = true AND "revokedAt" IS NULL AND "usageCount" > 0
        ORDER BY "usageCount" ASC 
        LIMIT $1
        `,
        [limit]
      );

      // Get usage trends (simplified - in production, might use a dedicated analytics table)
      const dailyTrends = await this.dbClient.cachedQuery<
        { day: string; usage_count: number }[]
      >(
        `
        SELECT 
          DATE(created_at) as day,
          COUNT(*) as usage_count
        FROM api_key_usage_log
        WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY day DESC
        LIMIT 30
        `,
        []
      );

      const analytics: UsageAnalytics = {
        totalKeys: overallStats?.total_keys || 0,
        activeKeys: overallStats?.active_keys || 0,
        keysUsedToday: overallStats?.keys_used_today || 0,
        keysUsedThisWeek: overallStats?.keys_used_week || 0,
        keysUsedThisMonth: overallStats?.keys_used_month || 0,
        totalUsage: overallStats?.total_usage || 0,
        averageUsagePerKey:
          (overallStats?.total_keys || 0) > 0
            ? (overallStats?.total_usage || 0) / (overallStats?.total_keys || 1)
            : 0,
        mostUsedKeys,
        leastUsedKeys,
        usageTrends: {
          daily: dailyTrends.map((t) => t.usage_count),
          weekly: [], // Could be calculated if needed
          monthly: [], // Could be calculated if needed
        },
      };

      this.metrics.recordTimer(
        "apikey.usage_tracker.analytics_duration",
        performance.now() - startTime
      );
      this.metrics.recordCounter("apikey.usage_tracker.analytics_generated", 1);

      this.logger.debug("Usage analytics generated", {
        totalKeys: analytics.totalKeys,
        activeKeys: analytics.activeKeys,
        totalUsage: analytics.totalUsage,
        duration: performance.now() - startTime,
      });

      return analytics;
    } catch (error) {
      this.logger.error("Failed to generate usage analytics", { error });
      this.metrics.recordCounter("apikey.usage_tracker.analytics_error", 1);
      throw error;
    }
  }

  /**
   * Get usage tracker health status
   */
  async healthCheck(): Promise<{
    available: boolean;
    error?: string;
    queueSize?: number;
  }> {
    try {
      // Test database connectivity
      await this.dbClient.executeRaw("SELECT 1");

      return {
        available: true,
        queueSize: this.pendingUpdates.size,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Usage tracker health check failed", { error });
      return {
        available: false,
        error: errorMessage,
        queueSize: this.pendingUpdates.size,
      };
    }
  }

  /**
   * Cleanup resources and flush pending updates
   */
  async cleanup(): Promise<void> {
    this.logger.info("Starting usage tracker cleanup");

    // Clear batch timer
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }

    // Process any remaining pending updates
    if (this.pendingUpdates.size > 0) {
      this.logger.info("Flushing pending usage updates", {
        count: this.pendingUpdates.size,
      });

      try {
        await this.processPendingUpdates();
        this.logger.info("Pending updates flushed successfully");
      } catch (error) {
        this.logger.error("Failed to flush pending updates", { error });
      }
    }

    this.logger.info("Usage tracker cleanup completed");
  }
}
