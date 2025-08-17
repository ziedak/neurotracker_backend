import { ServerConfig, type Elysia } from "@libs/elysia-server";
import { Logger } from "@libs/monitoring";

import { APP_CONFIG } from "./config/app-config";

// Routes
import { setupRootRoutes } from "./routes/root-routes";
import { setupAuthRoutes } from "./routes/auth-routes";
import { setupApiRoutes } from "./routes/api-routes";
import { EndpointRegistryService } from "./services/EndpointRegistryService";

// DI Container Setup (Logger only)
const logger = new Logger("api-gateway");
const endpointRegistryService = new EndpointRegistryService(logger);

// Register services
Object.entries(APP_CONFIG.services).forEach(([name, url]) => {
  endpointRegistryService.register(name.toLowerCase().replace(/_/g, "-"), url);
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
    origin: APP_CONFIG.cors.origin,
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

let wsServer: ServerType | null = null;
let serverStarted = false;
let retryCount = 0;
const MAX_RETRIES = 3;
const HEARTBEAT_INTERVAL_MS = 30000;
const RETRY_BASE_DELAY_MS = 2000;

type ServerType = {
  broadcast: (msg: any) => void;
  getStats: () => { activeConnections: number };
};

/**
 * Modular WebSocket handler for API Gateway
 */
function createWebSocketHandler(
  builder: any,
  registry: EndpointRegistryService,
  logger: Logger
) {
  return {
    open: (ws: { data: { connectionId: string } }) => {
      logger.info("WebSocket connection opened", {
        connectionId: ws.data.connectionId,
      });
    },
    message: (ws: { data: { connectionId: string } }, message: any) => {
      logger.info("WebSocket message received", {
        connectionId: ws.data.connectionId,
        type: message.type,
      });
      switch (message.type) {
        case "subscribe_service_events":
          logger.info("Client subscribed to service events", {
            service: message.payload.service,
            connectionId: ws.data.connectionId,
          });
          break;
        case "get_service_status":
          builder.sendToConnection(ws.data.connectionId, {
            type: "service_status",
            payload: {
              services: registry.getAllServices(),
            },
          });
          break;
      }
    },
    close: (
      ws: { data: { connectionId: string } },
      code: number,
      reason: string
    ) => {
      logger.info("WebSocket connection closed", {
        connectionId: ws.data.connectionId,
        code,
        reason,
      });
    },
  };
}

/**
 * Start the API Gateway server with robust error handling and modular logic
 */
async function startServer() {
  try {
    const { ElysiaServerBuilder } = await import("@libs/elysia-server");
    const builder = new ElysiaServerBuilder(serverConfig);
    builder
      .addRoutes((app: Elysia) => {
        setupRootRoutes(app);
        setupAuthRoutes(app);
        setupApiRoutes(app, endpointRegistryService, logger);
        return app;
      })
      .addWebSocketHandler(
        createWebSocketHandler(builder, endpointRegistryService, logger)
      );
    builder.start();
    wsServer = builder as unknown as ServerType;
    serverStarted = true;
    logger.info("API Gateway server started successfully");

    // Example: Send notifications to connected clients
    setInterval(() => {
      wsServer?.broadcast({
        type: "system_heartbeat",
        payload: {
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          activeConnections: wsServer?.getStats().activeConnections ?? 0,
        },
      });
    }, HEARTBEAT_INTERVAL_MS);
  } catch (error) {
    logger.error("Failed to start API Gateway server", error as Error);
    if ((error as any)?.code === "EADDRINUSE") {
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        logger.warn(
          `Port ${serverConfig.port} in use, retrying (${retryCount}/${MAX_RETRIES})...`
        );
        setTimeout(startServer, RETRY_BASE_DELAY_MS * retryCount);
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
