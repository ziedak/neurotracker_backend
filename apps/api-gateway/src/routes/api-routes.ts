import { Elysia } from "elysia";
import { Logger } from "@libs/monitoring";
import { AppError } from "@libs/utils";
import { proxyToService } from "../proxyToService";
import { handleError } from "../types";
import type { EndpointRegistryService } from "../services/EndpointRegistryService";

export function setupApiRoutes(
  app: Elysia,
  endpointRegistryService: EndpointRegistryService,
  logger: ILogger
): Elysia {
  return app
    .all("/api/events/*", async (context) => {
      try {
        const authHeader = context.request.headers.get("authorization") || "";
        const result = await proxyToService(
          "event-pipeline",
          context.request,
          endpointRegistryService,
          logger,
          { authHeader }
        );
        context.set.status = result.status;
        return result.data;
      } catch (error) {
        const err = handleError(error);
        logger.error("Events proxy error", err as Error);
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
          endpointRegistryService,
          logger,
          { authHeader }
        );
        context.set.status = result.status;
        return result.data;
      } catch (error) {
        const err = handleError(error);
        logger.error("AI proxy error", err as Error);
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
          endpointRegistryService,
          logger,
          { authHeader }
        );
        context.set.status = result.status;
        return result.data;
      } catch (error) {
        const err = handleError(error);
        logger.error("Interventions proxy error", err as Error);
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
          endpointRegistryService,
          logger,
          { authHeader }
        );
        context.set.status = result.status;
        return result.data;
      } catch (error) {
        const err = handleError(error);
        logger.error("Data proxy error", err as Error);
        if (error instanceof AppError) {
          context.set.status = error.statusCode;
          return { error: err.message };
        }
        context.set.status = 500;
        return { error: "Service unavailable" };
      }
    });
}
