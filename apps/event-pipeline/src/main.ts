import "reflect-metadata";
import { WebSocketGateway } from "./ingestion/websocket.gateway";
import { ValidationService } from "./ingestion/validation.service";
import { RoutingService } from "./processing/routing.service";
import { BatchController } from "./ingestion/batch.controller";
import { MetricsService } from "./monitoring/metrics.service";
import { AlertsService } from "./monitoring/alerts.service";
import { RedisClient, ClickHouseClient } from "@libs/database";
import { createLogger } from "@libs/utils";
import { createElysiaServer, t } from "@libs/elysia-server";
import { RegistryService } from "./schema/registry.service";
import { ValidatorService as SchemaValidatorService } from "./schema/validator.service";
import { MigrationService } from "./schema/migration.service";
import { RetryService } from "./deadletter/retry.service";
import { EventPipelineTsyringeContainer } from "./container";

// Initialize the tsyringe container
await EventPipelineTsyringeContainer.initialize();

// Get core services from tsyringe container
const logger = createLogger("event-pipeline-main");
const validationService =
  EventPipelineTsyringeContainer.getService(ValidationService);
const routingService =
  EventPipelineTsyringeContainer.getService(RoutingService);
const redisClient =
  EventPipelineTsyringeContainer.getServiceByToken<RedisClient>("RedisClient");
const clickHouseClient =
  EventPipelineTsyringeContainer.getServiceByToken<ClickHouseClient>(
    "ClickHouseClient"
  );

// Resolve services with dependencies from container (they have @inject decorators)
const wsGateway =
  EventPipelineTsyringeContainer.getServiceByToken<WebSocketGateway>(
    "WebSocketGateway"
  );
const batchController =
  EventPipelineTsyringeContainer.getServiceByToken<BatchController>(
    "BatchController"
  );
const metricsService =
  EventPipelineTsyringeContainer.getServiceByToken<MetricsService>(
    "MetricsService"
  );

// Initialize remaining services that don't use DI yet
const alertsService = new AlertsService();
const registryService = new RegistryService();
const schemaValidator = new SchemaValidatorService();
const migrationService = new MigrationService();
const retryService = new RetryService();

logger.info("TSyringe container initialized successfully", {
  validationService: !!validationService,
  routingService: !!routingService,
  redisClient: !!redisClient,
  clickHouseClient: !!clickHouseClient,
});

const serverBuilder = createElysiaServer(
  {
    name: "event-pipeline Service",
    port: 3001,
    version: "1.0.0",
    description: "Handles user event-pipeline and processing with TSyringe DI",
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
    },
  },
  (app: any) => {
    return (
      app
        .get("/events", () => ({
          service: "event-pipeline Service (TSyringe)",
          status: "ready",
          containerType: "tsyringe",
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
              const isDuplicate = await redisClient.safeGet(eventKey);
              if (isDuplicate) {
                logger.info("Duplicate event ignored", { eventKey });
                return { status: "duplicate", eventKey };
              }

              // Prepare event for ClickHouse (serialize metadata as JSON string)
              const clickhouseEvent = {
                ...event,
                metadata: JSON.stringify(event.metadata || {}),
              };

              // Store event in ClickHouse using the resolved instance
              await clickHouseClient.insert("raw_events", [clickhouseEvent]);

              // Cache event in Redis for deduplication
              await redisClient.safeSet(eventKey, JSON.stringify(event), 3600);

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
          const ingestionMetrics = await metricsService.getMetrics();
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
          const events =
            (await redisClient.safeGet("deadletter:events")) || "[]";
          return { events: JSON.parse(events) };
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

const { server } = serverBuilder.start();
server;
