import { Elysia } from "@libs/elysia-server";
import { APP_CONFIG } from "../config/app-config";

export function setupRootRoutes(app: Elysia) {
  return app
    .get("/", async () => ({
      service: APP_CONFIG.name,
      version: APP_CONFIG.version,
      status: "running",
      documentation: APP_CONFIG.swagger.path,
      health: "/health",
      endpoints: {
        health: "/health",
        docs: APP_CONFIG.swagger.path,
        auth: "/auth/*",
        api: "/api/*",
      },
    }))

    .get("/health", async () => ({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: APP_CONFIG.version,
    }));
}
