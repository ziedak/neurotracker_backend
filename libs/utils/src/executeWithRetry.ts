export type ExecuteWithRetryOptions = {
  operationName: string;
  maxRetries: number;
  retryDelay: number;
};

import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  retry,
  handleAll,
  circuitBreaker,
  wrap,
} from "cockatiel";
/**
 * Enhanced options for retry operations with circuit breaker and metrics
 */
export interface RetryOptions extends ExecuteWithRetryOptions {
  enableCircuitBreaker?: boolean;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
  enableMetrics?: boolean;
  jitterEnabled?: boolean;
}

/**
 * Execute operation with retry logic, optional circuit breaker, and metrics
 *
 * Uses cockatiel library for robust retry and circuit breaker policies when enabled.
 *
 * @template T - Return type of the operation
 * @param operation - Async operation to execute
 * @param onError - Error callback for logging/monitoring (called with error and attempt number)
 * @param options - Configuration for retry behavior
 * @param metrics - Optional metrics collector for recording operation statistics
 * @returns Promise resolving to operation result
 *
 * @example
 * ```typescript
 * // Basic retry
 * const result = await executeWithRetry(
 *   async () => fetchData(),
 *   (error) => logger.error('Operation failed', error),
 *   { operationName: 'fetchData', maxRetries: 3 }
 * );
 *
 * // With circuit breaker
 * const result = await executeWithRetry(
 *   async () => redis.get('key'),
 *   (error) => logger.error('Redis failed', error),
 *   {
 *     operationName: 'redis_get',
 *     maxRetries: 3,
 *     enableCircuitBreaker: true,
 *     circuitBreakerThreshold: 5
 *   }
 * );
 * ```
 */
export const executeWithRetry = async <T>(
  operation: () => Promise<T>,
  onError: (error: unknown, attempt?: number) => void,
  options: Partial<RetryOptions> = {},
  metrics?: any
): Promise<T> => {
  const config: Required<RetryOptions> = {
    operationName: "Unknown Operation",
    maxRetries: 3,
    retryDelay: 1000,
    enableCircuitBreaker: false,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 10000,
    enableMetrics: false,
    jitterEnabled: true,
    ...options,
  };

  const startTime = performance.now();

  try {
    let result: T;

    if (config.enableCircuitBreaker) {
      // Use cockatiel for retry + circuit breaker
      const retryPolicy = retry(handleAll, {
        maxAttempts: config.maxRetries,
        backoff: new ExponentialBackoff(),
      });

      const circuitBreakerPolicy = circuitBreaker(handleAll, {
        halfOpenAfter: config.circuitBreakerTimeout,
        breaker: new ConsecutiveBreaker(config.circuitBreakerThreshold),
      });

      const retryWithBreaker = wrap(retryPolicy, circuitBreakerPolicy);

      result = await retryWithBreaker.execute(operation);
    } else {
      // Use custom retry logic with jitter
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
        try {
          result = await operation();
          break; // Success, exit retry loop
        } catch (error) {
          lastError =
            error instanceof Error
              ? error
              : new Error(`Unknown error in ${config.operationName}`);

          onError(lastError, attempt);

          if (attempt === config.maxRetries) {
            throw new Error(
              `[executeWithRetry] ${config.operationName} failed after ${config.maxRetries} attempts. Last error: ${lastError.message}`
            );
          }

          // Calculate delay with exponential backoff and optional jitter
          let delay = config.retryDelay * Math.pow(2, attempt - 1);
          if (config.jitterEnabled) {
            delay = delay * (0.5 + Math.random() * 0.5);
          }

          await new Promise((resolve) =>
            setTimeout(resolve, Math.floor(delay))
          );
        }
      }
    }

    // Record success metrics
    if (config.enableMetrics && metrics) {
      try {
        metrics.recordTimer(
          `${config.operationName}_duration`,
          performance.now() - startTime
        );
        metrics.recordCounter(`${config.operationName}_success`);
      } catch (metricsError) {
        console.warn("Failed to record success metrics:", metricsError);
      }
    }

    return result!;
  } catch (error) {
    // Record failure metrics
    if (config.enableMetrics && metrics) {
      try {
        metrics.recordTimer(
          `${config.operationName}_duration`,
          performance.now() - startTime
        );
        metrics.recordCounter(`${config.operationName}_failed`);
      } catch (metricsError) {
        console.warn("Failed to record failure metrics:", metricsError);
      }
    }

    throw error; // Re-throw the error
  }
};

/**
 * Execute Redis operation with enhanced retry logic and type safety
 * Specialized version for Redis operations with proper typing and optimized defaults
 *
 * @template T - Return type of the Redis operation
 * @template R - Redis client type (defaults to any for flexibility)
 */
export const executeRedisWithRetry = async <T, R = any>(
  redis: R,
  operation: (redis: R) => Promise<T>,
  onError: (error: unknown, attempt?: number) => void,
  options?: Partial<RetryOptions>
): Promise<T> => {
  if (!redis) {
    throw new Error(
      `[executeRedisWithRetry] Redis client is required for operation`
    );
  }

  // Set Redis-optimized defaults
  const redisOptions: Partial<RetryOptions> = {
    operationName: "redis_operation",
    maxRetries: 3,
    retryDelay: 1000,
    enableCircuitBreaker: true,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 10000,
    enableMetrics: true,
    jitterEnabled: true,
    ...options,
  };

  // Wrap the Redis operation
  const wrappedOperation = () => operation(redis);

  // Use the unified retry function
  return executeWithRetry(wrappedOperation, onError, redisOptions);
};
