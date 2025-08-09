import { Elysia } from "elysia";
import { Logger } from "@libs/monitoring";
import { AppError } from "@libs/utils";
import { ServiceRegistry, proxyToService } from "../service-registry";
import { handleError } from "../types";

const logger = new Logger("api-gateway");

export function setupApiRoutes(
  app: Elysia,
  serviceRegistry: ServiceRegistry
): any {
  return app
    .all("/api/events/*", async (context) => {
      try {
        const authHeader = context.request.headers.get("authorization") || "";
        const result = await proxyToService(
          "event-pipeline",
          context.request,
          serviceRegistry,
          authHeader
        );
        context.set.status = result.status;
        return result.data;
      } catch (error) {
        const err = handleError(error);
        logger.error("Events proxy error", err);
        if (error instanceof AppError) {
          context.set.status = error.statusCode;
          return { error: err.message };
        }
        context.set.status = 500;
        return { error: "Service unavailable" };
      }
    })

    .all("/api/ai/*", async (context) => {
      try {
        const authHeader = context.request.headers.get("authorization") || "";
        const result = await proxyToService(
          "ai-engine",
          context.request,
          serviceRegistry,
          authHeader
        );
        context.set.status = result.status;
        return result.data;
      } catch (error) {
        const err = handleError(error);
        logger.error("AI proxy error", err);
        if (error instanceof AppError) {
          context.set.status = error.statusCode;
          return { error: err.message };
        }
        context.set.status = 500;
        return { error: "Service unavailable" };
      }
    })

    .all("/api/interventions/*", async (context) => {
      try {
        const authHeader = context.request.headers.get("authorization") || "";
        const result = await proxyToService(
          "intervention-engine",
          context.request,
          serviceRegistry,
          authHeader
        );
        context.set.status = result.status;
        return result.data;
      } catch (error) {
        const err = handleError(error);
        logger.error("Interventions proxy error", err);
        if (error instanceof AppError) {
          context.set.status = error.statusCode;
          return { error: err.message };
        }
        context.set.status = 500;
        return { error: "Service unavailable" };
      }
    })

    .all("/api/data/*", async (context) => {
      try {
        const authHeader = context.request.headers.get("authorization") || "";
        const result = await proxyToService(
          "data-platform",
          context.request,
          serviceRegistry,
          authHeader
        );
        context.set.status = result.status;
        return result.data;
      } catch (error) {
        const err = handleError(error);
        logger.error("Data proxy error", err);
        if (error instanceof AppError) {
          context.set.status = error.statusCode;
          return { error: err.message };
        }
        context.set.status = 500;
        return { error: "Service unavailable" };
      }
    });
}
