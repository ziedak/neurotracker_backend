/**
 * Sync Service Types
 *
 * Type definitions for the async Keycloak sync mechanism
 */

import type { UserCreateInput, UserUpdateInput } from "@libs/database";
import { QUEUE_CONFIG, WORKER_CONFIG, HEALTH_THRESHOLDS } from "../constants";

/**
 * Sync Operation Types
 */
export type SyncOperationType = "CREATE" | "UPDATE" | "DELETE";

/**
 * Sync operation status
 */
export type SyncOperationStatus =
  | "PENDING"
  | "PROCESSING"
  | "RETRYING"
  | "COMPLETED"
  | "FAILED";

/**
 * User sync status
 */
export type UserSyncStatus = "SYNCED" | "PENDING" | "FAILED" | "RETRYING";

/**
 * Health status levels
 */
export type HealthLevel = "HEALTHY" | "DEGRADED" | "UNHEALTHY";

/**
 * Sync Operation
 * Represents a single sync operation to be performed
 */
export interface SyncOperation {
  /** Unique operation ID */
  id: string;

  /** User ID being synced */
  userId: string;

  /** Type of operation */
  type: SyncOperationType;

  /** Operation data (null for DELETE) */
  data: UserCreateInput | UserUpdateInput | null;

  /** Current attempt number */
  attempt: number;

  /** Maximum retry attempts */
  maxAttempts: number;

  /** When operation was created */
  createdAt: Date;

  /** When operation should be executed (for retries) */
  scheduledFor: Date;

  /** Last error message (if failed) */
  lastError?: string;

  /** Current status */
  status: SyncOperationStatus;

  /** Priority (higher = more urgent) */
  priority?: number;
}

/**
 * Sync Result
 * Result of executing a sync operation
 */
export interface SyncResult {
  /** Whether operation succeeded */
  success: boolean;

  /** The operation that was executed */
  operation: SyncOperation;

  /** Error if failed */
  error?: Error;

  /** Duration in milliseconds */
  duration: number;

  /** Whether error is recoverable (can retry) */
  recoverable?: boolean;
}

/**
 * Sync Status
 * Current sync status for a user
 */
export interface SyncStatus {
  /** User ID */
  userId: string;

  /** Last successful sync timestamp */
  lastSyncAt?: Date;

  /** Type of last sync */
  lastSyncType?: SyncOperationType;

  /** Current sync status */
  status: UserSyncStatus;

  /** Number of pending operations */
  pendingOperations: number;

  /** Number of failed operations */
  failedOperations: number;

  /** Last error (if any) */
  lastError?: string;
}

/**
 * Health Check
 * Health status for a component
 */
export interface HealthCheck {
  /** Health level */
  status: HealthLevel;

  /** Human-readable message */
  message: string;

  /** Relevant metrics */
  metrics: Record<string, number>;

  /** Timestamp of check */
  timestamp: Date;
}

/**
 * Overall Health Status
 * Complete system health
 */
export interface HealthStatus {
  /** Overall health level */
  overall: HealthLevel;

  /** Queue health */
  queue: HealthCheck;

  /** Sync operations health */
  sync: HealthCheck;

  /** Overall timestamp */
  timestamp: Date;

  /** Additional details */
  details?: string;
}

/**
 * Sync Configuration
 */
export interface SyncConfig {
  /** Maximum queue size before rejecting new operations */
  maxQueueSize: number;

  /** Maximum retry attempts before giving up */
  maxRetries: number;

  /** Base delay for retry (in ms) */
  retryBaseDelay: number;

  /** Multiplier for exponential backoff */
  retryMultiplier: number;

  /** Number of concurrent workers */
  workerConcurrency: number;

  /** Worker poll interval (in ms) */
  workerPollInterval: number;

  /** Health check interval (in ms) */
  healthCheckInterval: number;

  /** Success rate threshold for health (0-1) */
  successRateThreshold: number;

  /** Queue size threshold for health alerts */
  queueSizeThreshold: number;

  /** Operation age threshold for health alerts (in ms) */
  operationAgeThreshold: number;

  /** Redis connection URL */
  redisUrl: string;

  /** Redis key prefix */
  redisKeyPrefix: string;

  /** Operation timeout (in ms) */
  operationTimeout: number;
}

/**
 * Queue Statistics
 * Statistics about the sync queue
 */
export interface QueueStats {
  /** Total pending operations */
  pending: number;

  /** Currently processing operations */
  processing: number;

  /** Operations scheduled for retry */
  retrying: number;

  /** Failed operations (dead letter queue) */
  failed: number;

  /** Total operations processed (since start) */
  totalProcessed: number;

  /** Total successful operations */
  totalSuccessful: number;

  /** Total failed operations */
  totalFailed: number;

  /** Average operation duration (in ms) */
  avgDuration: number;

  /** Oldest pending operation age (in ms) */
  oldestPendingAge?: number;
}

/**
 * Sync Metrics
 * Metrics for monitoring
 */
export interface SyncMetrics {
  /** Total operations */
  total: number;

  /** Successful operations */
  success: number;

  /** Failed operations */
  failed: number;

  /** Retry operations */
  retries: number;

  /** Average duration (in ms) */
  avgDuration: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Operations by type */
  byType: Record<SyncOperationType, number>;

  /** Errors by type */
  errorsByType: Record<string, number>;
}

/**
 * Default sync configuration
 */
export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  maxQueueSize: QUEUE_CONFIG.MAX_SIZE,
  maxRetries: 5,
  retryBaseDelay: QUEUE_CONFIG.RETRY_BASE_DELAY,
  retryMultiplier: QUEUE_CONFIG.RETRY_MULTIPLIER,
  workerConcurrency: WORKER_CONFIG.CONCURRENCY,
  workerPollInterval: WORKER_CONFIG.POLL_INTERVAL,
  healthCheckInterval: WORKER_CONFIG.HEALTH_CHECK_INTERVAL,
  successRateThreshold: HEALTH_THRESHOLDS.SUCCESS_RATE,
  queueSizeThreshold: HEALTH_THRESHOLDS.QUEUE_SIZE,
  operationAgeThreshold: HEALTH_THRESHOLDS.AGE_THRESHOLD,
  redisUrl: process.env["REDIS_URL"] || "redis://localhost:6379",
  redisKeyPrefix: "sync:",
  operationTimeout: WORKER_CONFIG.OPERATION_TIMEOUT,
};

/**
 * Recoverable error patterns
 * These errors should trigger a retry
 */
export const RECOVERABLE_ERROR_PATTERNS = [
  /network/i,
  /timeout/i,
  /rate limit/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /connection refused/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
];

/**
 * Check if an error is recoverable
 */
export function isRecoverableError(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();
  return RECOVERABLE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(errorMessage)
  );
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(
  attempt: number,
  config: SyncConfig
): number {
  if (attempt === 0) return 0; // First attempt, no delay

  const delay =
    config.retryBaseDelay * Math.pow(config.retryMultiplier, attempt - 1);

  // Cap at 1 hour
  return Math.min(delay, 3600000);
}

/**
 * Generate unique operation ID
 */
export function generateOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
