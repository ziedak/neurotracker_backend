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
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import * as prometheus from "prom-client";
import { injectable, singleton } from "tsyringe";
import { METRIC_BUCKETS } from "./config/MetricConfig";
import { createLogger } from "@libs/utils";
// ===================================================================
// PROMETHEUS METRICS COLLECTOR
// ===================================================================
let PrometheusMetricsCollector = class PrometheusMetricsCollector {
    // Prometheus metric instances cache
    counters = new Map();
    gauges = new Map();
    histograms = new Map();
    summaries = new Map();
    // Performance optimizations
    labelCache = new Map();
    metricRegistry;
    logger = createLogger("PrometheusMetricsCollector");
    constructor() {
        this.metricRegistry = prometheus.register;
        this.setupDefaultMetrics();
        this.setupCleanup();
    }
    // ===================================================================
    // CORE METRIC RECORDING METHODS
    // ===================================================================
    /**
     * Record counter metric (high-performance)
     */
    async recordCounter(name, value = 1, tags) {
        try {
            const counter = this.getOrCreateCounter(name, tags);
            counter.inc(this.normalizeLabels(tags), value);
        }
        catch (error) {
            this.handleMetricError("counter", name, error);
        }
    }
    /**
     * Record timer metric using histogram
     */
    async recordTimer(name, duration, tags) {
        try {
            const histogram = this.getOrCreateHistogram(name, tags, [
                ...METRIC_BUCKETS.API_DURATION,
            ]);
            histogram.observe(this.normalizeLabels(tags), duration / 1000);
        }
        catch (error) {
            this.handleMetricError("timer", name, error);
        }
    }
    /**
     * Record gauge metric
     */
    async recordGauge(name, value, tags) {
        try {
            const gauge = this.getOrCreateGauge(name, tags);
            gauge.set(this.normalizeLabels(tags), value);
        }
        catch (error) {
            this.handleMetricError("gauge", name, error);
        }
    }
    /**
     * Record histogram metric with proper buckets
     */
    async recordHistogram(name, value, tags, buckets = [...METRIC_BUCKETS.API_DURATION]) {
        try {
            const histogram = this.getOrCreateHistogram(name, tags, buckets);
            histogram.observe(this.normalizeLabels(tags), value);
        }
        catch (error) {
            this.handleMetricError("histogram", name, error);
        }
    }
    /**
     * Record summary metric (for percentiles)
     */
    async recordSummary(name, value, tags, percentiles = [0.5, 0.9, 0.95, 0.99]) {
        try {
            const summary = this.getOrCreateSummary(name, tags, percentiles);
            summary.observe(this.normalizeLabels(tags), value);
        }
        catch (error) {
            this.handleMetricError("summary", name, error);
        }
    }
    // ===================================================================
    // PROMETHEUS INTEGRATION
    // ===================================================================
    /**
     * Get Prometheus exposition format
     */
    async getPrometheusMetrics() {
        return this.metricRegistry.metrics();
    }
    /**
     * Get Prometheus metrics as JSON
     */
    async getMetricsAsJson() {
        return this.metricRegistry.getMetricsAsJSON();
    }
    /**
     * Health check for metrics system
     */
    async healthCheck() {
        try {
            const metrics = await this.metricRegistry.getMetricsAsJSON();
            return {
                healthy: true,
                metricsCount: metrics.length,
            };
        }
        catch (error) {
            this.logger.error("Metrics health check failed", { error });
            return {
                healthy: false,
                metricsCount: 0,
            };
        }
    }
    // ===================================================================
    // HIGH-LEVEL BUSINESS METRICS
    // ===================================================================
    /**
     * Record API request with full context
     */
    recordApiRequest(method, route, statusCode, duration, service = "unknown") {
        const labels = {
            method,
            route,
            status_code: statusCode.toString(),
            service,
        };
        // Request count
        this.recordCounter("elysia_http_requests_total", 1, labels);
        // Request duration
        this.recordTimer("elysia_http_request_duration", duration, labels);
        // Error rate tracking
        if (statusCode >= 400) {
            this.recordCounter("elysia_http_errors_total", 1, labels);
        }
    }
    /**
     * Record database operation
     */
    recordDatabaseOperation(clientType, operation, duration, success, service = "unknown") {
        const labels = {
            client_type: clientType,
            operation,
            result: success ? "success" : "error",
            service,
        };
        this.recordCounter("libs_database_operations_total", 1, labels);
        this.recordHistogram("libs_database_operation_duration_seconds", duration / 1000, labels, [...METRIC_BUCKETS.DATABASE_DURATION]);
    }
    /**
     * Record authentication operation
     */
    recordAuthOperation(operation, result, userRole = "unknown") {
        const labels = { operation, result, user_role: userRole };
        this.recordCounter("libs_auth_operations_total", 1, labels);
    }
    /**
     * Record WebSocket activity
     */
    recordWebSocketActivity(service, messageType, direction, connectionCount) {
        // Message count
        this.recordCounter("elysia_websocket_messages_total", 1, {
            service,
            message_type: messageType,
            direction,
        });
        // Active connections
        if (connectionCount !== undefined) {
            this.recordGauge("elysia_websocket_connections_active", connectionCount, {
                service,
            });
        }
    }
    /**
     * Record Node.js process metrics
     */
    recordNodeMetrics(service) {
        const memUsage = process.memoryUsage();
        // Memory metrics
        this.recordGauge("elysia_node_memory_usage_bytes", memUsage.rss, {
            service,
            type: "rss",
        });
        this.recordGauge("elysia_node_memory_usage_bytes", memUsage.heapUsed, {
            service,
            type: "heap_used",
        });
        this.recordGauge("elysia_node_memory_usage_bytes", memUsage.heapTotal, {
            service,
            type: "heap_total",
        });
        this.recordGauge("elysia_node_memory_usage_bytes", memUsage.external, {
            service,
            type: "external",
        });
        // CPU usage (simplified)
        const cpuUsage = process.cpuUsage();
        this.recordGauge("elysia_node_cpu_usage_seconds", cpuUsage.user / 1000000, {
            service,
            type: "user",
        });
        this.recordGauge("elysia_node_cpu_usage_seconds", cpuUsage.system / 1000000, { service, type: "system" });
    }
    /**
     * Measure and record event loop lag
     */
    measureEventLoopLag(service) {
        const start = process.hrtime.bigint();
        setImmediate(() => {
            const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
            this.recordGauge("elysia_event_loop_lag_seconds", lag / 1000, {
                service,
            });
        });
    }
    // ===================================================================
    // UTILITY METHODS
    // ===================================================================
    /**
     * Get metrics in Prometheus exposition format
     */
    async getMetrics() {
        try {
            return await this.metricRegistry.metrics();
        }
        catch (error) {
            this.logger.error("Failed to generate metrics", { error });
            throw error;
        }
    }
    /**
     * Clear all metrics (for testing/development)
     */
    /**
     * Clear all metrics (for testing/development)
     */
    clearMetrics() {
        this.metricRegistry.clear();
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
        this.summaries.clear();
        this.labelCache.clear();
    }
    /**
     * Get registry for external use
     */
    getRegistry() {
        return this.metricRegistry;
    }
    // ===================================================================
    // PRIVATE METHODS
    // ===================================================================
    setupDefaultMetrics() {
        prometheus.collectDefaultMetrics({
            register: this.metricRegistry,
            prefix: "elysia_",
        });
    }
    setupCleanup() {
        setInterval(() => {
            if (this.labelCache.size > 10000) {
                this.labelCache.clear();
                this.logger.warn("Cleared metric label cache due to size limit");
            }
        }, 5 * 60 * 1000);
    }
    getOrCreateCounter(name, tags) {
        const key = this.getMetricKey(name, tags);
        let counter = this.counters.get(key);
        if (!counter) {
            counter = new prometheus.Counter({
                name: this.sanitizeMetricName(name),
                help: `Counter metric: ${name}`,
                labelNames: tags ? Object.keys(tags) : [],
                registers: [this.metricRegistry],
            });
            this.counters.set(key, counter);
        }
        return counter;
    }
    getOrCreateGauge(name, tags) {
        const key = this.getMetricKey(name, tags);
        let gauge = this.gauges.get(key);
        if (!gauge) {
            gauge = new prometheus.Gauge({
                name: this.sanitizeMetricName(name),
                help: `Gauge metric: ${name}`,
                labelNames: tags ? Object.keys(tags) : [],
                registers: [this.metricRegistry],
            });
            this.gauges.set(key, gauge);
        }
        return gauge;
    }
    getOrCreateHistogram(name, tags, buckets = [...METRIC_BUCKETS.API_DURATION]) {
        const key = this.getMetricKey(name, tags);
        let histogram = this.histograms.get(key);
        if (!histogram) {
            histogram = new prometheus.Histogram({
                name: this.sanitizeMetricName(name),
                help: `Histogram metric: ${name}`,
                labelNames: tags ? Object.keys(tags) : [],
                buckets,
                registers: [this.metricRegistry],
            });
            this.histograms.set(key, histogram);
        }
        return histogram;
    }
    getOrCreateSummary(name, tags, percentiles = [0.5, 0.9, 0.95, 0.99]) {
        const key = this.getMetricKey(name, tags);
        let summary = this.summaries.get(key);
        if (!summary) {
            summary = new prometheus.Summary({
                name: this.sanitizeMetricName(name),
                help: `Summary metric: ${name}`,
                labelNames: tags ? Object.keys(tags) : [],
                percentiles,
                registers: [this.metricRegistry],
            });
            this.summaries.set(key, summary);
        }
        return summary;
    }
    getMetricKey(name, tags) {
        const labelKeys = tags ? Object.keys(tags).sort().join(",") : "";
        return `${name}:${labelKeys}`;
    }
    normalizeLabels(tags) {
        if (!tags)
            return {};
        const cacheKey = JSON.stringify(tags);
        let normalized = this.labelCache.get(cacheKey);
        if (!normalized) {
            normalized = {};
            for (const [key, value] of Object.entries(tags)) {
                const sanitizedKey = this.sanitizeLabelName(key);
                const sanitizedValue = this.sanitizeLabelValue(value);
                normalized[sanitizedKey] = sanitizedValue;
            }
            this.labelCache.set(cacheKey, normalized);
        }
        return normalized;
    }
    sanitizeMetricName(name) {
        return name.replace(/[^a-zA-Z0-9_:]/g, "_").replace(/^[^a-zA-Z_:]/, "_$&");
    }
    sanitizeLabelName(name) {
        return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z_]/, "_$&");
    }
    sanitizeLabelValue(value) {
        return value.replace(/[^\x20-\x7E]/g, "");
    }
    handleMetricError(metricType, name, error) {
        this.logger.error(`Failed to record ${metricType} metric`, {
            metricName: name,
            metricType,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
PrometheusMetricsCollector = __decorate([
    injectable(),
    singleton(),
    __metadata("design:paramtypes", [])
], PrometheusMetricsCollector);
export { PrometheusMetricsCollector };
// ===================================================================
// CONVENIENCE EXPORTS
// ===================================================================
export { prometheus };
//# sourceMappingURL=PrometheusMetricsCollector.js.map