/**
 * Authentication Error Classes
 *
 * Comprehensive error handling for authentication operations
 * Follows production best practices with structured error codes
 */

import { AuthErrorCode } from "../types";

/**
 * Base authentication error class
 */
export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly statusCode: number = 401,
    public readonly metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AuthError";

    // Maintain proper stack trace for where error was thrown (V8 engines only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    Object.setPrototypeOf(this, AuthError.prototype);
  }

  /**
   * Convert error to JSON for logging/API responses
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      metadata: this.metadata,
    };
  }
}

/**
 * Invalid credentials error
 */
export class InvalidCredentialsError extends AuthError {
  constructor(message: string = "Invalid email or password") {
    super(AuthErrorCode.INVALID_CREDENTIALS, message, 401);
    this.name = "InvalidCredentialsError";
  }
}

/**
 * Session expired error
 */
export class SessionExpiredError extends AuthError {
  constructor(
    message: string = "Session has expired",
    metadata?: Record<string, unknown>
  ) {
    super(AuthErrorCode.SESSION_EXPIRED, message, 401, metadata);
    this.name = "SessionExpiredError";
  }
}

/**
 * Insufficient permissions error
 */
export class InsufficientPermissionsError extends AuthError {
  constructor(
    requiredPermissions: string[],
    message: string = "Insufficient permissions"
  ) {
    super(AuthErrorCode.INSUFFICIENT_PERMISSIONS, message, 403, {
      requiredPermissions,
    });
    this.name = "InsufficientPermissionsError";
  }
}

/**
 * Invalid token error
 */
export class InvalidTokenError extends AuthError {
  constructor(
    message: string = "Invalid or malformed token",
    tokenType?: string
  ) {
    super(
      AuthErrorCode.INVALID_TOKEN,
      message,
      401,
      tokenType ? { tokenType } : undefined
    );
    this.name = "InvalidTokenError";
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitExceededError extends AuthError {
  constructor(message: string = "Too many requests", retryAfter?: number) {
    super(
      AuthErrorCode.RATE_LIMIT_EXCEEDED,
      message,
      429,
      retryAfter ? { retryAfter } : undefined
    );
    this.name = "RateLimitExceededError";
  }
}

/**
 * Organization access denied error
 */
export class OrganizationAccessDeniedError extends AuthError {
  constructor(
    organizationId: string,
    message: string = "Access to organization denied"
  ) {
    super(AuthErrorCode.ORGANIZATION_ACCESS_DENIED, message, 403, {
      organizationId,
    });
    this.name = "OrganizationAccessDeniedError";
  }
}

/**
 * Invalid request error
 */
export class InvalidRequestError extends AuthError {
  constructor(message: string = "Invalid request", validationErrors?: unknown) {
    super(
      AuthErrorCode.INVALID_REQUEST,
      message,
      400,
      validationErrors ? { validationErrors } : undefined
    );
    this.name = "InvalidRequestError";
  }
}

/**
 * Resource conflict error (e.g., duplicate email)
 */
export class ResourceConflictError extends AuthError {
  constructor(
    resource: string,
    message: string = `Resource conflict: ${resource}`
  ) {
    super(AuthErrorCode.RESOURCE_CONFLICT, message, 409, { resource });
    this.name = "ResourceConflictError";
  }
}

/**
 * Resource not found error
 */
export class ResourceNotFoundError extends AuthError {
  constructor(
    resource: string,
    id: string,
    message: string = `Resource not found: ${resource}`
  ) {
    super(AuthErrorCode.RESOURCE_NOT_FOUND, message, 404, { resource, id });
    this.name = "ResourceNotFoundError";
  }
}

/**
 * Internal server error (catch-all for unexpected errors)
 */
export class InternalAuthError extends AuthError {
  constructor(
    message: string = "Internal authentication error",
    cause?: Error
  ) {
    super(
      AuthErrorCode.INTERNAL_ERROR,
      message,
      500,
      cause ? { originalError: cause.message, stack: cause.stack } : undefined
    );
    this.name = "InternalAuthError";
  }
}

/**
 * Error factory for creating appropriate error instances
 */
export class AuthErrorFactory {
  /**
   * Create error from code
   */
  static fromCode(
    code: AuthErrorCode,
    message?: string,
    metadata?: Record<string, unknown>
  ): AuthError {
    switch (code) {
      case AuthErrorCode.INVALID_CREDENTIALS:
        return new InvalidCredentialsError(message);

      case AuthErrorCode.SESSION_EXPIRED:
        return new SessionExpiredError(message, metadata);

      case AuthErrorCode.INSUFFICIENT_PERMISSIONS:
        return new InsufficientPermissionsError(
          (metadata?.["requiredPermissions"] as string[]) || [],
          message
        );

      case AuthErrorCode.INVALID_TOKEN:
        return new InvalidTokenError(
          message,
          metadata?.["tokenType"] as string
        );

      case AuthErrorCode.RATE_LIMIT_EXCEEDED:
        return new RateLimitExceededError(
          message,
          metadata?.["retryAfter"] as number
        );

      case AuthErrorCode.ORGANIZATION_ACCESS_DENIED:
        return new OrganizationAccessDeniedError(
          (metadata?.["organizationId"] as string) || "",
          message
        );

      case AuthErrorCode.INVALID_REQUEST:
        return new InvalidRequestError(message, metadata?.["validationErrors"]);

      case AuthErrorCode.RESOURCE_CONFLICT:
        return new ResourceConflictError(
          (metadata?.["resource"] as string) || "unknown",
          message
        );

      case AuthErrorCode.RESOURCE_NOT_FOUND:
        return new ResourceNotFoundError(
          (metadata?.["resource"] as string) || "unknown",
          (metadata?.["id"] as string) || "",
          message
        );

      case AuthErrorCode.INTERNAL_ERROR:
      default:
        return new InternalAuthError(message);
    }
  }

  /**
   * Check if error is an AuthError
   */
  static isAuthError(error: unknown): error is AuthError {
    return error instanceof AuthError;
  }

  /**
   * Convert any error to AuthError
   */
  static toAuthError(error: unknown): AuthError {
    if (this.isAuthError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return new InternalAuthError(error.message, error);
    }

    return new InternalAuthError("Unknown error occurred");
  }
}
