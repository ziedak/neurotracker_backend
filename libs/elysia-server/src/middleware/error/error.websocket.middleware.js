import { BaseWebSocketMiddleware, } from "../base/BaseWebSocketMiddleware";
import { asWebSocket } from "../types";
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
export class ErrorWebSocketMiddleware extends BaseWebSocketMiddleware {
    constructor(metrics, config) {
        const mergedConfig = {
            ...config,
            ...{
                includeStackTrace: false,
                logErrors: true,
                errorResponseType: "error",
                ...config,
            },
        };
        super(metrics, mergedConfig, config.name || "ws-error-handler");
    }
    /**
     * Execute error middleware - handles errors from downstream middleware
     * Note: This middleware should typically be registered early in the chain
     */
    async execute(context, next) {
        try {
            await next();
        }
        catch (error) {
            await this.ErrorhandleWebSocket(error, context);
        }
    }
    /**
     * Handle WebSocket error and send error response
     */
    async ErrorhandleWebSocket(error, context) {
        const errorResponse = this.ErrorcreateWebSocketResponse(error, context);
        // Send error response to client
        await this.sendResponse(context, errorResponse);
        // Record error metrics
        await this.recordMetric("ws_error_handled", 1, {
            errorType: this.getErrorType(error),
            connectionId: context.connectionId || "unknown",
        });
        // Log error if configured
        if (this.config.logErrors) {
            this.ErrorlogWebSocket(error, context);
        }
    }
    /**
     * Create formatted WebSocket error response
     */
    ErrorcreateWebSocketResponse(error, context) {
        try {
            const connectionId = context?.connectionId ?? "unknown";
            const errorResponse = {
                type: this.config.errorResponseType ?? "error",
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
        }
        catch (handlingError) {
            // Fallback error handling
            this.logger.error("Error in WebSocket error response creation", handlingError);
            return {
                type: this.config.errorResponseType ?? "error",
                success: false,
                error: "InternalError",
                message: "An internal error occurred",
                timestamp: new Date().toISOString(),
                connectionId: context?.connectionId ?? "unknown",
            };
        }
    }
    /**
     * Handle async errors for WebSocket operations
     */
    async ErrorhandleAsyncWebSocket(errorPromise, context) {
        try {
            return await errorPromise;
        }
        catch (error) {
            return this.ErrorcreateWebSocketResponse(error, context);
        }
    }
    /**
     * Wrap WebSocket handler function with error handling
     */
    wrapWebSocketHandler(handler) {
        return async (...args) => {
            try {
                return await handler(...args);
            }
            catch (error) {
                return this.ErrorcreateWebSocketResponse(error);
            }
        };
    }
    /**
     * Log WebSocket error with comprehensive context
     */
    ErrorlogWebSocket(error, context) {
        const errorContext = {
            connectionId: context.connectionId,
            errorType: this.getErrorType(error),
            errorMessage: error.message,
            timestamp: new Date().toISOString(),
            messageType: context.message?.type,
            authenticated: context.authenticated,
            userId: context.userId,
        };
        // Add error details if available
        if ("details" in error && error.details) {
            errorContext["details"] = this.sanitizeErrorDetails(error.details);
        }
        // Add connection info if available
        if (context.ws) {
            const ws = asWebSocket(context.ws);
            errorContext["readyState"] = ws.readyState;
            // Safely access URL property if available
            const wsWithUrl = ws;
            errorContext["url"] = wsWithUrl.url ?? "unknown";
        }
        // Log with appropriate level
        this.logger.error("WebSocket error occurred", error, errorContext);
    }
    /**
     * Get error type/name
     */
    getErrorType(error) {
        if ("code" in error && error.code) {
            return error.code;
        }
        return error.name || error.constructor.name || "UnknownError";
    }
    /**
     * Get user-friendly error message
     */
    getErrorMessage(error) {
        const errorType = this.getErrorType(error);
        // Check for custom message
        if (this.config.customErrorMessages?.[errorType]) {
            return this.config.customErrorMessages[errorType];
        }
        // Return sanitized original message
        return this.sanitizeErrorMessage(error.message || "An error occurred");
    }
    /**
     * Get error details with proper typing
     */
    getErrorDetails(error) {
        if (!("details" in error) || !error.details) {
            return undefined;
        }
        return this.sanitizeErrorDetails(error.details);
    }
    /**
     * Sanitize error message to remove sensitive information
     */
    sanitizeErrorMessage(message) {
        // Remove file paths
        message = message.replace(/[A-Z]:\\[^\\]+(?:\\[^\\]+)*/g, "[FILE_PATH]");
        message = message.replace(/\/[^\\/\s]+(?:\/[^\\/\s]+)*/g, "[FILE_PATH]");
        // Remove potential connection strings
        message = message.replace(/\b(?:password|pwd|secret|key|token)=[^\s;]+/gi, "[CREDENTIALS]");
        // Remove email addresses
        message = message.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[EMAIL]");
        return message;
    }
    /**
     * Sanitize error details to remove sensitive information
     */
    sanitizeErrorDetails(details) {
        const sensitiveFields = this.config.sensitiveFields ?? [];
        return this.sanitizeObject(details, [...sensitiveFields]);
    }
    /**
     * Create custom WebSocket error classes
     */
    static createWebSocketValidationError(message, details) {
        const error = new Error(message);
        error.name = "WebSocketValidationError";
        if (details) {
            error.details = details;
        }
        return error;
    }
    static createWebSocketAuthenticationError(message = "WebSocket authentication failed") {
        const error = new Error(message);
        error.name = "WebSocketAuthenticationError";
        return error;
    }
    static createWebSocketAuthorizationError(message = "WebSocket access denied") {
        const error = new Error(message);
        error.name = "WebSocketAuthorizationError";
        return error;
    }
    static createWebSocketConnectionError(message = "WebSocket connection error") {
        const error = new Error(message);
        error.name = "WebSocketConnectionError";
        return error;
    }
    static createWebSocketRateLimitError(message = "WebSocket rate limit exceeded") {
        const error = new Error(message);
        error.name = "WebSocketRateLimitError";
        return error;
    }
    /**
     * Create preset configurations for different environments
     */
    static createDevelopmentConfig() {
        return {
            includeStackTrace: true,
            logErrors: true,
            customErrorMessages: {},
            errorResponseType: "error",
        };
    }
    static createProductionConfig() {
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
    static createMinimalConfig() {
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
    static createAuditConfig() {
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
export function ErrorcreateWebSocketMiddleware(metrics, config) {
    const defaultConfig = {
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
//# sourceMappingURL=error.websocket.middleware.js.map