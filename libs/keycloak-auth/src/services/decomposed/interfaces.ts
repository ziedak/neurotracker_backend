/**
 * Shared interfaces and types for decomposed token services
 *
 * This file contains common interfaces, types, and enums used across
 * all decomposed token services for consistency and type safety.
 */

/**
 * Service health status
 */
export interface ServiceHealth {
  healthy: boolean;
  status: "healthy" | "degraded" | "unhealthy";
  uptimeSeconds: number;
  lastCheck: number;
  details?: Record<string, any>;
}

/**
 * Service configuration interface
 */
export interface ServiceConfig {
  enabled: boolean;
  timeout?: number;
  retries?: number;
  environment: string;
  instanceId: string;
}

/**
 * Operation result wrapper
 */
export interface OperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
  timestamp: number;
}

/**
 * Cache operation types
 */
export enum CacheOperation {
  GET = "get",
  SET = "set",
  DELETE = "delete",
  INVALIDATE = "invalidate",
  CLEAR = "clear",
}

/**
 * Metrics operation types
 */
export enum MetricsOperationType {
  COUNTER = "counter",
  GAUGE = "gauge",
  TIMER = "timer",
  HISTOGRAM = "histogram",
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Service lifecycle states
 */
export enum ServiceState {
  INITIALIZING = "initializing",
  READY = "ready",
  DEGRADED = "degraded",
  STOPPING = "stopping",
  STOPPED = "stopped",
  ERROR = "error",
}

/**
 * Base service interface
 */
export interface IBaseService {
  /**
   * Get service health status
   */
  getHealthStatus(): ServiceHealth;

  /**
   * Get service configuration
   */
  getConfig(): ServiceConfig;

  /**
   * Shutdown service
   */
  shutdown(): Promise<void>;
}

/**
 * Configuration validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Service registration info
 */
export interface ServiceInfo {
  name: string;
  version: string;
  description: string;
  dependencies: string[];
  state: ServiceState;
  startTime: number;
}

/**
 * Common error context
 */
export interface ErrorContext {
  service: string;
  operation: string;
  severity: ErrorSeverity;
  timestamp: number;
  correlationId?: string;
  metadata?: Record<string, any>;
}

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  operationCount: number;
  averageLatency: number;
  p95Latency: number;
  p99Latency: number;
  errorRate: number;
  throughput: number; // operations per second
}

/**
 * Resource usage metrics
 */
export interface ResourceMetrics {
  memoryUsage: number;
  cpuUsage: number;
  activeConnections: number;
  queueSize: number;
}

/**
 * Service metrics summary
 */
export interface ServiceMetrics {
  performance: PerformanceMetrics;
  resources: ResourceMetrics;
  uptime: number;
  healthScore: number; // 0-100
}

/**
 * Configuration change event
 */
export interface ConfigChangeEvent {
  service: string;
  key: string;
  oldValue: any;
  newValue: any;
  timestamp: number;
}

/**
 * Service event types
 */
export enum ServiceEventType {
  STARTED = "started",
  STOPPED = "stopped",
  HEALTH_CHANGED = "health_changed",
  CONFIG_CHANGED = "config_changed",
  ERROR_OCCURRED = "error_occurred",
  METRICS_UPDATED = "metrics_updated",
}

/**
 * Service event
 */
export interface ServiceEvent {
  type: ServiceEventType;
  service: string;
  timestamp: number;
  data?: any;
  correlationId?: string;
}

/**
 * Service event handler
 */
export type ServiceEventHandler = (event: ServiceEvent) => void;

/**
 * Service registry interface
 */
export interface IServiceRegistry {
  /**
   * Register a service
   */
  register(service: IBaseService, info: ServiceInfo): void;

  /**
   * Unregister a service
   */
  unregister(serviceName: string): void;

  /**
   * Get service by name
   */
  getService<T extends IBaseService>(serviceName: string): T | null;

  /**
   * Get all registered services
   */
  getAllServices(): Map<string, ServiceInfo>;

  /**
   * Subscribe to service events
   */
  subscribe(handler: ServiceEventHandler): () => void;
}

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = "closed",
  OPEN = "open",
  HALF_OPEN = "half_open",
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
  successThreshold: number;
}

/**
 * Circuit breaker interface
 */
export interface ICircuitBreaker {
  /**
   * Execute operation with circuit breaker protection
   */
  execute<T>(operation: () => Promise<T>): Promise<T>;

  /**
   * Get current circuit state
   */
  getState(): CircuitState;

  /**
   * Get circuit breaker statistics
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime?: number;
    lastSuccessTime?: number;
  };

  /**
   * Reset circuit breaker
   */
  reset(): void;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  defaultTimeout: number;
  maxTimeout: number;
  timeoutErrors: string[];
}

/**
 * Service factory function type
 */
export type ServiceFactory<T> = (...args: any[]) => T;

/**
 * Service dependency injection container
 */
export interface IServiceContainer {
  /**
   * Register a service factory
   */
  register<T>(
    name: string,
    factory: ServiceFactory<T>,
    singleton?: boolean
  ): void;

  /**
   * Resolve a service instance
   */
  resolve<T>(name: string): T;

  /**
   * Check if service is registered
   */
  has(name: string): boolean;

  /**
   * Clear all registered services
   */
  clear(): void;
}
