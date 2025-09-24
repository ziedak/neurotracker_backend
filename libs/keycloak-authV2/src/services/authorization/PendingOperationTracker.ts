/**
 * Pending operations tracker for authorization service
 * Handles race condition prevention and operation lifecycle management
 */

import { createLogger } from "@libs/utils";
import type { AuthorizationResult } from "../../types/authorization.types";

/**
 * Pending operation structure
 */
export interface PendingOperation {
  promise: Promise<AuthorizationResult>;
  timestamp: number;
  timeout: NodeJS.Timeout;
}

/**
 * Pending operations tracker
 */
export class PendingOperationTracker {
  private readonly logger = createLogger("PendingOperationTracker");
  private readonly pendingOperations = new Map<string, PendingOperation>();
  private cleanupInterval?: NodeJS.Timeout | undefined;

  constructor() {
    this.startCleanupInterval();
  }

  /**
   * Track a new operation with timeout protection
   */
  trackOperation(
    key: string,
    promise: Promise<AuthorizationResult>,
    timeoutMs: number = 60 * 1000
  ): Promise<AuthorizationResult> {
    // Create timeout to prevent hanging operations
    const timeout = setTimeout(() => {
      this.pendingOperations.delete(key);
      this.logger.warn("Authorization computation timeout", {
        cacheKey: key.substring(0, 20) + "...",
      });
    }, timeoutMs);

    const operation: PendingOperation = {
      promise,
      timestamp: Date.now(),
      timeout,
    };

    this.pendingOperations.set(key, operation);

    // Return promise that cleans up after completion
    return promise.finally(() => {
      const op = this.pendingOperations.get(key);
      if (op) {
        clearTimeout(op.timeout);
        this.pendingOperations.delete(key);
      }
    });
  }

  /**
   * Get pending operation if exists
   */
  getPendingOperation(key: string): Promise<AuthorizationResult> | null {
    const operation = this.pendingOperations.get(key);
    return operation ? operation.promise : null;
  }

  /**
   * Check if operation is pending
   */
  hasPendingOperation(key: string): boolean {
    return this.pendingOperations.has(key);
  }

  /**
   * Get pending operations count
   */
  getPendingCount(): number {
    return this.pendingOperations.size;
  }

  /**
   * Start periodic cleanup of stale pending operations
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStalePendingOperations();
    }, 5 * 60 * 1000); // 5 minutes

    // Allow process to exit even with this interval running
    if (
      this.cleanupInterval &&
      typeof this.cleanupInterval.unref === "function"
    ) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Clean up stale pending operations to prevent memory leaks
   */
  private cleanupStalePendingOperations(): void {
    const now = Date.now();
    const staleThreshold = 60 * 1000; // 1 minute

    for (const [key, operation] of this.pendingOperations) {
      if (now - operation.timestamp > staleThreshold) {
        clearTimeout(operation.timeout);
        this.pendingOperations.delete(key);
        this.logger.warn("Cleaned up stale pending authorization operation", {
          cacheKey: key.substring(0, 20) + "...",
          age: now - operation.timestamp,
        });
      }
    }
  }

  /**
   * Cleanup all pending operations
   */
  cleanup(): void {
    try {
      // Clear cleanup interval
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = undefined;
      }

      // Clear all pending operations and their timeouts
      for (const [, operation] of this.pendingOperations) {
        clearTimeout(operation.timeout);
      }
      this.pendingOperations.clear();

      this.logger.info("PendingOperationTracker cleanup completed");
    } catch (error) {
      this.logger.error("Failed to cleanup PendingOperationTracker", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
