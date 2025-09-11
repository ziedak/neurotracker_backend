import { createLogger, type ILogger } from "@libs/utils";

/**
 * Production-grade timer management system to prevent memory leaks
 * and ensure proper cleanup of timers and intervals.
 */
export class TimerManager {
  private timers: Set<NodeJS.Timeout> = new Set();
  private intervals: Set<NodeJS.Timeout> = new Set();
  private isShuttingDown = false;
  private logger: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger || createLogger("TimerManager");
  }

  /**
   * Creates a timeout with automatic cleanup tracking
   */
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout | null {
    if (this.isShuttingDown) {
      this.logger?.warn("Timer creation attempted during shutdown");
      return null;
    }

    const timer = setTimeout(() => {
      this.timers.delete(timer);
      try {
        callback();
      } catch (error) {
        this.logger?.error("Error in timer callback:", error);
      }
    }, ms);

    this.timers.add(timer);
    return timer;
  }

  /**
   * Creates an interval with automatic cleanup tracking
   */
  setInterval(callback: () => void, ms: number): NodeJS.Timeout | null {
    if (this.isShuttingDown) {
      this.logger?.warn("Interval creation attempted during shutdown");
      return null;
    }

    const interval = setInterval(() => {
      try {
        callback();
      } catch (error) {
        this.logger?.error("Error in interval callback:", error);
      }
    }, ms);

    this.intervals.add(interval);
    return interval;
  }

  /**
   * Clears a specific timeout
   */
  clearTimeout(timer: NodeJS.Timeout | null): void {
    if (!timer) return;

    clearTimeout(timer);
    this.timers.delete(timer);
  }

  /**
   * Clears a specific interval
   */
  clearInterval(interval: NodeJS.Timeout | null): void {
    if (!interval) return;

    clearInterval(interval);
    this.intervals.delete(interval);
  }

  /**
   * Cleanup all timers and intervals
   */
  cleanup(): void {
    this.isShuttingDown = true;

    // Clear all timers
    for (const timer of this.timers) {
      clearTimeout(timer);
    }

    // Clear all intervals
    for (const interval of this.intervals) {
      clearInterval(interval);
    }

    this.timers.clear();
    this.intervals.clear();

    this.logger?.info(
      `Cleaned up ${this.timers.size + this.intervals.size} timers`
    );
  }

  /**
   * Get count of active timers for monitoring
   */
  getActiveTimersCount(): number {
    return this.timers.size + this.intervals.size;
  }

  /**
   * Get detailed stats for monitoring
   */
  getStats() {
    return {
      activeTimers: this.timers.size,
      activeIntervals: this.intervals.size,
      total: this.timers.size + this.intervals.size,
      isShuttingDown: this.isShuttingDown,
    };
  }

  /**
   * Check if the timer manager is healthy
   */
  isHealthy(): boolean {
    const totalTimers = this.timers.size + this.intervals.size;
    // Alert if we have too many active timers (potential memory leak)
    return totalTimers < 1000 && !this.isShuttingDown;
  }
}

/**
 * Singleton timer manager for global use
 */
export const globalTimerManager = new TimerManager();
