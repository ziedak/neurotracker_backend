import { createElysiaServer } from "@libs/elysia-server";
import { container } from "./container";
import { WebSocketGateway } from "./delivery/websocket.gateway";
import { DeliveryService } from "./delivery/delivery.service";
import { createDeliveryController } from "./delivery/delivery.routes";
import { Logger, MetricsCollector } from "@libs/monitoring";

const PORT = parseInt(process.env.PORT || "3006");

// Campaigns management with A/B testing
// Personalization engine with user segmentation
// Queue processing with Redis-based job handling
// WebSocket real-time delivery using proper Elysia patterns

// Initialize services
let wsGateway: WebSocketGateway;
let deliveryService: DeliveryService;
let logger: Logger;
let metrics: MetricsCollector;

// Initialize container and services
async function initializeServices() {
  try {
    // Initialize container first
    await container.initialize();

    // Get services from container
    logger = container.getService<Logger>("logger");
    metrics = container.getService<MetricsCollector>("metricsCollector");

    // Initialize WebSocket gateway
    wsGateway = new WebSocketGateway(logger, metrics);

    // Initialize delivery service
    deliveryService = new DeliveryService(logger, metrics, wsGateway);

    logger.info("Services initialized successfully");
  } catch (error) {
    console.error("Failed to initialize services:", error);
    process.exit(1);
  }
}

// Initialize routes and WebSocket handlers
const setupRoutes = (app: any) => {
  // Health check endpoint
  app.get("/api/health", () => ({
    status: "healthy",
    service: "intervention-engine",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  }));

  // Test endpoint
  app.get("/api/test", () => ({
    message: "Intervention Engine is running",
    features: ["real-time delivery", "notifications", "tracking", "campaigns"],
  }));

  // Add delivery controller routes
  if (deliveryService && logger && metrics) {
    const deliveryController = createDeliveryController(
      deliveryService,
      logger,
      metrics
    );
    app.use(deliveryController);
  }

  return app;
};

// WebSocket message handler for real-time interventions
const wsHandler = {
  open: (ws: any) => {
    if (wsGateway) {
      const connectionId = (ws.data as any).connectionId;
      wsGateway.handleConnection(ws, connectionId);
    }
  },

  message: (ws: any, message: any) => {
    if (wsGateway) {
      const connectionId = (ws.data as any).connectionId;
      wsGateway.handleMessage(connectionId, message);
    }
  },

  close: (ws: any, code: number, reason: string) => {
    if (wsGateway) {
      const connectionId = (ws.data as any).connectionId;
      wsGateway.handleDisconnection(connectionId, code, reason);
    }
  },
};

// Start the application
async function startServer() {
  await initializeServices();

  // Create and start server
  const { app, server, wsServer } = createElysiaServer({
    name: "intervention-engine",
    version: "1.0.0",
    port: PORT,
    cors: {
      origin: "*",
      credentials: false,
    },
    websocket: {
      enabled: true,
      path: "/ws",
      idleTimeout: 120,
      maxPayloadLength: 64 * 1024,
    },
    swagger: {
      enabled: process.env.NODE_ENV !== "production",
      path: "/docs",
    },
  })
    .addRoutes(setupRoutes)
    .addWebSocketHandler(wsHandler)
    .start();

  console.log("🎯 Intervention Engine started successfully");
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`📚 API Docs: http://localhost:${PORT}/docs`);

  // Start delayed intervention processor
  setInterval(async () => {
    if (deliveryService) {
      try {
        await deliveryService.processDelayedInterventions();
      } catch (error) {
        logger?.error(
          "Failed to process delayed interventions",
          error as Error
        );
      }
    }
  }, 30000); // Check every 30 seconds

  return { app, server, wsServer };
}

// Start the server
startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});

export { wsGateway, deliveryService };
