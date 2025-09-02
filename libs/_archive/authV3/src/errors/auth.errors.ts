/**
 * AuthV3 Error Types and Classes
 *
 * Comprehensive error handling system with structured error types,
 * proper error classification, and detailed error information.
 */

import { AuthStatus, AuthEvent } from "../types/auth.types.js";

// ==============================================================================
// ERROR BASE CLASSES
// ==============================================================================

/**
 * Base authentication error class
 */
export abstract class AuthError extends Error {
  public readonly code: string;
  public readonly status: AuthStatus;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;
  public readonly auditEvent?: AuthEvent;

  constructor(
    message: string,
    code: string,
    status: AuthStatus,
    context?: Record<string, unknown>,
    auditEvent?: AuthEvent
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.timestamp = new Date();
    this.context = context;
    this.auditEvent = auditEvent;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON representation
   */
  toJSON(): ErrorResponse {
    return {
      error: this.name,
      message: this.message,
      code: this.code,
      status: this.status,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
    };
  }
}

/**
 * Security-related error base class
 */
export abstract class SecurityError extends AuthError {
  public readonly severity: "low" | "medium" | "high" | "critical";
  public readonly shouldLog: boolean;
  public readonly shouldAlert: boolean;

  constructor(
    message: string,
    code: string,
    status: AuthStatus,
    severity: "low" | "medium" | "high" | "critical" = "medium",
    shouldLog: boolean = true,
    shouldAlert: boolean = false,
    context?: Record<string, unknown>,
    auditEvent?: AuthEvent
  ) {
    super(message, code, status, context, auditEvent);
    this.severity = severity;
    this.shouldLog = shouldLog;
    this.shouldAlert = shouldAlert;
  }
}

// ==============================================================================
// AUTHENTICATION ERRORS
// ==============================================================================

/**
 * Invalid credentials error
 */
export class InvalidCredentialsError extends AuthError {
  constructor(context?: Record<string, unknown>) {
    super(
      "Invalid username, email, or password",
      "AUTH_INVALID_CREDENTIALS",
      AuthStatus.INVALID_CREDENTIALS,
      context,
      AuthEvent.LOGIN_FAILED
    );
  }
}

/**
 * Account locked error
 */
export class AccountLockedError extends AuthError {
  public readonly lockedUntil?: Date;

  constructor(lockedUntil?: Date, context?: Record<string, unknown>) {
    const message = lockedUntil
      ? `Account is locked until ${lockedUntil.toISOString()}`
      : "Account is locked due to security reasons";

    super(
      message,
      "AUTH_ACCOUNT_LOCKED",
      AuthStatus.ACCOUNT_LOCKED,
      { ...context, lockedUntil },
      AuthEvent.ACCOUNT_LOCKED
    );

    this.lockedUntil = lockedUntil;
  }
}

/**
 * Account disabled error
 */
export class AccountDisabledError extends AuthError {
  constructor(context?: Record<string, unknown>) {
    super(
      "Account has been disabled",
      "AUTH_ACCOUNT_DISABLED",
      AuthStatus.ACCOUNT_DISABLED,
      context,
      AuthEvent.LOGIN_FAILED
    );
  }
}

/**
 * MFA required error
 */
export class MFARequiredError extends AuthError {
  public readonly mfaTypes: string[];

  constructor(
    mfaTypes: string[] = ["totp"],
    context?: Record<string, unknown>
  ) {
    super(
      "Multi-factor authentication is required",
      "AUTH_MFA_REQUIRED",
      AuthStatus.MFA_REQUIRED,
      { ...context, mfaTypes }
    );
    this.mfaTypes = mfaTypes;
  }
}

/**
 * Invalid MFA token error
 */
export class InvalidMFATokenError extends AuthError {
  constructor(context?: Record<string, unknown>) {
    super(
      "Invalid or expired MFA token",
      "AUTH_MFA_INVALID",
      AuthStatus.MFA_INVALID,
      context,
      AuthEvent.MFA_FAILED
    );
  }
}

// ==============================================================================
// TOKEN ERRORS
// ==============================================================================

/**
 * Invalid token error
 */
export class InvalidTokenError extends SecurityError {
  constructor(reason?: string, context?: Record<string, unknown>) {
    const message = reason
      ? `Invalid token: ${reason}`
      : "Invalid or malformed token";

    super(
      message,
      "AUTH_INVALID_TOKEN",
      AuthStatus.INVALID_TOKEN,
      "medium",
      true,
      false,
      { ...context, reason }
    );
  }
}

/**
 * Expired token error
 */
export class ExpiredTokenError extends AuthError {
  public readonly expiredAt: Date;

  constructor(expiredAt: Date, context?: Record<string, unknown>) {
    super(
      `Token expired at ${expiredAt.toISOString()}`,
      "AUTH_EXPIRED_TOKEN",
      AuthStatus.EXPIRED_TOKEN,
      { ...context, expiredAt }
    );
    this.expiredAt = expiredAt;
  }
}

/**
 * Token blacklisted error
 */
export class TokenBlacklistedError extends SecurityError {
  constructor(context?: Record<string, unknown>) {
    super(
      "Token has been revoked or blacklisted",
      "AUTH_TOKEN_BLACKLISTED",
      AuthStatus.INVALID_TOKEN,
      "high",
      true,
      true,
      context,
      AuthEvent.TOKEN_REVOKED
    );
  }
}

// ==============================================================================
// RATE LIMITING ERRORS
// ==============================================================================

/**
 * Rate limit exceeded error
 */
export class RateLimitExceededError extends SecurityError {
  public readonly resetTime: Date;
  public readonly remaining: number;

  constructor(
    resetTime: Date,
    remaining: number = 0,
    context?: Record<string, unknown>
  ) {
    super(
      `Rate limit exceeded. Try again after ${resetTime.toISOString()}`,
      "AUTH_RATE_LIMITED",
      AuthStatus.RATE_LIMITED,
      "medium",
      true,
      false,
      { ...context, resetTime, remaining }
    );
    this.resetTime = resetTime;
    this.remaining = remaining;
  }
}

// ==============================================================================
// PERMISSION ERRORS
// ==============================================================================

/**
 * Insufficient permissions error
 */
export class InsufficientPermissionsError extends AuthError {
  public readonly requiredPermissions: string[];
  public readonly userPermissions: string[];

  constructor(
    requiredPermissions: string[],
    userPermissions: string[] = [],
    context?: Record<string, unknown>
  ) {
    super(
      "Insufficient permissions to perform this action",
      "AUTH_INSUFFICIENT_PERMISSIONS",
      AuthStatus.INSUFFICIENT_PERMISSIONS,
      { ...context, requiredPermissions, userPermissions }
    );
    this.requiredPermissions = requiredPermissions;
    this.userPermissions = userPermissions;
  }
}

// ==============================================================================
// SESSION ERRORS
// ==============================================================================

/**
 * Session not found error
 */
export class SessionNotFoundError extends AuthError {
  constructor(sessionId: string, context?: Record<string, unknown>) {
    super(
      "Session not found or expired",
      "AUTH_SESSION_NOT_FOUND",
      AuthStatus.INVALID_TOKEN,
      { ...context, sessionId }
    );
  }
}

/**
 * Session expired error
 */
export class SessionExpiredError extends AuthError {
  public readonly expiredAt: Date;

  constructor(expiredAt: Date, context?: Record<string, unknown>) {
    super(
      `Session expired at ${expiredAt.toISOString()}`,
      "AUTH_SESSION_EXPIRED",
      AuthStatus.EXPIRED_TOKEN,
      { ...context, expiredAt },
      AuthEvent.SESSION_EXPIRED
    );
    this.expiredAt = expiredAt;
  }
}

/**
 * Concurrent session limit exceeded error
 */
export class ConcurrentSessionLimitError extends AuthError {
  public readonly maxSessions: number;
  public readonly currentSessions: number;

  constructor(
    maxSessions: number,
    currentSessions: number,
    context?: Record<string, unknown>
  ) {
    super(
      `Maximum concurrent sessions (${maxSessions}) exceeded. Current: ${currentSessions}`,
      "AUTH_CONCURRENT_SESSION_LIMIT",
      AuthStatus.INVALID_CREDENTIALS,
      { ...context, maxSessions, currentSessions }
    );
    this.maxSessions = maxSessions;
    this.currentSessions = currentSessions;
  }
}

// ==============================================================================
// VALIDATION ERRORS
// ==============================================================================

/**
 * Validation error for input data
 */
export class ValidationError extends AuthError {
  public readonly field: string;
  public readonly value?: unknown;
  public readonly constraints: string[];

  constructor(
    field: string,
    constraints: string[],
    value?: unknown,
    context?: Record<string, unknown>
  ) {
    const message = `Validation failed for field '${field}': ${constraints.join(
      ", "
    )}`;

    super(message, "AUTH_VALIDATION_ERROR", AuthStatus.INVALID_CREDENTIALS, {
      ...context,
      field,
      value,
      constraints,
    });

    this.field = field;
    this.value = value;
    this.constraints = constraints;
  }
}

/**
 * Password strength validation error
 */
export class WeakPasswordError extends ValidationError {
  constructor(violations: string[], context?: Record<string, unknown>) {
    super("password", violations, undefined, context);
    this.message = "Password does not meet security requirements";
    this.code = "AUTH_WEAK_PASSWORD";
  }
}

// ==============================================================================
// SYSTEM ERRORS
// ==============================================================================

/**
 * Service unavailable error
 */
export class ServiceUnavailableError extends AuthError {
  public readonly service: string;

  constructor(service: string, context?: Record<string, unknown>) {
    super(
      `Authentication service '${service}' is currently unavailable`,
      "AUTH_SERVICE_UNAVAILABLE",
      AuthStatus.INVALID_CREDENTIALS, // Generic status for system errors
      { ...context, service }
    );
    this.service = service;
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends AuthError {
  public readonly configKey: string;

  constructor(configKey: string, context?: Record<string, unknown>) {
    super(
      `Invalid or missing configuration for '${configKey}'`,
      "AUTH_CONFIGURATION_ERROR",
      AuthStatus.INVALID_CREDENTIALS,
      { ...context, configKey }
    );
    this.configKey = configKey;
  }
}

/**
 * Database error
 */
export class DatabaseError extends AuthError {
  public readonly operation: string;

  constructor(
    operation: string,
    originalError?: Error,
    context?: Record<string, unknown>
  ) {
    super(
      `Database operation '${operation}' failed`,
      "AUTH_DATABASE_ERROR",
      AuthStatus.INVALID_CREDENTIALS,
      { ...context, operation, originalError: originalError?.message }
    );
    this.operation = operation;
  }
}

/**
 * Cache error
 */
export class CacheError extends AuthError {
  public readonly operation: string;

  constructor(
    operation: string,
    originalError?: Error,
    context?: Record<string, unknown>
  ) {
    super(
      `Cache operation '${operation}' failed`,
      "AUTH_CACHE_ERROR",
      AuthStatus.INVALID_CREDENTIALS,
      { ...context, operation, originalError: originalError?.message }
    );
    this.operation = operation;
  }
}

// ==============================================================================
// CRYPTO ERRORS
// ==============================================================================

/**
 * Cryptographic operation error
 */
export class CryptoError extends SecurityError {
  public readonly operation: string;

  constructor(
    operation: string,
    originalError?: Error,
    context?: Record<string, unknown>
  ) {
    super(
      `Cryptographic operation '${operation}' failed`,
      "AUTH_CRYPTO_ERROR",
      AuthStatus.INVALID_CREDENTIALS,
      "high",
      true,
      true,
      { ...context, operation, originalError: originalError?.message }
    );
    this.operation = operation;
  }
}

/**
 * JWT signing error
 */
export class JWTSigningError extends CryptoError {
  constructor(originalError?: Error, context?: Record<string, unknown>) {
    super("jwt_signing", originalError, context);
    this.message = "Failed to sign JWT token";
    this.code = "AUTH_JWT_SIGNING_ERROR";
  }
}

/**
 * JWT verification error
 */
export class JWTVerificationError extends CryptoError {
  constructor(originalError?: Error, context?: Record<string, unknown>) {
    super("jwt_verification", originalError, context);
    this.message = "Failed to verify JWT token";
    this.code = "AUTH_JWT_VERIFICATION_ERROR";
  }
}

// ==============================================================================
// TYPE DEFINITIONS
// ==============================================================================

/**
 * Error response format
 */
export interface ErrorResponse {
  error: string;
  message: string;
  code: string;
  status: AuthStatus;
  timestamp: string;
  context?: Record<string, unknown>;
}

/**
 * Error context for structured logging
 */
export interface ErrorContext {
  userId?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

// ==============================================================================
// ERROR UTILITIES
// ==============================================================================

/**
 * Error utility functions
 */
export const ErrorUtils = {
  /**
   * Check if error is an AuthError
   */
  isAuthError(error: unknown): error is AuthError {
    return error instanceof AuthError;
  },

  /**
   * Check if error is a SecurityError
   */
  isSecurityError(error: unknown): error is SecurityError {
    return error instanceof SecurityError;
  },

  /**
   * Extract safe error message for client response
   */
  getSafeErrorMessage(error: unknown): string {
    if (error instanceof AuthError) {
      return error.message;
    }

    // Don't expose internal error details
    return "An authentication error occurred";
  },

  /**
   * Get error status code
   */
  getErrorStatusCode(error: unknown): number {
    if (error instanceof AuthError) {
      switch (error.status) {
        case AuthStatus.INVALID_CREDENTIALS:
        case AuthStatus.MFA_INVALID:
          return 401;
        case AuthStatus.ACCOUNT_LOCKED:
        case AuthStatus.ACCOUNT_DISABLED:
          return 403;
        case AuthStatus.MFA_REQUIRED:
          return 422;
        case AuthStatus.RATE_LIMITED:
          return 429;
        case AuthStatus.INSUFFICIENT_PERMISSIONS:
          return 403;
        default:
          return 400;
      }
    }
    return 500;
  },

  /**
   * Create standardized error response
   */
  createErrorResponse(error: unknown): ErrorResponse {
    if (error instanceof AuthError) {
      return error.toJSON();
    }

    return {
      error: "InternalError",
      message: "An unexpected error occurred",
      code: "INTERNAL_ERROR",
      status: AuthStatus.INVALID_CREDENTIALS,
      timestamp: new Date().toISOString(),
    };
  },
} as const;

// ==============================================================================
// EXPORTS
// ==============================================================================

export {
  AuthError,
  SecurityError,
  InvalidCredentialsError,
  AccountLockedError,
  AccountDisabledError,
  MFARequiredError,
  InvalidMFATokenError,
  InvalidTokenError,
  ExpiredTokenError,
  TokenBlacklistedError,
  RateLimitExceededError,
  InsufficientPermissionsError,
  SessionNotFoundError,
  SessionExpiredError,
  ConcurrentSessionLimitError,
  ValidationError,
  WeakPasswordError,
  ServiceUnavailableError,
  ConfigurationError,
  DatabaseError,
  CacheError,
  CryptoError,
  JWTSigningError,
  JWTVerificationError,
  ErrorUtils,
};

export type { ErrorResponse, ErrorContext };
