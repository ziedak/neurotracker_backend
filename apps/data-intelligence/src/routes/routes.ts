import type { Elysia } from "@libs/elysia-server";
import { setupAnalyticsRoutes } from "./analytics.routes";
import { setupAuthRoutes } from "./auth.routes";
import { setupExportRoutes } from "./export.routes";
import { setupFeaturesRoutes } from "./features.routes";
import { setupHealthRoutes } from "./health.routes";
import { setupQualityRoutes } from "./quality.routes";
import { setupReconciliationRoutes } from "./reconciliation.routes";
import { setupStatusRoutes } from "./status.routes";
import type { DataIntelligenceContainer } from "../container";

export const setupRoutes = (
  app: Elysia,
  container: DataIntelligenceContainer
) => {
  setupAuthRoutes(app, container);
  setupAnalyticsRoutes(app, container);
  setupFeaturesRoutes(app, container);
  setupExportRoutes(app, container);
  setupQualityRoutes(app, container);
  setupReconciliationRoutes(app, container);
  setupHealthRoutes(app, container);
  setupStatusRoutes(app, container);
  return app;
};
