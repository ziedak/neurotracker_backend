import { Logger, MetricsCollector } from "@libs/monitoring";
import { ModelService } from "./model.service";
import { FeatureService } from "./feature.service";
import { CacheService } from "./cache.service";
import {
  Prediction,
  PredictionRequest,
  MLModel,
  FeatureSet,
  PredictionEvent,
} from "../types";
import { performance } from "perf_hooks";

/**
 * Prediction Service for AI Engine
 * Orchestrates ML predictions using models and features
 */
export class PredictionService {
  private readonly modelService: ModelService;
  private readonly featureService: FeatureService;
  private readonly cacheService: CacheService;
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  // Prediction configuration
  private readonly PREDICTION_CONFIG = {
    DEFAULT_TTL: 900, // 15 minutes cache for predictions
    MIN_CONFIDENCE: 0.6,
    MAX_BATCH_SIZE: 50,
    TIMEOUT_MS: 15000,
    RETRY_ATTEMPTS: 2,
  };

  // Performance tracking
  private readonly performanceStats = {
    totalPredictions: 0,
    successfulPredictions: 0,
    failedPredictions: 0,
    averageLatency: 0,
    cacheHitRate: 0,
  };

  constructor(
    modelService: ModelService,
    featureService: FeatureService,
    cacheService: CacheService,
    logger: ILogger,
    metrics: MetricsCollector
  ) {
    this.modelService = modelService;
    this.featureService = featureService;
    this.cacheService = cacheService;
    this.logger = logger;
    this.metrics = metrics;

    this.logger.info("Prediction Service initialized");
  }

  /**
   * Make a prediction for a cart
   */
  async predict(request: PredictionRequest): Promise<Prediction> {
    const startTime = performance.now();
    const { cartId, modelName, forceRecompute = false, requestId } = request;

    try {
      // Check cache first unless force recompute is requested
      if (!forceRecompute) {
        const cached = await this.cacheService.getPrediction(cartId, modelName);
        if (cached) {
          const duration = performance.now() - startTime;

          await this.updatePerformanceStats(true, duration, true);
          await this.metrics.recordTimer(
            "prediction_cache_hit_duration",
            duration
          );
          await this.metrics.recordCounter("prediction_cache_hit");

          this.logger.debug("Prediction retrieved from cache", {
            cartId,
            modelName,
            requestId,
            duration: Math.round(duration),
            confidence: cached.data.confidence,
            source: "cache",
          });

          await this.recordPredictionEvent({
            type: "prediction_cached",
            cartId,
            modelName,
            modelVersion: "latest",
            requestId,
            timestamp: new Date().toISOString(),
            duration,
            confidence: cached.data.confidence,
            prediction: cached.data.value,
          });

          return cached.data;
        }
      }

      // Generate new prediction
      const prediction = await this.generatePrediction(request);

      // Cache the prediction
      await this.cacheService.setPrediction(
        cartId,
        modelName,
        prediction,
        this.PREDICTION_CONFIG.DEFAULT_TTL
      );

      const duration = performance.now() - startTime;
      await this.updatePerformanceStats(true, duration, false);
      await this.metrics.recordTimer("prediction_total_duration", duration);
      await this.metrics.recordCounter("prediction_success");

      this.logger.info("Prediction generated and cached", {
        cartId,
        modelName,
        requestId,
        duration: Math.round(duration),
        confidence: prediction.confidence,
        prediction: prediction.value,
        source: "generated",
      });

      await this.recordPredictionEvent({
        type: "prediction_generated",
        cartId,
        modelName,
        modelVersion: prediction.modelVersion,
        requestId,
        timestamp: new Date().toISOString(),
        duration,
        confidence: prediction.confidence,
        prediction: prediction.value,
      });

      return prediction;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.updatePerformanceStats(false, duration, false);
      await this.metrics.recordTimer("prediction_error_duration", duration);
      await this.metrics.recordCounter("prediction_error");

      this.logger.error("Prediction generation failed", error as Error, {
        cartId,
        modelName,
        requestId,
        duration: Math.round(duration),
      });

      await this.recordPredictionEvent({
        type: "prediction_failed",
        cartId,
        modelName,
        modelVersion: "latest",
        requestId,
        timestamp: new Date().toISOString(),
        duration,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      throw new Error(
        `Prediction failed for cart ${cartId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Generate prediction using model and features
   */
  private async generatePrediction(
    request: PredictionRequest
  ): Promise<Prediction> {
    const startTime = performance.now();
    const { cartId, modelName, requestId } = request;

    try {
      // Get model and features in parallel
      const [model, features] = await Promise.all([
        this.modelService.getModel(modelName, cartId, requestId),
        this.featureService.getFeatures({ cartId }),
      ]);

      // Perform prediction
      const prediction = await this.executePrediction(model, features, request);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "prediction_generation_duration",
        duration
      );

      this.logger.debug("Prediction computed", {
        cartId,
        modelName,
        requestId,
        duration: Math.round(duration),
        confidence: prediction.confidence,
        featureCount: Object.keys(features.features).length,
      });

      return prediction;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "prediction_generation_error_duration",
        duration
      );

      this.logger.error("Prediction computation failed", error as Error, {
        cartId,
        modelName,
        requestId,
        duration: Math.round(duration),
      });

      throw error;
    }
  }

  /**
   * Execute prediction algorithm
   */
  private async executePrediction(
    model: MLModel,
    features: FeatureSet,
    request: PredictionRequest
  ): Promise<Prediction> {
    const startTime = performance.now();

    try {
      // In a real implementation, this would call the actual ML model
      // For now, we'll simulate prediction logic based on features
      const prediction = this.simulatePrediction(model, features, request);

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("prediction_execution_duration", duration);

      this.logger.debug("Prediction executed", {
        cartId: request.cartId,
        modelName: model.name,
        modelVersion: model.version,
        duration: Math.round(duration),
        confidence: prediction.confidence,
      });

      return prediction;
    } catch (error) {
      this.logger.error("Prediction execution failed", error as Error, {
        cartId: request.cartId,
        modelName: model.name,
      });
      throw error;
    }
  }

  /**
   * Simulate ML prediction (replace with actual model inference)
   */
  private simulatePrediction(
    model: MLModel,
    features: FeatureSet,
    request: PredictionRequest
  ): Prediction {
    const { cartId, modelName } = request;
    const { features: featureData } = features;

    // Extract key features with defaults
    const cartValue = featureData.cart_value || 0;
    const sessionDuration = featureData.session_duration || 0;
    const pageViews = featureData.page_views || 0;
    const previousPurchases = featureData.previous_purchases || 0;
    const userEngagement = featureData.user_engagement_score || 0.5;

    let probability = 0;
    let explanation = "";

    // Simulate different prediction types based on model
    switch (model.type) {
      case "cart_abandonment_predictor":
        // Higher cart value and engagement = lower abandonment probability
        probability = Math.max(
          0.1,
          Math.min(
            0.9,
            0.8 -
              (cartValue / 1000) * 0.3 -
              userEngagement * 0.4 -
              (sessionDuration / 600) * 0.1
          )
        );
        explanation =
          "Based on cart value, user engagement, and session behavior patterns";
        break;

      case "cart_recovery_optimizer":
        // Optimal recovery timing based on user behavior
        probability = Math.max(
          0.2,
          Math.min(
            0.8,
            0.6 +
              previousPurchases * 0.1 +
              userEngagement * 0.2 -
              (cartValue / 2000) * 0.1
          )
        );
        explanation =
          "Optimal recovery timing based on purchase history and engagement";
        break;

      case "purchase_predictor":
        // Purchase probability based on multiple factors
        probability = Math.max(
          0.1,
          Math.min(
            0.9,
            0.3 +
              (cartValue / 500) * 0.2 +
              userEngagement * 0.3 +
              (pageViews / 10) * 0.1
          )
        );
        explanation =
          "Purchase likelihood based on cart value, engagement, and browsing behavior";
        break;

      case "clv_predictor":
        // Customer lifetime value prediction (return as monetary value)
        probability = Math.max(
          100,
          cartValue * (1 + userEngagement) * (1 + previousPurchases * 0.1)
        );
        explanation =
          "Estimated customer lifetime value based on current and historical behavior";
        break;

      case "churn_predictor":
        // Churn risk based on engagement and purchase history
        probability = Math.max(
          0.1,
          Math.min(
            0.9,
            0.7 -
              userEngagement * 0.4 -
              previousPurchases * 0.05 -
              (sessionDuration / 1200) * 0.1
          )
        );
        explanation =
          "Churn risk based on engagement decline and purchase patterns";
        break;

      default:
        probability = 0.5 + (Math.random() - 0.5) * 0.4; // Random with some variance
        explanation = "Generic prediction model";
    }

    // Add some realistic noise
    probability += (Math.random() - 0.5) * 0.1;
    probability = Math.max(0, Math.min(1, probability));

    // Calculate confidence based on feature completeness and model performance
    const featureCompleteness =
      Object.keys(featureData).length / model.metadata.features.length;
    const baseConfidence = model.metadata.performance?.accuracy || 0.8;
    const confidence = Math.min(0.95, baseConfidence * featureCompleteness);

    const prediction: Prediction = {
      cartId,
      modelName: model.name,
      modelVersion: model.version,
      value: model.type === "clv_predictor" ? probability : probability,
      probability,
      confidence,
      recommendedAction: "optimize",
      reasoning: ["Cart value analysis", "Engagement scoring"],
      computedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      features: {
        count: Object.keys(featureData).length,
        completeness: featureCompleteness,
        keyFeatures: cartValue,
      },
      explanation,
      metadata: {
        processingTime: Math.random() * 100 + 50, // Simulated processing time
        cacheHit: false,
        modelConfidence: confidence,
        keyFeatures: cartValue,
        featureImportance: {
          cart_value: 0.3,
          user_engagement_score: 0.25,
          session_duration: 0.2,
          previous_purchases: 0.15,
          page_views: 0.1,
        },
      },
    };

    return prediction;
  }

  /**
   * Make batch predictions
   */
  async batchPredict(requests: PredictionRequest[]): Promise<Prediction[]> {
    const startTime = performance.now();

    try {
      if (requests.length > this.PREDICTION_CONFIG.MAX_BATCH_SIZE) {
        throw new Error(
          `Batch size ${requests.length} exceeds maximum ${this.PREDICTION_CONFIG.MAX_BATCH_SIZE}`
        );
      }

      // Check cache for all requests
      const cachedResults: Prediction[] = [];
      const uncachedRequests: PredictionRequest[] = [];

      for (const request of requests) {
        if (!request.forceRecompute) {
          const cached = await this.cacheService.getPrediction(
            request.cartId,
            request.modelName
          );
          if (cached) {
            cachedResults.push(cached.data);
            continue;
          }
        }
        uncachedRequests.push(request);
      }

      // Generate predictions for uncached requests
      const computedResults: Prediction[] = [];
      if (uncachedRequests.length > 0) {
        const computePromises = uncachedRequests.map((request) =>
          this.generatePrediction(request)
        );
        const computed = await Promise.all(computePromises);
        computedResults.push(...computed);

        // Cache computed results
        await Promise.all(
          computed.map((prediction) =>
            this.cacheService.setPrediction(
              prediction.cartId,
              prediction.modelName,
              prediction,
              this.PREDICTION_CONFIG.DEFAULT_TTL
            )
          )
        );
      }

      // Combine results
      const allResults = [...cachedResults, ...computedResults];

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("batch_prediction_duration", duration);
      await this.metrics.recordCounter("batch_prediction_success");

      this.logger.info("Batch predictions completed", {
        totalRequests: requests.length,
        cachedResults: cachedResults.length,
        computedResults: computedResults.length,
        duration: Math.round(duration),
      });

      return allResults;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer(
        "batch_prediction_error_duration",
        duration
      );
      await this.metrics.recordCounter("batch_prediction_error");

      this.logger.error("Batch prediction failed", error as Error, {
        requestCount: requests.length,
        duration: Math.round(duration),
      });

      throw new Error(
        `Batch prediction failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Get prediction explanation
   */
  async explainPrediction(cartId: string, modelName: string): Promise<any> {
    try {
      // Get the cached prediction
      const cached = await this.cacheService.getPrediction(cartId, modelName);
      if (!cached) {
        throw new Error("Prediction not found in cache");
      }

      const prediction = cached.data;
      const features = await this.featureService.getFeatures({ cartId });

      return {
        prediction: {
          value: prediction.value,
          confidence: prediction.confidence,
          explanation: prediction.explanation,
        },
        features: {
          count: prediction.features.count,
          completeness: prediction.features.completeness,
          keyFeatures: prediction.features.keyFeatures,
          importance: prediction.metadata?.featureImportance || {},
        },
        model: {
          name: prediction.modelName,
          version: prediction.modelVersion,
          type: (await this.modelService.getModel(modelName)).type,
        },
        recommendations: this.generateRecommendations(prediction, features),
      };
    } catch (error) {
      this.logger.error("Failed to explain prediction", error as Error, {
        cartId,
        modelName,
      });
      throw error;
    }
  }

  /**
   * Generate actionable recommendations based on prediction
   */
  private generateRecommendations(
    prediction: Prediction,
    features: FeatureSet
  ): string[] {
    const recommendations: string[] = [];
    const { value: probability, modelName } = prediction;
    const featureData = features.features;

    switch (modelName) {
      case "cart_abandonment_predictor":
        if (probability > 0.7) {
          recommendations.push(
            "High abandonment risk - consider immediate intervention"
          );
          recommendations.push(
            "Send personalized discount or free shipping offer"
          );
          if (featureData.session_duration < 300) {
            recommendations.push(
              "User has short session - simplify checkout process"
            );
          }
        }
        break;

      case "cart_recovery_optimizer":
        if (probability > 0.6) {
          recommendations.push("Optimal time for recovery email campaign");
          recommendations.push(
            "Use personalized messaging based on browsing history"
          );
        }
        break;

      case "purchase_predictor":
        if (probability > 0.8) {
          recommendations.push(
            "High purchase intent - optimize for conversion"
          );
          recommendations.push(
            "Consider upselling or cross-selling opportunities"
          );
        } else if (probability < 0.3) {
          recommendations.push(
            "Low purchase intent - focus on engagement and trust building"
          );
        }
        break;

      case "churn_predictor":
        if (probability > 0.6) {
          recommendations.push(
            "High churn risk - implement retention strategy"
          );
          recommendations.push("Provide exclusive offers or loyalty rewards");
        }
        break;
    }

    return recommendations;
  }

  /**
   * Invalidate prediction cache
   */
  async invalidatePrediction(
    cartId: string,
    modelName?: string
  ): Promise<void> {
    try {
      if (modelName) {
        await this.cacheService.setPrediction(
          cartId,
          modelName,
          null as any,
          0
        );
      } else {
        // Invalidate all predictions for the cart
        const models = await this.modelService.listModels();
        await Promise.all(
          models.map((model) =>
            this.cacheService.setPrediction(cartId, model, null as any, 0)
          )
        );
      }

      this.logger.info("Prediction cache invalidated", { cartId, modelName });
      await this.metrics.recordCounter("prediction_cache_invalidation");
    } catch (error) {
      this.logger.error(
        "Failed to invalidate prediction cache",
        error as Error,
        {
          cartId,
          modelName,
        }
      );
    }
  }

  /**
   * Get prediction service performance stats
   */
  getPerformanceStats(): any {
    return {
      ...this.performanceStats,
      cacheHitRate:
        this.performanceStats.totalPredictions > 0
          ? this.performanceStats.cacheHitRate /
            this.performanceStats.totalPredictions
          : 0,
    };
  }

  /**
   * Update performance statistics
   */
  private async updatePerformanceStats(
    success: boolean,
    duration: number,
    cacheHit: boolean
  ): Promise<void> {
    this.performanceStats.totalPredictions++;

    if (success) {
      this.performanceStats.successfulPredictions++;
    } else {
      this.performanceStats.failedPredictions++;
    }

    if (cacheHit) {
      this.performanceStats.cacheHitRate++;
    }

    // Update rolling average latency
    const count = this.performanceStats.totalPredictions;
    this.performanceStats.averageLatency =
      (this.performanceStats.averageLatency * (count - 1) + duration) / count;
  }

  /**
   * Get prediction service health status
   */
  async getHealthStatus(): Promise<any> {
    try {
      const [modelHealth, featureHealth] = await Promise.all([
        this.modelService.getHealthStatus(),
        this.featureService.getHealthStatus(),
      ]);

      return {
        status:
          modelHealth.status === "healthy" && featureHealth.status === "healthy"
            ? "healthy"
            : "degraded",
        dependencies: {
          modelService: modelHealth.status,
          featureService: featureHealth.status,
        },
        performance: this.getPerformanceStats(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Record prediction event for monitoring
   */
  private async recordPredictionEvent(event: PredictionEvent): Promise<void> {
    try {
      // Record event in metrics
      await this.metrics.recordCounter(`prediction_event_${event.type}`);

      // Could also send to event pipeline or audit log
      this.logger.debug("Prediction event recorded", event);
    } catch (error) {
      this.logger.error("Failed to record prediction event", error as Error, {
        event,
      });
    }
  }
}
