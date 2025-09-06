import { BaseMiddleware } from "../base";
import type { MiddlewareContext, MiddlewareOptions } from "../types";
import { generateUUId, inject } from "@libs/utils";
import type { Elysia } from "@libs/elysia-server";

export interface LoggingConfig extends MiddlewareOptions {
  logLevel: "debug" | "info" | "warn" | "error";
  logRequestBody?: boolean;
  logResponseBody?: boolean;
  logHeaders?: boolean;
  excludePaths?: string[];
  excludeHeaders?: string[];
  maxBodySize?: number;
  sensitiveFields?: string[];
}

export interface RequestLogData {
  requestId: string;
  method: string;
  url: string;
  userAgent?: string;
  ip: string;
  timestamp: string;
  headers?: Record<string, any>;
  body?: any;
  query?: Record<string, any>;
  params?: Record<string, any>;
}

export interface ResponseLogData {
  requestId: string;
  statusCode?: number | undefined;
  responseTime: number;
  contentLength?: number | undefined;
  headers?: Record<string, any> | undefined;
  body?: any;
  error?: string | undefined;
}

/**
 * Unified Logging Middleware
 * Provides comprehensive request/response logging with configurable options
 * Framework-agnostic implementation for consistent logging across all services
 */
export class LoggingMiddleware extends BaseMiddleware<LoggingConfig> {
  private readonly defaultConfig: LoggingConfig = {
    logLevel: "info",
    logRequestBody: false,
    logResponseBody: false,
    logHeaders: false,
    excludePaths: ["/health", "/favicon.ico"],
    excludeHeaders: ["authorization", "cookie", "set-cookie"],
    maxBodySize: 1024 * 10, // 10KB
    sensitiveFields: ["password", "token", "secret", "key", "auth"],
  };

  constructor(
    @inject("Logger") protected override readonly logger: ILogger,
    @inject("IMetricsCollector") protected override readonly metrics: any,
    config: LoggingConfig
  ) {
    super(logger, metrics, config, "LoggingMiddleware");
  }

  override execute(
    _context: MiddlewareContext,
    _next: () => Promise<void>
  ): Promise<void | any> {
    throw new Error("Method not implemented.");
  }

  /**
   * Create Elysia middleware for logging
   */
  override elysia(config?: Partial<LoggingConfig>): (app: Elysia) => Elysia {
    const finalConfig = { ...this.defaultConfig, ...config };

    return (app: Elysia): Elysia => {
      return app
        .onBeforeHandle(async (context: any) => {
          await this.logRequest(context.request, finalConfig);
          context.request.startTime = Date.now();
          return context;
        })
        .onAfterHandle(async (context: any) => {
          await this.logResponse(
            context.request,
            context.response,
            finalConfig
          );
          return context;
        });
    };
  }

  /**
   * Log incoming request
   */
  async logRequest(
    request: any,
    config?: Partial<LoggingConfig>
  ): Promise<any> {
    try {
      const finalConfig = { ...this.defaultConfig, ...config };
      const requestId = this.generateRequestId();

      // Add request ID to request for tracking
      request.requestId = requestId;
      request.startTime = Date.now();

      // Check if path should be excluded
      const path = this.extractPath(request);
      if (this.shouldExcludePath(path, finalConfig.excludePaths || [])) {
        return request;
      }

      const logData: RequestLogData = {
        requestId,
        method: request.method || "UNKNOWN",
        url: this.sanitizeUrl(request.url || path),
        userAgent: request.headers?.["user-agent"],
        ip: this.extractIP(request),
        timestamp: new Date().toISOString(),
        query: request.query,
        params: request.params,
      };

      // Add headers if configured
      if (finalConfig.logHeaders) {
        logData.headers = this.sanitizeHeaders(
          request.headers,
          finalConfig.excludeHeaders || []
        );
      }

      // Add body if configured
      if (finalConfig.logRequestBody && request.body) {
        logData.body = this.sanitizeBody(
          request.body,
          finalConfig.sensitiveFields || [],
          finalConfig.maxBodySize || 1024
        );
      }

      this.logWithLevel(finalConfig.logLevel, "Incoming request", logData);

      return request;
    } catch (error) {
      this.logger.error("Request logging error", error as Error);
      return request;
    }
  }

  /**
   * Log outgoing response
   */
  async logResponse(
    request: any,
    response: any,
    config?: Partial<LoggingConfig>
  ): Promise<any> {
    try {
      const finalConfig = { ...this.defaultConfig, ...config };
      const requestId = request.requestId || "unknown";
      const responseTime = request.startTime
        ? Date.now() - request.startTime
        : 0;

      // Check if path should be excluded
      const path = this.extractPath(request);
      if (this.shouldExcludePath(path, finalConfig.excludePaths || [])) {
        return response;
      }

      const logData: ResponseLogData = {
        requestId,
        statusCode: response.statusCode || response.status,
        responseTime,
        contentLength: this.getContentLength(response),
      };

      // Add headers if configured
      if (finalConfig.logHeaders) {
        logData.headers = this.sanitizeHeaders(
          response.headers,
          finalConfig.excludeHeaders || []
        );
      }

      // Add body if configured
      if (finalConfig.logResponseBody && response.body) {
        logData.body = this.sanitizeBody(
          response.body,
          finalConfig.sensitiveFields || [],
          finalConfig.maxBodySize || 1024
        );
      }

      // Add error if present
      if (response.error) {
        logData.error =
          typeof response.error === "string"
            ? response.error
            : response.error.message || "Unknown error";
      }

      // Log with appropriate level based on status code
      const logLevel = this.getLogLevelForStatus(
        response.statusCode || response.status,
        finalConfig.logLevel
      );

      this.logWithLevel(logLevel, "Outgoing response", logData);

      return response;
    } catch (error) {
      this.logger.error("Response logging error", error as Error);
      return response;
    }
  }

  /**
   * Log general request processing
   */
  async log(request: any, message: string, data?: any): Promise<any> {
    try {
      const requestId = request.requestId || "unknown";

      this.logger.info(message, {
        requestId,
        timestamp: new Date().toISOString(),
        ...data,
      });

      return request;
    } catch (error) {
      this.logger.error("General logging error", error as Error);
      return request;
    }
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return generateUUId("req");
  }

  /**
   * Extract path from request
   */
  private extractPath(request: any): string {
    if (request.path) return request.path;
    if (request.url) {
      try {
        const url = new URL(request.url, "http://localhost");
        return url.pathname;
      } catch {
        return request.url;
      }
    }
    return "/";
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
   * Check if path should be excluded from logging
   */
  private shouldExcludePath(path: string, excludePaths: string[]): boolean {
    return excludePaths.some(
      (excludePath) => path === excludePath || path.startsWith(excludePath)
    );
  }

  /**
   * Sanitize URL to remove sensitive query parameters
   */
  private sanitizeUrl(url: string): string {
    try {
      const urlObj = new URL(url, "http://localhost");
      const sensitiveParams = ["token", "key", "secret", "password", "auth"];

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
   * Sanitize headers by removing sensitive ones
   */
  private sanitizeHeaders(
    headers: Record<string, any>,
    excludeHeaders: string[]
  ): Record<string, any> {
    if (!headers) return {};

    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();

      if (excludeHeaders.includes(lowerKey)) {
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
  private sanitizeBody(
    body: any,
    sensitiveFields: string[],
    maxSize: number
  ): any {
    if (!body) return body;

    try {
      let sanitized = this.deepSanitize(body, sensitiveFields);

      // Convert to string to check size
      const bodyStr = JSON.stringify(sanitized);

      if (bodyStr.length > maxSize) {
        return `[TRUNCATED - ${bodyStr.length} bytes]`;
      }

      return sanitized;
    } catch {
      return "[UNPARSEABLE]";
    }
  }

  /**
   * Deep sanitize object by removing sensitive fields
   */
  private deepSanitize(obj: any, sensitiveFields: string[]): any {
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
   * Get content length from response
   */
  private getContentLength(response: any): number | undefined {
    if (response.headers?.["content-length"]) {
      return parseInt(response.headers["content-length"], 10);
    }

    if (response.body) {
      try {
        return JSON.stringify(response.body).length;
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
    statusCode: number | undefined,
    defaultLevel: string
  ): "debug" | "info" | "warn" | "error" {
    if (!statusCode) return defaultLevel as any;

    if (statusCode >= 500) return "error";
    if (statusCode >= 400) return "warn";
    if (statusCode >= 300) return "info";
    return "info";
  }

  /**
   * Log with specified level
   */
  private logWithLevel(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    data: any
  ): void {
    switch (level) {
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
        this.logger.error(message, new Error(JSON.stringify(data)));
        break;
    }
  }

  /**
   * Create preset configurations for different environments
   */
  static createDevelopmentConfig(): LoggingConfig {
    return {
      logLevel: "debug",
      logRequestBody: true,
      logResponseBody: true,
      logHeaders: true,
      excludePaths: ["/health"],
      maxBodySize: 1024 * 50, // 50KB
    };
  }

  static createProductionConfig(): LoggingConfig {
    return {
      logLevel: "info",
      logRequestBody: false,
      logResponseBody: false,
      logHeaders: false,
      excludePaths: ["/health", "/metrics", "/favicon.ico"],
      maxBodySize: 1024 * 5, // 5KB
    };
  }

  static createAuditConfig(): LoggingConfig {
    return {
      logLevel: "info",
      logRequestBody: true,
      logResponseBody: true,
      logHeaders: true,
      excludePaths: [],
      maxBodySize: 1024 * 100, // 100KB
    };
  }

  static createMinimalConfig(): LoggingConfig {
    return {
      logLevel: "warn",
      logRequestBody: false,
      logResponseBody: false,
      logHeaders: false,
      excludePaths: ["/health", "/metrics", "/favicon.ico", "/static"],
      maxBodySize: 1024, // 1KB
    };
  }
}
