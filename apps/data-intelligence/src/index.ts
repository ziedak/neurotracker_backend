// Entry point for Data Intelligence Service
import { createElysiaServer, DEFAULT_SERVER_CONFIG } from "@libs/elysia-server";
import { setupFeatureRoutes } from "./routes";

const server = createElysiaServer(
  {
    ...DEFAULT_SERVER_CONFIG,
    name: "data-intelligence-service",
    port: 4000,
    version: "1.0.0",
  },
  setupFeatureRoutes
);

server.start();
