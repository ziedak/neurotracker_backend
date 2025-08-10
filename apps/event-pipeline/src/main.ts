import { WebSocketGateway } from "./ingestion/websocket.gateway";
import { ValidationService } from "./ingestion/validation.service";
import { RoutingService } from "./processing/routing.service";
import { BatchController } from "./ingestion/batch.controller";
import { MetricsService } from "./monitoring/metrics.service";
import { AlertsService } from "./monitoring/alerts.service";
import { RedisClient, ClickHouseClient } from "@libs/database";
import { Logger } from "@libs/monitoring";
import { createElysiaServer, t } from "@libs/elysia-server";
import { RegistryService } from "./schema/registry.service";
import { ValidatorService as SchemaValidatorService } from "./schema/validator.service";
import { MigrationService } from "./schema/migration.service";
import { DeadLetterHandler } from "./deadletter/handler.service";
import { RetryService } from "./deadletter/retry.service";
import { ServiceContainer } from "./container";

// Initialize the service container with all services
const container = ServiceContainer.getInstance();
container.initializeServices();

// Get core services from container
const logger = container.getService<Logger>("Logger");
const redis = container.getService<any>("RedisClient");
const clickhouse = container.getService<any>("ClickHouseClient");
const validationService =
  container.getService<ValidationService>("ValidationService");
const routingService = container.getService<RoutingService>("RoutingService");

// Initialize remaining services (will be added to container gradually)
const wsGateway = new WebSocketGateway();
const batchController = new BatchController();
const metricsService = new MetricsService();
const alertsService = new AlertsService();
const registryService = new RegistryService();
const schemaValidator = new SchemaValidatorService();
const migrationService = new MigrationService();
const deadLetterHandler = new DeadLetterHandler();
const retryService = new RetryService();

const serverBuilder = createElysiaServer(
  {
    name: "event-pipeline Service",
    port: 3001,
    version: "1.0.0",
    description: "Handles user event-pipeline and processing",
    swagger: {
      enabled: true,
      title: "event-pipeline API",
    },
    rateLimiting: {
      enabled: true,
      requests: 500,
      windowMs: 60000,
    },
    websocket: {
      enabled: true,
      path: "/events/stream",
      maxPayloadLength: 16 * 1024,
      idleTimeout: 120,
      // maxConnections: 50000,
    },
  },
  (app: any) => {
    return (
      app
        .get("/events", () => ({
          service: "event-pipeline Service",
          status: "ready",
          endpoints: {
            "POST /events": "Ingest new events",
            "POST /events/batch": "Ingest batch of events",
            "GET /events": "Service info",
          },
        }))

        .post(
          "/events",
          async ({ body }: any) => {
            try {
              const event = validationService.validate(body);

              // Deduplication
              const eventKey = `event:${event.userId}:${event.eventType}:${event.timestamp}`;
              const isDuplicate = await redis.exists(eventKey);
              if (isDuplicate) {
                logger.info("Duplicate event ignored", { eventKey });
                return { status: "duplicate", eventKey };
              }

              // Prepare event for ClickHouse (serialize metadata as JSON string)
              const clickhouseEvent = {
                ...event,
                metadata: JSON.stringify(event.metadata || {}),
              };

              // Store event in ClickHouse using static method
              await ClickHouseClient.insert("raw_events", [clickhouseEvent]);

              // Cache event in Redis for deduplication
              await redis.setex(eventKey, 3600, JSON.stringify(event));

              // Route event to downstream services
              await routingService.route(event);

              return { status: "accepted", eventKey };
            } catch (error: any) {
              logger.error("Event processing failed", error);
              return { status: "error", message: error.message };
            }
          },
          {
            body: t.Object({
              userId: t.String(),
              eventType: t.String(),
              timestamp: t.Number(),
              metadata: t.Optional(t.Any()),
            }),
          }
        )

        .post(
          "/events/batch",
          async ({ body }: any) => {
            try {
              const result = await batchController.processBatch(body);
              await metricsService.recordCounter("batch_processed");
              return result;
            } catch (error: any) {
              logger.error("Batch processing failed", error);
              await alertsService.alert("Batch processing error", {
                error: error.message,
              });
              return { status: "error", message: error.message };
            }
          },
          {
            body: t.Array(
              t.Object({
                userId: t.String(),
                eventType: t.String(),
                timestamp: t.Number(),
                metadata: t.Optional(t.Any()),
              })
            ),
          }
        )

        // Metrics endpoint
        .get("/metrics", async () => {
          const ingestionMetrics = await metricsService.getMetrics(
            "batch_processed"
          );
          return { metrics: ingestionMetrics };
        })

        // Alert endpoint (for manual testing)
        .post(
          "/alerts",
          async ({ body }: any) => {
            await alertsService.alert(body.message, body.meta);
            return { status: "alert_sent" };
          },
          {
            body: t.Object({
              message: t.String(),
              meta: t.Optional(t.Any()),
            }),
          }
        )

        // Schema registry endpoints
        .get("/schemas", () => registryService.listSchemas())
        .post(
          "/schemas",
          async ({ body }: any) => {
            registryService.registerSchema(body.version, body.schema);
            return { status: "registered", version: body.version };
          },
          {
            body: t.Object({
              version: t.String(),
              schema: t.Any(),
            }),
          }
        )
        .get("/schemas/:version", ({ params }: any) => {
          const schema = registryService.getSchema(params.version);
          return schema ? schema : { error: "Schema not found" };
        })
        .put(
          "/schemas/:version",
          async ({ params, body }: any) => {
            const oldSchema = registryService.getSchema(params.version);
            if (!oldSchema) return { error: "Old schema not found" };
            const migrated = migrationService.migrate(oldSchema, body);
            registryService.registerSchema(body.version, migrated);
            return { status: "migrated", version: body.version };
          },
          {
            body: t.Object({
              version: t.String(),
              schema: t.Any(),
            }),
          }
        )

        // Schema validation endpoint
        .post(
          "/schemas/:version/validate",
          async ({ params, body }: any) => {
            const schema = registryService.getSchema(params.version);
            if (!schema) return { error: "Schema not found" };
            const valid = schemaValidator.validate(body, schema.schema);
            return { valid };
          },
          {
            body: t.Any(),
          }
        )

        // Dead letter endpoints
        .get("/deadletter", async () => {
          const events = await redis.lrange("deadletter:events", 0, 99);
          return { events: events.map((e: string) => JSON.parse(e)) };
        })
        .post(
          "/deadletter/retry",
          async ({ body }: any) => {
            const result = await retryService.retry(body);
            return result;
          },
          {
            body: t.Any(),
          }
        )
    );
  }
)
  // Wire up WebSocket event gateway
  .addWebSocketHandler({
    open: (ws: any) => wsGateway.handleConnection(ws),
    message: (ws: any, message: any) =>
      wsGateway.handleEventMessage(ws, message),
    close: (ws: any, code: number, reason: string) =>
      wsGateway.handleDisconnection(ws, code, reason),
  });

const { app, server } = serverBuilder.start();
server;
