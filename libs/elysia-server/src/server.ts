import { Elysia, t } from "elysia";
import { ServerConfig, DEFAULT_SERVER_CONFIG } from "./config";
import { setupCorePlugins } from "./plugins";
import { setupMiddleware } from "./middleware";
import { setupErrorHandling } from "./error-handling";

export interface RouteSetup {
  (app: Elysia): Elysia;
}

export interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp?: string;
  userId?: string;
  sessionId?: string;
}

export interface WebSocketHandler {
  open?: (ws: any) => void;
  message?: (ws: any, message: WebSocketMessage) => void;
  close?: (ws: any, code: number, reason: string) => void;
  drain?: (ws: any) => void;
}

export class ElysiaServerBuilder {
  private config: ServerConfig;
  private routeSetups: RouteSetup[] = [];
  private wsHandler?: WebSocketHandler;
  private connections: Map<string, any> = new Map();
  private rooms: Map<string, Set<string>> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();

  constructor(config: Partial<ServerConfig>) {
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config } as ServerConfig;
  }

  addRoutes(routeSetup: RouteSetup): this {
    this.routeSetups.push(routeSetup);
    return this;
  }

  addWebSocketHandler(wsHandler: WebSocketHandler): this {
    this.wsHandler = wsHandler;
    return this;
  }

  // WebSocket utility methods
  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  sendToConnection(connectionId: string, message: WebSocketMessage): boolean {
    const ws = this.connections.get(connectionId);
    if (!ws) return false;

    try {
      ws.send(
        JSON.stringify({
          ...message,
          timestamp: message.timestamp || new Date().toISOString(),
        })
      );
      return true;
    } catch (error) {
      console.error(`Failed to send message to ${connectionId}:`, error);
      return false;
    }
  }

  sendToUser(userId: string, message: WebSocketMessage): number {
    const userConns = this.userConnections.get(userId);
    if (!userConns) return 0;

    let sent = 0;
    for (const connectionId of userConns) {
      if (this.sendToConnection(connectionId, message)) {
        sent++;
      }
    }
    return sent;
  }

  sendToRoom(room: string, message: WebSocketMessage): number {
    const roomMembers = this.rooms.get(room);
    if (!roomMembers) return 0;

    let sent = 0;
    for (const connectionId of roomMembers) {
      if (this.sendToConnection(connectionId, message)) {
        sent++;
      }
    }
    return sent;
  }

  broadcast(message: WebSocketMessage): number {
    let sent = 0;
    for (const [connectionId] of this.connections) {
      if (this.sendToConnection(connectionId, message)) {
        sent++;
      }
    }
    return sent;
  }

  getStats() {
    return {
      activeConnections: this.connections.size,
      activeRooms: this.rooms.size,
      activeUsers: this.userConnections.size,
    };
  }

  private handleWebSocketMessage(
    ws: any,
    message: WebSocketMessage,
    connectionId: string
  ): void {
    if (!this.config.websocket?.enabled) {
      // WebSocket is disabled, skip handling
      return;
    }
    switch (message.type) {
      case "authenticate":
        const { userId, sessionId } = message.payload;
        (ws.data as any).userId = userId;
        (ws.data as any).sessionId = sessionId;

        // Track user connections
        if (!this.userConnections.has(userId)) {
          this.userConnections.set(userId, new Set());
        }
        this.userConnections.get(userId)!.add(connectionId);

        this.sendToConnection(connectionId, {
          type: "authenticated",
          payload: { userId, sessionId, status: "success" },
        });
        break;

      case "join_room":
        const { room } = message.payload;
        if (!this.rooms.has(room)) {
          this.rooms.set(room, new Set());
        }
        this.rooms.get(room)!.add(connectionId);

        this.sendToConnection(connectionId, {
          type: "joined_room",
          payload: { room, status: "success" },
        });
        break;

      case "leave_room":
        const { room: leaveRoom } = message.payload;
        if (this.rooms.has(leaveRoom)) {
          this.rooms.get(leaveRoom)!.delete(connectionId);
          if (this.rooms.get(leaveRoom)!.size === 0) {
            this.rooms.delete(leaveRoom);
          }
        }

        this.sendToConnection(connectionId, {
          type: "left_room",
          payload: { room: leaveRoom, status: "success" },
        });
        break;

      default:
        // Forward to custom handler if provided
        if (this.wsHandler?.message) {
          this.wsHandler.message(ws, message);
        }
    }
  }

  private cleanupConnection(connectionId: string, ws: any): void {
    // Remove from connections
    this.connections.delete(connectionId);

    // Remove from user connections
    if ((ws.data as any).userId) {
      const userConns = this.userConnections.get((ws.data as any).userId);
      if (userConns) {
        userConns.delete(connectionId);
        if (userConns.size === 0) {
          this.userConnections.delete((ws.data as any).userId);
        }
      }
    }

    // Remove from all rooms
    for (const [room, members] of this.rooms.entries()) {
      if (members.has(connectionId)) {
        members.delete(connectionId);
        if (members.size === 0) {
          this.rooms.delete(room);
        }
      }
    }
  }

  build(): Elysia {
    let app = new Elysia({
      websocket: this.config.websocket?.enabled
        ? {
            idleTimeout: this.config.websocket.idleTimeout,
            maxPayloadLength: this.config.websocket.maxPayloadLength,
            perMessageDeflate: this.config.websocket.perMessageDeflate,
            backpressureLimit: this.config.websocket.backpressureLimit,
            closeOnBackpressureLimit:
              this.config.websocket.closeOnBackpressureLimit,
          }
        : undefined,
    });

    // Setup core functionality
    setupCorePlugins(app, this.config);
    setupErrorHandling(app, this.config);
    setupMiddleware(app, this.config);

    // Add default health endpoint
    app.get("/health", () => ({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      service: this.config.name,
      version: this.config.version,
    }));

    // Add WebSocket endpoint and stats only if enabled
    if (this.config.websocket?.enabled) {
      app.ws(this.config.websocket.path || "/ws", {
        body: t.Object({
          type: t.String(),
          payload: t.Any(),
          timestamp: t.Optional(t.String()),
          userId: t.Optional(t.String()),
          sessionId: t.Optional(t.String()),
        }),
        open: (ws) => {
          const connectionId = this.generateConnectionId();
          (ws.data as any).connectionId = connectionId;
          this.connections.set(connectionId, ws);

          // Send connection acknowledgment
          this.sendToConnection(connectionId, {
            type: "connection",
            payload: { connectionId, message: "Connected successfully" },
          });

          console.log(
            `� WebSocket connection opened: ${connectionId} (${this.connections.size} total)`
          );

          // Call custom open handler if provided
          if (this.wsHandler?.open) {
            this.wsHandler.open(ws);
          }
        },
        message: (ws, message) => {
          const connectionId = (ws.data as any).connectionId;
          this.handleWebSocketMessage(ws, message, connectionId);
        },
        close: (ws, code, reason) => {
          const connectionId = (ws.data as any).connectionId;
          this.cleanupConnection(connectionId, ws);

          console.log(
            `🔌 WebSocket connection closed: ${connectionId} (${this.connections.size} remaining)`
          );

          // Call custom close handler if provided
          if (this.wsHandler?.close) {
            this.wsHandler.close(ws, code, reason);
          }
        },
        drain: (ws) => {
          // Call custom drain handler if provided
          if (this.wsHandler?.drain) {
            this.wsHandler.drain(ws);
          }
        },
      });

      // Add WebSocket stats endpoint
      app.get("/ws/stats", () => this.getStats());
    }

    // Add custom routes
    this.routeSetups.forEach((setup) => setup(app));

    return app;
  }

  start(): { app: Elysia; server: any; wsServer?: ElysiaServerBuilder } {
    const app = this.build();

    const server = app.listen(this.config.port, () => {
      console.log(`🚀 ${this.config.name} running on port ${this.config.port}`);
      if (this.config.swagger?.enabled) {
        console.log(
          `📚 Swagger docs available at: http://localhost:${this.config.port}${
            this.config.swagger.path || "/swagger"
          }`
        );
      }
      if (this.config.websocket?.enabled) {
        console.log(
          `🔌 WebSocket server enabled at: ws://localhost:${this.config.port}${
            this.config.websocket.path || "/ws"
          }`
        );
      }
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log("Shutting down gracefully");
      // Cleanup all WebSocket connections
      for (const [connectionId, ws] of this.connections) {
        ws.close(1001, "Server shutting down");
      }
      server.stop();
      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    return { app, server, wsServer: this };
  }
}

// Convenience function for quick server creation
export function createElysiaServer(
  config: Partial<ServerConfig>,
  routes?: RouteSetup
): ElysiaServerBuilder {
  const builder = new ElysiaServerBuilder(config);
  if (routes) {
    builder.addRoutes(routes);
  }
  return builder;
}
