import { BaseWebSocketMiddleware, } from "../base/BaseWebSocketMiddleware";
/**
 * Default WebSocket logging configuration constants
 */
const DEFAULT_WEBSOCKET_LOGGING_OPTIONS = {
    LOG_LEVEL: "info",
    LOG_INCOMING_MESSAGES: true,
    LOG_OUTGOING_MESSAGES: false,
    LOG_CONNECTIONS: true,
    LOG_DISCONNECTIONS: true,
    LOG_METADATA: false,
    EXCLUDE_MESSAGE_TYPES: ["ping", "pong", "heartbeat"],
    MAX_MESSAGE_SIZE: 1024 * 5, // 5KB
    SENSITIVE_FIELDS: [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "jwt",
        "session",
    ],
    INCLUDE_MESSAGE_TIMING: true,
    INCLUDE_USER_CONTEXT: true,
    INCLUDE_CONNECTION_METRICS: true,
    LOG_HEARTBEAT: false,
    REDACT_PAYLOAD: false,
    PRIORITY: 60, // Medium-low priority for logging
};
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
export class LoggingWebSocketMiddleware extends BaseWebSocketMiddleware {
    connectionStartTimes = new Map();
    connectionMessageCounts = new Map();
    constructor(metrics, config = {}) {
        // Validate configuration before applying defaults
        LoggingWebSocketMiddleware.validateRawConfiguration(config);
        // Create complete configuration with validated defaults
        const completeConfig = {
            name: config.name || "ws-logging",
            enabled: config.enabled ?? true,
            priority: config.priority ?? DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
            skipMessageTypes: config.skipMessageTypes || [],
            logLevel: config.logLevel ?? DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_LEVEL,
            logMessages: config.logMessages ?? true,
            logIncomingMessages: config.logIncomingMessages ??
                DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_INCOMING_MESSAGES,
            logOutgoingMessages: config.logOutgoingMessages ??
                DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_OUTGOING_MESSAGES,
            logConnections: config.logConnections ??
                DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_CONNECTIONS,
            logDisconnections: config.logDisconnections ??
                DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_DISCONNECTIONS,
            logMetadata: config.logMetadata ?? DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_METADATA,
            excludeMessageTypes: config.excludeMessageTypes ?? [
                ...DEFAULT_WEBSOCKET_LOGGING_OPTIONS.EXCLUDE_MESSAGE_TYPES,
            ],
            maxMessageSize: config.maxMessageSize ??
                DEFAULT_WEBSOCKET_LOGGING_OPTIONS.MAX_MESSAGE_SIZE,
            sensitiveFields: config.sensitiveFields ?? [
                ...DEFAULT_WEBSOCKET_LOGGING_OPTIONS.SENSITIVE_FIELDS,
            ],
            includeMessageTiming: config.includeMessageTiming ??
                DEFAULT_WEBSOCKET_LOGGING_OPTIONS.INCLUDE_MESSAGE_TIMING,
            includeUserContext: config.includeUserContext ??
                DEFAULT_WEBSOCKET_LOGGING_OPTIONS.INCLUDE_USER_CONTEXT,
            includeConnectionMetrics: config.includeConnectionMetrics ??
                DEFAULT_WEBSOCKET_LOGGING_OPTIONS.INCLUDE_CONNECTION_METRICS,
            logHeartbeat: config.logHeartbeat ?? DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_HEARTBEAT,
            redactPayload: config.redactPayload ??
                DEFAULT_WEBSOCKET_LOGGING_OPTIONS.REDACT_PAYLOAD,
        };
        super(metrics, completeConfig, completeConfig.name);
        this.validateConfiguration();
    }
    /**
     * Validate raw configuration before defaults are applied
     */
    static validateRawConfiguration(config) {
        const { maxMessageSize, sampleRate, excludePaths } = config;
        if (maxMessageSize !== undefined &&
            (maxMessageSize <= 0 || !Number.isInteger(maxMessageSize))) {
            throw new Error("WebSocket Logging maxMessageSize must be a positive integer");
        }
        if (sampleRate !== undefined && (sampleRate < 0 || sampleRate > 1)) {
            throw new Error("WebSocket Logging sampleRate must be between 0 and 1");
        }
        if (excludePaths?.some((path) => !path.startsWith("/"))) {
            throw new Error("WebSocket Logging excludePaths must start with '/'");
        }
    }
    /**
     * Core WebSocket logging middleware execution logic
     * Handles message logging with comprehensive data capture
     */
    async execute(context, next) {
        const startTime = performance.now();
        const messageId = this.generateMessageId();
        try {
            // Log incoming message
            if (this.config.logIncomingMessages) {
                this.logIncomingMessage(context, messageId);
            }
            // Track message count for connection
            this.incrementMessageCount(context.connectionId);
            // Store start time for processing duration
            const processingStartTime = Date.now();
            // Continue to next middleware
            await next();
            // Log outgoing messages if configured
            if (this.config.logOutgoingMessages) {
                const processingTime = Date.now() - processingStartTime;
                this.logOutgoingMessage(context, messageId, processingTime);
            }
            // Record successful logging metrics
            await this.recordLoggingMetrics("message_logged", {
                messageType: context.message.type,
                direction: "incoming",
                connectionId: context.connectionId,
                authenticated: context.authenticated.toString(),
            });
        }
        catch (error) {
            // Log error message processing
            const processingTime = Date.now() - (Date.now() - startTime);
            await this.logErrorMessage(context, messageId, processingTime, error);
            throw error; // Re-throw to maintain error chain
        }
        finally {
            const executionTime = performance.now() - startTime;
            await this.recordMetric("websocket_logging_execution_time", executionTime, {
                messageType: context.message.type,
                connectionId: context.connectionId,
            });
        }
    }
    /**
     * Log WebSocket connection event
     */
    async logConnection(context) {
        if (!this.config.logConnections) {
            return;
        }
        // Track connection start time
        this.connectionStartTimes.set(context.connectionId, Date.now());
        this.connectionMessageCounts.set(context.connectionId, 0);
        const logData = {
            connectionId: context.connectionId,
            event: "connect",
            timestamp: new Date().toISOString(),
            authenticated: context.authenticated,
        };
        // Add optional data based on configuration
        if (this.config.includeUserContext) {
            logData.userId = context.userId;
            logData.clientIp = context.metadata.clientIp;
            logData.userAgent = context.metadata.userAgent;
        }
        if (this.config.logMetadata) {
            logData.query = this.sanitizeQuery(context.metadata.query);
            logData.headers = this.sanitizeHeaders(context.metadata.headers);
        }
        this.logWithLevel(this.config.logLevel, "WebSocket connection established", logData);
        await this.recordLoggingMetrics("connection_logged", {
            event: "connect",
            authenticated: context.authenticated.toString(),
            clientIp: context.metadata.clientIp,
        });
    }
    /**
     * Log WebSocket disconnection event
     */
    async logDisconnection(context, reason) {
        if (!this.config.logDisconnections) {
            return;
        }
        const connectionStartTime = this.connectionStartTimes.get(context.connectionId);
        const messageCount = this.connectionMessageCounts.get(context.connectionId) || 0;
        const connectionDuration = connectionStartTime
            ? Date.now() - connectionStartTime
            : undefined;
        const logData = {
            connectionId: context.connectionId,
            event: "disconnect",
            timestamp: new Date().toISOString(),
            authenticated: context.authenticated,
            connectionDuration,
            messageCount,
            reason,
        };
        // Add optional data based on configuration
        if (this.config.includeUserContext) {
            logData.userId = context.userId;
            logData.clientIp = context.metadata.clientIp;
        }
        this.logWithLevel(this.config.logLevel, "WebSocket connection closed", logData);
        // Clean up tracking data
        this.connectionStartTimes.delete(context.connectionId);
        this.connectionMessageCounts.delete(context.connectionId);
        await this.recordLoggingMetrics("connection_logged", {
            event: "disconnect",
            authenticated: context.authenticated.toString(),
            clientIp: context.metadata.clientIp,
            reason: reason || "unknown",
        });
    }
    /**
     * Log incoming WebSocket message
     */
    logIncomingMessage(context, messageId) {
        // Skip excluded message types
        if (this.shouldExcludeMessageType(context.message.type)) {
            return;
        }
        const logData = {
            connectionId: context.connectionId,
            direction: "incoming",
            messageType: context.message.type,
            messageId,
            timestamp: new Date().toISOString(),
            authenticated: context.authenticated,
            messageSize: this.getMessageSize(context.message),
        };
        // Add optional data based on configuration
        if (this.config.includeUserContext) {
            logData.userId = context.userId;
        }
        if (!this.config.redactPayload && context.message.payload) {
            logData.payload = this.sanitizePayload(context.message.payload);
        }
        if (this.config.logMetadata && context.metadata) {
            logData.metadata = this.sanitizeMetadata(context.metadata);
        }
        this.logWithLevel(this.config.logLevel, "Incoming WebSocket message", logData);
    }
    /**
     * Log outgoing WebSocket message
     */
    logOutgoingMessage(context, messageId, processingTime) {
        // Skip excluded message types
        if (this.shouldExcludeMessageType(context.message.type)) {
            return;
        }
        const logData = {
            connectionId: context.connectionId,
            direction: "outgoing",
            messageType: context.message.type,
            messageId,
            timestamp: new Date().toISOString(),
            authenticated: context.authenticated,
            messageSize: this.getMessageSize(context.message),
        };
        // Add optional data based on configuration
        if (this.config.includeUserContext) {
            logData.userId = context.userId;
        }
        if (this.config.includeMessageTiming) {
            logData.processingTime = processingTime;
        }
        if (!this.config.redactPayload && context.message.payload) {
            logData.payload = this.sanitizePayload(context.message.payload);
        }
        this.logWithLevel(this.config.logLevel, "Outgoing WebSocket message", logData);
    }
    /**
     * Log error in WebSocket message processing
     */
    async logErrorMessage(context, messageId, processingTime, error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const logData = {
            connectionId: context.connectionId,
            direction: "incoming",
            messageType: context.message.type,
            messageId,
            timestamp: new Date().toISOString(),
            authenticated: context.authenticated,
            messageSize: this.getMessageSize(context.message),
            processingTime,
            error: errorMessage,
        };
        // Add optional data based on configuration
        if (this.config.includeUserContext) {
            logData.userId = context.userId;
        }
        this.logWithLevel("error", "WebSocket message processing error", logData);
        await this.recordLoggingMetrics("error_logged", {
            messageType: context.message.type,
            connectionId: context.connectionId,
            authenticated: context.authenticated.toString(),
            error_type: error instanceof Error ? error.constructor.name : "unknown",
        });
    }
    /**
     * Generate unique message ID
     */
    generateMessageId() {
        return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    }
    /**
     * Increment message count for connection
     */
    incrementMessageCount(connectionId) {
        const current = this.connectionMessageCounts.get(connectionId) || 0;
        this.connectionMessageCounts.set(connectionId, current + 1);
    }
    /**
     * Check if message type should be excluded from logging
     */
    shouldExcludeMessageType(messageType) {
        return this.config.excludeMessageTypes?.includes(messageType) || false;
    }
    /**
     * Get message size in bytes
     */
    getMessageSize(message) {
        try {
            return JSON.stringify(message).length;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Sanitize query parameters
     */
    sanitizeQuery(query) {
        const sanitized = {};
        const sensitiveFields = this.config.sensitiveFields || [];
        for (const [key, value] of Object.entries(query)) {
            const lowerKey = key.toLowerCase();
            if (sensitiveFields.some((field) => lowerKey.includes(field.toLowerCase()))) {
                sanitized[key] = "[REDACTED]";
            }
            else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    /**
     * Sanitize headers by removing or redacting sensitive ones
     */
    sanitizeHeaders(headers) {
        if (!headers)
            return {};
        const sanitized = {};
        const sensitiveHeaders = [
            "authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
        ];
        for (const [key, value] of Object.entries(headers)) {
            const lowerKey = key.toLowerCase();
            if (sensitiveHeaders.includes(lowerKey)) {
                sanitized[key] = "[REDACTED]";
            }
            else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    /**
     * Sanitize message payload by removing sensitive fields and limiting size
     */
    sanitizePayload(payload) {
        if (!payload)
            return payload;
        try {
            const sanitized = this.deepSanitize(payload, this.config.sensitiveFields || []);
            // Check size limits
            const payloadStr = JSON.stringify(sanitized);
            if (payloadStr.length >
                (this.config.maxMessageSize ||
                    DEFAULT_WEBSOCKET_LOGGING_OPTIONS.MAX_MESSAGE_SIZE)) {
                return `[TRUNCATED - ${payloadStr.length} bytes]`;
            }
            return sanitized;
        }
        catch {
            return "[UNPARSEABLE]";
        }
    }
    /**
     * Sanitize connection metadata
     */
    sanitizeMetadata(metadata) {
        if (!metadata)
            return metadata;
        const sanitized = { ...metadata };
        // Remove sensitive connection details
        delete sanitized.headers?.["authorization"];
        delete sanitized.headers?.["cookie"];
        return sanitized;
    }
    /**
     * Deep sanitize object by removing sensitive fields recursively
     */
    deepSanitize(obj, sensitiveFields) {
        if (typeof obj !== "object" || obj === null) {
            return obj;
        }
        if (Array.isArray(obj)) {
            return obj.map((item) => this.deepSanitize(item, sensitiveFields));
        }
        // Cast to Record<string, unknown> after type check for safe indexing
        const sanitized = {
            ...obj,
        };
        for (const [key, value] of Object.entries(obj)) {
            const lowerKey = key.toLowerCase();
            if (sensitiveFields.some((field) => lowerKey.includes(field.toLowerCase()))) {
                sanitized[key] = "[REDACTED]";
            }
            else {
                sanitized[key] = this.deepSanitize(value, sensitiveFields);
            }
        }
        return sanitized;
    }
    /**
     * Log with specified level
     */
    logWithLevel(level, message, data) {
        const logLevel = level || "info";
        switch (logLevel) {
            case "debug":
                this.logger.debug(message, data);
                break;
            case "info":
                this.logger.info(message, data);
                break;
            case "warn":
                this.logger.warn(message, data);
                break;
            case "error":
                this.logger.error(message, data instanceof Error ? data : new Error(JSON.stringify(data)));
                break;
        }
    }
    /**
     * Record logging-specific metrics
     */
    async recordLoggingMetrics(action, additionalTags = {}) {
        await this.recordMetric(`websocket_logging_${action}`, 1, additionalTags);
    }
    /**
     * Validate configuration on instantiation
     */
    validateConfiguration() {
        const { maxMessageSize, excludeMessageTypes, sensitiveFields, sampleRate, excludePaths, } = this.config;
        if (maxMessageSize !== undefined &&
            (maxMessageSize <= 0 || !Number.isInteger(maxMessageSize))) {
            throw new Error("WebSocket Logging maxMessageSize must be a positive integer");
        }
        if (sampleRate !== undefined && (sampleRate < 0 || sampleRate > 1)) {
            throw new Error("WebSocket Logging sampleRate must be between 0 and 1");
        }
        if (excludePaths?.some((path) => !path.startsWith("/"))) {
            throw new Error("WebSocket Logging excludePaths must start with '/'");
        }
        if (excludeMessageTypes?.some((type) => !type.trim())) {
            throw new Error("WebSocket logging excludeMessageTypes cannot contain empty strings");
        }
        if (sensitiveFields?.some((field) => !field.trim())) {
            throw new Error("WebSocket logging sensitiveFields cannot contain empty strings");
        }
    }
    /**
     * Create development configuration preset
     */
    static createDevelopmentConfig() {
        return {
            name: "websocket-logging-dev",
            logLevel: "debug",
            logIncomingMessages: true,
            logOutgoingMessages: true,
            logConnections: true,
            logDisconnections: true,
            logMetadata: true,
            excludeMessageTypes: ["ping"],
            maxMessageSize: 1024 * 50, // 50KB
            includeMessageTiming: true,
            includeUserContext: true,
            includeConnectionMetrics: true,
            logHeartbeat: true,
            sampleRate: 1.0,
            redactPayload: false,
            enabled: true,
            priority: DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create production configuration preset
     */
    static createProductionConfig() {
        return {
            name: "websocket-logging-prod",
            logLevel: "info",
            logIncomingMessages: true,
            logOutgoingMessages: false,
            logConnections: true,
            logDisconnections: true,
            logMetadata: false,
            excludeMessageTypes: ["ping", "pong", "heartbeat"],
            maxMessageSize: 1024 * 5, // 5KB
            includeMessageTiming: true,
            includeUserContext: true,
            includeConnectionMetrics: true,
            logHeartbeat: false,
            sampleRate: 0.1,
            redactPayload: true,
            enabled: true,
            priority: DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create audit configuration preset
     */
    static createAuditConfig() {
        return {
            name: "websocket-logging-audit",
            logLevel: "info",
            logIncomingMessages: true,
            logOutgoingMessages: true,
            logConnections: true,
            logDisconnections: true,
            logMetadata: true,
            excludeMessageTypes: [],
            maxMessageSize: 1024 * 100, // 100KB
            includeMessageTiming: true,
            includeUserContext: true,
            includeConnectionMetrics: true,
            logHeartbeat: true,
            redactPayload: false,
            enabled: true,
            priority: DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create minimal configuration preset
     */
    static createMinimalConfig() {
        return {
            name: "websocket-logging-minimal",
            logLevel: "warn",
            logIncomingMessages: false,
            logOutgoingMessages: false,
            logMessages: false,
            logConnections: true,
            logDisconnections: true,
            logErrors: true,
            logMetadata: false,
            excludeMessageTypes: ["ping", "pong", "heartbeat", "status", "ack"],
            maxMessageSize: 1024, // 1KB
            includeMessageTiming: false,
            includeUserContext: false,
            includeConnectionMetrics: false,
            logHeartbeat: false,
            redactPayload: true,
            enabled: true,
            priority: DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create performance-focused configuration preset
     */
    static createPerformanceConfig() {
        return {
            name: "websocket-logging-performance",
            logLevel: "info",
            logIncomingMessages: false,
            logOutgoingMessages: false,
            logConnections: true,
            logDisconnections: true,
            logMetadata: false,
            excludeMessageTypes: ["ping", "pong", "heartbeat", "status"],
            maxMessageSize: 512, // 512B
            includeMessageTiming: true,
            includeUserContext: false,
            includeConnectionMetrics: true,
            logHeartbeat: false,
            redactPayload: true,
            enabled: true,
            priority: DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create debug configuration preset
     */
    static createDebugConfig() {
        return {
            name: "websocket-logging-debug",
            logLevel: "debug",
            logIncomingMessages: true,
            logOutgoingMessages: true,
            logConnections: true,
            logDisconnections: true,
            logMetadata: true,
            excludeMessageTypes: [],
            maxMessageSize: 1024 * 200, // 200KB
            includeMessageTiming: true,
            includeUserContext: true,
            includeConnectionMetrics: true,
            logHeartbeat: true,
            redactPayload: false,
            enabled: true,
            priority: DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
        };
    }
    /**
     * Cleanup method for WebSocket logging middleware
     * Clears connection tracking data
     */
    cleanup() {
        this.connectionStartTimes.clear();
        this.connectionMessageCounts.clear();
        this.logger.debug("WebSocket logging middleware cleanup completed", {
            middlewareName: this.config.name,
            clearedConnections: this.connectionStartTimes.size,
        });
    }
}
/**
 * Factory function for WebSocket logging middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export function createLoggingWebSocketMiddleware(metrics, config) {
    return new LoggingWebSocketMiddleware(metrics, config);
}
/**
 * Preset configurations for common WebSocket logging scenarios
 * Immutable configuration objects for different environments
 */
export const WEBSOCKET_LOGGING_PRESETS = {
    development: () => LoggingWebSocketMiddleware.createDevelopmentConfig(),
    production: () => LoggingWebSocketMiddleware.createProductionConfig(),
    audit: () => LoggingWebSocketMiddleware.createAuditConfig(),
    minimal: () => LoggingWebSocketMiddleware.createMinimalConfig(),
    performance: () => LoggingWebSocketMiddleware.createPerformanceConfig(),
    debug: () => LoggingWebSocketMiddleware.createDebugConfig(),
};
//# sourceMappingURL=logging.websocket.middleware.js.map