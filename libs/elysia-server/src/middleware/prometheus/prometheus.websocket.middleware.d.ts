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
import { type IMetricsCollector } from "@libs/monitoring";
import { BaseWebSocketMiddleware, type WebSocketMiddlewareConfig } from "../base";
import type { WebSocketContext } from "../types";
/**
 * Configuration for Prometheus WebSocket middleware
 * Extends WebSocketMiddlewareConfig with metrics-specific options
 */
export interface PrometheusWebSocketMiddlewareConfig extends WebSocketMiddlewareConfig {
    readonly serviceName?: string;
    readonly enableDetailedMetrics?: boolean;
    readonly enableConnectionTracking?: boolean;
    readonly enableMessageMetrics?: boolean;
    readonly enableErrorTracking?: boolean;
    readonly trackMessageSize?: boolean;
    readonly trackRooms?: boolean;
    readonly trackUserMetrics?: boolean;
    readonly connectionTimeoutMs?: number;
    readonly metricsFlushInterval?: number;
}
/**
 * Prometheus WebSocket Metrics Middleware
 * Extends BaseWebSocketMiddleware for WebSocket connection and message tracking
 */
export declare class PrometheusWebSocketMiddleware extends BaseWebSocketMiddleware<PrometheusWebSocketMiddlewareConfig> {
    private readonly serviceName;
    private readonly connections;
    private metricsFlushTimer?;
    constructor(metrics: IMetricsCollector, config: Partial<PrometheusWebSocketMiddlewareConfig>);
    /**
     * Main execution method for WebSocket message metrics collection
     */
    protected execute(context: WebSocketContext, next: () => Promise<void>): Promise<void>;
    /**
     * Handle WebSocket connection events
     */
    handleConnection(context: WebSocketContext): Promise<void>;
    /**
     * Handle WebSocket disconnection events
     */
    handleDisconnection(context: WebSocketContext): Promise<void>;
    /**
     * Handle WebSocket error events
     */
    handleError(error: Error, context: WebSocketContext): Promise<void>;
    /**
     * Update connection activity and message tracking
     */
    private updateConnectionActivity;
    /**
     * Record message-specific metrics
     */
    private recordMessageMetrics;
    /**
     * Record message error metrics
     */
    private recordMessageError;
    /**
     * Calculate message size in bytes
     */
    private getMessageSize;
    /**
     * Start periodic metrics flushing
     */
    private startMetricsFlushTimer;
    /**
     * Flush aggregated metrics
     */
    private flushMetrics;
    /**
     * Clean up connections that haven't been active recently
     */
    private cleanupStaleConnections;
    /**
     * Get current metrics summary
     */
    getMetricsSummary(): {
        activeConnections: number;
        totalMessages: number;
        averageSessionDuration: number;
        topMessageTypes: Array<{
            type: string;
            count: number;
        }>;
        roomDistribution: Array<{
            room: string;
            connections: number;
        }>;
    };
    /**
     * Cleanup resources when middleware is destroyed
     */
    cleanup(): Promise<void>;
}
//# sourceMappingURL=prometheus.websocket.middleware.d.ts.map