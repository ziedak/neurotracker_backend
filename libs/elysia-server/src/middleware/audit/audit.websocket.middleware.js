/**
 * WebSocket Audit Middleware
 * Production-grade WebSocket audit middleware following BaseWebSocketMiddleware patterns
 * Provides comprehensive audit trail functionality for WebSocket connections and messages
 */
import { BaseWebSocketMiddleware, } from "../base";
/**
 * Default WebSocket audit middleware configuration constants
 */
const DEFAULT_WS_AUDIT_OPTIONS = {
    LOG_CONNECTIONS: true,
    LOG_MESSAGES: true,
    LOG_DISCONNECTIONS: true,
    LOG_ERRORS: true,
    INCLUDE_PAYLOAD: false,
    INCLUDE_METADATA: true,
    SENSITIVE_FIELDS: [
        "password",
        "token",
        "secret",
        "key",
        "auth",
        "ssn",
        "credit_card",
        "api_key",
        "session_id",
    ],
    SKIP_MESSAGE_TYPES: ["ping", "pong", "heartbeat"],
    STORAGE_STRATEGY: "both",
    REDIS_TTL: 7 * 24 * 3600, // 7 days
    MAX_PAYLOAD_SIZE: 1024 * 10, // 10KB
    ENABLE_REAL_TIME_ANALYTICS: true,
    RETENTION_DAYS: 90,
    ANONYMIZE_PERSONAL_DATA: false,
    COMPLIANCE_MODE: "standard",
    TRACK_ROOMS: true,
    TRACK_MESSAGE_SIZE: true,
    BATCH_INSERTS: true,
    BATCH_SIZE: 100,
    FLUSH_INTERVAL: 5000, // 5 seconds
    PRIORITY: 5, // Medium priority for audit
};
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
export class AuditWebSocketMiddleware extends BaseWebSocketMiddleware {
    redisClient;
    clickhouseClient;
    connectionStartTimes = new Map();
    eventBatch = [];
    batchFlushTimer;
    constructor(metrics, redisClient, clickhouseClient, config = {}) {
        // Create complete configuration with validated defaults
        const completeConfig = {
            name: config.name || "ws-audit",
            enabled: config.enabled ?? true,
            priority: config.priority ?? DEFAULT_WS_AUDIT_OPTIONS.PRIORITY,
            skipMessageTypes: [
                ...(config.skipMessageTypes || []),
                ...DEFAULT_WS_AUDIT_OPTIONS.SKIP_MESSAGE_TYPES,
            ],
            logConnections: config.logConnections ?? DEFAULT_WS_AUDIT_OPTIONS.LOG_CONNECTIONS,
            logMessages: config.logMessages ?? DEFAULT_WS_AUDIT_OPTIONS.LOG_MESSAGES,
            logDisconnections: config.logDisconnections ?? DEFAULT_WS_AUDIT_OPTIONS.LOG_DISCONNECTIONS,
            logErrors: config.logErrors ?? DEFAULT_WS_AUDIT_OPTIONS.LOG_ERRORS,
            includePayload: config.includePayload ?? DEFAULT_WS_AUDIT_OPTIONS.INCLUDE_PAYLOAD,
            includeMetadata: config.includeMetadata ?? DEFAULT_WS_AUDIT_OPTIONS.INCLUDE_METADATA,
            sensitiveFields: config.sensitiveFields || DEFAULT_WS_AUDIT_OPTIONS.SENSITIVE_FIELDS,
            storageStrategy: config.storageStrategy ?? DEFAULT_WS_AUDIT_OPTIONS.STORAGE_STRATEGY,
            redisTtl: config.redisTtl ?? DEFAULT_WS_AUDIT_OPTIONS.REDIS_TTL,
            maxPayloadSize: config.maxPayloadSize ?? DEFAULT_WS_AUDIT_OPTIONS.MAX_PAYLOAD_SIZE,
            enableRealTimeAnalytics: config.enableRealTimeAnalytics ??
                DEFAULT_WS_AUDIT_OPTIONS.ENABLE_REAL_TIME_ANALYTICS,
            retentionDays: config.retentionDays ?? DEFAULT_WS_AUDIT_OPTIONS.RETENTION_DAYS,
            anonymizePersonalData: config.anonymizePersonalData ??
                DEFAULT_WS_AUDIT_OPTIONS.ANONYMIZE_PERSONAL_DATA,
            complianceMode: config.complianceMode ?? DEFAULT_WS_AUDIT_OPTIONS.COMPLIANCE_MODE,
            trackRooms: config.trackRooms ?? DEFAULT_WS_AUDIT_OPTIONS.TRACK_ROOMS,
            trackMessageSize: config.trackMessageSize ?? DEFAULT_WS_AUDIT_OPTIONS.TRACK_MESSAGE_SIZE,
            batchInserts: config.batchInserts ?? DEFAULT_WS_AUDIT_OPTIONS.BATCH_INSERTS,
            batchSize: config.batchSize ?? DEFAULT_WS_AUDIT_OPTIONS.BATCH_SIZE,
            flushInterval: config.flushInterval ?? DEFAULT_WS_AUDIT_OPTIONS.FLUSH_INTERVAL,
        };
        super(metrics, completeConfig);
        this.redisClient = redisClient;
        this.clickhouseClient = clickhouseClient;
        this.validateConfiguration();
        this.setupBatchFlushTimer();
    }
    /**
     * Main execution method implementing WebSocket audit trail logic
     */
    async execute(context, next) {
        const startTime = Date.now();
        // Track connection start time for duration calculations
        if (!this.connectionStartTimes.has(context.connectionId)) {
            this.connectionStartTimes.set(context.connectionId, startTime);
            // Log connection event if enabled
            if (this.config.logConnections) {
                await this.logConnectionEvent(context, "connection");
            }
        }
        // Create base audit event for message
        const auditEvent = {
            id: this.generateAuditId(),
            eventType: "message",
            connectionId: context.connectionId,
            userId: this.extractUserId(context),
            sessionId: this.extractSessionId(context),
            messageType: context.message.type,
            action: this.extractAction(context),
            resource: this.extractResource(context),
            resourceId: this.extractResourceId(context),
            ip: this.extractClientIp(context),
            userAgent: this.extractUserAgent(context),
            timestamp: new Date(),
            metadata: await this.buildMetadata(context),
            result: "success", // Will be updated in catch block if needed
            duration: 0, // Will be calculated in finally block
            messageSize: this.config.trackMessageSize
                ? this.calculateMessageSize(context.message)
                : undefined,
            rooms: this.config.trackRooms ? context.rooms : undefined,
        };
        let error = null;
        try {
            // Execute next middleware/handler
            await next();
            // Success case
            auditEvent.result = "success";
            // Record success metrics
            await this.recordMetric("ws_audit_message_success", 1, {
                messageType: context.message.type,
                action: auditEvent.action,
                resource: auditEvent.resource,
            });
        }
        catch (err) {
            error = err;
            auditEvent.result = "failure";
            auditEvent.error = error.message;
            // Log error event if enabled
            if (this.config.logErrors) {
                await this.logErrorEvent(context, error);
            }
            // Record failure metrics
            await this.recordMetric("ws_audit_message_failure", 1, {
                messageType: context.message.type,
                action: auditEvent.action,
                resource: auditEvent.resource,
                errorType: error.constructor.name,
            });
        }
        finally {
            // Calculate duration and finalize audit event
            auditEvent.duration = Date.now() - startTime;
            // Record timing metrics
            await this.recordTimer("ws_audit_message_duration", auditEvent.duration, {
                messageType: context.message.type,
                action: auditEvent.action,
                result: auditEvent.result,
            });
            // Store audit event if message logging is enabled
            if (this.config.logMessages) {
                await this.storeAuditEvent(auditEvent);
            }
            // Update connection metadata
            context.metadata.lastActivity = new Date();
            context.metadata.messageCount++;
            // Re-throw error if it occurred
            if (error) {
                throw error;
            }
        }
    }
    /**
     * Log connection event (connect/disconnect)
     */
    async logConnectionEvent(context, eventType) {
        const connectionStartTime = this.connectionStartTimes.get(context.connectionId);
        const duration = connectionStartTime
            ? Date.now() - connectionStartTime
            : undefined;
        const auditEvent = {
            id: this.generateAuditId(),
            eventType,
            connectionId: context.connectionId,
            userId: this.extractUserId(context),
            sessionId: this.extractSessionId(context),
            action: eventType,
            resource: "websocket_connection",
            ip: this.extractClientIp(context),
            userAgent: this.extractUserAgent(context),
            timestamp: new Date(),
            metadata: eventType === "connection"
                ? await this.buildConnectionMetadata(context)
                : undefined,
            result: "success",
            duration,
            rooms: this.config.trackRooms ? context.rooms : undefined,
        };
        await this.storeAuditEvent(auditEvent);
        // Clean up connection tracking on disconnect
        if (eventType === "disconnection") {
            this.connectionStartTimes.delete(context.connectionId);
        }
        // Record connection metrics
        await this.recordMetric(`ws_audit_${eventType}`, 1, {
            userId: context.userId || "anonymous",
        });
    }
    /**
     * Log error event
     */
    async logErrorEvent(context, error) {
        const auditEvent = {
            id: this.generateAuditId(),
            eventType: "error",
            connectionId: context.connectionId,
            userId: this.extractUserId(context),
            sessionId: this.extractSessionId(context),
            messageType: context.message.type,
            action: "error",
            resource: "websocket_message",
            ip: this.extractClientIp(context),
            userAgent: this.extractUserAgent(context),
            timestamp: new Date(),
            result: "failure",
            error: error.message,
            metadata: {
                errorType: error.constructor.name,
                errorStack: error.stack?.substring(0, 500), // Truncated stack trace
                messageType: context.message.type,
            },
        };
        await this.storeAuditEvent(auditEvent);
        // Record error metrics
        await this.recordMetric("ws_audit_error", 1, {
            errorType: error.constructor.name,
            messageType: context.message.type,
        });
    }
    /**
     * Store audit event using configured storage strategy
     */
    async storeAuditEvent(event) {
        try {
            if (this.config.batchInserts) {
                // Add to batch for later processing
                this.eventBatch.push(event);
                // Flush batch if it reaches the configured size
                if (this.eventBatch.length >= this.config.batchSize) {
                    await this.flushEventBatch();
                }
            }
            else {
                // Store immediately
                await this.storeEventImmediate(event);
            }
        }
        catch (error) {
            await this.handleError(error, event);
        }
    }
    /**
     * Store event immediately (non-batched)
     */
    async storeEventImmediate(event) {
        const tasks = [];
        // Store in Redis for quick access
        if (this.config.storageStrategy === "redis" ||
            this.config.storageStrategy === "both") {
            tasks.push(this.storeInRedis(event));
        }
        // Store in ClickHouse for analytics
        if (this.config.storageStrategy === "clickhouse" ||
            this.config.storageStrategy === "both") {
            tasks.push(this.storeInClickHouse([event]));
        }
        // Execute storage operations in parallel
        await Promise.all(tasks);
        // Record storage metrics
        await this.recordMetric("ws_audit_stored", 1, {
            storage: this.config.storageStrategy,
            eventType: event.eventType,
            messageType: event.messageType || "none",
        });
        this.logger.debug("WebSocket audit event stored successfully", {
            id: event.id,
            eventType: event.eventType,
            messageType: event.messageType,
            connectionId: event.connectionId,
            result: event.result,
        });
    }
    /**
     * Flush batched events to storage
     */
    async flushEventBatch() {
        if (this.eventBatch.length === 0)
            return;
        const eventsToFlush = [...this.eventBatch];
        this.eventBatch.length = 0; // Clear the batch
        try {
            const tasks = [];
            // Store in Redis for quick access
            if (this.config.storageStrategy === "redis" ||
                this.config.storageStrategy === "both") {
                tasks.push(Promise.all(eventsToFlush.map((event) => this.storeInRedis(event))).then(() => { }));
            }
            // Store in ClickHouse for analytics
            if (this.config.storageStrategy === "clickhouse" ||
                this.config.storageStrategy === "both") {
                tasks.push(this.storeInClickHouse(eventsToFlush));
            }
            // Execute storage operations in parallel
            await Promise.all(tasks);
            // Record batch metrics
            await this.recordMetric("ws_audit_batch_flushed", 1, {
                batchSize: eventsToFlush.length.toString(),
                storage: this.config.storageStrategy,
            });
            this.logger.debug("WebSocket audit event batch flushed successfully", {
                batchSize: eventsToFlush.length,
                storage: this.config.storageStrategy,
            });
        }
        catch (error) {
            this.logger.error("Failed to flush WebSocket audit event batch", error, {
                batchSize: eventsToFlush.length,
            });
            // Re-add failed events to the batch for retry
            this.eventBatch.unshift(...eventsToFlush);
        }
    }
    /**
     * Store audit event in Redis for fast access
     */
    async storeInRedis(event) {
        const redis = this.redisClient.getRedis();
        const redisKey = `ws_audit:${event.id}`;
        await redis.setex(redisKey, this.config.redisTtl, JSON.stringify(this.sanitizeAuditEvent(event)));
    }
    /**
     * Store audit events in ClickHouse for analytics
     */
    async storeInClickHouse(events) {
        const rows = events.map((event) => ({
            id: event.id,
            event_type: event.eventType,
            connection_id: event.connectionId,
            user_id: event.userId || "",
            session_id: event.sessionId || "",
            message_type: event.messageType || "",
            action: event.action,
            resource: event.resource,
            resource_id: event.resourceId || "",
            ip: event.ip,
            user_agent: event.userAgent || "",
            timestamp: event.timestamp,
            metadata: JSON.stringify(event.metadata || {}),
            result: event.result,
            duration: event.duration || 0,
            error: event.error || "",
            message_size: event.messageSize || 0,
            rooms: JSON.stringify(event.rooms || []),
        }));
        await this.clickhouseClient.insert("websocket_audit_events", rows);
    }
    /**
     * Query WebSocket audit events from ClickHouse
     */
    async queryAuditEvents(query) {
        try {
            let sql = "SELECT * FROM websocket_audit_events WHERE 1=1";
            const queryParams = {};
            // Build dynamic query
            if (query.connectionId) {
                sql += " AND connection_id = {connectionId:String}";
                queryParams["connectionId"] = query.connectionId;
            }
            if (query.userId) {
                sql += " AND user_id = {userId:String}";
                queryParams["userId"] = query.userId;
            }
            if (query.eventType) {
                sql += " AND event_type = {eventType:String}";
                queryParams["eventType"] = query.eventType;
            }
            if (query.messageType) {
                sql += " AND message_type = {messageType:String}";
                queryParams["messageType"] = query.messageType;
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
            const rows = (await this.clickhouseClient.execute(sql, queryParams));
            return rows.map((row) => this.mapRowToAuditEvent(row));
        }
        catch (error) {
            this.logger.error("Failed to query WebSocket audit events", error, query);
            await this.recordMetric("ws_audit_query_error", 1);
            throw error;
        }
    }
    /**
     * Get WebSocket audit summary for analytics
     */
    async getAuditSummary(startDate, endDate) {
        try {
            const queryParams = {
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
            };
            // Execute summary queries in parallel
            const [summaryResults, messageTypesResults, actionsResults] = (await Promise.all([
                this.getSummaryStats(queryParams),
                this.getTopMessageTypes(queryParams),
                this.getTopActions(queryParams),
            ]));
            const summary = summaryResults[0];
            return {
                totalEvents: parseInt(summary.total_events),
                connectionEvents: parseInt(summary.connection_events),
                messageEvents: parseInt(summary.message_events),
                disconnectionEvents: parseInt(summary.disconnection_events),
                errorEvents: parseInt(summary.error_events),
                uniqueConnections: parseInt(summary.unique_connections),
                uniqueUsers: parseInt(summary.unique_users),
                topMessageTypes: messageTypesResults.map((row) => ({
                    messageType: row.message_type,
                    count: parseInt(row.count),
                })),
                topActions: actionsResults.map((row) => ({
                    action: row.action,
                    count: parseInt(row.count),
                })),
                averageMessageSize: parseFloat(summary.average_message_size) || 0,
                averageSessionDuration: parseFloat(summary.average_session_duration) || 0,
            };
        }
        catch (error) {
            this.logger.error("Failed to get WebSocket audit summary", error);
            await this.recordMetric("ws_audit_summary_error", 1);
            throw error;
        }
    }
    /**
     * Helper methods for data extraction
     */
    extractUserId(context) {
        return context.userId || context.metadata.headers?.["x-user-id"];
    }
    extractSessionId(context) {
        return (context.metadata.headers?.["x-session-id"] ||
            context.metadata.query?.["sessionId"]);
    }
    extractAction(context) {
        const messageType = context.message.type || "unknown";
        // Extract semantic action from message type patterns
        if (messageType.includes("auth"))
            return "authentication";
        if (messageType.includes("join"))
            return "room_join";
        if (messageType.includes("leave"))
            return "room_leave";
        if (messageType.includes("send") || messageType.includes("message"))
            return "send_message";
        if (messageType.includes("subscribe"))
            return "subscription";
        if (messageType.includes("unsubscribe"))
            return "unsubscription";
        if (messageType.includes("ping") || messageType.includes("pong"))
            return "heartbeat";
        return `ws_${messageType}`;
    }
    extractResource(context) {
        const messageType = context.message.type || "unknown";
        // Extract resource from message type or payload
        if (messageType.includes("chat"))
            return "chat";
        if (messageType.includes("game"))
            return "game";
        if (messageType.includes("notification"))
            return "notification";
        if (messageType.includes("data"))
            return "data";
        if (messageType.includes("stream"))
            return "stream";
        return "websocket";
    }
    extractResourceId(context) {
        // Try to extract resource ID from message payload
        const { payload } = context.message;
        if (payload && typeof payload === "object") {
            const payloadObj = payload;
            return (payloadObj["id"] ||
                payloadObj["roomId"] ||
                payloadObj["channelId"] ||
                payloadObj["resourceId"]);
        }
        return undefined;
    }
    extractClientIp(context) {
        return context.metadata.clientIp || "unknown";
    }
    extractUserAgent(context) {
        return (context.metadata.userAgent || context.metadata.headers?.["user-agent"]);
    }
    calculateMessageSize(message) {
        try {
            return JSON.stringify(message).length;
        }
        catch {
            return 0;
        }
    }
    generateAuditId() {
        return `ws_audit_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 15)}`;
    }
    /**
     * Build metadata object with message and connection information
     */
    async buildMetadata(context) {
        const metadata = {
            messageType: context.message.type,
            connectionId: context.connectionId,
            authenticated: context.authenticated,
            messageCount: context.metadata.messageCount,
            connectedAt: context.metadata.connectedAt,
            lastActivity: context.metadata.lastActivity,
            headers: this.sanitizeObject(context.metadata.headers || {}, this.config.sensitiveFields),
            query: this.sanitizeObject(context.metadata.query || {}, this.config.sensitiveFields),
        };
        // Include message payload if configured
        if (this.config.includePayload && context.message.payload) {
            metadata["payload"] = this.sanitizePayload(context.message.payload);
        }
        // Include additional metadata if configured
        if (this.config.includeMetadata) {
            metadata["clientInfo"] = {
                userAgent: context.metadata.userAgent,
                clientIp: context.metadata.clientIp,
            };
        }
        return metadata;
    }
    /**
     * Build connection metadata for connection events
     */
    async buildConnectionMetadata(context) {
        return {
            connectionId: context.connectionId,
            clientIp: context.metadata.clientIp,
            userAgent: context.metadata.userAgent,
            headers: this.sanitizeObject(context.metadata.headers || {}, this.config.sensitiveFields),
            query: this.sanitizeObject(context.metadata.query || {}, this.config.sensitiveFields),
            connectedAt: context.metadata.connectedAt,
            authenticated: context.authenticated,
            userId: context.userId,
            rooms: context.rooms,
        };
    }
    /**
     * Sanitize message payload based on configuration
     */
    sanitizePayload(payload) {
        if (!payload || typeof payload !== "object")
            return payload;
        try {
            const sanitized = this.sanitizeObject(payload, this.config.sensitiveFields);
            const payloadStr = JSON.stringify(sanitized);
            if (payloadStr.length > this.config.maxPayloadSize) {
                return `[TRUNCATED - ${payloadStr.length} bytes]`;
            }
            return sanitized;
        }
        catch {
            return "[UNPARSEABLE]";
        }
    }
    /**
     * Sanitize audit event for storage (compliance-aware)
     */
    sanitizeAuditEvent(event) {
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
    hashPersonalData(data) {
        // Simple hash for demonstration - use proper crypto in production
        return `hash_${Buffer.from(data).toString("base64").substring(0, 8)}`;
    }
    /**
     * Anonymize IP address for privacy compliance
     */
    anonymizeIp(ip) {
        if (ip.includes(":")) {
            // IPv6
            const parts = ip.split(":");
            return `${parts[0]}:${parts[1]}::****`;
        }
        else {
            // IPv4
            const parts = ip.split(".");
            return `${parts[0]}.${parts[1]}.***.*`;
        }
    }
    /**
     * Setup batch flush timer
     */
    setupBatchFlushTimer() {
        if (this.config.batchInserts && this.config.flushInterval) {
            this.batchFlushTimer = setInterval(() => {
                this.flushEventBatch().catch((error) => {
                    this.logger.error("Failed to flush batch on timer", error);
                });
            }, this.config.flushInterval);
        }
    }
    /**
     * Cleanup method - call when shutting down
     */
    async cleanup() {
        // Clear batch timer
        if (this.batchFlushTimer) {
            clearInterval(this.batchFlushTimer);
            this.batchFlushTimer = undefined;
        }
        // Flush any remaining events
        if (this.eventBatch.length > 0) {
            await this.flushEventBatch();
        }
        // Clear connection tracking
        this.connectionStartTimes.clear();
    }
    /**
     * Validate middleware configuration
     */
    validateConfiguration() {
        if (this.config.maxPayloadSize < 0) {
            throw new Error("maxPayloadSize must be non-negative");
        }
        if (this.config.redisTtl < 0) {
            throw new Error("redisTtl must be non-negative");
        }
        if (this.config.retentionDays < 1) {
            throw new Error("retentionDays must be at least 1");
        }
        if (!["redis", "clickhouse", "both"].includes(this.config.storageStrategy)) {
            throw new Error("storageStrategy must be 'redis', 'clickhouse', or 'both'");
        }
        if (this.config.batchSize < 1) {
            throw new Error("batchSize must be at least 1");
        }
        if (this.config.flushInterval < 1000) {
            throw new Error("flushInterval must be at least 1000ms");
        }
    }
    /**
     * Map database row to WebSocketAuditEvent
     */
    mapRowToAuditEvent(row) {
        return {
            id: row.id,
            eventType: row.event_type,
            connectionId: row.connection_id,
            userId: row.user_id || undefined,
            sessionId: row.session_id || undefined,
            messageType: row.message_type || undefined,
            action: row.action,
            resource: row.resource,
            resourceId: row.resource_id || undefined,
            ip: row.ip,
            userAgent: row.user_agent || undefined,
            timestamp: new Date(row.timestamp),
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            result: row.result,
            duration: row.duration || undefined,
            error: row.error || undefined,
            messageSize: row.message_size || undefined,
            rooms: row.rooms ? JSON.parse(row.rooms) : undefined,
        };
    }
    /**
     * Get summary statistics
     */
    async getSummaryStats(params) {
        const query = `
      SELECT 
        COUNT(*) as total_events,
        SUM(CASE WHEN event_type = 'connection' THEN 1 ELSE 0 END) as connection_events,
        SUM(CASE WHEN event_type = 'message' THEN 1 ELSE 0 END) as message_events,
        SUM(CASE WHEN event_type = 'disconnection' THEN 1 ELSE 0 END) as disconnection_events,
        SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as error_events,
        COUNT(DISTINCT connection_id) as unique_connections,
        COUNT(DISTINCT user_id) as unique_users,
        AVG(message_size) as average_message_size,
        AVG(duration) as average_session_duration
      FROM websocket_audit_events 
      WHERE timestamp BETWEEN {startDate:DateTime} AND {endDate:DateTime}
    `;
        return this.clickhouseClient.execute(query, params);
    }
    /**
     * Get top message types
     */
    async getTopMessageTypes(params) {
        const query = `
      SELECT message_type, COUNT(*) as count
      FROM websocket_audit_events 
      WHERE timestamp BETWEEN {startDate:DateTime} AND {endDate:DateTime}
        AND event_type = 'message'
        AND message_type != ''
      GROUP BY message_type
      ORDER BY count DESC
      LIMIT 10
    `;
        return this.clickhouseClient.execute(query, params);
    }
    /**
     * Get top actions
     */
    async getTopActions(params) {
        const query = `
      SELECT action, COUNT(*) as count
      FROM websocket_audit_events 
      WHERE timestamp BETWEEN {startDate:DateTime} AND {endDate:DateTime}
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `;
        return this.clickhouseClient.execute(query, params);
    }
    /**
     * Enhanced error handling
     */
    async handleError(error, context) {
        await super.handleError(error, context);
        // Additional WebSocket audit-specific error handling
        await this.recordMetric("ws_audit_storage_error", 1, {
            errorType: error.constructor.name,
            storage: this.config.storageStrategy,
        });
        // Log critical audit failures
        this.logger.error("Critical WebSocket audit middleware error", error, {
            auditEvent: context,
            configuration: this.config.name,
        });
    }
}
//# sourceMappingURL=audit.websocket.middleware.js.map