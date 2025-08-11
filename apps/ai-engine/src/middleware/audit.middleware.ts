import { Context } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";

interface AuditEvent {
  eventId: string;
  timestamp: string;
  userId?: string;
  apiKey?: string;
  action: string;
  resource: string;
  method: string;
  path: string;
  statusCode?: number;
  duration?: number;
  requestSize?: number;
  responseSize?: number;
  clientIp: string;
  userAgent?: string;
  requestId?: string;
  sessionId?: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

interface AuditConfig {
  enableDetailedLogging: boolean;
  logRequestBodies: boolean;
  logResponseBodies: boolean;
  maxEventHistory: number;
  sensitiveFields: string[];
  skipPaths: string[];
}

/**
 * Audit Middleware for AI Engine
 * Comprehensive logging and monitoring of all API interactions
 */
export class AuditMiddleware {
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly config: AuditConfig;

  // In-memory audit trail (in production, this would go to a database)
  private auditTrail: AuditEvent[] = [];

  private readonly defaultConfig: AuditConfig = {
    enableDetailedLogging: true,
    logRequestBodies: false, // Be careful with sensitive data
    logResponseBodies: false,
    maxEventHistory: 10000,
    sensitiveFields: ["password", "token", "secret", "key", "authorization"],
    skipPaths: ["/health", "/metrics", "/favicon.ico"],
  };

  constructor(
    logger: Logger,
    metrics: MetricsCollector,
    config?: Partial<AuditConfig>
  ) {
    this.logger = logger;
    this.metrics = metrics;
    this.config = { ...this.defaultConfig, ...config };

    this.logger.info("Audit Middleware initialized", {
      detailedLogging: this.config.enableDetailedLogging,
      maxEventHistory: this.config.maxEventHistory,
      skipPaths: this.config.skipPaths.length,
    });
  }

  /**
   * Pre-request audit hook
   */
  auditPreRequest = async (context: Context): Promise<void> => {
    const startTime = performance.now();

    try {
      // Skip auditing for certain paths
      if (this.shouldSkipAudit(context.path)) {
        return;
      }

      // Generate request ID if not present
      const requestId = this.generateRequestId();
      (context as any).requestId = requestId;
      (context as any).auditStartTime = startTime;

      // Log request start
      await this.logRequestStart(context, requestId, startTime);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("audit_pre_request_duration", duration);
    } catch (error) {
      this.logger.error("Audit pre-request failed", error as Error, {
        path: context.path,
      });
      // Don't throw - audit failures shouldn't break the request
    }
  };

  /**
   * Post-request audit hook
   */
  auditPostRequest = async (context: Context, response: any): Promise<void> => {
    const endTime = performance.now();

    try {
      // Skip auditing for certain paths
      if (this.shouldSkipAudit(context.path)) {
        return;
      }

      const startTime = (context as any).auditStartTime || endTime;
      const requestId = (context as any).requestId;
      const duration = endTime - startTime;

      // Create comprehensive audit event
      const auditEvent = await this.createAuditEvent(context, response, {
        requestId,
        duration,
        timestamp: new Date().toISOString(),
      });

      // Store audit event
      await this.storeAuditEvent(auditEvent);

      // Log request completion
      await this.logRequestCompletion(auditEvent);

      // Update metrics
      await this.updateAuditMetrics(auditEvent);

      const auditDuration = performance.now() - endTime;
      await this.metrics.recordTimer(
        "audit_post_request_duration",
        auditDuration
      );
    } catch (error) {
      this.logger.error("Audit post-request failed", error as Error, {
        path: context.path,
      });
      // Don't throw - audit failures shouldn't break the response
    }
  };

  /**
   * Audit error handler
   */
  auditError = async (context: Context, error: any): Promise<void> => {
    const errorTime = performance.now();

    try {
      // Skip auditing for certain paths
      if (this.shouldSkipAudit(context.path)) {
        return;
      }

      const startTime = (context as any).auditStartTime || errorTime;
      const requestId = (context as any).requestId;
      const duration = errorTime - startTime;

      // Create error audit event
      const auditEvent = await this.createAuditEvent(context, null, {
        requestId,
        duration,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
        success: false,
      });

      // Store audit event
      await this.storeAuditEvent(auditEvent);

      // Log error
      await this.logRequestError(auditEvent, error);

      // Update error metrics
      await this.updateErrorMetrics(auditEvent);
    } catch (auditError) {
      this.logger.error("Audit error handling failed", auditError as Error, {
        path: context.path,
        originalError: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  /**
   * Check if audit should be skipped for this path
   */
  private shouldSkipAudit(path: string): boolean {
    return this.config.skipPaths.some((skipPath) => {
      if (skipPath.endsWith("*")) {
        return path.startsWith(skipPath.slice(0, -1));
      }
      return path === skipPath || path.startsWith(skipPath + "/");
    });
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return "req_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Log request start
   */
  private async logRequestStart(
    context: Context,
    requestId: string,
    startTime: number
  ): Promise<void> {
    if (!this.config.enableDetailedLogging) {
      return;
    }

    const { path, request } = context;
    const authContext = (context as any).auth;

    this.logger.info("Request started", {
      requestId,
      path,
      method: request.method,
      userId: authContext?.userId,
      clientIp: this.getClientIp(request),
      userAgent: request.headers.get("user-agent"),
      timestamp: new Date(startTime).toISOString(),
    });
  }

  /**
   * Create comprehensive audit event
   */
  private async createAuditEvent(
    context: Context,
    response: any,
    metadata: {
      requestId?: string;
      duration?: number;
      timestamp: string;
      error?: string;
      success?: boolean;
    }
  ): Promise<AuditEvent> {
    const { path, request } = context;
    const authContext = (context as any).auth;
    const validatedBody = (context as any).validatedBody;

    // Determine action and resource from path and method
    const { action, resource } = this.parseActionAndResource(
      path,
      request.method
    );

    // Get request and response sizes
    const requestSize = await this.getRequestSize(context);
    const responseSize = this.getResponseSize(response);

    const auditEvent: AuditEvent = {
      eventId: this.generateEventId(),
      timestamp: metadata.timestamp,
      userId: authContext?.userId,
      apiKey: authContext?.apiKey
        ? this.maskSensitiveData(authContext.apiKey)
        : undefined,
      action,
      resource,
      method: request.method,
      path,
      statusCode: response?.status || context.set?.status,
      duration: metadata.duration,
      requestSize,
      responseSize,
      clientIp: this.getClientIp(request),
      userAgent: request.headers.get("user-agent") || "unknown",
      requestId: metadata.requestId,
      sessionId: this.extractSessionId(request),
      success:
        metadata.success !== false &&
        (!response?.status || response.status < 400),
      error: metadata.error,
      metadata: {
        // Add relevant request metadata
        cartId: validatedBody?.cartId,
        modelName: validatedBody?.modelName,
        batchSize: validatedBody?.requests?.length,
        forceRecompute: validatedBody?.forceRecompute,
        // Request body (if enabled and not sensitive)
        requestBody: this.config.logRequestBodies
          ? this.sanitizeData(validatedBody)
          : undefined,
        // Response body (if enabled)
        responseBody: this.config.logResponseBodies
          ? this.sanitizeData(response)
          : undefined,
        // Additional context
        authMethod: authContext?.apiKey ? "api_key" : "token",
        permissions: authContext?.permissions,
      },
    };

    return auditEvent;
  }

  /**
   * Parse action and resource from path and method
   */
  private parseActionAndResource(
    path: string,
    method: string
  ): { action: string; resource: string } {
    const methodLower = method.toLowerCase();

    // Map paths to resources and actions
    if (path.includes("/predict")) {
      return {
        action: path.includes("batch") ? "batch_predict" : "predict",
        resource: "prediction",
      };
    }

    if (path.includes("/explain")) {
      return { action: "explain", resource: "prediction" };
    }

    if (path.includes("/models")) {
      return {
        action:
          methodLower === "get"
            ? "read"
            : methodLower === "post"
            ? "create"
            : methodLower,
        resource: "model",
      };
    }

    if (path.includes("/features")) {
      return { action: "compute", resource: "feature" };
    }

    if (path.includes("/cache")) {
      return { action: "invalidate", resource: "cache" };
    }

    if (path.includes("/health")) {
      return { action: "check", resource: "health" };
    }

    if (path.includes("/metrics")) {
      return { action: "read", resource: "metrics" };
    }

    // Default mapping
    return {
      action: methodLower,
      resource: path.split("/")[1] || "unknown",
    };
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return "evt_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Get request size
   */
  private async getRequestSize(context: Context): Promise<number> {
    try {
      const contentLength = context.request.headers.get("content-length");
      if (contentLength) {
        return parseInt(contentLength, 10);
      }

      // Estimate from body if available
      const body = (context as any).validatedBody;
      if (body) {
        return JSON.stringify(body).length;
      }

      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get response size
   */
  private getResponseSize(response: any): number {
    try {
      if (!response) return 0;

      // If response has content-length header
      if (response.headers?.["content-length"]) {
        return parseInt(response.headers["content-length"], 10);
      }

      // Estimate from response body
      if (response.body || response.data) {
        return JSON.stringify(response.body || response.data).length;
      }

      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get client IP address
   */
  private getClientIp(request: Request): string {
    const xForwardedFor = request.headers.get("x-forwarded-for");
    const xRealIp = request.headers.get("x-real-ip");
    const cfConnectingIp = request.headers.get("cf-connecting-ip");

    if (xForwardedFor) {
      return xForwardedFor.split(",")[0].trim();
    }
    if (xRealIp) {
      return xRealIp;
    }
    if (cfConnectingIp) {
      return cfConnectingIp;
    }

    return "unknown";
  }

  /**
   * Extract session ID from request
   */
  private extractSessionId(request: Request): string | undefined {
    // Try to extract from various sources
    const sessionHeader = request.headers.get("x-session-id");
    if (sessionHeader) {
      return sessionHeader;
    }

    // Try to extract from cookies (if any)
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) {
      const sessionMatch = cookieHeader.match(/session[_-]?id=([^;]+)/i);
      if (sessionMatch) {
        return sessionMatch[1];
      }
    }

    return undefined;
  }

  /**
   * Mask sensitive data
   */
  private maskSensitiveData(data: string): string {
    if (data.length <= 8) {
      return "*".repeat(data.length);
    }
    return (
      data.substring(0, 4) +
      "*".repeat(data.length - 8) +
      data.substring(data.length - 4)
    );
  }

  /**
   * Sanitize data by removing sensitive fields
   */
  private sanitizeData(data: any): any {
    if (!data || typeof data !== "object") {
      return data;
    }

    const sanitized = { ...data };

    // Remove sensitive fields
    this.config.sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        sanitized[field] = "[REDACTED]";
      }
    });

    // Recursively sanitize nested objects
    Object.keys(sanitized).forEach((key) => {
      if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
        sanitized[key] = this.sanitizeData(sanitized[key]);
      }
    });

    return sanitized;
  }

  /**
   * Store audit event
   */
  private async storeAuditEvent(auditEvent: AuditEvent): Promise<void> {
    try {
      // Add to in-memory trail
      this.auditTrail.push(auditEvent);

      // Maintain maximum history size
      if (this.auditTrail.length > this.config.maxEventHistory) {
        this.auditTrail.splice(
          0,
          this.auditTrail.length - this.config.maxEventHistory
        );
      }

      // In production, also store in database, event stream, or audit service
      // await this.auditDatabase.store(auditEvent);
      // await this.eventPipeline.send(auditEvent);
    } catch (error) {
      this.logger.error("Failed to store audit event", error as Error, {
        eventId: auditEvent.eventId,
      });
    }
  }

  /**
   * Log request completion
   */
  private async logRequestCompletion(auditEvent: AuditEvent): Promise<void> {
    if (!this.config.enableDetailedLogging) {
      return;
    }

    this.logger.info("Request completed", {
      requestId: auditEvent.requestId,
      path: auditEvent.path,
      method: auditEvent.method,
      statusCode: auditEvent.statusCode,
      duration: auditEvent.duration
        ? Math.round(auditEvent.duration)
        : undefined,
      success: auditEvent.success,
      userId: auditEvent.userId,
      action: auditEvent.action,
      resource: auditEvent.resource,
    });
  }

  /**
   * Log request error
   */
  private async logRequestError(
    auditEvent: AuditEvent,
    error: any
  ): Promise<void> {
    this.logger.error("Request failed", error as Error, {
      requestId: auditEvent.requestId,
      path: auditEvent.path,
      method: auditEvent.method,
      duration: auditEvent.duration
        ? Math.round(auditEvent.duration)
        : undefined,
      userId: auditEvent.userId,
      action: auditEvent.action,
      resource: auditEvent.resource,
      clientIp: auditEvent.clientIp,
    });
  }

  /**
   * Update audit metrics
   */
  private async updateAuditMetrics(auditEvent: AuditEvent): Promise<void> {
    try {
      // Record general metrics
      await this.metrics.recordCounter("audit_event_total");
      await this.metrics.recordCounter(`audit_action_${auditEvent.action}`);
      await this.metrics.recordCounter(`audit_resource_${auditEvent.resource}`);
      await this.metrics.recordCounter(
        `audit_method_${auditEvent.method.toLowerCase()}`
      );

      // Record success/failure
      if (auditEvent.success) {
        await this.metrics.recordCounter("audit_request_success");
      } else {
        await this.metrics.recordCounter("audit_request_error");
      }

      // Record status code
      if (auditEvent.statusCode) {
        await this.metrics.recordCounter(
          `audit_status_${auditEvent.statusCode}`
        );
      }

      // Record duration
      if (auditEvent.duration) {
        await this.metrics.recordTimer(
          "audit_request_duration",
          auditEvent.duration
        );
      }

      // Record request/response sizes
      if (auditEvent.requestSize) {
        await this.metrics.recordHistogram(
          "audit_request_size",
          auditEvent.requestSize
        );
      }
      if (auditEvent.responseSize) {
        await this.metrics.recordHistogram(
          "audit_response_size",
          auditEvent.responseSize
        );
      }
    } catch (error) {
      this.logger.error("Failed to update audit metrics", error as Error);
    }
  }

  /**
   * Update error metrics
   */
  private async updateErrorMetrics(auditEvent: AuditEvent): Promise<void> {
    try {
      await this.metrics.recordCounter("audit_error_total");
      await this.metrics.recordCounter(`audit_error_${auditEvent.action}`);

      if (auditEvent.duration) {
        await this.metrics.recordTimer(
          "audit_error_duration",
          auditEvent.duration
        );
      }
    } catch (error) {
      this.logger.error("Failed to update error metrics", error as Error);
    }
  }

  /**
   * Get audit trail (last N events)
   */
  getAuditTrail(limit: number = 100): AuditEvent[] {
    return this.auditTrail.slice(-limit);
  }

  /**
   * Search audit events
   */
  searchAuditEvents(filters: {
    userId?: string;
    action?: string;
    resource?: string;
    startTime?: string;
    endTime?: string;
    success?: boolean;
  }): AuditEvent[] {
    return this.auditTrail.filter((event) => {
      if (filters.userId && event.userId !== filters.userId) return false;
      if (filters.action && event.action !== filters.action) return false;
      if (filters.resource && event.resource !== filters.resource) return false;
      if (filters.success !== undefined && event.success !== filters.success)
        return false;

      if (filters.startTime && event.timestamp < filters.startTime)
        return false;
      if (filters.endTime && event.timestamp > filters.endTime) return false;

      return true;
    });
  }

  /**
   * Get audit statistics
   */
  getAuditStatistics(): any {
    const total = this.auditTrail.length;
    const successful = this.auditTrail.filter((e) => e.success).length;
    const failed = total - successful;

    const actionCounts = this.auditTrail.reduce((acc, event) => {
      acc[event.action] = (acc[event.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const resourceCounts = this.auditTrail.reduce((acc, event) => {
      acc[event.resource] = (acc[event.resource] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalEvents: total,
      successfulRequests: successful,
      failedRequests: failed,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      actionBreakdown: actionCounts,
      resourceBreakdown: resourceCounts,
      maxEventHistory: this.config.maxEventHistory,
    };
  }

  /**
   * Get audit middleware health status
   */
  async getHealthStatus(): Promise<any> {
    return {
      status: "healthy",
      eventsTracked: this.auditTrail.length,
      maxEventHistory: this.config.maxEventHistory,
      config: {
        detailedLogging: this.config.enableDetailedLogging,
        logRequestBodies: this.config.logRequestBodies,
        logResponseBodies: this.config.logResponseBodies,
      },
    };
  }
}
