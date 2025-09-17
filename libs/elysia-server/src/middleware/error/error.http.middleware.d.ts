import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base/BaseMiddleware";
import { type MiddlewareContext } from "../types";
export interface ErrorHttpMiddlewareConfig extends HttpMiddlewareConfig {
    readonly includeStackTrace?: boolean;
    readonly logErrors?: boolean;
    readonly customErrorMessages?: Record<string, string>;
    readonly sensitiveFields?: readonly string[];
    readonly excludePaths?: readonly string[];
    readonly maxErrorMessageLength?: number;
    readonly includeErrorDetails?: boolean;
    readonly errorResponseFormat?: "json" | "text" | "html";
}
export interface ErrorResponse {
    success: false;
    error: string;
    message: string;
    timestamp: string;
    requestId?: string;
    statusCode?: number;
    details?: Record<string, unknown>;
    stackTrace?: string;
}
export interface CustomError extends Error {
    statusCode?: number;
    code?: string;
    details?: Record<string, unknown>;
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
export declare class ErrorHttpMiddleware extends BaseMiddleware<ErrorHttpMiddlewareConfig> {
    constructor(metrics: IMetricsCollector, config: ErrorHttpMiddlewareConfig);
    /**
     * Validate middleware configuration
     */
    static validateConfig(config: ErrorHttpMiddlewareConfig): void;
    protected execute(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
    /**
     * Handle middleware error and set response
     */
    private handleMiddlewareError;
    private shouldExcludePath;
    createErrorResponse(error: Error | CustomError, context?: MiddlewareContext): ErrorResponse;
    /**
     * Handle async errors with promise rejection
     */
    handleAsyncError<T>(errorPromise: Promise<T>, context?: MiddlewareContext): Promise<T | ErrorResponse>;
    /**
     * Wrap function with error handling
     */
    wrapWithErrorHandling<T extends unknown[], R>(fn: (...args: T) => Promise<R>): (...args: T) => Promise<R | ErrorResponse>;
    /**
     * Log error with comprehensive context
     */
    private logError;
    /**
     * Get error type/name
     */
    private getErrorType;
    /**
     * Get user-friendly error message
     */
    private getErrorMessage;
    /**
     * Get HTTP status code from error
     */
    private getStatusCode;
    /**
     * Get error details with proper typing
     */
    private getErrorDetails;
    /**
     * Sanitize error message to remove sensitive information
     */
    private sanitizeErrorMessage;
    /**
     * Sanitize stack trace to remove sensitive information
     */
    private sanitizeStackTrace;
    /**
     * Sanitize error details to remove sensitive information
     */
    private sanitizeErrorDetails;
    /**
     * Create custom error classes
     */
    static createValidationError(message: string, details?: Record<string, unknown>): CustomError;
    static createAuthenticationError(message?: string): CustomError;
    static createAuthorizationError(message?: string): CustomError;
    static createNotFoundError(message?: string): CustomError;
    static createRateLimitError(message?: string): CustomError;
    /**
     * Create preset configurations for different environments
     */
    static createDevelopmentConfig(): Partial<ErrorHttpMiddlewareConfig>;
    static createProductionConfig(): Partial<ErrorHttpMiddlewareConfig>;
    static createMinimalConfig(): Partial<ErrorHttpMiddlewareConfig>;
    static createAuditConfig(): Partial<ErrorHttpMiddlewareConfig>;
}
/**
 * Factory function for easy middleware creation
 */
export declare function createErrorHttpMiddleware(metrics: IMetricsCollector, config?: Partial<ErrorHttpMiddlewareConfig>): ErrorHttpMiddleware;
//# sourceMappingURL=error.http.middleware.d.ts.map