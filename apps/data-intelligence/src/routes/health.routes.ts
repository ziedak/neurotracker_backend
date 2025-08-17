import type { Elysia } from "@libs/elysia-server";
import type { DataIntelligenceContainer } from "../container";

/**
 * Health endpoints
 * Provides health status and detailed checks
 */
export const setupHealthRoutes = (
  app: Elysia,
  container: DataIntelligenceContainer
) => {
  app.group("/health", (group) => {
    group.get("/", [], async () => {
      try {
        const healthChecker = container.getService<any>("healthChecker");
        // Register basic checks if not already registered
        if (!healthChecker.getCheck("redis")) {
          healthChecker.registerCheck("redis", async () => {
            try {
              await container.getService<any>("redisClient").ping();
              return true;
            } catch {
              return false;
            }
          });
          healthChecker.registerCheck("postgres", async () => {
            try {
              await container.getService<any>("postgresClient").ping();
              return true;
            } catch {
              return false;
            }
          });
          healthChecker.registerCheck("clickhouse", async () => {
            try {
              await container.getService<any>("clickhouseClient").ping();
              return true;
            } catch {
              return false;
            }
          });
        }
        const results: Array<{ status: string }> =
          await healthChecker.runChecks();
        return {
          status: results.every(
            (r: { status: string }) => r.status === "healthy"
          )
            ? "healthy"
            : "degraded",
          checks: results,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        return {
          error: "Health check failed",
          message: (error as Error).message,
          timestamp: new Date().toISOString(),
        };
      }
    });
    return group;
  });
  return app;
};
