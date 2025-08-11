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

/**
 * Setup AI Engine routes with complete API implementation
 */
export function setupRoutes(app: Elysia): Elysia {
  // Get services from container
  const predictionService =
    container.getService<PredictionService>("predictionService");
  const modelService = container.getService<ModelService>("modelService");
  const featureService = container.getService<FeatureService>("featureService");
  const cacheService = container.getService<CacheService>("cacheService");

  // Get middleware from container
  const authMiddleware = container.getService<AuthMiddleware>("authMiddleware");
  const validationMiddleware = container.getService<ValidationMiddleware>(
    "validationMiddleware"
  );
  const rateLimitMiddleware = container.getService<RateLimitMiddleware>(
    "rateLimitMiddleware"
  );
  const auditMiddleware =
    container.getService<AuditMiddleware>("auditMiddleware");

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

  app.onAfterHandle(async (context, response) => {
    await auditMiddleware.auditPostRequest(context, response);
  });

  app.onError(async (context, error) => {
    await auditMiddleware.auditError(context, error);
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
