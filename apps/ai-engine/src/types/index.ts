/**
 * AI Engine Service Type Definitions
 * Comprehensive type system for ML models, predictions, and features
 */

export interface Prediction {
  cartId: string;
  modelName: string;
  modelVersion: string;
  value: number;
  probability: number;
  confidence: number;
  recommendedAction: string;
  recommendedDiscount?: number;
  reasoning: string[];
  computedAt: string;
  features?: Record<string, number>;
  metadata?: PredictionMetadata;
}

export interface PredictionMetadata {
  processingTime: number;
  cacheHit: boolean;
  modelLoadTime?: number;
  featureComputeTime?: number;
  inferenceTime?: number;
  modelConfidence?: number;
  keyFeatures?: Record<string, number>;
}

export interface BatchPredictionRequest {
  requests: PredictionRequest[];
  options?: BatchOptions;
}

export interface BatchOptions {
  parallel?: boolean;
  maxConcurrency?: number;
  streamResults?: boolean;
  continueOnError?: boolean;
}

export interface BatchPredictionResponse {
  predictions: Prediction[];
  errors: PredictionError[];
  summary: BatchSummary;
}

export interface BatchSummary {
  total: number;
  successful: number;
  failed: number;
  processingTime: number;
  averageLatency: number;
}

export interface PredictionRequest {
  cartId: string;
  modelName: string;
  features?: Record<string, number>;
  modelVersion?: string;
  forceRecompute?: boolean;
  requestId?: string;
  options?: PredictionOptions;
}

export interface PredictionOptions {
  bypassCache?: boolean;
  includeReasoning?: boolean;
  includeFeatures?: boolean;
  timeout?: number;
}

export interface PredictionError {
  cartId: string;
  error: string;
  code: string;
  timestamp: string;
}

/**
 * ML Model Interfaces
 */
export interface MLModel {
  id: string;
  name: string;
  version: string;
  type: string;
  metadata: ModelMetadata;
  parameters: Record<string, any>;
  predict(features: Record<string, number>): Promise<Prediction>;
  getVersion(): string;
  isLoaded(): boolean;
  getMetadata(): ModelMetadata;
  warmup?(): Promise<void>;
  validate?(features: Record<string, number>): boolean;
}

export interface ModelMetadata {
  version: string;
  name: string;
  description?: string;
  algorithm: string;
  trainedAt: string;
  accuracy?: number;
  features: string[];
  performance: ModelPerformance;
}

export interface ModelPerformance {
  averageLatency: number;
  throughput: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  lastEvaluated: string;
  timestamp?: string;
}

export interface ModelConfig {
  version: string;
  name: string;
  algorithm: string;
  parameters: Record<string, any>;
  features: string[];
  validation: ValidationConfig;
}

export interface ValidationConfig {
  required: string[];
  ranges: Record<string, [number, number]>;
  types: Record<string, string>;
}

/**
 * Feature Processing Types
 */
export interface FeatureComputationRequest {
  cartId: string;
  forceRecompute?: boolean;
  includeExpired?: boolean;
  version?: string;
}

export interface FeatureSet {
  cartId: string;
  features: Record<string, number>;
  computedAt: string;
  version: string;
  source: string;
  ttl?: number;
}

export interface FeatureDefinition {
  name: string;
  type: "number" | "string" | "boolean";
  description: string;
  computation: string;
  dependencies: string[];
  defaultValue?: any;
}

/**
 * Cache and Performance Types
 */
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  version: string;
  hits: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalEntries: number;
  memoryUsage: number;
}

export interface PerformanceMetrics {
  latency: LatencyMetrics;
  throughput: ThroughputMetrics;
  accuracy: AccuracyMetrics;
  resource: ResourceMetrics;
}

export interface LatencyMetrics {
  p50: number;
  p95: number;
  p99: number;
  average: number;
  max: number;
}

export interface ThroughputMetrics {
  requestsPerSecond: number;
  predictionsPerMinute: number;
  batchesPerHour: number;
}

export interface AccuracyMetrics {
  precision: number;
  recall: number;
  f1Score: number;
  auc: number;
}

export interface ResourceMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkUsage: number;
}

/**
 * Service Configuration Types
 */
export interface AIEngineConfig {
  service: ServiceConfig;
  models: ModelServiceConfig;
  features: FeatureServiceConfig;
  cache: CacheConfig;
  performance: PerformanceConfig;
  monitoring: MonitoringConfig;
}

export interface ServiceConfig {
  port: number;
  host: string;
  environment: string;
  version: string;
  cors: CorsConfig;
  rateLimit: RateLimitConfig;
}

export interface CorsConfig {
  origin: string | string[];
  credentials: boolean;
  methods: string[];
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
  skipSuccessfulRequests: boolean;
}

export interface ModelServiceConfig {
  defaultModel: string;
  modelRegistry: string;
  hotSwapEnabled: boolean;
  validationTimeout: number;
  maxMemoryUsage: number;
}

export interface FeatureServiceConfig {
  dataIntelligenceUrl: string;
  timeout: number;
  retries: number;
  circuitBreaker: CircuitBreakerConfig;
}

export interface CircuitBreakerConfig {
  threshold: number;
  timeout: number;
  resetTimeout: number;
}

export interface CacheConfig {
  redis: RedisConfig;
  ttl: TTLConfig;
  maxSize: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db: number;
}

export interface TTLConfig {
  predictions: number;
  features: number;
  models: number;
}

export interface PerformanceConfig {
  batchSize: number;
  maxConcurrency: number;
  timeout: number;
  streaming: StreamingConfig;
}

export interface StreamingConfig {
  enabled: boolean;
  chunkSize: number;
  bufferSize: number;
}

export interface MonitoringConfig {
  metricsEnabled: boolean;
  tracingEnabled: boolean;
  logLevel: string;
  healthCheck: HealthCheckConfig;
}

export interface HealthCheckConfig {
  interval: number;
  timeout: number;
  unhealthyThreshold: number;
}

/**
 * A/B Testing Types
 */
export interface ABTestConfig {
  name: string;
  enabled: boolean;
  variants: ABVariant[];
  trafficSplit: Record<string, number>;
  startDate: string;
  endDate?: string;
}

export interface ABVariant {
  name: string;
  modelVersion: string;
  weight: number;
  enabled: boolean;
}

export interface ABTestResult {
  testName: string;
  variant: string;
  prediction: Prediction;
  metadata: ABTestMetadata;
}

export interface ABTestMetadata {
  userId?: string;
  sessionId?: string;
  experimentId: string;
  timestamp: string;
}

/**
 * Service Interface Types
 */
export interface CacheService {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): Promise<CacheStats>;
  getHealthStatus(): Promise<any>;
  getModel(key: string): Promise<MLModel | undefined>;
  setModel(key: string, model: MLModel, ttl?: number): Promise<void>;
}

export interface RateLimitMiddleware {
  checkRateLimit(context: any): Promise<void>;
  getRemainingRequests(key: string): Promise<number>;
  resetRateLimit(key: string): Promise<void>;
}

export interface MetricsCollector {
  recordHistogram(
    metric: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;
  recordCounter(
    metric: string,
    value?: number,
    labels?: Record<string, string>
  ): Promise<void>;
  recordGauge(
    metric: string,
    value: number,
    labels?: Record<string, string>
  ): Promise<void>;
}

export interface CircuitBreaker {
  execute<T>(fn: () => Promise<T>): Promise<T>;
  getState(): string;
  getFailureCount(): number;
  getLastFailureTime(): number;
  reset(): void;
}

/**
 * Error Types
 */
export interface AIEngineError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
  requestId?: string;
}

export enum ErrorCodes {
  MODEL_NOT_FOUND = "MODEL_NOT_FOUND",
  MODEL_LOAD_FAILED = "MODEL_LOAD_FAILED",
  FEATURE_COMPUTATION_FAILED = "FEATURE_COMPUTATION_FAILED",
  PREDICTION_FAILED = "PREDICTION_FAILED",
  VALIDATION_FAILED = "VALIDATION_FAILED",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  TIMEOUT = "TIMEOUT",
  CACHE_ERROR = "CACHE_ERROR",
  DATA_INTELLIGENCE_ERROR = "DATA_INTELLIGENCE_ERROR",
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
}

/**
 * Event Types for monitoring and logging
 */
export interface PredictionEvent {
  type:
    | "prediction_requested"
    | "prediction_completed"
    | "prediction_failed"
    | "prediction_cached"
    | "prediction_generated";
  cartId: string;
  modelVersion: string;
  modelName?: string;
  timestamp: string;
  duration?: number;
  error?: string;
  metadata?: any;
}

export interface ModelEvent {
  type:
    | "model_loaded"
    | "model_unloaded"
    | "model_failed"
    | "model_validated"
    | "model_retrieved"
    | "model_version_updated"
    | "model_performance_recorded";
  modelVersion: string;
  timestamp: string;
  duration?: number;
  error?: string;
  metadata?: any;
}

export interface FeatureEvent {
  type:
    | "features_requested"
    | "features_computed"
    | "features_cached"
    | "features_failed";
  cartId: string;
  timestamp: string;
  duration?: number;
  featureCount?: number;
  error?: string;
}
