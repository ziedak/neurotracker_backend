import { Elysia } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { container } from "./container";
import { createDeliveryController } from "./delivery/delivery.routes";
import { createTrackingController } from "./tracking/tracking.routes";
import { createAnalyticsController } from "./analytics/analytics.routes";
import { DeliveryService } from "./delivery/delivery.service";
import { TrackingService } from "./tracking/tracking.service";
import { AnalyticsService } from "./analytics/analytics.service";
import { WebSocketGateway } from "./delivery/websocket.gateway";
import type { JobType, JobOptions } from "./queue/types";

/**
 * Create and configure all routes for the Intervention Engine service
 * Handles service initialization and dependency injection
 */
export const createRoutes = (app: Elysia): Elysia => {
  // Cleanup API integration
  const cleanupService = container.getService<any>("queueCleanupService");

  // POST /queue/retention: set retention policy
  app.post("/queue/retention", async ({ body }) => {
    try {
      cleanupService.setRetentionPolicy(body);
      return { success: true };
    } catch (error) {
      logger.error("Failed to set retention policy", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // POST /queue/archive: archive jobs in a queue
  app.post("/queue/archive", async ({ body }) => {
    try {
      const { queueKey } = body;
      await cleanupService.archiveJobs(queueKey);
      return { success: true };
    } catch (error) {
      logger.error("Failed to archive jobs", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // GET /queue/metrics: export queue metrics
  app.get("/queue/metrics", async () => {
    try {
      const metrics = cleanupService.exportMetrics();
      return { success: true, metrics };
    } catch (error) {
      logger.error("Failed to export metrics", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });
  // Type for queue job creation request
  interface QueueJobRequest {
    type: JobType;
    payload: any;
    options?: JobOptions;
  }
  // Queue API integration
  const queueService = container.getService<any>("queueService");

  // POST /queue/job: add a job to the queue
  app.post("/queue/job", async ({ body }) => {
    try {
      const { type, payload, options } = body as QueueJobRequest;
      if (!type || !payload) {
        return {
          success: false,
          error: "Missing required fields: type, payload",
        };
      }
      const jobId = await queueService.addJob(type, payload, options);
      return { success: true, jobId };
    } catch (error) {
      logger.error("Failed to add job", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // GET /queue/job/:jobId: get job details
  app.get("/queue/job/:jobId", async ({ params }) => {
    try {
      const job = await queueService.getJob(params.jobId);
      if (!job) return { success: false, error: "Job not found" };
      return { success: true, job };
    } catch (error) {
      logger.error("Failed to get job", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // DELETE /queue/job/:jobId: remove job
  app.delete("/queue/job/:jobId", async ({ params }) => {
    try {
      const removed = await queueService.removeJob(params.jobId);
      return { success: removed };
    } catch (error) {
      logger.error("Failed to remove job", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // POST /queue/job/:jobId/retry: retry job
  app.post("/queue/job/:jobId/retry", async ({ params }) => {
    try {
      const retried = await queueService.retryJob(params.jobId);
      return { success: retried };
    } catch (error) {
      logger.error("Failed to retry job", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // GET /queue/stats: get queue stats
  app.get("/queue/stats", async () => {
    try {
      const stats = await queueService.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error("Failed to get queue stats", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // GET /queue/health: get health for all queues
  app.get("/queue/health", async () => {
    try {
      const health = await queueService.getQueueHealth();
      return { success: true, health };
    } catch (error) {
      logger.error("Failed to get queue health", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });
  // Personalization API endpoints
  const personalizationService = container.getService<any>(
    "personalizationService"
  );

  // POST /personalization: returns personalized content for a user/store/context
  app.post("/personalization", async ({ body }) => {
    try {
      const result = await personalizationService.personalizeContent(body);
      return { success: true, result };
    } catch (error) {
      logger.error("Failed to personalize content", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });

  // GET /recommendations: returns recommendations for a user/store/type/count
  app.get("/recommendations", async ({ query }) => {
    try {
      const { userId, storeId, type = "hybrid", count = 5 } = query;
      const result = await personalizationService.generateRecommendations(
        userId,
        storeId,
        type,
        Number(count)
      );
      return { success: true, recommendations: result };
    } catch (error) {
      logger.error("Failed to get recommendations", error as Error);
      return { success: false, error: (error as Error).message };
    }
  });
  const logger = container.getService<Logger>("logger");
  const metrics = container.getService<MetricsCollector>("metricsCollector");

  // Get tracking services from container
  const trackingService =
    container.getService<TrackingService>("trackingService");
  const analyticsService =
    container.getService<AnalyticsService>("analyticsService");

  // Create WebSocket gateway for intervention delivery
  const wsGateway = new WebSocketGateway(logger, metrics);
  const channelQueue =
    new (require("./delivery/channel-queue.service").ChannelQueueService)(
      logger,
      metrics
    );
  const frequencyLimit =
    new (require("./delivery/frequency-limit.service").FrequencyLimitService)(
      logger,
      metrics
    );
  const delayedDelivery =
    new (require("./delivery/delayed-delivery.service").DelayedDeliveryService)(
      logger,
      metrics
    );
  // Create delivery service with all dependencies
  const deliveryService = new DeliveryService(
    logger,
    metrics,
    wsGateway,
    channelQueue,
    frequencyLimit,
    delayedDelivery
  );

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
