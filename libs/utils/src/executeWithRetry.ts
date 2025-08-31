export type ExecuteWithRetryOptions = {
  operationName: string;
  maxRetries: number;
  retryDelay: number;
};

/**
 * Executes an asynchronous operation with retry logic and exponential backoff.
 *
 * The function attempts to execute the provided `operation` up to `maxRetries` times.
 * If the operation fails, it waits for a delay (which increases exponentially with each attempt)
 * before retrying. The `onError` callback is called on each failure, including the final failure.
 *
 * @template T The return type of the asynchronous operation.
 * @param operation - A function that returns a Promise of type T to be executed.
 * @param onError - A callback function invoked with error information on each failure.
 * @param options - Optional configuration for the retry logic.
 *   @property operationName - A descriptive name for the operation (used in error messages).
 *   @property maxRetries - The maximum number of retry attempts (default: 3).
 *   @property retryDelay - The initial delay in milliseconds before retrying (default: 1000).
 * @returns A Promise that resolves with the result of the operation if successful.
 * @throws An Error if all retry attempts fail.
 *
 * @example
 * ```typescript
 * const result = await executeWithRetry(
 *   async () => await fetchData(),
 *   (error) => console.error(error),
 *   { operationName: "Fetch Data", maxRetries: 5, retryDelay: 500 }
 * );
 * ```
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  onError: (error: unknown) => void,
  options: ExecuteWithRetryOptions = {
    operationName: "Unknown Operation",
    maxRetries: 3,
    retryDelay: 1000,
  }
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= options.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error(`Unknown error in ${options.operationName}`);

      if (attempt === options.maxRetries) {
        onError(
          `${options.operationName} failed after ${options.maxRetries} attempts: ${lastError?.message}`
        );
        break;
      }

      // Wait before retry with exponential backoff
      const delay = options.retryDelay * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));

      onError(
        `${options.operationName} attempt ${attempt} failed, retrying in ${delay}ms: ${lastError.message}`
      );
    }
  }

  // If all retries failed, throw error
  throw new Error(
    `[executeWithRetry] ${options.operationName} failed after ${options.maxRetries} attempts: ${lastError?.message}`
  );
}
/**
 * When to use only Circuit Breaker:

For operations that should fail fast and not be retried (e.g., idempotent writes, destructive actions, or when retrying could cause data corruption or duplicate effects).
When the underlying error is not transient (e.g., validation errors, permission issues, logic bugs).
For health checks or status probes where retrying is not meaningful.
When to use Retry + Circuit Breaker:

For operations that may fail due to transient issues (e.g., network hiccups, temporary Redis unavailability, timeouts).
For reads, non-destructive writes, or batch operations where retrying increases success rate without risk.
When you want to maximize reliability but still protect the system from overload or persistent failure (circuit breaker will open after repeated failures).
Summary:

Use retry + circuit breaker for most Redis/database/network operations.
Use only circuit breaker for critical, non-retryable, or idempotent operations.
 */
import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  retry,
  handleAll,
  circuitBreaker,
  wrap,
} from "cockatiel";

export const executeWithRetryAndBreaker = async <T>(
  operation: () => Promise<T>,
  onError: (error: unknown) => void,
  options?: ExecuteWithRetryOptions
) => {
  options = {
    operationName: "Unknown Operation",
    maxRetries: 3,
    retryDelay: 1000,
    ...options,
  };
  // Call your database safely!
  try {
    // Create a retry policy that'll try whatever function we execute 3
    // times with a randomized exponential backoff.
    const retryPolicy = retry(handleAll, {
      maxAttempts: options.maxRetries,
      backoff: new ExponentialBackoff(),
    });

    // Create a circuit breaker that'll stop calling the executed function for 10
    // seconds if it fails 5 times in a row. This can give time for e.g. a database
    // to recover without getting tons of traffic.
    const circuitBreakerPolicy = circuitBreaker(handleAll, {
      halfOpenAfter: options.retryDelay * 10,
      breaker: new ConsecutiveBreaker(5),
    });
    // Combine these! Create a policy that retries 3 times, calling through the circuit breaker
    const retryWithBreaker = wrap(retryPolicy, circuitBreakerPolicy);

    const data = await retryWithBreaker.execute(() => operation());
    return data;
  } catch (error) {
    onError(error);
    throw error;
  }
};
