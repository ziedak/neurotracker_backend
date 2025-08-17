import { Elysia } from "@libs/elysia-server";
import { container } from "./container";
import { PredictionService } from "./services/prediction.service";
import { ModelService } from "./services/model.service";
import { FeatureService } from "./services/feature.service";
import { CacheService } from "./services/cache.service";

// Import shared middleware instead of service-specific implementations
import { servicePresets } from "@libs/middleware";

// Cache service instances to reduce DI resolution overhead
class ServiceCache {
  private static _predictionService: PredictionService | null = null;
  private static _modelService: ModelService | null = null;
  private static _featureService: FeatureService | null = null;
  private static _cacheService: CacheService | null = null;

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
}

// Get complete shared middleware for AI Engine
const { auth, rateLimit, validation, logging, error, audit } = servicePresets.aiEngine({
  // Override defaults for AI Engine specific requirements
  auth: {
    requiredPermissions: ['predict', 'batch_predict'],
    apiKeys: new Set([
      'ai-engine-key-prod-2024',
      'ai-engine-key-dev-2024',
      'dashboard-service-key',
      'data-intelligence-key'
    ]),
    bypassRoutes: ['/ai-health', '/stats/performance'],
  },
  rateLimit: {
    maxRequests: 1000, // AI Engine specific limit
    windowMs: 60000,
    keyStrategy: 'user',
    skipFailedRequests: true, // Don't count failed predictions
  },
  validation: {
    engine: 'zod',
    strictMode: true,
    sanitizeInputs: true,
    maxRequestSize: 1024 * 1024, // 1MB for ML requests
  },
  logging: {
    logLevel: 'info',
    logRequestBody: false, // Privacy for ML data
    logResponseBody: false,
    excludePaths: ['/ai-health', '/stats/performance'],
  },
  error: {
    includeStackTrace: false,
    customErrorMessages: {
      ValidationError: 'Invalid prediction request',
      AuthenticationError: 'ML service authentication required',
      RateLimitError: 'Prediction rate limit exceeded',
    },
  },
  audit: {
    includeBody: true, // Important for ML audit trails
    includeResponse: true,
    storageStrategy: 'both',
    skipRoutes: ['/ai-health'], // Don't audit health checks
  }
});

/**
 * Setup AI Engine routes with shared middleware implementation
 */
export function setupRoutesWithSharedMiddleware(app: Elysia): Elysia {
  // Use cached service instances (resolved once, cached forever)
  const predictionService = ServiceCache.predictionService;
  const modelService = ServiceCache.modelService;
  const featureService = ServiceCache.featureService;
  const cacheService = ServiceCache.cacheService;

  // Apply complete shared middleware stack
  app
    .use(logging)       // Request/response logging with sanitization
    .use(error)         // Centralized error handling
    .use(auth)          // Authentication with RBAC
    .use(rateLimit)     // Rate limiting with Redis
    .use(validation)    // Request validation with Zod
    .use(audit);        // Comprehensive audit trail

  // Health check (enhanced) - bypassed by auth middleware
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

  // Prediction endpoints
  app.group("/predict", (group) => {
    // Single prediction - user context now available from auth middleware
    group.post("/", async (context: any) => {
      // Body is automatically validated by validation middleware
      const { body, user } = context;
      
      // Check specific permissions for prediction
      if (!user?.permissions?.includes('predict') && !user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Insufficient permissions for prediction access',
          required: ['predict'] 
        };
      }

      const prediction = await predictionService.predict(body);
      return {
        success: true,
        data: prediction,
        timestamp: new Date().toISOString(),
        requestedBy: user?.id,
      };
    });

    // Batch predictions
    group.post("/batch", async (context: any) => {
      const { body, user } = context;
      
      // Check batch prediction permissions
      if (!user?.permissions?.includes('batch_predict') && !user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Insufficient permissions for batch prediction',
          required: ['batch_predict'] 
        };
      }

      const predictions = await predictionService.batchPredict(body.requests);
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
        requestedBy: user?.id,
      };
    });

    // Prediction explanation
    group.get("/explain/:cartId/:modelName", async (context: any) => {
      const { cartId, modelName } = context.params;
      const { user } = context;

      // Check explain permissions
      if (!user?.permissions?.includes('explain') && !user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Insufficient permissions for prediction explanation',
          required: ['explain'] 
        };
      }

      const explanation = await predictionService.explainPrediction(
        cartId,
        modelName
      );
      return {
        success: true,
        data: explanation,
        timestamp: new Date().toISOString(),
        requestedBy: user?.id,
      };
    });

    return group;
  });

  // Feature endpoints
  app.group("/features", (group) => {
    // Compute features
    group.post("/", async (context: any) => {
      const { body, user } = context;

      const features = await featureService.getFeatures(body);
      return {
        success: true,
        data: features,
        timestamp: new Date().toISOString(),
        requestedBy: user?.id,
      };
    });

    // Get feature definitions
    group.get("/definitions", async (context: any) => {
      const { user } = context;

      const definitions = await featureService.getFeatureDefinitions();
      return {
        success: true,
        data: definitions,
        timestamp: new Date().toISOString(),
        requestedBy: user?.id,
      };
    });

    return group;
  });

  // Model management endpoints (admin only)
  app.group("/models", (group) => {
    // List models
    group.get("/", async (context: any) => {
      const { user } = context;
      
      // Check models permission
      if (!user?.permissions?.includes('models') && !user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Insufficient permissions for model access',
          required: ['models', 'admin'] 
        };
      }

      const models = await modelService.listModels();
      return {
        success: true,
        data: { models },
        timestamp: new Date().toISOString(),
        requestedBy: user?.id,
      };
    });

    // Get model metadata
    group.get("/:modelName", async (context: any) => {
      const { modelName } = context.params;
      const { user } = context;

      if (!user?.permissions?.includes('models') && !user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Insufficient permissions for model metadata',
          required: ['models', 'admin'] 
        };
      }

      const metadata = await modelService.getModelMetadata(modelName);
      return {
        success: true,
        data: metadata,
        timestamp: new Date().toISOString(),
        requestedBy: user?.id,
      };
    });

    // Update model version (admin only)
    group.post("/:modelName/version", async (context: any) => {
      const { modelName } = context.params;
      const { body, user } = context;

      // Require admin permission for model updates
      if (!user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Admin permission required for model updates',
          required: ['admin'] 
        };
      }

      await modelService.updateModelVersion(modelName, body.version);
      return {
        success: true,
        message: `Model ${modelName} updated to version ${body.version}`,
        timestamp: new Date().toISOString(),
        updatedBy: user?.id,
      };
    });

    // Get model performance
    group.get("/:modelName/performance", async (context: any) => {
      const { modelName } = context.params;
      const { user } = context;

      if (!user?.permissions?.includes('models') && !user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Insufficient permissions for model performance',
          required: ['models', 'admin'] 
        };
      }

      const performance = await modelService.getModelPerformance(modelName);
      return {
        success: true,
        data: performance,
        timestamp: new Date().toISOString(),
        requestedBy: user?.id,
      };
    });

    // Get A/B test status
    group.get("/:modelName/ab-test", async (context: any) => {
      const { modelName } = context.params;
      const { user } = context;

      if (!user?.permissions?.includes('models') && !user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Insufficient permissions for A/B test data',
          required: ['models', 'admin'] 
        };
      }

      const abTestStatus = await modelService.getABTestStatus(modelName);
      return {
        success: true,
        data: abTestStatus,
        timestamp: new Date().toISOString(),
        requestedBy: user?.id,
      };
    });

    return group;
  });

  // Cache management endpoints (admin only)
  app.group("/cache", (group) => {
    // Get cache statistics
    group.get("/stats", async (context: any) => {
      const { user } = context;
      
      if (!user?.permissions?.includes('cache_manage') && !user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Insufficient permissions for cache statistics',
          required: ['cache_manage', 'admin'] 
        };
      }

      const stats = await cacheService.getStats();
      return {
        success: true,
        data: stats,
        timestamp: new Date().toISOString(),
        requestedBy: user?.id,
      };
    });

    // Invalidate cache (admin only)
    group.delete("/", async (context: any) => {
      const { body, user } = context;

      if (!user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Admin permission required for cache invalidation',
          required: ['admin'] 
        };
      }

      await predictionService.invalidatePrediction(
        body.cartId,
        body.modelName
      );

      return {
        success: true,
        message: "Cache invalidated successfully",
        timestamp: new Date().toISOString(),
        invalidatedBy: user?.id,
      };
    });

    // Clear model cache (admin only)
    group.delete("/models/:modelName?", async (context: any) => {
      const { modelName } = context.params;
      const { user } = context;

      if (!user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Admin permission required for cache clearing',
          required: ['admin'] 
        };
      }

      await modelService.clearModelCache(modelName);
      return {
        success: true,
        message: modelName
          ? `Model cache cleared for ${modelName}`
          : "All model cache cleared",
        timestamp: new Date().toISOString(),
        clearedBy: user?.id,
      };
    });

    return group;
  });

  // Service statistics and monitoring
  app.group("/stats", (group) => {
    // General service statistics
    group.get("/", async (context: any) => {
      const { user } = context;
      
      if (!user?.permissions?.includes('metrics') && !user?.permissions?.includes('admin')) {
        return { 
          success: false, 
          error: 'Insufficient permissions for service statistics',
          required: ['metrics', 'admin'] 
        };
      }

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
        requestedBy: user?.id,
      };
    });

    // Detailed performance metrics (bypassed by auth middleware)
    group.get("/performance", async (context: any) => {
      const performanceStats = predictionService.getPerformanceStats();
      return {
        success: true,
        data: performanceStats,
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

export default setupRoutesWithSharedMiddleware;