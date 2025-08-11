/**
 * Enterprise Integration Test Suite
 * Tests all specialized services with DI container integration
 */

import { container } from "./container";
import { FeatureStoreService } from "./services/featureStore.service";
import { DataExportService } from "./services/dataExport.service";
import { BusinessIntelligenceService } from "./services/businessIntelligence.service";
import { DataQualityService } from "./services/dataQuality.service";

describe("Enterprise Service Integration", () => {
  beforeAll(async () => {
    await container.initialize();
    await container.connectDatabases();
  });

  afterAll(async () => {
    await container.dispose();
  });

  describe("FeatureStoreService", () => {
    let featureStore: FeatureStoreService;

    beforeEach(() => {
      featureStore = container.getService<FeatureStoreService>(
        "featureStoreService"
      );
    });

    it("should compute features with caching", async () => {
      const features = await featureStore.computeFeatures({
        cartId: "test-cart-123",
        features: { testFeature: 1.0 },
      });

      expect(features).toBeDefined();
      expect(features.success).toBe(true);
      expect(features.version).toBeDefined();
    });

    it("should handle batch processing", async () => {
      const batch = [
        { cartId: "cart-1", features: { feature1: 1.0 } },
        { cartId: "cart-2", features: { feature2: 2.0 } },
      ];

      const results = await featureStore.batchComputeFeatures(batch);
      expect(results).toHaveLength(2);
    });

    it("should export features with pagination", async () => {
      const exported = await featureStore.exportFeatures({
        limit: 100,
        format: "json",
      });

      expect(exported).toBeDefined();
      expect(exported.format).toBe("json");
    });
  });

  describe("DataExportService", () => {
    let exportService: DataExportService;

    beforeEach(() => {
      exportService =
        container.getService<DataExportService>("dataExportService");
    });

    it("should export events with filtering", async () => {
      const exported = await exportService.exportEvents({
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
        limit: 1000,
        format: "csv",
      });

      expect(exported).toBeDefined();
      expect(Array.isArray(exported)).toBe(true);
    });

    it("should export predictions", async () => {
      const predictions = await exportService.exportPredictions({
        limit: 500,
        format: "json",
      });

      expect(predictions).toBeDefined();
    });

    it("should handle custom exports", async () => {
      const customExport = await exportService.exportCustom({
        table: "custom_metrics",
        columns: ["id", "value", "timestamp"],
        filters: { status: "active" },
        options: { format: "json" },
      });

      expect(customExport).toBeDefined();
    });
  });

  describe("BusinessIntelligenceService", () => {
    let biService: BusinessIntelligenceService;

    beforeEach(() => {
      biService = container.getService<BusinessIntelligenceService>(
        "businessIntelligenceService"
      );
    });

    it("should generate overview reports", async () => {
      const report = await biService.generateReport({
        type: "overview",
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
      });

      expect(report).toBeDefined();
      expect(report.reportId).toBeDefined();
      expect(report.status).toBeDefined();
    });

    it("should generate conversion reports", async () => {
      const report = await biService.generateReport({
        type: "conversion",
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
      });

      expect(report.reportId).toBeDefined();
    });

    it("should cache and retrieve reports", async () => {
      const reportRequest = {
        type: "revenue" as const,
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
        aggregation: "monthly" as const,
      };

      const report1 = await biService.generateReport(reportRequest);
      const report2 = await biService.getReport(report1.reportId);

      expect(report1.reportId).toBeDefined();
      expect(report2).toBeDefined();
      if (report2) {
        expect(report1.reportId).toBe(report2.reportId);
      }
    });
  });

  describe("DataQualityService", () => {
    let qualityService: DataQualityService;

    beforeEach(() => {
      qualityService =
        container.getService<DataQualityService>("dataQualityService");
    });

    it("should validate data quality", async () => {
      const validation = await qualityService.validateQuality({
        table: "events",
        checks: ["completeness", "freshness", "consistency"],
      });

      expect(validation).toBeDefined();
      expect(validation.status).toBeDefined();
      expect(validation.results).toBeDefined();
    });

    it("should detect anomalies", async () => {
      const anomalies = await qualityService.detectAnomalies({
        type: "events",
        threshold: 2.0,
      });

      expect(anomalies).toBeDefined();
      expect(anomalies.anomalies).toBeInstanceOf(Array);
    });

    it("should handle GDPR forget requests", async () => {
      const result = await qualityService.forgetUser("test-user-123");

      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
      expect(result.userId).toBe("test-user-123");
    });

    it("should export user data for GDPR", async () => {
      const userData = await qualityService.exportUserData("test-user-456");

      expect(userData).toBeDefined();
      expect(userData.userId).toBe("test-user-456");
      expect(userData.data).toBeDefined();
    });

    it("should track GDPR request status", async () => {
      const forgetResult = await qualityService.forgetUser("test-user-789");

      if (forgetResult.requestId) {
        const status = await qualityService.getGdprStatus(
          forgetResult.requestId
        );

        expect(status).toBeDefined();
        expect(status.requestId).toBe(forgetResult.requestId);
        expect(status.status).toBeDefined();
      }
    });
  });

  describe("Service Integration", () => {
    it("should have all services registered in container", () => {
      const featureStore = container.getService("featureStoreService");
      const dataExport = container.getService("dataExportService");
      const businessIntelligence = container.getService(
        "businessIntelligenceService"
      );
      const dataQuality = container.getService("dataQualityService");

      expect(featureStore).toBeInstanceOf(FeatureStoreService);
      expect(dataExport).toBeInstanceOf(DataExportService);
      expect(businessIntelligence).toBeInstanceOf(BusinessIntelligenceService);
      expect(dataQuality).toBeInstanceOf(DataQualityService);
    });

    it("should share dependencies correctly", () => {
      const featureStore = container.getService<FeatureStoreService>(
        "featureStoreService"
      );
      const dataExport =
        container.getService<DataExportService>("dataExportService");

      // Both services should use the same Redis client instance
      expect(featureStore["redis"]).toBe(dataExport["redis"]);
    });
  });

  describe("Performance Monitoring", () => {
    it("should track metrics across all services", async () => {
      const metrics = container.getService<any>("metricsCollector");

      // Clear existing metrics
      metrics.clear();

      // Perform operations that should generate metrics
      const featureStore = container.getService<FeatureStoreService>(
        "featureStoreService"
      );
      await featureStore.computeFeatures({
        cartId: "metrics-test",
        features: { test: 1.0 },
      });

      const biService = container.getService<BusinessIntelligenceService>(
        "businessIntelligenceService"
      );
      await biService.generateReport({
        type: "overview",
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
      });

      // Verify metrics were recorded
      const allMetrics = metrics.getAllMetrics();
      expect(Object.keys(allMetrics).length).toBeGreaterThan(0);
    });
  });
});
