import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  InterventionMessage,
  ConnectionPool,
  WebSocketConnection,
} from "./types";

export class WebSocketGateway {
  private connectionPools: Map<string, ConnectionPool> = new Map();
  private connections: Map<string, WebSocketConnection> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(private logger: Logger, private metrics: MetricsCollector) {
    this.startHeartbeat();
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: any, connectionId: string): void {
    const connection: WebSocketConnection = {
      id: connectionId,
      ws,
      connectedAt: new Date(),
      lastSeen: new Date(),
      isAlive: true,
    };

    this.connections.set(connectionId, connection);
    this.logger.info(`WebSocket connection opened`, { connectionId });
    this.metrics.recordCounter("websocket.connections.opened");

    // Send connection acknowledgment
    this.sendMessage(connectionId, {
      type: "connection_status",
      payload: {
        connectionId,
        status: "connected",
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Handle WebSocket message
   */
  handleMessage(connectionId: string, message: InterventionMessage): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      this.logger.warn(`Message from unknown connection`, { connectionId });
      return;
    }

    connection.lastSeen = new Date();
    this.logger.debug(`Received message`, { connectionId, type: message.type });
    this.metrics.recordCounter("websocket.messages.received", 1, {
      type: message.type,
    });

    switch (message.type) {
      case "authenticate":
        this.handleAuthentication(connectionId, message);
        break;

      case "track_event":
        this.handleEventTracking(connectionId, message);
        break;

      case "intervention_clicked":
      case "intervention_dismissed":
        this.handleInterventionResponse(connectionId, message);
        break;

      default:
        this.logger.warn(`Unknown message type`, {
          connectionId,
          type: message.type,
        });
    }
  }

  /**
   * Handle user authentication and store assignment
   */
  private handleAuthentication(
    connectionId: string,
    message: InterventionMessage
  ): void {
    const { userId, sessionId, storeId } = message.payload;

    if (!userId || !storeId) {
      this.sendMessage(connectionId, {
        type: "connection_status",
        payload: { status: "error", message: "Missing userId or storeId" },
      });
      return;
    }

    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Update connection with user info
    connection.userId = userId;
    connection.sessionId = sessionId;
    connection.storeId = storeId;

    // Add to store pool
    this.addToStorePool(storeId, connection);

    this.logger.info(`User authenticated`, { connectionId, userId, storeId });
    this.metrics.recordCounter("websocket.users.authenticated", 1, { storeId });

    this.sendMessage(connectionId, {
      type: "connection_status",
      payload: {
        status: "authenticated",
        userId,
        storeId,
        sessionId,
      },
    });
  }

  /**
   * Handle event tracking from client
   */
  private handleEventTracking(
    connectionId: string,
    message: InterventionMessage
  ): void {
    const { event, data } = message.payload;

    this.logger.info(`Event tracked`, { connectionId, event, data });
    this.metrics.recordCounter("intervention.events.tracked", 1, {
      event: event || "unknown",
    });

    // Acknowledge event receipt
    this.sendMessage(connectionId, {
      type: "track_event",
      payload: {
        status: "received",
        event,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Handle intervention response (clicked/dismissed)
   */
  private handleInterventionResponse(
    connectionId: string,
    message: InterventionMessage
  ): void {
    const { interventionId, campaignId } = message.payload;

    this.logger.info(`Intervention response`, {
      connectionId,
      interventionId,
      campaignId,
      type: message.type,
    });

    this.metrics.recordCounter("intervention.responses", 1, {
      type: message.type,
      campaignId: campaignId || "unknown",
    });
  }

  /**
   * Handle connection close
   */
  handleDisconnection(
    connectionId: string,
    code?: number,
    reason?: string
  ): void {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    // Remove from store pool
    if (connection.storeId) {
      this.removeFromStorePool(connection.storeId, connectionId);
    }

    this.connections.delete(connectionId);
    this.logger.info(`WebSocket connection closed`, {
      connectionId,
      code,
      reason,
    });
    this.metrics.recordCounter("websocket.connections.closed");
  }

  /**
   * Send message to specific connection
   */
  sendMessage(
    connectionId: string,
    message: Partial<InterventionMessage>
  ): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.isAlive) {
      return false;
    }

    try {
      const fullMessage: InterventionMessage = {
        ...message,
        timestamp: message.timestamp || new Date().toISOString(),
      } as InterventionMessage;

      connection.ws.send(JSON.stringify(fullMessage));
      this.metrics.recordCounter("websocket.messages.sent", 1, {
        type: message.type || "unknown",
      });
      return true;
    } catch (error) {
      this.logger.error(`Failed to send message`, error as Error);
      this.metrics.recordCounter("websocket.messages.failed");
      this.markConnectionDead(connectionId);
      return false;
    }
  }

  /**
   * Send message to all connections for a user
   */
  sendToUser(
    storeId: string,
    userId: string,
    message: Partial<InterventionMessage>
  ): number {
    const pool = this.connectionPools.get(storeId);
    if (!pool) return 0;

    const userConnections = pool.userSessions.get(userId);
    if (!userConnections) return 0;

    let sent = 0;
    for (const connectionId of userConnections) {
      if (this.sendMessage(connectionId, message)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Broadcast message to all connections in a store
   */
  broadcastToStore(
    storeId: string,
    message: Partial<InterventionMessage>
  ): number {
    const pool = this.connectionPools.get(storeId);
    if (!pool) return 0;

    let sent = 0;
    for (const [connectionId] of pool.connections) {
      if (this.sendMessage(connectionId, message)) {
        sent++;
      }
    }

    return sent;
  }

  /**
   * Add connection to store pool
   */
  private addToStorePool(
    storeId: string,
    connection: WebSocketConnection
  ): void {
    let pool = this.connectionPools.get(storeId);
    if (!pool) {
      pool = {
        storeId,
        connections: new Map(),
        userSessions: new Map(),
        lastActivity: new Date(),
      };
      this.connectionPools.set(storeId, pool);
    }

    pool.connections.set(connection.id, connection);
    pool.lastActivity = new Date();

    // Track user sessions
    if (connection.userId) {
      if (!pool.userSessions.has(connection.userId)) {
        pool.userSessions.set(connection.userId, new Set());
      }
      pool.userSessions.get(connection.userId)!.add(connection.id);
    }
  }

  /**
   * Remove connection from store pool
   */
  private removeFromStorePool(storeId: string, connectionId: string): void {
    const pool = this.connectionPools.get(storeId);
    if (!pool) return;

    const connection = pool.connections.get(connectionId);
    if (connection) {
      // Remove from user sessions
      if (connection.userId) {
        const userConnections = pool.userSessions.get(connection.userId);
        if (userConnections) {
          userConnections.delete(connectionId);
          if (userConnections.size === 0) {
            pool.userSessions.delete(connection.userId);
          }
        }
      }

      pool.connections.delete(connectionId);

      // Clean up empty pools
      if (pool.connections.size === 0) {
        this.connectionPools.delete(storeId);
      }
    }
  }

  /**
   * Mark connection as dead and clean up
   */
  private markConnectionDead(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.isAlive = false;
      this.handleDisconnection(connectionId);
    }
  }

  /**
   * Start heartbeat to check connection health
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();
      const staleThreshold = 30000; // 30 seconds

      for (const [connectionId, connection] of this.connections) {
        if (now.getTime() - connection.lastSeen.getTime() > staleThreshold) {
          this.logger.debug(`Cleaning up stale connection`, { connectionId });
          this.markConnectionDead(connectionId);
        }
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Get gateway statistics
   */
  getStats() {
    return {
      totalConnections: this.connections.size,
      totalStores: this.connectionPools.size,
      storeStats: Array.from(this.connectionPools.values()).map((pool) => ({
        storeId: pool.storeId,
        connections: pool.connections.size,
        users: pool.userSessions.size,
        lastActivity: pool.lastActivity,
      })),
    };
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all connections
    for (const [connectionId] of this.connections) {
      this.handleDisconnection(connectionId);
    }

    this.connections.clear();
    this.connectionPools.clear();
  }
}
