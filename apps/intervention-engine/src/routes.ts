import { Elysia } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { container } from "./container";
import { createDeliveryController } from "./delivery/delivery.controller";
import { createTrackingController } from "./tracking/tracking.controller";
import { createAnalyticsController } from "./tracking/analytics.controller";
import { DeliveryService } from "./delivery/delivery.service";
import { TrackingService } from "./tracking/tracking.service";
import { AnalyticsService } from "./tracking/analytics.service";
import { WebSocketGateway } from "./delivery/websocket.gateway";

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

  // Create WebSocket gateway for intervention delivery
  const wsGateway = new WebSocketGateway(logger, metrics);

  // Create delivery service with WebSocket gateway
  const deliveryService = new DeliveryService(logger, metrics, wsGateway);

  // Real-time intervention tracking
  const interventionClients = new Set<any>();
  let metricsInterval: NodeJS.Timeout | null = null;

  function broadcastInterventionMetrics() {
    const stats = wsGateway.getStats();
    const payload = {
      type: "intervention_metrics",
      metrics: {
        activeConnections: stats.totalConnections,
        activeStores: stats.totalStores,
        queuedInterventions: Math.floor(Math.random() * 20), // would get from queue service
        deliveredToday: Math.floor(Math.random() * 100),
        conversionRate: (Math.random() * 10 + 5).toFixed(2) + "%",
        timestamp: new Date().toISOString(),
      },
    };

    for (const ws of interventionClients) {
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        // Ignore send errors
      }
    }
  }

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
              websocket: "healthy",
            },
            connections: {
              websocket: wsGateway.getStats().totalConnections,
              metrics: interventionClients.size,
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

      // WebSocket for intervention delivery
      .ws("/ws/interventions", {
        open: (ws) => {
          const connectionId = `conn_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
          wsGateway.handleConnection(ws as any, connectionId);

          logger.info("Intervention WebSocket connected", { connectionId });
        },
        message: (ws, msg) => {
          // Echo client messages for debugging (similar to dashboard pattern)
          try {
            ws.send(
              JSON.stringify({
                type: "echo",
                received: msg,
                timestamp: new Date().toISOString(),
              })
            );
          } catch (error) {
            logger.error("Failed to echo WebSocket message", error as Error);
          }
        },
        close: (ws, code, reason) => {
          const connectionId = `conn_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`; // In real implementation, track connection IDs
          wsGateway.handleDisconnection(connectionId, code, reason);
          logger.info("Intervention WebSocket disconnected", { code, reason });
        },
      })

      // WebSocket for real-time metrics (dashboard)
      .ws("/ws/metrics", {
        open: (ws) => {
          interventionClients.add(ws);
          ws.send(
            JSON.stringify({
              type: "connection",
              message: "Connected to intervention metrics stream",
              timestamp: new Date().toISOString(),
            })
          );

          // Start metrics broadcast if first client
          if (interventionClients.size === 1) {
            metricsInterval = setInterval(broadcastInterventionMetrics, 2000);
          }
        },
        message: (ws, msg) => {
          // Echo client messages for debugging
          ws.send(
            JSON.stringify({
              type: "echo",
              received: msg,
              timestamp: new Date().toISOString(),
            })
          );
        },
        close: (ws) => {
          interventionClients.delete(ws);

          // Stop metrics broadcast if no clients
          if (interventionClients.size === 0 && metricsInterval) {
            clearInterval(metricsInterval);
            metricsInterval = null;
          }
        },
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
