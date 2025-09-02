/**
 * Custom error classes and error handling utilities for AuthV2 library
 */

import { AUTH_ERROR_CODES, IAuthError, AuthErrorCode } from "./index.js";

export class AuthError extends Error implements IAuthError {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, any>;

  constructor(
    code: AuthErrorCode,
    message: string,
    statusCode: number = 401,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthError);
    }
  }

  toJSON(): IAuthError {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details }),
    };
  }
}

export class AuthenticationError extends AuthError {
  constructor(
    message: string = "Authentication failed",
    details?: Record<string, any>
  ) {
    super(AUTH_ERROR_CODES.INVALID_CREDENTIALS, message, 401, details);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AuthError {
  constructor(
    message: string = "Insufficient permissions",
    details?: Record<string, any>
  ) {
    super(AUTH_ERROR_CODES.INSUFFICIENT_PERMISSIONS, message, 403, details);
    this.name = "AuthorizationError";
  }
}

export class TokenError extends AuthError {
  constructor(
    code: AuthErrorCode = AUTH_ERROR_CODES.TOKEN_INVALID,
    message: string = "Invalid token",
    details?: Record<string, any>
  ) {
    super(code, message, 401, details);
    this.name = "TokenError";
  }
}

export class UserError extends AuthError {
  constructor(
    code: AuthErrorCode = AUTH_ERROR_CODES.USER_NOT_FOUND,
    message: string = "User not found",
    statusCode: number = 404,
    details?: Record<string, any>
  ) {
    super(code, message, statusCode, details);
    this.name = "UserError";
  }
}

export class ConfigurationError extends AuthError {
  constructor(
    message: string = "Authentication configuration error",
    details?: Record<string, any>
  ) {
    super(AUTH_ERROR_CODES.CONFIGURATION_ERROR, message, 500, details);
    this.name = "ConfigurationError";
  }
}

export class RateLimitError extends AuthError {
  constructor(
    message: string = "Rate limit exceeded",
    details?: Record<string, any>
  ) {
    super(AUTH_ERROR_CODES.RATE_LIMIT_EXCEEDED, message, 429, details);
    this.name = "RateLimitError";
  }
}

export class KeycloakError extends AuthError {
  constructor(
    message: string = "Keycloak authentication error",
    details?: Record<string, any>
  ) {
    super(AUTH_ERROR_CODES.KEYCLOAK_ERROR, message, 502, details);
    this.name = "KeycloakError";
  }
}

export class SessionError extends AuthError {
  constructor(
    message: string = "Session error",
    details?: Record<string, any>
  ) {
    super(AUTH_ERROR_CODES.SESSION_EXPIRED, message, 401, details);
    this.name = "SessionError";
  }
}

export class ApiKeyError extends AuthError {
  constructor(
    message: string = "Invalid API key",
    details?: Record<string, any>
  ) {
    super(AUTH_ERROR_CODES.API_KEY_INVALID, message, 401, details);
    this.name = "ApiKeyError";
  }
}

/**
 * Error handling utilities
 */
export class AuthErrorHandler {
  static handle(error: unknown): AuthError {
    if (error instanceof AuthError) {
      return error;
    }

    if (error instanceof Error) {
      // Handle common error types
      if (error.message.includes("JWT")) {
        return new TokenError(AUTH_ERROR_CODES.TOKEN_INVALID, error.message);
      }
      if (error.message.includes("Keycloak")) {
        return new KeycloakError(error.message);
      }
      if (error.message.includes("rate limit")) {
        return new RateLimitError(error.message);
      }

      return new AuthError(
        AUTH_ERROR_CODES.CONFIGURATION_ERROR,
        error.message,
        500
      );
    }

    return new AuthError(
      AUTH_ERROR_CODES.CONFIGURATION_ERROR,
      "Unknown authentication error",
      500,
      { originalError: error }
    );
  }

  static isAuthError(error: unknown): error is AuthError {
    return error instanceof AuthError;
  }

  static getStatusCode(error: unknown): number {
    if (this.isAuthError(error)) {
      return error.statusCode;
    }
    return 500;
  }

  static getErrorResponse(error: unknown): IAuthError {
    if (this.isAuthError(error)) {
      return error.toJSON();
    }

    const handledError = this.handle(error);
    return handledError.toJSON();
  }
}

/**
 * Validation error utilities
 */
export class ValidationError extends AuthError {
  constructor(field: string, message: string, details?: Record<string, any>) {
    super(
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
      `Validation error for ${field}: ${message}`,
      400,
      { field, ...details }
    );
    this.name = "ValidationError";
  }
}

export const createValidationError = (
  field: string,
  message: string
): ValidationError => {
  return new ValidationError(field, message);
};

export const createAuthError = (
  code: AuthErrorCode,
  message: string,
  statusCode: number = 401,
  details?: Record<string, any>
): AuthError => {
  return new AuthError(code, message, statusCode, details);
};
