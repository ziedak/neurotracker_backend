import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { Logger } from "@libs/monitoring";
import { ServiceRegistry } from "./service-registry";
import { APP_CONFIG } from "./config/app-config";

// Plugins and middleware
import { setupCorePlugins } from "./plugins/core-plugins";
import { setupErrorHandling } from "./middleware/error-middleware";
import { setupMiddleware } from "./middleware/request-middleware";

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

// Create and configure app
const app = new Elysia({ adapter: node() });

// Apply plugins and middleware
setupCorePlugins(app);
setupErrorHandling(app);
setupMiddleware(app);

// Apply routes
setupRootRoutes(app);
setupAuthRoutes(app);
setupApiRoutes(app, serviceRegistry);

// Start server
const server = app.listen(APP_CONFIG.port, () => {
  logger.info(`🚀 ${APP_CONFIG.name} running on port ${APP_CONFIG.port}`);
  logger.info(`📚 Swagger docs available at: http://localhost:${APP_CONFIG.port}${APP_CONFIG.swagger.path}`);
});

// Graceful shutdown
const shutdown = () => {
  logger.info("Shutting down gracefully");
  server.stop();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default app;
