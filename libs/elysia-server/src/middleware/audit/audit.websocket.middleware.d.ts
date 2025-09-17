/**
 * WebSocket Audit Middleware
 * Production-grade WebSocket audit middleware following BaseWebSocketMiddleware patterns
 * Provides comprehensive audit trail functionality for WebSocket connections and messages
 */
import { type IMetricsCollector } from "@libs/monitoring";
import { BaseWebSocketMiddleware, type WebSocketMiddlewareConfig } from "../base";
import type { WebSocketContext } from "../types";
import { RedisClient, ClickHouseClient } from "@libs/database";
/**
 * WebSocket audit event interface for tracking WebSocket activities
 */
export interface WebSocketAuditEvent {
    id: string;
    eventType: "connection" | "message" | "disconnection" | "error";
    connectionId: string;
    userId?: string | undefined;
    sessionId?: string | undefined;
    messageType?: string | undefined;
    action: string;
    resource: string;
    resourceId?: string | undefined;
    ip: string;
    userAgent?: string | undefined;
    timestamp: Date;
    metadata?: Record<string, any> | undefined;
    result: "success" | "failure" | "partial";
    duration?: number | undefined;
    error?: string | undefined;
    messageSize?: number | undefined;
    rooms?: string[] | undefined;
}
/**
 * WebSocket audit query interface for event retrieval
 */
export interface WebSocketAuditQuery {
    readonly connectionId?: string;
    readonly userId?: string;
    readonly eventType?: "connection" | "message" | "disconnection" | "error";
    readonly messageType?: string;
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
 * WebSocket audit summary interface for analytics
 */
export interface WebSocketAuditSummary {
    readonly totalEvents: number;
    readonly connectionEvents: number;
    readonly messageEvents: number;
    readonly disconnectionEvents: number;
    readonly errorEvents: number;
    readonly uniqueConnections: number;
    readonly uniqueUsers: number;
    readonly topMessageTypes: ReadonlyArray<{
        messageType: string;
        count: number;
    }>;
    readonly topActions: ReadonlyArray<{
        action: string;
        count: number;
    }>;
    readonly averageMessageSize: number;
    readonly averageSessionDuration: number;
}
/**
 * WebSocket audit middleware configuration interface
 * Extends WebSocketMiddlewareConfig with audit-specific options
 */
export interface AuditWebSocketMiddlewareConfig extends WebSocketMiddlewareConfig {
    readonly logConnections?: boolean;
    readonly logMessages?: boolean;
    readonly logDisconnections?: boolean;
    readonly logErrors?: boolean;
    readonly includePayload?: boolean;
    readonly includeMetadata?: boolean;
    readonly sensitiveFields?: readonly string[];
    readonly skipMessageTypes?: readonly string[];
    readonly storageStrategy?: "redis" | "clickhouse" | "both";
    readonly redisTtl?: number;
    readonly maxPayloadSize?: number;
    readonly enableRealTimeAnalytics?: boolean;
    readonly retentionDays?: number;
    readonly anonymizePersonalData?: boolean;
    readonly complianceMode?: "GDPR" | "SOX" | "HIPAA" | "PCI_DSS" | "standard";
    readonly trackRooms?: boolean;
    readonly trackMessageSize?: boolean;
    readonly batchInserts?: boolean;
    readonly batchSize?: number;
    readonly flushInterval?: number;
}
/**
 * Production-grade WebSocket Audit Middleware
 * Framework-agnostic implementation with comprehensive WebSocket audit trail support
 *
 * Features:
 * - Connection lifecycle tracking (connect/disconnect)
 * - Message-level auditing with configurable detail
 * - Real-time analytics and querying
 * - Multi-storage strategy (Redis + ClickHouse)
 * - Compliance-ready audit trails (GDPR, SOX, HIPAA, PCI DSS)
 * - Automatic data sanitization and anonymization
 * - Performance optimized with batching
 * - Room and namespace tracking
 * - Message size and frequency analytics
 * - Error tracking and monitoring
 *
 * @template AuditWebSocketMiddlewareConfig - WebSocket audit-specific configuration
 */
export declare class AuditWebSocketMiddleware extends BaseWebSocketMiddleware<AuditWebSocketMiddlewareConfig> {
    private readonly redisClient;
    private readonly clickhouseClient;
    private readonly connectionStartTimes;
    private readonly eventBatch;
    private batchFlushTimer?;
    constructor(metrics: IMetricsCollector, redisClient: RedisClient, clickhouseClient: ClickHouseClient, config?: Partial<AuditWebSocketMiddlewareConfig>);
    /**
     * Main execution method implementing WebSocket audit trail logic
     */
    protected execute(context: WebSocketContext, next: () => Promise<void>): Promise<void>;
    /**
     * Log connection event (connect/disconnect)
     */
    logConnectionEvent(context: WebSocketContext, eventType: "connection" | "disconnection"): Promise<void>;
    /**
     * Log error event
     */
    logErrorEvent(context: WebSocketContext, error: Error): Promise<void>;
    /**
     * Store audit event using configured storage strategy
     */
    private storeAuditEvent;
    /**
     * Store event immediately (non-batched)
     */
    private storeEventImmediate;
    /**
     * Flush batched events to storage
     */
    private flushEventBatch;
    /**
     * Store audit event in Redis for fast access
     */
    private storeInRedis;
    /**
     * Store audit events in ClickHouse for analytics
     */
    private storeInClickHouse;
    /**
     * Query WebSocket audit events from ClickHouse
     */
    queryAuditEvents(query: WebSocketAuditQuery): Promise<WebSocketAuditEvent[]>;
    /**
     * Get WebSocket audit summary for analytics
     */
    getAuditSummary(startDate: Date, endDate: Date): Promise<WebSocketAuditSummary>;
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
    private calculateMessageSize;
    private generateAuditId;
    /**
     * Build metadata object with message and connection information
     */
    private buildMetadata;
    /**
     * Build connection metadata for connection events
     */
    private buildConnectionMetadata;
    /**
     * Sanitize message payload based on configuration
     */
    private sanitizePayload;
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
     * Setup batch flush timer
     */
    private setupBatchFlushTimer;
    /**
     * Cleanup method - call when shutting down
     */
    cleanup(): Promise<void>;
    /**
     * Validate middleware configuration
     */
    private validateConfiguration;
    /**
     * Map database row to WebSocketAuditEvent
     */
    private mapRowToAuditEvent;
    /**
     * Get summary statistics
     */
    private getSummaryStats;
    /**
     * Get top message types
     */
    private getTopMessageTypes;
    /**
     * Get top actions
     */
    private getTopActions;
    /**
     * Enhanced error handling
     */
    protected handleError(error: Error, context: any): Promise<void>;
}
//# sourceMappingURL=audit.websocket.middleware.d.ts.map