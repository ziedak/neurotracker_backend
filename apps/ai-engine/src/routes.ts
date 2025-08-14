import { Elysia } from "@libs/elysia-server";
import { container } from "./container";
import { PredictionService } from "./services/prediction.service";
import { ModelService } from "./services/model.service";
import { FeatureService } from "./services/feature.service";
import { CacheService } from "./services/cache.service";
import { AuthMiddleware } from "./middleware/auth.middleware";
import { ValidationMiddleware } from "./middleware/validation.middleware";
import { RateLimitMiddleware } from "./middleware/rateLimit.middleware";
import { AuditMiddleware } from "./middleware/audit.middleware";

// Cache service instances to reduce DI resolution overhead
class ServiceCache {
  private static _predictionService: PredictionService | null = null;
  private static _modelService: ModelService | null = null;
  private static _featureService: FeatureService | null = null;
  private static _cacheService: CacheService | null = null;
  private static _authMiddleware: AuthMiddleware | null = null;
  private static _validationMiddleware: ValidationMiddleware | null = null;
  private static _rateLimitMiddleware: RateLimitMiddleware | null = null;
  private static _auditMiddleware: AuditMiddleware | null = null;

  static get predictionService(): PredictionService {
    if (!this._predictionService) {
      this._predictionService =
        container.getService<PredictionService>("predictionService");
    }
    return this._predictionService;
  }

  static get modelService(): ModelService {
    if (!this._modelService) {
      this._modelService = container.getService<ModelService>("modelService");
    }
    return this._modelService;
  }

  static get featureService(): FeatureService {
    if (!this._featureService) {
      this._featureService =
        container.getService<FeatureService>("featureService");
    }
    return this._featureService;
  }

  static get cacheService(): CacheService {
    if (!this._cacheService) {
      this._cacheService = container.getService<CacheService>("cacheService");
    }
    return this._cacheService;
  }

  static get authMiddleware(): AuthMiddleware {
    if (!this._authMiddleware) {
      this._authMiddleware =
        container.getService<AuthMiddleware>("authMiddleware");
    }
    return this._authMiddleware;
  }

  static get validationMiddleware(): ValidationMiddleware {
    if (!this._validationMiddleware) {
      this._validationMiddleware = container.getService<ValidationMiddleware>(
        "validationMiddleware"
      );
    }
    return this._validationMiddleware;
  }

  static get rateLimitMiddleware(): RateLimitMiddleware {
    if (!this._rateLimitMiddleware) {
      this._rateLimitMiddleware = container.getService<RateLimitMiddleware>(
        "rateLimitMiddleware"
      );
    }
    return this._rateLimitMiddleware;
  }

  static get auditMiddleware(): AuditMiddleware {
    if (!this._auditMiddleware) {
      this._auditMiddleware =
        container.getService<AuditMiddleware>("auditMiddleware");
    }
    return this._auditMiddleware;
  }
}

/**
 * Setup AI Engine routes with complete API implementation
 */
export function setupRoutes(app: Elysia): Elysia {
  // Use cached service instances (resolved once, cached forever)
  const predictionService = ServiceCache.predictionService;
  const modelService = ServiceCache.modelService;
  const featureService = ServiceCache.featureService;
  const cacheService = ServiceCache.cacheService;

  // Use cached middleware instances
  const authMiddleware = ServiceCache.authMiddleware;
  const validationMiddleware = ServiceCache.validationMiddleware;
  const rateLimitMiddleware = ServiceCache.rateLimitMiddleware;
  const auditMiddleware = ServiceCache.auditMiddleware;

  // Health check (enhanced)
  app.get("/ai-health", async () => {
    try {
      const [modelHealth, featureHealth, cacheHealth] = await Promise.all([
        modelService.getHealthStatus(),
        featureService.getHealthStatus(),
        cacheService.getHealthStatus(),
      ]);

      return {
        status: "healthy",
        service: "ai-engine",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        services: {
          models: modelHealth,
          features: featureHealth,
          cache: cacheHealth,
        },
      };
    } catch (error) {
      return {
        status: "unhealthy",
        service: "ai-engine",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      };
    }
  });

  // Apply global middleware
  app.onBeforeHandle(async (context) => {
    await auditMiddleware.auditPreRequest(context);
    await authMiddleware.authenticate(context);
    await rateLimitMiddleware.checkRateLimit(context);
  });

  app.onAfterHandle(async (context) => {
    await auditMiddleware.auditPostRequest(context as any, context.response);
  });

  app.onError(async (context) => {
    await auditMiddleware.auditError(context as any, context.error);
  });

  // Prediction endpoints
  app.group("/predict", (group) => {
    // Single prediction
    group.post("/", async (context) => {
      await validationMiddleware.validatePredictRequest(context);
      const { validatedBody } = context as any;

      const prediction = await predictionService.predict(validatedBody);
      return {
        success: true,
        data: prediction,
        timestamp: new Date().toISOString(),
      };
    });

    // Batch predictions
    group.post("/batch", async (context) => {
      await validationMiddleware.validateBatchPredictRequest(context);
      const { validatedBody } = context as any;

      const predictions = await predictionService.batchPredict(
        validatedBody.requests
      );
      return {
        success: true,
        data: {
          predictions,
          summary: {
            total: predictions.length,
            successful: predictions.length,
            failed: 0,
            processingTime: Date.now(),
          },
        },
        timestamp: new Date().toISOString(),
      };
    });

    // Prediction explanation
    group.get("/explain/:cartId/:modelName", async (context) => {
      const { cartId, modelName } = context.params;

      const explanation = await predictionService.explainPrediction(
        cartId,
        modelName
      );
      return {
        success: true,
        data: explanation,
        timestamp: new Date().toISOString(),
      };
    });

    return group;
  });

  // Feature endpoints
  app.group("/features", (group) => {
    // Compute features
    group.post("/", async (context) => {
      await validationMiddleware.validateFeatureRequest(context);
      const { validatedBody } = context as any;

      const features = await featureService.getFeatures(validatedBody);
      return {
        success: true,
        data: features,
        timestamp: new Date().toISOString(),
      };
    });

    // Get feature definitions
    group.get("/definitions", async () => {
      const definitions = await featureService.getFeatureDefinitions();
      return {
        success: true,
        data: definitions,
        timestamp: new Date().toISOString(),
      };
    });

    return group;
  });

  // Model management endpoints
  app.group("/models", (group) => {
    // List models
    group.get("/", async (context) => {
      await validationMiddleware.validateQueryParams(context);

      const models = await modelService.listModels();
      return {
        success: true,
        data: { models },
        timestamp: new Date().toISOString(),
      };
    });

    // Get model metadata
    group.get("/:modelName", async (context) => {
      const { modelName } = context.params;

      const metadata = await modelService.getModelMetadata(modelName);
      return {
        success: true,
        data: metadata,
        timestamp: new Date().toISOString(),
      };
    });

    // Update model version
    group.post("/:modelName/version", async (context) => {
      await validationMiddleware.validateModelUpdateRequest(context);
      const { modelName } = context.params;
      const { validatedBody } = context as any;

      await modelService.updateModelVersion(modelName, validatedBody.version);
      return {
        success: true,
        message: `Model ${modelName} updated to version ${validatedBody.version}`,
        timestamp: new Date().toISOString(),
      };
    });

    // Get model performance
    group.get("/:modelName/performance", async (context) => {
      const { modelName } = context.params;

      const performance = await modelService.getModelPerformance(modelName);
      return {
        success: true,
        data: performance,
        timestamp: new Date().toISOString(),
      };
    });

    // Get A/B test status
    group.get("/:modelName/ab-test", async (context) => {
      const { modelName } = context.params;

      const abTestStatus = await modelService.getABTestStatus(modelName);
      return {
        success: true,
        data: abTestStatus,
        timestamp: new Date().toISOString(),
      };
    });

    return group;
  });

  // Cache management endpoints
  app.group("/cache", (group) => {
    // Get cache statistics
    group.get("/stats", async () => {
      const stats = await cacheService.getStats();
      return {
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
      };
    });

    // Invalidate cache
    group.delete("/", async (context) => {
      await validationMiddleware.validateCacheInvalidationRequest(context);
      const { validatedBody } = context as any;

      await predictionService.invalidatePrediction(
        validatedBody.cartId,
        validatedBody.modelName
      );

      return {
        success: true,
        message: "Cache invalidated successfully",
        timestamp: new Date().toISOString(),
      };
    });

    // Clear model cache
    group.delete("/models/:modelName?", async (context) => {
      const { modelName } = context.params;

      await modelService.clearModelCache(modelName);
      return {
        success: true,
        message: modelName
          ? `Model cache cleared for ${modelName}`
          : "All model cache cleared",
        timestamp: new Date().toISOString(),
      };
    });

    return group;
  });

  // Service statistics and monitoring
  app.group("/stats", (group) => {
    // General service statistics
    group.get("/", async () => {
      const [predictionStats, cacheStats] = await Promise.all([
        predictionService.getPerformanceStats(),
        cacheService.getStats(),
      ]);

      return {
        success: true,
        data: {
          predictions: predictionStats,
          cache: cacheStats,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      };
    });

    // Detailed performance metrics
    group.get("/performance", async () => {
      const performanceStats = predictionService.getPerformanceStats();
      return {
        success: true,
        data: performanceStats,
        timestamp: new Date().toISOString(),
      };
    });

    // Audit trail
    group.get("/audit", async (context) => {
      await validationMiddleware.validateQueryParams(context);
      const { validatedQuery } = context as any;

      const auditTrail = auditMiddleware.getAuditTrail(validatedQuery.limit);
      const auditStats = auditMiddleware.getAuditStatistics();

      return {
        success: true,
        data: {
          trail: auditTrail,
          statistics: auditStats,
        },
        timestamp: new Date().toISOString(),
      };
    });

    return group;
  });

  // Error handling for unmatched routes
  app.all("*", () => {
    return {
      success: false,
      error: "Route not found",
      message: "The requested endpoint does not exist",
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}

export default setupRoutes;
