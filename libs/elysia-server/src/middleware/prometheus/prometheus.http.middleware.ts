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
  // Core configuration
  collectHttpMetrics?: boolean;
  collectDefaultMetrics?: boolean;
  enableDetailedMetrics?: boolean;
  enableNodeMetrics?: boolean;

  // Metric naming
  metricPrefix?: string;
  serviceName?: string;
  metricsEndpoint?: string;

  // Label configuration
  includeMethodLabels?: boolean;
  includePathLabels?: boolean;
  includeStatusLabels?: boolean;
  includeUserAgentLabels?: boolean;
  customLabels?: Record<string, string>;

  // Path filtering
  excludePaths?: string[];

  // Size tracking
  includeRequestBody?: boolean;
  includeResponseBody?: boolean;
  maxBodySize?: number;

  // Node.js metrics
  nodeMetricsSampleRate?: number;

  // Buckets for histograms
  buckets?: number[];

  // User tracking
  trackUserMetrics?: boolean;

  // Registry for custom metric storage
  registry?:
    | {
        registerMetric?: (name: string, metric: unknown) => void;
        getMetricsAsJSON?: () => unknown;
        metrics?: () => string;
      }
    | undefined;
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
    config: PrometheusHttpMiddlewareConfig
  ) {
    // Set defaults for Prometheus-specific configuration
    const prometheusDefaults: Partial<PrometheusHttpMiddlewareConfig> = {
      collectHttpMetrics: true,
      collectDefaultMetrics: false,
      enableDetailedMetrics: false,
      enableNodeMetrics: false,
      trackUserMetrics: true,
      includeRequestBody: false,
      includeResponseBody: false,
      includeMethodLabels: true,
      includePathLabels: true,
      includeStatusLabels: true,
      includeUserAgentLabels: false,
      nodeMetricsSampleRate: 0.1,
      maxBodySize: 1024,
      metricPrefix: "app",
      serviceName: "http-service",
      metricsEndpoint: "/metrics",
      customLabels: {},
      excludePaths: [],
      buckets: [0.1, 0.5, 1, 2.5, 5, 10],
      registry: undefined,
    };

    const mergedConfig = { ...prometheusDefaults, ...config };

    super(metrics, {
      ...mergedConfig,
      name: config.name || "prometheus", // Use provided name or default to "prometheus"
    });

    // Validate configuration
    this.validateConfiguration(mergedConfig);

    this.serviceName = mergedConfig.serviceName || "http-service";
    this.metricsEndpoint = mergedConfig.metricsEndpoint || "/metrics";
  }

  /**
   * Check if the current request should skip this middleware
   */
  protected override shouldSkip(context: MiddlewareContext): boolean {
    // Use context.path if available, otherwise extract from URL
    const path = context.path || this.getPathFromUrl(context.request.url);

    return (
      this.config.excludePaths?.some((excludePath) => {
        if (excludePath.endsWith("*")) {
          return path.startsWith(excludePath.slice(0, -1));
        }
        return path === excludePath || path.startsWith(`${excludePath}/`);
      }) || false
    );
  }

  /**
   * Validate configuration parameters
   */
  private validateConfiguration(config: PrometheusHttpMiddlewareConfig): void {
    // Validate buckets
    if (config.buckets) {
      if (!Array.isArray(config.buckets)) {
        throw new Error("Prometheus buckets must be an array");
      }
      if (
        config.buckets.some(
          (bucket) => typeof bucket !== "number" || bucket <= 0
        )
      ) {
        throw new Error(
          "Prometheus buckets must contain only positive numbers"
        );
      }
    }

    // Validate excludePaths
    if (config.excludePaths) {
      if (!Array.isArray(config.excludePaths)) {
        throw new Error("Prometheus excludePaths must be an array");
      }
      if (
        config.excludePaths.some(
          (path) => typeof path !== "string" || !path.startsWith("/")
        )
      ) {
        throw new Error("Prometheus excludePaths must start with '/'");
      }
    }

    // Validate metricPrefix
    if (config.metricPrefix) {
      if (typeof config.metricPrefix !== "string") {
        throw new Error("Prometheus metricPrefix must be a string");
      }
      // Prometheus naming convention: [a-zA-Z_:][a-zA-Z0-9_:]*
      const prometheusNameRegex = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
      if (!prometheusNameRegex.test(config.metricPrefix)) {
        throw new Error(
          "Prometheus metricPrefix must match Prometheus naming conventions"
        );
      }
    }
  }

  /**
   * Main execution method for HTTP request metrics collection
   */
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = Date.now();
    const path = this.getPathFromUrl(context.request.url);

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

      // Record detailed metrics if enabled or if size tracking is enabled
      const requestSize = this.getRequestSize(context);
      const responseSize = this.getResponseSize(context);
      if (
        this.config.enableDetailedMetrics ||
        this.config.includeRequestBody ||
        this.config.includeResponseBody ||
        requestSize > 0 ||
        responseSize > 0
      ) {
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
    const { method } = context.request;
    const path = this.normalizePath(this.getPathFromUrl(context.request.url));
    const statusCode =
      context.set?.status ||
      context.response?.status ||
      (result === "error" ? 500 : 200);

    // Record API request metrics using metrics collector
    this.metrics.recordApiRequest(
      method,
      path,
      statusCode,
      duration,
      this.serviceName
    );

    // Record additional Prometheus-specific metrics
    const metricPrefix = this.config.metricPrefix || "";
    const baseName = "http_requests_total";
    const prefixedName = metricPrefix
      ? `${metricPrefix}_${baseName}`
      : baseName;

    // Build labels conditionally based on configuration
    const labels: Record<string, string> = {
      service: this.serviceName,
      result,
      ...this.config.customLabels,
    };

    if (this.config.includeMethodLabels !== false) {
      labels["method"] = method;
    }
    if (this.config.includePathLabels !== false) {
      labels["path"] = path;
    }
    if (this.config.includeStatusLabels !== false) {
      labels["status"] = statusCode.toString();
    }
    if (
      this.config.includeUserAgentLabels &&
      context.request.headers["user-agent"]
    ) {
      labels["user_agent"] = context.request.headers["user-agent"];
    }

    await this.recordMetric(prefixedName, 1, labels);

    // Register metric with custom registry if provided
    if (this.config.registry?.registerMetric) {
      this.config.registry.registerMetric(prefixedName, {
        type: "counter",
        labels,
      });
    }

    // Record duration with same labels
    const durationName = metricPrefix
      ? `${metricPrefix}_http_request_duration_seconds`
      : "http_request_duration_seconds";
    await this.recordTimer(durationName, duration, labels);

    // Track user metrics if enabled and user is identified
    if (
      this.config.trackUserMetrics &&
      (context["userId"] || context.user?.id)
    ) {
      const userId = context["userId"] || context.user?.id;
      const userRole = context["userRole"] || context.user?.["role"];
      const userMetricName = metricPrefix
        ? `${metricPrefix}_http_requests_by_user_total`
        : "http_requests_by_user_total";
      const userLabels: Record<string, string> = {
        user_id: userId as string,
        service: this.serviceName,
      };
      if (userRole) {
        userLabels["user_role"] = userRole as string;
      }
      if (this.config.includeMethodLabels !== false) {
        userLabels["method"] = method;
      }
      await this.recordMetric(userMetricName, 1, userLabels);
    }
  }

  /**
   * Record detailed metrics including request/response data
   */
  private async recordDetailedMetrics(
    context: MiddlewareContext
  ): Promise<void> {
    const metricPrefix = this.config.metricPrefix || "";
    const requestSize = this.getRequestSize(context);
    const responseSize = this.getResponseSize(context);
    const path = this.normalizePath(this.getPathFromUrl(context.request.url));
    const statusCode = context.response?.status || context.set?.status || 200;

    // Record request size metrics
    if (requestSize > 0) {
      const requestSizeName = metricPrefix
        ? `${metricPrefix}_http_request_size_bytes`
        : "http_request_size_bytes";
      const requestLabels: Record<string, string> = {
        service: this.serviceName,
      };
      if (this.config.includeMethodLabels !== false) {
        requestLabels["method"] = context.request.method;
      }
      if (this.config.includePathLabels !== false) {
        requestLabels["path"] = path;
      }
      await this.recordGauge(requestSizeName, requestSize, requestLabels);
    }

    // Record response size metrics
    if (responseSize > 0) {
      const responseSizeName = metricPrefix
        ? `${metricPrefix}_http_response_size_bytes`
        : "http_response_size_bytes";
      const responseLabels: Record<string, string> = {
        service: this.serviceName,
      };
      if (this.config.includeMethodLabels !== false) {
        responseLabels["method"] = context.request.method;
      }
      if (this.config.includePathLabels !== false) {
        responseLabels["path"] = path;
      }
      if (this.config.includeStatusLabels !== false) {
        responseLabels["status"] = statusCode.toString();
      }
      await this.recordGauge(responseSizeName, responseSize, responseLabels);
    }

    // Record request body metrics if enabled
    if (this.config.includeRequestBody && context.request.body) {
      const bodySize = this.getBodySize(context.request.body);
      if (bodySize <= (this.config.maxBodySize ?? 1024)) {
        const requestBodyName = metricPrefix
          ? `${metricPrefix}_http_request_body_tracked_total`
          : "http_request_body_tracked_total";
        await this.recordMetric(requestBodyName, 1, {
          service: this.serviceName,
        });
      }
    }

    // Record response body metrics if enabled
    if (this.config.includeResponseBody && context.response?.body) {
      const bodySize = this.getBodySize(context.response.body);
      if (bodySize <= (this.config.maxBodySize ?? 1024)) {
        const responseBodyName = metricPrefix
          ? `${metricPrefix}_http_response_body_tracked_total`
          : "http_response_body_tracked_total";
        await this.recordMetric(responseBodyName, 1, {
          service: this.serviceName,
        });
      }
    }
  }

  /**
   * Record Node.js/Bun runtime metrics
   */
  private async recordNodeMetrics(): Promise<void> {
    try {
      // Only attempt to collect default metrics if prom-client is available
      if (this.config.collectDefaultMetrics) {
        try {
          const promClient = require("prom-client");
          if (promClient?.register) {
            // Check if running on Bun vs Node.js
            const isBun = this.isRunningOnBun();
            if (isBun) {
              // Bun-specific default metrics collection
              this.logger.debug(
                "Running on Bun, using Bun-compatible metrics collection"
              );
              // Skip prom-client default metrics for Bun as they may not be compatible
            } else {
              // Node.js default metrics
              promClient.collectDefaultMetrics({
                register: promClient.register,
              });
            }
          }
        } catch {
          // prom-client not available, skip default metrics collection
          this.logger.debug(
            "prom-client not available, skipping default metrics collection"
          );
        }
      }

      // Record runtime-agnostic metrics
      await this.recordRuntimeMetrics();

      await this.recordMetric("prometheus_node_metrics_collected_total", 1, {
        service: this.serviceName,
        runtime: this.isRunningOnBun() ? "bun" : "nodejs",
      });
    } catch (error) {
      this.logger.warn("Failed to collect runtime metrics", error as Error);
    }
  }

  /**
   * Check if running on Bun runtime
   */
  private isRunningOnBun(): boolean {
    return (
      typeof globalThis !== "undefined" &&
      (globalThis as { Bun?: unknown }).Bun !== undefined
    );
  }

  /**
   * Record runtime-agnostic metrics that work on both Node.js and Bun
   */
  private async recordRuntimeMetrics(): Promise<void> {
    const isBun = this.isRunningOnBun();

    if (isBun) {
      // Bun-specific metrics
      await this.recordBunMetrics();
    } else {
      // Node.js metrics
      await this.recordNodeJSMetrics();
    }
  }

  /**
   * Record Bun-specific metrics
   */
  private async recordBunMetrics(): Promise<void> {
    try {
      // Basic memory info (Bun exposes some Node.js-compatible APIs)
      if (typeof process !== "undefined" && process.memoryUsage) {
        const memUsage = process.memoryUsage();

        // Memory metrics (similar to Node.js but may have different values)
        await this.recordGauge(
          "elysia_runtime_memory_usage_bytes",
          memUsage.rss || 0,
          {
            service: this.serviceName,
            runtime: "bun",
            type: "rss",
          }
        );

        if (memUsage.heapUsed) {
          await this.recordGauge(
            "elysia_runtime_memory_usage_bytes",
            memUsage.heapUsed,
            {
              service: this.serviceName,
              runtime: "bun",
              type: "heap_used",
            }
          );
        }

        if (memUsage.heapTotal) {
          await this.recordGauge(
            "elysia_runtime_memory_usage_bytes",
            memUsage.heapTotal,
            {
              service: this.serviceName,
              runtime: "bun",
              type: "heap_total",
            }
          );
        }
      }

      // Bun version info
      const bunGlobal = globalThis as { Bun?: { version?: string } };
      if (bunGlobal.Bun?.version) {
        await this.recordGauge("elysia_runtime_info", 1, {
          service: this.serviceName,
          runtime: "bun",
          version: bunGlobal.Bun.version,
        });
      }

      // Event loop lag (if available)
      if (typeof process !== "undefined" && process.hrtime) {
        const start = process.hrtime.bigint();
        setImmediate(() => {
          const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
          this.recordGauge("elysia_event_loop_lag_seconds", lag / 1000, {
            service: this.serviceName,
            runtime: "bun",
          }).catch((error) => {
            this.logger.warn(
              "Failed to record Bun event loop lag",
              error as Error
            );
          });
        });
      }

      this.logger.debug("Recorded Bun runtime metrics");
    } catch (error) {
      this.logger.warn("Failed to record Bun metrics", error as Error);
    }
  }

  /**
   * Record Node.js-specific metrics
   */
  private async recordNodeJSMetrics(): Promise<void> {
    try {
      if (typeof process !== "undefined" && process.memoryUsage) {
        const memUsage = process.memoryUsage();

        // Memory metrics
        await this.recordGauge(
          "elysia_runtime_memory_usage_bytes",
          memUsage.rss,
          {
            service: this.serviceName,
            runtime: "nodejs",
            type: "rss",
          }
        );
        await this.recordGauge(
          "elysia_runtime_memory_usage_bytes",
          memUsage.heapUsed,
          {
            service: this.serviceName,
            runtime: "nodejs",
            type: "heap_used",
          }
        );
        await this.recordGauge(
          "elysia_runtime_memory_usage_bytes",
          memUsage.heapTotal,
          {
            service: this.serviceName,
            runtime: "nodejs",
            type: "heap_total",
          }
        );
        await this.recordGauge(
          "elysia_runtime_memory_usage_bytes",
          memUsage.external,
          {
            service: this.serviceName,
            runtime: "nodejs",
            type: "external",
          }
        );

        // CPU usage
        if (process.cpuUsage) {
          const cpuUsage = process.cpuUsage();
          await this.recordGauge(
            "elysia_runtime_cpu_usage_seconds",
            cpuUsage.user / 1000000,
            {
              service: this.serviceName,
              runtime: "nodejs",
              type: "user",
            }
          );
          await this.recordGauge(
            "elysia_runtime_cpu_usage_seconds",
            cpuUsage.system / 1000000,
            {
              service: this.serviceName,
              runtime: "nodejs",
              type: "system",
            }
          );
        }
      }

      // Event loop lag
      if (process.hrtime) {
        const start = process.hrtime.bigint();
        setImmediate(() => {
          const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
          this.recordGauge("elysia_event_loop_lag_seconds", lag / 1000, {
            service: this.serviceName,
            runtime: "nodejs",
          }).catch((error) => {
            this.logger.warn(
              "Failed to record Node.js event loop lag",
              error as Error
            );
          });
        });
      }

      this.logger.debug("Recorded Node.js runtime metrics");
    } catch (error) {
      this.logger.warn("Failed to record Node.js metrics", error as Error);
    }
  }

  /**
   * Determine if Node.js metrics should be sampled
   */
  private shouldSampleNodeMetrics(): boolean {
    return Math.random() < (this.config.nodeMetricsSampleRate ?? 0.1);
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
    // Check set body first (for frameworks that set response via set property)
    if (context.set?.body) {
      return this.getBodySize(context.set.body);
    }

    // Check response body
    if (context.response?.body) {
      return this.getBodySize(context.response.body);
    }

    return 0;
  }

  /**
   * Calculate body size in bytes
   */
  private getBodySize(body: unknown): number {
    if (typeof body === "string") {
      return Buffer.byteLength(body, "utf8");
    }

    if (Buffer.isBuffer(body)) {
      return body.length;
    }

    if (typeof body === "object" && body !== null) {
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
    const metricPrefix = this.config.metricPrefix || "";
    const path = this.normalizePath(this.getPathFromUrl(context.request.url));

    const errorLabels: Record<string, string> = {
      error_type: error.constructor.name,
      service: this.serviceName,
    };
    if (this.config.includeMethodLabels !== false) {
      errorLabels["method"] = context.request.method;
    }
    if (this.config.includePathLabels !== false) {
      errorLabels["path"] = path;
    }
    if (this.config.includeStatusLabels !== false) {
      errorLabels["status"] = (
        context.set?.status ||
        context.response?.status ||
        500
      ).toString();
    }

    const errorMetricName = metricPrefix
      ? `${metricPrefix}_http_errors_total`
      : "http_errors_total";
    await this.recordMetric(errorMetricName, 1, errorLabels);

    this.logger.error("HTTP request error", error, {
      path,
      method: context.request.method,
      requestId: context.requestId,
      userId: context["userId"] as string | undefined,
      service: this.serviceName,
    });
  }

  /**
   * Safely extract path from URL, handling both full URLs and relative paths
   */
  private getPathFromUrl(url: string): string {
    try {
      // Try to parse as full URL first
      return new URL(url).pathname;
    } catch {
      // If it's not a valid URL, treat it as a relative path
      // Remove query parameters and ensure it starts with /
      const cleanPath = url.split("?")[0] || "/";
      return cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
    }
  }

  /**
   * Create development configuration preset
   */
  static createDevelopmentConfig(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      collectHttpMetrics: true,
      collectDefaultMetrics: true,
      enableDetailedMetrics: true,
      enableNodeMetrics: true,
      trackUserMetrics: true,
      includeRequestBody: true,
      includeResponseBody: true,
      includeMethodLabels: true,
      includePathLabels: true,
      includeStatusLabels: true,
      includeUserAgentLabels: true,
      nodeMetricsSampleRate: 1.0,
      maxBodySize: 1024 * 1024, // 1MB
      metricPrefix: "app",
      serviceName: "development-service",
    };
  }

  /**
   * Create production configuration preset
   */
  static createProductionConfig(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      collectHttpMetrics: true,
      collectDefaultMetrics: true,
      enableDetailedMetrics: true,
      enableNodeMetrics: true,
      trackUserMetrics: false,
      includeRequestBody: false,
      includeResponseBody: false,
      includeMethodLabels: true,
      includePathLabels: true,
      includeStatusLabels: true,
      includeUserAgentLabels: false,
      excludePaths: ["/health", "/metrics", "/favicon.ico"],
      nodeMetricsSampleRate: 0.1,
      maxBodySize: 1024 * 100, // 100KB
      metricPrefix: "prod",
      serviceName: "production-service",
    };
  }

  /**
   * Create minimal configuration preset
   */
  static createMinimalConfig(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      collectHttpMetrics: true,
      collectDefaultMetrics: false,
      enableDetailedMetrics: false,
      enableNodeMetrics: false,
      trackUserMetrics: false,
      includeRequestBody: false,
      includeResponseBody: false,
      includeMethodLabels: false,
      includePathLabels: false,
      includeStatusLabels: false,
      includeUserAgentLabels: false,
      nodeMetricsSampleRate: 0.01,
      maxBodySize: 1024 * 10, // 10KB
      metricPrefix: "minimal",
      serviceName: "minimal-service",
    };
  }

  /**
   * Create high-cardinality configuration preset
   */
  static createHighCardinalityConfig(): Partial<PrometheusHttpMiddlewareConfig> {
    return {
      collectHttpMetrics: true,
      collectDefaultMetrics: true,
      enableDetailedMetrics: true,
      enableNodeMetrics: true,
      trackUserMetrics: true,
      includeRequestBody: true,
      includeResponseBody: true,
      includeMethodLabels: true,
      includePathLabels: true,
      includeStatusLabels: true,
      includeUserAgentLabels: true,
      nodeMetricsSampleRate: 1.0,
      maxBodySize: 1024 * 1024 * 10, // 10MB
      metricPrefix: "high_card",
      serviceName: "high-cardinality-service",
    };
  }
}
