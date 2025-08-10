// Data Intelligence Service API routes for ElysiaServerBuilder
// Data Intelligence Service API routes for ElysiaServerBuilder
import { FeatureStoreService } from "./featureStore";
import { RedisClient } from "../../../libs/database/src/redis";
import { ClickHouseClient } from "../../../libs/database/src/clickhouse";
import { PostgreSQLClient } from "../../../libs/database/src/postgresql";
import { RouteSetup } from "../../../libs/elysia-server/src/server";

const redis = new RedisClient();
const clickhouse = new ClickHouseClient();
const postgres = new PostgreSQLClient();
const featureStore = new FeatureStoreService(redis, clickhouse, postgres);

export const setupFeatureRoutes: RouteSetup = (app) => {
  // --- Reporting Endpoints ---
  // POST /v1/reports/generate
  app.post("/v1/reports/generate", async ({ body }) => {
    return await featureStore.generateReport(body);
  });

  // GET /v1/reports/:id
  app.get("/v1/reports/:id", async ({ params }) => {
    return await featureStore.getReport(params.id);
  });

  // --- Data Export Endpoints ---
  app.get("/v1/export/events", async () => {
    return await featureStore.exportEvents();
  });
  app.get("/v1/export/features", async () => {
    return await featureStore.exportFeatures();
  });
  app.get("/v1/export/predictions", async () => {
    return await featureStore.exportPredictions();
  });
  app.post("/v1/export/custom", async ({ body }) => {
    return await featureStore.exportCustom(body);
  });

  // --- Compliance & Data Quality Endpoints ---
  app.post("/v1/gdpr/forget/:userId", async ({ params }) => {
    return await featureStore.forgetUser(params.userId);
  });
  app.get("/v1/gdpr/export/:userId", async ({ params }) => {
    return await featureStore.exportUserData(params.userId);
  });
  app.get("/v1/gdpr/status/:requestId", async ({ params }) => {
    return await featureStore.getGdprStatus(params.requestId);
  });
  app.get("/v1/quality/status", async () => {
    return await featureStore.getQualityStatus();
  });
  app.get("/v1/quality/alerts", async () => {
    return await featureStore.getQualityAlerts();
  });
  app.post("/v1/quality/validate", async ({ body }) => {
    return await featureStore.validateQuality(body);
  });

  // --- Anomaly Detection Endpoint ---
  // POST /v1/quality/anomaly-detect
  app.post("/v1/quality/anomaly-detect", async ({ body }) => {
    // body: { type: "features" | "events", threshold?: number }
    return await featureStore.detectAnomalies(
      body as { type?: "features" | "events"; threshold?: number }
    );
  });
  // --- Analytics Endpoints ---
  // GET /v1/analytics/overview
  app.get("/v1/analytics/overview", async () => {
    // Example ClickHouse query for overview metrics
    // Replace with real queries as needed
    const metrics = await ClickHouseClient.execute(
      "SELECT count(*) as totalEvents, sum(revenue) as totalRevenue FROM events"
    );
    return metrics[0] || {};
  });

  // GET /v1/analytics/conversion
  app.get("/v1/analytics/conversion", async () => {
    // Example conversion funnel query
    const funnel = await ClickHouseClient.execute(
      `SELECT step, count(*) as users FROM conversion_funnel GROUP BY step`
    );
    return funnel;
  });

  // GET /v1/analytics/revenue
  app.get("/v1/analytics/revenue", async () => {
    // Example revenue attribution query
    const revenue = await ClickHouseClient.execute(
      `SELECT source, sum(revenue) as total FROM revenue_attribution GROUP BY source`
    );
    return revenue;
  });

  // GET /v1/analytics/performance
  app.get("/v1/analytics/performance", async () => {
    // Example model performance query
    const performance = await ClickHouseClient.execute(
      `SELECT model, avg(accuracy) as avgAccuracy FROM model_performance GROUP BY model`
    );
    return performance;
  });
  app.get("/v1/features/:cartId", async ({ params }) => {
    return await featureStore.getFeatures(params.cartId);
  });

  app.post("/v1/features/compute", async ({ body }) => {
    // Explicitly type body for feature computation
    return await featureStore.computeFeatures(
      body as { cartId: string; features: Record<string, any> }
    );
  });

  app.get("/v1/features/definitions", async () => {
    return await featureStore.getFeatureDefinitions();
  });

  app.post("/v1/features/batch-compute", async ({ body }) => {
    // Explicitly type body for batch computation (adjust as needed)
    return await featureStore.batchComputeFeatures(body as any);
  });

  return app;
};
