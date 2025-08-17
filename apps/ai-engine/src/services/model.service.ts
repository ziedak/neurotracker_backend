import { Logger, MetricsCollector } from "@libs/monitoring";
import { CacheService } from "./cache.service";
import {
  MLModel,
  ModelMetadata,
  ModelPerformance,
  ModelEvent,
  Prediction,
} from "../types";
import { performance } from "perf_hooks";
import { LRUCache } from "libs/utils/src/lru-cache";

// // Memory-bounded model cache (LRU)
// interface LRUCache<K, V> {
//   get(key: K): V | undefined;
//   set(key: K, value: V): void;
//   delete(key: K): boolean;
//   clear(): void;
//   has(key: K): boolean;
//   keys(): IterableIterator<K>;
//   size: number;
// }

// // Simple LRU implementation for models
// class ModelLRUCache<K, V> implements LRUCache<K, V> {
//   private readonly maxSize: number;
//   private readonly cache = new Map<K, V>();
//   private readonly accessOrder = new Map<K, number>();
//   private accessCounter = 0;

//   constructor(maxSize: number = 20) {
//     this.maxSize = maxSize;
//   }

//   get(key: K): V | undefined {
//     const value = this.cache.get(key);
//     if (value !== undefined) {
//       this.accessOrder.set(key, ++this.accessCounter);
//     }
//     return value;
//   }

//   set(key: K, value: V): void {
//     if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
//       this.evictLeastRecentlyUsed();
//     }
//     this.cache.set(key, value);
//     this.accessOrder.set(key, ++this.accessCounter);
//   }

//   has(key: K): boolean {
//     return this.cache.has(key);
//   }

//   keys(): IterableIterator<K> {
//     return this.cache.keys();
//   }

//   private evictLeastRecentlyUsed(): void {
//     let lruKey: K | undefined;
//     let lruAccess = Infinity;

//     for (const [key, access] of this.accessOrder.entries()) {
//       if (access < lruAccess) {
//         lruAccess = access;
//         lruKey = key;
//       }
//     }

//     if (lruKey !== undefined) {
//       this.cache.delete(lruKey);
//       this.accessOrder.delete(lruKey);
//     }
//   }

//   delete(key: K): boolean {
//     this.accessOrder.delete(key);
//     return this.cache.delete(key);
//   }

//   clear(): void {
//     this.cache.clear();
//     this.accessOrder.clear();
//     this.accessCounter = 0;
//   }

//   get size(): number {
//     return this.cache.size;
//   }
// }

/**
 * Model Service for AI Engine
 * Manages ML model loading, versioning, performance monitoring, and A/B testing
 */
export class ModelService {
  private readonly cacheService: CacheService;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  // Model configuration
  private readonly MODEL_CONFIG = {
    DEFAULT_TTL: 3600, // 1 hour cache for models
    PERFORMANCE_CHECK_INTERVAL: 300000, // 5 minutes
    MIN_CONFIDENCE_THRESHOLD: 0.6,
    A_B_TEST_SPLIT: 0.5, // 50/50 split for A/B testing
  };

  // In-memory model registry with memory bounds (MAX 20 models)
  private modelRegistry: LRUCache<string, MLModel> = new LRUCache<
    string,
    MLModel
  >({ max: 20 });
  private activeModelVersions: Map<string, string> = new Map(); // modelName -> version
  private abTestConfig: Map<string, any> = new Map();

  // Performance tracking with memory bounds
  private modelPerformance: Map<string, ModelPerformance[]> = new Map();
  private lastPerformanceCheck: number = 0;

  constructor(
    cacheService: CacheService,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.cacheService = cacheService;
    this.logger = logger;
    this.metrics = metrics;

    this.logger.info("Model Service initialized");
    this.initializeModels();
  }

  /**
   * Initialize default models and configurations
   */
  async initializeDefaultModels(): Promise<void> {
    return this.initializeModels();
  }

  /**
   * Dispose of resources and cleanup
   */
  async dispose(): Promise<void> {
    try {
      this.logger.info("Disposing Model Service");

      // Clear all cached models
      this.modelRegistry.clear();
      this.activeModelVersions.clear();
      this.abTestConfig.clear();
      this.modelPerformance.clear();

      this.logger.info("Model Service disposed successfully");
    } catch (error) {
      this.logger.error("Error during Model Service disposal", error as Error);
      throw error;
    }
  }

  /**
   * Initialize default models and configurations
   */
  private async initializeModels(): Promise<void> {
    try {
      // Load active models from cache or configure defaults
      await this.loadActiveModels();

      // Initialize A/B test configurations
      await this.initializeABTests();

      this.logger.info("Models initialized", {
        modelCount: this.modelRegistry.size,
        activeVersions: this.activeModelVersions.size,
      });
    } catch (error) {
      this.logger.error("Model initialization failed", error as Error);
    }
  }

  /**
   * Get model for prediction with A/B testing support
   */
  async getModel(
    modelName: string,
    cartId?: string,
    requestId?: string
  ): Promise<MLModel> {
    const startTime = performance.now();

    try {
      // Check if this model has A/B testing enabled
      const abConfig = this.abTestConfig.get(modelName);
      let targetVersion: string;

      if (abConfig && cartId) {
        // Use A/B testing to determine model version
        targetVersion = this.getABTestVersion(modelName, cartId, abConfig);
      } else {
        // Use the active version
        targetVersion = this.activeModelVersions.get(modelName) || "latest";
      }

      const modelKey = `${modelName}:${targetVersion}`;

      // Check memory cache first
      let model = this.modelRegistry.get(modelKey);

      if (!model) {
        // Check Redis cache
        const cached = await this.cacheService.getModel(modelKey);
        if (cached && cached.data) {
          model = cached.data;
          this.modelRegistry.set(modelKey, model as MLModel);
        }
      }

      if (!model) {
        // Load model from storage or create default
        model = await this.loadModel(modelName, targetVersion);

        // Cache in memory and Redis
        this.modelRegistry.set(modelKey, model);
        await this.cacheService.setModel(
          modelKey,
          model,
          this.MODEL_CONFIG.DEFAULT_TTL
        );
      }

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("model_retrieval_duration", duration);

      this.logger.debug("Model retrieved", {
        modelName,
        version: targetVersion,
        cartId,
        requestId,
        duration: Math.round(duration),
        source: this.modelRegistry.has(modelKey) ? "memory" : "cache",
      });

      await this.recordModelEvent({
        type: "model_retrieved",
        modelName,
        modelVersion: targetVersion,
        timestamp: new Date().toISOString(),
        duration,
        metadata: { cartId, requestId, version: targetVersion },
      });

      return model;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "model_retrieval_error_duration",
        duration
      );
      await this.metrics.recordCounter("model_retrieval_error");

      this.logger.error("Model retrieval failed", error as Error, {
        modelName,
        cartId,
        requestId,
        duration: Math.round(duration),
      });

      throw new Error(
        `Failed to retrieve model ${modelName}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Load model from storage or create default configuration
   */
  private async loadModel(
    modelName: string,
    version: string
  ): Promise<MLModel> {
    const startTime = performance.now();

    try {
      // For now, create default model configurations
      // In production, this would load from model registry/storage
      const model = this.createDefaultModel(modelName, version);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("model_loading_duration", duration);

      this.logger.info("Model loaded", {
        modelName,
        version,
        duration: Math.round(duration),
      });

      return model;
    } catch (error) {
      this.logger.error("Model loading failed", error as Error, {
        modelName,
        version,
      });
      throw error;
    }
  }

  /**
   * Create default model configuration
   */
  private createDefaultModel(modelName: string, version: string): MLModel {
    const now = new Date().toISOString();

    const baseModel: MLModel = {
      id: `${modelName}_${version}`,
      name: modelName,
      version,
      type: "cart_abandonment_predictor",
      status: "active",
      metadata: {
        version,
        name: modelName,
        description: `${modelName} prediction model`,
        algorithm: "gradient_boosting",
        trainedAt: now,
        features: [
          "cart_value",
          "session_duration",
          "page_views",
          "previous_purchases",
          "time_since_last_purchase",
          "device_type",
          "traffic_source",
          "user_engagement_score",
        ],
        trainingData: {
          startDate: "2024-01-01",
          endDate: "2024-12-31",
          sampleCount: 100000,
        },
        performance: {
          averageLatency: 50,
          throughput: 100,
          accuracy: 0.85,
          precision: 0.82,
          recall: 0.88,
          f1Score: 0.85,
          auc: 0.91,
          lastEvaluated: now,
        },
        createdAt: now,
        updatedAt: now,
      },
      parameters: {
        confidence_threshold: this.MODEL_CONFIG.MIN_CONFIDENCE_THRESHOLD,
        max_depth: 10,
        learning_rate: 0.1,
        n_estimators: 100,
        regularization: 0.01,
      },
      endpoints: {
        predict: `/models/${modelName}/predict`,
        batch_predict: `/models/${modelName}/batch-predict`,
        explain: `/models/${modelName}/explain`,
      },

      // Required methods
      async predict(features: Record<string, number>): Promise<Prediction> {
        // This would be implemented by the actual model
        throw new Error("Predict method must be implemented by model instance");
      },

      getVersion(): string {
        return this.version;
      },

      isLoaded(): boolean {
        return true;
      },

      getMetadata(): ModelMetadata {
        return this.metadata;
      },
    };

    // Customize based on model name
    switch (modelName) {
      case "cart_recovery":
        baseModel.type = "cart_recovery_optimizer";
        baseModel.metadata.description =
          "Cart recovery timing and messaging optimization model";
        baseModel.metadata.algorithm = "ensemble_classifier";
        break;

      case "purchase_probability":
        baseModel.type = "purchase_predictor";
        baseModel.metadata.description =
          "Real-time purchase probability estimation model";
        baseModel.metadata.algorithm = "neural_network";
        baseModel.parameters.confidence_threshold = 0.7;
        break;

      case "customer_lifetime_value":
        baseModel.type = "clv_predictor";
        baseModel.metadata.description =
          "Customer lifetime value prediction model";
        baseModel.metadata.algorithm = "regression_ensemble";
        break;

      case "churn_prediction":
        baseModel.type = "churn_predictor";
        baseModel.metadata.description = "Customer churn risk assessment model";
        baseModel.metadata.algorithm = "random_forest";
        break;
    }

    return baseModel;
  }

  /**
   * Load active model versions from cache
   */
  private async loadActiveModels(): Promise<void> {
    try {
      // Set default active models
      this.activeModelVersions.set("cart_recovery", "1.2.0");
      this.activeModelVersions.set("purchase_probability", "2.1.0");
      this.activeModelVersions.set("customer_lifetime_value", "1.0.0");
      this.activeModelVersions.set("churn_prediction", "1.1.0");

      this.logger.info("Active model versions loaded", {
        versions: Object.fromEntries(this.activeModelVersions),
      });
    } catch (error) {
      this.logger.error("Failed to load active models", error as Error);
    }
  }

  /**
   * Initialize A/B test configurations
   */
  private async initializeABTests(): Promise<void> {
    try {
      // Example A/B test: cart_recovery model v1.2.0 vs v1.3.0
      this.abTestConfig.set("cart_recovery", {
        enabled: true,
        versionA: "1.2.0",
        versionB: "1.3.0",
        trafficSplit: 0.5, // 50/50 split
        startDate: "2024-01-01",
        endDate: "2024-12-31",
        metrics: ["conversion_rate", "revenue_impact", "model_accuracy"],
      });

      this.logger.info("A/B test configurations initialized", {
        testsActive: this.abTestConfig.size,
      });
    } catch (error) {
      this.logger.error("Failed to initialize A/B tests", error as Error);
    }
  }

  /**
   * Determine model version for A/B testing
   */
  private getABTestVersion(
    modelName: string,
    cartId: string,
    abConfig: any
  ): string {
    // Use consistent hashing based on cartId for stable A/B assignment
    const hash = this.hashString(cartId);
    const bucket = hash % 100;

    const splitPoint = Math.floor(abConfig.trafficSplit * 100);

    if (bucket < splitPoint) {
      return abConfig.versionA;
    } else {
      return abConfig.versionB;
    }
  }

  /**
   * Simple hash function for consistent A/B testing
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Update model version
   */
  async updateModelVersion(modelName: string, version: string): Promise<void> {
    try {
      const oldVersion = this.activeModelVersions.get(modelName);
      this.activeModelVersions.set(modelName, version);

      // Clear cached models to force reload
      const keysToRemove = Array.from(this.modelRegistry.keys()).filter((key) =>
        key.startsWith(`${modelName}:`)
      );

      keysToRemove.forEach((key) => this.modelRegistry.delete(key));

      this.logger.info("Model version updated", {
        modelName,
        oldVersion,
        newVersion: version,
        clearedCacheKeys: keysToRemove.length,
      });

      await this.metrics.recordCounter("model_version_update");

      await this.recordModelEvent({
        type: "model_version_updated",
        modelName,
        modelVersion: version,
        previousVersion: oldVersion,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error("Failed to update model version", error as Error, {
        modelName,
        version,
      });
      throw error;
    }
  }

  /**
   * Get model metadata
   */
  async getModelMetadata(
    modelName: string,
    version?: string
  ): Promise<ModelMetadata> {
    try {
      const targetVersion =
        version || this.activeModelVersions.get(modelName) || "latest";
      const model = await this.getModel(modelName);

      return model.metadata;
    } catch (error) {
      this.logger.error("Failed to get model metadata", error as Error, {
        modelName,
        version,
      });
      throw error;
    }
  }

  /**
   * Record model performance metrics
   */
  async recordModelPerformance(
    modelName: string,
    version: string,
    performance: Omit<ModelPerformance, "timestamp">
  ): Promise<void> {
    try {
      const fullPerformance: ModelPerformance = {
        ...performance,
        timestamp: new Date().toISOString(),
      };

      const key = `${modelName}:${version}`;
      if (!this.modelPerformance.has(key)) {
        this.modelPerformance.set(key, []);
      }

      const performances = this.modelPerformance.get(key)!;
      performances.push(fullPerformance);

      // Keep only last 100 performance records
      if (performances.length > 100) {
        performances.splice(0, performances.length - 100);
      }

      // Record metrics
      await this.metrics.recordGauge(
        `model_accuracy_${modelName}`,
        performance.accuracy
      );
      await this.metrics.recordGauge(
        `model_precision_${modelName}`,
        performance.precision
      );
      await this.metrics.recordGauge(
        `model_recall_${modelName}`,
        performance.recall
      );
      await this.metrics.recordGauge(
        `model_f1_score_${modelName}`,
        performance.f1Score
      );

      this.logger.debug("Model performance recorded", {
        modelName,
        version,
        performance: fullPerformance,
      });

      await this.recordModelEvent({
        type: "model_performance_recorded",
        modelName,
        modelVersion: version,
        performance: fullPerformance,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error("Failed to record model performance", error as Error, {
        modelName,
        version,
      });
    }
  }

  /**
   * Get model performance history
   */
  async getModelPerformance(
    modelName: string,
    version?: string
  ): Promise<ModelPerformance[]> {
    try {
      const targetVersion =
        version || this.activeModelVersions.get(modelName) || "latest";
      const key = `${modelName}:${targetVersion}`;

      return this.modelPerformance.get(key) || [];
    } catch (error) {
      this.logger.error("Failed to get model performance", error as Error, {
        modelName,
        version,
      });
      return [];
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    return Array.from(this.activeModelVersions.keys());
  }

  /**
   * Get A/B test status for a model
   */
  async getABTestStatus(modelName: string): Promise<any> {
    const config = this.abTestConfig.get(modelName);
    if (!config) {
      return { enabled: false };
    }

    return {
      enabled: config.enabled,
      versionA: config.versionA,
      versionB: config.versionB,
      trafficSplit: config.trafficSplit,
      startDate: config.startDate,
      endDate: config.endDate,
      metrics: config.metrics,
    };
  }

  /**
   * Get model service health status
   */
  async getHealthStatus(): Promise<any> {
    try {
      return {
        status: "healthy",
        modelsLoaded: this.modelRegistry.size,
        activeVersions: this.activeModelVersions.size,
        abTestsActive: this.abTestConfig.size,
        performanceRecords: Array.from(this.modelPerformance.values()).reduce(
          (sum, records) => sum + records.length,
          0
        ),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Clear model cache
   */
  async clearModelCache(modelName?: string): Promise<void> {
    try {
      if (modelName) {
        // Clear specific model
        const keysToRemove = Array.from(this.modelRegistry.keys()).filter(
          (key) => key.startsWith(`${modelName}:`)
        );

        keysToRemove.forEach((key) => this.modelRegistry.delete(key));

        this.logger.info("Model cache cleared", {
          modelName,
          keysRemoved: keysToRemove.length,
        });
      } else {
        // Clear all models
        this.modelRegistry.clear();
        this.logger.info("All model cache cleared");
      }

      await this.metrics.recordCounter("model_cache_cleared");
    } catch (error) {
      this.logger.error("Failed to clear model cache", error as Error, {
        modelName,
      });
    }
  }

  /**
   * Record model event for monitoring
   */
  private async recordModelEvent(event: ModelEvent): Promise<void> {
    try {
      // Record event in metrics
      await this.metrics.recordCounter(`model_event_${event.type}`);

      // Could also send to event pipeline or audit log
      this.logger.debug("Model event recorded", event);
    } catch (error) {
      this.logger.error("Failed to record model event", error as Error, {
        event,
      });
    }
  }
}
