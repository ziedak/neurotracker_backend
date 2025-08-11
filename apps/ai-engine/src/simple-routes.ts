/**
 * Simplified AI Engine Routes
 * Optimized for performance and clarity
 */

import { Elysia } from "elysia";
import { Services } from "./simple-services";

export function createSimpleRoutes(app: Elysia): Elysia {
  const predictionService = Services.getPredictionService();
  const featureService = Services.getFeatureService();

  // Simple health check
  app.get("/health", () => ({
    status: "healthy",
    service: "ai-engine",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  }));

  // Simple prediction endpoint
  app.post("/predict", async ({ body }: { body: any }) => {
    try {
      const prediction = await predictionService.predict(body);
      return {
        success: true,
        data: prediction
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Prediction failed"
      };
    }
  });

  // Batch predictions
  app.post("/predict/batch", async ({ body }: { body: { requests: any[] } }) => {
    try {
      const predictions = await predictionService.batchPredict(body.requests);
      return {
        success: true,
        data: {
          predictions,
          total: body.requests.length,
          successful: predictions.length,
          failed: body.requests.length - predictions.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Batch prediction failed"
      };
    }
  });

  // Features endpoint
  app.post("/features", async ({ body }: { body: { cartId: string } }) => {
    try {
      const features = await featureService.getFeatures(body.cartId);
      return {
        success: true,
        data: features
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Feature computation failed"
      };
    }
  });

  // Service stats
  app.get("/stats", () => {
    const stats = predictionService.getStats();
    return {
      success: true,
      data: {
        predictions: stats,
        memory: process.memoryUsage(),
        uptime: process.uptime()
      }
    };
  });

  // Cache management
  app.delete("/cache", () => {
    predictionService.clearCache();
    return {
      success: true,
      message: "Cache cleared"
    };
  });

  return app;
}
