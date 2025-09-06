/**
 * High-Performance Prometheus Metrics Collector
 *
 * Enterprise-grade metrics collection with zero-allocation recording,
 * proper histogram buckets, and automatic Prometheus exposition.
 */
export interface IMetricsCollector {
    /**
     * Record counter metric
     */
    recordCounter(name: string, value?: number, labels?: Record<string, string>): void;
    /**
     * Record timer metric (in milliseconds)
     */
    recordTimer(name: string, value: number, labels?: Record<string, string>): void;
    /**
     * Record gauge metric
     */
    recordGauge(name: string, value: number, labels?: Record<string, string>): void;
    /**
     * Record histogram metric
     */
    recordHistogram(name: string, value: number, labels?: Record<string, string>, buckets?: number[]): void;
    /**
     * Record summary metric
     */
    recordSummary(name: string, value: number, labels?: Record<string, string>): void;
    /**
     * Get current metrics as Prometheus exposition format
     */
    getMetrics(): Promise<string>;
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
}
export declare class MetricsCollector implements IMetricsCollector {
    private collector;
    constructor();
    recordCounter(name: string, value?: number, labels?: Record<string, string>): void;
    recordTimer(name: string, value: number, labels?: Record<string, string>): void;
    recordGauge(name: string, value: number, labels?: Record<string, string>): void;
    recordHistogram(name: string, value: number, labels?: Record<string, string>, buckets?: number[]): void;
    recordSummary(name: string, value: number, labels?: Record<string, string>): void;
    getMetrics(): Promise<string>;
    recordApiRequest(method: string, route: string, statusCode: number, duration: number, service?: string): void;
    recordDatabaseOperation(clientType: "redis" | "postgres" | "clickhouse", operation: string, duration: number, success: boolean, service?: string): void;
    recordAuthOperation(operation: "login" | "register" | "refresh" | "logout", result: "success" | "failure" | "error", userRole?: string): void;
    recordWebSocketActivity(service: string, messageType: string, direction: "inbound" | "outbound", connectionCount?: number): void;
    recordNodeMetrics(service: string): void;
    measureEventLoopLag(service: string): void;
}
export { MetricsCollector as default };
//# sourceMappingURL=MetricsCollector.d.ts.map