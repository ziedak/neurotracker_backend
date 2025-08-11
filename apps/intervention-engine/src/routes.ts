import { Elysia } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { container } from "./container";
import { WebSocketGateway } from "./delivery/websocket.gateway";
import { createDeliveryController } from "./delivery/delivery.controller";
import { createTrackingController } from "./tracking/tracking.controller";
import { createAnalyticsController } from "./tracking/analytics.controller";
import { DeliveryService } from "./delivery/delivery.service";
import { TrackingService } from "./tracking/tracking.service";
import { AnalyticsService } from "./tracking/analytics.service";

/**
 * Create and configure all routes for the Intervention Engine service
 * Handles service initialization and dependency injection
 */
export const createRoutes = (app: Elysia): Elysia => {
  const logger = container.getService<Logger>("logger");
  const metrics = container.getService<MetricsCollector>("metricsCollector");

  // Get tracking services from container
  const trackingService =
    container.getService<TrackingService>("trackingService");
  const analyticsService =
    container.getService<AnalyticsService>("analyticsService");

  // Create WebSocket gateway
  const wsGateway = new WebSocketGateway(logger, metrics);

  // Create delivery service with all dependencies
  const deliveryService = new DeliveryService(logger, metrics, wsGateway);

  logger.info("Initializing Intervention Engine routes");

  return (
    app
      // Health check endpoint
      .get("/health", () => ({
        status: "healthy",
        service: "intervention-engine",
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      }))

      // Service status endpoint
      .get("/status", async () => {
        try {
          await container.validateServices();
          return {
            status: "operational",
            service: "intervention-engine",
            timestamp: new Date().toISOString(),
            services: {
              database: "healthy",
              redis: "healthy",
              tracking: "healthy",
            },
          };
        } catch (error) {
          logger.error("Service status check failed", error as Error);
          return {
            status: "degraded",
            service: "intervention-engine",
            timestamp: new Date().toISOString(),
            error: (error as Error).message,
          };
        }
      })

      // Delivery API routes
      .use(createDeliveryController(deliveryService, logger, metrics))

      // Tracking API routes
      .use(createTrackingController(trackingService, logger, metrics))

      // Analytics API routes
      .use(createAnalyticsController(analyticsService, logger, metrics))

      // Global error handler
      .onError(({ error, set }) => {
        logger.error(
          "Unhandled route error",
          error instanceof Error ? error : new Error(String(error))
        );

        set.status = 500;
        return {
          success: false,
          error: "Internal server error",
          timestamp: new Date().toISOString(),
        };
      })
  );
};
