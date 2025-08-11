// Data Intelligence Service API routes with enterprise middleware and ServiceRegistry integration
import { FeatureStoreService } from "./services/featureStore.service";
import { DataExportService } from "./services/dataExport.service";
import { BusinessIntelligenceService } from "./services/businessIntelligence.service";
import { DataQualityService } from "./services/dataQuality.service";
import { DataReconciliationService } from "./services/dataReconciliation.service";
import { SecurityService } from "./services/security.service";
import { ClickHouseClient } from "@libs/database";
import { DataIntelligenceContainer } from "./container";

// Enterprise route setup with comprehensive middleware and DI container
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
  const getDataReconciliation = () =>
    container.getService<DataReconciliationService>(
      "dataReconciliationService"
    );
  const getSecurity = () =>
    container.getService<SecurityService>("securityService");

  // Get middleware from the DI container
  const authMiddleware = container.getService<any>("authMiddleware");
  const validationMiddleware = container.getService<any>(
    "validationMiddleware"
  );
  const rateLimitMiddleware = container.getService<any>("rateLimitMiddleware");
  const auditMiddleware = container.getService<any>("auditMiddleware");

  // Global middleware application
  app.use(auditMiddleware.auditRequests());
  app.use(rateLimitMiddleware.generalLimit());

  // --- Security & Authentication Endpoints ---
  app.post(
    "/v1/auth/login",
    validationMiddleware.validate({
      body: [
        { field: "email", type: "string", required: true },
        { field: "password", type: "string", required: true, minLength: 6 },
      ],
    }),
    async ({ body }: { body: any }) => {
      const securityService = getSecurity();
      return await securityService.authenticate({
        token: undefined,
        apiKey: undefined,
        endpoint: "/v1/auth/login",
        method: "POST",
        ...body,
      });
    }
  );

  // --- Reporting Endpoints ---
  app.post(
    "/v1/reports/generate",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.analyticsLimit(),
    auditMiddleware.biAudit(),
    validationMiddleware.validate({
      body: [
        {
          field: "type",
          type: "string",
          required: true,
          enum: ["overview", "conversion", "revenue", "performance"],
        },
        { field: "dateFrom", type: "string", required: false },
        { field: "dateTo", type: "string", required: false },
      ],
    }),
    async ({ body }: { body: any }) => {
      const biService = getBusinessIntelligence();
      return await biService.generateReport(body);
    }
  );

  app.get(
    "/v1/reports/:id",
    authMiddleware.authenticate({
      requiredRoles: ["admin", "analyst", "viewer"],
    }),
    rateLimitMiddleware.userLimit(),
    validationMiddleware.validate({
      params: [{ field: "id", type: "string", required: true }],
    }),
    async ({ params }: { params: { id: string } }) => {
      const biService = getBusinessIntelligence();
      return await biService.getReport(params.id);
    }
  );

  // --- Data Export Endpoints (Enhanced Security) ---
  app.get(
    "/v1/export/events",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.exportLimit(),
    auditMiddleware.exportAudit(),
    async ({ query }: { query?: any }) => {
      const exportService = getDataExport();
      return await exportService.exportEvents(query || {});
    }
  );

  app.get(
    "/v1/export/features",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.exportLimit(),
    auditMiddleware.featureStoreAudit(),
    async ({ query }: { query?: any }) => {
      const featureStore = getFeatureStore();
      return await featureStore.exportFeatures(query || {});
    }
  );

  app.get(
    "/v1/export/predictions",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.exportLimit(),
    auditMiddleware.exportAudit(),
    async ({ query }: { query?: any }) => {
      const exportService = getDataExport();
      return await exportService.exportPredictions(query || {});
    }
  );

  app.post(
    "/v1/export/custom",
    authMiddleware.authenticate({ requiredRoles: ["admin"] }),
    rateLimitMiddleware.strictLimit(),
    auditMiddleware.exportAudit(),
    validationMiddleware.validate({
      body: [
        { field: "query", type: "string", required: true },
        {
          field: "format",
          type: "string",
          required: false,
          enum: ["json", "csv", "parquet"],
        },
      ],
    }),
    async ({ body }: { body: any }) => {
      const exportService = getDataExport();
      return await exportService.exportCustom(body);
    }
  );

  // --- GDPR & Compliance Endpoints (Strict Security) ---
  app.post(
    "/v1/gdpr/forget/:userId",
    authMiddleware.authenticate({ requiredRoles: ["admin", "compliance"] }),
    rateLimitMiddleware.gdprLimit(),
    auditMiddleware.gdprAudit(),
    validationMiddleware.validate({
      params: [{ field: "userId", type: "string", required: true }],
    }),
    async ({ params }: { params: { userId: string } }) => {
      const qualityService = getDataQuality();
      return await qualityService.forgetUser(params.userId);
    }
  );

  app.get(
    "/v1/gdpr/export/:userId",
    authMiddleware.authenticate({ requiredRoles: ["admin", "compliance"] }),
    rateLimitMiddleware.gdprLimit(),
    auditMiddleware.gdprAudit(),
    validationMiddleware.validate({
      params: [{ field: "userId", type: "string", required: true }],
    }),
    async ({ params }: { params: { userId: string } }) => {
      const qualityService = getDataQuality();
      return await qualityService.exportUserData(params.userId);
    }
  );

  app.get(
    "/v1/gdpr/status/:requestId",
    authMiddleware.authenticate({ requiredRoles: ["admin", "compliance"] }),
    rateLimitMiddleware.userLimit(),
    validationMiddleware.validate({
      params: [{ field: "requestId", type: "string", required: true }],
    }),
    async ({ params }: { params: { requestId: string } }) => {
      const qualityService = getDataQuality();
      return await qualityService.getGdprStatus(params.requestId);
    }
  );

  // --- Data Quality Endpoints ---
  app.get(
    "/v1/quality/status",
    authMiddleware.authenticate({
      requiredRoles: ["admin", "analyst", "viewer"],
    }),
    rateLimitMiddleware.userLimit(),
    async () => {
      const qualityService = getDataQuality();
      return await qualityService.getQualityStatus();
    }
  );

  app.get(
    "/v1/quality/alerts",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.userLimit(),
    async () => {
      const qualityService = getDataQuality();
      return await qualityService.getQualityAlerts();
    }
  );

  app.post(
    "/v1/quality/validate",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.analyticsLimit(),
    validationMiddleware.validate({
      body: [
        { field: "dataset", type: "string", required: true },
        { field: "rules", type: "array", required: false },
      ],
    }),
    async ({ body }: { body: any }) => {
      const qualityService = getDataQuality();
      return await qualityService.validateQuality(body);
    }
  );

  app.post(
    "/v1/quality/anomaly-detect",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.analyticsLimit(),
    validationMiddleware.validate({
      body: [
        { field: "dataset", type: "string", required: false },
        { field: "timeRange", type: "object", required: false },
      ],
    }),
    async ({ body }: { body: any }) => {
      const qualityService = getDataQuality();
      return await qualityService.detectAnomalies(body || {});
    }
  );

  // --- Analytics Endpoints ---
  app.get(
    "/v1/analytics/overview",
    authMiddleware.authenticate({
      requiredRoles: ["admin", "analyst", "viewer"],
    }),
    rateLimitMiddleware.analyticsLimit(),
    auditMiddleware.biAudit(),
    async ({ query }: { query?: any }) => {
      const biService = getBusinessIntelligence();
      return await biService.generateReport({
        type: "overview",
        dateFrom: query?.dateFrom,
        dateTo: query?.dateTo,
      });
    }
  );

  app.get(
    "/v1/analytics/conversion",
    authMiddleware.authenticate({
      requiredRoles: ["admin", "analyst", "viewer"],
    }),
    rateLimitMiddleware.analyticsLimit(),
    auditMiddleware.biAudit(),
    async ({ query }: { query?: any }) => {
      const biService = getBusinessIntelligence();
      return await biService.generateReport({
        type: "conversion",
        dateFrom: query?.dateFrom,
        dateTo: query?.dateTo,
      });
    }
  );

  app.get(
    "/v1/analytics/revenue",
    authMiddleware.authenticate({
      requiredRoles: ["admin", "analyst", "viewer"],
    }),
    rateLimitMiddleware.analyticsLimit(),
    auditMiddleware.biAudit(),
    async ({ query }: { query?: any }) => {
      const biService = getBusinessIntelligence();
      return await biService.generateReport({
        type: "revenue",
        dateFrom: query?.dateFrom,
        dateTo: query?.dateTo,
        aggregation: query?.aggregation,
      });
    }
  );

  app.get(
    "/v1/analytics/performance",
    authMiddleware.authenticate({
      requiredRoles: ["admin", "analyst", "viewer"],
    }),
    rateLimitMiddleware.analyticsLimit(),
    auditMiddleware.biAudit(),
    async ({ query }: { query?: any }) => {
      const biService = getBusinessIntelligence();
      return await biService.generateReport({
        type: "performance",
        dateFrom: query?.dateFrom,
        dateTo: query?.dateTo,
      });
    }
  );

  // --- Enhanced Feature Store Endpoints ---
  app.get(
    "/v1/features/:cartId",
    authMiddleware.authenticate({
      requiredRoles: ["admin", "analyst", "viewer"],
    }),
    rateLimitMiddleware.userLimit(),
    auditMiddleware.featureStoreAudit(),
    validationMiddleware.validate({
      params: [{ field: "cartId", type: "string", required: true }],
    }),
    async ({ params, query }: { params: { cartId: string }; query?: any }) => {
      const featureStore = getFeatureStore();
      return await featureStore.getFeatures(params.cartId, query);
    }
  );

  app.post(
    "/v1/features/compute",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.analyticsLimit(),
    auditMiddleware.featureStoreAudit(),
    validationMiddleware.validate({
      body: [
        { field: "cartId", type: "string", required: true },
        { field: "features", type: "array", required: false },
      ],
    }),
    async ({ body }: { body: any }) => {
      const featureStore = getFeatureStore();
      return await featureStore.computeFeatures(body);
    }
  );

  app.get(
    "/v1/features/definitions",
    authMiddleware.authenticate({
      requiredRoles: ["admin", "analyst", "viewer"],
    }),
    rateLimitMiddleware.userLimit(),
    async ({ query }: { query?: any }) => {
      const featureStore = getFeatureStore();
      return await featureStore.getFeatureDefinitions(query?.version);
    }
  );

  app.post(
    "/v1/features/batch-compute",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.strictLimit(), // Intensive operation
    auditMiddleware.featureStoreAudit(),
    validationMiddleware.validate({
      body: [
        { field: "cartIds", type: "array", required: true },
        { field: "features", type: "array", required: false },
      ],
    }),
    async ({ body }: { body: any }) => {
      const featureStore = getFeatureStore();
      return await featureStore.batchComputeFeatures(body);
    }
  );

  // --- Data Reconciliation Endpoints (Admin Only) ---
  app.post(
    "/v1/reconciliation/rules",
    authMiddleware.authenticate({ requiredRoles: ["admin"] }),
    rateLimitMiddleware.strictLimit(),
    auditMiddleware.auditAction("create_reconciliation_rule", "reconciliation"),
    validationMiddleware.validate({
      body: [
        { field: "name", type: "string", required: true },
        { field: "sourceTable", type: "string", required: true },
        { field: "targetTable", type: "string", required: true },
      ],
    }),
    async ({ body }: { body: any }) => {
      const reconciliationService = getDataReconciliation();
      return await reconciliationService.createRule(body);
    }
  );

  app.post(
    "/v1/reconciliation/execute/:ruleId",
    authMiddleware.authenticate({ requiredRoles: ["admin"] }),
    rateLimitMiddleware.strictLimit(),
    auditMiddleware.auditAction("execute_reconciliation", "reconciliation"),
    validationMiddleware.validate({
      params: [{ field: "ruleId", type: "string", required: true }],
    }),
    async ({ params }: { params: { ruleId: string } }) => {
      const reconciliationService = getDataReconciliation();
      return await reconciliationService.executeReconciliation(params.ruleId);
    }
  );

  app.get(
    "/v1/reconciliation/status",
    authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
    rateLimitMiddleware.userLimit(),
    async () => {
      const reconciliationService = getDataReconciliation();
      return await reconciliationService.getStatus();
    }
  );

  app.post(
    "/v1/reconciliation/schedule",
    authMiddleware.authenticate({ requiredRoles: ["admin"] }),
    rateLimitMiddleware.strictLimit(),
    auditMiddleware.auditAction("schedule_reconciliation", "reconciliation"),
    async () => {
      const reconciliationService = getDataReconciliation();
      return await reconciliationService.scheduleReconciliation();
    }
  );

  // --- Health and Status Endpoints (Minimal Security) ---
  app.get("/health", async () => {
    return { status: "healthy", timestamp: new Date().toISOString() };
  });

  app.get(
    "/v1/status",
    authMiddleware.authenticate({
      requiredRoles: ["admin", "analyst", "viewer"],
    }),
    async () => {
      return {
        status: "operational",
        services: {
          featureStore: "healthy",
          dataExport: "healthy",
          businessIntelligence: "healthy",
          dataQuality: "healthy",
          dataReconciliation: "healthy",
          security: "healthy",
        },
        timestamp: new Date().toISOString(),
      };
    }
  );

  return app;
};
