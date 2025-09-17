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
    metadata?: Record<string, unknown> | undefined;
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
    readonly topActions: ReadonlyArray<{
        action: string;
        count: number;
    }>;
    readonly topResources: ReadonlyArray<{
        resource: string;
        count: number;
    }>;
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
    readonly storageStrategy: "redis" | "clickhouse" | "both";
    readonly redisTtl: number;
    readonly maxBodySize: number;
    readonly enableRealTimeAnalytics?: boolean;
    readonly retentionDays: number;
    readonly anonymizePersonalData?: boolean;
    readonly complianceMode?: "GDPR" | "SOX" | "HIPAA" | "PCI_DSS" | "standard";
}
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
export declare class AuditHttpMiddleware extends BaseMiddleware<AuditHttpMiddlewareConfig> {
    private readonly redisClient;
    private readonly clickhouseClient;
    constructor(metrics: IMetricsCollector, config?: Partial<AuditHttpMiddlewareConfig>, redisClient?: RedisClient, clickhouseClient?: ClickHouseClient);
    /**
     * Main execution method implementing audit trail logic
     */
    protected execute(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
    /**
     * Determine if middleware should skip processing for this context
     */
    protected shouldSkip(context: MiddlewareContext): boolean;
    /**
     * Extract context information for logging and debugging
     */
    protected extractContextInfo(context: MiddlewareContext, extraInfoContext?: Record<string, unknown>): Record<string, unknown>;
    /**
     * Store audit event using configured storage strategy
     */
    private storeAuditEvent;
    /**
     * Store audit event in Redis for fast access
     */
    private storeInRedis;
    /**
     * Store audit event in ClickHouse for analytics
     */
    private storeInClickHouse;
    /**
     * Query audit events from ClickHouse
     */
    queryAuditEvents(query: AuditQuery): Promise<AuditEvent[]>;
    /**
     * Get audit summary for analytics
     */
    getAuditSummary(startDate?: Date, endDate?: Date): Promise<AuditSummary>;
    /**
     * Helper methods for data extraction
     */
    private extractUserId;
    private extractSessionId;
    private extractAction;
    private extractResource;
    private extractResourceId;
    private extractClientIp;
    private extractUserAgent;
    private generateAuditId;
    /**
     * Build metadata object with request/response information
     */
    private buildMetadata;
    /**
     * Sanitize request body based on configuration
     */
    private sanitizeRequestBody;
    /**
     * Sanitize response body based on configuration
     */
    private sanitizeResponseBody;
    /**
     * Sanitize audit event for storage (compliance-aware)
     */
    private sanitizeAuditEvent;
    /**
     * Hash personal data for GDPR compliance
     */
    private hashPersonalData;
    /**
     * Anonymize IP address for privacy compliance
     */
    private anonymizeIp;
    /**
     * Validate middleware configuration
     */
    private validateConfiguration;
    /**
     * Map database row to AuditEvent
     */
    private mapRowToAuditEvent;
    /**
     * Get summary statistics
     */
    private getSummaryStats;
    /**
     * Get top actions
     */
    private getTopActions;
    /**
     * Get top resources
     */
    private getTopResources;
    /**
     * Enhanced error handling
     */
    protected handleError(error: Error, context: AuditEvent | MiddlewareContext): Promise<void>;
}
//# sourceMappingURL=audit.http.middleware.d.ts.map