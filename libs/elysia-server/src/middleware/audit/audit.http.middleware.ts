/**
 * Audit Middleware
 * Production-grade audit middleware following AbstractMiddleware patterns
 * Provides comprehensive audit trail functionality for enterprise compliance
 */

import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base";
import type { MiddlewareContext } from "../types";
import { RedisClient, ClickHouseClient } from "@libs/database";

/**
 * Audit event interface for tracking system activities
 */
export interface AuditEvent {
  id: string;
  userId?: string | undefined;
  sessionId?: string | undefined;
  action: string;
  resource: string;
  resourceId?: string | undefined;
  ip: string;
  userAgent: string;
  timestamp: Date;
  metadata?: Record<string, any> | undefined;
  result: "success" | "failure" | "partial";
  statusCode?: number | undefined;
  duration?: number | undefined;
  error?: string | undefined;
}

/**
 * Query interface for audit event retrieval
 */
export interface AuditQuery {
  readonly userId?: string;
  readonly action?: string;
  readonly resource?: string;
  readonly result?: "success" | "failure" | "partial";
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly ip?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Audit summary interface for analytics
 */
export interface AuditSummary {
  readonly totalEvents: number;
  readonly successfulEvents: number;
  readonly failedEvents: number;
  readonly partialEvents: number;
  readonly uniqueUsers: number;
  readonly topActions: ReadonlyArray<{ action: string; count: number }>;
  readonly topResources: ReadonlyArray<{ resource: string; count: number }>;
  readonly averageDuration: number;
}

/**
 * Audit middleware configuration interface
 * Extends HttpMiddlewareConfig with audit-specific options
 */
export interface AuditHttpMiddlewareConfig extends HttpMiddlewareConfig {
  readonly includeBody?: boolean;
  readonly includeResponse?: boolean;
  readonly sensitiveFields?: readonly string[];
  readonly skipRoutes?: readonly string[];
  readonly storageStrategy?: "redis" | "clickhouse" | "both";
  readonly redisTtl?: number;
  readonly maxBodySize?: number;
  readonly enableRealTimeAnalytics?: boolean;
  readonly retentionDays?: number;
  readonly anonymizePersonalData?: boolean;
  readonly complianceMode?: "GDPR" | "SOX" | "HIPAA" | "PCI_DSS" | "standard";
}

/**
 * Default audit middleware configuration constants
 */
const DEFAULT_AUDIT_OPTIONS = {
  INCLUDE_BODY: false,
  INCLUDE_RESPONSE: false,
  SENSITIVE_FIELDS: [
    "password",
    "token",
    "secret",
    "key",
    "auth",
    "ssn",
    "credit_card",
  ] as const,
  SKIP_ROUTES: ["/health", "/metrics", "/docs"] as const,
  STORAGE_STRATEGY: "both" as const,
  REDIS_TTL: 7 * 24 * 3600, // 7 days
  MAX_BODY_SIZE: 1024 * 10, // 10KB
  ENABLE_REAL_TIME_ANALYTICS: true,
  RETENTION_DAYS: 90,
  ANONYMIZE_PERSONAL_DATA: false,
  COMPLIANCE_MODE: "standard" as const,
  PRIORITY: 5, // Medium priority for audit
} as const;

/**
 * Production-grade Audit Middleware
 * Framework-agnostic implementation with comprehensive audit trail support
 *
 * Features:
 * - Multi-storage strategy (Redis + ClickHouse)
 * - Compliance-ready audit trails (GDPR, SOX, HIPAA, PCI DSS)
 * - Real-time analytics and querying
 * - Automatic data sanitization
 * - Performance optimized
 * - Enterprise-grade error handling
 * - Comprehensive metrics integration
 * - Configurable retention policies
 *
 * @template AuditHttpMiddlewareConfig - Audit-specific configuration
 */
export class AuditHttpMiddleware extends BaseMiddleware<AuditHttpMiddlewareConfig> {
  private readonly redisClient: RedisClient;
  private readonly clickhouseClient: ClickHouseClient;

  constructor(
    metrics: IMetricsCollector,
    redisClient: RedisClient,
    clickhouseClient: ClickHouseClient,
    config: Partial<AuditHttpMiddlewareConfig> = {}
  ) {
    // Create complete configuration with validated defaults
    const completeConfig = {
      name: config.name || "audit",
      enabled: config.enabled ?? true,
      priority: config.priority ?? DEFAULT_AUDIT_OPTIONS.PRIORITY,
      skipPaths: [...(config.skipPaths || []), ...(config.skipRoutes || [])],
      includeBody: config.includeBody ?? DEFAULT_AUDIT_OPTIONS.INCLUDE_BODY,
      includeResponse:
        config.includeResponse ?? DEFAULT_AUDIT_OPTIONS.INCLUDE_RESPONSE,
      sensitiveFields:
        config.sensitiveFields || DEFAULT_AUDIT_OPTIONS.SENSITIVE_FIELDS,
      skipRoutes: config.skipRoutes || DEFAULT_AUDIT_OPTIONS.SKIP_ROUTES,
      storageStrategy:
        config.storageStrategy ?? DEFAULT_AUDIT_OPTIONS.STORAGE_STRATEGY,
      redisTtl: config.redisTtl ?? DEFAULT_AUDIT_OPTIONS.REDIS_TTL,
      maxBodySize: config.maxBodySize ?? DEFAULT_AUDIT_OPTIONS.MAX_BODY_SIZE,
      enableRealTimeAnalytics:
        config.enableRealTimeAnalytics ??
        DEFAULT_AUDIT_OPTIONS.ENABLE_REAL_TIME_ANALYTICS,
      retentionDays:
        config.retentionDays ?? DEFAULT_AUDIT_OPTIONS.RETENTION_DAYS,
      anonymizePersonalData:
        config.anonymizePersonalData ??
        DEFAULT_AUDIT_OPTIONS.ANONYMIZE_PERSONAL_DATA,
      complianceMode:
        config.complianceMode ?? DEFAULT_AUDIT_OPTIONS.COMPLIANCE_MODE,
    } as AuditHttpMiddlewareConfig;

    super(metrics, completeConfig);
    this.redisClient = redisClient;
    this.clickhouseClient = clickhouseClient;
    this.validateConfiguration();
  }

  /**
   * Main execution method implementing audit trail logic
   */
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = Date.now();
    const auditId = this.generateAuditId();

    // Create base audit event
    const auditEvent: AuditEvent = {
      id: auditId,
      userId: this.extractUserId(context),
      sessionId: this.extractSessionId(context),
      action: this.extractAction(context),
      resource: this.extractResource(context),
      resourceId: this.extractResourceId(context),
      ip: this.extractClientIp(context),
      userAgent: this.extractUserAgent(context),
      timestamp: new Date(),
      metadata: await this.buildMetadata(context),
      result: "success", // Will be updated in catch block if needed
      statusCode: 200, // Will be updated based on actual response
      duration: 0, // Will be calculated in finally block
    };

    let error: Error | null = null;

    try {
      // Execute next middleware/handler
      await next();

      // Success case
      auditEvent.result = "success";
      auditEvent.statusCode = context.response?.status || 200;

      await this.recordMetric("audit_success", 1, {
        action: auditEvent.action!,
        resource: auditEvent.resource!,
      });
    } catch (err) {
      error = err as Error;
      auditEvent.result = "failure";
      auditEvent.statusCode = context.response?.status || 500;
      auditEvent.error = error.message;

      await this.recordMetric("audit_failure", 1, {
        action: auditEvent.action!,
        resource: auditEvent.resource!,
        errorType: error.constructor.name,
      });
    } finally {
      // Calculate duration and finalize audit event
      auditEvent.duration = Date.now() - startTime;

      // Record timing metrics
      await this.recordTimer("audit_duration", auditEvent.duration, {
        action: auditEvent.action!,
        resource: auditEvent.resource!,
        result: auditEvent.result!,
      });

      // Store audit event
      await this.storeAuditEvent(auditEvent); // Re-throw error if it occurred
      if (error) {
        throw error;
      }
    }
  }

  /**
   * Determine if middleware should skip processing for this context
   */
  protected override shouldSkip(context: MiddlewareContext): boolean {
    const path = context.request.url || "/";

    // Skip if middleware is disabled
    if (!this.config.enabled) {
      return true;
    }

    // Skip if path is in skip routes
    return (
      this.config.skipRoutes?.some((route) => path.includes(route)) ?? false
    );
  }

  /**
   * Extract context information for logging and debugging
   */
  protected override extractContextInfo(
    context: MiddlewareContext
  ): Record<string, any> {
    return {
      method: context.request.method,
      url: context.request.url,
      userId: this.extractUserId(context),
      sessionId: this.extractSessionId(context),
      ip: this.extractClientIp(context),
      userAgent: this.extractUserAgent(context),
    };
  }

  /**
   * Store audit event using configured storage strategy
   */
  private async storeAuditEvent(event: AuditEvent): Promise<void> {
    try {
      const tasks: Promise<void>[] = [];

      // Store in Redis for quick access
      if (
        this.config.storageStrategy === "redis" ||
        this.config.storageStrategy === "both"
      ) {
        tasks.push(this.storeInRedis(event));
      }

      // Store in ClickHouse for analytics
      if (
        this.config.storageStrategy === "clickhouse" ||
        this.config.storageStrategy === "both"
      ) {
        tasks.push(this.storeInClickHouse(event));
      }

      // Execute storage operations in parallel
      await Promise.all(tasks);

      // Record storage metrics
      await this.recordMetric("audit_stored", 1, {
        storage: this.config.storageStrategy!,
        action: event.action,
        resource: event.resource,
      });

      this.logger.debug("Audit event stored successfully", {
        id: event.id,
        action: event.action,
        resource: event.resource,
        result: event.result,
        duration: event.duration,
      });
    } catch (error) {
      await this.handleError(error as Error, event);
    }
  }

  /**
   * Store audit event in Redis for fast access
   */
  private async storeInRedis(event: AuditEvent): Promise<void> {
    const redis = this.redisClient.getRedis();
    const redisKey = `audit:${event.id}`;

    await redis.setex(
      redisKey,
      this.config.redisTtl!,
      JSON.stringify(this.sanitizeAuditEvent(event))
    );
  }

  /**
   * Store audit event in ClickHouse for analytics
   */
  private async storeInClickHouse(event: AuditEvent): Promise<void> {
    await this.clickhouseClient.insert("audit_events", [
      {
        id: event.id,
        user_id: event.userId || "",
        session_id: event.sessionId || "",
        action: event.action,
        resource: event.resource,
        resource_id: event.resourceId || "",
        ip: event.ip,
        user_agent: event.userAgent,
        timestamp: event.timestamp,
        metadata: JSON.stringify(event.metadata || {}),
        result: event.result,
        status_code: event.statusCode || 0,
        duration: event.duration || 0,
        error: event.error || "",
      },
    ]);
  }

  /**
   * Query audit events from ClickHouse
   */
  async queryAuditEvents(query: AuditQuery): Promise<AuditEvent[]> {
    try {
      let sql = "SELECT * FROM audit_events WHERE 1=1";
      const queryParams: Record<string, any> = {};

      // Build dynamic query
      if (query.userId) {
        sql += " AND user_id = {userId:String}";
        queryParams["userId"] = query.userId;
      }

      if (query.action) {
        sql += " AND action = {action:String}";
        queryParams["action"] = query.action;
      }

      if (query.resource) {
        sql += " AND resource = {resource:String}";
        queryParams["resource"] = query.resource;
      }

      if (query.result) {
        sql += " AND result = {result:String}";
        queryParams["result"] = query.result;
      }

      if (query.ip) {
        sql += " AND ip = {ip:String}";
        queryParams["ip"] = query.ip;
      }

      if (query.startDate) {
        sql += " AND timestamp >= {startDate:DateTime}";
        queryParams["startDate"] = query.startDate.toISOString();
      }

      if (query.endDate) {
        sql += " AND timestamp <= {endDate:DateTime}";
        queryParams["endDate"] = query.endDate.toISOString();
      }

      sql += " ORDER BY timestamp DESC";

      if (query.limit) {
        sql += " LIMIT {limit:UInt32}";
        queryParams["limit"] = query.limit;
      }

      if (query.offset) {
        sql += " OFFSET {offset:UInt32}";
        queryParams["offset"] = query.offset;
      }

      const rows = (await this.clickhouseClient.execute(
        sql,
        queryParams
      )) as any[];

      return rows.map((row: any) => this.mapRowToAuditEvent(row));
    } catch (error) {
      this.logger.error("Failed to query audit events", error as Error, query);
      await this.recordMetric("audit_query_error", 1);
      throw error;
    }
  }

  /**
   * Get audit summary for analytics
   */
  async getAuditSummary(startDate: Date, endDate: Date): Promise<AuditSummary> {
    try {
      const queryParams = {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };

      // Execute summary queries in parallel
      const [summaryResults, actionsResults, resourcesResults] =
        (await Promise.all([
          this.getSummaryStats(queryParams),
          this.getTopActions(queryParams),
          this.getTopResources(queryParams),
        ])) as [any[], any[], any[]];

      const summary = summaryResults[0];

      return {
        totalEvents: parseInt(summary.total_events),
        successfulEvents: parseInt(summary.successful_events),
        failedEvents: parseInt(summary.failed_events),
        partialEvents: parseInt(summary.partial_events),
        uniqueUsers: parseInt(summary.unique_users),
        topActions: actionsResults.map((row: any) => ({
          action: row.action,
          count: parseInt(row.count),
        })),
        topResources: resourcesResults.map((row: any) => ({
          resource: row.resource,
          count: parseInt(row.count),
        })),
        averageDuration: parseFloat(summary.average_duration) || 0,
      };
    } catch (error) {
      this.logger.error("Failed to get audit summary", error as Error);
      await this.recordMetric("audit_summary_error", 1);
      throw error;
    }
  }

  /**
   * Helper methods for data extraction
   */
  private extractUserId(context: MiddlewareContext): string | undefined {
    return context.user?.id || context.request.headers?.["x-user-id"];
  }

  private extractSessionId(context: MiddlewareContext): string | undefined {
    return context.session?.id || context.request.headers?.["x-session-id"];
  }

  private extractAction(context: MiddlewareContext): string {
    const method = context.request.method?.toLowerCase() || "unknown";
    const path = context.request.url?.split("?")[0] || "/";

    // Extract semantic action from path patterns
    if (path.includes("/gdpr/")) return "gdpr_operation";
    if (path.includes("/export/")) return "data_export";
    if (path.includes("/features/")) return "feature_operation";
    if (path.includes("/security/")) return "security_operation";
    if (path.includes("/admin/")) return "admin_operation";

    return `${method}_request`;
  }

  private extractResource(context: MiddlewareContext): string {
    const path = context.request.url?.split("?")[0] || "/";
    const segments = path.split("/").filter(Boolean);

    if (segments.length > 0) {
      return segments[0] || "unknown";
    }

    return "unknown";
  }

  private extractResourceId(context: MiddlewareContext): string | undefined {
    const path = context.request.url?.split("?")[0] || "/";
    const segments = path.split("/").filter(Boolean);

    // Look for UUID or numeric ID patterns
    for (const segment of segments) {
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          segment
        ) ||
        /^\d+$/.test(segment)
      ) {
        return segment;
      }
    }

    return context["params"]?.id || context["query"]?.id;
  }

  private extractClientIp(context: MiddlewareContext): string {
    return (
      context.request.headers?.["x-forwarded-for"] ||
      context.request.headers?.["x-real-ip"] ||
      context.request.ip ||
      "unknown"
    );
  }

  private extractUserAgent(context: MiddlewareContext): string {
    return context.request.headers?.["user-agent"] || "unknown";
  }

  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Build metadata object with request/response information
   */
  private async buildMetadata(
    context: MiddlewareContext
  ): Promise<Record<string, any>> {
    const metadata: Record<string, any> = {
      method: context.request.method,
      url: context.request.url,
      headers: this.sanitizeObject(
        context.request.headers || {},
        this.config.sensitiveFields as string[]
      ),
    };

    // Include request body if configured
    if (this.config.includeBody && context.request["body"]) {
      metadata["body"] = this.sanitizeRequestBody(context.request["body"]);
    }

    // Include response if configured
    if (this.config.includeResponse && context["response"]) {
      metadata["response"] = this.sanitizeResponseBody(context["response"]);
    }

    return metadata;
  }

  /**
   * Sanitize request body based on configuration
   */
  private sanitizeRequestBody(body: any): any {
    if (!body || typeof body !== "object") return body;

    try {
      const sanitized = this.sanitizeObject(
        body,
        this.config.sensitiveFields as string[]
      );
      const bodyStr = JSON.stringify(sanitized);

      if (bodyStr.length > this.config.maxBodySize!) {
        return `[TRUNCATED - ${bodyStr.length} bytes]`;
      }

      return sanitized;
    } catch {
      return "[UNPARSEABLE]";
    }
  }

  /**
   * Sanitize response body based on configuration
   */
  private sanitizeResponseBody(response: any): any {
    if (!response || typeof response !== "object") return response;

    try {
      const sanitized = this.sanitizeObject(
        response,
        this.config.sensitiveFields as string[]
      );
      const responseStr = JSON.stringify(sanitized);

      if (responseStr.length > this.config.maxBodySize!) {
        return `[TRUNCATED - ${responseStr.length} bytes]`;
      }

      return sanitized;
    } catch {
      return "[UNPARSEABLE]";
    }
  }

  /**
   * Sanitize audit event for storage (compliance-aware)
   */
  private sanitizeAuditEvent(event: AuditEvent): AuditEvent {
    if (!this.config.anonymizePersonalData) {
      return event;
    }

    // Apply anonymization based on compliance mode
    const sanitized = { ...event };

    if (this.config.complianceMode === "GDPR") {
      // GDPR-specific anonymization
      if (sanitized.userId) {
        sanitized.userId = this.hashPersonalData(sanitized.userId);
      }
      sanitized.ip = this.anonymizeIp(sanitized.ip);
    }

    return sanitized;
  }

  /**
   * Hash personal data for GDPR compliance
   */
  private hashPersonalData(data: string): string {
    // Simple hash for demonstration - use proper crypto in production
    return `hash_${Buffer.from(data).toString("base64").substring(0, 8)}`;
  }

  /**
   * Anonymize IP address for privacy compliance
   */
  private anonymizeIp(ip: string): string {
    if (ip.includes(":")) {
      // IPv6
      const parts = ip.split(":");
      return `${parts[0]}:${parts[1]}::****`;
    } else {
      // IPv4
      const parts = ip.split(".");
      return `${parts[0]}.${parts[1]}.***.*`;
    }
  }

  /**
   * Validate middleware configuration
   */
  private validateConfiguration(): void {
    if (this.config.maxBodySize! < 0) {
      throw new Error("maxBodySize must be non-negative");
    }

    if (this.config.redisTtl! < 0) {
      throw new Error("redisTtl must be non-negative");
    }

    if (this.config.retentionDays! < 1) {
      throw new Error("retentionDays must be at least 1");
    }

    if (
      !["redis", "clickhouse", "both"].includes(this.config.storageStrategy!)
    ) {
      throw new Error(
        "storageStrategy must be 'redis', 'clickhouse', or 'both'"
      );
    }
  }

  /**
   * Map database row to AuditEvent
   */
  private mapRowToAuditEvent(row: any): AuditEvent {
    return {
      id: row.id,
      userId: row.user_id || undefined,
      sessionId: row.session_id || undefined,
      action: row.action,
      resource: row.resource,
      resourceId: row.resource_id || undefined,
      ip: row.ip,
      userAgent: row.user_agent,
      timestamp: new Date(row.timestamp),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      result: row.result as "success" | "failure" | "partial",
      statusCode: row.status_code || undefined,
      duration: row.duration || undefined,
      error: row.error || undefined,
    };
  }

  /**
   * Get summary statistics
   */
  private async getSummaryStats(params: Record<string, string>) {
    const query = `
      SELECT 
        COUNT(*) as total_events,
        SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as successful_events,
        SUM(CASE WHEN result = 'failure' THEN 1 ELSE 0 END) as failed_events,
        SUM(CASE WHEN result = 'partial' THEN 1 ELSE 0 END) as partial_events,
        COUNT(DISTINCT user_id) as unique_users,
        AVG(duration) as average_duration
      FROM audit_events 
      WHERE timestamp BETWEEN {startDate:DateTime} AND {endDate:DateTime}
    `;

    return this.clickhouseClient.execute(query, params);
  }

  /**
   * Get top actions
   */
  private async getTopActions(params: Record<string, string>) {
    const query = `
      SELECT action, COUNT(*) as count
      FROM audit_events 
      WHERE timestamp BETWEEN {startDate:DateTime} AND {endDate:DateTime}
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `;

    return this.clickhouseClient.execute(query, params);
  }

  /**
   * Get top resources
   */
  private async getTopResources(params: Record<string, string>) {
    const query = `
      SELECT resource, COUNT(*) as count
      FROM audit_events 
      WHERE timestamp BETWEEN {startDate:DateTime} AND {endDate:DateTime}
      GROUP BY resource
      ORDER BY count DESC
      LIMIT 10
    `;

    return this.clickhouseClient.execute(query, params);
  }

  /**
   * Enhanced error handling
   */
  protected override async handleError(
    error: Error,
    context: any
  ): Promise<void> {
    await super.handleError(error, context);

    // Additional audit-specific error handling
    await this.recordMetric("audit_storage_error", 1, {
      errorType: error.constructor.name,
      storage: this.config.storageStrategy!,
    });

    // Log critical audit failures
    this.logger.error("Critical audit middleware error", error, {
      auditEvent: context,
      configuration: this.config.name,
    });
  }
}
