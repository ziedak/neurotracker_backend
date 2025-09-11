/**
 * Prometheus Metrics Collection Middleware
 * Production-grade metrics middleware following BaseMiddleware patterns
 *
 * Features:
 * - Framework-agnostic HTTP request tracking
 * - WebSocket connection monitoring
 * - Automatic metric exposition endpoint
 * - Business metric integration
 * - Error rate tracking
 * - Performance optimization
 */

import { type IMetricsCollector } from "@libs/monitoring";
import {
  BaseMiddleware,
  type HttpMiddlewareConfig,
} from "../base/BaseMiddleware";
import type { MiddlewareContext } from "../types";

/**
 * Configuration for Prometheus middleware
 * Extends HttpMiddlewareConfig with metrics-specific options
 */
export interface PrometheusHttpMiddlewareConfig extends HttpMiddlewareConfig {
  readonly endpoint?: string; // Default: "/metrics"
  readonly enableDetailedMetrics?: boolean; // Default: true
  readonly serviceName?: string; // Service identifier for metrics
  readonly enableNodeMetrics?: boolean; // Default: true
  readonly nodeMetricsSampleRate?: number; // Default: 0.1 (10%)
  readonly includeRequestBody?: boolean; // Default: false
  readonly includeResponseBody?: boolean; // Default: false
  readonly maxBodySize?: number; // Default: 1024 bytes
  readonly trackUserMetrics?: boolean; // Default: true
  readonly enableCustomMetrics?: boolean; // Default: true
}

/**
 * Prometheus HTTP Metrics Middleware
 * Extends BaseMiddleware for HTTP request tracking and metrics collection
 */
export class PrometheusHttpMiddleware extends BaseMiddleware<PrometheusHttpMiddlewareConfig> {
  private readonly serviceName: string;
  private readonly metricsEndpoint: string;

  constructor(
    metrics: IMetricsCollector,
    config: Partial<PrometheusHttpMiddlewareConfig>
  ) {
    const defaultConfig: PrometheusHttpMiddlewareConfig = {
      name: config.name || "prometheus-http",
      enabled: config.enabled ?? true,
      priority: config.priority ?? 100,
      endpoint: config.endpoint || "/metrics",
      enableDetailedMetrics: config.enableDetailedMetrics ?? true,
      serviceName: config.serviceName || "http-service",
      enableNodeMetrics: config.enableNodeMetrics ?? true,
      nodeMetricsSampleRate: config.nodeMetricsSampleRate ?? 0.1,
      includeRequestBody: config.includeRequestBody ?? false,
      includeResponseBody: config.includeResponseBody ?? false,
      maxBodySize: config.maxBodySize ?? 1024,
      trackUserMetrics: config.trackUserMetrics ?? true,
      enableCustomMetrics: config.enableCustomMetrics ?? true,
      skipPaths: config.skipPaths || ["/health", "/favicon.ico"],
    };

    super(metrics, defaultConfig);
    this.serviceName = this.config.serviceName!;
    this.metricsEndpoint = this.config.endpoint!;
  }

  /**
   * Main execution method for HTTP request metrics collection
   */
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = Date.now();
    const path = new URL(context.request.url).pathname;

    // Handle metrics endpoint
    if (path === this.metricsEndpoint) {
      await this.handleMetricsEndpoint(context);
      return;
    }

    // Skip if path should be excluded
    if (this.shouldSkip(context)) {
      return next();
    }

    try {
      // Execute next middleware
      await next();

      // Record successful request metrics
      await this.recordRequestMetrics(context, startTime, "success");

      // Record detailed metrics if enabled
      if (this.config.enableDetailedMetrics) {
        await this.recordDetailedMetrics(context);
      }

      // Record Node.js metrics periodically
      if (this.config.enableNodeMetrics && this.shouldSampleNodeMetrics()) {
        await this.recordNodeMetrics();
      }
    } catch (error) {
      // Record error metrics
      await this.recordRequestMetrics(context, startTime, "error");
      await this.recordError(error as Error, context);
      throw error;
    }
  }

  /**
   * Handle metrics exposition endpoint
   */
  private async handleMetricsEndpoint(
    context: MiddlewareContext
  ): Promise<void> {
    try {
      const metrics = await this.metrics.getMetrics();

      context.response = {
        status: 200,
        headers: {
          "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        },
        body: metrics,
      };

      await this.recordMetric("prometheus_metrics_requests_total", 1, {
        status: "success",
        service: this.serviceName,
      });
    } catch (error) {
      this.logger.error("Failed to generate metrics", error as Error);

      context.response = {
        status: 500,
        headers: { "Content-Type": "text/plain" },
        body: "Internal Server Error",
      };

      await this.recordMetric("prometheus_metrics_requests_total", 1, {
        status: "error",
        service: this.serviceName,
      });
    }
  }

  /**
   * Record request metrics with comprehensive labeling
   */
  private async recordRequestMetrics(
    context: MiddlewareContext,
    startTime: number,
    result: "success" | "error"
  ): Promise<void> {
    const duration = Date.now() - startTime;
    const method = context.request.method;
    const path = this.normalizePath(new URL(context.request.url).pathname);
    const statusCode =
      context.response?.status || (result === "error" ? 500 : 200);

    // Record API request metrics using metrics collector
    await this.metrics.recordApiRequest(
      method,
      path,
      statusCode,
      duration,
      this.serviceName
    );

    // Record additional Prometheus-specific metrics
    await this.recordMetric("http_requests_total", 1, {
      method,
      path,
      status_code: statusCode.toString(),
      service: this.serviceName,
      result,
    });

    await this.recordTimer("http_request_duration_seconds", duration, {
      method,
      path,
      status_code: statusCode.toString(),
      service: this.serviceName,
    });

    // Track user metrics if enabled and user is identified
    if (this.config.trackUserMetrics && context["userId"]) {
      await this.recordMetric("http_requests_by_user_total", 1, {
        user_id: context["userId"] as string,
        method,
        service: this.serviceName,
      });
    }
  }

  /**
   * Record detailed metrics including request/response data
   */
  private async recordDetailedMetrics(
    context: MiddlewareContext
  ): Promise<void> {
    const requestSize = this.getRequestSize(context);
    const responseSize = this.getResponseSize(context);

    // Record request size metrics
    if (requestSize > 0) {
      await this.recordHistogram("http_request_size_bytes", requestSize, {
        method: context.request.method,
        service: this.serviceName,
      });
    }

    // Record response size metrics
    if (responseSize > 0) {
      await this.recordHistogram("http_response_size_bytes", responseSize, {
        method: context.request.method,
        service: this.serviceName,
      });
    }

    // Record request body metrics if enabled
    if (this.config.includeRequestBody && context.request.body) {
      const bodySize = this.getBodySize(context.request.body);
      if (bodySize <= this.config.maxBodySize!) {
        await this.recordMetric("http_request_body_tracked_total", 1, {
          service: this.serviceName,
        });
      }
    }

    // Record response body metrics if enabled
    if (this.config.includeResponseBody && context.response?.body) {
      const bodySize = this.getBodySize(context.response.body);
      if (bodySize <= this.config.maxBodySize!) {
        await this.recordMetric("http_response_body_tracked_total", 1, {
          service: this.serviceName,
        });
      }
    }
  }

  /**
   * Record Node.js runtime metrics
   */
  private async recordNodeMetrics(): Promise<void> {
    try {
      await this.metrics.recordNodeMetrics(this.serviceName);
      await this.metrics.measureEventLoopLag(this.serviceName);

      await this.recordMetric("prometheus_node_metrics_collected_total", 1, {
        service: this.serviceName,
      });
    } catch (error) {
      this.logger.warn("Failed to collect Node.js metrics", error as Error);
    }
  }

  /**
   * Determine if Node.js metrics should be sampled
   */
  private shouldSampleNodeMetrics(): boolean {
    return Math.random() < this.config.nodeMetricsSampleRate!;
  }

  /**
   * Normalize path for consistent metrics labeling
   */
  private normalizePath(path: string): string {
    // Remove query parameters
    const cleanPath = path.split("?")[0] || "/";

    // Replace dynamic segments with placeholders
    return cleanPath
      .replace(/\/\d+/g, "/:id")
      .replace(
        /\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
        "/:uuid"
      )
      .replace(/\/[a-f0-9]{24}/g, "/:objectid");
  }

  /**
   * Get request size in bytes
   */
  private getRequestSize(context: MiddlewareContext): number {
    const contentLength = context.request.headers["content-length"];
    if (contentLength) {
      return parseInt(contentLength, 10) || 0;
    }

    if (context.request.body) {
      return this.getBodySize(context.request.body);
    }

    return 0;
  }

  /**
   * Get response size in bytes
   */
  private getResponseSize(context: MiddlewareContext): number {
    if (!context.response?.body) {
      return 0;
    }

    return this.getBodySize(context.response.body);
  }

  /**
   * Calculate body size in bytes
   */
  private getBodySize(body: any): number {
    if (typeof body === "string") {
      return Buffer.byteLength(body, "utf8");
    }

    if (Buffer.isBuffer(body)) {
      return body.length;
    }

    if (typeof body === "object") {
      try {
        return Buffer.byteLength(JSON.stringify(body), "utf8");
      } catch {
        return 0;
      }
    }

    return 0;
  }

  /**
   * Record error with comprehensive context
   */
  private async recordError(
    error: Error,
    context: MiddlewareContext
  ): Promise<void> {
    const path = this.normalizePath(new URL(context.request.url).pathname);

    await this.recordMetric("http_errors_total", 1, {
      error_type: error.constructor.name,
      method: context.request.method,
      path,
      service: this.serviceName,
    });

    this.logger.error("HTTP request error", error, {
      path,
      method: context.request.method,
      requestId: context.requestId,
      userId: context["userId"] as string | undefined,
      service: this.serviceName,
    });
  }

  /**
   * Get current metrics summary for monitoring
   */
  public async getMetricsSummary(): Promise<{
    totalRequests: number;
    errorRate: number;
    averageResponseTime: number;
    activeConnections: number;
  }> {
    // This would typically query the metrics store
    // Implementation depends on the metrics backend
    return {
      totalRequests: 0,
      errorRate: 0,
      averageResponseTime: 0,
      activeConnections: 0,
    };
  }
}
