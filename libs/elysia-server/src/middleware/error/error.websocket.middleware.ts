import { type IMetricsCollector } from "@libs/monitoring";
import {
  BaseWebSocketMiddleware,
  type WebSocketMiddlewareConfig,
} from "../base/BaseWebSocketMiddleware";
import { type WebSocketContext } from "../types";

export interface ErrorWebSocketMiddlewareConfig
  extends WebSocketMiddlewareConfig {
  readonly includeStackTrace?: boolean;
  readonly logErrors?: boolean;
  readonly customErrorMessages?: Record<string, string>;
  readonly sensitiveFields?: readonly string[];
  readonly errorResponseType?: string; // Message type for error responses
}

export interface ErrorWebSocketResponse {
  type: string; // Usually "error"
  success: false;
  error: string;
  message: string;
  timestamp: string;
  connectionId?: string;
  details?: any;
  stackTrace?: string;
}

export interface WebSocketCustomError extends Error {
  code?: string;
  details?: any;
}

/**
 * WebSocket Error Middleware following AbstractMiddleware architecture
 * Provides comprehensive error handling for WebSocket connections
 *
 * Features:
 * - Extends BaseWebSocketMiddleware for WebSocket contexts
 * - Safe JSON serialization for error responses
 * - Connection-specific error handling
 * - Immutable configuration with withConfig()
 * - Comprehensive error logging and metrics
 * - Security-aware error sanitization
 */
export class ErrorWebSocketMiddleware extends BaseWebSocketMiddleware<ErrorWebSocketMiddlewareConfig> {
  constructor(
    metrics: IMetricsCollector,
    config: ErrorWebSocketMiddlewareConfig
  ) {
    const mergedConfig = {
      ...config,
      ...{
        includeStackTrace: false,
        logErrors: true,
        errorResponseType: "error",
        ...config,
      },
    } as ErrorWebSocketMiddlewareConfig;

    super(metrics, mergedConfig, config.name || "ws-error-handler");
  }

  /**
   * Execute error middleware - handles errors from downstream middleware
   * Note: This middleware should typically be registered early in the chain
   */
  protected async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    try {
      await next();
    } catch (error) {
      await this.ErrorhandleWebSocket(error as Error, context);
    }
  }

  /**
   * Handle WebSocket error and send error response
   */
  private async ErrorhandleWebSocket(
    error: Error,
    context: WebSocketContext
  ): Promise<void> {
    const errorResponse = await this.ErrorcreateWebSocketResponse(
      error,
      context
    );

    // Send error response to client
    this.sendResponse(context, errorResponse);

    // Record error metrics
    await this.recordMetric("ws_error_handled", 1, {
      errorType: this.getErrorType(error),
      connectionId: context.connectionId || "unknown",
    });

    // Log error if configured
    if (this.config.logErrors) {
      await this.ErrorlogWebSocket(error, context);
    }
  }

  /**
   * Create formatted WebSocket error response
   */
  public async ErrorcreateWebSocketResponse(
    error: Error | WebSocketCustomError,
    context?: WebSocketContext
  ): Promise<ErrorWebSocketResponse> {
    try {
      const connectionId = context?.connectionId || "unknown";

      const errorResponse: ErrorWebSocketResponse = {
        type: this.config.errorResponseType || "error",
        success: false,
        error: this.getErrorType(error),
        message: this.getErrorMessage(error),
        timestamp: new Date().toISOString(),
        connectionId,
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
        "Error in WebSocket error response creation",
        handlingError as Error
      );

      return {
        type: this.config.errorResponseType || "error",
        success: false,
        error: "InternalError",
        message: "An internal error occurred",
        timestamp: new Date().toISOString(),
        connectionId: context?.connectionId || "unknown",
      };
    }
  }

  /**
   * Handle async errors for WebSocket operations
   */
  public async ErrorhandleAsyncWebSocket(
    errorPromise: Promise<any>,
    context?: WebSocketContext
  ): Promise<any> {
    try {
      return await errorPromise;
    } catch (error) {
      return this.ErrorcreateWebSocketResponse(error as Error, context);
    }
  }

  /**
   * Wrap WebSocket handler function with error handling
   */
  public wrapWebSocketHandler<T extends any[], R>(
    handler: (...args: T) => Promise<R>
  ): (...args: T) => Promise<R | ErrorWebSocketResponse> {
    return async (...args: T) => {
      try {
        return await handler(...args);
      } catch (error) {
        return this.ErrorcreateWebSocketResponse(error as Error);
      }
    };
  }

  /**
   * Log WebSocket error with comprehensive context
   */
  private async ErrorlogWebSocket(
    error: Error | WebSocketCustomError,
    context: WebSocketContext
  ): Promise<void> {
    const errorContext: Record<string, any> = {
      connectionId: context.connectionId,
      errorType: this.getErrorType(error),
      errorMessage: error.message,
      timestamp: new Date().toISOString(),
      messageType: context.message?.type,
      authenticated: context.authenticated,
      userId: context["user"]?.id,
    };

    // Add error details if available
    if ("details" in error && error.details) {
      errorContext["details"] = this.sanitizeErrorDetails(error.details);
    }

    // Add connection info if available
    if (context.ws) {
      errorContext["readyState"] = context.ws["readyState"];
      errorContext["url"] = context.ws["url"];
    }

    // Log with appropriate level
    this.logger.error("WebSocket error occurred", error, errorContext);
  }

  /**
   * Get error type/name
   */
  private getErrorType(error: Error | WebSocketCustomError): string {
    if ("code" in error && error.code) {
      return error.code;
    }

    return error.name || error.constructor.name || "UnknownError";
  }

  /**
   * Get user-friendly error message
   */
  private getErrorMessage(error: Error | WebSocketCustomError): string {
    const errorType = this.getErrorType(error);

    // Check for custom message
    if (this.config.customErrorMessages?.[errorType]) {
      return this.config.customErrorMessages[errorType];
    }

    // Return sanitized original message
    return this.sanitizeErrorMessage(error.message || "An error occurred");
  }

  /**
   * Get error details
   */
  private getErrorDetails(error: Error | WebSocketCustomError): any {
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

    // Remove potential connection strings
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
   * Create custom WebSocket error classes
   */
  static createWebSocketValidationError(
    message: string,
    details?: any
  ): WebSocketCustomError {
    const error = new Error(message) as WebSocketCustomError;
    error.name = "WebSocketValidationError";
    error.details = details;
    return error;
  }

  static createWebSocketAuthenticationError(
    message: string = "WebSocket authentication failed"
  ): WebSocketCustomError {
    const error = new Error(message) as WebSocketCustomError;
    error.name = "WebSocketAuthenticationError";
    return error;
  }

  static createWebSocketAuthorizationError(
    message: string = "WebSocket access denied"
  ): WebSocketCustomError {
    const error = new Error(message) as WebSocketCustomError;
    error.name = "WebSocketAuthorizationError";
    return error;
  }

  static createWebSocketConnectionError(
    message: string = "WebSocket connection error"
  ): WebSocketCustomError {
    const error = new Error(message) as WebSocketCustomError;
    error.name = "WebSocketConnectionError";
    return error;
  }

  static createWebSocketRateLimitError(
    message: string = "WebSocket rate limit exceeded"
  ): WebSocketCustomError {
    const error = new Error(message) as WebSocketCustomError;
    error.name = "WebSocketRateLimitError";
    return error;
  }

  /**
   * Create preset configurations for different environments
   */
  static createDevelopmentConfig(): Partial<ErrorWebSocketMiddlewareConfig> {
    return {
      includeStackTrace: true,
      logErrors: true,
      customErrorMessages: {},
      errorResponseType: "error",
    };
  }

  static createProductionConfig(): Partial<ErrorWebSocketMiddlewareConfig> {
    return {
      includeStackTrace: false,
      logErrors: true,
      errorResponseType: "error",
      customErrorMessages: {
        WebSocketValidationError: "Invalid message data",
        WebSocketAuthenticationError: "Authentication required",
        WebSocketAuthorizationError: "Access denied",
        WebSocketConnectionError: "Connection error occurred",
        WebSocketRateLimitError: "Rate limit exceeded",
        ValidationError: "Invalid request data",
        AuthenticationError: "Authentication required",
        AuthorizationError: "Access denied",
      },
    };
  }

  static createMinimalConfig(): Partial<ErrorWebSocketMiddlewareConfig> {
    return {
      includeStackTrace: false,
      logErrors: false,
      errorResponseType: "error",
      customErrorMessages: {
        WebSocketValidationError: "Invalid message",
        WebSocketAuthenticationError: "Authentication failed",
        WebSocketAuthorizationError: "Access denied",
        WebSocketConnectionError: "Connection error",
        WebSocketRateLimitError: "Rate limit exceeded",
      },
    };
  }

  static createAuditConfig(): Partial<ErrorWebSocketMiddlewareConfig> {
    return {
      includeStackTrace: true,
      logErrors: true,
      errorResponseType: "error",
      customErrorMessages: {},
      sensitiveFields: [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "session",
        "apiKey",
      ],
    };
  }
}

/**
 * Factory function for easy WebSocket error middleware creation
 */
export function ErrorcreateWebSocketMiddleware(
  metrics: IMetricsCollector,
  config?: Partial<ErrorWebSocketMiddlewareConfig>
): ErrorWebSocketMiddleware {
  const defaultConfig: ErrorWebSocketMiddlewareConfig = {
    name: "ws-error-handler",
    enabled: true,
    priority: 1000, // High priority to catch errors early
    includeStackTrace: false,
    logErrors: true,
    errorResponseType: "error",
    ...config,
  };

  return new ErrorWebSocketMiddleware(metrics, defaultConfig);
}
