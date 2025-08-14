import { createElysiaServer, ServerConfig } from "@libs/elysia-server";
import { Logger } from "@libs/monitoring";
import { ServiceRegistry } from "./service-registry";
import { APP_CONFIG } from "./config/app-config";

// Routes
import { setupRootRoutes } from "./routes/root-routes";
import { setupAuthRoutes } from "./routes/auth-routes";
import { setupApiRoutes } from "./routes/api-routes";

// DI Container Setup (Logger only)
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
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3003",
    ],
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

let wsServer: any = null;
let serverStarted = false;
let retryCount = 0;
const MAX_RETRIES = 3;

async function startServer() {
  try {
    const builder = new (require("@libs/elysia-server").ElysiaServerBuilder)(
      serverConfig
    );
    builder
      .addRoutes((app: any) => {
        setupRootRoutes(app);
        setupAuthRoutes(app);
        setupApiRoutes(app, serviceRegistry);
        return app;
      })
      .addWebSocketHandler({
        open: (ws: any) => {
          logger.info("WebSocket connection opened", {
            connectionId: (ws.data as any).connectionId,
          });
        },
        message: (ws: any, message: any) => {
          logger.info("WebSocket message received", {
            connectionId: (ws.data as any).connectionId,
            type: message.type,
          });
          switch (message.type) {
            case "subscribe_service_events":
              logger.info("Client subscribed to service events", {
                service: message.payload.service,
                connectionId: (ws.data as any).connectionId,
              });
              break;
            case "get_service_status":
              builder.sendToConnection((ws.data as any).connectionId, {
                type: "service_status",
                payload: {
                  services: serviceRegistry.getAllServices(),
                },
              });
              break;
          }
        },
        close: (ws: any, code: any, reason: any) => {
          logger.info("WebSocket connection closed", {
            connectionId: (ws.data as any).connectionId,
            code,
            reason,
          });
        },
      });
    builder.start();
    wsServer = builder;
    serverStarted = true;
    logger.info("API Gateway server started successfully");

    // Example: Send notifications to connected clients
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
  } catch (error: any) {
    logger.error("Failed to start API Gateway server", error);
    if (error.code === "EADDRINUSE") {
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        logger.warn(
          `Port ${serverConfig.port} in use, retrying (${retryCount}/${MAX_RETRIES})...`
        );
        setTimeout(startServer, 2000 * retryCount);
      } else {
        logger.error(
          `Port ${serverConfig.port} is still in use after ${MAX_RETRIES} retries. Exiting.`
        );
        process.exit(1);
      }
    } else {
      logger.error("Unexpected error during server startup. Exiting.");
      process.exit(1);
    }
  }
}

if (!serverStarted) {
  startServer();
}
