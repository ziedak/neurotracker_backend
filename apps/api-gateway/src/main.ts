import { createElysiaServer, ServerConfig } from "@libs/elysia-server";
import { Logger } from "@libs/monitoring";
import { ServiceRegistry } from "./service-registry";
import { APP_CONFIG } from "./config/app-config";

// Routes
import { setupRootRoutes } from "./routes/root-routes";
import { setupAuthRoutes } from "./routes/auth-routes";
import { setupApiRoutes } from "./routes/api-routes";

const logger = new Logger("api-gateway");
const serviceRegistry = new ServiceRegistry();

// Register services
Object.entries(APP_CONFIG.services).forEach(([name, url]) => {
  serviceRegistry.register(name.toLowerCase().replace("_", "-"), url);
});

// Server configuration
const serverConfig: ServerConfig = {
  name: APP_CONFIG.name,
  port: APP_CONFIG.port,
  version: "1.0.0",
  description: "API Gateway for microservices",
  swagger: {
    enabled: true,
    path: APP_CONFIG.swagger.path,
    title: APP_CONFIG.name,
    version: "1.0.0",
    description: "API Gateway for microservices",
  },
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  },
  rateLimiting: {
    enabled: true,
    requests: 100,
    windowMs: 60000,
  },
  websocket: {
    enabled: true,
    path: "/ws",
    idleTimeout: 120,
    maxPayloadLength: 16 * 1024, // 16KB
    perMessageDeflate: false,
  },
};

// Create server with shared library
const { app, server, wsServer } = createElysiaServer(serverConfig, (app) => {
  // Apply custom routes
  setupRootRoutes(app);
  setupAuthRoutes(app);
  setupApiRoutes(app, serviceRegistry);

  return app;
})
  .addWebSocketHandler({
    open: (ws) => {
      logger.info("WebSocket connection opened", {
        connectionId: (ws.data as any).connectionId,
      });
    },
    message: (ws, message) => {
      logger.info("WebSocket message received", {
        connectionId: (ws.data as any).connectionId,
        type: message.type,
      });

      // Handle API Gateway specific WebSocket messages
      switch (message.type) {
        case "subscribe_service_events":
          // Subscribe to specific microservice events
          logger.info("Client subscribed to service events", {
            service: message.payload.service,
            connectionId: (ws.data as any).connectionId,
          });
          break;
        case "get_service_status":
          // Send service registry status
          if (wsServer) {
            wsServer.sendToConnection((ws.data as any).connectionId, {
              type: "service_status",
              payload: {
                services: serviceRegistry.getAllServices(),
              },
            });
          }
          break;
      }
    },
    close: (ws, code, reason) => {
      logger.info("WebSocket connection closed", {
        connectionId: (ws.data as any).connectionId,
        code,
        reason,
      });
    },
  })
  .start();

// Example: Send notifications to connected clients
if (wsServer) {
  // Broadcast system status every 30 seconds
  setInterval(() => {
    wsServer.broadcast({
      type: "system_heartbeat",
      payload: {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        activeConnections: wsServer.getStats().activeConnections,
      },
    });
  }, 30000);
}

export default app;
