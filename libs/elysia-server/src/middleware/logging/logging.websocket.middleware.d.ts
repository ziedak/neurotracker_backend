import { type IMetricsCollector } from "@libs/monitoring";
import { BaseWebSocketMiddleware, type WebSocketMiddlewareConfig } from "../base/BaseWebSocketMiddleware";
import type { WebSocketConnectionMetadata, WebSocketContext } from "../types";
/**
 * WebSocket logging middleware configuration interface
 * Extends WebSocketMiddlewareConfig with logging-specific options
 */
export interface LoggingWebSocketMiddlewareConfig extends WebSocketMiddlewareConfig {
    readonly logLevel?: "debug" | "info" | "warn" | "error";
    readonly logMessages?: boolean;
    readonly logIncomingMessages?: boolean;
    readonly logOutgoingMessages?: boolean;
    readonly logConnections?: boolean;
    readonly logDisconnections?: boolean;
    readonly logErrors?: boolean;
    readonly logMetadata?: boolean;
    readonly excludeMessageTypes?: readonly string[];
    readonly excludePaths?: readonly string[];
    readonly maxMessageSize?: number;
    readonly sensitiveFields?: readonly string[];
    readonly includeMessageTiming?: boolean;
    readonly includeUserContext?: boolean;
    readonly includeConnectionMetrics?: boolean;
    readonly logHeartbeat?: boolean;
    readonly redactPayload?: boolean;
    readonly sampleRate?: number;
}
/**
 * WebSocket connection log data structure
 */
export interface WebSocketConnectionLogData {
    readonly connectionId: string;
    readonly event: "connect" | "disconnect";
    readonly timestamp: string;
    clientIp?: string | undefined;
    userAgent?: string | undefined;
    userId?: string | undefined;
    readonly authenticated: boolean;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    connectionDuration?: number | undefined;
    messageCount?: number;
    reason?: string | undefined;
}
/**
 * WebSocket message log data structure
 */
export interface WebSocketMessageLogData {
    readonly connectionId: string;
    readonly direction: "incoming" | "outgoing";
    readonly messageType: string;
    readonly messageId?: string;
    readonly timestamp: string;
    userId?: string | undefined;
    readonly authenticated: boolean;
    messageSize?: number | undefined;
    processingTime?: number;
    payload?: unknown;
    metadata?: WebSocketConnectionMetadata;
    error?: string;
}
/**
 * Production-grade WebSocket Logging Middleware
 * Provides comprehensive WebSocket connection and message logging with configurable security controls
 *
 * Features:
 * - Framework-agnostic WebSocket implementation
 * - Connection lifecycle tracking (connect/disconnect)
 * - Message direction logging (incoming/outgoing)
 * - Comprehensive data sanitization and security
 * - Configurable logging levels and content filtering
 * - Performance-optimized with minimal overhead
 * - Built-in PII protection and sensitive data filtering
 * - Real-time connection metrics and timing tracking
 * - Message type filtering and size limits
 *
 * @template LoggingWebSocketMiddlewareConfig - WebSocket logging-specific configuration
 */
export declare class LoggingWebSocketMiddleware extends BaseWebSocketMiddleware<LoggingWebSocketMiddlewareConfig> {
    private connectionStartTimes;
    private connectionMessageCounts;
    constructor(metrics: IMetricsCollector, config?: Partial<LoggingWebSocketMiddlewareConfig>);
    /**
     * Validate raw configuration before defaults are applied
     */
    private static validateRawConfiguration;
    /**
     * Core WebSocket logging middleware execution logic
     * Handles message logging with comprehensive data capture
     */
    protected execute(context: WebSocketContext, next: () => Promise<void>): Promise<void>;
    /**
     * Log WebSocket connection event
     */
    logConnection(context: WebSocketContext): Promise<void>;
    /**
     * Log WebSocket disconnection event
     */
    logDisconnection(context: WebSocketContext, reason?: string): Promise<void>;
    /**
     * Log incoming WebSocket message
     */
    private logIncomingMessage;
    /**
     * Log outgoing WebSocket message
     */
    private logOutgoingMessage;
    /**
     * Log error in WebSocket message processing
     */
    private logErrorMessage;
    /**
     * Generate unique message ID
     */
    private generateMessageId;
    /**
     * Increment message count for connection
     */
    private incrementMessageCount;
    /**
     * Check if message type should be excluded from logging
     */
    private shouldExcludeMessageType;
    /**
     * Get message size in bytes
     */
    private getMessageSize;
    /**
     * Sanitize query parameters
     */
    private sanitizeQuery;
    /**
     * Sanitize headers by removing or redacting sensitive ones
     */
    private sanitizeHeaders;
    /**
     * Sanitize message payload by removing sensitive fields and limiting size
     */
    private sanitizePayload;
    /**
     * Sanitize connection metadata
     */
    private sanitizeMetadata;
    /**
     * Deep sanitize object by removing sensitive fields recursively
     */
    private deepSanitize;
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
    static createDevelopmentConfig(): Partial<LoggingWebSocketMiddlewareConfig>;
    /**
     * Create production configuration preset
     */
    static createProductionConfig(): Partial<LoggingWebSocketMiddlewareConfig>;
    /**
     * Create audit configuration preset
     */
    static createAuditConfig(): Partial<LoggingWebSocketMiddlewareConfig>;
    /**
     * Create minimal configuration preset
     */
    static createMinimalConfig(): Partial<LoggingWebSocketMiddlewareConfig>;
    /**
     * Create performance-focused configuration preset
     */
    static createPerformanceConfig(): Partial<LoggingWebSocketMiddlewareConfig>;
    /**
     * Create debug configuration preset
     */
    static createDebugConfig(): Partial<LoggingWebSocketMiddlewareConfig>;
    /**
     * Cleanup method for WebSocket logging middleware
     * Clears connection tracking data
     */
    cleanup(): void;
}
/**
 * Factory function for WebSocket logging middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export declare function createLoggingWebSocketMiddleware(metrics: IMetricsCollector, config?: Partial<LoggingWebSocketMiddlewareConfig>): LoggingWebSocketMiddleware;
/**
 * Preset configurations for common WebSocket logging scenarios
 * Immutable configuration objects for different environments
 */
export declare const WEBSOCKET_LOGGING_PRESETS: {
    readonly development: () => Partial<LoggingWebSocketMiddlewareConfig>;
    readonly production: () => Partial<LoggingWebSocketMiddlewareConfig>;
    readonly audit: () => Partial<LoggingWebSocketMiddlewareConfig>;
    readonly minimal: () => Partial<LoggingWebSocketMiddlewareConfig>;
    readonly performance: () => Partial<LoggingWebSocketMiddlewareConfig>;
    readonly debug: () => Partial<LoggingWebSocketMiddlewareConfig>;
};
//# sourceMappingURL=logging.websocket.middleware.d.ts.map