/**
 * Token Refresh Scheduler Service
 * Pure scheduling service for automatic token refresh
 * Separated from storage concerns for clean architecture
 */

import { z } from "zod";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";

/**
 * Configuration for token refresh scheduling
 */
const SchedulerConfigSchema = z.object({
  refreshBuffer: z
    .number()
    .int()
    .min(0, "Refresh buffer must be non-negative")
    .describe("Time in seconds before expiration to trigger refresh"),
});

export type SchedulerConfig = z.infer<typeof SchedulerConfigSchema>;

/**
 * Callback function for token refresh
 * Returns true if refresh succeeded, false otherwise
 */
export type RefreshCallback = () => Promise<boolean>;

/**
 * Scheduler statistics
 */
export interface SchedulerStats {
  enabled: boolean;
  config: SchedulerConfig;
  activeTimers: number;
  scheduledRefreshes: string[];
}

/**
 * Scheduler health check result
 */
export interface SchedulerHealth {
  status: "healthy" | "unhealthy" | "degraded";
  details: {
    activeTimers: number;
    issues: string[];
  };
}

/**
 * Constants
 */
const MAX_ACTIVE_TIMERS_WARNING = 1000;
const ACTIVE_TIMERS_METRIC = "token_refresh_scheduler.active_timers";
const REFRESH_SUCCESS_METRIC = "token_refresh_scheduler.refresh_success";
const REFRESH_ERROR_METRIC = "token_refresh_scheduler.refresh_error";
const REFRESH_TRIGGERED_METRIC = "token_refresh_scheduler.refresh_triggered";

/**
 * TokenRefreshScheduler
 *
 * Pure scheduling service that handles automatic token refresh timing.
 * Does NOT handle storage - relies on callbacks to perform actual refresh operations.
 *
 * Responsibilities:
 * - Schedule automatic token refresh before expiration
 * - Manage setTimeout timers for background refresh
 * - Prevent race conditions with scheduling locks
 * - Clean up timers on cancellation or disposal
 *
 * Does NOT:
 * - Store tokens (delegated to SessionStore)
 * - Perform refresh API calls (delegated to callback)
 * - Manage encryption (delegated to SessionStore)
 */
export class TokenRefreshScheduler {
  private readonly logger = createLogger("TokenRefreshScheduler");
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>();
  private readonly schedulingLocks = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly config: SchedulerConfig,
    private readonly metrics?: IMetricsCollector
  ) {
    SchedulerConfigSchema.parse(config);

    this.logger.info("TokenRefreshScheduler initialized", {
      refreshBuffer: config.refreshBuffer,
    });
  }

  /**
   * Schedule automatic token refresh
   *
   * @param key - Unique identifier for this refresh schedule (e.g., sessionId)
   * @param expiresAt - When the token expires
   * @param refreshCallback - Function to call when refresh should occur
   * @returns Promise that resolves when scheduling is complete
   */
  async scheduleRefresh(
    key: string,
    expiresAt: Date,
    refreshCallback: RefreshCallback
  ): Promise<void> {
    // Prevent concurrent scheduling for same key
    if (this.schedulingLocks.has(key)) {
      this.logger.debug("Refresh scheduling already in progress", { key });
      return;
    }

    // Set temporary lock (30 seconds)
    const lockTimer = setTimeout(() => {
      this.schedulingLocks.delete(key);
    }, 30000);
    this.schedulingLocks.set(key, lockTimer);

    try {
      await this.doScheduleRefresh(key, expiresAt, refreshCallback);
    } finally {
      // Clean up lock
      if (this.schedulingLocks.has(key)) {
        clearTimeout(this.schedulingLocks.get(key)!);
        this.schedulingLocks.delete(key);
      }
    }
  }

  /**
   * Internal scheduling logic
   */
  private async doScheduleRefresh(
    key: string,
    expiresAt: Date,
    refreshCallback: RefreshCallback
  ): Promise<void> {
    // Cancel existing timer if any
    this.cancelRefresh(key);

    // Calculate refresh time (buffer before expiration)
    const refreshTime = new Date(
      expiresAt.getTime() - this.config.refreshBuffer * 1000
    );
    const delay = Math.max(0, refreshTime.getTime() - Date.now());

    if (delay === 0) {
      // Token expires immediately, trigger refresh now
      this.logger.debug("Token expires soon, refreshing immediately", {
        key,
        expiresAt: expiresAt.toISOString(),
      });

      this.executeRefresh(key, refreshCallback).catch((error) => {
        this.logger.error("Immediate refresh failed", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    // Schedule refresh
    const timer = setTimeout(async () => {
      try {
        this.logger.debug("Scheduled token refresh triggered", {
          key,
          scheduledFor: refreshTime.toISOString(),
        });

        this.metrics?.recordCounter(REFRESH_TRIGGERED_METRIC, 1);

        await this.executeRefresh(key, refreshCallback);

        this.logger.debug("Scheduled token refresh completed", { key });
      } catch (error) {
        this.logger.error("Scheduled refresh failed", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        // Cleanup timer reference
        this.refreshTimers.delete(key);
        this.updateActiveTimersMetric();
      }
    }, delay);

    this.refreshTimers.set(key, timer);
    this.updateActiveTimersMetric();

    this.logger.debug("Token refresh scheduled", {
      key,
      expiresAt: expiresAt.toISOString(),
      refreshAt: refreshTime.toISOString(),
      delayMs: delay,
    });
  }

  /**
   * Execute the refresh callback
   */
  private async executeRefresh(
    key: string,
    refreshCallback: RefreshCallback
  ): Promise<void> {
    try {
      const success = await refreshCallback();

      if (success) {
        this.metrics?.recordCounter(REFRESH_SUCCESS_METRIC, 1);
        this.logger.debug("Refresh callback succeeded", { key });
      } else {
        this.metrics?.recordCounter(REFRESH_ERROR_METRIC, 1);
        this.logger.warn("Refresh callback returned false", { key });
      }
    } catch (error) {
      this.metrics?.recordCounter(REFRESH_ERROR_METRIC, 1);
      this.logger.error("Refresh callback threw error", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Cancel scheduled refresh for a key
   */
  cancelRefresh(key: string): void {
    if (this.refreshTimers.has(key)) {
      clearTimeout(this.refreshTimers.get(key)!);
      this.refreshTimers.delete(key);
      this.updateActiveTimersMetric();

      this.logger.debug("Cancelled scheduled refresh", { key });
    }
  }

  /**
   * Check if a refresh is scheduled for a key
   */
  hasScheduledRefresh(key: string): boolean {
    return this.refreshTimers.has(key);
  }

  /**
   * Get scheduler statistics
   */
  getStats(): SchedulerStats {
    return {
      enabled: true,
      config: this.config,
      activeTimers: this.refreshTimers.size,
      scheduledRefreshes: Array.from(this.refreshTimers.keys()),
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<SchedulerHealth> {
    const stats = this.getStats();
    const issues: string[] = [];

    // Check for excessive active timers (potential memory leak)
    if (stats.activeTimers > MAX_ACTIVE_TIMERS_WARNING) {
      issues.push(`Too many active timers: ${stats.activeTimers}`);
    }

    // Determine status
    const status: "healthy" | "unhealthy" | "degraded" =
      issues.length === 0 ? "healthy" : "degraded";

    return {
      status,
      details: {
        activeTimers: stats.activeTimers,
        issues,
      },
    };
  }

  /**
   * Update metrics for active timers
   */
  private updateActiveTimersMetric(): void {
    this.metrics?.recordGauge(ACTIVE_TIMERS_METRIC, this.refreshTimers.size);
  }

  /**
   * Dispose and cleanup all resources
   */
  async dispose(): Promise<void> {
    this.logger.debug("Disposing TokenRefreshScheduler", {
      activeTimers: this.refreshTimers.size,
      activeLocks: this.schedulingLocks.size,
    });

    // Cancel all active timers
    for (const [key, timer] of this.refreshTimers) {
      clearTimeout(timer);
      this.logger.debug("Cancelled refresh timer", { key });
    }
    this.refreshTimers.clear();

    // Clear all scheduling locks
    for (const [key, lockTimer] of this.schedulingLocks) {
      clearTimeout(lockTimer);
      this.logger.debug("Cleared scheduling lock", { key });
    }
    this.schedulingLocks.clear();

    this.updateActiveTimersMetric();

    this.logger.info("TokenRefreshScheduler disposed successfully");
  }
}
