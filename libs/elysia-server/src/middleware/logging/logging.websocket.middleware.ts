import { type IMetricsCollector } from "@libs/monitoring";
import {
  BaseWebSocketMiddleware,
  type WebSocketMiddlewareConfig,
} from "../base/BaseWebSocketMiddleware";
import type { WebSocketConnectionMetadata, WebSocketContext } from "../types";

/**
 * WebSocket logging middleware configuration interface
 * Extends WebSocketMiddlewareConfig with logging-specific options
 */
export interface LoggingWebSocketMiddlewareConfig
  extends WebSocketMiddlewareConfig {
  readonly logLevel?: "debug" | "info" | "warn" | "error";
  readonly logIncomingMessages?: boolean;
  readonly logOutgoingMessages?: boolean;
  readonly logConnections?: boolean;
  readonly logDisconnections?: boolean;
  readonly logMetadata?: boolean;
  readonly excludeMessageTypes?: readonly string[];
  readonly maxMessageSize?: number;
  readonly sensitiveFields?: readonly string[];
  readonly includeMessageTiming?: boolean;
  readonly includeUserContext?: boolean;
  readonly includeConnectionMetrics?: boolean;
  readonly logHeartbeat?: boolean;
  readonly redactPayload?: boolean;
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
  connectionDuration?: number | undefined; // For disconnect events
  messageCount?: number; // For disconnect events
  reason?: string | undefined; // For disconnect events
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
  payload?: Record<string, unknown> | string | number | boolean | null;
  metadata?: WebSocketConnectionMetadata;
  error?: string;
}

/**
 * Default WebSocket logging configuration constants
 */
const DEFAULT_WEBSOCKET_LOGGING_OPTIONS = {
  LOG_LEVEL: "info" as const,
  LOG_INCOMING_MESSAGES: true,
  LOG_OUTGOING_MESSAGES: false,
  LOG_CONNECTIONS: true,
  LOG_DISCONNECTIONS: true,
  LOG_METADATA: false,
  EXCLUDE_MESSAGE_TYPES: ["ping", "pong", "heartbeat"] as const,
  MAX_MESSAGE_SIZE: 1024 * 5, // 5KB
  SENSITIVE_FIELDS: [
    "password",
    "token",
    "secret",
    "key",
    "auth",
    "jwt",
    "session",
  ] as const,
  INCLUDE_MESSAGE_TIMING: true,
  INCLUDE_USER_CONTEXT: true,
  INCLUDE_CONNECTION_METRICS: true,
  LOG_HEARTBEAT: false,
  REDACT_PAYLOAD: false,
  PRIORITY: 60, // Medium-low priority for logging
} as const;

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
export class LoggingWebSocketMiddleware extends BaseWebSocketMiddleware<LoggingWebSocketMiddlewareConfig> {
  private connectionStartTimes = new Map<string, number>();
  private connectionMessageCounts = new Map<string, number>();

  constructor(
    metrics: IMetricsCollector,
    config: Partial<LoggingWebSocketMiddlewareConfig> = {}
  ) {
    // Create complete configuration with validated defaults
    const completeConfig: LoggingWebSocketMiddlewareConfig = {
      name: config.name || "websocket-logging",
      enabled: config.enabled ?? true,
      priority: config.priority ?? DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
      skipMessageTypes: config.skipMessageTypes || [],
      logLevel: config.logLevel ?? DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_LEVEL,
      logIncomingMessages:
        config.logIncomingMessages ??
        DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_INCOMING_MESSAGES,
      logOutgoingMessages:
        config.logOutgoingMessages ??
        DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_OUTGOING_MESSAGES,
      logConnections:
        config.logConnections ??
        DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_CONNECTIONS,
      logDisconnections:
        config.logDisconnections ??
        DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_DISCONNECTIONS,
      logMetadata:
        config.logMetadata ?? DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_METADATA,
      excludeMessageTypes: config.excludeMessageTypes ?? [
        ...DEFAULT_WEBSOCKET_LOGGING_OPTIONS.EXCLUDE_MESSAGE_TYPES,
      ],
      maxMessageSize:
        config.maxMessageSize ??
        DEFAULT_WEBSOCKET_LOGGING_OPTIONS.MAX_MESSAGE_SIZE,
      sensitiveFields: config.sensitiveFields ?? [
        ...DEFAULT_WEBSOCKET_LOGGING_OPTIONS.SENSITIVE_FIELDS,
      ],
      includeMessageTiming:
        config.includeMessageTiming ??
        DEFAULT_WEBSOCKET_LOGGING_OPTIONS.INCLUDE_MESSAGE_TIMING,
      includeUserContext:
        config.includeUserContext ??
        DEFAULT_WEBSOCKET_LOGGING_OPTIONS.INCLUDE_USER_CONTEXT,
      includeConnectionMetrics:
        config.includeConnectionMetrics ??
        DEFAULT_WEBSOCKET_LOGGING_OPTIONS.INCLUDE_CONNECTION_METRICS,
      logHeartbeat:
        config.logHeartbeat ?? DEFAULT_WEBSOCKET_LOGGING_OPTIONS.LOG_HEARTBEAT,
      redactPayload:
        config.redactPayload ??
        DEFAULT_WEBSOCKET_LOGGING_OPTIONS.REDACT_PAYLOAD,
    };

    super(metrics, completeConfig, completeConfig.name);
    this.validateConfiguration();
  }

  /**
   * Core WebSocket logging middleware execution logic
   * Handles message logging with comprehensive data capture
   */
  protected async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
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
    } catch (error) {
      // Log error message processing
      const processingTime = Date.now() - (Date.now() - startTime);
      await this.logErrorMessage(context, messageId, processingTime, error);
      throw error; // Re-throw to maintain error chain
    } finally {
      const executionTime = performance.now() - startTime;
      await this.recordMetric(
        "websocket_logging_execution_time",
        executionTime,
        {
          messageType: context.message.type,
          connectionId: context.connectionId,
        }
      );
    }
  }

  /**
   * Log WebSocket connection event
   */
  public async logConnection(context: WebSocketContext): Promise<void> {
    if (!this.config.logConnections) {
      return;
    }

    // Track connection start time
    this.connectionStartTimes.set(context.connectionId, Date.now());
    this.connectionMessageCounts.set(context.connectionId, 0);

    const logData: WebSocketConnectionLogData = {
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

    this.logWithLevel(
      this.config.logLevel,
      "WebSocket connection established",
      logData
    );

    await this.recordLoggingMetrics("connection_logged", {
      event: "connect",
      authenticated: context.authenticated.toString(),
      clientIp: context.metadata.clientIp,
    });
  }

  /**
   * Log WebSocket disconnection event
   */
  public async logDisconnection(
    context: WebSocketContext,
    reason?: string
  ): Promise<void> {
    if (!this.config.logDisconnections) {
      return;
    }

    const connectionStartTime = this.connectionStartTimes.get(
      context.connectionId
    );
    const messageCount =
      this.connectionMessageCounts.get(context.connectionId) || 0;
    const connectionDuration = connectionStartTime
      ? Date.now() - connectionStartTime
      : undefined;

    const logData: WebSocketConnectionLogData = {
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

    this.logWithLevel(
      this.config.logLevel,
      "WebSocket connection closed",
      logData
    );

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
  private logIncomingMessage(
    context: WebSocketContext,
    messageId: string
  ): void {
    // Skip excluded message types
    if (this.shouldExcludeMessageType(context.message.type)) {
      return;
    }

    const logData: WebSocketMessageLogData = {
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

    this.logWithLevel(
      this.config.logLevel,
      "Incoming WebSocket message",
      logData
    );
  }

  /**
   * Log outgoing WebSocket message
   */
  private logOutgoingMessage(
    context: WebSocketContext,
    messageId: string,
    processingTime: number
  ): void {
    // Skip excluded message types
    if (this.shouldExcludeMessageType(context.message.type)) {
      return;
    }

    const logData: WebSocketMessageLogData = {
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

    this.logWithLevel(
      this.config.logLevel,
      "Outgoing WebSocket message",
      logData
    );
  }

  /**
   * Log error in WebSocket message processing
   */
  private async logErrorMessage(
    context: WebSocketContext,
    messageId: string,
    processingTime: number,
    error: unknown
  ): Promise<void> {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    const logData: WebSocketMessageLogData = {
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
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Increment message count for connection
   */
  private incrementMessageCount(connectionId: string): void {
    const current = this.connectionMessageCounts.get(connectionId) || 0;
    this.connectionMessageCounts.set(connectionId, current + 1);
  }

  /**
   * Check if message type should be excluded from logging
   */
  private shouldExcludeMessageType(messageType: string): boolean {
    return this.config.excludeMessageTypes?.includes(messageType) || false;
  }

  /**
   * Get message size in bytes
   */
  private getMessageSize(message: unknown): number | undefined {
    try {
      return JSON.stringify(message).length;
    } catch {
      return undefined;
    }
  }

  /**
   * Sanitize query parameters
   */
  private sanitizeQuery(query: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const sensitiveFields = this.config.sensitiveFields || [];

    for (const [key, value] of Object.entries(query)) {
      const lowerKey = key.toLowerCase();

      if (
        sensitiveFields.some((field) => lowerKey.includes(field.toLowerCase()))
      ) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize headers by removing or redacting sensitive ones
   */
  private sanitizeHeaders(
    headers: Record<string, string>
  ): Record<string, string> {
    if (!headers) return {};

    const sanitized: Record<string, string> = {};
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
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize message payload by removing sensitive fields and limiting size
   */
  private sanitizePayload<T>(payload: T): T | string {
    if (!payload) return payload;

    try {
      const sanitized = this.deepSanitize(
        payload,
        this.config.sensitiveFields || []
      ) as T;

      // Check size limits
      const payloadStr = JSON.stringify(sanitized);
      if (
        payloadStr.length >
        (this.config.maxMessageSize ||
          DEFAULT_WEBSOCKET_LOGGING_OPTIONS.MAX_MESSAGE_SIZE)
      ) {
        return `[TRUNCATED - ${payloadStr.length} bytes]`;
      }

      return sanitized;
    } catch {
      return "[UNPARSEABLE]";
    }
  }

  /**
   * Sanitize connection metadata
   */
  private sanitizeMetadata(
    metadata: WebSocketConnectionMetadata
  ): WebSocketConnectionMetadata {
    if (!metadata) return metadata;

    const sanitized = { ...metadata };

    // Remove sensitive connection details
    delete sanitized.headers?.["authorization"];
    delete sanitized.headers?.["cookie"];

    return sanitized;
  }

  /**
   * Deep sanitize object by removing sensitive fields recursively
   */
  private deepSanitize(
    obj: unknown,
    sensitiveFields: readonly string[]
  ): unknown {
    if (typeof obj !== "object" || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepSanitize(item, sensitiveFields));
    }

    // Cast to Record<string, unknown> after type check for safe indexing
    const sanitized: Record<string, unknown> = {
      ...(obj as Record<string, unknown>),
    };

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      if (
        sensitiveFields.some((field) => lowerKey.includes(field.toLowerCase()))
      ) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = this.deepSanitize(value, sensitiveFields);
      }
    }

    return sanitized;
  }

  /**
   * Log with specified level
   */
  private logWithLevel(
    level: "debug" | "info" | "warn" | "error" | undefined,
    message: string,
    data: unknown
  ): void {
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
        this.logger.error(
          message,
          data instanceof Error ? data : new Error(JSON.stringify(data))
        );
        break;
    }
  }

  /**
   * Record logging-specific metrics
   */
  private async recordLoggingMetrics(
    action: string,
    additionalTags: Record<string, string> = {}
  ): Promise<void> {
    await this.recordMetric(`websocket_logging_${action}`, 1, additionalTags);
  }

  /**
   * Validate configuration on instantiation
   */
  private validateConfiguration(): void {
    const { maxMessageSize, excludeMessageTypes, sensitiveFields } =
      this.config;

    if (
      maxMessageSize !== undefined &&
      (maxMessageSize < 0 || !Number.isInteger(maxMessageSize))
    ) {
      throw new Error(
        "WebSocket logging maxMessageSize must be a non-negative integer"
      );
    }

    if (excludeMessageTypes?.some((type) => !type.trim())) {
      throw new Error(
        "WebSocket logging excludeMessageTypes cannot contain empty strings"
      );
    }

    if (sensitiveFields?.some((field) => !field.trim())) {
      throw new Error(
        "WebSocket logging sensitiveFields cannot contain empty strings"
      );
    }
  }

  /**
   * Create development configuration preset
   */
  static createDevelopmentConfig(): Partial<LoggingWebSocketMiddlewareConfig> {
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
      redactPayload: false,
      enabled: true,
      priority: DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create production configuration preset
   */
  static createProductionConfig(): Partial<LoggingWebSocketMiddlewareConfig> {
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
      redactPayload: true,
      enabled: true,
      priority: DEFAULT_WEBSOCKET_LOGGING_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create audit configuration preset
   */
  static createAuditConfig(): Partial<LoggingWebSocketMiddlewareConfig> {
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
  static createMinimalConfig(): Partial<LoggingWebSocketMiddlewareConfig> {
    return {
      name: "websocket-logging-minimal",
      logLevel: "warn",
      logIncomingMessages: false,
      logOutgoingMessages: false,
      logConnections: true,
      logDisconnections: true,
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
  static createPerformanceConfig(): Partial<LoggingWebSocketMiddlewareConfig> {
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
  static createDebugConfig(): Partial<LoggingWebSocketMiddlewareConfig> {
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
  public override cleanup(): void {
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
export function createLoggingWebSocketMiddleware(
  metrics: IMetricsCollector,
  config?: Partial<LoggingWebSocketMiddlewareConfig>
): LoggingWebSocketMiddleware {
  return new LoggingWebSocketMiddleware(metrics, config);
}

/**
 * Preset configurations for common WebSocket logging scenarios
 * Immutable configuration objects for different environments
 */
export const WEBSOCKET_LOGGING_PRESETS = {
  development: (): Partial<LoggingWebSocketMiddlewareConfig> =>
    LoggingWebSocketMiddleware.createDevelopmentConfig(),

  production: (): Partial<LoggingWebSocketMiddlewareConfig> =>
    LoggingWebSocketMiddleware.createProductionConfig(),

  audit: (): Partial<LoggingWebSocketMiddlewareConfig> =>
    LoggingWebSocketMiddleware.createAuditConfig(),

  minimal: (): Partial<LoggingWebSocketMiddlewareConfig> =>
    LoggingWebSocketMiddleware.createMinimalConfig(),

  performance: (): Partial<LoggingWebSocketMiddlewareConfig> =>
    LoggingWebSocketMiddleware.createPerformanceConfig(),

  debug: (): Partial<LoggingWebSocketMiddlewareConfig> =>
    LoggingWebSocketMiddleware.createDebugConfig(),
} as const;
