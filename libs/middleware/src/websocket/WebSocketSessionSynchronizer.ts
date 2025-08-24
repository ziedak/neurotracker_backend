/**
 * WebSocket Session Synchronizer
 * Handles real-time session synchronization between HTTP and WebSocket protocols
 */

import { Logger, MetricsCollector } from "@libs/monitoring";
import { RedisClient } from "@libs/database";
import {
  type EnterpriseSessionData as SessionData,
  type SessionUpdateData,
} from "@libs/auth";

/**
 * Session update event for real-time synchronization
 */
export interface SessionUpdateEvent {
  sessionId: string;
  userId: string;
  updates: SessionUpdateData;
  source: "http" | "websocket";
  timestamp: Date;
  connectionId?: string | undefined;
}

/**
 * Session synchronization events
 */
export interface SessionSyncEvents {
  "session:updated": SessionUpdateEvent;
  "session:created": { session: SessionData; source: "http" | "websocket" };
  "session:deleted": {
    sessionId: string;
    userId: string;
    source: "http" | "websocket";
  };
  "session:expired": { sessionId: string; userId: string };
}

/**
 * WebSocket connection registry for tracking active connections
 */
export interface WebSocketConnection {
  connectionId: string;
  sessionId?: string;
  userId?: string;
  connectedAt: Date;
  lastActivity: Date;
  send: (data: any) => void;
  close: (code?: number, reason?: string) => void;
}

/**
 * Cross-protocol session synchronizer using Redis pub/sub
 */
export class WebSocketSessionSynchronizer {
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly redis: any; // ioredis Redis instance
  private readonly subscriber: any; // Separate subscriber instance
  private readonly connections: Map<string, WebSocketConnection> = new Map();
  private readonly sessionToConnections: Map<string, Set<string>> = new Map();

  private readonly SESSION_UPDATE_CHANNEL = "session:updates";
  private readonly SESSION_CREATE_CHANNEL = "session:created";
  private readonly SESSION_DELETE_CHANNEL = "session:deleted";
  private readonly SESSION_EXPIRE_CHANNEL = "session:expired";

  constructor(logger: Logger, metrics: MetricsCollector, redis?: any) {
    this.logger = logger.child({ component: "WebSocketSessionSynchronizer" });
    this.metrics = metrics;
    this.redis = redis || RedisClient.getInstance();

    // Create separate subscriber connection (ioredis best practice)
    this.subscriber = this.redis.duplicate();

    this.setupRedisSubscriptions();
  }

  /**
   * Register a WebSocket connection
   */
  registerConnection(connection: WebSocketConnection): void {
    this.connections.set(connection.connectionId, connection);

    if (connection.sessionId) {
      this.linkConnectionToSession(
        connection.connectionId,
        connection.sessionId
      );
    }

    this.logger.debug("WebSocket connection registered", {
      connectionId: connection.connectionId,
      sessionId: connection.sessionId,
      userId: connection.userId,
    });

    this.recordMetric("websocket_connection_registered");
  }

  /**
   * Unregister a WebSocket connection
   */
  unregisterConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);

    if (connection?.sessionId) {
      this.unlinkConnectionFromSession(connectionId, connection.sessionId);
    }

    this.connections.delete(connectionId);

    this.logger.debug("WebSocket connection unregistered", {
      connectionId,
      sessionId: connection?.sessionId,
      userId: connection?.userId,
    });

    this.recordMetric("websocket_connection_unregistered");
  }

  /**
   * Link a connection to a session
   */
  linkConnectionToSession(connectionId: string, sessionId: string): void {
    if (!this.sessionToConnections.has(sessionId)) {
      this.sessionToConnections.set(sessionId, new Set());
    }

    this.sessionToConnections.get(sessionId)!.add(connectionId);

    // Update the connection record
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.sessionId = sessionId;
    }

    this.logger.debug("Connection linked to session", {
      connectionId,
      sessionId,
    });
  }

  /**
   * Unlink a connection from its session
   */
  unlinkConnectionFromSession(connectionId: string, sessionId: string): void {
    const connections = this.sessionToConnections.get(sessionId);
    if (connections) {
      connections.delete(connectionId);

      if (connections.size === 0) {
        this.sessionToConnections.delete(sessionId);
      }
    }

    this.logger.debug("Connection unlinked from session", {
      connectionId,
      sessionId,
    });
  }

  /**
   * Publish session update event
   */
  async publishSessionUpdate(
    sessionId: string,
    userId: string,
    updates: SessionUpdateData,
    source: "http" | "websocket",
    connectionId?: string
  ): Promise<void> {
    const event: SessionUpdateEvent = {
      sessionId,
      userId,
      updates,
      source,
      timestamp: new Date(),
      connectionId,
    };

    try {
      await this.redis.publish(
        this.SESSION_UPDATE_CHANNEL,
        JSON.stringify(event)
      );

      this.logger.debug("Session update published", {
        sessionId,
        userId,
        source,
        updates: Object.keys(updates),
      });

      await this.recordMetric("session_update_published");
    } catch (error) {
      this.logger.error("Failed to publish session update", error as Error, {
        sessionId,
        userId,
        source,
      });

      await this.recordMetric("session_update_publish_error");
      throw error;
    }
  }

  /**
   * Publish session creation event
   */
  async publishSessionCreated(
    session: SessionData,
    source: "http" | "websocket"
  ): Promise<void> {
    const event = { session, source };

    try {
      await this.redis.publish(
        this.SESSION_CREATE_CHANNEL,
        JSON.stringify(event)
      );

      this.logger.debug("Session creation published", {
        sessionId: session.sessionId,
        userId: session.userId,
        source,
        protocol: session.protocol,
      });

      await this.recordMetric("session_create_published");
    } catch (error) {
      this.logger.error("Failed to publish session creation", error as Error, {
        sessionId: session.sessionId,
        userId: session.userId,
        source,
      });

      await this.recordMetric("session_create_publish_error");
      throw error;
    }
  }

  /**
   * Publish session deletion event
   */
  async publishSessionDeleted(
    sessionId: string,
    userId: string,
    source: "http" | "websocket"
  ): Promise<void> {
    const event = { sessionId, userId, source };

    try {
      await this.redis.publish(
        this.SESSION_DELETE_CHANNEL,
        JSON.stringify(event)
      );

      this.logger.debug("Session deletion published", {
        sessionId,
        userId,
        source,
      });

      await this.recordMetric("session_delete_published");
    } catch (error) {
      this.logger.error("Failed to publish session deletion", error as Error, {
        sessionId,
        userId,
        source,
      });

      await this.recordMetric("session_delete_publish_error");
      throw error;
    }
  }

  /**
   * Get active connections for a session
   */
  getSessionConnections(sessionId: string): WebSocketConnection[] {
    const connectionIds = this.sessionToConnections.get(sessionId);
    if (!connectionIds) {
      return [];
    }

    return Array.from(connectionIds)
      .map((id) => this.connections.get(id))
      .filter((conn): conn is WebSocketConnection => conn !== undefined);
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    totalConnections: number;
    connectionsWithSessions: number;
    uniqueSessions: number;
  } {
    const connectionsWithSessions = Array.from(
      this.connections.values()
    ).filter((conn) => conn.sessionId).length;

    return {
      totalConnections: this.connections.size,
      connectionsWithSessions,
      uniqueSessions: this.sessionToConnections.size,
    };
  }

  /**
   * Setup Redis pub/sub subscriptions
   */
  private setupRedisSubscriptions(): void {
    // Subscribe to all channels
    this.subscriber.subscribe(
      this.SESSION_UPDATE_CHANNEL,
      this.SESSION_CREATE_CHANNEL,
      this.SESSION_DELETE_CHANNEL,
      this.SESSION_EXPIRE_CHANNEL
    );

    // Handle messages from all channels
    this.subscriber.on("message", (channel: string, message: string) => {
      try {
        const data = JSON.parse(message);

        switch (channel) {
          case this.SESSION_UPDATE_CHANNEL:
            this.handleSessionUpdateEvent(data);
            break;
          case this.SESSION_CREATE_CHANNEL:
            this.handleSessionCreateEvent(data);
            break;
          case this.SESSION_DELETE_CHANNEL:
            this.handleSessionDeleteEvent(data);
            break;
          case this.SESSION_EXPIRE_CHANNEL:
            this.handleSessionExpireEvent(data);
            break;
          default:
            this.logger.warn("Unknown channel message received", { channel });
        }
      } catch (error) {
        this.logger.error(
          "Failed to parse Redis pub/sub message",
          error as Error,
          {
            channel,
            message,
          }
        );
      }
    });

    this.logger.info("Redis pub/sub subscriptions setup complete");
  }

  /**
   * Handle session update events
   */
  private async handleSessionUpdateEvent(
    event: SessionUpdateEvent
  ): Promise<void> {
    try {
      // Don't process events from the same source to avoid loops
      if (event.connectionId) {
        const sourceConnection = this.connections.get(event.connectionId);
        if (sourceConnection) {
          // Skip notifying the connection that initiated the update
          return;
        }
      }

      // Notify all WebSocket connections for this session
      const connections = this.getSessionConnections(event.sessionId);

      for (const connection of connections) {
        // Skip the source connection
        if (connection.connectionId === event.connectionId) {
          continue;
        }

        try {
          connection.send({
            type: "session:updated",
            sessionId: event.sessionId,
            updates: event.updates,
            timestamp: event.timestamp,
          });

          this.logger.debug("Session update sent to WebSocket", {
            connectionId: connection.connectionId,
            sessionId: event.sessionId,
            updates: Object.keys(event.updates),
          });
        } catch (error) {
          this.logger.error(
            "Failed to send session update to WebSocket",
            error as Error,
            {
              connectionId: connection.connectionId,
              sessionId: event.sessionId,
            }
          );
        }
      }

      await this.recordMetric("session_update_processed");
    } catch (error) {
      this.logger.error(
        "Failed to handle session update event",
        error as Error,
        {
          sessionId: event.sessionId,
        }
      );

      await this.recordMetric("session_update_process_error");
    }
  }

  /**
   * Handle session creation events
   */
  private async handleSessionCreateEvent(event: {
    session: SessionData;
    source: "http" | "websocket";
  }): Promise<void> {
    try {
      // For now, we mainly log session creation events
      // Could be extended to notify relevant connections

      this.logger.debug("Session creation event received", {
        sessionId: event.session.sessionId,
        userId: event.session.userId,
        source: event.source,
        protocol: event.session.protocol,
      });

      await this.recordMetric("session_create_processed");
    } catch (error) {
      this.logger.error(
        "Failed to handle session create event",
        error as Error,
        {
          sessionId: event.session.sessionId,
        }
      );

      await this.recordMetric("session_create_process_error");
    }
  }

  /**
   * Handle session deletion events
   */
  private async handleSessionDeleteEvent(event: {
    sessionId: string;
    userId: string;
    source: "http" | "websocket";
  }): Promise<void> {
    try {
      // Notify and close all WebSocket connections for this session
      const connections = this.getSessionConnections(event.sessionId);

      for (const connection of connections) {
        try {
          connection.send({
            type: "session:deleted",
            sessionId: event.sessionId,
            timestamp: new Date(),
          });

          // Close the connection after notification
          setTimeout(() => {
            connection.close(1008, "Session deleted");
          }, 100);

          this.logger.debug("Session deletion sent to WebSocket", {
            connectionId: connection.connectionId,
            sessionId: event.sessionId,
          });
        } catch (error) {
          this.logger.error(
            "Failed to notify WebSocket of session deletion",
            error as Error,
            {
              connectionId: connection.connectionId,
              sessionId: event.sessionId,
            }
          );
        }
      }

      // Clean up session connections mapping
      this.sessionToConnections.delete(event.sessionId);

      await this.recordMetric("session_delete_processed");
    } catch (error) {
      this.logger.error(
        "Failed to handle session delete event",
        error as Error,
        {
          sessionId: event.sessionId,
        }
      );

      await this.recordMetric("session_delete_process_error");
    }
  }

  /**
   * Handle session expiration events
   */
  private async handleSessionExpireEvent(event: {
    sessionId: string;
    userId: string;
  }): Promise<void> {
    try {
      // Similar to session deletion, but with different messaging
      const connections = this.getSessionConnections(event.sessionId);

      for (const connection of connections) {
        try {
          connection.send({
            type: "session:expired",
            sessionId: event.sessionId,
            timestamp: new Date(),
          });

          setTimeout(() => {
            connection.close(1008, "Session expired");
          }, 100);

          this.logger.debug("Session expiration sent to WebSocket", {
            connectionId: connection.connectionId,
            sessionId: event.sessionId,
          });
        } catch (error) {
          this.logger.error(
            "Failed to notify WebSocket of session expiration",
            error as Error,
            {
              connectionId: connection.connectionId,
              sessionId: event.sessionId,
            }
          );
        }
      }

      // Clean up session connections mapping
      this.sessionToConnections.delete(event.sessionId);

      await this.recordMetric("session_expire_processed");
    } catch (error) {
      this.logger.error(
        "Failed to handle session expire event",
        error as Error,
        {
          sessionId: event.sessionId,
        }
      );

      await this.recordMetric("session_expire_process_error");
    }
  }

  /**
   * Record metrics
   */
  private async recordMetric(name: string): Promise<void> {
    try {
      await this.metrics.recordCounter(name);
    } catch (error) {
      // Don't let metric recording errors affect main functionality
      this.logger.warn("Failed to record metric", { name, error });
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      // Unsubscribe from Redis channels
      await this.subscriber.unsubscribe(
        this.SESSION_UPDATE_CHANNEL,
        this.SESSION_CREATE_CHANNEL,
        this.SESSION_DELETE_CHANNEL,
        this.SESSION_EXPIRE_CHANNEL
      );

      // Close subscriber connection
      await this.subscriber.quit();

      // Clear connection maps
      this.connections.clear();
      this.sessionToConnections.clear();

      this.logger.info("WebSocket session synchronizer cleaned up");
    } catch (error) {
      this.logger.error("Error during cleanup", error as Error);
      throw error;
    }
  }
}
