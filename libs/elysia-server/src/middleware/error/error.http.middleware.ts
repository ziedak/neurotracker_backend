import { type IMetricsCollector } from "@libs/monitoring";
import {
  BaseMiddleware,
  type HttpMiddlewareConfig,
} from "../base/BaseMiddleware";
import { type MiddlewareContext } from "../types";

export interface ErrorHttpMiddlewareConfig extends HttpMiddlewareConfig {
  readonly includeStackTrace?: boolean;
  readonly logErrors?: boolean;
  readonly customErrorMessages?: Record<string, string>;
  readonly sensitiveFields?: readonly string[];
}

export interface ErrorResponse {
  success: false;
  error: string;
  message: string;
  timestamp: string;
  requestId?: string;
  statusCode?: number;
  details?: any;
  stackTrace?: string;
}

export interface CustomError extends Error {
  statusCode?: number;
  code?: string;
  details?: any;
}

/**
 * Unified Error Middleware following AbstractMiddleware architecture
 * Provides comprehensive error handling with logging and response formatting
 * Framework-agnostic implementation for consistent error handling across all services
 *
 * Features:
 * - Extends BaseMiddleware for HTTP contexts
 * - Framework-agnostic error handling
 * - Immutable configuration with withConfig()
 * - Comprehensive error logging and metrics
 * - Security-aware error sanitization
 * - Production-ready error responses
 *
 * Note: For WebSocket error handling, use WebSocketErrorHttpMiddleware
 */
export class ErrorHttpMiddleware extends BaseMiddleware<ErrorHttpMiddlewareConfig> {
  constructor(metrics: IMetricsCollector, config: ErrorHttpMiddlewareConfig) {
    const mergedConfig = {
      ...config,
      ...{ includeStackTrace: false, logErrors: true, ...config },
    } as ErrorHttpMiddlewareConfig;

    super(metrics, mergedConfig, config.name || "error-handler");
  }

  /**
   * Execute error middleware - handles errors from downstream middleware
   * Note: This middleware should typically be registered early in the chain
   */
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    try {
      await next();
    } catch (error) {
      await this.handleMiddlewareError(error as Error, context);
    }
  }

  /**
   * Handle middleware error and set response
   */
  private async handleMiddlewareError(
    error: Error,
    context: MiddlewareContext
  ): Promise<void> {
    const errorResponse = await this.createErrorResponse(error, context);

    // Set status code
    context.set.status = errorResponse.statusCode || 500;

    // Set error response - note: actual response setting depends on framework
    if (context.set) {
      // This approach works with frameworks that support set.body
      (context.set as any).body = errorResponse;
    }

    // Record error metrics
    await this.recordMetric("error_handled", 1, {
      errorType: this.getErrorType(error),
      statusCode: String(errorResponse.statusCode || 500),
    });

    // Log error if configured
    if (this.config.logErrors) {
      await this.logError(error, context);
    }
  }

  /**
   * Create formatted error response
   */
  public async createErrorResponse(
    error: Error | CustomError,
    context?: MiddlewareContext
  ): Promise<ErrorResponse> {
    try {
      const requestId =
        context?.requestId ||
        (context ? this.getRequestId(context) : "unknown");

      const errorResponse: ErrorResponse = {
        success: false,
        error: this.getErrorType(error),
        message: this.getErrorMessage(error),
        timestamp: new Date().toISOString(),
        requestId,
        statusCode: this.getStatusCode(error),
      };

      // Add details if available
      const details = this.getErrorDetails(error);
      if (details) {
        errorResponse.details = details;
      }

      // Add stack trace if configured
      if (this.config.includeStackTrace && error.stack) {
        errorResponse.stackTrace = error.stack;
      }

      return errorResponse;
    } catch (handlingError) {
      // Fallback error handling
      this.logger.error(
        "Error in error response creation",
        handlingError as Error
      );

      return {
        success: false,
        error: "InternalError",
        message: "An internal error occurred",
        timestamp: new Date().toISOString(),
        requestId: context?.requestId || "unknown",
        statusCode: 500,
      };
    }
  }

  /**
   * Handle async errors with promise rejection
   */
  public async handleAsyncError(
    errorPromise: Promise<any>,
    context?: MiddlewareContext
  ): Promise<any> {
    try {
      return await errorPromise;
    } catch (error) {
      return this.createErrorResponse(error as Error, context);
    }
  }

  /**
   * Wrap function with error handling
   */
  public wrapWithErrorHandling<T extends any[], R>(
    fn: (...args: T) => Promise<R>
  ): (...args: T) => Promise<R | ErrorResponse> {
    return async (...args: T) => {
      try {
        return await fn(...args);
      } catch (error) {
        return this.createErrorResponse(error as Error);
      }
    };
  }

  /**
   * Log error with comprehensive context
   */
  private async logError(
    error: Error | CustomError,
    context: MiddlewareContext
  ): Promise<void> {
    const errorContext: Record<string, any> = {
      requestId: context.requestId,
      errorType: this.getErrorType(error),
      errorMessage: error.message,
      statusCode: this.getStatusCode(error),
      timestamp: new Date().toISOString(),
      method: context.request.method,
      url: context.request.url,
      userAgent: context.request.headers?.["user-agent"],
      ip: this.getClientIp(context),
    };

    // Add error details if available
    if ("details" in error && error.details) {
      errorContext["details"] = this.sanitizeErrorDetails(error.details);
    }

    // Log with appropriate level based on status code
    const statusCode = this.getStatusCode(error);
    if (statusCode >= 500) {
      this.logger.error("Server error occurred", error, errorContext);
    } else if (statusCode >= 400) {
      this.logger.warn("Client error occurred", errorContext);
    } else {
      this.logger.info("Error handled", errorContext);
    }
  }

  /**
   * Get error type/name
   */
  private getErrorType(error: Error | CustomError): string {
    if ("code" in error && error.code) {
      return error.code;
    }

    return error.name || error.constructor.name || "UnknownError";
  }

  /**
   * Get user-friendly error message
   */
  private getErrorMessage(error: Error | CustomError): string {
    const errorType = this.getErrorType(error);

    // Check for custom message
    if (this.config.customErrorMessages?.[errorType]) {
      return this.config.customErrorMessages[errorType];
    }

    // Return sanitized original message
    return this.sanitizeErrorMessage(error.message || "An error occurred");
  }

  /**
   * Get HTTP status code from error
   */
  private getStatusCode(error: Error | CustomError): number {
    if ("statusCode" in error && typeof error.statusCode === "number") {
      return error.statusCode;
    }

    // Map common error types to status codes
    const errorType = this.getErrorType(error);
    const statusCodeMap: Record<string, number> = {
      ValidationError: 400,
      ValidationRequestError: 400,
      AuthenticationError: 401,
      AuthorizationError: 403,
      NotFoundError: 404,
      RateLimitError: 429,
      DatabaseError: 500,
      NetworkError: 502,
      TimeoutError: 504,
    };

    return statusCodeMap[errorType] || 500;
  }

  /**
   * Get error details
   */
  private getErrorDetails(error: Error | CustomError): any {
    if (!("details" in error) || !error.details) {
      return undefined;
    }

    return this.sanitizeErrorDetails(error.details);
  }

  /**
   * Sanitize error message to remove sensitive information
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove file paths
    message = message.replace(/[A-Z]:\\[^\\]+(?:\\[^\\]+)*/g, "[FILE_PATH]");
    message = message.replace(/\/[^\/\s]+(?:\/[^\/\s]+)*/g, "[FILE_PATH]");

    // Remove potential SQL or connection strings
    message = message.replace(
      /\b(?:password|pwd|secret|key|token)=[^\s;]+/gi,
      "[CREDENTIALS]"
    );

    // Remove email addresses
    message = message.replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      "[EMAIL]"
    );

    return message;
  }

  /**
   * Sanitize error details to remove sensitive information
   */
  private sanitizeErrorDetails(details: any): any {
    const sensitiveFields = this.config.sensitiveFields || [];
    return this.sanitizeObject(details, [...sensitiveFields]);
  }

  /**
   * Create custom error classes
   */
  static createValidationError(message: string, details?: any): CustomError {
    const error = new Error(message) as CustomError;
    error.name = "ValidationError";
    error.statusCode = 400;
    error.details = details;
    return error;
  }

  static createAuthenticationError(
    message: string = "Authentication failed"
  ): CustomError {
    const error = new Error(message) as CustomError;
    error.name = "AuthenticationError";
    error.statusCode = 401;
    return error;
  }

  static createAuthorizationError(
    message: string = "Access denied"
  ): CustomError {
    const error = new Error(message) as CustomError;
    error.name = "AuthorizationError";
    error.statusCode = 403;
    return error;
  }

  static createNotFoundError(
    message: string = "Resource not found"
  ): CustomError {
    const error = new Error(message) as CustomError;
    error.name = "NotFoundError";
    error.statusCode = 404;
    return error;
  }

  static createRateLimitError(
    message: string = "Too many requests"
  ): CustomError {
    const error = new Error(message) as CustomError;
    error.name = "RateLimitError";
    error.statusCode = 429;
    return error;
  }

  /**
   * Create preset configurations for different environments
   */
  static createDevelopmentConfig(): Partial<ErrorHttpMiddlewareConfig> {
    return {
      includeStackTrace: true,
      logErrors: true,
      customErrorMessages: {},
    };
  }

  static createProductionConfig(): Partial<ErrorHttpMiddlewareConfig> {
    return {
      includeStackTrace: false,
      logErrors: true,
      customErrorMessages: {
        ValidationError: "Invalid request data",
        AuthenticationError: "Authentication required",
        AuthorizationError: "Access denied",
        NotFoundError: "Resource not found",
        RateLimitError: "Rate limit exceeded",
        DatabaseError: "Service temporarily unavailable",
        NetworkError: "Service temporarily unavailable",
      },
    };
  }

  static createMinimalConfig(): Partial<ErrorHttpMiddlewareConfig> {
    return {
      includeStackTrace: false,
      logErrors: false,
      customErrorMessages: {
        ValidationError: "Invalid request",
        AuthenticationError: "Authentication failed",
        AuthorizationError: "Access denied",
        NotFoundError: "Not found",
        RateLimitError: "Too many requests",
      },
    };
  }

  static createAuditConfig(): Partial<ErrorHttpMiddlewareConfig> {
    return {
      includeStackTrace: true,
      logErrors: true,
      customErrorMessages: {},
      sensitiveFields: [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "session",
      ],
    };
  }
}

/**
 * Factory function for easy middleware creation
 */
export function createErrorHttpMiddleware(
  metrics: IMetricsCollector,
  config?: Partial<ErrorHttpMiddlewareConfig>
): ErrorHttpMiddleware {
  const defaultConfig: ErrorHttpMiddlewareConfig = {
    name: "error-handler",
    enabled: true,
    priority: 1000, // High priority to catch errors early
    includeStackTrace: false,
    logErrors: true,
    ...config,
  };

  return new ErrorHttpMiddleware(metrics, defaultConfig);
}
