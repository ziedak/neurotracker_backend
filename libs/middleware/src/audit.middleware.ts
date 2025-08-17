import { RedisClient, ClickHouseClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";

export interface AuditEvent {
  id?: string;
  userId?: string;
  sessionId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  ip: string;
  userAgent: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  result: "success" | "failure" | "partial";
  statusCode?: number;
  duration?: number;
  error?: string;
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  resource?: string;
  result?: "success" | "failure" | "partial";
  startDate?: Date;
  endDate?: Date;
  ip?: string;
  limit?: number;
  offset?: number;
}

export interface AuditSummary {
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  partialEvents: number;
  uniqueUsers: number;
  topActions: Array<{ action: string; count: number }>;
  topResources: Array<{ resource: string; count: number }>;
  averageDuration: number;
}

export interface AuditConfig {
  includeBody?: boolean;
  includeResponse?: boolean;
  sensitiveFields?: string[];
  skipRoutes?: string[];
  storageStrategy?: "redis" | "clickhouse" | "both";
  redisTtl?: number;
  maxBodySize?: number;
}

/**
 * Unified Audit Middleware
 * Comprehensive audit middleware with multi-storage support (Redis + ClickHouse)
 * Framework-agnostic implementation for enterprise-grade audit trails
 */
export class AuditMiddleware {
  private readonly redis: RedisClient;
  private readonly clickhouse: ClickHouseClient;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly defaultConfig: AuditConfig = {
    includeBody: false,
    includeResponse: false,
    sensitiveFields: ["password", "token", "secret", "key", "auth"],
    skipRoutes: ["/health", "/metrics"],
    storageStrategy: "both",
    redisTtl: 7 * 24 * 3600, // 7 days
    maxBodySize: 1024 * 10, // 10KB
  };

  constructor(
    redis: RedisClient,
    clickhouse: ClickHouseClient,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.redis = redis;
    this.clickhouse = clickhouse;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Create Elysia middleware for audit tracking
   */
  elysia(config?: Partial<AuditConfig>) {
    const finalConfig = { ...this.defaultConfig, ...config };

    return (app: any) => {
      return app
        .onBeforeHandle(async (context: any) => {
          const { request } = context;
          const startTime = Date.now();

          // Skip audit for certain routes
          if (this.shouldSkipRoute(request, finalConfig.skipRoutes || [])) {
            return context;
          }

          // Attach audit context
          context.auditContext = {
            startTime,
            auditId: this.generateAuditId(),
          };

          return context;
        })
        .onAfterHandle(async (context: any) => {
          if (!context.auditContext) return context;

          await this.logSuccessfulRequest(context, finalConfig);
          return context;
        })
        .onError(async (context: any) => {
          if (!context.auditContext) return;

          await this.logFailedRequest(context, finalConfig);
        });
    };
  }

  /**
   * Create audit middleware for request tracking
   */
  auditRequests(config?: Partial<AuditConfig>) {
    const finalConfig = { ...this.defaultConfig, ...config };

    return async (context: any, next: () => Promise<void>) => {
      const { request, set } = context;
      const startTime = Date.now();

      // Skip audit for certain routes
      if (this.shouldSkipRoute(request, finalConfig.skipRoutes || [])) {
        await next();
        return;
      }

      // Generate audit event base
      const auditEvent: Partial<AuditEvent> = {
        id: this.generateAuditId(),
        userId: context.user?.id,
        sessionId: context.session?.id,
        action: this.extractAction(request),
        resource: this.extractResource(request),
        resourceId: this.extractResourceId(request),
        ip: request.ip || "unknown",
        userAgent: request.headers["user-agent"] || "unknown",
        timestamp: new Date(),
        metadata: {
          method: request.method,
          url: request.url,
          headers: this.sanitizeHeaders(request.headers, finalConfig.sensitiveFields || []),
          ...(finalConfig.includeBody && request.body
            ? { body: this.sanitizeBody(request.body, finalConfig) }
            : {}),
        },
      };

      let responseData: any = null;
      let error: Error | null = null;

      try {
        // Execute request
        await next();

        // Capture response
        if (finalConfig.includeResponse && context.response) {
          responseData = this.sanitizeBody(context.response, finalConfig);
        }

        auditEvent.result = "success";
        auditEvent.statusCode = set.status || 200;
      } catch (err) {
        error = err as Error;
        auditEvent.result = "failure";
        auditEvent.statusCode = set.status || 500;
        auditEvent.error = error.message;
      } finally {
        // Calculate duration
        auditEvent.duration = Date.now() - startTime;

        // Add response data if needed
        if (responseData) {
          auditEvent.metadata!.response = responseData;
        }

        // Log the audit event
        await this.logAuditEvent(auditEvent as AuditEvent, finalConfig);

        // Re-throw error if it occurred
        if (error) {
          throw error;
        }
      }
    };
  }

  /**
   * Create middleware for specific actions
   */
  auditAction(action: string, resource: string, config?: Partial<AuditConfig>) {
    const finalConfig = { ...this.defaultConfig, ...config };

    return async (context: any, next: () => Promise<void>) => {
      const startTime = Date.now();

      const auditEvent: Partial<AuditEvent> = {
        id: this.generateAuditId(),
        userId: context.user?.id,
        sessionId: context.session?.id,
        action,
        resource,
        resourceId: context.params?.id || context.query?.id,
        ip: context.request.ip || "unknown",
        userAgent: context.request.headers["user-agent"] || "unknown",
        timestamp: new Date(),
      };

      try {
        await next();
        auditEvent.result = "success";
        auditEvent.statusCode = context.set.status || 200;
      } catch (error) {
        auditEvent.result = "failure";
        auditEvent.statusCode = context.set.status || 500;
        auditEvent.error = (error as Error).message;
        throw error;
      } finally {
        auditEvent.duration = Date.now() - startTime;
        await this.logAuditEvent(auditEvent as AuditEvent, finalConfig);
      }
    };
  }

  /**
   * Log successful request
   */
  private async logSuccessfulRequest(context: any, config: AuditConfig): Promise<void> {
    const { request, response, auditContext, user, session } = context;
    const duration = Date.now() - auditContext.startTime;

    const auditEvent: AuditEvent = {
      id: auditContext.auditId,
      userId: user?.id,
      sessionId: session?.id,
      action: this.extractAction(request),
      resource: this.extractResource(request),
      resourceId: this.extractResourceId(request),
      ip: request.ip || "unknown",
      userAgent: request.headers?.["user-agent"] || "unknown",
      timestamp: new Date(),
      result: "success",
      statusCode: response?.status || 200,
      duration,
      metadata: {
        method: request.method,
        url: request.url,
        ...(config.includeBody && request.body
          ? { body: this.sanitizeBody(request.body, config) }
          : {}),
        ...(config.includeResponse && response
          ? { response: this.sanitizeBody(response, config) }
          : {}),
      },
    };

    await this.logAuditEvent(auditEvent, config);
  }

  /**
   * Log failed request
   */
  private async logFailedRequest(context: any, config: AuditConfig): Promise<void> {
    const { request, error, auditContext, user, session, set } = context;
    const duration = Date.now() - auditContext.startTime;

    const auditEvent: AuditEvent = {
      id: auditContext.auditId,
      userId: user?.id,
      sessionId: session?.id,
      action: this.extractAction(request),
      resource: this.extractResource(request),
      resourceId: this.extractResourceId(request),
      ip: request.ip || "unknown",
      userAgent: request.headers?.["user-agent"] || "unknown",
      timestamp: new Date(),
      result: "failure",
      statusCode: set?.status || 500,
      duration,
      error: error?.message || "Unknown error",
      metadata: {
        method: request.method,
        url: request.url,
        ...(config.includeBody && request.body
          ? { body: this.sanitizeBody(request.body, config) }
          : {}),
      },
    };

    await this.logAuditEvent(auditEvent, config);
  }

  /**
   * Log audit event to storage
   */
  async logAuditEvent(event: AuditEvent, config?: Partial<AuditConfig>): Promise<void> {
    const finalConfig = { ...this.defaultConfig, ...config };

    try {
      // Store in Redis for quick access if configured
      if (finalConfig.storageStrategy === "redis" || finalConfig.storageStrategy === "both") {
        const redisClient = RedisClient.getInstance();
        const redisKey = `audit:${event.id}`;
        await redisClient.setex(redisKey, finalConfig.redisTtl || 604800, JSON.stringify(event));
      }

      // Store in ClickHouse for long-term analytics if configured
      if (finalConfig.storageStrategy === "clickhouse" || finalConfig.storageStrategy === "both") {
        await ClickHouseClient.insert("audit_events", [
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

      // Record metrics
      await this.metrics.recordCounter(`audit_events_${event.result}`);
      await this.metrics.recordTimer("audit_event_duration", event.duration || 0);

      // Log for monitoring
      this.logger.info("Audit event recorded", {
        id: event.id,
        action: event.action,
        resource: event.resource,
        result: event.result,
        duration: event.duration,
      });
    } catch (error) {
      this.logger.error("Failed to log audit event", error as Error, {
        eventId: event.id,
      });
      // Don't throw - auditing failures shouldn't break the application
    }
  }

  /**
   * Query audit events
   */
  async queryAuditEvents(query: AuditQuery): Promise<AuditEvent[]> {
    try {
      let sql = "SELECT * FROM audit_events WHERE 1=1";
      const queryParams: Record<string, any> = {};

      if (query.userId) {
        sql += " AND user_id = {userId:String}";
        queryParams.userId = query.userId;
      }

      if (query.action) {
        sql += " AND action = {action:String}";
        queryParams.action = query.action;
      }

      if (query.resource) {
        sql += " AND resource = {resource:String}";
        queryParams.resource = query.resource;
      }

      if (query.result) {
        sql += " AND result = {result:String}";
        queryParams.result = query.result;
      }

      if (query.ip) {
        sql += " AND ip = {ip:String}";
        queryParams.ip = query.ip;
      }

      if (query.startDate) {
        sql += " AND timestamp >= {startDate:DateTime}";
        queryParams.startDate = query.startDate.toISOString();
      }

      if (query.endDate) {
        sql += " AND timestamp <= {endDate:DateTime}";
        queryParams.endDate = query.endDate.toISOString();
      }

      sql += " ORDER BY timestamp DESC";

      if (query.limit) {
        sql += " LIMIT {limit:UInt32}";
        queryParams.limit = query.limit;
      }

      if (query.offset) {
        sql += " OFFSET {offset:UInt32}";
        queryParams.offset = query.offset;
      }

      const rows = await ClickHouseClient.execute(sql, queryParams);

      return rows.map((row: any) => ({
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
      }));
    } catch (error) {
      this.logger.error("Failed to query audit events", error as Error, query);
      throw error;
    }
  }

  /**
   * Get audit summary
   */
  async getAuditSummary(startDate: Date, endDate: Date): Promise<AuditSummary> {
    try {
      const queryParams = {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      };

      // Total events and results breakdown
      const summaryQuery = `
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

      const summaryResults = await ClickHouseClient.execute(summaryQuery, queryParams);

      // Top actions
      const actionsQuery = `
        SELECT action, COUNT(*) as count
        FROM audit_events 
        WHERE timestamp BETWEEN {startDate:DateTime} AND {endDate:DateTime}
        GROUP BY action
        ORDER BY count DESC
        LIMIT 10
      `;

      const actionsResults = await ClickHouseClient.execute(actionsQuery, queryParams);

      // Top resources
      const resourcesQuery = `
        SELECT resource, COUNT(*) as count
        FROM audit_events 
        WHERE timestamp BETWEEN {startDate:DateTime} AND {endDate:DateTime}
        GROUP BY resource
        ORDER BY count DESC
        LIMIT 10
      `;

      const resourcesResults = await ClickHouseClient.execute(resourcesQuery, queryParams);

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
      throw error;
    }
  }

  /**
   * Pre-configured audit middleware for different operation types
   */

  // GDPR operations audit
  gdprAudit(config?: Partial<AuditConfig>) {
    return this.auditAction("gdpr_operation", "data_subject", config);
  }

  // Data export audit
  exportAudit(config?: Partial<AuditConfig>) {
    return this.auditAction("data_export", "export", config);
  }

  // Feature store audit
  featureStoreAudit(config?: Partial<AuditConfig>) {
    return this.auditAction("feature_operation", "feature_store", config);
  }

  // Security operations audit
  securityAudit(config?: Partial<AuditConfig>) {
    return this.auditAction("security_operation", "security", config);
  }

  // Business intelligence audit
  biAudit(config?: Partial<AuditConfig>) {
    return this.auditAction("bi_operation", "business_intelligence", config);
  }

  /**
   * Helper methods
   */

  private shouldSkipRoute(request: any, skipRoutes: string[]): boolean {
    const path = request.url || request.path || "/";
    return skipRoutes.some(route => path.includes(route));
  }

  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private extractAction(request: any): string {
    const method = request.method.toLowerCase();
    const path = request.url.split("?")[0];

    // Extract action from path and method
    if (path.includes("/gdpr/")) return "gdpr_operation";
    if (path.includes("/export/")) return "data_export";
    if (path.includes("/features/")) return "feature_operation";
    if (path.includes("/security/")) return "security_operation";
    if (path.includes("/business-intelligence/")) return "bi_operation";
    if (path.includes("/data-quality/")) return "data_quality_operation";
    if (path.includes("/reconciliation/")) return "reconciliation_operation";

    return `${method}_request`;
  }

  private extractResource(request: any): string {
    const path = request.url.split("?")[0];
    const segments = path.split("/").filter(Boolean);

    // Return the main resource from the path
    if (segments.length > 0) {
      return segments[0];
    }

    return "unknown";
  }

  private extractResourceId(request: any): string | undefined {
    const path = request.url.split("?")[0];
    const segments = path.split("/").filter(Boolean);

    // Look for ID-like segments (UUID or numeric)
    for (const segment of segments) {
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
        /^\d+$/.test(segment)
      ) {
        return segment;
      }
    }

    return request.params?.id || request.query?.id;
  }

  private sanitizeHeaders(
    headers: Record<string, any>,
    sensitiveFields: string[]
  ): Record<string, any> {
    const sanitized = { ...headers };

    for (const field of sensitiveFields) {
      const key = Object.keys(sanitized).find((k) =>
        k.toLowerCase().includes(field.toLowerCase())
      );
      if (key) {
        sanitized[key] = "[REDACTED]";
      }
    }

    return sanitized;
  }

  private sanitizeBody(obj: any, config: AuditConfig): any {
    if (!obj || typeof obj !== "object") return obj;

    const sensitiveFields = config.sensitiveFields || [];
    const maxBodySize = config.maxBodySize || 1024;

    try {
      let sanitized = this.sanitizeObject(obj, sensitiveFields);

      // Check size
      const bodyStr = JSON.stringify(sanitized);
      if (bodyStr.length > maxBodySize) {
        return `[TRUNCATED - ${bodyStr.length} bytes]`;
      }

      return sanitized;
    } catch {
      return "[UNPARSEABLE]";
    }
  }

  private sanitizeObject(obj: any, sensitiveFields: string[]): any {
    if (!obj || typeof obj !== "object") return obj;

    const sanitized = Array.isArray(obj) ? [...obj] : { ...obj };

    for (const [key, value] of Object.entries(sanitized)) {
      if (
        sensitiveFields.some((field) =>
          key.toLowerCase().includes(field.toLowerCase())
        )
      ) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "object" && value !== null) {
        sanitized[key] = this.sanitizeObject(value, sensitiveFields);
      }
    }

    return sanitized;
  }

  /**
   * Create preset configurations for different environments
   */
  static createDevelopmentConfig(): AuditConfig {
    return {
      includeBody: true,
      includeResponse: true,
      storageStrategy: "redis",
      redisTtl: 3600, // 1 hour
      maxBodySize: 1024 * 50, // 50KB
    };
  }

  static createProductionConfig(): AuditConfig {
    return {
      includeBody: false,
      includeResponse: false,
      storageStrategy: "both",
      redisTtl: 7 * 24 * 3600, // 7 days
      maxBodySize: 1024 * 5, // 5KB
    };
  }

  static createGDPRConfig(): AuditConfig {
    return {
      includeBody: true,
      includeResponse: true,
      storageStrategy: "both",
      redisTtl: 30 * 24 * 3600, // 30 days
      maxBodySize: 1024 * 100, // 100KB
      skipRoutes: [], // Audit everything for GDPR
    };
  }
}

/**
 * Factory function for easy middleware creation
 */
export function createAuditMiddleware(config?: Partial<AuditConfig>) {
  const redis = RedisClient.getInstance();
  const clickhouse = ClickHouseClient.getInstance();
  const logger = new Logger("Shared Audit Middleware");
  const metrics = new MetricsCollector("audit");
  
  const middleware = new AuditMiddleware(redis, clickhouse, logger, metrics);
  return middleware.elysia(config);
}