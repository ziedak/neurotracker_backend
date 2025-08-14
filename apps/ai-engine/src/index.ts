import { createElysiaServer, ServerConfig } from "@libs/elysia-server";
import { getEnv, getNumberEnv } from "@libs/config";
import { container } from "./container";
import { setupRoutes } from "./routes";
import { Logger } from "@libs/monitoring";

/**
 * AI Engine Service
 * High-performance ML prediction service using established architectural patterns
 */

const serverConfig: Partial<ServerConfig> = {
  name: "ai-engine",
  version: "1.0.0",
  port: getNumberEnv("AI_ENGINE_PORT", 3003),
  cors: {
    origin: getEnv("CORS_ORIGIN", "*"),
    credentials: true,
  },
  swagger: {
    enabled: getEnv("NODE_ENV") !== "production",
    path: "/swagger",
    title: "AI Engine Service",
    version: "1.0.0",
    description:
      "High-performance ML prediction service for cart recovery and recommendation tasks",
  },
  rateLimiting: {
    enabled: true,
    requests: getNumberEnv("RATE_LIMIT_MAX", 1000),
    windowMs: getNumberEnv("RATE_LIMIT_WINDOW_MS", 60000),
  },
};

const logger = new Logger("AI Engine");

/**
 * Initialize all services and dependencies
 */
async function initializeServices(): Promise<void> {
  logger.info("🤖 Starting AI Engine Service...");
  await container.initialize();
  await container.validateServices();
  logger.info("✅ Services initialized successfully");
}

/**
 * Create and start the Elysia server
 */
function createServer(): { app: any; httpServer: any } {
  const server = createElysiaServer(serverConfig, setupRoutes);
  // server.start() returns { app, server, wsServer? }
  const started = server.start();
  return { app: started.app, httpServer: started.server };
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(
  signal: string,
  httpServer: any
): Promise<void> {
  logger.info(`📡 Received ${signal}, shutting down gracefully...`);
  try {
    httpServer.stop();
    await container.dispose();
    logger.info("✅ AI Engine Service shut down successfully");
    process.exit(0);
  } catch (error) {
    logger.error("❌ Error during shutdown:", error as Error);
    process.exit(1);
  }
}

/**
 * Register shutdown and error handlers
 */
function registerShutdownHandlers(httpServer: any): void {
  ["SIGTERM", "SIGINT", "SIGUSR2"].forEach((signal) => {
    process.on(signal, () => gracefulShutdown(signal, httpServer));
  });
  process.on("uncaughtException", (error) => {
    logger.error("❌ Uncaught Exception:", error as Error);
    gracefulShutdown("uncaughtException", httpServer);
  });
  process.on("unhandledRejection", (reason, promise) => {
    logger.error(`❌ Unhandled Rejection at: ${promise} reason: ${reason}`);
    gracefulShutdown("unhandledRejection", httpServer);
  });
}

/**
 * Start the AI Engine server
 * @example
 * import startServer from "./index";
 * startServer();
 */
async function startServer(): Promise<void> {
  try {
    await initializeServices();
    const { app, httpServer } = createServer();
    logger.info(`🚀 AI Engine Service running on port ${serverConfig.port}`);
    logger.info(
      `📚 Swagger docs: http://localhost:${serverConfig.port}/swagger`
    );
    logger.info(
      `🔍 Health check: http://localhost:${serverConfig.port}/health`
    );
    registerShutdownHandlers(httpServer);
  } catch (error) {
    logger.error("❌ Failed to start AI Engine Service:", error as Error);
    process.exit(1);
  }
}

// Start the server
startServer();

export default startServer;
