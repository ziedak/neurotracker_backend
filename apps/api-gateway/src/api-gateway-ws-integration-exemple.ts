// Example: Adding WebSocket support to API Gateway
import { createElysiaServer, ServerConfig } from "@libs/elysia-server";
import { WebSocketManager, WebSocketMessage } from "@libs/messaging";

// This is how you could integrate WebSocket into your API Gateway
export function createApiGatewayWithWebSocket(config: ServerConfig) {
  // Create the Elysia server
  const serverBuilder = createElysiaServer(config, (app) => {
    // Add your existing routes here
    return app;
  });

  // Start the server
  const { app, server } = serverBuilder.start();

  // Add WebSocket support to the existing HTTP server
  const wsManager = WebSocketManager.fromHttpServer(server, {
    path: "/ws",
    heartbeatInterval: 30000,
    maxConnections: 1000,
  });

  // Example: Relay events from microservices to connected clients
  async function relayEventToClients(event: any) {
    // Send to specific user if event has userId
    if (event.userId) {
      wsManager.sendToUser(event.userId, {
        type: "microservice_event",
        payload: event,
      });
    }

    // Broadcast system events to all clients
    if (event.type === "system_event") {
      wsManager.broadcast({
        type: "system_update",
        payload: event,
      });
    }
  }

  // Example: API endpoint to get WebSocket stats
  app.get("/api/websocket/stats", () => ({
    activeConnections: wsManager.getConnectionCount(),
    activeRooms: wsManager.getActiveRooms(),
  }));

  return { app, server, wsManager, relayEventToClients };
}

// Usage example:
/*
const { app, server, wsManager } = createApiGatewayWithWebSocket({
  name: "API Gateway",
  port: 3000,
  // ... other config
});

// Now clients can connect to: ws://localhost:3000/ws
*/
