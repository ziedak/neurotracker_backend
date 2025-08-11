/**
 * Production ML Service - Optimized Architecture
 * Keeps enterprise features while fixing performance issues
 */

import { performance } from "perf_hooks";
import { LRUCache } from "lru-cache";

// Production ML Types
interface MLModel {
  id: string;
  version: string;
  type: "tensorflow" | "pytorch" | "onnx" | "sklearn";
  path: string;
  sizeInBytes: number;
  predict(features: Record<string, number>): Promise<number>;
  warmUp(): Promise<void>;
  dispose(): Promise<void>;
}

interface Prediction {
  cartId: string;
  modelId: string;
  probability: number;
  confidence: number;
  explanation?: Record<string, number>;
  timestamp: string;
  latencyMs: number;
}

interface PredictionRequest {
  cartId: string;
  modelName: string;
  features?: Record<string, number>;
  explainable?: boolean;
}

// Optimized Model Manager for Production ML
export class OptimizedModelManager {
  private modelCache = new LRUCache<string, MLModel>({
    max: 50, // Maximum 50 models in memory
    maxSize: 2 * 1024 * 1024 * 1024, // 2GB memory limit
    sizeCalculation: (model) => model.sizeInBytes,
    dispose: (model) => model.dispose(), // Cleanup when evicted
  });

  private loadingPromises = new Map<string, Promise<MLModel>>();
  private modelMetrics = new Map<
    string,
    { predictions: number; errors: number; avgLatency: number }
  >();

  async getModel(modelName: string, version = "latest"): Promise<MLModel> {
    const modelKey = `${modelName}:${version}`;

    // Check cache first
    const cached = this.modelCache.get(modelKey);
    if (cached) {
      return cached;
    }

    // Check if already loading to prevent duplicate loads
    const loadingPromise = this.loadingPromises.get(modelKey);
    if (loadingPromise) {
      return loadingPromise;
    }

    // Load model
    const loading = this.loadModel(modelName, version);
    this.loadingPromises.set(modelKey, loading);

    try {
      const model = await loading;

      // Warm up model
      await model.warmUp();

      // Cache it
      this.modelCache.set(modelKey, model);

      return model;
    } finally {
      this.loadingPromises.delete(modelKey);
    }
  }

  private async loadModel(
    modelName: string,
    version: string
  ): Promise<MLModel> {
    // In production, this would load from model registry
    // For now, simulate different model types
    const modelConfigs = {
      cart_recovery: { type: "tensorflow" as const, size: 50 * 1024 * 1024 },
      churn_prediction: { type: "pytorch" as const, size: 100 * 1024 * 1024 },
      clv_prediction: { type: "sklearn" as const, size: 10 * 1024 * 1024 },
    };

    const config = modelConfigs[modelName as keyof typeof modelConfigs] || {
      type: "sklearn" as const,
      size: 10 * 1024 * 1024,
    };

    return new ProductionMLModel(
      `${modelName}:${version}`,
      config.type,
      `/models/${modelName}/${version}`,
      config.size
    );
  }

  recordPrediction(modelId: string, latencyMs: number, success: boolean): void {
    const metrics = this.modelMetrics.get(modelId) || {
      predictions: 0,
      errors: 0,
      avgLatency: 0,
    };

    metrics.predictions++;
    if (!success) metrics.errors++;

    // Update rolling average latency
    metrics.avgLatency =
      (metrics.avgLatency * (metrics.predictions - 1) + latencyMs) /
      metrics.predictions;

    this.modelMetrics.set(modelId, metrics);
  }

  getModelMetrics(modelId: string) {
    return (
      this.modelMetrics.get(modelId) || {
        predictions: 0,
        errors: 0,
        avgLatency: 0,
      }
    );
  }

  getHealthStatus() {
    return {
      modelsLoaded: this.modelCache.size,
      memoryUsage: this.modelCache.calculatedSize,
      memoryLimit: this.modelCache.maxSize,
      loadingModels: this.loadingPromises.size,
    };
  }
}

// Production ML Model Implementation
class ProductionMLModel implements MLModel {
  public readonly id: string;
  public readonly version: string;
  public readonly type: "tensorflow" | "pytorch" | "onnx" | "sklearn";
  public readonly path: string;
  public readonly sizeInBytes: number;

  private isWarmedUp = false;
  private model: any; // Would be actual ML model instance

  constructor(
    id: string,
    type: MLModel["type"],
    path: string,
    sizeInBytes: number
  ) {
    this.id = id;
    this.version = id.split(":")[1] || "latest";
    this.type = type;
    this.path = path;
    this.sizeInBytes = sizeInBytes;
  }

  async warmUp(): Promise<void> {
    if (this.isWarmedUp) return;

    // Simulate model warm-up (dummy predictions)
    await this.predict({ warmup: 1 });
    this.isWarmedUp = true;
  }

  async predict(features: Record<string, number>): Promise<number> {
    // Simulate actual ML model prediction
    // In production, this would call TensorFlow/PyTorch/etc.

    const featureValues = Object.values(features);
    const sum = featureValues.reduce((a, b) => a + b, 0);
    const normalized = sum / featureValues.length / 100;

    // Simulate different model behaviors
    switch (this.type) {
      case "tensorflow":
        return Math.min(0.95, Math.max(0.05, 0.6 + normalized * 0.3));
      case "pytorch":
        return Math.min(0.95, Math.max(0.05, 0.5 + Math.sin(normalized) * 0.4));
      case "sklearn":
        return Math.min(0.95, Math.max(0.05, 0.4 + normalized * 0.5));
      default:
        return 0.5;
    }
  }

  async dispose(): Promise<void> {
    // Cleanup model resources
    this.model = null;
    this.isWarmedUp = false;
  }
}

// Optimized Feature Service with Circuit Breaker
export class OptimizedFeatureService {
  private featureCache = new LRUCache<string, Record<string, number>>({
    max: 10000,
    ttl: 15 * 60 * 1000, // 15 minutes TTL
  });

  private circuitBreaker = {
    failures: 0,
    lastFailure: 0,
    isOpen: false,
    threshold: 5,
    timeout: 30000, // 30 seconds
  };

  async getFeatures(cartId: string): Promise<Record<string, number>> {
    // Check cache first
    const cached = this.featureCache.get(cartId);
    if (cached) return cached;

    // Check circuit breaker
    if (this.isCircuitOpen()) {
      throw new Error("Feature service circuit breaker is open");
    }

    try {
      const features = await this.computeFeatures(cartId);
      this.featureCache.set(cartId, features);
      this.recordSuccess();
      return features;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private async computeFeatures(
    cartId: string
  ): Promise<Record<string, number>> {
    // In production, this would call data-intelligence service
    // Simulate feature computation with realistic latency
    await new Promise((resolve) =>
      setTimeout(resolve, 10 + Math.random() * 20)
    );

    const hash = this.hashString(cartId);
    return {
      cart_value: 50 + (hash % 500),
      session_duration: 120 + (hash % 600),
      page_views: 3 + (hash % 15),
      previous_purchases: hash % 10,
      time_since_last_purchase: (hash % 30) * 24 * 60 * 60, // seconds
      user_engagement_score: 0.3 + (hash % 70) / 100,
      device_type: hash % 3, // 0=mobile, 1=desktop, 2=tablet
      traffic_source: hash % 4, // 0=organic, 1=paid, 2=direct, 3=social
    };
  }

  private isCircuitOpen(): boolean {
    if (!this.circuitBreaker.isOpen) return false;

    // Check if timeout has passed
    if (
      Date.now() - this.circuitBreaker.lastFailure >
      this.circuitBreaker.timeout
    ) {
      this.circuitBreaker.isOpen = false;
      this.circuitBreaker.failures = 0;
      return false;
    }

    return true;
  }

  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    if (this.circuitBreaker.failures >= this.circuitBreaker.threshold) {
      this.circuitBreaker.isOpen = true;
    }
  }

  private recordSuccess(): void {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.isOpen = false;
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash);
  }

  getHealthStatus() {
    return {
      cacheSize: this.featureCache.size,
      circuitBreaker: {
        isOpen: this.circuitBreaker.isOpen,
        failures: this.circuitBreaker.failures,
        lastFailure: this.circuitBreaker.lastFailure,
      },
    };
  }
}

// Optimized Prediction Service
export class OptimizedPredictionService {
  private readonly modelManager = new OptimizedModelManager();
  private readonly featureService = new OptimizedFeatureService();

  private predictionCache = new LRUCache<string, Prediction>({
    max: 5000,
    ttl: 15 * 60 * 1000, // 15 minutes TTL
  });

  async predict(request: PredictionRequest): Promise<Prediction> {
    const startTime = performance.now();
    const cacheKey = `${request.cartId}:${request.modelName}`;

    try {
      // Check cache first
      const cached = this.predictionCache.get(cacheKey);
      if (cached) return cached;

      // Get features and model in parallel
      const [features, model] = await Promise.all([
        request.features || this.featureService.getFeatures(request.cartId),
        this.modelManager.getModel(request.modelName),
      ]);

      // Make prediction
      const probability = await model.predict(features);
      const latencyMs = performance.now() - startTime;

      const prediction: Prediction = {
        cartId: request.cartId,
        modelId: model.id,
        probability,
        confidence: 0.85 + Math.random() * 0.1, // Simulate confidence
        explanation: request.explainable
          ? this.generateExplanation(features, probability)
          : undefined,
        timestamp: new Date().toISOString(),
        latencyMs,
      };

      // Cache and record metrics
      this.predictionCache.set(cacheKey, prediction);
      this.modelManager.recordPrediction(model.id, latencyMs, true);

      return prediction;
    } catch (error) {
      const latencyMs = performance.now() - startTime;
      this.modelManager.recordPrediction(request.modelName, latencyMs, false);
      throw error;
    }
  }

  async batchPredict(requests: PredictionRequest[]): Promise<Prediction[]> {
    // Process in chunks to prevent memory issues
    const chunkSize = 50;
    const chunks = [];

    for (let i = 0; i < requests.length; i += chunkSize) {
      chunks.push(requests.slice(i, i + chunkSize));
    }

    const results: Prediction[] = [];

    for (const chunk of chunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map((req) => this.predict(req))
      );

      results.push(
        ...chunkResults
          .filter(
            (result): result is PromiseFulfilledResult<Prediction> =>
              result.status === "fulfilled"
          )
          .map((result) => result.value)
      );
    }

    return results;
  }

  private generateExplanation(
    features: Record<string, number>,
    prediction: number
  ): Record<string, number> {
    // Simple SHAP-like explanation simulation
    const importance = {
      cart_value: 0.3,
      user_engagement_score: 0.25,
      session_duration: 0.2,
      previous_purchases: 0.15,
      page_views: 0.1,
    };

    const explanation: Record<string, number> = {};
    for (const [feature, weight] of Object.entries(importance)) {
      if (features[feature] !== undefined) {
        explanation[feature] = (features[feature] / 100) * weight * prediction;
      }
    }

    return explanation;
  }

  getHealthStatus() {
    return {
      predictionCache: this.predictionCache.size,
      modelManager: this.modelManager.getHealthStatus(),
      featureService: this.featureService.getHealthStatus(),
    };
  }
}

// Service Factory
export class OptimizedServices {
  private static predictionService: OptimizedPredictionService;

  static getPredictionService(): OptimizedPredictionService {
    if (!this.predictionService) {
      this.predictionService = new OptimizedPredictionService();
    }
    return this.predictionService;
  }
}
