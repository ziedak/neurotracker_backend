import { Elysia, t } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { TrackingService } from "./tracking.service";

export const createTrackingController = (
  trackingService: TrackingService,
  logger: Logger,
  metrics: MetricsCollector
) => {
  return (
    new Elysia({ prefix: "/api/tracking" })

      // Track intervention event
      .post(
        "/event",
        async ({ body, set }: any) => {
          try {
            const eventData = body;

            logger.info("Tracking event received", {
              type: eventData.type,
              userId: eventData.userId,
              campaignId: eventData.campaignId,
              channel: eventData.channel,
            });

            const eventId = await trackingService.trackEvent(eventData);

            metrics.recordCounter("tracking.api.events", 1, {
              type: eventData.type,
              channel: eventData.channel,
            });

            return {
              success: true,
              data: {
                eventId,
                timestamp: new Date().toISOString(),
              },
            };
          } catch (error) {
            logger.error("Failed to track event", error as Error);
            metrics.recordCounter("tracking.api.events.failed");

            set.status = 500;
            return {
              success: false,
              error: "Failed to track event",
              message: (error as Error).message,
            };
          }
        },
        {
          body: t.Object({
            type: t.Union([
              t.Literal("intervention_triggered"),
              t.Literal("intervention_delivered"),
              t.Literal("intervention_opened"),
              t.Literal("intervention_clicked"),
              t.Literal("intervention_dismissed"),
              t.Literal("intervention_converted"),
              t.Literal("email_opened"),
              t.Literal("email_clicked"),
              t.Literal("sms_delivered"),
              t.Literal("push_opened"),
              t.Literal("cart_recovered"),
            ]),
            userId: t.String(),
            storeId: t.String(),
            sessionId: t.Optional(t.String()),
            interventionId: t.String(),
            campaignId: t.String(),
            deliveryId: t.Optional(t.String()),
            channel: t.Union([
              t.Literal("websocket"),
              t.Literal("email"),
              t.Literal("sms"),
              t.Literal("push"),
            ]),
            metadata: t.Optional(t.Record(t.String(), t.Any())),
          }),
        }
      )

      // Track conversion
      .post(
        "/conversion",
        async ({ body, set }: any) => {
          try {
            const conversionData = body;

            logger.info("Conversion event received", {
              userId: conversionData.userId,
              orderId: conversionData.orderId,
              value: conversionData.orderValue,
              campaignId: conversionData.campaignId,
            });

            const conversionId = await trackingService.trackConversion({
              ...conversionData,
              timestamp: new Date(),
            });

            metrics.recordCounter("tracking.api.conversions", 1, {
              campaignId: conversionData.campaignId,
              storeId: conversionData.storeId,
            });

            return {
              success: true,
              data: {
                conversionId,
                timestamp: new Date().toISOString(),
              },
            };
          } catch (error) {
            logger.error("Failed to track conversion", error as Error);
            metrics.recordCounter("tracking.api.conversions.failed");

            set.status = 500;
            return {
              success: false,
              error: "Failed to track conversion",
              message: (error as Error).message,
            };
          }
        },
        {
          body: t.Object({
            userId: t.String(),
            storeId: t.String(),
            interventionId: t.String(),
            campaignId: t.String(),
            orderId: t.String(),
            orderValue: t.Number(),
            currency: t.String(),
            metadata: t.Optional(t.Record(t.String(), t.Any())),
          }),
        }
      )

      // Get campaign metrics
      .get("/metrics/:campaignId", async ({ params, query, set }: any) => {
        try {
          const { campaignId } = params;
          const { storeId, startDate, endDate } = query;

          if (!storeId) {
            set.status = 400;
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const start = startDate
            ? new Date(startDate)
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
          const end = endDate ? new Date(endDate) : new Date();

          const metricsData = await trackingService.getCampaignMetrics(
            campaignId,
            storeId,
            start,
            end
          );

          return {
            success: true,
            data: metricsData,
          };
        } catch (error) {
          logger.error("Failed to get campaign metrics", error as Error);

          set.status = 500;
          return {
            success: false,
            error: "Failed to get campaign metrics",
            message: (error as Error).message,
          };
        }
      })

      // Get user journey
      .get("/journey/:userId", async ({ params, query, set }: any) => {
        try {
          const { userId } = params;
          const { storeId } = query;

          if (!storeId) {
            set.status = 400;
            return {
              success: false,
              error: "storeId is required",
            };
          }

          const journey = await trackingService.getUserJourney(userId, storeId);

          if (!journey) {
            set.status = 404;
            return {
              success: false,
              error: "User journey not found",
            };
          }

          return {
            success: true,
            data: journey,
          };
        } catch (error) {
          logger.error("Failed to get user journey", error as Error);

          set.status = 500;
          return {
            success: false,
            error: "Failed to get user journey",
            message: (error as Error).message,
          };
        }
      })

      // Pixel tracking endpoint for email/web tracking
      .get(
        "/pixel/:eventType/:interventionId",
        async ({ params, headers, set }: any) => {
          try {
            const { eventType, interventionId } = params;
            const userAgent = headers["user-agent"] || "";
            const referer = headers["referer"] || "";

            // Extract metadata from headers
            const metadata = {
              userAgent,
              referer,
              ipAddress:
                headers["x-forwarded-for"] || headers["x-real-ip"] || "unknown",
              timestamp: new Date().toISOString(),
            };

            // Track the pixel event (would need campaign/user context from intervention ID)
            logger.info("Pixel tracking event", {
              eventType,
              interventionId,
              userAgent: userAgent.substring(0, 50) + "...",
              referer,
            });

            metrics.recordCounter("tracking.pixel.events", 1, {
              type: eventType,
            });

            // Return 1x1 transparent pixel
            set.headers["Content-Type"] = "image/gif";
            set.headers["Cache-Control"] =
              "no-cache, no-store, must-revalidate";
            set.headers["Pragma"] = "no-cache";
            set.headers["Expires"] = "0";

            // 1x1 transparent GIF in base64
            const pixel = Buffer.from(
              "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
              "base64"
            );
            return new Response(pixel);
          } catch (error) {
            logger.error("Pixel tracking failed", error as Error);

            // Still return pixel even on error
            set.headers["Content-Type"] = "image/gif";
            const pixel = Buffer.from(
              "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
              "base64"
            );
            return new Response(pixel);
          }
        }
      )

      // Batch event tracking (for client-side queuing)
      .post(
        "/events/batch",
        async ({ body, set }: any) => {
          try {
            const { events } = body;

            if (!Array.isArray(events) || events.length === 0) {
              set.status = 400;
              return {
                success: false,
                error: "Events array is required",
              };
            }

            if (events.length > 100) {
              set.status = 400;
              return {
                success: false,
                error: "Maximum 100 events per batch",
              };
            }

            const results = [];
            let successCount = 0;
            let failureCount = 0;

            for (const eventData of events) {
              try {
                const eventId = await trackingService.trackEvent(eventData);
                results.push({ eventId, status: "success" });
                successCount++;
              } catch (error) {
                results.push({
                  status: "failed",
                  error: (error as Error).message,
                });
                failureCount++;
              }
            }

            logger.info("Batch tracking completed", {
              totalEvents: events.length,
              successful: successCount,
              failed: failureCount,
            });

            metrics.recordCounter("tracking.api.batch_events", events.length);
            metrics.recordCounter("tracking.api.batch_success", successCount);
            metrics.recordCounter("tracking.api.batch_failures", failureCount);

            return {
              success: true,
              data: {
                processed: events.length,
                successful: successCount,
                failed: failureCount,
                results,
              },
            };
          } catch (error) {
            logger.error("Batch tracking failed", error as Error);

            set.status = 500;
            return {
              success: false,
              error: "Batch tracking failed",
              message: (error as Error).message,
            };
          }
        },
        {
          body: t.Object({
            events: t.Array(
              t.Object({
                type: t.String(),
                userId: t.String(),
                storeId: t.String(),
                sessionId: t.Optional(t.String()),
                interventionId: t.String(),
                campaignId: t.String(),
                deliveryId: t.Optional(t.String()),
                channel: t.String(),
                metadata: t.Optional(t.Record(t.String(), t.Any())),
              })
            ),
          }),
        }
      )

      // Get tracking health status
      .get("/health", async () => {
        try {
          // Check Redis connectivity for tracking data
          // In production, would test actual Redis operations

          return {
            status: "healthy",
            service: "tracking",
            timestamp: new Date().toISOString(),
            dependencies: {
              redis: "healthy",
              metrics: "healthy",
            },
          };
        } catch (error) {
          return {
            status: "unhealthy",
            service: "tracking",
            timestamp: new Date().toISOString(),
            error: (error as Error).message,
          };
        }
      })
  );
};
