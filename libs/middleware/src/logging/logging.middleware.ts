import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base";
import type { MiddlewareContext } from "../types";

/**
 * Logging middleware configuration interface
 * Extends HttpMiddlewareConfig with logging-specific options
 */
export interface LoggingConfig extends HttpMiddlewareConfig {
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
  headers?: Record<string, any>;
  body?: any;
  query?: Record<string, any>;
  params?: Record<string, any>;
}

/**
 * Response log data structure
 */
export interface ResponseLogData {
  readonly requestId: string;
  readonly statusCode?: number;
  readonly responseTime: number;
  contentLength?: number | undefined;
  headers?: Record<string, any>;
  body?: any;
  error?: string;
}

/**
 * Default logging configuration constants
 */
const DEFAULT_LOGGING_OPTIONS = {
  LOG_LEVEL: "info" as const,
  LOG_REQUEST_BODY: false,
  LOG_RESPONSE_BODY: false,
  LOG_HEADERS: false,
  EXCLUDE_PATHS: ["/health", "/favicon.ico", "/metrics"] as const,
  EXCLUDE_HEADERS: [
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
  ] as const,
  MAX_BODY_SIZE: 1024 * 10, // 10KB
  SENSITIVE_FIELDS: [
    "password",
    "token",
    "secret",
    "key",
    "auth",
    "jwt",
  ] as const,
  INCLUDE_REQUEST_TIMING: true,
  INCLUDE_USER_AGENT: true,
  INCLUDE_CLIENT_IP: true,
  PRIORITY: 50, // Medium priority for logging
} as const;

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
 * @template LoggingConfig - Logging-specific configuration
 */
export class LoggingMiddleware extends BaseMiddleware<LoggingConfig> {
  constructor(metrics: IMetricsCollector, config: Partial<LoggingConfig> = {}) {
    // Create complete configuration with validated defaults
    const completeConfig: LoggingConfig = {
      name: config.name || "logging",
      enabled: config.enabled ?? true,
      priority: config.priority ?? DEFAULT_LOGGING_OPTIONS.PRIORITY,
      skipPaths: config.skipPaths || [],
      logLevel: config.logLevel ?? DEFAULT_LOGGING_OPTIONS.LOG_LEVEL,
      logRequestBody:
        config.logRequestBody ?? DEFAULT_LOGGING_OPTIONS.LOG_REQUEST_BODY,
      logResponseBody:
        config.logResponseBody ?? DEFAULT_LOGGING_OPTIONS.LOG_RESPONSE_BODY,
      logHeaders: config.logHeaders ?? DEFAULT_LOGGING_OPTIONS.LOG_HEADERS,
      excludePaths: config.excludePaths ?? [
        ...DEFAULT_LOGGING_OPTIONS.EXCLUDE_PATHS,
      ],
      excludeHeaders: config.excludeHeaders ?? [
        ...DEFAULT_LOGGING_OPTIONS.EXCLUDE_HEADERS,
      ],
      maxBodySize: config.maxBodySize ?? DEFAULT_LOGGING_OPTIONS.MAX_BODY_SIZE,
      sensitiveFields: config.sensitiveFields ?? [
        ...DEFAULT_LOGGING_OPTIONS.SENSITIVE_FIELDS,
      ],
      includeRequestTiming:
        config.includeRequestTiming ??
        DEFAULT_LOGGING_OPTIONS.INCLUDE_REQUEST_TIMING,
      includeUserAgent:
        config.includeUserAgent ?? DEFAULT_LOGGING_OPTIONS.INCLUDE_USER_AGENT,
      includeClientIp:
        config.includeClientIp ?? DEFAULT_LOGGING_OPTIONS.INCLUDE_CLIENT_IP,
    };

    super(metrics, completeConfig, completeConfig.name);
    this.validateConfiguration();
  }

  /**
   * Core logging middleware execution logic
   * Handles request and response logging with comprehensive data capture
   */
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    // Add request ID to context for correlation
    context.request.headers = context.request.headers || {};
    context.request.headers["x-request-id"] = requestId;

    try {
      // Log incoming request
      await this.logRequest(context, requestId);

      // Store start time for response timing
      const requestStartTime = Date.now();
      (context.request as any).startTime = requestStartTime;

      // Continue to next middleware
      await next();

      // Log successful response
      const responseTime = Date.now() - requestStartTime;
      await this.logResponse(context, requestId, responseTime);

      // Record successful logging metrics
      await this.recordLoggingMetrics("request_logged", {
        method: context.request.method,
        status: context.set.status?.toString() || "200",
        path: this.extractPath(context),
      });
    } catch (error) {
      // Log error response
      const requestStartTime = (context.request as any).startTime || Date.now();
      const responseTime = Date.now() - requestStartTime;
      await this.logErrorResponse(context, requestId, responseTime, error);
      throw error; // Re-throw to maintain error chain
    } finally {
      const executionTime = performance.now() - startTime;
      await this.recordMetric("logging_execution_time", executionTime, {
        method: context.request.method,
        path: this.extractPath(context),
      });
    }
  }

  /**
   * Log incoming request with comprehensive data capture
   */
  private async logRequest(
    context: MiddlewareContext,
    requestId: string
  ): Promise<void> {
    const path = this.extractPath(context);

    // Skip logging for excluded paths
    if (this.shouldExcludePath(path)) {
      return;
    }

    const logData: RequestLogData = {
      requestId,
      method: context.request.method,
      url: this.sanitizeUrl(context.request.url || path),
      timestamp: new Date().toISOString(),
    };

    // Add optional data based on configuration
    if (this.config.includeUserAgent) {
      logData.userAgent = this.extractUserAgent(context);
    }

    if (this.config.includeClientIp) {
      logData.ip = this.extractClientIp(context);
    }

    if (this.config.logHeaders) {
      logData.headers = this.sanitizeHeaders(context.request.headers);
    }

    if (this.config.logRequestBody && context.request.body) {
      logData.body = this.sanitizeBody(context.request.body);
    }

    // Add query and params if available
    if (context["query"] && Object.keys(context["query"]).length > 0) {
      logData.query = this.sanitizeQuery(context["query"]);
    }

    if (context["params"] && Object.keys(context["params"]).length > 0) {
      logData.params = context["params"];
    }

    this.logWithLevel(this.config.logLevel, "Incoming request", logData);
  }

  /**
   * Log successful response
   */
  private async logResponse(
    context: MiddlewareContext,
    requestId: string,
    responseTime: number
  ): Promise<void> {
    const path = this.extractPath(context);

    // Skip logging for excluded paths
    if (this.shouldExcludePath(path)) {
      return;
    }

    const statusCode = context.set.status || 200;
    const logData: ResponseLogData = {
      requestId,
      statusCode,
      responseTime,
      contentLength: this.getContentLength(context),
    };

    // Add optional data based on configuration
    if (this.config.logHeaders && context.set.headers) {
      logData.headers = this.sanitizeHeaders(context.set.headers);
    }

    if (this.config.logResponseBody && (context.set as any).body) {
      logData.body = this.sanitizeBody((context.set as any).body);
    }

    // Determine log level based on status code
    const logLevel = this.getLogLevelForStatus(statusCode);
    this.logWithLevel(logLevel, "Outgoing response", logData);
  }

  /**
   * Log error response
   */
  private async logErrorResponse(
    context: MiddlewareContext,
    requestId: string,
    responseTime: number,
    error: unknown
  ): Promise<void> {
    const path = this.extractPath(context);

    // Always log errors, even for excluded paths
    const statusCode = context.set.status || 500;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    const logData: ResponseLogData = {
      requestId,
      statusCode,
      responseTime,
      error: errorMessage,
      contentLength: this.getContentLength(context),
    };

    // Add headers for error diagnosis
    if (context.set.headers) {
      logData.headers = this.sanitizeHeaders(context.set.headers);
    }

    this.logWithLevel("error", "Error response", logData);

    await this.recordLoggingMetrics("error_logged", {
      method: context.request.method,
      status: statusCode.toString(),
      path,
      error_type: error instanceof Error ? error.constructor.name : "unknown",
    });
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Extract path from request context
   */
  private extractPath(context: MiddlewareContext): string {
    if (context.request.url) {
      try {
        const url = new URL(context.request.url, "http://localhost");
        return url.pathname;
      } catch {
        return context.request.url;
      }
    }
    return "/";
  }

  /**
   * Extract user agent from request headers
   */
  private extractUserAgent(context: MiddlewareContext): string | undefined {
    return context.request.headers?.["user-agent"];
  }

  /**
   * Extract client IP address from request
   */
  private extractClientIp(context: MiddlewareContext): string | undefined {
    const headers = context.request.headers || {};

    // Check for forwarded headers
    const forwardedFor = headers["x-forwarded-for"];
    if (forwardedFor) {
      const firstIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor;
      return firstIp ? firstIp.split(",")[0].trim() : undefined;
    }

    const realIp = headers["x-real-ip"];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    // Fallback to extracting IP from context
    return (context.request as any).ip || "127.0.0.1";
  }

  /**
   * Check if path should be excluded from logging
   */
  private shouldExcludePath(path: string): boolean {
    return (
      this.config.excludePaths?.some(
        (excludePath) => path === excludePath || path.startsWith(excludePath)
      ) || false
    );
  }

  /**
   * Sanitize URL to remove sensitive query parameters
   */
  private sanitizeUrl(url: string): string {
    try {
      const urlObj = new URL(url, "http://localhost");
      const sensitiveParams = this.config.sensitiveFields || [];

      for (const param of sensitiveParams) {
        if (urlObj.searchParams.has(param)) {
          urlObj.searchParams.set(param, "[REDACTED]");
        }
      }

      return urlObj.pathname + urlObj.search;
    } catch {
      return url;
    }
  }

  /**
   * Sanitize headers by removing or redacting sensitive ones
   */
  private sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    if (!headers) return {};

    const sanitized: Record<string, any> = {};
    const excludeHeaders = this.config.excludeHeaders || [];

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();

      if (excludeHeaders.includes(lowerKey)) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = Array.isArray(value) ? value[0] : value;
      }
    }

    return sanitized;
  }

  /**
   * Sanitize query parameters
   */
  private sanitizeQuery(query: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
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
   * Sanitize body by removing sensitive fields and limiting size
   */
  private sanitizeBody(body: any): any {
    if (!body) return body;

    try {
      let sanitized = this.deepSanitize(
        body,
        this.config.sensitiveFields || []
      );

      // Check size limits
      const bodyStr = JSON.stringify(sanitized);
      if (
        bodyStr.length >
        (this.config.maxBodySize || DEFAULT_LOGGING_OPTIONS.MAX_BODY_SIZE)
      ) {
        return `[TRUNCATED - ${bodyStr.length} bytes]`;
      }

      return sanitized;
    } catch {
      return "[UNPARSEABLE]";
    }
  }

  /**
   * Deep sanitize object by removing sensitive fields recursively
   */
  private deepSanitize(obj: any, sensitiveFields: readonly string[]): any {
    if (typeof obj !== "object" || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepSanitize(item, sensitiveFields));
    }

    const sanitized: any = {};

    for (const [key, value] of Object.entries(obj)) {
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
   * Get content length from response context
   */
  private getContentLength(context: MiddlewareContext): number | undefined {
    const headers = context.set.headers;
    if (headers?.["content-length"]) {
      const length = Array.isArray(headers["content-length"])
        ? headers["content-length"][0]
        : headers["content-length"];
      return parseInt(length as string, 10);
    }

    if ((context.set as any).body) {
      try {
        return JSON.stringify((context.set as any).body).length;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Get appropriate log level based on HTTP status code
   */
  private getLogLevelForStatus(
    statusCode: number
  ): "debug" | "info" | "warn" | "error" {
    if (statusCode >= 500) return "error";
    if (statusCode >= 400) return "warn";
    if (statusCode >= 300) return "info";
    return this.config.logLevel || "info";
  }

  /**
   * Log with specified level
   */
  private logWithLevel(
    level: "debug" | "info" | "warn" | "error" | undefined,
    message: string,
    data: any
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
    await this.recordMetric(`logging_${action}`, 1, additionalTags);
  }

  /**
   * Validate configuration on instantiation
   */
  private validateConfiguration(): void {
    const { maxBodySize, excludePaths, excludeHeaders, sensitiveFields } =
      this.config;

    if (
      maxBodySize !== undefined &&
      (maxBodySize < 0 || !Number.isInteger(maxBodySize))
    ) {
      throw new Error("Logging maxBodySize must be a non-negative integer");
    }

    if (excludePaths && excludePaths.some((path) => !path.startsWith("/"))) {
      throw new Error("Logging excludePaths must start with '/'");
    }

    if (excludeHeaders && excludeHeaders.some((header) => !header.trim())) {
      throw new Error("Logging excludeHeaders cannot contain empty strings");
    }

    if (sensitiveFields && sensitiveFields.some((field) => !field.trim())) {
      throw new Error("Logging sensitiveFields cannot contain empty strings");
    }
  }

  /**
   * Create development configuration preset
   */
  static createDevelopmentConfig(): Partial<LoggingConfig> {
    return {
      name: "logging-dev",
      logLevel: "debug",
      logRequestBody: true,
      logResponseBody: true,
      logHeaders: true,
      excludePaths: ["/health"],
      maxBodySize: 1024 * 50, // 50KB
      includeRequestTiming: true,
      includeUserAgent: true,
      includeClientIp: true,
      enabled: true,
      priority: DEFAULT_LOGGING_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create production configuration preset
   */
  static createProductionConfig(): Partial<LoggingConfig> {
    return {
      name: "logging-prod",
      logLevel: "info",
      logRequestBody: false,
      logResponseBody: false,
      logHeaders: false,
      excludePaths: ["/health", "/metrics", "/favicon.ico"],
      maxBodySize: 1024 * 5, // 5KB
      includeRequestTiming: true,
      includeUserAgent: false,
      includeClientIp: true,
      enabled: true,
      priority: DEFAULT_LOGGING_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create audit configuration preset
   */
  static createAuditConfig(): Partial<LoggingConfig> {
    return {
      name: "logging-audit",
      logLevel: "info",
      logRequestBody: true,
      logResponseBody: true,
      logHeaders: true,
      excludePaths: [],
      maxBodySize: 1024 * 100, // 100KB
      includeRequestTiming: true,
      includeUserAgent: true,
      includeClientIp: true,
      enabled: true,
      priority: DEFAULT_LOGGING_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create minimal configuration preset
   */
  static createMinimalConfig(): Partial<LoggingConfig> {
    return {
      name: "logging-minimal",
      logLevel: "warn",
      logRequestBody: false,
      logResponseBody: false,
      logHeaders: false,
      excludePaths: ["/health", "/metrics", "/favicon.ico", "/static"],
      maxBodySize: 1024, // 1KB
      includeRequestTiming: false,
      includeUserAgent: false,
      includeClientIp: false,
      enabled: true,
      priority: DEFAULT_LOGGING_OPTIONS.PRIORITY,
    };
  }
}

/**
 * Factory function for logging middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export function createLoggingMiddleware(
  metrics: IMetricsCollector,
  config?: Partial<LoggingConfig>
): LoggingMiddleware {
  return new LoggingMiddleware(metrics, config);
}

/**
 * Preset configurations for common logging scenarios
 * Immutable configuration objects for different environments
 */
export const LOGGING_PRESETS = {
  development: (): Partial<LoggingConfig> =>
    LoggingMiddleware.createDevelopmentConfig(),

  production: (): Partial<LoggingConfig> =>
    LoggingMiddleware.createProductionConfig(),

  audit: (): Partial<LoggingConfig> => LoggingMiddleware.createAuditConfig(),

  minimal: (): Partial<LoggingConfig> =>
    LoggingMiddleware.createMinimalConfig(),

  debug: (): Partial<LoggingConfig> => ({
    name: "logging-debug",
    logLevel: "debug",
    logRequestBody: true,
    logResponseBody: true,
    logHeaders: true,
    excludePaths: [],
    maxBodySize: 1024 * 200, // 200KB
    includeRequestTiming: true,
    includeUserAgent: true,
    includeClientIp: true,
    enabled: true,
    priority: DEFAULT_LOGGING_OPTIONS.PRIORITY,
  }),

  performance: (): Partial<LoggingConfig> => ({
    name: "logging-performance",
    logLevel: "info",
    logRequestBody: false,
    logResponseBody: false,
    logHeaders: false,
    excludePaths: ["/health", "/metrics"],
    includeRequestTiming: true,
    includeUserAgent: false,
    includeClientIp: false,
    enabled: true,
    priority: DEFAULT_LOGGING_OPTIONS.PRIORITY,
  }),
} as const;
