import { type IMetricsCollector } from "@libs/monitoring";
import { BaseWebSocketMiddleware, type WebSocketMiddlewareConfig } from "../base/BaseWebSocketMiddleware";
import { type WebSocketContext } from "../types";
export interface ErrorWebSocketMiddlewareConfig extends WebSocketMiddlewareConfig {
    readonly includeStackTrace?: boolean;
    readonly logErrors?: boolean;
    readonly customErrorMessages?: Record<string, string>;
    readonly sensitiveFields?: readonly string[];
    readonly errorResponseType?: string;
}
export interface ErrorWebSocketResponse {
    type: string;
    success: false;
    error: string;
    message: string;
    timestamp: string;
    connectionId?: string;
    details?: Record<string, unknown>;
    stackTrace?: string;
}
export interface WebSocketCustomError extends Error {
    code?: string;
    details?: Record<string, unknown>;
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
export declare class ErrorWebSocketMiddleware extends BaseWebSocketMiddleware<ErrorWebSocketMiddlewareConfig> {
    constructor(metrics: IMetricsCollector, config: ErrorWebSocketMiddlewareConfig);
    /**
     * Execute error middleware - handles errors from downstream middleware
     * Note: This middleware should typically be registered early in the chain
     */
    protected execute(context: WebSocketContext, next: () => Promise<void>): Promise<void>;
    /**
     * Handle WebSocket error and send error response
     */
    private ErrorhandleWebSocket;
    /**
     * Create formatted WebSocket error response
     */
    ErrorcreateWebSocketResponse(error: Error | WebSocketCustomError, context?: WebSocketContext): ErrorWebSocketResponse;
    /**
     * Handle async errors for WebSocket operations
     */
    ErrorhandleAsyncWebSocket(errorPromise: Promise<unknown>, context?: WebSocketContext): Promise<unknown>;
    /**
     * Wrap WebSocket handler function with error handling
     */
    wrapWebSocketHandler<T extends unknown[], R>(handler: (...args: T) => Promise<R>): (...args: T) => Promise<R | ErrorWebSocketResponse>;
    /**
     * Log WebSocket error with comprehensive context
     */
    private ErrorlogWebSocket;
    /**
     * Get error type/name
     */
    private getErrorType;
    /**
     * Get user-friendly error message
     */
    private getErrorMessage;
    /**
     * Get error details with proper typing
     */
    private getErrorDetails;
    /**
     * Sanitize error message to remove sensitive information
     */
    private sanitizeErrorMessage;
    /**
     * Sanitize error details to remove sensitive information
     */
    private sanitizeErrorDetails;
    /**
     * Create custom WebSocket error classes
     */
    static createWebSocketValidationError(message: string, details?: Record<string, unknown>): WebSocketCustomError;
    static createWebSocketAuthenticationError(message?: string): WebSocketCustomError;
    static createWebSocketAuthorizationError(message?: string): WebSocketCustomError;
    static createWebSocketConnectionError(message?: string): WebSocketCustomError;
    static createWebSocketRateLimitError(message?: string): WebSocketCustomError;
    /**
     * Create preset configurations for different environments
     */
    static createDevelopmentConfig(): Partial<ErrorWebSocketMiddlewareConfig>;
    static createProductionConfig(): Partial<ErrorWebSocketMiddlewareConfig>;
    static createMinimalConfig(): Partial<ErrorWebSocketMiddlewareConfig>;
    static createAuditConfig(): Partial<ErrorWebSocketMiddlewareConfig>;
}
/**
 * Factory function for easy WebSocket error middleware creation
 */
export declare function ErrorcreateWebSocketMiddleware(metrics: IMetricsCollector, config?: Partial<ErrorWebSocketMiddlewareConfig>): ErrorWebSocketMiddleware;
//# sourceMappingURL=error.websocket.middleware.d.ts.map