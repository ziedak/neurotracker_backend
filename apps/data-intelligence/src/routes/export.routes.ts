import type { Elysia } from "@libs/elysia-server";
import type { DataIntelligenceContainer } from "../container";
import type { DataExportService } from "../services/dataExport.service";
import type { FeatureStoreService } from "../services/featureStore.service";
import type { AuthMiddleware } from "../middleware/auth.middleware";
import type { RateLimitMiddleware } from "../middleware/rateLimit.middleware";
import type { AuditMiddleware } from "../middleware/audit.middleware";
import type { ValidationMiddleware } from "../middleware/validation.middleware";
import type { ExportEventsQuery } from "../types/index";

/**
 * Data Export endpoints
 * Handles exporting events, features, predictions, and custom queries
 */
export const setupExportRoutes = (
  app: Elysia,
  container: DataIntelligenceContainer
) => {
  const getDataExport = () =>
    container.getService("dataExportService") as DataExportService;
  const getFeatureStore = () =>
    container.getService("featureStoreService") as FeatureStoreService;
  const authMiddleware = container.getService(
    "authMiddleware"
  ) as AuthMiddleware;
  const rateLimitMiddleware = container.getService(
    "rateLimitMiddleware"
  ) as RateLimitMiddleware;
  const auditMiddleware = container.getService(
    "auditMiddleware"
  ) as AuditMiddleware;
  const validationMiddleware = container.getService(
    "validationMiddleware"
  ) as ValidationMiddleware;

  app.group("/export", (group) => {
    group.get(
      "/events",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.exportLimit(),
        auditMiddleware.exportAudit(),
      ],
      async ({ query }: { query: ExportEventsQuery }) => {
        try {
          const exportService = getDataExport();
          return await exportService.exportEvents(query || {});
        } catch (error) {
          return {
            error: "Events export failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/features",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.exportLimit(),
        auditMiddleware.featureStoreAudit(),
      ],
      async ({ query }: { query: ExportEventsQuery }) => {
        try {
          const featureStore = getFeatureStore();
          return await featureStore.exportFeatures(query || {});
        } catch (error) {
          return {
            error: "Features export failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/predictions",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.exportLimit(),
        auditMiddleware.exportAudit(),
      ],
      async ({ query }: { query: ExportEventsQuery }) => {
        try {
          const exportService = getDataExport();
          return await exportService.exportPredictions(query || {});
        } catch (error) {
          return {
            error: "Predictions export failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.post(
      "/custom",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin"] }),
        rateLimitMiddleware.strictLimit(),
        auditMiddleware.exportAudit(),
        validationMiddleware.validate({
          body: [
            { field: "table", type: "string", required: true },
            { field: "query", type: "string", required: false },
            {
              field: "format",
              type: "string",
              required: false,
              enum: ["json", "csv", "parquet"],
            },
          ],
        }),
      ],
      async ({ body }: { body: { table: string; [key: string]: any } }) => {
        try {
          if (!body.table) {
            return {
              error: "Custom export failed",
              message: "Missing required field: table",
            };
          }
          const exportService = getDataExport();
          return await exportService.exportCustom(body);
        } catch (error) {
          return {
            error: "Custom export failed",
            message: (error as Error).message,
          };
        }
      }
    );

    group.get(
      "/status",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.exportLimit(),
        auditMiddleware.exportAudit(),
      ],
      async ({ query }: { query: { jobId: string } }) => {
        try {
          const exportService = getDataExport();
          return await exportService.getExportStatus(query.jobId);
        } catch (error) {
          return {
            error: "Export status retrieval failed",
            message: (error as Error).message,
          };
        }
      }
    );
    group.get(
      "/history",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.exportLimit(),
        auditMiddleware.exportAudit(),
      ],
      async ({
        query,
      }: {
        query: { userId?: string; limit?: number; offset?: number };
      }) => {
        try {
          const exportService = getDataExport();
          return await exportService.getExportHistory(query);
        } catch (error) {
          return {
            error: "Export history retrieval failed",
            message: (error as Error).message,
          };
        }
      }
    );
    group.post(
      "/cancel",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin"] }),
        rateLimitMiddleware.strictLimit(),
        auditMiddleware.exportAudit(),
        validationMiddleware.validate({
          body: [{ field: "jobId", type: "string", required: true }],
        }),
      ],
      async ({ body }: { body: { jobId: string } }) => {
        try {
          const exportService = getDataExport();
          return await exportService.cancelExport(body.jobId);
        } catch (error) {
          return {
            error: "Cancel export failed",
            message: (error as Error).message,
          };
        }
      }
    );
    return group;
  });

  return app;
};
