/**
 * Result<T, E> Pattern for Type-Safe Error Handling
 * Prevents unhandled promise rejections in async contexts
 *
 * This is a critical pattern for production Elysia/Bun applications
 * where synchronous throws in async contexts cause server crashes.
 */

/**
 * Represents a successful result
 */
export interface Success<T> {
  readonly success: true;
  readonly data: T;
  readonly error?: never;
}

/**
 * Represents a failed result
 */
export interface Failure<E> {
  readonly success: false;
  readonly data?: never;
  readonly error: E;
}

/**
 * Result type that can be either Success or Failure
 */
export type Result<T, E = Error> = Success<T> | Failure<E>;

/**
 * Authentication-specific error types
 */
export interface AuthError {
  code: string;
  message: string;
  statusCode: number;
  details?: unknown;
}

/**
 * Authorization result with detailed context
 */
export interface AuthorizationResult {
  authorized: boolean;
  error?: AuthError;
  context?: {
    missingRoles?: string[];
    missingPermissions?: string[];
    userRoles?: string[];
    userPermissions?: string[];
  };
}

/**
 * Create a successful result
 */
export function success<T>(data: T): Success<T> {
  return { success: true, data };
}

/**
 * Create a failed result
 */
export function failure<E>(error: E): Failure<E> {
  return { success: false, error };
}

/**
 * Type guard for successful results
 */
export function isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
  return result.success;
}

/**
 * Type guard for failed results
 */
export function isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
  return !result.success;
}

/**
 * Execute an async operation and wrap result safely
 */
export async function safeAsync<T, E = Error>(
  operation: () => Promise<T>
): Promise<Result<T, E>> {
  try {
    const data = await operation();
    return success(data);
  } catch (error) {
    return failure(error as E);
  }
}

/**
 * Execute a sync operation and wrap result safely
 */
export function safe<T, E = Error>(operation: () => T): Result<T, E> {
  try {
    const data = operation();
    return success(data);
  } catch (error) {
    return failure(error as E);
  }
}

/**
 * Chain multiple results together (monadic bind)
 */
export function chain<T, U, E>(
  result: Result<T, E>,
  transform: (data: T) => Result<U, E>
): Result<U, E> {
  if (isFailure(result)) {
    return result;
  }
  return transform(result.data);
}

/**
 * Map over successful results
 */
export function map<T, U, E>(
  result: Result<T, E>,
  transform: (data: T) => U
): Result<U, E> {
  if (isFailure(result)) {
    return result;
  }
  return success(transform(result.data));
}

/**
 * Map over error results
 */
export function mapError<T, E, F>(
  result: Result<T, E>,
  transform: (error: E) => F
): Result<T, F> {
  if (isSuccess(result)) {
    return result;
  }
  return failure(transform(result.error));
}

/**
 * Get data from result or throw
 * USE WITH CAUTION - only in contexts where throwing is safe
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (isFailure(result)) {
    throw result.error;
  }
  return result.data;
}

/**
 * Get data from result or return default value
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (isFailure(result)) {
    return defaultValue;
  }
  return result.data;
}

/**
 * Authentication error factory functions
 */
export const AuthErrors = {
  unauthorized: (message = "Unauthorized"): AuthError => ({
    code: "UNAUTHORIZED",
    message,
    statusCode: 401,
  }),

  forbidden: (message = "Forbidden"): AuthError => ({
    code: "FORBIDDEN",
    message,
    statusCode: 403,
  }),

  tokenValidation: (message: string, details?: unknown): AuthError => ({
    code: "TOKEN_VALIDATION_ERROR",
    message,
    statusCode: 401,
    details,
  }),

  configurationError: (message: string): AuthError => ({
    code: "CONFIGURATION_ERROR",
    message,
    statusCode: 500,
  }),

  networkError: (message: string, details?: unknown): AuthError => ({
    code: "NETWORK_ERROR",
    message,
    statusCode: 503,
    details,
  }),

  validationError: (message: string, details?: unknown): AuthError => ({
    code: "VALIDATION_ERROR",
    message,
    statusCode: 400,
    details,
  }),

  systemError: (message: string, details?: unknown): AuthError => ({
    code: "SYSTEM_ERROR",
    message,
    statusCode: 500,
    details,
  }),

  tokenError: (message: string, details?: unknown): AuthError => ({
    code: "TOKEN_ERROR",
    message,
    statusCode: 401,
    details,
  }),

  customError: (
    code: string,
    message: string,
    statusCode: number,
    details?: unknown
  ): AuthError => ({
    code,
    message,
    statusCode,
    details,
  }),
};

/**
 * Convert legacy errors to AuthError format
 */
export function toAuthError(error: unknown): AuthError {
  if (error instanceof Error) {
    return {
      code: "UNKNOWN_ERROR",
      message: error.message,
      statusCode: 500,
      details: { stack: error.stack },
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(error),
    statusCode: 500,
  };
}
