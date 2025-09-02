/**
 * @fileoverview Enterprise error handling framework for authentication
 * @module errors/core
 * @version 1.0.0
 * @author Enterprise Development Team
 */

import type { EntityId, Timestamp } from "../types/core";

/**
 * Base authentication error class with enterprise features
 */
export abstract class BaseAuthError extends Error {
  public readonly code: string;
  public readonly timestamp: Timestamp;
  public readonly details: Record<string, unknown>;
  public readonly isRetryable: boolean;
  public readonly statusCode: number;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    details: Record<string, unknown> = {},
    isRetryable: boolean = false
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.timestamp = new Date().toISOString() as Timestamp;
    this.details = { ...details };
    this.isRetryable = isRetryable;
    this.statusCode = statusCode;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging/transport
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp,
      details: this.details,
      isRetryable: this.isRetryable,
      statusCode: this.statusCode,
      stack: this.stack,
    };
  }

  /**
   * Convert error to safe JSON for client responses (no stack trace)
   */
  public toSafeJSON(): Record<string, unknown> {
    return {
      error: this.name,
      message: this.message,
      code: this.code,
      timestamp: this.timestamp,
      details: this.sanitizeDetails(this.details),
    };
  }

  /**
   * Sanitize error details for client response
   */
  private sanitizeDetails(
    details: Record<string, unknown>
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(details)) {
      // Remove sensitive information
      if (
        key.toLowerCase().includes("password") ||
        key.toLowerCase().includes("secret") ||
        key.toLowerCase().includes("token") ||
        key.toLowerCase().includes("key")
      ) {
        continue;
      }
      sanitized[key] = value;
    }

    return sanitized;
  }
}

/**
 * Authentication-specific errors
 */
export class AuthenticationError extends BaseAuthError {
  constructor(
    message: string = "Authentication failed",
    details: Record<string, unknown> = {}
  ) {
    super(message, "AUTHENTICATION_ERROR", 401, details, false);
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  constructor(details: Record<string, unknown> = {}) {
    super("Invalid credentials provided", {
      ...details,
      code: "INVALID_CREDENTIALS",
    });
  }
}

export class ExpiredTokenError extends AuthenticationError {
  constructor(
    tokenType: string = "token",
    details: Record<string, unknown> = {}
  ) {
    super(`${tokenType} has expired`, {
      ...details,
      code: "EXPIRED_TOKEN",
      tokenType,
    });
  }
}

export class InvalidTokenError extends AuthenticationError {
  constructor(
    tokenType: string = "token",
    details: Record<string, unknown> = {}
  ) {
    super(`Invalid ${tokenType} format or signature`, {
      ...details,
      code: "INVALID_TOKEN",
      tokenType,
    });
  }
}

export class BlacklistedTokenError extends AuthenticationError {
  constructor(details: Record<string, unknown> = {}) {
    super("Token has been revoked or blacklisted", {
      ...details,
      code: "BLACKLISTED_TOKEN",
    });
  }
}

/**
 * Authorization-specific errors
 */
export class AuthorizationError extends BaseAuthError {
  constructor(
    message: string = "Authorization failed",
    details: Record<string, unknown> = {}
  ) {
    super(message, "AUTHORIZATION_ERROR", 403, details, false);
  }
}

export class InsufficientPermissionsError extends AuthorizationError {
  constructor(
    resource: string,
    action: string,
    details: Record<string, unknown> = {}
  ) {
    super(`Insufficient permissions for ${action} on ${resource}`, {
      ...details,
      code: "INSUFFICIENT_PERMISSIONS",
      resource,
      action,
    });
  }
}

export class RoleNotFoundError extends AuthorizationError {
  constructor(roleId: EntityId, details: Record<string, unknown> = {}) {
    super(`Role not found: ${roleId}`, {
      ...details,
      code: "ROLE_NOT_FOUND",
      roleId,
    });
  }
}

/**
 * Account-specific errors
 */
export class AccountError extends BaseAuthError {
  constructor(
    message: string,
    code: string,
    details: Record<string, unknown> = {}
  ) {
    super(message, code, 403, details, false);
  }
}

export class AccountLockedError extends AccountError {
  constructor(lockUntil?: Date, details: Record<string, unknown> = {}) {
    const message = lockUntil
      ? `Account locked until ${lockUntil.toISOString()}`
      : "Account is locked";

    super(message, "ACCOUNT_LOCKED", {
      ...details,
      lockUntil: lockUntil?.toISOString(),
    });
  }
}

export class AccountInactiveError extends AccountError {
  constructor(details: Record<string, unknown> = {}) {
    super("Account is inactive", "ACCOUNT_INACTIVE", details);
  }
}

export class AccountSuspendedError extends AccountError {
  constructor(details: Record<string, unknown> = {}) {
    super("Account has been suspended", "ACCOUNT_SUSPENDED", details);
  }
}

/**
 * Session-specific errors
 */
export class SessionError extends BaseAuthError {
  constructor(
    message: string,
    code: string,
    details: Record<string, unknown> = {}
  ) {
    super(message, code, 401, details, false);
  }
}

export class SessionExpiredError extends SessionError {
  constructor(details: Record<string, unknown> = {}) {
    super("Session has expired", "SESSION_EXPIRED", details);
  }
}

export class SessionNotFoundError extends SessionError {
  constructor(sessionId: string, details: Record<string, unknown> = {}) {
    super(`Session not found: ${sessionId}`, "SESSION_NOT_FOUND", {
      ...details,
      sessionId,
    });
  }
}

export class ConcurrentSessionLimitError extends SessionError {
  constructor(maxSessions: number, details: Record<string, unknown> = {}) {
    super(
      `Maximum concurrent sessions exceeded (limit: ${maxSessions})`,
      "CONCURRENT_SESSION_LIMIT",
      { ...details, maxSessions }
    );
  }
}

/**
 * Validation-specific errors
 */
export class ValidationError extends BaseAuthError {
  public readonly validationErrors: ReadonlyArray<IValidationFieldError>;

  constructor(
    message: string = "Validation failed",
    validationErrors: ReadonlyArray<IValidationFieldError> = [],
    details: Record<string, unknown> = {}
  ) {
    super(message, "VALIDATION_ERROR", 400, details, false);
    this.validationErrors = validationErrors;
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      validationErrors: this.validationErrors,
    };
  }

  public override toSafeJSON(): Record<string, unknown> {
    return {
      ...super.toSafeJSON(),
      validationErrors: this.validationErrors,
    };
  }
}

export interface IValidationFieldError {
  readonly field: string;
  readonly message: string;
  readonly code: string;
  readonly value?: unknown;
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends BaseAuthError {
  public readonly retryAfter: number;
  public readonly limit: number;
  public readonly remaining: number;
  public readonly resetTime: Date;

  constructor(
    retryAfter: number,
    limit: number,
    remaining: number = 0,
    resetTime: Date = new Date(),
    details: Record<string, unknown> = {}
  ) {
    const message = `Rate limit exceeded. Try again in ${retryAfter} seconds`;
    super(message, "RATE_LIMIT_EXCEEDED", 429, details, true);

    this.retryAfter = retryAfter;
    this.limit = limit;
    this.remaining = remaining;
    this.resetTime = resetTime;
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      retryAfter: this.retryAfter,
      limit: this.limit,
      remaining: this.remaining,
      resetTime: this.resetTime.toISOString(),
    };
  }

  public override toSafeJSON(): Record<string, unknown> {
    return {
      ...super.toSafeJSON(),
      retryAfter: this.retryAfter,
      limit: this.limit,
      remaining: this.remaining,
      resetTime: this.resetTime.toISOString(),
    };
  }
}

/**
 * Service-specific errors
 */
export class ServiceError extends BaseAuthError {
  constructor(
    serviceName: string,
    message: string,
    code: string = "SERVICE_ERROR",
    details: Record<string, unknown> = {}
  ) {
    super(
      `${serviceName}: ${message}`,
      code,
      500,
      { ...details, serviceName },
      true
    );
  }
}

export class DatabaseError extends ServiceError {
  constructor(operation: string, details: Record<string, unknown> = {}) {
    super("Database", `Operation failed: ${operation}`, "DATABASE_ERROR", {
      ...details,
      operation,
    });
  }
}

export class CacheError extends ServiceError {
  constructor(operation: string, details: Record<string, unknown> = {}) {
    super("Cache", `Operation failed: ${operation}`, "CACHE_ERROR", {
      ...details,
      operation,
    });
  }
}

export class ExternalServiceError extends ServiceError {
  constructor(
    serviceName: string,
    operation: string,
    details: Record<string, unknown> = {}
  ) {
    super(
      serviceName,
      `External service operation failed: ${operation}`,
      "EXTERNAL_SERVICE_ERROR",
      {
        ...details,
        operation,
      }
    );
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends BaseAuthError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(
      `Configuration error: ${message}`,
      "CONFIGURATION_ERROR",
      500,
      details,
      false
    );
  }
}

/**
 * API Key specific errors
 */
export class APIKeyError extends BaseAuthError {
  constructor(
    message: string,
    code: string = "API_KEY_ERROR",
    details: Record<string, unknown> = {}
  ) {
    super(message, code, 401, details, false);
  }
}

export class InvalidAPIKeyError extends APIKeyError {
  constructor(details: Record<string, unknown> = {}) {
    super("Invalid API key", "INVALID_API_KEY", details);
  }
}

export class ExpiredAPIKeyError extends APIKeyError {
  constructor(details: Record<string, unknown> = {}) {
    super("API key has expired", "EXPIRED_API_KEY", details);
  }
}

export class RevokedAPIKeyError extends APIKeyError {
  constructor(details: Record<string, unknown> = {}) {
    super("API key has been revoked", "REVOKED_API_KEY", details);
  }
}

/**
 * Error classification utility
 */
export class ErrorClassifier {
  /**
   * Check if error is retryable
   */
  public static isRetryable(error: Error): boolean {
    if (error instanceof BaseAuthError) {
      return error.isRetryable;
    }

    // Consider network errors as retryable
    if (
      error.message.includes("ECONNRESET") ||
      error.message.includes("ETIMEDOUT") ||
      error.message.includes("ENOTFOUND")
    ) {
      return true;
    }

    return false;
  }

  /**
   * Get HTTP status code for error
   */
  public static getStatusCode(error: Error): number {
    if (error instanceof BaseAuthError) {
      return error.statusCode;
    }

    // Default to 500 for unknown errors
    return 500;
  }

  /**
   * Check if error is client error (4xx)
   */
  public static isClientError(error: Error): boolean {
    const statusCode = this.getStatusCode(error);
    return statusCode >= 400 && statusCode < 500;
  }

  /**
   * Check if error is server error (5xx)
   */
  public static isServerError(error: Error): boolean {
    const statusCode = this.getStatusCode(error);
    return statusCode >= 500;
  }

  /**
   * Get error category for metrics/logging
   */
  public static getCategory(error: Error): string {
    if (error instanceof AuthenticationError) return "authentication";
    if (error instanceof AuthorizationError) return "authorization";
    if (error instanceof ValidationError) return "validation";
    if (error instanceof RateLimitError) return "rate_limit";
    if (error instanceof ServiceError) return "service";
    if (error instanceof ConfigurationError) return "configuration";

    return "unknown";
  }
}

/**
 * Error factory for common error creation patterns
 */
export class ErrorFactory {
  /**
   * Create authentication error from common patterns
   */
  public static createAuthError(
    type:
      | "invalid_credentials"
      | "expired_token"
      | "invalid_token"
      | "blacklisted_token",
    details: Record<string, unknown> = {}
  ): AuthenticationError {
    switch (type) {
      case "invalid_credentials":
        return new InvalidCredentialsError(details);
      case "expired_token":
        return new ExpiredTokenError("JWT", details);
      case "invalid_token":
        return new InvalidTokenError("JWT", details);
      case "blacklisted_token":
        return new BlacklistedTokenError(details);
      default:
        return new AuthenticationError("Authentication failed", details);
    }
  }

  /**
   * Create validation error from field errors
   */
  public static createValidationError(
    fieldErrors: ReadonlyArray<IValidationFieldError>
  ): ValidationError {
    const message = `Validation failed for ${fieldErrors.length} field(s)`;
    return new ValidationError(message, fieldErrors);
  }

  /**
   * Create service error with context
   */
  public static createServiceError(
    service: string,
    operation: string,
    originalError: Error,
    details: Record<string, unknown> = {}
  ): ServiceError {
    return new ServiceError(
      service,
      `${operation}: ${originalError.message}`,
      "SERVICE_ERROR",
      {
        ...details,
        originalError: originalError.message,
        originalStack: originalError.stack,
      }
    );
  }
}

/**
 * Error handler utility for consistent error processing
 */
export class ErrorHandler {
  /**
   * Process error for logging
   */
  public static processForLogging(
    error: Error,
    context: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const baseData = {
      timestamp: new Date().toISOString(),
      context,
    };

    if (error instanceof BaseAuthError) {
      return {
        ...baseData,
        ...error.toJSON(),
      };
    }

    return {
      ...baseData,
      name: error.name,
      message: error.message,
      stack: error.stack,
      category: ErrorClassifier.getCategory(error),
      statusCode: ErrorClassifier.getStatusCode(error),
      isRetryable: ErrorClassifier.isRetryable(error),
    };
  }

  /**
   * Process error for client response
   */
  public static processForClient(error: Error): Record<string, unknown> {
    if (error instanceof BaseAuthError) {
      return error.toSafeJSON();
    }

    // Don't expose internal error details to clients
    const statusCode = ErrorClassifier.getStatusCode(error);
    if (statusCode >= 500) {
      return {
        error: "InternalServerError",
        message: "An internal server error occurred",
        code: "INTERNAL_SERVER_ERROR",
        timestamp: new Date().toISOString(),
      };
    }

    return {
      error: error.name,
      message: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Type guards for error checking
 */
export const ErrorTypeGuards = {
  isBaseAuthError: (error: unknown): error is BaseAuthError => {
    return error instanceof BaseAuthError;
  },

  isAuthenticationError: (error: unknown): error is AuthenticationError => {
    return error instanceof AuthenticationError;
  },

  isAuthorizationError: (error: unknown): error is AuthorizationError => {
    return error instanceof AuthorizationError;
  },

  isValidationError: (error: unknown): error is ValidationError => {
    return error instanceof ValidationError;
  },

  isRateLimitError: (error: unknown): error is RateLimitError => {
    return error instanceof RateLimitError;
  },

  isServiceError: (error: unknown): error is ServiceError => {
    return error instanceof ServiceError;
  },

  isRetryableError: (error: unknown): boolean => {
    return error instanceof Error && ErrorClassifier.isRetryable(error);
  },
} as const;

/**
 * Utility function to create error with context
 */
export function createAuthError(
  message: string,
  code: string,
  status = 500,
  context?: Record<string, unknown>
): BaseAuthError {
  const error = new (class extends BaseAuthError {
    constructor() {
      super(message, code, status, context);
    }
  })();
  return error;
}
