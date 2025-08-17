import type { Elysia } from "@libs/elysia-server";
import type { DataIntelligenceContainer } from "../container";
import type { BusinessIntelligenceService } from "../services/businessIntelligence.service";
import type { AuthMiddleware } from "../middleware/auth.middleware";
import type { RateLimitMiddleware } from "../middleware/rateLimit.middleware";
import type { AuditMiddleware } from "../middleware/audit.middleware";

// Analytics endpoints
export const setupAnalyticsRoutes = (
  app: Elysia,
  container: DataIntelligenceContainer
) => {
  const getBusinessIntelligence = () =>
    container.getService(
      "businessIntelligenceService"
    ) as BusinessIntelligenceService;
  const authMiddleware = container.getService(
    "authMiddleware"
  ) as AuthMiddleware;
  const rateLimitMiddleware = container.getService(
    "rateLimitMiddleware"
  ) as RateLimitMiddleware;
  const auditMiddleware = container.getService(
    "auditMiddleware"
  ) as AuditMiddleware;

  app.group("/analytics", (group) => {
    group.get(
      "/overview",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.analyticsLimit(),
        auditMiddleware.biAudit(),
      ],
      async ({ query }: { query: Record<string, any> }) => {
        const biService = getBusinessIntelligence();
        return await biService.generateReport({
          type: "overview",
          dateFrom: query?.dateFrom,
          dateTo: query?.dateTo,
        });
      }
    );

    group.get(
      "/conversion",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.analyticsLimit(),
        auditMiddleware.biAudit(),
      ],
      async ({ query }: { query: Record<string, any> }) => {
        const biService = getBusinessIntelligence();
        return await biService.generateReport({
          type: "conversion",
          dateFrom: query?.dateFrom,
          dateTo: query?.dateTo,
        });
      }
    );

    group.get(
      "/revenue",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.analyticsLimit(),
        auditMiddleware.biAudit(),
      ],
      async ({ query }: { query: Record<string, any> }) => {
        const biService = getBusinessIntelligence();
        return await biService.generateReport({
          type: "revenue",
          dateFrom: query?.dateFrom,
          dateTo: query?.dateTo,
          aggregation: query?.aggregation,
        });
      }
    );

    group.get(
      "/performance",
      [
        authMiddleware.authenticate({
          requiredRoles: ["admin", "analyst", "viewer"],
        }),
        rateLimitMiddleware.analyticsLimit(),
        auditMiddleware.biAudit(),
      ],
      async ({ query }: { query: Record<string, any> }) => {
        const biService = getBusinessIntelligence();
        return await biService.generateReport({
          type: "performance",
          dateFrom: query?.dateFrom,
          dateTo: query?.dateTo,
        });
      }
    );

    group.post(
      "/custom",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.analyticsLimit(),
        auditMiddleware.biAudit(),
      ],
      async ({ body }: { body: Record<string, any> }) => {
        const biService = getBusinessIntelligence();
        return await biService.generateCustomReport(
          body.table,
          body.aggregations,
          body.filters,
          body.options
        );
      }
    );

    group.get(
      "/export",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.exportLimit(),
        auditMiddleware.biAudit(),
      ],
      async ({ query }: { query: Record<string, any> }) => {
        const biService = getBusinessIntelligence();
        return await biService.getDashboardMetrics(
          query?.dateFrom,
          query?.dateTo
        );
      }
    );

    group.get(
      "/segment",
      [
        authMiddleware.authenticate({ requiredRoles: ["admin", "analyst"] }),
        rateLimitMiddleware.analyticsLimit(),
        auditMiddleware.biAudit(),
      ],
      async ({ query }: { query: Record<string, any> }) => {
        const biService = getBusinessIntelligence();
        return await biService.generateReport({
          type: "overview",
          dateFrom: query?.dateFrom,
          dateTo: query?.dateTo,
          filters: query?.filters,
          aggregation: query?.aggregation,
        });
      }
    );

    return app;
  });
};
