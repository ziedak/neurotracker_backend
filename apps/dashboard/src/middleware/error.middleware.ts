import { Logger } from "@libs/monitoring";

export interface ErrorConfig {
  includeStackTrace?: boolean;
  logErrors?: boolean;
  customErrorMessages?: Record<string, string>;
  sensitiveFields?: string[];
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
 * Error Middleware for Dashboard
 * Provides comprehensive error handling with logging and response formatting
 */
export class ErrorMiddleware {
  private readonly logger: Logger;
  private readonly defaultConfig: ErrorConfig = {
    includeStackTrace: false,
    logErrors: true,
    customErrorMessages: {
      ValidationError: "Invalid request data",
      AuthenticationError: "Authentication failed",
      AuthorizationError: "Access denied",
      NotFoundError: "Resource not found",
      RateLimitError: "Too many requests",
      DatabaseError: "Database operation failed",
      NetworkError: "Network connection failed",
    },
    sensitiveFields: ["password", "token", "secret", "key", "auth"],
  };

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Handle error and return formatted response
   */
  async handleError(
    error: Error | CustomError,
    request?: any,
    config?: Partial<ErrorConfig>
  ): Promise<ErrorResponse> {
    try {
      const finalConfig = { ...this.defaultConfig, ...config };
      const requestId = request?.requestId || "unknown";

      // Log error if configured
      if (finalConfig.logErrors) {
        this.logError(error, request, requestId);
      }

      // Create error response
      const errorResponse: ErrorResponse = {
        success: false,
        error: this.getErrorType(error),
        message: this.getErrorMessage(error, finalConfig),
        timestamp: new Date().toISOString(),
        requestId,
        statusCode: this.getStatusCode(error),
      };

      // Add details if available
      const details = this.getErrorDetails(error, finalConfig);
      if (details) {
        errorResponse.details = details;
      }

      // Add stack trace if configured
      if (finalConfig.includeStackTrace && error.stack) {
        errorResponse.stackTrace = error.stack;
      }

      return errorResponse;
    } catch (handlingError) {
      // Fallback error handling
      this.logger.error("Error in error handling", handlingError as Error);

      return {
        success: false,
        error: "InternalError",
        message: "An internal error occurred",
        timestamp: new Date().toISOString(),
        requestId: request?.requestId || "unknown",
        statusCode: 500,
      };
    }
  }

  /**
   * Handle async errors with promise rejection
   */
  async handleAsyncError(
    errorPromise: Promise<any>,
    request?: any,
    config?: Partial<ErrorConfig>
  ): Promise<any> {
    try {
      return await errorPromise;
    } catch (error) {
      return this.handleError(error as Error, request, config);
    }
  }

  /**
   * Wrap function with error handling
   */
  wrapWithErrorHandling<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    config?: Partial<ErrorConfig>
  ): (...args: T) => Promise<R | ErrorResponse> {
    return async (...args: T) => {
      try {
        return await fn(...args);
      } catch (error) {
        return this.handleError(error as Error, undefined, config);
      }
    };
  }

  /**
   * Log error with context
   */
  private logError(
    error: Error | CustomError,
    request?: any,
    requestId?: string
  ): void {
    const errorContext: any = {
      requestId,
      errorType: this.getErrorType(error),
      errorMessage: error.message,
      statusCode: this.getStatusCode(error),
      timestamp: new Date().toISOString(),
    };

    // Add request context if available
    if (request) {
      errorContext.method = request.method;
      errorContext.url = request.url || request.path;
      errorContext.userAgent = request.headers?.["user-agent"];
      errorContext.ip = this.extractIP(request);
    }

    // Add error details if available
    if ("details" in error && error.details) {
      errorContext.details = this.sanitizeErrorDetails(error.details);
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
  private getErrorMessage(
    error: Error | CustomError,
    config: ErrorConfig
  ): string {
    const errorType = this.getErrorType(error);

    // Check for custom message
    if (config.customErrorMessages?.[errorType]) {
      return config.customErrorMessages[errorType];
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
  private getErrorDetails(
    error: Error | CustomError,
    config: ErrorConfig
  ): any {
    if (!("details" in error) || !error.details) {
      return undefined;
    }

    return this.sanitizeErrorDetails(
      error.details,
      config.sensitiveFields || []
    );
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
  private sanitizeErrorDetails(
    details: any,
    sensitiveFields: string[] = []
  ): any {
    if (typeof details !== "object" || details === null) {
      return details;
    }

    if (Array.isArray(details)) {
      return details.map((item) =>
        this.sanitizeErrorDetails(item, sensitiveFields)
      );
    }

    const sanitized: any = {};

    for (const [key, value] of Object.entries(details)) {
      const lowerKey = key.toLowerCase();

      if (
        sensitiveFields.some((field) => lowerKey.includes(field.toLowerCase()))
      ) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = this.sanitizeErrorDetails(value, sensitiveFields);
      }
    }

    return sanitized;
  }

  /**
   * Extract IP address from request
   */
  private extractIP(request: any): string {
    const forwardedFor = request.headers?.["x-forwarded-for"];
    if (forwardedFor) {
      return forwardedFor.split(",")[0].trim();
    }

    const realIP = request.headers?.["x-real-ip"];
    if (realIP) {
      return realIP;
    }

    return request.ip || request.connection?.remoteAddress || "127.0.0.1";
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
   * Create preset configurations
   */
  static createDevelopmentConfig(): ErrorConfig {
    return {
      includeStackTrace: true,
      logErrors: true,
      customErrorMessages: {},
    };
  }

  static createProductionConfig(): ErrorConfig {
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

  static createMinimalConfig(): ErrorConfig {
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
}
