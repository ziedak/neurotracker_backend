import type { Elysia } from "@libs/elysia-server";
import type { DataIntelligenceContainer } from "../container";
import type { AuthMiddleware } from "../middleware/auth.middleware";

// Status endpoint
export const setupStatusRoutes = (
  app: Elysia,
  container: DataIntelligenceContainer
) => {
  const authMiddleware = container.getService(
    "authMiddleware"
  ) as AuthMiddleware;
  app.get(
    "/status",
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
