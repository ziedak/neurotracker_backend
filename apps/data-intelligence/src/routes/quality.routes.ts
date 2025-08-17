import type { Elysia } from "@libs/elysia-server";
import type { DataIntelligenceContainer } from "../container";
import type { DataQualityService } from "../services/dataQuality.service";
import type { AuthMiddleware } from "../middleware/auth.middleware";
import type { RateLimitMiddleware } from "../middleware/rateLimit.middleware";
import type { ValidationMiddleware } from "../middleware/validation.middleware";
import type { AuditMiddleware } from "../middleware/audit.middleware";

/**
 * Data Quality endpoints
 * Handles data quality status, alerts, validation, and anomaly detection
 */
export const setupQualityRoutes = (
  app: Elysia,
  container: DataIntelligenceContainer
) => {
  const getDataQuality = () =>
    container.getService("dataQualityService") as DataQualityService;
  const authMiddleware = container.getService(
    "authMiddleware"
  ) as AuthMiddleware;
  const rateLimitMiddleware = container.getService(
    "rateLimitMiddleware"
  ) as RateLimitMiddleware;
  const validationMiddleware = container.getService(
    "validationMiddleware"
  ) as ValidationMiddleware;
  const auditMiddleware = container.getService(
    "auditMiddleware"
  ) as AuditMiddleware;
  const dataQualityService = container.getService(
    "dataQualityService"
  ) as DataQualityService;

  app.group("/quality", (group) => {
    group.get(
      "/status",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.userLimit(),
      ],
      async () => {
        try {
          const qualityService = getDataQuality();
          return await qualityService.getQualityStatus();
        } catch (error) {
          return {
            error: "Quality status retrieval failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/alerts",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.userLimit(),
      ],
      async () => {
        try {
          const qualityService = getDataQuality();
          return await qualityService.getQualityAlerts();
        } catch (error) {
          return {
            error: "Quality alerts retrieval failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/validate",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.analyticsLimit(),
        validationMiddleware.validate({
          body: [
            { field: "table", type: "string", required: true },
            { field: "checks", type: "array", required: true },
            { field: "threshold", type: "number", required: false },
          ],
        }),
      ],
      async ({
        body,
      }: {
        body: { table: string; checks: string[]; threshold?: number };
      }) => {
        try {
          if (!body.table || !body.checks) {
            return {
              error: "Validation failed",
              message: "Missing required fields: table, checks",
            };
          }
          const qualityService = getDataQuality();
          return await qualityService.validateQuality(body);
        } catch (error) {
          return {
            error: "Quality validation failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/anomaly-detect",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.analyticsLimit(),
        validationMiddleware.validate({
          body: [
            { field: "type", type: "string", required: false },
            { field: "threshold", type: "number", required: false },
          ],
        }),
      ],
      async ({
        body,
      }: {
        body: { type?: "features" | "events"; threshold?: number };
      }) => {
        try {
          const qualityService = getDataQuality();
          return await qualityService.detectAnomalies(body || {});
        } catch (error) {
          return {
            error: "Anomaly detection failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/report",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.userLimit(),
        validationMiddleware.validate({
          query: [{ field: "format", type: "string", required: false }],
        }),
      ],
      async ({ query, set }: { query: { format?: string }; set: any }) => {
        auditMiddleware.auditAction("download_quality_report", "quality");
        try {
          const format = query.format || "json";
          const report = await dataQualityService.generateReport({ format });
          if (format === "csv") {
            set.headers["Content-Type"] = "text/csv";
            set.headers["Content-Disposition"] =
              "attachment; filename=quality_report.csv";
            return report;
          } else if (format === "pdf") {
            set.headers["Content-Type"] = "application/pdf";
            set.headers["Content-Disposition"] =
              "attachment; filename=quality_report.pdf";
            return report;
          } else {
            set.headers["Content-Type"] = "application/json";
            return report;
          }
        } catch (error) {
          set.status = 500;
          return {
            error: "Failed to generate quality report",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/trends",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.userLimit(),
        validationMiddleware.validate({
          query: [
            { field: "from", type: "string", required: false },
            { field: "to", type: "string", required: false },
          ],
        }),
      ],
      async ({
        query,
        set,
      }: {
        query: { from?: string; to?: string };
        set: any;
      }) => {
        auditMiddleware.auditAction("view_quality_trends", "quality");
        try {
          const { from, to } = query;
          const trends = await dataQualityService.getQualityTrends({
            from,
            to,
          });
          set.headers["Content-Type"] = "application/json";
          return trends;
        } catch (error) {
          set.status = 500;
          return {
            error: "Failed to fetch quality trends",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/aggregates",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.userLimit(),
        validationMiddleware.validate({
          query: [
            { field: "from", type: "string", required: false },
            { field: "to", type: "string", required: false },
          ],
        }),
      ],
      async ({
        query,
        set,
      }: {
        query: { from?: string; to?: string };
        set: any;
      }) => {
        auditMiddleware.auditAction("view_quality_aggregates", "quality");
        try {
          const { from, to } = query;
          const aggregates =
            await dataQualityService.getAggregatedQualityMetrics({ from, to });
          set.headers["Content-Type"] = "application/json";
          return aggregates;
        } catch (error) {
          set.status = 500;
          return {
            error: "Failed to fetch quality aggregates",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/anomalies",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.userLimit(),
        validationMiddleware.validate({
          query: [
            { field: "threshold", type: "number", required: false },
            { field: "from", type: "string", required: false },
            { field: "to", type: "string", required: false },
          ],
        }),
      ],
      async ({
        query,
        set,
      }: {
        query: { threshold?: number; from?: string; to?: string };
        set: any;
      }) => {
        auditMiddleware.auditAction("view_quality_anomalies", "quality");
        try {
          const { threshold, from, to } = query;
          const anomalies = await dataQualityService.detectOutliers({
            threshold,
            from,
            to,
          });
          set.headers["Content-Type"] = "application/json";
          return anomalies;
        } catch (error) {
          set.status = 500;
          return {
            error: "Failed to fetch quality anomalies",
            message: (error as Error).message,
          };
        }
      }
    );

    return group;
  });

  return app;
};
