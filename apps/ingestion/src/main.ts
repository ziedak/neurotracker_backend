import { createElysiaServer, t } from "@libs/elysia-server";

interface UserEvent {
  userId: string;
  eventType: string;
  timestamp: string;
  data?: any;
}

// Create server using the shared library
const { app, server } = createElysiaServer(
  {
    name: "Event Ingestion Service",
    port: 3001,
    version: "1.0.0",
    description: "Handles user event ingestion and processing",
    swagger: {
      enabled: true,
      title: "Event Ingestion API",
    },
    rateLimiting: {
      enabled: true,
      requests: 500, // 500 events per minute per IP
      windowMs: 60000,
    },
  },
  (app: any) => {
    return app
      .get("/events", () => {
        return {
          service: "Event Ingestion Service",
          status: "ready",
          endpoints: {
            "POST /events": "Ingest new events",
            "POST /events/batch": "Ingest batch of events",
            "GET /events": "Service info",
          },
        };
      })

      .post(
        "/events",
        ({ body }: any) => {
          const event = body as UserEvent;

          // Process event (stub implementation)
          console.log("Received event:", event);

          // TODO: Send to Kafka or store in database
          // await kafkaProducer.send({ topic: 'user-events', messages: [{ value: JSON.stringify(event) }] });

          return {
            status: "processed",
            eventId: `evt_${Date.now()}`,
            timestamp: new Date().toISOString(),
          };
        },
        {
          body: t.Object({
            userId: t.String(),
            eventType: t.String(),
            timestamp: t.String(),
            data: t.Optional(t.Any()),
          }),
        }
      )

      .post(
        "/events/batch",
        ({ body }: any) => {
          const events = body as UserEvent[];

          console.log(`Processing batch of ${events.length} events`);

          // Process batch (stub implementation)
          const processedEvents = events.map((event, index) => ({
            eventId: `evt_${Date.now()}_${index}`,
            status: "processed",
            originalEvent: event,
          }));

          return {
            status: "batch_processed",
            count: events.length,
            events: processedEvents,
            timestamp: new Date().toISOString(),
          };
        },
        {
          body: t.Array(
            t.Object({
              userId: t.String(),
              eventType: t.String(),
              timestamp: t.String(),
              data: t.Optional(t.Any()),
            })
          ),
        }
      );
  }
).start();
