const services = {
  AI_ENGINE: process.env.AI_ENGINE_URL || "http://localhost:3002",
  DASHBOARD: process.env.DASHBOARD_URL || "http://localhost:3004",
  DATA_INTELLIGENCE:
    process.env.DATA_INTELLIGENCE_URL || "http://localhost:3004",
  EVENT_PIPELINE: process.env.EVENT_PIPELINE_URL || "http://localhost:3001",
  INTERVENTION_ENGINE:
    process.env.INTERVENTION_ENGINE_URL || "http://localhost:3003",
};

export const APP_CONFIG = {
  port: 3000,
  version: "2.0.0",
  name: "Cart Recovery API Gateway",

  services,
  cors: {
    origin: Object.values(services) || ["http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
  },

  swagger: {
    path: "/swagger",
    info: {
      title: "Cart Recovery API Gateway",
      version: "2.0.0",
      description: "Unified API for cart recovery platform",
    },
  },

  rateLimiting: {
    requests: 1000,
    windowMs: 60000,
    skipPaths: [
      "/swagger",
      "/swagger/",
      "/swagger/json",
      "/swagger/static",
      "/docs",
      "/documentation",
      "/health",
    ],
  },
};
