import { createElysiaServer } from "@libs/elysia-server";
import { container } from "./container";

const PORT = parseInt(process.env.PORT || "3006");

// Initialize routes and WebSocket handlers
const setupRoutes = (app: any) => {
  // Health check endpoint
  app.get("/api/health", () => ({
    status: "healthy",
    service: "intervention-engine",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  }));

  // Test endpoint
  app.get("/api/test", () => ({
    message: "Intervention Engine is running",
    features: ["real-time delivery", "notifications", "tracking", "campaigns"],
  }));

  return app;
};

// WebSocket message handler for real-time interventions
const wsHandler = {
  open: (ws: any) => {
    console.log("🔌 Intervention client connected");
  },

  message: (ws: any, message: any) => {
    console.log("📨 Received intervention message:", message);

    // Handle intervention-specific messages
    switch (message.type) {
      case "trigger_intervention":
        // Handle intervention trigger logic
        console.log("🎯 Triggering intervention:", message.payload);
        break;

      case "update_campaign":
        // Handle campaign updates
        console.log("📊 Updating campaign:", message.payload);
        break;

      default:
        console.log("⚠️ Unknown message type:", message.type);
    }
  },

  close: (ws: any, code: number, reason: string) => {
    console.log(`🔌 Intervention client disconnected: ${code} ${reason}`);
  },
};

// Create and start server
const { app, server, wsServer } = createElysiaServer({
  name: "intervention-engine",
  version: "1.0.0",
  port: PORT,
  cors: {
    origin: "*",
    credentials: false,
  },
  websocket: {
    enabled: true,
    path: "/ws",
    idleTimeout: 120,
    maxPayloadLength: 64 * 1024,
  },
  swagger: {
    enabled: process.env.NODE_ENV !== "production",
    path: "/docs",
  },
})
  .addRoutes(setupRoutes)
  .addWebSocketHandler(wsHandler)
  .start();

console.log("🎯 Intervention Engine started successfully");
console.log(`📍 Server: http://localhost:${PORT}`);
console.log(`🔌 WebSocket: ws://localhost:${PORT}/ws`);
console.log(`📚 API Docs: http://localhost:${PORT}/docs`);

export { app, server, wsServer };
