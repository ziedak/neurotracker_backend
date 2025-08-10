// Entry point for Dashboard Service
import { createElysiaServer, DEFAULT_SERVER_CONFIG } from "@libs/elysia-server";
import { setupDashboardRoutes } from "./routes";

const server = createElysiaServer(
  {
    ...DEFAULT_SERVER_CONFIG,
    name: "dashboard-service",
    port: 4100,
    version: "1.0.0",
  },
  setupDashboardRoutes
);

server.start();
