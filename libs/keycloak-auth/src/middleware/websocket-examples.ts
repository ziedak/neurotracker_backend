/**
 * Simple WebSocket Authentication Examples
 * Demonstrates basic usage of Keycloak WebSocket authentication
 */

import { Elysia } from "elysia";
import type { IMetricsCollector } from "@libs/monitoring";
import {
  keycloakWebSocket,
  createKeycloakWebSocketAuthPresets,
  getWebSocketAuthContext,
  isWebSocketAuthenticated,
  sendAuthenticatedMessage,
  webSocketHasPermission,
} from "./keycloak-websocket.plugin";
import type {
  IKeycloakClientFactory,
  ITokenIntrospectionService,
} from "../types";

/**
 * Basic WebSocket Authentication Example
 *
 * Demonstrates connection-time authentication with JWT tokens
 * Usage: Connect with Authorization header or token query parameter
 */
export function createBasicWebSocketExample(
  metrics: IMetricsCollector,
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService
) {
  return new Elysia()
    .use(
      keycloakWebSocket(
        metrics,
        keycloakClientFactory,
        tokenIntrospectionService,
        {
          pluginName: "basic-websocket-auth",
          wsPath: "/ws/basic",
          httpConfig: {
            name: "basic-websocket",
            keycloakClient: "frontend",
            requireAuth: true,
          },
          websocket: {
            allowAnonymous: false,
            heartbeatInterval: 30,
          },
          hooks: {
            onConnect: async (connectionInfo) => {
              console.log(
                `✅ WebSocket authenticated connection: ${connectionInfo.connectionId}`
              );
              console.log(
                `   User: ${connectionInfo.authContext?.userId || "unknown"}`
              );
              console.log(
                `   Client: ${
                  connectionInfo.authContext?.clientId || "unknown"
                }`
              );
            },
            onDisconnect: async (connectionInfo) => {
              console.log(
                `❌ WebSocket disconnected: ${connectionInfo.connectionId}`
              );
            },
            onAuthenticationFailed: async (_, error) => {
              console.log(`🚫 WebSocket auth failed: ${error.message}`);
            },
          },
        }
      )
    )
    .ws("/ws/basic", {
      message: (ws, message) => {
        const authContext = getWebSocketAuthContext(ws);

        if (!isWebSocketAuthenticated(ws)) {
          ws.send(JSON.stringify({ error: "Not authenticated" }));
          return;
        }

        // Echo message with user context
        const response = {
          type: "echo",
          originalMessage: message,
          user: {
            id: authContext?.userId,
            permissions: authContext?.permissions,
            authenticated: true,
          },
          timestamp: new Date().toISOString(),
        };

        sendAuthenticatedMessage(ws, response);
      },
    });
}

/**
 * Permission-Based WebSocket Example
 *
 * Demonstrates message-level permission checking
 * Requires 'chat_access' permission for chat messages
 */
export function createPermissionBasedWebSocketExample(
  metrics: IMetricsCollector,
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService
) {
  const presets = createKeycloakWebSocketAuthPresets(
    metrics,
    keycloakClientFactory,
    tokenIntrospectionService
  );

  return new Elysia()
    .use(presets.requireAuth("frontend", "/ws/chat"))
    .ws("/ws/chat", {
      message: (ws, message) => {
        const authContext = getWebSocketAuthContext(ws);

        if (!isWebSocketAuthenticated(ws)) {
          ws.send(JSON.stringify({ error: "Authentication required" }));
          ws.close(1008, "Authentication required");
          return;
        }

        try {
          const parsedMessage = JSON.parse(String(message));

          switch (parsedMessage.type) {
            case "chat":
              // Check chat permission
              if (!webSocketHasPermission(ws, "chat_access")) {
                ws.send(
                  JSON.stringify({
                    error: "Insufficient permissions",
                    required: "chat_access",
                  })
                );
                return;
              }

              // Broadcast chat message
              const chatResponse = {
                type: "chat_message",
                message: parsedMessage.content,
                user: authContext?.userId,
                timestamp: new Date().toISOString(),
              };

              sendAuthenticatedMessage(ws, chatResponse);
              break;

            case "ping":
              // Ping doesn't require special permissions
              ws.send(
                JSON.stringify({
                  type: "pong",
                  timestamp: new Date().toISOString(),
                })
              );
              break;

            default:
              ws.send(
                JSON.stringify({
                  error: "Unknown message type",
                  supportedTypes: ["chat", "ping"],
                })
              );
          }
        } catch (error) {
          ws.send(
            JSON.stringify({
              error: "Invalid JSON message",
              example: { type: "chat", content: "Hello world!" },
            })
          );
        }
      },
    });
}

/**
 * Development WebSocket Example
 *
 * Relaxed authentication for development/testing
 * Allows anonymous connections and provides debugging info
 */
export function createDevelopmentWebSocketExample(
  metrics: IMetricsCollector,
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService
) {
  const presets = createKeycloakWebSocketAuthPresets(
    metrics,
    keycloakClientFactory,
    tokenIntrospectionService
  );

  return new Elysia().use(presets.development("/ws/dev")).ws("/ws/dev", {
    message: (ws, message) => {
      const authContext = getWebSocketAuthContext(ws);
      const isAuth = isWebSocketAuthenticated(ws);

      try {
        const parsedMessage = JSON.parse(String(message));

        if (parsedMessage.type === "debug") {
          // Return debugging information
          const debugInfo = {
            type: "debug_info",
            connection: {
              authenticated: isAuth,
              userId: authContext?.userId || "anonymous",
              permissions: authContext?.permissions || [],
              scopes: authContext?.scopes || [],
              method: authContext?.method || "none",
            },
            middleware: {
              clientId: authContext?.clientId,
              validatedAt: authContext?.validatedAt,
            },
            timestamp: new Date().toISOString(),
          };

          ws.send(JSON.stringify(debugInfo, null, 2));
          return;
        }

        // Echo any other message
        const response = {
          type: "echo",
          message: parsedMessage,
          authenticated: isAuth,
          user: isAuth ? authContext?.userId : "anonymous",
          timestamp: new Date().toISOString(),
        };

        ws.send(JSON.stringify(response));
      } catch (error) {
        ws.send(
          JSON.stringify({
            error: "Invalid JSON",
            received: String(message),
            example: { type: "debug" },
            timestamp: new Date().toISOString(),
          })
        );
      }
    },
  });
}

/**
 * Complete WebSocket Server Example
 *
 * Combines all examples into a single server for testing
 */
export function createCompleteWebSocketServer(
  metrics: IMetricsCollector,
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService
) {
  return (
    new Elysia()
      // Basic authenticated WebSocket
      .use(
        createBasicWebSocketExample(
          metrics,
          keycloakClientFactory,
          tokenIntrospectionService
        )
      )
      // Permission-based WebSocket
      .use(
        createPermissionBasedWebSocketExample(
          metrics,
          keycloakClientFactory,
          tokenIntrospectionService
        )
      )
      // Development WebSocket
      .use(
        createDevelopmentWebSocketExample(
          metrics,
          keycloakClientFactory,
          tokenIntrospectionService
        )
      )
      // Health check endpoint
      .get("/health", () => ({
        status: "ok",
        websocketEndpoints: [
          "/ws/basic - Requires authentication",
          "/ws/chat - Requires authentication + permissions",
          "/ws/dev - Development mode (anonymous allowed)",
        ],
        timestamp: new Date().toISOString(),
      }))
  );
}

/**
 * Usage Example in Application
 */
export const WEBSOCKET_USAGE_EXAMPLES = {
  /**
   * Connect to basic WebSocket with JWT token
   */
  basicConnection: `
// JavaScript Client Example
const ws = new WebSocket('ws://localhost:3000/ws/basic', [], {
  headers: {
    'Authorization': 'Bearer your-jwt-token-here'
  }
});

// Or with query parameter
const wsQuery = new WebSocket('ws://localhost:3000/ws/basic?token=your-jwt-token-here');

ws.onopen = () => console.log('Connected!');
ws.onmessage = (event) => console.log('Message:', JSON.parse(event.data));
ws.send('Hello from client!');
`,

  /**
   * Chat WebSocket with permissions
   */
  chatConnection: `
const chatWs = new WebSocket('ws://localhost:3000/ws/chat', [], {
  headers: { 'Authorization': 'Bearer your-jwt-token-with-chat-access' }
});

// Send chat message
chatWs.send(JSON.stringify({
  type: 'chat',
  content: 'Hello everyone!'
}));

// Send ping
chatWs.send(JSON.stringify({ type: 'ping' }));
`,

  /**
   * Development WebSocket for testing
   */
  developmentConnection: `
const devWs = new WebSocket('ws://localhost:3000/ws/dev');

// Get debug information
devWs.send(JSON.stringify({ type: 'debug' }));

// Test with anonymous connection
devWs.send(JSON.stringify({ 
  type: 'test',
  message: 'Testing without auth' 
}));
`,
};
