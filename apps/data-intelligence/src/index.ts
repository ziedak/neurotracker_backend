// Entry point for Data Intelligence Service
import { createElysiaServer, DEFAULT_SERVER_CONFIG } from "@libs/elysia-server";
import { setupRoutes } from "./routes/routes";
import { container } from "./container";

async function startServer() {
  try {
    // Initialize DI container
    await container.initialize();

    // Connect databases
    await container.connectDatabases();

    // Create server with ServiceRegistry-powered routes
    const server = createElysiaServer(
      {
        ...DEFAULT_SERVER_CONFIG,
        name: "data-intelligence-service",
        port: 4000,
        version: "1.0.0",
      },
      (app) => setupRoutes(app, container)
    );

    // Graceful shutdown handling
    process.on("SIGTERM", async () => {
      console.log("SIGTERM received, shutting down gracefully");
      await container.dispose();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("SIGINT received, shutting down gracefully");
      await container.dispose();
      process.exit(0);
    });

    server.start();
  } catch (error) {
    console.error("Failed to start Data Intelligence Service:", error);
    await container.dispose();
    process.exit(1);
  }
}

startServer();
