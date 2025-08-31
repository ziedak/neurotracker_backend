import { Elysia, t } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { DeliveryService } from "./delivery.service";
import { InterventionTrigger } from "./types";

export const createDeliveryController = (
  deliveryService: DeliveryService,
  logger: ILogger,
  metrics: MetricsCollector
) => {
  return (
    new Elysia({ prefix: "/api/delivery" })

      // Trigger intervention endpoint
      .post(
        "/trigger",
        async ({ body, set }) => {
          try {
            const trigger = body as InterventionTrigger;

            logger.info("Intervention trigger received", {
              campaignId: trigger.campaignId,
              userId: trigger.userId,
              storeId: trigger.storeId,
              type: trigger.trigger.type,
            });

            const deliveries = await deliveryService.processIntervention(
              trigger
            );

            metrics.recordCounter("intervention.triggers.processed", 1, {
              campaignId: trigger.campaignId,
              type: trigger.trigger.type,
            });

            return {
              success: true,
              data: {
                interventionId: deliveries[0]?.interventionId,
                deliveries: deliveries.map((d) => ({
                  id: d.id,
                  channel: d.channel,
                  status: d.status,
                  deliveredAt: d.deliveredAt,
                })),
              },
            };
          } catch (error) {
            logger.error(
              "Failed to process intervention trigger",
              error as Error
            );
            metrics.recordCounter("intervention.triggers.failed");

            set.status = 500;
            return {
              success: false,
              error: "Failed to process intervention trigger",
              message: (error as Error).message,
            };
          }
        },
        {
          body: t.Object({
            campaignId: t.String(),
            userId: t.String(),
            storeId: t.String(),
            cartId: t.String(),
            trigger: t.Object({
              type: t.Union([
                t.Literal("cart_abandonment"),
                t.Literal("browse_abandonment"),
                t.Literal("price_drop"),
                t.Literal("stock_alert"),
              ]),
              data: t.Record(t.String(), t.Any()),
            }),
            channels: t.Array(
              t.Union([
                t.Literal("websocket"),
                t.Literal("email"),
                t.Literal("sms"),
                t.Literal("push"),
              ])
            ),
            priority: t.Optional(
              t.Union([
                t.Literal("high"),
                t.Literal("medium"),
                t.Literal("low"),
              ])
            ),
            delayMs: t.Optional(t.Number()),
            expiresAt: t.Optional(t.String()),
          }),
        }
      )

      // Get delivery status
      .get("/status/:deliveryId", async ({ params, set }) => {
        try {
          const { deliveryId } = params;
          const delivery = await deliveryService.getDeliveryStatus(deliveryId);
          if (!delivery) {
            set.status = 404;
            return {
              success: false,
              error: "Delivery not found",
            };
          }
          return {
            success: true,
            data: delivery,
          };
        } catch (error) {
          logger.error("Failed to get delivery status", error as Error);
          set.status = 500;
          return {
            success: false,
            error: "Failed to get delivery status",
          };
        }
      })

      // Get delivery statistics
      .get("/stats", async ({ query, set }) => {
        try {
          const { storeId, timeframe } = query;

          const stats = await deliveryService.getDeliveryStats(
            storeId as string,
            timeframe ? parseInt(timeframe as string) : undefined
          );

          return {
            success: true,
            data: stats,
          };
        } catch (error) {
          logger.error("Failed to get delivery stats", error as Error);

          set.status = 500;
          return {
            success: false,
            error: "Failed to get delivery stats",
          };
        }
      })

      // Process delayed interventions (internal endpoint)
      .post("/process-delayed", async ({ set }) => {
        try {
          const processed = await deliveryService.processDelayedInterventions();

          return {
            success: true,
            data: {
              processed,
              timestamp: new Date().toISOString(),
            },
          };
        } catch (error) {
          logger.error(
            "Failed to process delayed interventions",
            error as Error
          );

          set.status = 500;
          return {
            success: false,
            error: "Failed to process delayed interventions",
          };
        }
      })

      // Health check for delivery service
      .get("/health", async () => {
        try {
          // Real health check for Redis and WebSocketGateway
          const redisStatus =
            (await deliveryService.getFrequencyLimit().redis.ping()) === "PONG"
              ? "healthy"
              : "unhealthy";
          const wsStats = deliveryService.getWsGateway().getStats();
          const websocketStatus =
            wsStats.totalConnections >= 0 ? "healthy" : "unhealthy";
          return {
            status:
              redisStatus === "healthy" && websocketStatus === "healthy"
                ? "healthy"
                : "degraded",
            service: "delivery",
            timestamp: new Date().toISOString(),
            dependencies: {
              redis: redisStatus,
              websocket: websocketStatus,
              activeConnections: wsStats.totalConnections,
            },
          };
        } catch (error) {
          return {
            status: "unhealthy",
            service: "delivery",
            timestamp: new Date().toISOString(),
            error: (error as Error).message,
          };
        }
      })
  );
};
