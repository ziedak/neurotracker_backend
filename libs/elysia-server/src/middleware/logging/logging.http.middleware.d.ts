import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base";
import type { MiddlewareContext } from "../types";
/**
 * Logging middleware configuration interface
 * Extends HttpMiddlewareConfig with logging-specific options
 */
export interface LoggingHttpMiddlewareConfig extends HttpMiddlewareConfig {
    readonly logLevel?: "debug" | "info" | "warn" | "error";
    readonly logRequestBody?: boolean;
    readonly logResponseBody?: boolean;
    readonly logHeaders?: boolean;
    readonly excludePaths?: readonly string[];
    readonly excludeHeaders?: readonly string[];
    readonly maxBodySize?: number;
    readonly sensitiveFields?: readonly string[];
    readonly includeRequestTiming?: boolean;
    readonly includeUserAgent?: boolean;
    readonly includeClientIp?: boolean;
}
/**
 * Request log data structure
 */
export interface RequestLogData {
    readonly requestId: string;
    readonly method: string;
    readonly url: string;
    userAgent?: string | undefined;
    ip?: string | undefined;
    readonly timestamp: string;
    headers?: Record<string, string>;
    body?: unknown;
    query?: Record<string, string>;
    params?: Record<string, string>;
}
/**
 * Response log data structure
 */
export interface ResponseLogData {
    readonly requestId: string;
    readonly statusCode?: number;
    readonly responseTime: number;
    contentLength?: number | undefined;
    headers?: Record<string, string>;
    body?: unknown;
    error?: string;
}
/**
 * Production-grade Logging Middleware
 * Provides comprehensive request/response logging with configurable security controls
 *
 * Features:
 * - Framework-agnostic implementation
 * - Comprehensive data sanitization and security
 * - Configurable logging levels and content
 * - Performance-optimized with minimal overhead
 * - Built-in PII protection and sensitive data filtering
 * - Request correlation and timing tracking
 *
 * @template LoggingHttpMiddlewareConfig - Logging-specific configuration
 */
export declare class LoggingHttpMiddleware extends BaseMiddleware<LoggingHttpMiddlewareConfig> {
    constructor(metrics: IMetricsCollector, config?: Partial<LoggingHttpMiddlewareConfig>);
    /**
     * Core logging middleware execution logic
     * Handles request and response logging with comprehensive data capture
     */
    protected execute(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
    /**
     * Log incoming request with comprehensive data capture
     */
    private logRequest;
    /**
     * Log successful response
     */
    private logResponse;
    /**
     * Log error response
     */
    private logErrorResponse;
    /**
     * Generate unique request ID
     */
    private generateRequestId;
    /**
     * Extract path from request context
     */
    private extractPath;
    /**
     * Extract user agent from request headers
     */
    private extractUserAgent;
    /**
     * Extract client IP address from request
     */
    private extractClientIp;
    /**
     * Check if path should be excluded from logging
     */
    private shouldExcludePath;
    /**
     * Sanitize URL to remove sensitive query parameters
     */
    private sanitizeUrl;
    /**
     * Sanitize headers by removing or redacting sensitive ones
     */
    private sanitizeHeaders;
    /**
     * Sanitize query parameters
     */
    private sanitizeQuery;
    /**
     * Sanitize URL parameters
     */
    private sanitizeParams;
    /**
     * Sanitize body by removing sensitive fields and limiting size
     */
    private sanitizeBody;
    /**
     * Deep sanitize object by removing sensitive fields recursively
     */
    private deepSanitize;
    /**
     * Get content length from response context
     */
    private getContentLength;
    /**
     * Get appropriate log level based on HTTP status code
     */
    private getLogLevelForStatus;
    /**
     * Log with specified level
     */
    private logWithLevel;
    /**
     * Record logging-specific metrics
     */
    private recordLoggingMetrics;
    /**
     * Validate configuration on instantiation
     */
    private validateConfiguration;
    /**
     * Create development configuration preset
     */
    static createDevelopmentConfig(): Partial<LoggingHttpMiddlewareConfig>;
    /**
     * Create production configuration preset
     */
    static createProductionConfig(): Partial<LoggingHttpMiddlewareConfig>;
    /**
     * Create audit configuration preset
     */
    static createAuditConfig(): Partial<LoggingHttpMiddlewareConfig>;
    /**
     * Create minimal configuration preset
     */
    static createMinimalConfig(): Partial<LoggingHttpMiddlewareConfig>;
}
/**
 * Factory function for logging middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export declare function createLoggingHttpMiddleware(metrics: IMetricsCollector, config?: Partial<LoggingHttpMiddlewareConfig>): LoggingHttpMiddleware;
/**
 * Preset configurations for common logging scenarios
 * Immutable configuration objects for different environments
 */
export declare const LOGGING_PRESETS: {
    readonly development: () => Partial<LoggingHttpMiddlewareConfig>;
    readonly production: () => Partial<LoggingHttpMiddlewareConfig>;
    readonly audit: () => Partial<LoggingHttpMiddlewareConfig>;
    readonly minimal: () => Partial<LoggingHttpMiddlewareConfig>;
    readonly debug: () => Partial<LoggingHttpMiddlewareConfig>;
    readonly performance: () => Partial<LoggingHttpMiddlewareConfig>;
};
//# sourceMappingURL=logging.http.middleware.d.ts.map