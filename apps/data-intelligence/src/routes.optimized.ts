// Data Intelligence Service API routes with ServiceRegistry integration
import { FeatureStoreService } from "./services/featureStore.service";
import { DataExportService } from "./services/dataExport.service";
import { BusinessIntelligenceService } from "./services/businessIntelligence.service";
import { DataQualityService } from "./services/dataQuality.service";
import { ClickHouseClient } from "@libs/database";
import { DataIntelligenceContainer } from "./container";

// Updated route setup to accept DI container
export const setupFeatureRoutes = (
  app: any,
  container: DataIntelligenceContainer
) => {
  // Get services from the DI container
  const getFeatureStore = () =>
    container.getService<FeatureStoreService>("featureStoreService");
  const getDataExport = () =>
    container.getService<DataExportService>("dataExportService");
  const getBusinessIntelligence = () =>
    container.getService<BusinessIntelligenceService>(
      "businessIntelligenceService"
    );
  const getDataQuality = () =>
    container.getService<DataQualityService>("dataQualityService");

  // --- Reporting Endpoints ---
  app.post("/v1/reports/generate", async ({ body }: { body: any }) => {
    const biService = getBusinessIntelligence();
    return await biService.generateReport(body);
  });

  app.get("/v1/reports/:id", async ({ params }: { params: { id: string } }) => {
    const biService = getBusinessIntelligence();
    return await biService.getReport(params.id);
  });

  // --- Data Export Endpoints ---
  app.get("/v1/export/events", async ({ query }: { query?: any }) => {
    const exportService = getDataExport();
    return await exportService.exportEvents(query || {});
  });

  app.get("/v1/export/features", async ({ query }: { query?: any }) => {
    const featureStore = getFeatureStore();
    return await featureStore.exportFeatures(query || {});
  });

  app.get("/v1/export/predictions", async ({ query }: { query?: any }) => {
    const exportService = getDataExport();
    return await exportService.exportPredictions(query || {});
  });

  app.post("/v1/export/custom", async ({ body }: { body: any }) => {
    const exportService = getDataExport();
    return await exportService.exportCustom(body);
  });

  // --- Compliance & Data Quality Endpoints ---
  app.post(
    "/v1/gdpr/forget/:userId",
    async ({ params }: { params: { userId: string } }) => {
      const qualityService = getDataQuality();
      return await qualityService.forgetUser(params.userId);
    }
  );

  app.get(
    "/v1/gdpr/export/:userId",
    async ({ params }: { params: { userId: string } }) => {
      const qualityService = getDataQuality();
      return await qualityService.exportUserData(params.userId);
    }
  );

  app.get(
    "/v1/gdpr/status/:requestId",
    async ({ params }: { params: { requestId: string } }) => {
      const qualityService = getDataQuality();
      return await qualityService.getGdprStatus(params.requestId);
    }
  );

  app.get("/v1/quality/status", async () => {
    const qualityService = getDataQuality();
    return await qualityService.getQualityStatus();
  });

  app.get("/v1/quality/alerts", async () => {
    const qualityService = getDataQuality();
    return await qualityService.getQualityAlerts();
  });

  app.post("/v1/quality/validate", async ({ body }: { body: any }) => {
    const qualityService = getDataQuality();
    return await qualityService.validateQuality(body);
  });

  // --- Anomaly Detection Endpoint ---
  app.post("/v1/quality/anomaly-detect", async ({ body }: { body: any }) => {
    const qualityService = getDataQuality();
    return await qualityService.detectAnomalies(body || {});
  });

  // --- Analytics Endpoints ---
  app.get("/v1/analytics/overview", async ({ query }: { query?: any }) => {
    const biService = getBusinessIntelligence();
    return await biService.generateReport({
      type: "overview",
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
    });
  });

  app.get("/v1/analytics/conversion", async ({ query }: { query?: any }) => {
    const biService = getBusinessIntelligence();
    return await biService.generateReport({
      type: "conversion",
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
    });
  });

  app.get("/v1/analytics/revenue", async ({ query }: { query?: any }) => {
    const biService = getBusinessIntelligence();
    return await biService.generateReport({
      type: "revenue",
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
      aggregation: query?.aggregation,
    });
  });

  app.get("/v1/analytics/performance", async ({ query }: { query?: any }) => {
    const biService = getBusinessIntelligence();
    return await biService.generateReport({
      type: "performance",
      dateFrom: query?.dateFrom,
      dateTo: query?.dateTo,
    });
  });

  // --- Enhanced Feature Store Endpoints ---
  app.get(
    "/v1/features/:cartId",
    async ({ params, query }: { params: { cartId: string }; query?: any }) => {
      const featureStore = getFeatureStore();
      return await featureStore.getFeatures(params.cartId, query);
    }
  );

  app.post("/v1/features/compute", async ({ body }: { body: any }) => {
    const featureStore = getFeatureStore();
    return await featureStore.computeFeatures(body);
  });

  app.get("/v1/features/definitions", async ({ query }: { query?: any }) => {
    const featureStore = getFeatureStore();
    return await featureStore.getFeatureDefinitions(query?.version);
  });

  app.post("/v1/features/batch-compute", async ({ body }: { body: any }) => {
    const featureStore = getFeatureStore();
    return await featureStore.batchComputeFeatures(body);
  });

  return app;
};
