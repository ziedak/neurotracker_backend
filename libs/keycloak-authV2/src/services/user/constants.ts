/**
 * User Service Constants
 *
 * Centralized constants to replace magic numbers and improve maintainability.
 */

/**
 * Cache TTL values (in seconds)
 */
export const CACHE_TTL = {
  USER: 300, // 5 minutes for user data
  SEARCH: 60, // 1 minute for search results
  TOKEN: 300, // 5 minutes for tokens (calculated from expiry)
} as const;

/**
 * Retry configuration
 */
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000,
  MAX_DELAY_MS: 30000,
} as const;

/**
 * Sync operation priorities
 */
export const SYNC_PRIORITIES = {
  CREATE: 1,
  UPDATE: 0,
  DELETE: 2,
} as const;

/**
 * Health check thresholds
 */
export const HEALTH_THRESHOLDS = {
  SUCCESS_RATE: 0.95, // 95% success rate
  QUEUE_SIZE: 100, // Max queue size before alert
  AGE_THRESHOLD: 600000, // 10 minutes max operation age
} as const;

/**
 * Worker configuration
 */
export const WORKER_CONFIG = {
  CONCURRENCY: 5,
  POLL_INTERVAL: 1000, // 1 second
  HEALTH_CHECK_INTERVAL: 30000, // 30 seconds
  OPERATION_TIMEOUT: 30000, // 30 seconds
} as const;

/**
 * Queue configuration
 */
export const QUEUE_CONFIG = {
  MAX_SIZE: 1000,
  RETRY_BASE_DELAY: 5000, // 5 seconds
  RETRY_MULTIPLIER: 5, // Exponential: 5s, 25s, 125s, 625s, 3125s
} as const;
