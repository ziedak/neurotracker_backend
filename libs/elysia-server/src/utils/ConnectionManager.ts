/**
 * Production-Ready Connection Manager with LRU Cache
 *
 * Features:
 * - LRU cache for memory management
 * - Leverages @libs/utils for scheduling, logging, and object pooling
 * - Connection lifecycle management
 * - Metrics and monitoring
 * - Memory leak prevention
 */

import { LRUCache } from "lru-cache";
import { EventEmitter } from "events";
import {
  createLogger,
  ILogger,
  Scheduler,
  IScheduler,
  ObjectPool,
  ObjectPoolFactories,
  ObjectPoolResetters,
  generateId,
} from "@libs/utils";
import {
  WebSocketConnection,
  ConnectionMetadata,
} from "../types/validation.types";

export interface Connection {
  readonly id: string;
  readonly socket: WebSocketConnection;
  readonly userId: string | undefined;
  readonly sessionId: string;
  readonly connectedAt: number;
  lastActivity: number;
  readonly remoteAddress: string | undefined;
  readonly userAgent: string | undefined;
  readonly rooms: Set<string>;
  readonly metadata: ConnectionMetadata;
  isAuthenticated: boolean;
  permissions: string[];
  messageCount: number;
  bytesReceived: number;
  bytesSent: number;
}

export interface ConnectionManagerConfig {
  maxConnections: number;
  connectionTtl: number; // TTL in milliseconds
  cleanupInterval: number;
  heartbeatInterval: number;
  roomTtl: number;
  enableMetrics: boolean;
}

export interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  connectionsByUser: number;
  roomCount: number;
  bytesTransferred: number;
  messagesProcessed: number;
  connectionsCreated: number;
  connectionsDropped: number;
  memoryUsage: {
    connections: number;
    rooms: number;
    userMappings: number;
  };
}

export class ConnectionManager extends EventEmitter {
  private readonly connections: LRUCache<string, Connection>;
  private readonly userConnections: LRUCache<string, Set<string>>;
  private readonly rooms: LRUCache<string, Set<string>>;
  private readonly logger: ILogger;
  private readonly scheduler: IScheduler;
  private readonly config: ConnectionManagerConfig;

  // Object pools for memory efficiency
  private readonly stringSetPool: ObjectPool<Set<string>>;
  private readonly metadataPool: ObjectPool<ConnectionMetadata>;

  // Metrics
  private readonly metrics: ConnectionMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    connectionsByUser: 0,
    roomCount: 0,
    bytesTransferred: 0,
    messagesProcessed: 0,
    connectionsCreated: 0,
    connectionsDropped: 0,
    memoryUsage: {
      connections: 0,
      rooms: 0,
      userMappings: 0,
    },
  };

  constructor(config: Partial<ConnectionManagerConfig> = {}) {
    super();

    this.config = {
      maxConnections: 10000,
      connectionTtl: 30 * 60 * 1000, // 30 minutes
      cleanupInterval: 5 * 60 * 1000, // 5 minutes
      heartbeatInterval: 30 * 1000, // 30 seconds
      roomTtl: 60 * 60 * 1000, // 1 hour
      enableMetrics: true,
      ...config,
    };

    this.logger = createLogger("ConnectionManager");
    this.scheduler = new Scheduler();

    // Initialize LRU caches
    this.connections = new LRUCache<string, Connection>({
      max: this.config.maxConnections,
      ttl: this.config.connectionTtl,
      updateAgeOnGet: true,
      dispose: (connection: Connection): void => {
        this.handleConnectionDisposal(connection);
      },
    });

    this.userConnections = new LRUCache<string, Set<string>>({
      max: Math.floor(this.config.maxConnections / 2), // Assume 2 connections per user on average
      ttl: this.config.connectionTtl,
      dispose: (connectionSet: Set<string>, userId: string): void => {
        this.handleUserConnectionsDisposal(connectionSet, userId);
      },
    });

    this.rooms = new LRUCache<string, Set<string>>({
      max: 1000, // Max 1000 rooms
      ttl: this.config.roomTtl,
      dispose: (memberSet: Set<string>, roomId: string): void => {
        this.handleRoomDisposal(memberSet, roomId);
      },
    });

    // Initialize object pools
    this.stringSetPool = new ObjectPool(
      ObjectPoolFactories.stringSet,
      ObjectPoolResetters.set,
      100 // Pool size for reusing Set objects
    );

    this.metadataPool = new ObjectPool(
      () => ({}),
      (obj: ConnectionMetadata) => {
        Object.keys(obj).forEach(
          (key) => delete obj[key as keyof ConnectionMetadata]
        );
      },
      50 // Pool size for metadata objects
    );

    this.setupScheduledTasks();
    this.logger.info("ConnectionManager initialized", {
      maxConnections: this.config.maxConnections,
      connectionTtl: this.config.connectionTtl,
      cleanupInterval: this.config.cleanupInterval,
    });
  }

  /**
   * Add a new connection with automatic memory management
   */
  public addConnection(
    socket: WebSocketConnection,
    userId?: string,
    sessionId?: string,
    metadata: ConnectionMetadata = {}
  ): Connection {
    const connectionId = generateId("conn");
    const now = Date.now();

    // Get pooled objects for efficiency
    const rooms = this.stringSetPool.acquire();
    const connectionMetadata = this.metadataPool.acquire();
    Object.assign(connectionMetadata, metadata);

    const connection: Connection = {
      id: connectionId,
      socket,
      userId,
      sessionId: sessionId ?? generateId("session"),
      connectedAt: now,
      lastActivity: now,
      remoteAddress: socket?.remoteAddress ?? undefined,
      userAgent: metadata["userAgent"] ?? undefined,
      rooms,
      metadata: connectionMetadata,
      isAuthenticated: false,
      permissions: [],
      messageCount: 0,
      bytesReceived: 0,
      bytesSent: 0,
    };

    // Add to connections cache
    this.connections.set(connectionId, connection);

    // Track user connections if userId provided
    if (userId) {
      let userConns = this.userConnections.get(userId);
      if (!userConns) {
        userConns = this.stringSetPool.acquire();
        this.userConnections.set(userId, userConns);
      }
      userConns.add(connectionId);
    }

    // Update metrics
    this.metrics.connectionsCreated++;
    this.metrics.activeConnections = this.connections.size;
    this.metrics.connectionsByUser = this.userConnections.size;
    this.updateMemoryMetrics();

    this.emit("connection:added", connection);
    this.logger.debug("Connection added", {
      connectionId,
      userId,
      totalConnections: this.connections.size,
    });

    return connection;
  }

  /**
   * Remove a connection and clean up resources
   */
  public removeConnection(connectionId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }

    // Remove from user connections
    if (connection.userId) {
      const userConns = this.userConnections.get(connection.userId);
      if (userConns) {
        userConns.delete(connectionId);
        if (userConns.size === 0) {
          this.userConnections.delete(connection.userId);
          // Return the empty set to the pool
          this.stringSetPool.release(userConns);
        }
      }
    }

    // Remove from all rooms
    for (const roomId of connection.rooms) {
      this.leaveRoom(connectionId, roomId);
    }

    // Remove from connections cache (this will trigger disposal)
    this.connections.delete(connectionId);

    this.metrics.connectionsDropped++;
    this.metrics.activeConnections = this.connections.size;
    this.updateMemoryMetrics();

    this.emit("connection:removed", connection);
    this.logger.debug("Connection removed", {
      connectionId,
      userId: connection.userId,
      totalConnections: this.connections.size,
    });

    return true;
  }

  /**
   * Update connection activity timestamp
   */
  public updateActivity(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastActivity = Date.now();
      // Re-set to update LRU position
      this.connections.set(connectionId, connection);
    }
  }

  /**
   * Join a connection to a room
   */
  public joinRoom(connectionId: string, roomId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }

    // Add to connection's rooms
    connection.rooms.add(roomId);

    // Add to room's members
    let roomMembers = this.rooms.get(roomId);
    if (!roomMembers) {
      roomMembers = this.stringSetPool.acquire();
      this.rooms.set(roomId, roomMembers);
    }
    roomMembers.add(connectionId);

    this.metrics.roomCount = this.rooms.size;
    this.updateMemoryMetrics();

    this.emit("room:joined", { connectionId, roomId });
    this.logger.debug("Connection joined room", { connectionId, roomId });

    return true;
  }

  /**
   * Remove a connection from a room
   */
  public leaveRoom(connectionId: string, roomId: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return false;
    }

    // Remove from connection's rooms
    connection.rooms.delete(roomId);

    // Remove from room's members
    const roomMembers = this.rooms.get(roomId);
    if (roomMembers) {
      roomMembers.delete(connectionId);
      if (roomMembers.size === 0) {
        this.rooms.delete(roomId);
        // Return empty set to pool
        this.stringSetPool.release(roomMembers);
      }
    }

    this.metrics.roomCount = this.rooms.size;
    this.updateMemoryMetrics();

    this.emit("room:left", { connectionId, roomId });
    this.logger.debug("Connection left room", { connectionId, roomId });

    return true;
  }

  /**
   * Get connection by ID
   */
  public getConnection(connectionId: string): Connection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Get all connections for a user
   */
  public getUserConnections(userId: string): Connection[] {
    const connectionIds = this.userConnections.get(userId);
    if (!connectionIds) {
      return [];
    }

    return Array.from(connectionIds)
      .map((id) => this.connections.get(id))
      .filter((conn): conn is Connection => conn !== undefined);
  }

  /**
   * Get all members of a room
   */
  public getRoomMembers(roomId: string): Connection[] {
    const memberIds = this.rooms.get(roomId);
    if (!memberIds) {
      return [];
    }

    return Array.from(memberIds)
      .map((id) => this.connections.get(id))
      .filter((conn): conn is Connection => conn !== undefined);
  }

  /**
   * Get comprehensive metrics
   */
  public getMetrics(): ConnectionMetrics {
    this.updateMemoryMetrics();
    return { ...this.metrics };
  }

  /**
   * Graceful shutdown with connection cleanup
   */
  public async shutdown(): Promise<void> {
    this.logger.info("Starting connection manager shutdown");

    // Clear all scheduled tasks
    this.scheduler.clearAll();

    // Notify all connections of shutdown
    for (const [, connection] of this.connections.entries()) {
      try {
        // Send graceful disconnect message
        if (connection.socket && typeof connection.socket.send === "function") {
          connection.socket.send(
            JSON.stringify({
              type: "server_shutdown",
              message: "Server is shutting down gracefully",
            })
          );
        }
      } catch (error) {
        this.logger.warn("Failed to send shutdown message", error as Error);
      }
    }

    // Wait a bit for messages to be sent
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Clear all caches (this will trigger disposal callbacks)
    this.connections.clear();
    this.userConnections.clear();
    this.rooms.clear();

    // Clear object pools
    this.stringSetPool.clear();
    this.metadataPool.clear();

    this.logger.info("Connection manager shutdown complete");
  }

  /**
   * Setup scheduled maintenance tasks
   */
  private setupScheduledTasks(): void {
    // Cleanup stale connections
    this.scheduler.setInterval(
      "cleanup-stale-connections",
      this.config.cleanupInterval,
      () => this.cleanupStaleConnections()
    );

    // Heartbeat check
    this.scheduler.setInterval(
      "heartbeat-check",
      this.config.heartbeatInterval,
      () => this.performHeartbeatCheck()
    );

    // Metrics update
    if (this.config.enableMetrics) {
      this.scheduler.setInterval(
        "metrics-update",
        60000, // Every minute
        () => this.updateMetrics()
      );
    }
  }

  /**
   * Clean up stale connections based on last activity
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleThreshold = this.config.connectionTtl;
    let cleanedCount = 0;

    for (const [connectionId, connection] of this.connections.entries()) {
      if (now - connection.lastActivity > staleThreshold) {
        this.removeConnection(connectionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info("Cleaned up stale connections", {
        cleanedCount,
        remainingConnections: this.connections.size,
      });
    }
  }

  /**
   * Perform heartbeat check on connections
   */
  private performHeartbeatCheck(): void {
    // This could ping connections or check their health
    // Implementation depends on the WebSocket library used
    this.emit("heartbeat:check", {
      activeConnections: this.connections.size,
      timestamp: Date.now(),
    });
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    this.metrics.activeConnections = this.connections.size;
    this.metrics.connectionsByUser = this.userConnections.size;
    this.metrics.roomCount = this.rooms.size;
    this.updateMemoryMetrics();

    this.emit("metrics:updated", this.metrics);
  }

  /**
   * Update memory usage metrics
   */
  private updateMemoryMetrics(): void {
    this.metrics.memoryUsage = {
      connections: this.connections.size,
      rooms: this.rooms.size,
      userMappings: this.userConnections.size,
    };
  }

  /**
   * Handle connection disposal from LRU cache
   */
  private handleConnectionDisposal(connection: Connection): void {
    // Return pooled objects
    this.stringSetPool.release(connection.rooms);
    this.metadataPool.release(connection.metadata);

    this.emit("connection:disposed", connection);
    this.logger.debug("Connection disposed by LRU cache", {
      connectionId: connection.id,
      userId: connection.userId,
    });
  }

  /**
   * Handle user connections disposal
   */
  private handleUserConnectionsDisposal(
    connectionSet: Set<string>,
    userId: string
  ): void {
    this.stringSetPool.release(connectionSet);
    this.logger.debug("User connections disposed by LRU cache", { userId });
  }

  /**
   * Handle room disposal
   */
  private handleRoomDisposal(memberSet: Set<string>, roomId: string): void {
    this.stringSetPool.release(memberSet);
    this.emit("room:disposed", roomId);
    this.logger.debug("Room disposed by LRU cache", { roomId });
  }
}
