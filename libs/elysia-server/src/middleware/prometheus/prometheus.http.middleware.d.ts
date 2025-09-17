/**
 * Prometheus Metrics Collection Middleware
 * Production-grade metrics middleware following BaseMiddleware patterns
 *
 * Features:
 * - Framework-agnostic HTTP request tracking
 * - WebSocket    if (this.config.includeMethodLabels !== false) {
      labels["method"] = method;
    }
    if (this.config.includePathLabels !== false) {
      labels["path"] = path;
    }
    if (this.config.includeStatusLabels !== false) {
      labels["status_code"] = statusCode.toString();
    }
    if (this.config.includeUserAgentLabels && context.request.headers["user-agent"]) {
      labels["user_agent"] = context.request.headers["user-agent"];
    }monitoring
 * - Automatic metric exposition endpoint
 * - Business metric integration
 * - Error rate tracking
 * - Performance optimization
 */
import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware } from "../base/BaseMiddleware";
import { type BaseMiddlewareConfig } from "../base/AbstractMiddleware";
import type { MiddlewareContext } from "../types";
/**
 * Configuration for Prometheus middleware
 * Extends HttpMiddlewareConfig with metrics-specific options
 */
export interface PrometheusHttpMiddlewareConfig extends BaseMiddlewareConfig {
    collectHttpMetrics?: boolean;
    collectDefaultMetrics?: boolean;
    enableDetailedMetrics?: boolean;
    enableNodeMetrics?: boolean;
    metricPrefix?: string;
    serviceName?: string;
    metricsEndpoint?: string;
    includeMethodLabels?: boolean;
    includePathLabels?: boolean;
    includeStatusLabels?: boolean;
    includeUserAgentLabels?: boolean;
    customLabels?: Record<string, string>;
    excludePaths?: string[];
    includeRequestBody?: boolean;
    includeResponseBody?: boolean;
    maxBodySize?: number;
    nodeMetricsSampleRate?: number;
    buckets?: number[];
    trackUserMetrics?: boolean;
    registry?: {
        registerMetric?: (name: string, metric: unknown) => void;
        getMetricsAsJSON?: () => unknown;
        metrics?: () => string;
    } | undefined;
}
/**
 * Prometheus HTTP Metrics Middleware
 * Extends BaseMiddleware for HTTP request tracking and metrics collection
 */
export declare class PrometheusHttpMiddleware extends BaseMiddleware<PrometheusHttpMiddlewareConfig> {
    private readonly serviceName;
    private readonly metricsEndpoint;
    constructor(metrics: IMetricsCollector, config?: Partial<PrometheusHttpMiddlewareConfig>);
    /**
     * Check if the current request should skip this middleware
     */
    protected shouldSkip(context: MiddlewareContext): boolean;
    /**
     * Validate configuration parameters
     */
    private validateConfiguration;
    /**
     * Main execution method for HTTP request metrics collection
     */
    protected execute(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
    /**
     * Handle metrics exposition endpoint
     */
    private handleMetricsEndpoint;
    /**
     * Record request metrics with comprehensive labeling
     */
    private recordRequestMetrics;
    /**
     * Record detailed metrics including request/response data
     */
    private recordDetailedMetrics;
    /**
     * Record Node.js/Bun runtime metrics
     */
    private recordNodeMetrics;
    /**
     * Check if running on Bun runtime
     */
    private isRunningOnBun;
    /**
     * Record runtime-agnostic metrics that work on both Node.js and Bun
     */
    private recordRuntimeMetrics;
    /**
     * Record Bun-specific metrics
     */
    private recordBunMetrics;
    /**
     * Record Node.js-specific metrics
     */
    private recordNodeJSMetrics;
    /**
     * Determine if Node.js metrics should be sampled
     */
    private shouldSampleNodeMetrics;
    /**
     * Normalize path for consistent metrics labeling
     */
    private normalizePath;
    /**
     * Get request size in bytes
     */
    private getRequestSize;
    /**
     * Get response size in bytes
     */
    private getResponseSize;
    /**
     * Calculate body size in bytes
     */
    private getBodySize;
    /**
     * Record error with comprehensive context
     */
    private recordError;
    /**
     * Safely extract path from URL, handling both full URLs and relative paths
     */
    private getPathFromUrl;
    /**
     * Create development configuration preset
     */
    static createDevelopmentConfig(): Partial<PrometheusHttpMiddlewareConfig>;
    /**
     * Create production configuration preset
     */
    static createProductionConfig(): Partial<PrometheusHttpMiddlewareConfig>;
    /**
     * Create minimal configuration preset
     */
    static createMinimalConfig(): Partial<PrometheusHttpMiddlewareConfig>;
    /**
     * Create high-cardinality configuration preset
     */
    static createHighCardinalityConfig(): Partial<PrometheusHttpMiddlewareConfig>;
}
//# sourceMappingURL=prometheus.http.middleware.d.ts.map