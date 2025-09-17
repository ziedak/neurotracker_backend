/**
 * Keycloak WebSocket Authentication Plugin for Elysia
 * Provides seamless WebSocket authentication integration following HTTP middleware patterns
 */

import { Elysia } from "elysia";
import type { IMetricsCollector } from "@libs/monitoring";

import {
  KeycloakWebSocketMiddleware,
  type KeycloakWebSocketConfig,
  type WebSocketAuthenticationResult,
  type WebSocketConnectionInfo,
} from "./keycloak-websocket.middleware.js";
import {
  IKeycloakClientFactory,
  ITokenIntrospectionService,
  type AuthContext,
  type WebSocketAuthContext,
  type ClientType,
} from "../types/index.js";

/**
 * Configuration for Keycloak WebSocket Elysia plugin
 */
export interface KeycloakWebSocketElysiaConfig extends KeycloakWebSocketConfig {
  /** Optional plugin name for identification */
  pluginName?: string;
  /** WebSocket upgrade path (default: "/ws") */
  wsPath?: string;
}

/**
 * Extended WebSocket context with Keycloak authentication data
 */
export interface KeycloakWebSocketContext {
  connectionId: string;
  authContext?: AuthContext;
  wsAuthContext?: WebSocketAuthContext;
  keycloakAuth?: {
    method: "jwt_token" | "api_key" | "session_based" | "none";
    client: ClientType;
    authenticated: boolean;
    connectionTime: Date;
    lastValidated: Date;
  };
}

/**
 * WebSocket message with authentication context
 */
export interface AuthenticatedWebSocketMessage {
  data: string | ArrayBufferLike;
  connectionId: string;
  authContext: AuthContext | undefined; // Explicitly allow undefined
  timestamp: Date;
}

/**
 * Keycloak WebSocket Authentication Plugin for Elysia
 *
 * Usage:
 * ```typescript
 * import { keycloakWebSocket } from '@libs/keycloak-auth';
 *
 * const app = new Elysia()
 *   .use(keycloakWebSocket(metrics, clientFactory, tokenService, config))
 *   .ws('/ws', {
 *     message: ({ data, connectionId, authContext }) => {
 *       // Access authenticated user data
 *       console.log('Message from user:', authContext?.userId);
 *     }
 *   });
 * ```
 */
export function keycloakWebSocket(
  metrics: IMetricsCollector,
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService,
  config: KeycloakWebSocketElysiaConfig = {
    httpConfig: {
      name: "keycloak-websocket",
      keycloakClient: "websocket",
      requireAuth: true,
    },
    websocket: {
      allowAnonymous: false,
    },
  }
) {
  const pluginName = config.pluginName ?? "keycloak-websocket";
  const wsPath = config.wsPath ?? "/ws";

  // Create the WebSocket middleware instance
  const middleware = new KeycloakWebSocketMiddleware(
    metrics,
    keycloakClientFactory,
    tokenIntrospectionService,
    config
  );

  return new Elysia({ name: pluginName })
    .ws(wsPath, {
      // Connection upgrade handler
      upgrade: async (context) => {
        try {
          // Extract headers from Elysia context
          const headers: Record<string, string> = {};
          if (context.headers) {
            Object.entries(context.headers).forEach(([key, value]) => {
              if (value !== undefined) {
                headers[key] = String(value);
              }
            });
          }

          // Extract query parameters
          const query: Record<string, string> = context.query || {};

          // Authenticate the WebSocket connection
          const authResult: WebSocketAuthenticationResult =
            await middleware.authenticateWebSocket(headers, query);

          if (!authResult.success) {
            // Reject the connection upgrade
            return new Response("Unauthorized", {
              status: 401,
              headers: {
                "Content-Type": "text/plain",
              },
            });
          }

          // Store auth context for the connection
          return {
            authContext: authResult.authContext,
            connectionInfo: authResult.connectionInfo,
          };
        } catch (error) {
          metrics.recordCounter("keycloak_websocket_upgrade_errors", 1, {
            error: error instanceof Error ? error.message : "unknown",
          });

          return new Response("Authentication Error", {
            status: 500,
            headers: {
              "Content-Type": "text/plain",
            },
          });
        }
      },

      // Connection established handler
      open: async (ws) => {
        try {
          const connectionId = ws.id;

          // Handle connection establishment
          await middleware.handleConnection(connectionId);

          metrics.recordCounter("keycloak_websocket_connections_opened", 1, {
            client_id: (ws.data as any)?.authContext?.clientId || "unknown",
          });
        } catch (error) {
          metrics.recordCounter("keycloak_websocket_connection_errors", 1, {
            error: error instanceof Error ? error.message : "unknown",
          });

          // Close connection on error
          ws.close(1011, "Connection error");
        }
      },

      // Message handler with authentication context
      message: async (ws, message) => {
        try {
          const connectionId = ws.id;

          // Validate connection is still authenticated
          const isValid = await middleware.validateConnection(connectionId);
          if (!isValid) {
            ws.close(1008, "Authentication expired");
            return;
          }

          // Get connection data with auth context
          const connectionData = middleware.getConnection(connectionId);

          // Create authenticated message context
          const authenticatedMessage: AuthenticatedWebSocketMessage = {
            data: message as string | ArrayBufferLike,
            connectionId,
            authContext: connectionData
              ? middleware.convertWebSocketAuthToAuthContext(
                  connectionData.auth
                )
              : undefined,
            timestamp: new Date(),
          };

          // Add to WebSocket data for handler access (using index signature for compatibility)
          (ws.data as any).authenticatedMessage = authenticatedMessage;
          (ws.data as any).connectionId = connectionId;
          (ws.data as any).authContext = authenticatedMessage.authContext;

          metrics.recordCounter("keycloak_websocket_messages_processed", 1, {
            authenticated: connectionData ? "true" : "false",
            client_id: connectionData?.auth.clientId || "unknown",
          });
        } catch (error) {
          metrics.recordCounter("keycloak_websocket_message_errors", 1, {
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      },

      // Connection close handler
      close: async (ws) => {
        try {
          const connectionId = ws.id;

          // Handle disconnection cleanup
          await middleware.handleDisconnection(connectionId);

          metrics.recordCounter("keycloak_websocket_connections_closed", 1);
        } catch (error) {
          metrics.recordCounter("keycloak_websocket_disconnection_errors", 1, {
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      },

      // Error handler - use proper Elysia error handling
      error: (context) => {
        const error = context.error || new Error("Unknown WebSocket error");

        metrics.recordCounter("keycloak_websocket_errors", 1, {
          error: error instanceof Error ? error.message : String(error),
        });

        console.error("WebSocket error:", error);
      },
    })
    .derive(() => {
      // Provide WebSocket utilities in context
      return {
        wsMiddleware: middleware,
        getWebSocketStats: () => middleware.getStats(),
        getWebSocketConnection: (connectionId: string) =>
          middleware.getConnection(connectionId),
        validateWebSocketConnection: (connectionId: string) =>
          middleware.validateConnection(connectionId),
      };
    });
}

/**
 * Create Keycloak WebSocket authentication middleware with preset configurations
 */
export class KeycloakWebSocketAuthPresets {
  constructor(
    private metrics: IMetricsCollector,
    private keycloakClientFactory: IKeycloakClientFactory,
    private tokenIntrospectionService: ITokenIntrospectionService
  ) {}

  /**
   * Require authentication for WebSocket connections
   */
  requireAuth(client: ClientType = "websocket", wsPath = "/ws") {
    return keycloakWebSocket(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      {
        pluginName: `keycloak-websocket-auth-${client}`,
        wsPath,
        httpConfig: {
          name: `websocket-${client}`,
          keycloakClient: client,
          requireAuth: true,
        },
        websocket: {
          allowAnonymous: false,
          heartbeatInterval: 30,
          tokenRefreshThreshold: 300, // 5 minutes
        },
      }
    );
  }

  /**
   * Optional authentication for WebSocket (allows anonymous)
   */
  optionalAuth(client: ClientType = "websocket", wsPath = "/ws") {
    return keycloakWebSocket(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      {
        pluginName: `keycloak-websocket-optional-${client}`,
        wsPath,
        httpConfig: {
          name: `websocket-optional-${client}`,
          keycloakClient: client,
          requireAuth: false,
        },
        websocket: {
          allowAnonymous: true,
          heartbeatInterval: 60,
        },
      }
    );
  }

  /**
   * Development configuration (relaxed security)
   */
  development(wsPath = "/ws") {
    return keycloakWebSocket(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      {
        pluginName: "keycloak-websocket-dev",
        wsPath,
        httpConfig: {
          name: "websocket-development",
          keycloakClient: "frontend",
          requireAuth: false,
        },
        websocket: {
          allowAnonymous: true,
          heartbeatInterval: 120, // Less frequent heartbeat in dev
        },
        hooks: {
          onConnect: async (connectionInfo) => {
            console.log("🔌 WebSocket connected:", connectionInfo.connectionId);
          },
          onDisconnect: async (connectionInfo) => {
            console.log(
              "🔌 WebSocket disconnected:",
              connectionInfo.connectionId
            );
          },
        },
      }
    );
  }

  /**
   * Production configuration (strict security)
   */
  production(client: ClientType = "websocket", wsPath = "/ws") {
    return keycloakWebSocket(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      {
        pluginName: "keycloak-websocket-prod",
        wsPath,
        httpConfig: {
          name: "websocket-production",
          keycloakClient: client,
          requireAuth: true,
          requiredScopes: ["websocket_access"],
        },
        websocket: {
          allowAnonymous: false,
          heartbeatInterval: 30,
          maxConnectionsPerUser: 3,
          tokenRefreshThreshold: 180, // 3 minutes
        },
      }
    );
  }

  /**
   * Real-time dashboard connections
   */
  dashboard(wsPath = "/dashboard") {
    return keycloakWebSocket(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      {
        pluginName: "keycloak-websocket-dashboard",
        wsPath,
        httpConfig: {
          name: "websocket-dashboard",
          keycloakClient: "frontend",
          requireAuth: true,
          requiredPermissions: ["dashboard_access"],
        },
        websocket: {
          allowAnonymous: false,
          heartbeatInterval: 15, // Frequent heartbeat for dashboard
          maxConnectionsPerUser: 1, // Single dashboard connection
          tokenRefreshThreshold: 600, // 10 minutes
        },
      }
    );
  }

  /**
   * TrackerJS WebSocket connections
   */
  tracker(wsPath = "/tracker") {
    return keycloakWebSocket(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      {
        pluginName: "keycloak-websocket-tracker",
        wsPath,
        httpConfig: {
          name: "websocket-tracker",
          keycloakClient: "tracker",
          requireAuth: true,
          requiredScopes: ["tracking_events"],
        },
        websocket: {
          allowAnonymous: false,
          heartbeatInterval: 60,
          maxConnectionsPerUser: 5, // Multiple tracker instances
          tokenRefreshThreshold: 900, // 15 minutes
        },
      }
    );
  }

  /**
   * Custom configuration
   */
  custom(config: KeycloakWebSocketElysiaConfig) {
    return keycloakWebSocket(
      this.metrics,
      this.keycloakClientFactory,
      this.tokenIntrospectionService,
      config
    );
  }
}

/**
 * Helper to create Keycloak WebSocket authentication presets
 */
export function createKeycloakWebSocketAuthPresets(
  metrics: IMetricsCollector,
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService
): KeycloakWebSocketAuthPresets {
  return new KeycloakWebSocketAuthPresets(
    metrics,
    keycloakClientFactory,
    tokenIntrospectionService
  );
}

/**
 * Utility functions for WebSocket authentication
 * Using 'any' type for WebSocket to avoid Elysia type compatibility issues
 */

/**
 * Extract authentication context from WebSocket data
 */
export function getWebSocketAuthContext(ws: any): AuthContext | null {
  return (ws.data as any)?.authContext ?? null;
}

/**
 * Check if WebSocket connection is authenticated
 */
export function isWebSocketAuthenticated(ws: any): boolean {
  const authContext = getWebSocketAuthContext(ws);
  return !!authContext && !!authContext.userId;
}

/**
 * Get WebSocket connection ID
 */
export function getWebSocketConnectionId(ws: any): string {
  return (ws.data as any)?.connectionId ?? ws.id;
}

/**
 * Check if WebSocket user has specific role
 */
export function webSocketHasRole(ws: any, role: string): boolean {
  const authContext = getWebSocketAuthContext(ws);
  // Note: Using permissions array as roles since our AuthContext doesn't have roles property
  return authContext?.permissions?.includes(role) ?? false;
}

/**
 * Check if WebSocket user has specific permission
 */
export function webSocketHasPermission(ws: any, permission: string): boolean {
  const authContext = getWebSocketAuthContext(ws);
  return authContext?.permissions?.includes(permission) ?? false;
}

/**
 * Send authenticated message (includes auth context)
 */
export function sendAuthenticatedMessage(ws: any, message: any): void {
  const authContext = getWebSocketAuthContext(ws);
  const enhancedMessage = {
    ...message,
    metadata: {
      timestamp: new Date().toISOString(),
      connectionId: getWebSocketConnectionId(ws),
      authenticated: isWebSocketAuthenticated(ws),
      userId: authContext?.userId,
    },
  };

  ws.send(JSON.stringify(enhancedMessage));
}

// Re-export types and interfaces
export type {
  KeycloakWebSocketConfig,
  WebSocketAuthenticationResult,
  WebSocketConnectionInfo,
};

export { KeycloakWebSocketMiddleware };
