/**
 * High-Performance Prometheus Metrics Collector
 *
 * Enterprise-grade metrics collection with zero-allocation recording,
 * proper histogram buckets, and automatic Prometheus exposition.
 */

import { PrometheusMetricsCollector } from "./PrometheusMetricsCollector";

// ===================================================================
// METRICS COLLECTOR INTERFACE
// ===================================================================

export interface IMetricsCollector {
  /**
   * Record counter metric
   */
  recordCounter(
    name: string,
    value?: number,
    labels?: Record<string, string>
  ): void;

  /**
   * Record timer metric (in milliseconds)
   */
  recordTimer(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void;

  /**
   * Record gauge metric
   */
  recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void;

  /**
   * Record histogram metric
   */
  recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
    buckets?: number[]
  ): void;

  /**
   * Record summary metric
   */
  recordSummary(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void;

  /**
   * Get current metrics as Prometheus exposition format
   */
  getMetrics(): Promise<string>;

  // ===================================================================
  // HIGH-LEVEL BUSINESS METRICS
  // ===================================================================

  /**
   * Record API request with full context
   */
  recordApiRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    service?: string
  ): void;

  /**
   * Record database operation
   */
  recordDatabaseOperation(
    clientType: "redis" | "postgres" | "clickhouse",
    operation: string,
    duration: number,
    success: boolean,
    service?: string
  ): void;

  /**
   * Record authentication operation
   */
  recordAuthOperation(
    operation: "login" | "register" | "refresh" | "logout",
    result: "success" | "failure" | "error",
    userRole?: string
  ): void;

  /**
   * Record WebSocket activity
   */
  recordWebSocketActivity(
    service: string,
    messageType: string,
    direction: "inbound" | "outbound",
    connectionCount?: number
  ): void;

  /**
   * Record Node.js process metrics
   */
  recordNodeMetrics(service: string): void;

  /**
   * Measure and record event loop lag
   */
  measureEventLoopLag(service: string): void;
}

// ===================================================================
// METRICS COLLECTOR IMPLEMENTATION
// ===================================================================

export class MetricsCollector implements IMetricsCollector {
  private collector: PrometheusMetricsCollector;

  constructor(collector?: PrometheusMetricsCollector) {
    this.collector = collector || new PrometheusMetricsCollector();
  }

  static create(collector?: PrometheusMetricsCollector): MetricsCollector {
    return new MetricsCollector(collector);
  }

  /**
   * Get singleton instance - for backwards compatibility
   */
  private static instance?: MetricsCollector;
  static getInstance(): MetricsCollector {
    if (!this.instance) {
      this.instance = new MetricsCollector();
    }
    return this.instance;
  }

  // ===================================================================
  // CORE METRIC METHODS
  // ===================================================================

  recordCounter(
    name: string,
    value = 1,
    labels?: Record<string, string>
  ): void {
    this.collector.recordCounter(name, value, labels);
  }

  recordTimer(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    this.collector.recordTimer(name, value, labels);
  }

  recordGauge(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    this.collector.recordGauge(name, value, labels);
  }

  recordHistogram(
    name: string,
    value: number,
    labels?: Record<string, string>,
    buckets?: number[]
  ): void {
    this.collector.recordHistogram(name, value, labels, buckets);
  }

  recordSummary(
    name: string,
    value: number,
    labels?: Record<string, string>
  ): void {
    this.collector.recordSummary(name, value, labels);
  }

  async getMetrics(): Promise<string> {
    return this.collector.getMetrics();
  }

  // ===================================================================
  // HIGH-LEVEL BUSINESS METRICS
  // ===================================================================

  recordApiRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    service = "unknown"
  ): void {
    this.collector.recordApiRequest(
      method,
      route,
      statusCode,
      duration,
      service
    );
  }

  recordDatabaseOperation(
    clientType: "redis" | "postgres" | "clickhouse",
    operation: string,
    duration: number,
    success: boolean,
    service = "unknown"
  ): void {
    this.collector.recordDatabaseOperation(
      clientType,
      operation,
      duration,
      success,
      service
    );
  }

  recordAuthOperation(
    operation: "login" | "register" | "refresh" | "logout",
    result: "success" | "failure" | "error",
    userRole = "unknown"
  ): void {
    this.collector.recordAuthOperation(operation, result, userRole);
  }

  recordWebSocketActivity(
    service: string,
    messageType: string,
    direction: "inbound" | "outbound",
    connectionCount?: number
  ): void {
    this.collector.recordWebSocketActivity(
      service,
      messageType,
      direction,
      connectionCount
    );
  }

  recordNodeMetrics(service: string): void {
    this.collector.recordNodeMetrics(service);
  }

  measureEventLoopLag(service: string): void {
    this.collector.measureEventLoopLag(service);
  }
}

export { MetricsCollector as default };
