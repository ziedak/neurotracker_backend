/**
 * WebSocket Token Validator Constants
 *
 * Centralized constants for better maintainability and configuration
 */

// Time-related constants (in milliseconds)
export const TIME_CONSTANTS = {
  TOKEN_EXPIRATION_WARNING_MINUTES: 5,
  CACHE_MINIMUM_TTL_SECONDS: 300, // 5 minutes
  CACHE_DEFAULT_TTL_SECONDS: 3600, // 1 hour
  CACHE_SESSION_TTL_SECONDS: 1800, // 30 minutes
  CACHE_API_KEY_TTL_SECONDS: 3600, // 1 hour
  CIRCUIT_BREAKER_RECOVERY_TIMEOUT_MS: 60000, // 1 minute
  CIRCUIT_BREAKER_HALF_OPEN_TIMEOUT_MS: 30000, // 30 seconds
  RETRY_BASE_DELAY_MS: 100,
  RETRY_MAX_DELAY_MS: 1000,
  RETRY_BACKOFF_FACTOR: 2,
} as const;

// Size and length limits
export const SIZE_CONSTANTS = {
  MAX_TOKEN_LENGTH: 4096,
  MAX_SESSION_ID_LENGTH: 256,
  MIN_TOKEN_LENGTH: 1,
  CACHE_KEY_PREFIX_LENGTH: 8, // For hash truncation
} as const;

// Circuit breaker configuration
export const CIRCUIT_BREAKER_CONSTANTS = {
  FAILURE_THRESHOLD: 5,
  RECOVERY_TIMEOUT_MS: 60000,
  MONITORING_PERIOD_MS: 120000,
  HALF_OPEN_AFTER_MS: 30000,
} as const;

// Retry configuration
export const RETRY_CONSTANTS = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 100,
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_TIMEOUT_MS: 30000,
  AVAILABILITY_CHECK_MAX_RETRIES: 2,
  CACHE_CLEANUP_MAX_RETRIES: 2,
} as const;

// Performance thresholds (in milliseconds)
export const PERFORMANCE_THRESHOLDS = {
  FAST_OPERATION_MS: 100,
  NORMAL_OPERATION_MS: 500,
  SLOW_OPERATION_MS: 5000,
} as const;

// Cache configuration
export const CACHE_CONSTANTS = {
  CACHE_TTL_BUFFER_SECONDS: 60, // Cache until 1 minute before expiration
  PATTERN_INVALIDATION_BATCH_SIZE: 100,
} as const;

// Validation patterns
export const VALIDATION_PATTERNS = {
  SESSION_ID_REGEX: /^[a-zA-Z0-9_-]+$/,
  TOKEN_FORMAT_REGEX: /^[a-zA-Z0-9._-]+$/,
} as const;

// Environment variable names
export const ENV_VARS = {
  KEYCLOAK_REALM: "KEYCLOAK_REALM",
  KEYCLOAK_WEBSOCKET_CLIENT_ID: "KEYCLOAK_WEBSOCKET_CLIENT_ID",
  VALID_API_KEYS: "VALID_API_KEYS",
} as const;

// Default values
export const DEFAULTS = {
  REALM: "master",
  CLIENT_ID: "websocket",
  SCOPE: "websocket:connect websocket:subscribe",
  ISSUER: "websocket-validator",
  AUDIENCE: "websocket",
} as const;
