import {
  AdvancedElysiaServerBuilder,
  ServerConfig,
  type WebSocketMessage,
} from "@libs/elysia-server";
import { createLogger } from "@libs/utils";
import { MetricsCollector, IMetricsCollector } from "@libs/monitoring";

import { APP_CONFIG } from "./config/app-config";

// Routes
import { setupRootRoutes } from "./routes/root-routes";
import { setupAuthRoutes } from "./routes/auth-routes";
import { setupApiRoutes } from "./routes/api-routes";
import { EndpointRegistryService } from "./services/EndpointRegistryService";

// Logger and metrics
const logger = createLogger("api-gateway");
const metricsCollector: IMetricsCollector = MetricsCollector.create();

// Services setup
const endpointRegistryService = new EndpointRegistryService(logger);

// AuthenticationService is optional for now - if needed, it would require proper configuration
// including JWT secret, Keycloak settings, Redis, etc.
const authService = undefined; // TODO: Add proper auth configuration
if (!authService) {
  logger.info(
    "AuthenticationService not configured - auth routes will be disabled"
  );
}

// Register services
Object.entries(APP_CONFIG.services).forEach(([name, url]) => {
  endpointRegistryService.register(name.toLowerCase().replace(/_/g, "-"), url);
});

// Server configuration using new interfaces
const serverConfig: ServerConfig = {
  name: APP_CONFIG.name,
  port: APP_CONFIG.port,
  version: "2.0.0",
  description: "API Gateway for microservices",

  swagger: {
    enabled: true,
    path: APP_CONFIG.swagger.path,
    title: APP_CONFIG.name,
    version: "2.0.0",
    description: "API Gateway for microservices",
  },

  websocket: {
    enabled: true,
    path: "/ws",
    idleTimeout: 120,
    maxPayloadLength: 16 * 1024, // 16KB
    perMessageDeflate: false,
  },

  middleware: {
    enabled: true,

    cors: {
      name: "cors",
      enabled: true,
      priority: 90,
      allowedOrigins: APP_CONFIG.cors.origin,
      credentials: true,
      allowedMethods: APP_CONFIG.cors.methods,
      allowedHeaders: APP_CONFIG.cors.allowedHeaders,
    },

    rateLimit: {
      name: "rateLimit",
      enabled: true,
      priority: 80,
      algorithm: "sliding-window",
      maxRequests: APP_CONFIG.rateLimiting.requests,
      windowMs: APP_CONFIG.rateLimiting.windowMs,
      keyStrategy: "ip",
      standardHeaders: true,
    },

    security: {
      name: "security",
      enabled: true,
      priority: 85,
      frameOptions: "DENY",
      noSniff: true,
      xssFilter: true,
      contentSecurityPolicy: {
        enabled: false, // Disabled for API Gateway
      },
      hsts: {
        enabled: false, // Disabled for development
      },
    },

    auth: {
      name: "auth",
      enabled: true,
      priority: 70,
      requireAuth: false, // API Gateway handles auth per route
      allowAnonymous: true,
      bypassRoutes: ["/health", "/", "/swagger", "/docs"],
      apiKeyAuth: true,
      jwtAuth: true,
    },

    logging: {
      name: "logging",
      enabled: true,
      priority: 10,
      logLevel: "info",
      logRequestBody: false,
      logResponseBody: false,
      excludePaths: ["/health", "/favicon.ico"],
    },

    error: {
      name: "error",
      enabled: true,
      priority: 100,
      includeStackTrace: process.env["NODE_ENV"] !== "production",
      logErrors: true,
    },
  },
};

let wsServer: AdvancedElysiaServerBuilder | null = null;
let serverStarted = false;
let retryCount = 0;
const MAX_RETRIES = 3;
const HEARTBEAT_INTERVAL_MS = 30000;
const RETRY_BASE_DELAY_MS = 2000;

/**
 * Start the modernized API Gateway server using AdvancedElysiaServerBuilder
 */
async function startServer() {
  try {
    logger.info("Starting API Gateway with modern server builder...");

    // Create the server builder with our configuration
    const serverBuilder = new AdvancedElysiaServerBuilder(
      serverConfig,
      metricsCollector
    );

    // Build the server app and add our routes
    const app = serverBuilder.build();

    // Setup routes using organized route functions
    setupRootRoutes(app as any);
    setupAuthRoutes(app as any, logger, authService);
    setupApiRoutes(app as any, endpointRegistryService, logger);

    // Add WebSocket handling if enabled
    if (serverConfig.websocket?.enabled) {
      app.ws("/ws", {
        open: (ws) => {
          const connectionId = `conn_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

          // Store connection data using type assertion
          (ws.data as any).connectionId = connectionId;
          (ws.data as any).connectedAt = new Date();

          logger.info("WebSocket connection opened", { connectionId });
        },

        message: (ws, message: WebSocketMessage) => {
          const connectionId = (ws.data as any).connectionId || "unknown";

          logger.info("WebSocket message received", {
            connectionId,
            type: message.type,
          });

          switch (message.type) {
            case "subscribe_service_events":
              logger.info("Client subscribed to service events", {
                service: message.payload,
                connectionId,
              });
              break;

            case "get_service_status":
              ws.send({
                type: "service_status",
                payload: {
                  services: endpointRegistryService.getAllServices(),
                },
              });
              break;
          }
        },

        close: (ws, code, reason) => {
          const connectionId = (ws.data as any).connectionId || "unknown";
          logger.info("WebSocket connection closed", {
            connectionId,
            code,
            reason,
          });
        },
      });
    }

    // Start the server
    app.listen(serverConfig.port || 3000, () => {
      logger.info("API Gateway server started successfully", {
        port: serverConfig.port,
        name: serverConfig.name,
        version: serverConfig.version,
        swagger: serverConfig.swagger?.enabled
          ? serverConfig.swagger.path
          : "disabled",
        websocket: serverConfig.websocket?.enabled ? "enabled" : "disabled",
      });
    });

    wsServer = serverBuilder;
    serverStarted = true;

    // Setup heartbeat for WebSocket connections
    setInterval(() => {
      logger.debug("System heartbeat", {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
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

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down gracefully...");
  if (wsServer) {
    await wsServer.cleanup();
  }
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down gracefully...");
  if (wsServer) {
    await wsServer.cleanup();
  }
  process.exit(0);
});

// Start the server
if (!serverStarted) {
  startServer().catch((error) => {
    logger.error("Fatal error during server startup", error as Error);
    process.exit(1);
  });
}
