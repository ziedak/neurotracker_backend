import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import { IncomingMessage } from "http";
import { getEnv, getNumberEnv, getBooleanEnv } from "@libs/config";
/**
 * 👤 User Management:

Authentication and session tracking
User-specific message routing
Connection state monitoring
🏠 Room System:

Join/leave room functionality
Room-based message broadcasting
Automatic room cleanup
📢 Topic Subscriptions:

Subscribe to specific event types
Targeted message delivery
System-wide announcements
💓 Health Monitoring:


Automatic heartbeat/ping-pong
Stale connection detection
Graceful connection cleanup

💓 Usage:
// Basic WebSocket server
const wsManager = new WebSocketManager({ port: 8080 });

// Send to user
wsManager.sendToUser('user123', { type: 'notification', payload: data });

// Broadcast to room
wsManager.sendToRoom('team_alpha', { type: 'message', payload: data });

// Topic broadcast  
wsManager.broadcastToTopic('system_updates', { type: 'update', payload: data });
 */
export interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp?: string;
  userId?: string;
  sessionId?: string;
}

export interface WebSocketConnection {
  id: string;
  userId?: string;
  sessionId?: string;
  socket: WebSocket;
  subscriptions: Set<string>;
  lastHeartbeat: Date;
}

export interface WebSocketConfig {
  port?: number;
  path?: string;
  heartbeatInterval?: number;
  maxConnections?: number;
  enableCompression?: boolean;
  enableHeartbeat?: boolean;
}

export class WebSocketManager {
  private wss: WebSocketServer;
  private connections: Map<string, WebSocketConnection> = new Map();
  private rooms: Map<string, Set<string>> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;
  private config: Required<WebSocketConfig>;

  constructor(config: WebSocketConfig = {}) {
    this.config = {
      port: config.port || getNumberEnv("WS_PORT", 8080),
      path: config.path || getEnv("WS_PATH", "/ws"),
      heartbeatInterval:
        config.heartbeatInterval ||
        getNumberEnv("WS_HEARTBEAT_INTERVAL", 30000),
      maxConnections:
        config.maxConnections || getNumberEnv("WS_MAX_CONNECTIONS", 1000),
      enableCompression:
        config.enableCompression ?? getBooleanEnv("WS_COMPRESSION", true),
      enableHeartbeat:
        config.enableHeartbeat ?? getBooleanEnv("WS_HEARTBEAT", true),
    };

    this.wss = new WebSocketServer({
      port: this.config.port,
      path: this.config.path,
      perMessageDeflate: this.config.enableCompression,
      maxPayload: 16 * 1024, // 16KB max message size
    });

    this.setupWebSocketServer();

    if (this.config.enableHeartbeat) {
      this.startHeartbeat();
    }

    console.log(
      `🔌 WebSocket server started on port ${this.config.port}${this.config.path}`
    );
  }

  // Alternative constructor for integration with existing HTTP server
  static fromHttpServer(
    server: Server,
    config: WebSocketConfig = {}
  ): WebSocketManager {
    const manager = new WebSocketManager({ ...config, port: undefined });
    manager.wss = new WebSocketServer({
      server,
      path: config.path || getEnv("WS_PATH", "/ws"),
      perMessageDeflate:
        config.enableCompression ?? getBooleanEnv("WS_COMPRESSION", true),
      maxPayload: 16 * 1024,
    });
    manager.setupWebSocketServer();
    return manager;
  }

  private setupWebSocketServer(): void {
    this.wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
      if (this.connections.size >= this.config.maxConnections) {
        ws.close(1013, "Server overloaded");
        return;
      }

      const connectionId = this.generateConnectionId();
      const connection: WebSocketConnection = {
        id: connectionId,
        socket: ws,
        subscriptions: new Set(),
        lastHeartbeat: new Date(),
      };

      this.connections.set(connectionId, connection);

      // Send connection acknowledgment
      this.sendToConnection(connectionId, {
        type: "connection",
        payload: { connectionId, message: "Connected successfully" },
        timestamp: new Date().toISOString(),
      });

      ws.on("message", (data: Buffer) => {
        try {
          const message: WebSocketMessage = JSON.parse(data.toString());
          this.handleMessage(connectionId, message);
        } catch (error) {
          this.sendError(connectionId, "Invalid message format", error);
        }
      });

      ws.on("close", () => {
        this.handleDisconnection(connectionId);
      });

      ws.on("error", (error: Error) => {
        console.error(`WebSocket error for connection ${connectionId}:`, error);
        this.handleDisconnection(connectionId);
      });

      ws.on("pong", () => {
        const conn = this.connections.get(connectionId);
        if (conn) {
          conn.lastHeartbeat = new Date();
        }
      });

      console.log(
        `📱 New WebSocket connection: ${connectionId} (${this.connections.size} total)`
      );
    });
  }

  private handleMessage(connectionId: string, message: WebSocketMessage): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    switch (message.type) {
      case "authenticate":
        this.handleAuthentication(connectionId, message);
        break;
      case "subscribe":
        this.handleSubscription(connectionId, message);
        break;
      case "unsubscribe":
        this.handleUnsubscription(connectionId, message);
        break;
      case "join_room":
        this.handleJoinRoom(connectionId, message);
        break;
      case "leave_room":
        this.handleLeaveRoom(connectionId, message);
        break;
      case "heartbeat":
        connection.lastHeartbeat = new Date();
        this.sendToConnection(connectionId, {
          type: "heartbeat",
          payload: "pong",
        });
        break;
      default:
        this.sendError(connectionId, `Unknown message type: ${message.type}`);
    }
  }

  private handleAuthentication(
    connectionId: string,
    message: WebSocketMessage
  ): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Extract user info from message payload
    const { userId, sessionId, token } = message.payload;

    // TODO: Add actual authentication logic here
    // For now, we'll just accept the provided userId and sessionId
    connection.userId = userId;
    connection.sessionId = sessionId;

    this.sendToConnection(connectionId, {
      type: "authenticated",
      payload: { userId, sessionId, status: "success" },
      timestamp: new Date().toISOString(),
    });

    console.log(
      `🔐 Connection ${connectionId} authenticated as user ${userId}`
    );
  }

  private handleSubscription(
    connectionId: string,
    message: WebSocketMessage
  ): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const { topic } = message.payload;
    if (typeof topic === "string") {
      connection.subscriptions.add(topic);
      this.sendToConnection(connectionId, {
        type: "subscribed",
        payload: { topic, status: "success" },
        timestamp: new Date().toISOString(),
      });
      console.log(`📢 Connection ${connectionId} subscribed to ${topic}`);
    }
  }

  private handleUnsubscription(
    connectionId: string,
    message: WebSocketMessage
  ): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    const { topic } = message.payload;
    if (typeof topic === "string") {
      connection.subscriptions.delete(topic);
      this.sendToConnection(connectionId, {
        type: "unsubscribed",
        payload: { topic, status: "success" },
        timestamp: new Date().toISOString(),
      });
      console.log(`📢 Connection ${connectionId} unsubscribed from ${topic}`);
    }
  }

  private handleJoinRoom(
    connectionId: string,
    message: WebSocketMessage
  ): void {
    const { room } = message.payload;
    if (typeof room === "string") {
      if (!this.rooms.has(room)) {
        this.rooms.set(room, new Set());
      }
      this.rooms.get(room)!.add(connectionId);

      this.sendToConnection(connectionId, {
        type: "joined_room",
        payload: { room, status: "success" },
        timestamp: new Date().toISOString(),
      });

      console.log(`🏠 Connection ${connectionId} joined room ${room}`);
    }
  }

  private handleLeaveRoom(
    connectionId: string,
    message: WebSocketMessage
  ): void {
    const { room } = message.payload;
    if (typeof room === "string" && this.rooms.has(room)) {
      this.rooms.get(room)!.delete(connectionId);

      // Clean up empty rooms
      if (this.rooms.get(room)!.size === 0) {
        this.rooms.delete(room);
      }

      this.sendToConnection(connectionId, {
        type: "left_room",
        payload: { room, status: "success" },
        timestamp: new Date().toISOString(),
      });

      console.log(`🏠 Connection ${connectionId} left room ${room}`);
    }
  }

  private handleDisconnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Remove from all rooms
    for (const [room, members] of this.rooms.entries()) {
      if (members.has(connectionId)) {
        members.delete(connectionId);
        if (members.size === 0) {
          this.rooms.delete(room);
        }
      }
    }

    this.connections.delete(connectionId);
    console.log(
      `📱 Connection ${connectionId} disconnected (${this.connections.size} remaining)`
    );
  }

  // Public API methods
  public sendToConnection(
    connectionId: string,
    message: WebSocketMessage
  ): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      connection.socket.send(
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

  public sendToUser(userId: string, message: WebSocketMessage): number {
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (connection.userId === userId) {
        if (this.sendToConnection(connection.id, message)) {
          sent++;
        }
      }
    }
    return sent;
  }

  public sendToRoom(room: string, message: WebSocketMessage): number {
    const members = this.rooms.get(room);
    if (!members) return 0;

    let sent = 0;
    for (const connectionId of members) {
      if (this.sendToConnection(connectionId, message)) {
        sent++;
      }
    }
    return sent;
  }

  public broadcastToTopic(topic: string, message: WebSocketMessage): number {
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (connection.subscriptions.has(topic)) {
        if (this.sendToConnection(connection.id, message)) {
          sent++;
        }
      }
    }
    return sent;
  }

  public broadcast(message: WebSocketMessage): number {
    let sent = 0;
    for (const connection of this.connections.values()) {
      if (this.sendToConnection(connection.id, message)) {
        sent++;
      }
    }
    return sent;
  }

  public getConnectionCount(): number {
    return this.connections.size;
  }

  public getActiveRooms(): string[] {
    return Array.from(this.rooms.keys());
  }

  public getRoomMembers(room: string): string[] {
    const members = this.rooms.get(room);
    return members ? Array.from(members) : [];
  }

  private sendError(connectionId: string, message: string, error?: any): void {
    this.sendToConnection(connectionId, {
      type: "error",
      payload: { message, error: error?.message },
      timestamp: new Date().toISOString(),
    });
  }

  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      const staleConnections: string[] = [];

      for (const [id, connection] of this.connections.entries()) {
        const timeSinceLastHeartbeat =
          now.getTime() - connection.lastHeartbeat.getTime();

        if (timeSinceLastHeartbeat > this.config.heartbeatInterval * 2) {
          // Connection is stale, mark for removal
          staleConnections.push(id);
        } else if (timeSinceLastHeartbeat > this.config.heartbeatInterval) {
          // Send ping to check if connection is alive
          if (connection.socket.readyState === WebSocket.OPEN) {
            connection.socket.ping();
          }
        }
      }

      // Remove stale connections
      for (const id of staleConnections) {
        console.log(`💀 Removing stale connection: ${id}`);
        this.handleDisconnection(id);
      }
    }, this.config.heartbeatInterval);
  }

  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all connections
    for (const connection of this.connections.values()) {
      connection.socket.close();
    }

    this.wss.close();
    console.log("🔌 WebSocket server closed");
  }
}
