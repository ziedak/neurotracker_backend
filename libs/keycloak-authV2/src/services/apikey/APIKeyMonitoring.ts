/**
 * APIKeyMonitoring - Consolidated usage tracking and health monitoring
 *
 * This consolidated component replaces:
 * - APIKeyUsageTracker.ts - Usage tracking, analytics, and batch updates
 * - APIKeyHealthMonitor.ts - Health monitoring, diagnostics, and system status
 *
 * Responsibilities:
 * - Usage tracking with high-performance batch updates
 * - Comprehensive usage analytics and statistics
 * - System health monitoring and diagnostics
 * - Component dependency health checks
 * - Performance metrics and alerting
 * - Entropy source testing and validation
 * - System recommendations and troubleshooting
 *
 * SOLID Principles:
 * - Single Responsibility: Handles all monitoring and tracking concerns
 * - Open/Closed: Extensible for new monitoring and tracking capabilities
 * - Liskov Substitution: Implements standard monitoring interfaces
 * - Interface Segregation: Clean separation within monitoring domains
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import { performance } from "perf_hooks";
import crypto from "crypto";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PostgreSQLClient } from "@libs/database";
import { EntropyUtils } from "../../utils/entropy";

// ==================== USAGE TRACKING INTERFACES ====================

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

export interface PendingUsageUpdate {
  keyId: string;
  timestamp: Date;
  operationId: string;
}

// ==================== HEALTH MONITORING INTERFACES ====================

export interface ComponentHealth {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  available: boolean;
  responseTime: number; // milliseconds
  error?: string | undefined;
  details?: Record<string, any> | undefined;
  lastCheck: Date;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy" | "critical";
  components: ComponentHealth[];
  dependencies: {
    database: ComponentHealth;
    cache: ComponentHealth;
    entropy: ComponentHealth;
  };
  metrics: {
    totalValidations: number;
    successRate: number;
    avgResponseTime: number;
    cacheHitRate: number;
    errorRate: number;
  };
  recommendations: string[];
  lastCheck: Date;
}

export interface EntropyTest {
  status: "healthy" | "degraded" | "failed";
  testRuns: number;
  successfulRuns: number;
  qualityScore: number;
  avgGenerationTime: number;
  details: {
    attempts: Array<{
      success: boolean;
      quality: boolean;
      duration: number;
      error?: string;
    }>;
  };
  recommendations: string[];
}

export interface MonitoringResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  executionTime?: number;
  fromCache?: boolean;
}

// ==================== CONFIGURATION ====================

export interface APIKeyMonitoringConfig {
  // Usage Tracking Configuration
  readonly usage: {
    readonly enableAsyncUpdates: boolean;
    readonly batchUpdateInterval: number; // milliseconds
    readonly maxBatchSize: number;
    readonly enableAnalytics: boolean;
    readonly analyticsRetentionDays: number;
  };

  // Health Monitoring Configuration
  readonly health: {
    readonly healthCheckInterval: number; // milliseconds
    readonly enableContinuousMonitoring: boolean;
    readonly performanceThresholds: {
      readonly maxResponseTime: number; // milliseconds
      readonly minSuccessRate: number; // percentage (0-100)
      readonly maxErrorRate: number; // percentage (0-100)
      readonly minCacheHitRate: number; // percentage (0-100)
    };
    readonly entropyTestConfig: {
      readonly testCount: number;
      readonly minQualityThreshold: number; // percentage (0-100)
      readonly maxGenerationTime: number; // milliseconds
    };
  };

  // General Configuration
  readonly enableMetrics: boolean;
  readonly maxRetries: number;
  readonly retryDelay: number;
}

const DEFAULT_MONITORING_CONFIG: APIKeyMonitoringConfig = {
  usage: {
    enableAsyncUpdates: true,
    batchUpdateInterval: 5000, // 5 seconds
    maxBatchSize: 100,
    enableAnalytics: true,
    analyticsRetentionDays: 90,
  },
  health: {
    healthCheckInterval: 30000, // 30 seconds
    enableContinuousMonitoring: true,
    performanceThresholds: {
      maxResponseTime: 1000, // 1 second
      minSuccessRate: 95, // 95%
      maxErrorRate: 5, // 5%
      minCacheHitRate: 80, // 80%
    },
    entropyTestConfig: {
      testCount: 5,
      minQualityThreshold: 80, // 80%
      maxGenerationTime: 100, // 100ms
    },
  },
  enableMetrics: true,
  maxRetries: 3,
  retryDelay: 1000,
};

/**
 * Consolidated monitoring system for API key usage tracking and health monitoring
 */
export class APIKeyMonitoring {
  private readonly config: APIKeyMonitoringConfig;
  private readonly logger: ILogger;

  // Usage tracking state
  private readonly pendingUpdates = new Map<string, PendingUsageUpdate>();
  private batchTimer?: NodeJS.Timeout | undefined;

  // Health monitoring state
  private healthCheckTimer?: NodeJS.Timeout | undefined;
  private lastHealthCheck?: SystemHealth | undefined;

  constructor(
    private readonly dbClient: PostgreSQLClient,
    private readonly metrics?: IMetricsCollector,
    logger?: ILogger,
    config?: Partial<APIKeyMonitoringConfig>
  ) {
    this.config = { ...DEFAULT_MONITORING_CONFIG, ...config };
    this.logger =
      logger ||
      ({
        info: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.log,
      } as ILogger);

    this.logger.info("APIKeyMonitoring initialized", {
      asyncUpdates: this.config.usage.enableAsyncUpdates,
      batchInterval: this.config.usage.batchUpdateInterval,
      continuousHealth: this.config.health.enableContinuousMonitoring,
      healthInterval: this.config.health.healthCheckInterval,
    });

    // Initialize subsystems
    this.initializeUsageTracking();
    this.initializeHealthMonitoring();

    // Setup cleanup on process exit
    process.on("SIGINT", () => this.cleanup());
    process.on("SIGTERM", () => this.cleanup());
  }

  // ==================== USAGE TRACKING OPERATIONS ====================

  /**
   * Track API key usage (async or sync based on configuration)
   */
  async trackUsage(
    keyId: string,
    operationId?: string
  ): Promise<MonitoringResult<boolean>> {
    const startTime = performance.now();
    const opId = operationId || crypto.randomUUID();

    try {
      this.logger.debug("Tracking API key usage", { keyId, operationId: opId });

      if (this.config.usage.enableAsyncUpdates) {
        await this.trackUsageAsync(keyId, opId);
      } else {
        await this.trackUsageSync(keyId, opId);
      }

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer(
        "apikey.monitoring.track_duration",
        executionTime
      );
      this.metrics?.recordCounter("apikey.monitoring.usage_tracked", 1);

      return {
        success: true,
        data: true,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.logger.error("Failed to track API key usage", {
        keyId,
        operationId: opId,
        error,
      });
      this.metrics?.recordCounter("apikey.monitoring.track_error", 1);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Usage tracking failed",
        executionTime,
      };
    }
  }

  /**
   * Get usage statistics for a specific API key
   */
  async getUsageStats(keyId: string): Promise<MonitoringResult<UsageStats>> {
    const startTime = performance.now();

    try {
      const result = (await this.executeWithRetry(async () => {
        return this.dbClient.executeRaw(
          `SELECT 
            ak.usage_count,
            ak.last_used_at,
            ak.created_at,
            COALESCE(daily.count, 0) as daily_usage,
            COALESCE(weekly.count, 0) as weekly_usage,
            COALESCE(monthly.count, 0) as monthly_usage
           FROM api_keys ak
           LEFT JOIN (
             SELECT key_id, COUNT(*) as count
             FROM audit_logs 
             WHERE key_id = $1 AND created_at >= CURRENT_DATE
             GROUP BY key_id
           ) daily ON daily.key_id = ak.id
           LEFT JOIN (
             SELECT key_id, COUNT(*) as count
             FROM audit_logs 
             WHERE key_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '7 days'
             GROUP BY key_id
           ) weekly ON weekly.key_id = ak.id
           LEFT JOIN (
             SELECT key_id, COUNT(*) as count
             FROM audit_logs 
             WHERE key_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '30 days'
             GROUP BY key_id
           ) monthly ON monthly.key_id = ak.id
           WHERE ak.id = $1`,
          keyId
        );
      })) as any[];

      if (!result || !Array.isArray(result) || result.length === 0) {
        return {
          success: false,
          error: "API key not found",
          executionTime: performance.now() - startTime,
        };
      }

      const stats = result[0];
      const keyAge = Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(stats.created_at).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      );

      const usageStats: UsageStats = {
        totalUsage: stats.usage_count || 0,
        dailyUsage: stats.daily_usage || 0,
        weeklyUsage: stats.weekly_usage || 0,
        monthlyUsage: stats.monthly_usage || 0,
        averageUsagePerDay: (stats.usage_count || 0) / keyAge,
        lastUsedAt: stats.last_used_at
          ? new Date(stats.last_used_at)
          : undefined,
        firstUsedAt: new Date(stats.created_at),
      };

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer(
        "apikey.monitoring.stats_duration",
        executionTime
      );

      return {
        success: true,
        data: usageStats,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.logger.error("Failed to get usage stats", { keyId, error });
      this.metrics?.recordCounter("apikey.monitoring.stats_error", 1);

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to retrieve usage stats",
        executionTime,
      };
    }
  }

  /**
   * Get comprehensive usage analytics
   */
  async getUsageAnalytics(
    limit: number = 10
  ): Promise<MonitoringResult<UsageAnalytics>> {
    if (!this.config.usage.enableAnalytics) {
      return {
        success: false,
        error: "Usage analytics is disabled",
      };
    }

    const startTime = performance.now();

    try {
      // Get overall statistics
      const overallResult = (await this.executeWithRetry(async () => {
        return this.dbClient.executeRaw(
          `SELECT 
            COUNT(*) as total_keys,
            COUNT(*) FILTER (WHERE is_active = true) as active_keys,
            COUNT(*) FILTER (WHERE last_used_at >= CURRENT_DATE) as keys_used_today,
            COUNT(*) FILTER (WHERE last_used_at >= CURRENT_DATE - INTERVAL '7 days') as keys_used_week,
            COUNT(*) FILTER (WHERE last_used_at >= CURRENT_DATE - INTERVAL '30 days') as keys_used_month,
            COALESCE(SUM(usage_count), 0) as total_usage
           FROM api_keys
           WHERE revoked_at IS NULL`
        );
      })) as any[];

      const overallStats = overallResult?.[0];

      // Get most and least used keys in parallel
      const [mostUsedResult, leastUsedResult, trendsResult] = await Promise.all(
        [
          this.executeWithRetry(async () => {
            return this.dbClient.executeRaw(
              `SELECT id as key_id, name, user_id, usage_count, last_used_at, created_at
             FROM api_keys 
             WHERE is_active = true AND revoked_at IS NULL
             ORDER BY usage_count DESC 
             LIMIT $1`,
              limit
            );
          }) as Promise<any[]>,
          this.executeWithRetry(async () => {
            return this.dbClient.executeRaw(
              `SELECT id as key_id, name, user_id, usage_count, last_used_at, created_at
             FROM api_keys 
             WHERE is_active = true AND revoked_at IS NULL AND usage_count > 0
             ORDER BY usage_count ASC 
             LIMIT $1`,
              limit
            );
          }) as Promise<any[]>,
          this.executeWithRetry(async () => {
            return this.dbClient.executeRaw(
              `SELECT 
              DATE(created_at) as day,
              COUNT(*) as usage_count
             FROM audit_logs
             WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
             GROUP BY DATE(created_at)
             ORDER BY day DESC
             LIMIT 30`
            );
          }) as Promise<any[]>,
        ]
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
        mostUsedKeys: (mostUsedResult || []).map(
          (row: any): APIKeyUsageInfo => {
            const item: APIKeyUsageInfo = {
              keyId: row.key_id,
              name: row.name,
              userId: row.user_id,
              usageCount: row.usage_count,
              createdAt: new Date(row.created_at),
            };
            if (row.last_used_at) {
              item.lastUsedAt = new Date(row.last_used_at);
            }
            return item;
          }
        ),
        leastUsedKeys: (leastUsedResult || []).map(
          (row: any): APIKeyUsageInfo => {
            const item: APIKeyUsageInfo = {
              keyId: row.key_id,
              name: row.name,
              userId: row.user_id,
              usageCount: row.usage_count,
              createdAt: new Date(row.created_at),
            };
            if (row.last_used_at) {
              item.lastUsedAt = new Date(row.last_used_at);
            }
            return item;
          }
        ),
        usageTrends: {
          daily: (trendsResult || []).map((row: any) => row.usage_count),
          weekly: [], // Could be calculated if needed
          monthly: [], // Could be calculated if needed
        },
      };

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer(
        "apikey.monitoring.analytics_duration",
        executionTime
      );

      return {
        success: true,
        data: analytics,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.logger.error("Failed to generate usage analytics", { error });
      this.metrics?.recordCounter("apikey.monitoring.analytics_error", 1);

      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate analytics",
        executionTime,
      };
    }
  }

  // ==================== HEALTH MONITORING OPERATIONS ====================

  /**
   * Perform comprehensive system health check
   */
  async performHealthCheck(): Promise<MonitoringResult<SystemHealth>> {
    const startTime = performance.now();
    const operationId = crypto.randomUUID();

    try {
      this.logger.debug("Starting comprehensive health check", { operationId });

      // Check core dependencies in parallel
      const [databaseHealth, entropyHealth] = await Promise.allSettled([
        this.checkDatabaseHealth(),
        this.checkEntropyHealth(),
      ]);

      // Process results
      const dbResult =
        databaseHealth.status === "fulfilled"
          ? databaseHealth.value
          : this.createUnhealthyComponent(
              "database",
              "Database health check failed"
            );

      const entropyResult =
        entropyHealth.status === "fulfilled"
          ? entropyHealth.value
          : this.createUnhealthyComponent(
              "entropy",
              "Entropy health check failed"
            );

      // Create cache component health (placeholder - would integrate with actual cache service)
      const cacheResult: ComponentHealth = {
        name: "cache",
        status: "healthy",
        available: true,
        responseTime: 0,
        lastCheck: new Date(),
      };

      // Calculate system metrics
      const components = [dbResult, entropyResult, cacheResult];
      const metrics = this.calculateSystemMetrics(components);

      // Determine overall system status
      const systemStatus = this.determineSystemStatus(
        components,
        dbResult,
        entropyResult
      );

      // Generate recommendations
      const recommendations = this.generateHealthRecommendations(
        components,
        metrics,
        dbResult,
        entropyResult
      );

      const systemHealth: SystemHealth = {
        status: systemStatus,
        components,
        dependencies: {
          database: dbResult,
          cache: cacheResult,
          entropy: entropyResult,
        },
        metrics,
        recommendations,
        lastCheck: new Date(),
      };

      // Cache the result
      this.lastHealthCheck = systemHealth;

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer(
        "apikey.monitoring.health_check_duration",
        executionTime
      );
      this.metrics?.recordCounter(
        "apikey.monitoring.health_check_completed",
        1
      );
      this.metrics?.recordCounter(
        `apikey.monitoring.health_status.${systemStatus}`,
        1
      );

      this.logger.info("Health check completed", {
        operationId,
        status: systemStatus,
        duration: executionTime,
      });

      return {
        success: true,
        data: systemHealth,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.logger.error("Health check failed", { operationId, error });
      this.metrics?.recordCounter("apikey.monitoring.health_check_error", 1);

      return {
        success: false,
        error: error instanceof Error ? error.message : "Health check failed",
        executionTime,
      };
    }
  }

  /**
   * Test entropy source quality and performance
   */
  async testEntropySource(): Promise<MonitoringResult<EntropyTest>> {
    const startTime = performance.now();

    try {
      const entropyTest = await EntropyUtils.testEntropySource(
        this.logger,
        this.config.health.entropyTestConfig
      );

      const executionTime = performance.now() - startTime;
      this.metrics?.recordTimer(
        "apikey.monitoring.entropy_test_duration",
        executionTime
      );
      this.metrics?.recordCounter(
        "apikey.monitoring.entropy_test_completed",
        1
      );
      this.metrics?.recordGauge(
        "apikey.monitoring.entropy_quality_score",
        entropyTest.qualityScore
      );

      return {
        success: true,
        data: entropyTest,
        executionTime,
      };
    } catch (error) {
      const executionTime = performance.now() - startTime;
      this.logger.error("Entropy source test failed", { error });
      this.metrics?.recordCounter("apikey.monitoring.entropy_test_error", 1);

      const failedTest: EntropyTest = {
        status: "failed",
        testRuns: 0,
        successfulRuns: 0,
        qualityScore: 0,
        avgGenerationTime: 0,
        details: { attempts: [] },
        recommendations: [
          "Entropy testing system failed - requires investigation",
        ],
      };

      return {
        success: false,
        data: failedTest,
        error: error instanceof Error ? error.message : "Entropy test failed",
        executionTime,
      };
    }
  }

  /**
   * Get the last health check result
   */
  getLastHealthCheck(): SystemHealth | null {
    return this.lastHealthCheck || null;
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Initialize usage tracking subsystem
   */
  private initializeUsageTracking(): void {
    if (this.config.usage.enableAsyncUpdates) {
      this.startBatchProcessing();
    }
    this.logger.debug("Usage tracking initialized", {
      asyncUpdates: this.config.usage.enableAsyncUpdates,
      batchSize: this.config.usage.maxBatchSize,
    });
  }

  /**
   * Initialize health monitoring subsystem
   */
  private initializeHealthMonitoring(): void {
    if (this.config.health.enableContinuousMonitoring) {
      this.startContinuousMonitoring();
    }
    this.logger.debug("Health monitoring initialized", {
      continuousMonitoring: this.config.health.enableContinuousMonitoring,
      interval: this.config.health.healthCheckInterval,
    });
  }

  /**
   * Track usage asynchronously with batching
   */
  private async trackUsageAsync(
    keyId: string,
    operationId: string
  ): Promise<void> {
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
    if (this.pendingUpdates.size >= this.config.usage.maxBatchSize) {
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
    await this.executeWithRetry(async () => {
      return this.dbClient.executeRaw(
        `UPDATE api_keys 
         SET usage_count = usage_count + 1, 
             last_used_at = CURRENT_TIMESTAMP, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        keyId
      );
    });

    this.logger.debug("Usage updated synchronously", { keyId, operationId });
    this.metrics?.recordCounter("apikey.monitoring.sync_update", 1);
  }

  /**
   * Process pending usage updates in batch
   */
  private async processPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0) return;

    const updates = Array.from(this.pendingUpdates.values());
    this.pendingUpdates.clear();

    const startTime = performance.now();

    try {
      // Group updates by keyId
      const groupedUpdates = new Map<string, PendingUsageUpdate[]>();
      for (const update of updates) {
        if (!groupedUpdates.has(update.keyId)) {
          groupedUpdates.set(update.keyId, []);
        }
        groupedUpdates.get(update.keyId)!.push(update);
      }

      // Build batch update query
      const keyIds = Array.from(groupedUpdates.keys());
      if (keyIds.length === 0) return;

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

      const updateQuery = `
        UPDATE api_keys SET
          usage_count = usage_count + CASE id
            ${caseStatements
              .map(
                (stmt) => `WHEN $${stmt.paramIndex} THEN ${stmt.incrementCount}`
              )
              .join(" ")}
          END,
          last_used_at = CASE id
            ${caseStatements
              .map(
                (stmt) =>
                  `WHEN $${stmt.paramIndex} THEN '${stmt.timestamp}'::timestamp`
              )
              .join(" ")}
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${caseStatements
          .map((stmt) => `$${stmt.paramIndex}`)
          .join(", ")})
      `;

      const parameters = caseStatements.map((stmt) => stmt.keyId);

      await this.executeWithRetry(async () => {
        return this.dbClient.executeRaw(updateQuery, ...parameters);
      });

      const duration = performance.now() - startTime;
      this.logger.info("Batch usage updates processed", {
        batchSize: updates.length,
        uniqueKeys: keyIds.length,
        duration,
      });

      this.metrics?.recordTimer("apikey.monitoring.batch_duration", duration);
      this.metrics?.recordCounter(
        "apikey.monitoring.batch_updates",
        keyIds.length
      );
    } catch (error) {
      this.logger.error("Batch usage updates failed", {
        batchSize: updates.length,
        error,
      });
      this.metrics?.recordCounter("apikey.monitoring.batch_error", 1);

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
    }, this.config.usage.batchUpdateInterval);

    this.logger.debug("Batch processing timer started", {
      interval: this.config.usage.batchUpdateInterval,
    });
  }

  /**
   * Start continuous health monitoring
   */
  private startContinuousMonitoring(): void {
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.warn("Continuous health check error", { error });
      }
    }, this.config.health.healthCheckInterval);

    this.logger.info("Continuous health monitoring started", {
      interval: this.config.health.healthCheckInterval,
    });
  }

  /**
   * Check database health
   */
  private async checkDatabaseHealth(): Promise<ComponentHealth> {
    const startTime = performance.now();

    try {
      await this.dbClient.executeRaw("SELECT 1");
      const responseTime = performance.now() - startTime;

      const status: "healthy" | "degraded" | "unhealthy" =
        responseTime > this.config.health.performanceThresholds.maxResponseTime
          ? "degraded"
          : "healthy";

      return {
        name: "database",
        status,
        available: true,
        responseTime,
        details: { connectionTest: "passed" },
        lastCheck: new Date(),
      };
    } catch (error) {
      const responseTime = performance.now() - startTime;
      return {
        name: "database",
        status: "unhealthy",
        available: false,
        responseTime,
        error:
          error instanceof Error ? error.message : "Database connection failed",
        lastCheck: new Date(),
      };
    }
  }

  /**
   * Check entropy health
   */
  private async checkEntropyHealth(): Promise<ComponentHealth> {
    try {
      const entropyTestResult = await this.testEntropySource();
      const entropyTest = entropyTestResult.data;

      if (!entropyTest) {
        return this.createUnhealthyComponent(
          "entropy",
          entropyTestResult.error || "Entropy test failed"
        );
      }

      let status: "healthy" | "degraded" | "unhealthy";
      switch (entropyTest.status) {
        case "healthy":
          status = "healthy";
          break;
        case "degraded":
          status = "degraded";
          break;
        case "failed":
          status = "unhealthy";
          break;
      }

      return {
        name: "entropy",
        status,
        available: entropyTest.successfulRuns > 0,
        responseTime: entropyTest.avgGenerationTime,
        details: entropyTest,
        lastCheck: new Date(),
      };
    } catch (error) {
      return this.createUnhealthyComponent(
        "entropy",
        error instanceof Error ? error.message : "Entropy health check failed"
      );
    }
  }

  /**
   * Create unhealthy component helper
   */
  private createUnhealthyComponent(
    name: string,
    error: string
  ): ComponentHealth {
    return {
      name,
      status: "unhealthy",
      available: false,
      responseTime: 0,
      error,
      lastCheck: new Date(),
    };
  }

  /**
   * Calculate system-wide metrics
   */
  private calculateSystemMetrics(components: ComponentHealth[]): {
    totalValidations: number;
    successRate: number;
    avgResponseTime: number;
    cacheHitRate: number;
    errorRate: number;
  } {
    const healthyComponents = components.filter(
      (c) => c.status === "healthy"
    ).length;
    const totalComponents = components.length;

    const avgResponseTime =
      totalComponents > 0
        ? components.reduce((sum, c) => sum + c.responseTime, 0) /
          totalComponents
        : 0;

    const successRate =
      totalComponents > 0 ? (healthyComponents / totalComponents) * 100 : 0;
    const errorRate = 100 - successRate;

    return {
      totalValidations: 0, // Would be retrieved from metrics system
      successRate,
      avgResponseTime,
      cacheHitRate: 0, // Would be retrieved from cache metrics
      errorRate,
    };
  }

  /**
   * Determine overall system status
   */
  private determineSystemStatus(
    components: ComponentHealth[],
    database: ComponentHealth,
    entropy: ComponentHealth
  ): "healthy" | "degraded" | "unhealthy" | "critical" {
    // Critical dependencies must be healthy
    if (!database.available) return "critical";
    if (!entropy.available) return "critical";

    // Count component statuses
    const unhealthyComponents = components.filter(
      (c) => c.status === "unhealthy"
    ).length;
    const degradedComponents = components.filter(
      (c) => c.status === "degraded"
    ).length;
    const totalComponents = components.length;

    if (unhealthyComponents > totalComponents * 0.5) return "unhealthy";
    if (unhealthyComponents > 0 || degradedComponents > totalComponents * 0.3)
      return "degraded";
    if (database.status !== "healthy" || entropy.status !== "healthy")
      return "degraded";

    return "healthy";
  }

  /**
   * Generate health recommendations
   */
  private generateHealthRecommendations(
    components: ComponentHealth[],
    metrics: any,
    database: ComponentHealth,
    entropy: ComponentHealth
  ): string[] {
    const recommendations: string[] = [];

    // Check critical dependencies
    if (!database.available) {
      recommendations.push(
        "CRITICAL: Database connection failed - immediate attention required"
      );
    }
    if (!entropy.available) {
      recommendations.push(
        "CRITICAL: Entropy source failed - secure key generation not possible"
      );
    }

    // Check component health
    const unhealthyComponents = components.filter(
      (c) => c.status === "unhealthy"
    );
    if (unhealthyComponents.length > 0) {
      recommendations.push(
        `${
          unhealthyComponents.length
        } components are unhealthy: ${unhealthyComponents
          .map((c) => c.name)
          .join(", ")}`
      );
    }

    // Check performance metrics
    if (
      metrics.avgResponseTime >
      this.config.health.performanceThresholds.maxResponseTime
    ) {
      recommendations.push(
        `Average response time (${metrics.avgResponseTime.toFixed(
          1
        )}ms) exceeds threshold`
      );
    }
    if (
      metrics.successRate <
      this.config.health.performanceThresholds.minSuccessRate
    ) {
      recommendations.push(
        `Success rate (${metrics.successRate.toFixed(1)}%) below threshold`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("System operating within normal parameters");
    }

    return recommendations;
  }

  /**
   * Execute operation with retry logic
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");

        if (attempt === this.config.maxRetries) {
          break;
        }

        this.logger.warn(
          `Operation failed, retrying (${attempt}/${this.config.maxRetries})`,
          {
            error: lastError.message,
            attempt,
          }
        );

        await new Promise((resolve) =>
          setTimeout(resolve, this.config.retryDelay)
        );
      }
    }

    throw lastError || new Error("Operation failed after retries");
  }

  /**
   * Cleanup resources and flush pending updates
   */
  async cleanup(): Promise<void> {
    this.logger.info("Starting monitoring cleanup");

    // Clear timers
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
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

    this.logger.info("Monitoring cleanup completed");
  }
}
