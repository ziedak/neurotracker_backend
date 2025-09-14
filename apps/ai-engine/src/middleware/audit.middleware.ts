import { Context } from "@libs/elysia-server";
import { IMetricsCollector } from "@libs/monitoring";
import type { ILogger } from "@libs/utils";
import { performance } from "perf_hooks";

// Extended Context interface for audit middleware
interface AuditContext extends Context {
  requestId?: string;
  auditStartTime?: number;
  auth?: {
    userId?: string;
    apiKey?: string;
    permissions?: string[];
  };
  validatedBody?: Record<string, unknown>;
}

interface AuditEvent {
  eventId: string;
  timestamp: string;
  userId: string | undefined;
  apiKey: string | undefined;
  action: string;
  resource: string;
  method: string;
  path: string;
  statusCode: number | undefined;
  duration: number | undefined;
  requestSize: number | undefined;
  responseSize: number | undefined;
  clientIp: string;
  userAgent: string | undefined;
  requestId: string | undefined;
  sessionId: string | undefined;
  success: boolean;
  error: string | undefined;
  metadata: Record<string, unknown> | undefined;
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
  private readonly logger: ILogger;
  private readonly metrics: IMetricsCollector;
  private readonly config: AuditConfig;

  // In-memory audit trail (ring buffer)
  private auditTrail: (AuditEvent | undefined)[];
  private auditTrailIndex: number = 0;

  private readonly defaultConfig: AuditConfig = {
    enableDetailedLogging: true,
    logRequestBodies: false,
    logResponseBodies: false,
    maxEventHistory: 10000,
    sensitiveFields: ["password", "token", "secret", "key", "authorization"],
    skipPaths: ["/health", "/metrics", "/favicon.ico"],
  };

  constructor(
    logger: ILogger,
    metrics: IMetricsCollector,
    config?: Partial<AuditConfig>
  ) {
    this.logger = logger;
    this.metrics = metrics;
    this.config = { ...this.defaultConfig, ...config };
    this.auditTrail = Array.from({ length: this.config.maxEventHistory });
    this.logger.info("Audit Middleware initialized", {
      detailedLogging: this.config.enableDetailedLogging,
      maxEventHistory: this.config.maxEventHistory,
      skipPaths: this.config.skipPaths.length,
    });
  }

  /**
   * Pre-request audit hook
   */
  public auditPreRequest = async (context: AuditContext): Promise<void> => {
    const startTime = performance.now();
    try {
      if (this.shouldSkipAudit(context.path)) return;
      const requestId = this.generateRequestId();
      context.requestId = requestId;
      context.auditStartTime = startTime;
      await this.logRequestStart(context, requestId, startTime);
      this.metrics.recordTimer(
        "audit_pre_request_duration",
        performance.now() - startTime
      );
    } catch (error) {
      this.logger.error("Audit pre-request failed", error as Error, {
        path: context.path,
      });
    }
  };

  /**
   * Post-request audit hook
   */
  public auditPostRequest = async (
    context: AuditContext,
    response: unknown
  ): Promise<void> => {
    const endTime = performance.now();
    try {
      if (this.shouldSkipAudit(context.path)) return;
      const startTime = context.auditStartTime ?? endTime;
      const requestId = context.requestId;
      const duration = endTime - startTime;
      const auditEvent = await this.createAuditEvent(context, response, {
        requestId: requestId ?? undefined,
        duration,
        timestamp: new Date().toISOString(),
      });
      this.storeAuditEvent(auditEvent);
      await this.logRequestCompletion(auditEvent);
      await this.updateAuditMetrics(auditEvent);
      this.metrics.recordTimer(
        "audit_post_request_duration",
        performance.now() - endTime
      );
    } catch (error) {
      this.logger.error("Audit post-request failed", error as Error, {
        path: context.path,
      });
    }
  };

  /**
   * Audit error handler
   */
  public auditError = async (
    context: AuditContext,
    error: unknown
  ): Promise<void> => {
    const errorTime = performance.now();
    try {
      if (this.shouldSkipAudit(context.path)) return;
      const startTime = context.auditStartTime ?? errorTime;
      const requestId = context.requestId;
      const duration = errorTime - startTime;
      const auditEvent = await this.createAuditEvent(context, null, {
        requestId: requestId ?? undefined,
        duration,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error",
        success: false,
      });
      this.storeAuditEvent(auditEvent);
      await this.logRequestError(auditEvent, error);
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
    context: AuditContext,
    requestId: string,
    startTime: number
  ): Promise<void> {
    if (!this.config.enableDetailedLogging) {
      return;
    }

    const { path, request } = context;
    const authContext = context.auth;

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
    context: AuditContext,
    response: unknown,
    metadata: {
      requestId?: string | undefined;
      duration?: number | undefined;
      timestamp: string;
      error?: string | undefined;
      success?: boolean | undefined;
    }
  ): Promise<AuditEvent> {
    const { path, request } = context;
    const authContext = context.auth;
    const validatedBody = context.validatedBody;

    // Parallelize independent data fetches for performance
    const [requestSize, responseSize] = await Promise.all([
      this.getRequestSize(context),
      Promise.resolve(this.getResponseSize(response)),
    ]);

    // Determine action and resource from path and method
    const { action, resource } = this.parseActionAndResource(
      path,
      request.method
    );

    let sanitizedRequestBody: unknown = undefined;
    let sanitizedResponseBody: unknown = undefined;
    if (this.config.logRequestBodies && validatedBody) {
      try {
        sanitizedRequestBody = this.sanitizeData(validatedBody);
      } catch {}
    }
    if (this.config.logResponseBodies && response) {
      try {
        sanitizedResponseBody = this.sanitizeData(response);
      } catch {}
    }

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
      statusCode:
        typeof (response as { status?: number })?.status === "number"
          ? (response as { status: number }).status
          : typeof context.set?.status === "number"
          ? (context.set.status as number)
          : undefined,
      duration: metadata.duration,
      requestSize,
      responseSize,
      clientIp: this.getClientIp(request),
      userAgent: request.headers.get("user-agent") || "unknown",
      requestId: metadata.requestId,
      sessionId: this.extractSessionId(request),
      success:
        metadata.success !== false &&
        (!(response as { status?: number })?.status ||
          (response as { status?: number }).status! < 400),
      error: metadata.error,
      metadata: {
        cartId: (validatedBody as { cartId?: string })?.cartId,
        modelName: (validatedBody as { modelName?: string })?.modelName,
        batchSize: (validatedBody as { requests?: unknown[] })?.requests
          ?.length,
        forceRecompute: (validatedBody as { forceRecompute?: boolean })
          ?.forceRecompute,
        requestBody: sanitizedRequestBody,
        responseBody: sanitizedResponseBody,
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
  private async getRequestSize(context: AuditContext): Promise<number> {
    try {
      const contentLength = context.request.headers.get("content-length");
      if (contentLength) {
        return parseInt(contentLength, 10);
      }
      const body = context.validatedBody;
      if (body) {
        if (typeof body === "string") {
          return (body as string).length;
        }
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
  private getResponseSize(response: unknown): number {
    try {
      if (!response) return 0;
      const responseObj = response as {
        headers?: { [key: string]: string };
        body?: unknown;
        data?: unknown;
      };
      if (responseObj.headers?.["content-length"]) {
        return parseInt(responseObj.headers["content-length"], 10);
      }
      const payload = responseObj.body || responseObj.data;
      if (payload) {
        if (typeof payload === "string") return payload.length;
        return JSON.stringify(payload).length;
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
      const firstIp = xForwardedFor.split(",")[0];
      return firstIp ? firstIp.trim() : "unknown";
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
   * Store audit event in ring buffer
   */
  private storeAuditEvent(auditEvent: AuditEvent): void {
    try {
      this.auditTrail[this.auditTrailIndex] = auditEvent;
      this.auditTrailIndex =
        (this.auditTrailIndex + 1) % this.config.maxEventHistory;
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
    error: unknown
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
    const counters = [
      this.metrics.recordCounter("audit_event_total"),
      this.metrics.recordCounter(`audit_action_${auditEvent.action}`),
      this.metrics.recordCounter(`audit_resource_${auditEvent.resource}`),
      this.metrics.recordCounter(
        `audit_method_${auditEvent.method.toLowerCase()}`
      ),
    ];
    if (auditEvent.success)
      counters.push(this.metrics.recordCounter("audit_request_success"));
    if (!auditEvent.success)
      counters.push(this.metrics.recordCounter("audit_request_error"));
    if (auditEvent.statusCode)
      counters.push(
        this.metrics.recordCounter(`audit_status_${auditEvent.statusCode}`)
      );
    await Promise.all(counters);
    if (auditEvent.duration)
      await this.metrics.recordTimer(
        "audit_request_duration",
        auditEvent.duration
      );
    if (auditEvent.requestSize)
      await this.metrics.recordHistogram(
        "audit_request_size",
        auditEvent.requestSize
      );
    if (auditEvent.responseSize)
      await this.metrics.recordHistogram(
        "audit_response_size",
        auditEvent.responseSize
      );
  }

  /**
   * Sanitize data by removing sensitive fields (optimized)
   */
  private sanitizeData(data: unknown): unknown {
    if (!data || typeof data !== "object") return data;
    if (Array.isArray(data)) return data.map((item) => this.sanitizeData(item));
    const sanitized: Record<string, unknown> = {};
    const dataObj = data as Record<string, unknown>;
    for (const key in dataObj) {
      if (this.config.sensitiveFields.includes(key)) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof dataObj[key] === "object" && dataObj[key] !== null) {
        sanitized[key] = this.sanitizeData(dataObj[key]);
      } else {
        sanitized[key] = dataObj[key];
      }
    }
    return sanitized;
  }

  /**
   * Update error metrics
   */
  private async updateErrorMetrics(auditEvent: AuditEvent): Promise<void> {
    const counters = [
      this.metrics.recordCounter("audit_error_total"),
      this.metrics.recordCounter(`audit_error_${auditEvent.action}`),
    ];
    await Promise.all(counters);
    if (auditEvent.duration) {
      await this.metrics.recordTimer(
        "audit_error_duration",
        auditEvent.duration
      );
    }
  }

  /**
   * Get audit trail (last N events, ordered newest to oldest)
   */
  public getAuditTrail(limit: number = 100): AuditEvent[] {
    const events: AuditEvent[] = [];
    let count = 0;
    let idx =
      (this.auditTrailIndex - 1 + this.config.maxEventHistory) %
      this.config.maxEventHistory;
    while (count < this.config.maxEventHistory) {
      const event = this.auditTrail[idx];
      if (event) events.push(event);
      if (++count >= limit) break;
      idx =
        (idx - 1 + this.config.maxEventHistory) % this.config.maxEventHistory;
    }
    return events;
  }

  /**
   * Search audit events in ring buffer with strict typing and limit
   * @param filters - filter criteria and optional limit
   * @returns AuditEvent[]
   */
  public searchAuditEvents(filters: {
    userId?: string;
    action?: string;
    resource?: string;
    startTime?: string;
    endTime?: string;
    success?: boolean;
    limit?: number;
  }): AuditEvent[] {
    // Directly filter from ring buffer for performance
    const results: AuditEvent[] = [];
    const maxLimit =
      typeof filters.limit === "number" && filters.limit! > 0
        ? filters.limit!
        : 100;
    let count = 0;
    let idx =
      (this.auditTrailIndex - 1 + this.config.maxEventHistory) %
      this.config.maxEventHistory;
    let found = 0;
    while (count < this.config.maxEventHistory && found < maxLimit) {
      const event = this.auditTrail[idx];
      if (event) {
        if (
          (!filters.userId || event.userId === filters.userId) &&
          (!filters.action || event.action === filters.action) &&
          (!filters.resource || event.resource === filters.resource) &&
          (filters.success === undefined ||
            event.success === filters.success) &&
          (!filters.startTime || event.timestamp >= filters.startTime) &&
          (!filters.endTime || event.timestamp <= filters.endTime)
        ) {
          results.push(event);
          found++;
        }
      }
      count++;
      idx =
        (idx - 1 + this.config.maxEventHistory) % this.config.maxEventHistory;
    }
    return results;
  }

  /**
   * Get audit statistics
   */
  public getAuditStatistics(): {
    totalEvents: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    actionBreakdown: Record<string, number>;
    resourceBreakdown: Record<string, number>;
    maxEventHistory: number;
  } {
    const events = this.getAuditTrail(this.config.maxEventHistory);
    const total = events.length;
    const successful = events.filter((e) => e.success).length;
    const failed = total - successful;
    const actionCounts = events.reduce((acc, event) => {
      acc[event.action] = (acc[event.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const resourceCounts = events.reduce((acc, event) => {
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
  public async getHealthStatus(): Promise<{
    status: string;
    eventsTracked: number;
    maxEventHistory: number;
    config: {
      detailedLogging: boolean;
      logRequestBodies: boolean;
      logResponseBodies: boolean;
    };
  }> {
    return {
      status: "healthy",
      eventsTracked: this.getAuditTrail(this.config.maxEventHistory).length,
      maxEventHistory: this.config.maxEventHistory,
      config: {
        detailedLogging: this.config.enableDetailedLogging,
        logRequestBodies: this.config.logRequestBodies,
        logResponseBodies: this.config.logResponseBodies,
      },
    };
  }
}
