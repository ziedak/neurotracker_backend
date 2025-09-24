/**
 * Pending computation tracker
 * Manages race conditions and prevents duplicate computations
 */

import { createLogger } from "@libs/utils";
import type { AppAbility } from "../../types/authorization.types";
import type { PendingComputation } from "./AbilityFactoryTypes";
import type { AbilityFactoryConstants } from "./AbilityFactoryConfig";

export class ComputationTracker {
  private readonly logger = createLogger("ComputationTracker");
  private readonly pendingComputations = new Map<string, PendingComputation>();
  private cleanupInterval?: NodeJS.Timeout | undefined;

  constructor(private readonly constants: AbilityFactoryConstants) {
    this.startPeriodicCleanup();
  }

  /**
   * Track computation with proper cleanup and timeout handling
   */
  trackComputation(
    key: string,
    promise: Promise<AppAbility>
  ): Promise<AppAbility> {
    const timeout = setTimeout(() => {
      this.pendingComputations.delete(key);
      this.logger.warn("Computation timeout", {
        key: key.substring(0, 20) + "...",
      });
    }, this.constants.STALE_COMPUTATION_THRESHOLD_MS);

    const computation: PendingComputation = {
      promise,
      timestamp: Date.now(),
      timeout,
    };

    this.pendingComputations.set(key, computation);

    return promise.finally(() => {
      clearTimeout(timeout);
      this.pendingComputations.delete(key);
    });
  }

  /**
   * Get pending computation if exists
   */
  getPendingComputation(key: string): Promise<AppAbility> | null {
    const computation = this.pendingComputations.get(key);
    return computation ? computation.promise : null;
  }

  /**
   * Check if computation is pending
   */
  hasPendingComputation(key: string): boolean {
    return this.pendingComputations.has(key);
  }

  /**
   * Get pending computations count
   */
  getPendingCount(): number {
    return this.pendingComputations.size;
  }

  /**
   * Start periodic cleanup of stale pending operations
   */
  private startPeriodicCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStalePendingOperations();
    }, this.constants.CLEANUP_INTERVAL_MS);
  }

  /**
   * Clean up stale pending operations to prevent memory leaks
   */
  private cleanupStalePendingOperations(): void {
    const now = Date.now();

    for (const [key, computation] of this.pendingComputations) {
      const age = now - computation.timestamp;
      if (age > this.constants.STALE_COMPUTATION_THRESHOLD_MS) {
        clearTimeout(computation.timeout);
        this.pendingComputations.delete(key);
        this.logger.warn("Cleaned up stale pending computation", {
          key: key.substring(0, 20) + "...",
          age,
        });
      }
    }

    if (
      this.pendingComputations.size > this.constants.MAX_PENDING_COMPUTATIONS
    ) {
      this.logger.warn("High number of pending computations", {
        count: this.pendingComputations.size,
      });
    }
  }

  /**
   * Cleanup method for proper lifecycle management
   */
  cleanup(): void {
    try {
      // Clear cleanup interval
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = undefined;
      }

      // Clear all pending computations and their timeouts
      for (const [, computation] of this.pendingComputations) {
        clearTimeout(computation.timeout);
      }
      this.pendingComputations.clear();

      this.logger.info("ComputationTracker cleanup completed");
    } catch (error) {
      this.logger.error("Failed to cleanup ComputationTracker", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
