/**
 * High-Performance Prometheus Metrics Collector
 *
 * Enterprise-grade Prometheus client implementation with:
 * - Zero-allocation metric recording
 * - Automatic metric exposition
 * - Proper histogram buckets
 * - Cardinality protection
 * - Thread-safe operations
 */
import * as prometheus from "prom-client";
import type { IMetricsCollector } from "./MetricsCollector";
export declare class PrometheusMetricsCollector implements IMetricsCollector {
    private counters;
    private gauges;
    private histograms;
    private summaries;
    private labelCache;
    private metricRegistry;
    private logger;
    constructor();
    /**
     * Record counter metric (high-performance)
     */
    recordCounter(name: string, value?: number, tags?: Record<string, string>): Promise<void>;
    /**
     * Record timer metric using histogram
     */
    recordTimer(name: string, duration: number, tags?: Record<string, string>): Promise<void>;
    /**
     * Record gauge metric
     */
    recordGauge(name: string, value: number, tags?: Record<string, string>): Promise<void>;
    /**
     * Record histogram metric with proper buckets
     */
    recordHistogram(name: string, value: number, tags?: Record<string, string>, buckets?: number[]): Promise<void>;
    /**
     * Record summary metric (for percentiles)
     */
    recordSummary(name: string, value: number, tags?: Record<string, string>, percentiles?: number[]): Promise<void>;
    /**
     * Get Prometheus exposition format
     */
    getPrometheusMetrics(): Promise<string>;
    /**
     * Get Prometheus metrics as JSON
     */
    getMetricsAsJson(): Promise<any[]>;
    /**
     * Health check for metrics system
     */
    healthCheck(): Promise<{
        healthy: boolean;
        metricsCount: number;
    }>;
    /**
     * Record API request with full context
     */
    recordApiRequest(method: string, route: string, statusCode: number, duration: number, service?: string): void;
    /**
     * Record database operation
     */
    recordDatabaseOperation(clientType: "redis" | "postgres" | "clickhouse", operation: string, duration: number, success: boolean, service?: string): void;
    /**
     * Record authentication operation
     */
    recordAuthOperation(operation: "login" | "register" | "refresh" | "logout", result: "success" | "failure" | "error", userRole?: string): void;
    /**
     * Record WebSocket activity
     */
    recordWebSocketActivity(service: string, messageType: string, direction: "inbound" | "outbound", connectionCount?: number): void;
    /**
     * Record Node.js process metrics
     */
    recordNodeMetrics(service: string): void;
    /**
     * Measure and record event loop lag
     */
    measureEventLoopLag(service: string): void;
    /**
     * Get metrics in Prometheus exposition format
     */
    getMetrics(): Promise<string>;
    /**
     * Clear all metrics (for testing/development)
     */
    /**
     * Clear all metrics (for testing/development)
     */
    clearMetrics(): void;
    /**
     * Get registry for external use
     */
    getRegistry(): prometheus.Registry;
    private setupDefaultMetrics;
    private setupCleanup;
    private getOrCreateCounter;
    private getOrCreateGauge;
    private getOrCreateHistogram;
    private getOrCreateSummary;
    private getMetricKey;
    private normalizeLabels;
    private sanitizeMetricName;
    private sanitizeLabelName;
    private sanitizeLabelValue;
    private handleMetricError;
}
export { prometheus };
//# sourceMappingURL=PrometheusMetricsCollector.d.ts.map