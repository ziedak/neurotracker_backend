/**
 * SessionMetrics - Single Responsibility: Statistics and monitoring
 *
 * Handles:
 * - Session metrics collection and reporting
 * - Performance monitoring and analytics
 * - Usage statistics and trends
 * - Health metrics and alerting
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles metrics collection and reporting
 * - Open/Closed: Extensible for different metric types
 * - Liskov Substitution: Implements standard metrics interface
 * - Interface Segregation: Clean separation of metrics concerns
 * - Dependency Inversion: Depends on abstractions not concretions
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type {
  KeycloakSessionData,
  SessionStats,
  MutableSessionStats,
  HealthCheckResult,
} from "./sessionTypes";

/**
 * Metrics configuration
 */
export interface SessionMetricsConfig {
  readonly enableDetailedMetrics: boolean;
  readonly metricsRetentionDays: number;
  readonly aggregationIntervals: number[]; // in milliseconds
  readonly alertThresholds: {
    errorRate: number; // percentage
    responseTime: number; // milliseconds
    activeSessionsLimit: number;
    securityViolationsPerHour: number;
  };
  readonly exportMetrics: boolean;
  readonly metricsPrefix: string;
}

const DEFAULT_METRICS_CONFIG: SessionMetricsConfig = {
  enableDetailedMetrics: true,
  metricsRetentionDays: 30,
  aggregationIntervals: [
    60 * 1000, // 1 minute
    5 * 60 * 1000, // 5 minutes
    60 * 60 * 1000, // 1 hour
    24 * 60 * 60 * 1000, // 1 day
  ],
  alertThresholds: {
    errorRate: 5, // 5%
    responseTime: 1000, // 1 second
    activeSessionsLimit: 10000,
    securityViolationsPerHour: 100,
  },
  exportMetrics: true,
  metricsPrefix: "keycloak_session",
};

/**
 * Metric data point
 */
interface MetricDataPoint {
  timestamp: Date;
  value: number;
  tags?: Record<string, string>;
  type: "counter" | "gauge" | "timer" | "histogram";
}

/**
 * Aggregated metrics
 */
interface AggregatedMetric {
  interval: number;
  startTime: Date;
  endTime: Date;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p95: number;
  p99: number;
}

/**
 * Session operation metrics
 */
interface SessionOperationMetrics {
  operation: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
}

/**
 * Security metrics
 */
interface SecurityMetrics {
  totalViolations: number;
  violationsByType: Record<string, number>;
  blockedUsers: number;
  suspiciousLogins: number;
  deviceMismatches: number;
  rateLimitExceeded: number;
}

/**
 * Performance metrics
 */
interface PerformanceMetrics {
  averageSessionCreationTime: number;
  averageValidationTime: number;
  averageTokenRefreshTime: number;
  cacheHitRate: number;
  databaseOperationTime: number;
  memoryUsage: number;
}

/**
 * Comprehensive session metrics collection and monitoring
 */
export class SessionMetrics {
  private readonly logger: ILogger;
  private readonly config: SessionMetricsConfig;
  private readonly metricBuffer = new Map<string, MetricDataPoint[]>();
  private readonly aggregatedMetrics = new Map<string, AggregatedMetric[]>();
  private readonly operationMetrics = new Map<
    string,
    SessionOperationMetrics
  >();

  private sessionStats: MutableSessionStats = {
    activeSessions: 0,
    totalSessions: 0,
    sessionsCreated: 0,
    sessionsExpired: 0,
    averageSessionDuration: 0,
    peakConcurrentSessions: 0,
    successfulLogins: 0,
    failedLogins: 0,
    tokenRefreshCount: 0,
    securityViolations: 0,
  };

  private securityMetrics: SecurityMetrics = {
    totalViolations: 0,
    violationsByType: {},
    blockedUsers: 0,
    suspiciousLogins: 0,
    deviceMismatches: 0,
    rateLimitExceeded: 0,
  };

  private performanceMetrics: PerformanceMetrics = {
    averageSessionCreationTime: 0,
    averageValidationTime: 0,
    averageTokenRefreshTime: 0,
    cacheHitRate: 0,
    databaseOperationTime: 0,
    memoryUsage: 0,
  };

  constructor(
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector,
    config: Partial<SessionMetricsConfig> = {}
  ) {
    this.logger = logger || createLogger("SessionMetrics");
    this.config = { ...DEFAULT_METRICS_CONFIG, ...config };

    this.logger.info("SessionMetrics initialized", {
      enableDetailedMetrics: this.config.enableDetailedMetrics,
      retentionDays: this.config.metricsRetentionDays,
      alertThresholds: this.config.alertThresholds,
    });

    // Start periodic aggregation and cleanup
    this.startPeriodicTasks();
  }

  /**
   * Record session creation metrics
   */
  async recordSessionCreation(
    sessionData: KeycloakSessionData,
    creationTime: number,
    success: boolean
  ): Promise<void> {
    try {
      // Update session statistics
      if (success) {
        this.sessionStats.totalSessions++;
        this.sessionStats.sessionsCreated++;
        this.sessionStats.successfulLogins++;
        this.sessionStats.activeSessions++;

        // Update peak concurrent sessions
        if (
          this.sessionStats.activeSessions >
          this.sessionStats.peakConcurrentSessions
        ) {
          this.sessionStats.peakConcurrentSessions =
            this.sessionStats.activeSessions;
        }
      } else {
        this.sessionStats.failedLogins++;
      }

      // Record creation time metrics
      this.recordMetric("session_creation_duration", creationTime, "timer", {
        success: success.toString(),
        userId: sessionData.userId,
      });

      // Update performance metrics
      this.updateAverageMetric(
        "averageSessionCreationTime",
        creationTime,
        this.performanceMetrics.averageSessionCreationTime
      );

      // Export to external metrics collector
      if (this.config.exportMetrics && this.metrics) {
        this.metrics.recordCounter(
          `${this.config.metricsPrefix}.sessions.created`,
          1,
          {
            success: success.toString(),
          }
        );
        this.metrics.recordTimer(
          `${this.config.metricsPrefix}.creation.duration`,
          creationTime
        );
      }

      this.logger.debug("Session creation metrics recorded", {
        success,
        creationTime,
        activeSessions: this.sessionStats.activeSessions,
      });
    } catch (error) {
      this.logger.error("Failed to record session creation metrics", { error });
    }
  }

  /**
   * Record session validation metrics
   */
  async recordSessionValidation(
    sessionId: string,
    validationTime: number,
    isValid: boolean,
    reason?: string
  ): Promise<void> {
    try {
      this.recordMetric(
        "session_validation_duration",
        validationTime,
        "timer",
        {
          valid: isValid.toString(),
          reason: reason || "valid",
        }
      );

      // Update performance metrics
      this.updateAverageMetric(
        "averageValidationTime",
        validationTime,
        this.performanceMetrics.averageValidationTime
      );

      // Export to external metrics collector
      if (this.config.exportMetrics && this.metrics) {
        this.metrics.recordCounter(
          `${this.config.metricsPrefix}.validations.total`,
          1,
          {
            valid: isValid.toString(),
            reason: reason || "valid",
          }
        );
        this.metrics.recordTimer(
          `${this.config.metricsPrefix}.validation.duration`,
          validationTime
        );
      }

      // Check for alert conditions
      if (validationTime > this.config.alertThresholds.responseTime) {
        this.logger.warn("Slow session validation detected", {
          sessionId: this.hashSessionId(sessionId),
          validationTime,
          threshold: this.config.alertThresholds.responseTime,
        });
      }

      this.logger.debug("Session validation metrics recorded", {
        sessionId: this.hashSessionId(sessionId),
        validationTime,
        isValid,
        reason,
      });
    } catch (error) {
      this.logger.error("Failed to record session validation metrics", {
        error,
      });
    }
  }

  /**
   * Record token refresh metrics
   */
  async recordTokenRefresh(
    sessionId: string,
    refreshTime: number,
    success: boolean,
    reason?: string
  ): Promise<void> {
    try {
      if (success) {
        this.sessionStats.tokenRefreshCount++;
      }

      this.recordMetric("token_refresh_duration", refreshTime, "timer", {
        success: success.toString(),
        reason: reason || "success",
      });

      // Update performance metrics
      this.updateAverageMetric(
        "averageTokenRefreshTime",
        refreshTime,
        this.performanceMetrics.averageTokenRefreshTime
      );

      // Export to external metrics collector
      if (this.config.exportMetrics && this.metrics) {
        this.metrics.recordCounter(
          `${this.config.metricsPrefix}.token.refresh`,
          1,
          {
            success: success.toString(),
          }
        );
        this.metrics.recordTimer(
          `${this.config.metricsPrefix}.token.refresh_duration`,
          refreshTime
        );
      }

      this.logger.debug("Token refresh metrics recorded", {
        sessionId: this.hashSessionId(sessionId),
        refreshTime,
        success,
        reason,
      });
    } catch (error) {
      this.logger.error("Failed to record token refresh metrics", { error });
    }
  }

  /**
   * Record security violation metrics
   */
  async recordSecurityViolation(
    violationType: string,
    severity: "low" | "medium" | "high" | "critical",
    userId?: string
  ): Promise<void> {
    try {
      this.sessionStats.securityViolations++;
      this.securityMetrics.totalViolations++;

      // Update violation type counters
      this.securityMetrics.violationsByType[violationType] =
        (this.securityMetrics.violationsByType[violationType] || 0) + 1;

      // Update specific security metrics
      switch (violationType) {
        case "suspicious_login":
          this.securityMetrics.suspiciousLogins++;
          break;
        case "device_mismatch":
          this.securityMetrics.deviceMismatches++;
          break;
        case "rate_limit_exceeded":
          this.securityMetrics.rateLimitExceeded++;
          break;
      }

      this.recordMetric("security_violations", 1, "counter", {
        type: violationType,
        severity,
        userId: userId || "unknown",
      });

      // Export to external metrics collector
      if (this.config.exportMetrics && this.metrics) {
        this.metrics.recordCounter(
          `${this.config.metricsPrefix}.security.violations`,
          1,
          {
            type: violationType,
            severity,
          }
        );
      }

      // Check for alert thresholds
      const recentViolations = await this.getViolationsInLastHour();
      if (
        recentViolations >=
        this.config.alertThresholds.securityViolationsPerHour
      ) {
        this.logger.error("High security violation rate detected", {
          recentViolations,
          threshold: this.config.alertThresholds.securityViolationsPerHour,
          violationType,
        });
      }

      this.logger.info("Security violation metrics recorded", {
        violationType,
        severity,
        userId,
        totalViolations: this.securityMetrics.totalViolations,
      });
    } catch (error) {
      this.logger.error("Failed to record security violation metrics", {
        error,
      });
    }
  }

  /**
   * Record cache metrics
   */
  async recordCacheOperation(
    operation: "hit" | "miss" | "set" | "invalidate",
    responseTime?: number
  ): Promise<void> {
    try {
      this.recordMetric(`cache_${operation}`, 1, "counter");

      if (responseTime) {
        this.recordMetric(`cache_${operation}_duration`, responseTime, "timer");
      }

      // Calculate cache hit rate
      if (operation === "hit" || operation === "miss") {
        const hits = this.getMetricValue("cache_hit") || 0;
        const misses = this.getMetricValue("cache_miss") || 0;
        const total = hits + misses;
        this.performanceMetrics.cacheHitRate =
          total > 0 ? (hits / total) * 100 : 0;
      }

      // Export to external metrics collector
      if (this.config.exportMetrics && this.metrics) {
        this.metrics.recordCounter(
          `${this.config.metricsPrefix}.cache.${operation}`,
          1
        );
        if (responseTime) {
          this.metrics.recordTimer(
            `${this.config.metricsPrefix}.cache.${operation}_duration`,
            responseTime
          );
        }
      }

      this.logger.debug("Cache operation metrics recorded", {
        operation,
        responseTime,
        cacheHitRate: this.performanceMetrics.cacheHitRate,
      });
    } catch (error) {
      this.logger.error("Failed to record cache operation metrics", { error });
    }
  }

  /**
   * Record database operation metrics
   */
  async recordDatabaseOperation(
    operation: string,
    duration: number,
    success: boolean
  ): Promise<void> {
    try {
      this.recordMetric(`database_${operation}_duration`, duration, "timer", {
        success: success.toString(),
      });

      // Update average database operation time
      this.updateAverageMetric(
        "databaseOperationTime",
        duration,
        this.performanceMetrics.databaseOperationTime
      );

      // Export to external metrics collector
      if (this.config.exportMetrics && this.metrics) {
        this.metrics.recordCounter(
          `${this.config.metricsPrefix}.database.operations`,
          1,
          {
            operation,
            success: success.toString(),
          }
        );
        this.metrics.recordTimer(
          `${this.config.metricsPrefix}.database.duration`,
          duration
        );
      }

      this.logger.debug("Database operation metrics recorded", {
        operation,
        duration,
        success,
      });
    } catch (error) {
      this.logger.error("Failed to record database operation metrics", {
        error,
      });
    }
  }

  /**
   * Update session statistics
   */
  async updateSessionStats(stats: Partial<SessionStats>): Promise<void> {
    try {
      Object.assign(this.sessionStats, stats);

      // Check for alert conditions
      if (
        this.sessionStats.activeSessions >=
        this.config.alertThresholds.activeSessionsLimit
      ) {
        this.logger.warn("High active session count", {
          activeSessions: this.sessionStats.activeSessions,
          threshold: this.config.alertThresholds.activeSessionsLimit,
        });
      }

      // Export key metrics
      if (this.config.exportMetrics && this.metrics) {
        this.metrics.recordGauge(
          `${this.config.metricsPrefix}.sessions.active`,
          this.sessionStats.activeSessions
        );
        this.metrics.recordGauge(
          `${this.config.metricsPrefix}.sessions.total`,
          this.sessionStats.totalSessions
        );
      }

      this.logger.debug("Session statistics updated", stats);
    } catch (error) {
      this.logger.error("Failed to update session statistics", { error });
    }
  }

  /**
   * Get current session statistics
   */
  getSessionStats(): SessionStats {
    return { ...this.sessionStats };
  }

  /**
   * Get security metrics
   */
  getSecurityMetrics(): SecurityMetrics {
    return { ...this.securityMetrics };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Get operation metrics for a specific operation
   */
  getOperationMetrics(operation: string): SessionOperationMetrics | null {
    return this.operationMetrics.get(operation) || null;
  }

  /**
   * Get aggregated metrics for a time period
   */
  async getAggregatedMetrics(
    metricName: string,
    interval: number,
    startTime: Date,
    endTime: Date
  ): Promise<AggregatedMetric[]> {
    try {
      const key = `${metricName}:${interval}`;
      const aggregated = this.aggregatedMetrics.get(key) || [];

      return aggregated.filter(
        (metric) => metric.startTime >= startTime && metric.endTime <= endTime
      );
    } catch (error) {
      this.logger.error("Failed to get aggregated metrics", {
        error,
        metricName,
        interval,
      });
      return [];
    }
  }

  /**
   * Export metrics for external monitoring systems
   */
  async exportMetrics(): Promise<{
    session: SessionStats;
    security: SecurityMetrics;
    performance: PerformanceMetrics;
    operations: Record<string, SessionOperationMetrics>;
  }> {
    return {
      session: this.getSessionStats(),
      security: this.getSecurityMetrics(),
      performance: this.getPerformanceMetrics(),
      operations: Object.fromEntries(this.operationMetrics),
    };
  }

  /**
   * Perform metrics health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = performance.now();

    try {
      // Test metric recording
      this.recordMetric("health_check_test", 1, "counter");

      // Check buffer sizes
      const totalBufferedMetrics = Array.from(
        this.metricBuffer.values()
      ).reduce((sum, metrics) => sum + metrics.length, 0);

      // Check for memory issues
      const memoryUsage = process.memoryUsage();
      this.performanceMetrics.memoryUsage = memoryUsage.heapUsed / 1024 / 1024; // MB

      const responseTime = performance.now() - startTime;
      const stats = this.getSessionStats();

      return {
        status: "healthy",
        details: {
          metricsBuffer: totalBufferedMetrics,
          memoryUsage: Math.round(this.performanceMetrics.memoryUsage),
          activeSessions: stats.activeSessions,
          securityViolations: this.securityMetrics.totalViolations,
          responseTime: Math.round(responseTime),
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error("Metrics health check failed", { error });
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
  private recordMetric(
    name: string,
    value: number,
    type: "counter" | "gauge" | "timer" | "histogram",
    tags?: Record<string, string>
  ): void {
    if (!this.config.enableDetailedMetrics) return;

    const metric: MetricDataPoint = {
      timestamp: new Date(),
      value,
      ...(tags !== undefined && { tags }),
      type,
    };

    const buffer = this.metricBuffer.get(name) || [];
    buffer.push(metric);
    this.metricBuffer.set(name, buffer);

    // Limit buffer size to prevent memory issues
    if (buffer.length > 10000) {
      buffer.splice(0, buffer.length - 5000); // Keep last 5000 entries
    }
  }

  private getMetricValue(name: string): number {
    const buffer = this.metricBuffer.get(name) || [];
    return buffer.reduce((sum, metric) => sum + metric.value, 0);
  }

  private updateAverageMetric(
    metricName: keyof PerformanceMetrics,
    newValue: number,
    currentAverage: number
  ): void {
    const alpha = 0.1; // Exponential moving average factor
    this.performanceMetrics[metricName] =
      (1 - alpha) * currentAverage + alpha * newValue;
  }

  private async getViolationsInLastHour(): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const violations = this.metricBuffer.get("security_violations") || [];

    return violations.filter((metric) => metric.timestamp >= oneHourAgo).length;
  }

  private startPeriodicTasks(): void {
    // Aggregate metrics every minute
    setInterval(() => {
      this.aggregateMetrics();
    }, 60 * 1000);

    // Cleanup old metrics every hour
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 60 * 60 * 1000);

    // Reset daily counters at midnight
    setInterval(() => {
      this.resetDailyCounters();
    }, 24 * 60 * 60 * 1000);
  }

  private aggregateMetrics(): void {
    try {
      const now = new Date();

      for (const interval of this.config.aggregationIntervals) {
        this.aggregateMetricsForInterval(interval, now);
      }
    } catch (error) {
      this.logger.error("Metric aggregation failed", { error });
    }
  }

  private aggregateMetricsForInterval(interval: number, now: Date): void {
    const intervalStart = new Date(
      Math.floor(now.getTime() / interval) * interval
    );
    const intervalEnd = new Date(intervalStart.getTime() + interval);

    for (const [metricName, dataPoints] of this.metricBuffer) {
      const relevantPoints = dataPoints.filter(
        (point) =>
          point.timestamp >= intervalStart && point.timestamp < intervalEnd
      );

      if (relevantPoints.length === 0) continue;

      const values = relevantPoints.map((point) => point.value);
      const aggregated: AggregatedMetric = {
        interval,
        startTime: intervalStart,
        endTime: intervalEnd,
        count: values.length,
        sum: values.reduce((a, b) => a + b, 0),
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        p95: this.calculatePercentile(values, 0.95),
        p99: this.calculatePercentile(values, 0.99),
      };

      const key = `${metricName}:${interval}`;
      const existing = this.aggregatedMetrics.get(key) || [];
      existing.push(aggregated);
      this.aggregatedMetrics.set(key, existing);
    }
  }

  private calculatePercentile(values: number[], percentile: number): number {
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  private cleanupOldMetrics(): void {
    const cutoffTime = new Date(
      Date.now() - this.config.metricsRetentionDays * 24 * 60 * 60 * 1000
    );

    // Cleanup raw metrics
    for (const [name, dataPoints] of this.metricBuffer) {
      const filtered = dataPoints.filter(
        (point) => point.timestamp > cutoffTime
      );
      this.metricBuffer.set(name, filtered);
    }

    // Cleanup aggregated metrics
    for (const [name, aggregated] of this.aggregatedMetrics) {
      const filtered = aggregated.filter(
        (metric) => metric.startTime > cutoffTime
      );
      this.aggregatedMetrics.set(name, filtered);
    }
  }

  private resetDailyCounters(): void {
    // Note: These are daily counters that reset at midnight
    // The underlying properties track total counts but reset daily for monitoring
    this.sessionStats.sessionsCreated = 0;
    this.sessionStats.sessionsExpired = 0;
    this.logger.info("Daily counters reset");
  }

  private hashSessionId(sessionId: string): string {
    const crypto = require("crypto");
    return (
      crypto
        .createHash("sha256")
        .update(sessionId)
        .digest("hex")
        .substring(0, 8) + "..."
    );
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.metricBuffer.clear();
    this.aggregatedMetrics.clear();
    this.operationMetrics.clear();
    this.logger.info("SessionMetrics cleanup completed");
  }
}
