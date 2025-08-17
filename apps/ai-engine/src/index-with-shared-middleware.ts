import { createElysiaServer, ServerConfig } from "@libs/elysia-server";
import { getEnv, getNumberEnv } from "@libs/config";
import { container } from "./container";
import { setupRoutesWithSharedMiddleware } from "./routes-with-shared-middleware";
import { Logger } from "@libs/monitoring";

/**
 * AI Engine Service with Shared Middleware
 * High-performance ML prediction service using unified middleware architecture
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
      "High-performance ML prediction service with unified middleware architecture",
  },
  // Disable built-in rate limiting - using shared middleware instead
  rateLimiting: {
    enabled: false,
  },
};

const logger = new Logger("AI Engine (Shared Middleware)");

/**
 * Initialize all services and dependencies
 */
async function initializeServices(): Promise<void> {
  logger.info("🤖 Starting AI Engine Service with Shared Middleware...");
  await container.initialize();
  await container.validateServices();
  logger.info("✅ Services initialized successfully");
  logger.info("🔧 Using shared middleware library for auth, rate limiting, and validation");
}

/**
 * Create and start the Elysia server with shared middleware
 */
function createServer(): { app: any; httpServer: any } {
  const server = createElysiaServer(serverConfig, setupRoutesWithSharedMiddleware);
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
    logger.info("✅ AI Engine Service (Shared Middleware) shut down successfully");
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
 * Start the AI Engine server with shared middleware
 */
async function startServerWithSharedMiddleware(): Promise<void> {
  try {
    await initializeServices();
    const { app, httpServer } = createServer();
    
    logger.info(`🚀 AI Engine Service (Shared Middleware) running on port ${serverConfig.port}`);
    logger.info(`📚 Swagger docs: http://localhost:${serverConfig.port}/swagger`);
    logger.info(`🔍 Health check: http://localhost:${serverConfig.port}/ai-health`);
    logger.info("🛡️  Authentication: API key + JWT with RBAC");
    logger.info("⏱️  Rate limiting: Redis-based with user strategy");
    logger.info("✅ Validation: Zod schemas with strict mode");
    
    registerShutdownHandlers(httpServer);
  } catch (error) {
    logger.error("❌ Failed to start AI Engine Service (Shared Middleware):", error as Error);
    process.exit(1);
  }
}

// Start the server with shared middleware
startServerWithSharedMiddleware();

export default startServerWithSharedMiddleware;