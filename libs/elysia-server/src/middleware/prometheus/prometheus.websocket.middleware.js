/**
 * Prometheus WebSocket Metrics Middleware
 * Production-grade WebSocket metrics middleware following BaseWebSocketMiddleware patterns
 *
 * Features:
 * - Connection lifecycle tracking
 * - Message type metrics
 * - Performance monitoring
 * - Error tracking
 * - Real-time analytics
 */
import { BaseWebSocketMiddleware, } from "../base";
/**
 * Prometheus WebSocket Metrics Middleware
 * Extends BaseWebSocketMiddleware for WebSocket connection and message tracking
 */
export class PrometheusWebSocketMiddleware extends BaseWebSocketMiddleware {
    serviceName;
    connections = new Map();
    metricsFlushTimer;
    constructor(metrics, config) {
        const defaultConfig = {
            name: config.name || "prometheus-websocket",
            enabled: config.enabled ?? true,
            priority: config.priority ?? 100,
            serviceName: config.serviceName || "websocket-service",
            enableDetailedMetrics: config.enableDetailedMetrics ?? true,
            enableConnectionTracking: config.enableConnectionTracking ?? true,
            enableMessageMetrics: config.enableMessageMetrics ?? true,
            enableErrorTracking: config.enableErrorTracking ?? true,
            trackMessageSize: config.trackMessageSize ?? true,
            trackRooms: config.trackRooms ?? false,
            trackUserMetrics: config.trackUserMetrics ?? true,
            connectionTimeoutMs: config.connectionTimeoutMs ?? 30000,
            metricsFlushInterval: config.metricsFlushInterval ?? 5000,
            skipMessageTypes: config.skipMessageTypes || [
                "ping",
                "pong",
                "heartbeat",
            ],
        };
        super(metrics, defaultConfig);
        this.serviceName = this.config.serviceName ?? "websocket-service";
        // Start metrics flush timer
        if (this.config.metricsFlushInterval ?? 5000 > 0) {
            this.startMetricsFlushTimer();
        }
    }
    /**
     * Main execution method for WebSocket message metrics collection
     */
    async execute(context, next) {
        const startTime = Date.now();
        try {
            // Update connection activity
            this.updateConnectionActivity(context);
            // Record message metrics
            if (this.config.enableMessageMetrics) {
                await this.recordMessageMetrics(context, startTime);
            }
            // Execute next middleware
            await next();
            // Record successful message processing
            await this.recordMetric("websocket_messages_processed_total", 1, {
                message_type: context.message.type,
                service: this.serviceName,
                result: "success",
            });
        }
        catch (error) {
            // Record error metrics
            if (this.config.enableErrorTracking) {
                await this.recordMessageError(context, error);
            }
            throw error;
        }
    }
    /**
     * Handle WebSocket connection events
     */
    async handleConnection(context) {
        if (!this.config.enableConnectionTracking) {
            return;
        }
        const connectionMetrics = {
            connectionId: context.connectionId,
            connectedAt: new Date(),
            userId: context["userId"],
            clientIp: context.metadata.clientIp,
            userAgent: context.metadata.headers["user-agent"],
            messageCount: 0,
            totalMessageSize: 0,
            lastActivity: new Date(),
            rooms: new Set(),
        };
        this.connections.set(context.connectionId, connectionMetrics);
        // Record connection metrics
        await this.recordMetric("websocket_connections_total", 1, {
            service: this.serviceName,
            event: "connected",
        });
        await this.recordMetric("websocket_active_connections", this.connections.size, {
            service: this.serviceName,
        });
        // Record user-specific metrics if enabled
        if (this.config.trackUserMetrics && connectionMetrics.userId) {
            await this.recordMetric("websocket_connections_by_user_total", 1, {
                user_id: connectionMetrics.userId,
                service: this.serviceName,
            });
        }
        this.logger.info("WebSocket connection established", {
            connectionId: context.connectionId,
            userId: connectionMetrics.userId,
            clientIp: connectionMetrics.clientIp,
            service: this.serviceName,
        });
    }
    /**
     * Handle WebSocket disconnection events
     */
    async handleDisconnection(context) {
        if (!this.config.enableConnectionTracking) {
            return;
        }
        const connectionMetrics = this.connections.get(context.connectionId);
        if (!connectionMetrics) {
            return;
        }
        const sessionDuration = Date.now() - connectionMetrics.connectedAt.getTime();
        // Record disconnection metrics
        await this.recordMetric("websocket_connections_total", 1, {
            service: this.serviceName,
            event: "disconnected",
        });
        await this.recordTimer("websocket_session_duration_seconds", sessionDuration, {
            service: this.serviceName,
            user_id: connectionMetrics.userId || "anonymous",
        });
        await this.recordMetric("websocket_active_connections", this.connections.size - 1, {
            service: this.serviceName,
        });
        // Record session summary metrics
        if (this.config.enableDetailedMetrics) {
            await this.recordMetric("websocket_session_messages_total", connectionMetrics.messageCount, {
                service: this.serviceName,
                user_id: connectionMetrics.userId || "anonymous",
            });
            if (this.config.trackMessageSize &&
                connectionMetrics.totalMessageSize > 0) {
                await this.recordHistogram("websocket_session_message_size_bytes", connectionMetrics.totalMessageSize, {
                    service: this.serviceName,
                });
            }
        }
        // Clean up connection tracking
        this.connections.delete(context.connectionId);
        this.logger.info("WebSocket connection closed", {
            connectionId: context.connectionId,
            sessionDuration,
            messageCount: connectionMetrics.messageCount,
            service: this.serviceName,
        });
    }
    /**
     * Handle WebSocket error events
     */
    async handleError(error, context) {
        if (!this.config.enableErrorTracking) {
            return;
        }
        await this.recordMetric("websocket_errors_total", 1, {
            error_type: error.constructor.name,
            connection_id: context.connectionId,
            service: this.serviceName,
        });
        this.logger.error("WebSocket error", error, {
            connectionId: context.connectionId,
            userId: context["userId"],
            service: this.serviceName,
        });
    }
    /**
     * Update connection activity and message tracking
     */
    updateConnectionActivity(context) {
        const connectionMetrics = this.connections.get(context.connectionId);
        if (!connectionMetrics) {
            return;
        }
        connectionMetrics.messageCount++;
        connectionMetrics.lastActivity = new Date();
        // Track message size if enabled
        if (this.config.trackMessageSize) {
            const messageSize = this.getMessageSize(context.message);
            connectionMetrics.totalMessageSize += messageSize;
        }
        // Track rooms if enabled
        if (this.config.trackRooms && context.rooms) {
            context.rooms.forEach((room) => connectionMetrics.rooms.add(room));
        }
    }
    /**
     * Record message-specific metrics
     */
    async recordMessageMetrics(context, startTime) {
        const messageType = context.message.type;
        const processingTime = Date.now() - startTime;
        // Record message type metrics
        await this.recordMetric("websocket_messages_total", 1, {
            message_type: messageType,
            service: this.serviceName,
        });
        // Record message processing time
        await this.recordTimer("websocket_message_processing_time_seconds", processingTime, {
            message_type: messageType,
            service: this.serviceName,
        });
        // Record message size if enabled
        if (this.config.trackMessageSize) {
            const messageSize = this.getMessageSize(context.message);
            await this.recordHistogram("websocket_message_size_bytes", messageSize, {
                message_type: messageType,
                service: this.serviceName,
            });
        }
        // Record room metrics if enabled and rooms are present
        if (this.config.trackRooms && context.rooms && context.rooms.length > 0) {
            context.rooms.forEach(async (room) => {
                await this.recordMetric("websocket_room_messages_total", 1, {
                    room,
                    message_type: messageType,
                    service: this.serviceName,
                });
            });
        }
    }
    /**
     * Record message error metrics
     */
    async recordMessageError(context, error) {
        await this.recordMetric("websocket_message_errors_total", 1, {
            message_type: context.message.type,
            error_type: error.constructor.name,
            service: this.serviceName,
        });
        this.logger.error("WebSocket message processing error", error, {
            connectionId: context.connectionId,
            messageType: context.message.type,
            service: this.serviceName,
        });
    }
    /**
     * Calculate message size in bytes
     */
    getMessageSize(message) {
        try {
            if (typeof message === "string") {
                return Buffer.byteLength(message, "utf8");
            }
            if (typeof message === "object") {
                return Buffer.byteLength(JSON.stringify(message), "utf8");
            }
            return 0;
        }
        catch {
            return 0;
        }
    }
    /**
     * Start periodic metrics flushing
     */
    startMetricsFlushTimer() {
        this.metricsFlushTimer = setInterval(async () => {
            try {
                await this.flushMetrics();
            }
            catch (error) {
                this.logger.error("Failed to flush WebSocket metrics", error);
            }
        }, this.config.metricsFlushInterval);
    }
    /**
     * Flush aggregated metrics
     */
    async flushMetrics() {
        if (this.connections.size === 0) {
            return;
        }
        // Record current connection count
        await this.recordMetric("websocket_active_connections", this.connections.size, {
            service: this.serviceName,
        });
        // Record room statistics if room tracking is enabled
        if (this.config.trackRooms) {
            const roomCounts = new Map();
            for (const connection of this.connections.values()) {
                connection.rooms.forEach((room) => {
                    roomCounts.set(room, (roomCounts.get(room) || 0) + 1);
                });
            }
            for (const [room, count] of roomCounts) {
                await this.recordMetric("websocket_room_connections", count, {
                    room,
                    service: this.serviceName,
                });
            }
        }
        // Clean up stale connections
        await this.cleanupStaleConnections();
    }
    /**
     * Clean up connections that haven't been active recently
     */
    async cleanupStaleConnections() {
        const timeoutThreshold = Date.now() - this.config.connectionTimeoutMs;
        const staleConnections = [];
        for (const [connectionId, metrics] of this.connections) {
            if (metrics.lastActivity.getTime() < timeoutThreshold) {
                staleConnections.push(connectionId);
            }
        }
        if (staleConnections.length > 0) {
            staleConnections.forEach((connectionId) => {
                this.connections.delete(connectionId);
            });
            await this.recordMetric("websocket_stale_connections_cleaned", staleConnections.length, {
                service: this.serviceName,
            });
            this.logger.warn("Cleaned up stale WebSocket connections", {
                count: staleConnections.length,
                service: this.serviceName,
            });
        }
    }
    /**
     * Get current metrics summary
     */
    getMetricsSummary() {
        const totalMessages = Array.from(this.connections.values()).reduce((sum, conn) => sum + conn.messageCount, 0);
        const now = Date.now();
        const averageSessionDuration = this.connections.size > 0
            ? Array.from(this.connections.values()).reduce((sum, conn) => sum + (now - conn.connectedAt.getTime()), 0) / this.connections.size
            : 0;
        // Room distribution (if room tracking is enabled)
        const roomCounts = new Map();
        if (this.config.trackRooms) {
            for (const connection of this.connections.values()) {
                connection.rooms.forEach((room) => {
                    roomCounts.set(room, (roomCounts.get(room) || 0) + 1);
                });
            }
        }
        return {
            activeConnections: this.connections.size,
            totalMessages,
            averageSessionDuration,
            topMessageTypes: [], // Would need message type tracking for this
            roomDistribution: Array.from(roomCounts.entries()).map(([room, connections]) => ({
                room,
                connections,
            })),
        };
    }
    /**
     * Cleanup resources when middleware is destroyed
     */
    async cleanup() {
        if (this.metricsFlushTimer) {
            clearInterval(this.metricsFlushTimer);
            this.metricsFlushTimer = undefined;
        }
        // Flush any remaining metrics
        await this.flushMetrics();
        // Clear connections
        this.connections.clear();
        this.logger.info("Prometheus WebSocket middleware cleaned up", {
            service: this.serviceName,
        });
    }
}
//# sourceMappingURL=prometheus.websocket.middleware.js.map