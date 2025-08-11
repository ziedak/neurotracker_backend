import { createElysiaServer, ServerConfig } from "@libs/elysia-server";
import { getEnv, getNumberEnv } from "@libs/config";
import { container } from "./container";
import { setupRoutes } from "./routes";

/**
 * AI Engine Service
 * High-performance ML prediction service using established architectural patterns
 */

const serverConfig: Partial<ServerConfig> = {
  name: "ai-engine",
  version: "1.0.0",
  port: getNumberEnv("AI_ENGINE_PORT", 3003), // Fixed port conflict
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

async function startServer() {
  try {
    console.log("🤖 Starting AI Engine Service...");

    // Initialize container and services
    await container.initialize();
    await container.validateServices();

    console.log("✅ Services initialized successfully");

    // Create Elysia server using the established pattern
    const server = createElysiaServer(serverConfig, setupRoutes);

    // Start the server
    const { app, server: httpServer } = server.start();

    console.log(`🚀 AI Engine Service running on port ${serverConfig.port}`);
    console.log(
      `📚 Swagger docs: http://localhost:${serverConfig.port}/swagger`
    );
    console.log(
      `🔍 Health check: http://localhost:${serverConfig.port}/health`
    );

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      console.log(`📡 Received ${signal}, shutting down gracefully...`);

      try {
        // Stop accepting new requests
        httpServer.stop();

        // Dispose of container and resources
        await container.dispose();

        console.log("✅ AI Engine Service shut down successfully");
        process.exit(0);
      } catch (error) {
        console.error("❌ Error during shutdown:", error);
        process.exit(1);
      }
    };

    // Handle various shutdown signals
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGUSR2", () => gracefulShutdown("SIGUSR2")); // For nodemon

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      console.error("❌ Uncaught Exception:", error);
      gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
      gracefulShutdown("unhandledRejection");
    });
  } catch (error) {
    console.error("❌ Failed to start AI Engine Service:", error);
    process.exit(1);
  }
}

// Start the server
startServer();

export default startServer;
