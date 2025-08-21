/**
 * @fileoverview AuthenticationMetrics - Enterprise authentication metrics service
 * @module services/auth/AuthenticationMetrics
 * @version 1.0.0
 * @author Enterprise Development Team
 * @description Comprehensive metrics collection and analysis for authentication operations
 */

import type { ICacheService } from "../../contracts/services";
import { createTimestamp, type Timestamp } from "../../types/core";

/**
 * Authentication method types for metrics
 */
type AuthenticationMethod = "password" | "apikey" | "session" | "jwt";

/**
 * Metrics event types
 */
type MetricsEventType =
  | "attempt"
  | "success"
  | "failure"
  | "rate_limited"
  | "blocked";

/**
 * Authentication metrics data structure
 */
interface IAuthenticationMetrics {
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  rateLimitedAttempts: number;
  blockedAttempts: number;
  averageResponseTime: number;
  uniqueUsers: Set<string>;
  methodDistribution: Record<AuthenticationMethod, number>;
  errorDistribution: Record<string, number>;
  hourlyDistribution: Record<string, number>;
  lastUpdated: Timestamp;
}

/**
 * Response time sample for calculating averages
 */
interface IResponseTimeSample {
  timestamp: number;
  responseTime: number;
  method: AuthenticationMethod;
  success: boolean;
}

/**
 * Metrics aggregation period
 */
type MetricsPeriod = "hourly" | "daily" | "weekly" | "monthly";

/**
 * Metrics snapshot for reporting
 */
interface IMetricsSnapshot {
  period: MetricsPeriod;
  timestamp: Timestamp;
  totalAttempts: number;
  successRate: number;
  failureRate: number;
  averageResponseTime: number;
  uniqueUsers: number;
  topMethods: Array<{
    method: AuthenticationMethod;
    count: number;
    percentage: number;
  }>;
  topErrors: Array<{ error: string; count: number; percentage: number }>;
  peakHour: string;
  trends: {
    attemptsChange: number; // Percentage change from previous period
    successRateChange: number;
    responseTimeChange: number;
  };
}

/**
 * Cache configuration for metrics storage
 */
const METRICS_CACHE = {
  PREFIX: "metrics:auth:",
  SAMPLES_PREFIX: "metrics:samples:",
  SNAPSHOTS_PREFIX: "metrics:snapshots:",
  TTL: {
    CURRENT: 24 * 60 * 60, // 24 hours
    HOURLY: 7 * 24 * 60 * 60, // 7 days
    DAILY: 30 * 24 * 60 * 60, // 30 days
    SAMPLES: 60 * 60, // 1 hour for response time samples
  },
} as const;

/**
 * Enterprise authentication metrics manager
 *
 * Provides comprehensive metrics collection and analysis:
 * - Real-time authentication attempt tracking
 * - Response time monitoring with statistical analysis
 * - Method and error distribution analytics
 * - Hourly, daily, weekly, and monthly aggregations
 * - Trend analysis and performance insights
 * - Cached metrics for high-performance reporting
 */
export class AuthenticationMetrics {
  private readonly cacheService: ICacheService;
  private readonly maxResponseTimeSamples: number = 1000;
  private currentMetrics: IAuthenticationMetrics;
  private responseTimeBuffer: IResponseTimeSample[] = [];

  constructor(cacheService: ICacheService) {
    this.cacheService = cacheService;
    this.currentMetrics = this.createEmptyMetrics();

    // Initialize metrics from cache if available
    this.initializeFromCache();
  }

  /**
   * Record an authentication attempt
   */
  async recordAttempt(
    method: AuthenticationMethod,
    eventType: MetricsEventType,
    userId?: string,
    errorCode?: string
  ): Promise<void> {
    // Update current metrics
    this.currentMetrics.totalAttempts++;
    this.currentMetrics.methodDistribution[method]++;
    this.currentMetrics.lastUpdated = createTimestamp();

    if (userId) {
      this.currentMetrics.uniqueUsers.add(userId);
    }

    switch (eventType) {
      case "success":
        this.currentMetrics.successfulAttempts++;
        break;
      case "failure":
        this.currentMetrics.failedAttempts++;
        if (errorCode) {
          this.currentMetrics.errorDistribution[errorCode] =
            (this.currentMetrics.errorDistribution[errorCode] || 0) + 1;
        }
        break;
      case "rate_limited":
        this.currentMetrics.rateLimitedAttempts++;
        break;
      case "blocked":
        this.currentMetrics.blockedAttempts++;
        break;
    }

    // Update hourly distribution
    const hour = new Date().getHours().toString().padStart(2, "0");
    this.currentMetrics.hourlyDistribution[hour] =
      (this.currentMetrics.hourlyDistribution[hour] || 0) + 1;

    // Persist metrics to cache
    await this.persistMetrics();
  }

  /**
   * Record response time for performance monitoring
   */
  async recordResponseTime(
    responseTime: number,
    method: AuthenticationMethod,
    success: boolean
  ): Promise<void> {
    const sample: IResponseTimeSample = {
      timestamp: Date.now(),
      responseTime,
      method,
      success,
    };

    // Add to buffer
    this.responseTimeBuffer.push(sample);

    // Maintain buffer size
    if (this.responseTimeBuffer.length > this.maxResponseTimeSamples) {
      this.responseTimeBuffer = this.responseTimeBuffer.slice(
        -this.maxResponseTimeSamples
      );
    }

    // Calculate new average
    this.currentMetrics.averageResponseTime =
      this.calculateAverageResponseTime();

    // Persist samples to cache
    await this.persistResponseTimeSamples();
  }

  /**
   * Get current metrics snapshot
   */
  async getCurrentMetrics(): Promise<IMetricsSnapshot> {
    const totalAttempts = this.currentMetrics.totalAttempts;
    const successRate =
      totalAttempts > 0
        ? (this.currentMetrics.successfulAttempts / totalAttempts) * 100
        : 0;
    const failureRate =
      totalAttempts > 0
        ? (this.currentMetrics.failedAttempts / totalAttempts) * 100
        : 0;

    // Calculate top methods
    const topMethods = Object.entries(this.currentMetrics.methodDistribution)
      .map(([method, count]) => ({
        method: method as AuthenticationMethod,
        count,
        percentage: totalAttempts > 0 ? (count / totalAttempts) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Calculate top errors
    const totalErrors = Object.values(
      this.currentMetrics.errorDistribution
    ).reduce((sum, count) => sum + count, 0);
    const topErrors = Object.entries(this.currentMetrics.errorDistribution)
      .map(([error, count]) => ({
        error,
        count,
        percentage: totalErrors > 0 ? (count / totalErrors) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Find peak hour
    const peakHour = Object.entries(
      this.currentMetrics.hourlyDistribution
    ).reduce(
      (peak, [hour, count]) =>
        count > (this.currentMetrics.hourlyDistribution[peak] || 0)
          ? hour
          : peak,
      "00"
    );

    // Get trends (comparison with previous period would require historical data)
    const trends = await this.calculateTrends();

    return {
      period: "daily",
      timestamp: this.currentMetrics.lastUpdated,
      totalAttempts,
      successRate: Math.round(successRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      averageResponseTime: Math.round(this.currentMetrics.averageResponseTime),
      uniqueUsers: this.currentMetrics.uniqueUsers.size,
      topMethods,
      topErrors,
      peakHour,
      trends,
    };
  }

  /**
   * Get metrics for a specific period
   */
  async getMetricsForPeriod(
    period: MetricsPeriod,
    date?: string
  ): Promise<IMetricsSnapshot | null> {
    const key = this.getSnapshotKey(period, date);
    return await this.cacheService.get<IMetricsSnapshot>(key);
  }

  /**
   * Get response time statistics
   */
  getResponseTimeStats(): {
    min: number;
    max: number;
    average: number;
    median: number;
    p95: number;
    p99: number;
    samples: number;
  } {
    if (this.responseTimeBuffer.length === 0) {
      return {
        min: 0,
        max: 0,
        average: 0,
        median: 0,
        p95: 0,
        p99: 0,
        samples: 0,
      };
    }

    const times = this.responseTimeBuffer
      .map((sample) => sample.responseTime)
      .sort((a, b) => a - b);

    const min = times[0];
    const max = times[times.length - 1];
    const average = times.reduce((sum, time) => sum + time, 0) / times.length;
    const median = this.calculatePercentile(times, 50);
    const p95 = this.calculatePercentile(times, 95);
    const p99 = this.calculatePercentile(times, 99);

    return {
      min: Math.round(min),
      max: Math.round(max),
      average: Math.round(average),
      median: Math.round(median),
      p95: Math.round(p95),
      p99: Math.round(p99),
      samples: times.length,
    };
  }

  /**
   * Generate periodic snapshots (called by scheduler)
   */
  async generateSnapshot(period: MetricsPeriod): Promise<void> {
    const snapshot = await this.getCurrentMetrics();
    snapshot.period = period;

    const key = this.getSnapshotKey(period);
    const ttl = this.getSnapshotTTL(period);

    await this.cacheService.set(key, snapshot, ttl);
  }

  /**
   * Reset metrics (typically called at period boundaries)
   */
  async resetMetrics(): Promise<void> {
    // Store current metrics as snapshot before reset
    await this.generateSnapshot("daily");

    // Reset to empty metrics
    this.currentMetrics = this.createEmptyMetrics();
    this.responseTimeBuffer = [];

    // Clear from cache
    await this.cacheService.delete(`${METRICS_CACHE.PREFIX}current`);
    await this.cacheService.delete(`${METRICS_CACHE.SAMPLES_PREFIX}current`);
  }

  /**
   * Get method performance comparison
   */
  getMethodPerformance(): Array<{
    method: AuthenticationMethod;
    attempts: number;
    successRate: number;
    averageResponseTime: number;
    errorRate: number;
  }> {
    return (
      Object.keys(
        this.currentMetrics.methodDistribution
      ) as AuthenticationMethod[]
    )
      .map((method) => {
        const attempts = this.currentMetrics.methodDistribution[method] || 0;
        const methodSamples = this.responseTimeBuffer.filter(
          (sample) => sample.method === method
        );
        const successfulSamples = methodSamples.filter(
          (sample) => sample.success
        );

        const successRate =
          attempts > 0
            ? (successfulSamples.length / methodSamples.length) * 100
            : 0;

        const averageResponseTime =
          methodSamples.length > 0
            ? methodSamples.reduce(
                (sum, sample) => sum + sample.responseTime,
                0
              ) / methodSamples.length
            : 0;

        const errorRate = 100 - successRate;

        return {
          method,
          attempts,
          successRate: Math.round(successRate * 100) / 100,
          averageResponseTime: Math.round(averageResponseTime),
          errorRate: Math.round(errorRate * 100) / 100,
        };
      })
      .sort((a, b) => b.attempts - a.attempts);
  }

  /**
   * Private helper methods
   */

  private createEmptyMetrics(): IAuthenticationMetrics {
    return {
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      rateLimitedAttempts: 0,
      blockedAttempts: 0,
      averageResponseTime: 0,
      uniqueUsers: new Set<string>(),
      methodDistribution: {
        password: 0,
        apikey: 0,
        session: 0,
        jwt: 0,
      },
      errorDistribution: {},
      hourlyDistribution: {},
      lastUpdated: createTimestamp(),
    };
  }

  private async initializeFromCache(): Promise<void> {
    try {
      const cachedMetrics = await this.cacheService.get<any>(
        `${METRICS_CACHE.PREFIX}current`
      );
      if (cachedMetrics) {
        // Restore metrics but convert uniqueUsers back to Set
        this.currentMetrics = {
          ...cachedMetrics,
          uniqueUsers: new Set(cachedMetrics.uniqueUsers || []),
        };
      }

      const cachedSamples = await this.cacheService.get<IResponseTimeSample[]>(
        `${METRICS_CACHE.SAMPLES_PREFIX}current`
      );
      if (cachedSamples) {
        this.responseTimeBuffer = cachedSamples;
      }
    } catch (error) {
      // If cache initialization fails, continue with empty metrics
      console.warn("Failed to initialize metrics from cache:", error);
    }
  }

  private async persistMetrics(): Promise<void> {
    try {
      // Convert Set to Array for serialization
      const metricsToCache = {
        ...this.currentMetrics,
        uniqueUsers: Array.from(this.currentMetrics.uniqueUsers),
      };

      await this.cacheService.set(
        `${METRICS_CACHE.PREFIX}current`,
        metricsToCache,
        METRICS_CACHE.TTL.CURRENT
      );
    } catch (error) {
      console.warn("Failed to persist metrics to cache:", error);
    }
  }

  private async persistResponseTimeSamples(): Promise<void> {
    try {
      await this.cacheService.set(
        `${METRICS_CACHE.SAMPLES_PREFIX}current`,
        this.responseTimeBuffer,
        METRICS_CACHE.TTL.SAMPLES
      );
    } catch (error) {
      console.warn("Failed to persist response time samples:", error);
    }
  }

  private calculateAverageResponseTime(): number {
    if (this.responseTimeBuffer.length === 0) return 0;

    const sum = this.responseTimeBuffer.reduce(
      (total, sample) => total + sample.responseTime,
      0
    );
    return sum / this.responseTimeBuffer.length;
  }

  private calculatePercentile(
    sortedArray: number[],
    percentile: number
  ): number {
    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (upper >= sortedArray.length) return sortedArray[sortedArray.length - 1];

    return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
  }

  private async calculateTrends(): Promise<IMetricsSnapshot["trends"]> {
    // For now, return empty trends. In a real implementation, this would
    // compare with previous period's snapshot
    return {
      attemptsChange: 0,
      successRateChange: 0,
      responseTimeChange: 0,
    };
  }

  private getSnapshotKey(period: MetricsPeriod, date?: string): string {
    const dateStr = date || this.getPeriodDateString(period);
    return `${METRICS_CACHE.SNAPSHOTS_PREFIX}${period}:${dateStr}`;
  }

  private getPeriodDateString(period: MetricsPeriod): string {
    const now = new Date();
    switch (period) {
      case "hourly":
        return `${now.toISOString().split("T")[0]}-${now
          .getHours()
          .toString()
          .padStart(2, "0")}`;
      case "daily":
        return now.toISOString().split("T")[0];
      case "weekly":
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        return `${weekStart.toISOString().split("T")[0]}-week`;
      case "monthly":
        return `${now.getFullYear()}-${(now.getMonth() + 1)
          .toString()
          .padStart(2, "0")}`;
      default:
        return now.toISOString().split("T")[0];
    }
  }

  private getSnapshotTTL(period: MetricsPeriod): number {
    switch (period) {
      case "hourly":
        return METRICS_CACHE.TTL.HOURLY;
      case "daily":
        return METRICS_CACHE.TTL.DAILY;
      case "weekly":
        return METRICS_CACHE.TTL.DAILY * 7;
      case "monthly":
        return METRICS_CACHE.TTL.DAILY * 30;
      default:
        return METRICS_CACHE.TTL.DAILY;
    }
  }
}
