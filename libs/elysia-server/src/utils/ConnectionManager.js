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
import { createLogger, Scheduler, ObjectPool, ObjectPoolFactories, ObjectPoolResetters, generateId, } from "@libs/utils";
export class ConnectionManager extends EventEmitter {
    connections;
    userConnections;
    rooms;
    logger;
    scheduler;
    config;
    // Object pools for memory efficiency
    stringSetPool;
    metadataPool;
    // Metrics
    metrics = {
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
    constructor(config = {}) {
        super();
        // Set max listeners to prevent memory leak warnings
        this.setMaxListeners(50);
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
        this.connections = new LRUCache({
            max: this.config.maxConnections,
            ttl: this.config.connectionTtl,
            updateAgeOnGet: true,
            dispose: (connection) => {
                this.handleConnectionDisposal(connection);
            },
        });
        this.userConnections = new LRUCache({
            max: Math.floor(this.config.maxConnections / 2), // Assume 2 connections per user on average
            ttl: this.config.connectionTtl,
            dispose: (connectionSet, userId) => {
                this.handleUserConnectionsDisposal(connectionSet, userId);
            },
        });
        this.rooms = new LRUCache({
            max: 1000, // Max 1000 rooms
            ttl: this.config.roomTtl,
            dispose: (memberSet, roomId) => {
                this.handleRoomDisposal(memberSet, roomId);
            },
        });
        // Initialize object pools
        this.stringSetPool = new ObjectPool(ObjectPoolFactories.stringSet, ObjectPoolResetters.set, 100 // Pool size for reusing Set objects
        );
        this.metadataPool = new ObjectPool(() => ({}), (obj) => {
            Object.keys(obj).forEach((key) => delete obj[key]);
        }, 50 // Pool size for metadata objects
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
    addConnection(socket, userId, sessionId, metadata = {}) {
        const connectionId = generateId("conn");
        const now = Date.now();
        // Get pooled objects for efficiency
        const rooms = this.stringSetPool.acquire();
        const connectionMetadata = this.metadataPool.acquire();
        Object.assign(connectionMetadata, metadata);
        const connection = {
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
        this.metrics.totalConnections++;
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
    removeConnection(connectionId) {
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
                    userConns.clear();
                    this.stringSetPool.release(userConns);
                }
            }
        }
        // Remove from all rooms
        for (const roomId of connection.rooms) {
            this.leaveRoom(connectionId, roomId);
        }
        // Cleanup connection resources before cache removal
        this.cleanupConnectionResources(connection);
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
     * Clean up connection resources to prevent memory leaks
     */
    cleanupConnectionResources(connection) {
        try {
            // Close WebSocket connection safely
            if (connection.socket) {
                if (typeof connection.socket.close === "function") {
                    connection.socket.close(1000, "Connection removed");
                }
                // Remove any event listeners if the socket has them
                if ("removeAllListeners" in connection.socket &&
                    typeof connection.socket["removeAllListeners"] === "function") {
                    try {
                        connection.socket["removeAllListeners"]();
                    }
                    catch (listenerError) {
                        this.logger.debug("Could not remove socket listeners", listenerError);
                    }
                }
            }
            // Clear arrays and sets to prevent references
            connection.permissions.length = 0;
            connection.rooms.clear();
            // Mark connection as cleaned up
            Object.defineProperty(connection, "cleaned", {
                value: true,
                writable: false,
            });
        }
        catch (error) {
            this.logger.error("Error cleaning up connection resources", error, {
                connectionId: connection.id,
            });
        }
    }
    /**
     * Update connection activity timestamp
     */
    updateActivity(connectionId) {
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
    joinRoom(connectionId, roomId) {
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
    leaveRoom(connectionId, roomId) {
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
    getConnection(connectionId) {
        return this.connections.get(connectionId);
    }
    /**
     * Get all connections for a user
     */
    getUserConnections(userId) {
        const connectionIds = this.userConnections.get(userId);
        if (!connectionIds) {
            return [];
        }
        return Array.from(connectionIds)
            .map((id) => this.connections.get(id))
            .filter((conn) => conn !== undefined);
    }
    /**
     * Get all members of a room
     */
    getRoomMembers(roomId) {
        const memberIds = this.rooms.get(roomId);
        if (!memberIds) {
            return [];
        }
        return Array.from(memberIds)
            .map((id) => this.connections.get(id))
            .filter((conn) => conn !== undefined);
    }
    /**
     * Get comprehensive metrics
     */
    getMetrics() {
        this.updateMemoryMetrics();
        return { ...this.metrics };
    }
    /**
     * Graceful shutdown with connection cleanup
     */
    async shutdown() {
        this.logger.info("Starting connection manager shutdown");
        // Clear all scheduled tasks
        this.scheduler.clearAll();
        // Notify all connections of shutdown
        for (const [, connection] of this.connections.entries()) {
            try {
                // Send graceful disconnect message
                if (connection.socket && typeof connection.socket.send === "function") {
                    connection.socket.send(JSON.stringify({
                        type: "server_shutdown",
                        message: "Server is shutting down gracefully",
                    }));
                }
            }
            catch (error) {
                this.logger.warn("Failed to send shutdown message", error);
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
        // Reset metrics after shutdown
        this.metrics.activeConnections = 0;
        this.metrics.connectionsByUser = 0;
        this.metrics.roomCount = 0;
        this.updateMemoryMetrics();
        this.logger.info("Connection manager shutdown complete");
    }
    /**
     * Setup scheduled maintenance tasks
     */
    setupScheduledTasks() {
        // Cleanup stale connections
        this.scheduler.setInterval("cleanup-stale-connections", this.config.cleanupInterval, () => this.cleanupStaleConnections());
        // Heartbeat check
        this.scheduler.setInterval("heartbeat-check", this.config.heartbeatInterval, () => this.performHeartbeatCheck());
        // Metrics update
        if (this.config.enableMetrics) {
            this.scheduler.setInterval("metrics-update", 60000, // Every minute
            () => this.updateMetrics());
        }
    }
    /**
     * Clean up stale connections based on last activity
     */
    cleanupStaleConnections() {
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
    performHeartbeatCheck() {
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
    updateMetrics() {
        this.metrics.activeConnections = this.connections.size;
        this.metrics.connectionsByUser = this.userConnections.size;
        this.metrics.roomCount = this.rooms.size;
        this.updateMemoryMetrics();
        this.emit("metrics:updated", this.metrics);
    }
    /**
     * Update memory usage metrics
     */
    updateMemoryMetrics() {
        this.metrics.memoryUsage = {
            connections: this.connections.size,
            rooms: this.rooms.size,
            userMappings: this.userConnections.size,
        };
    }
    /**
     * Handle connection disposal from LRU cache
     */
    handleConnectionDisposal(connection) {
        try {
            // Safely close WebSocket connection
            if (connection.socket && typeof connection.socket.close === "function") {
                try {
                    connection.socket.close(1000, "Connection disposed by cache");
                }
                catch (closeError) {
                    this.logger.warn("Error closing WebSocket during disposal", closeError);
                }
            }
            // Clear circular references
            if (connection.rooms) {
                connection.rooms.clear();
                this.stringSetPool.release(connection.rooms);
            }
            if (connection.metadata) {
                // Clear all properties to break potential circular references
                Object.keys(connection.metadata).forEach((key) => {
                    delete connection.metadata[key];
                });
                this.metadataPool.release(connection.metadata);
            }
            // Clear permissions array
            connection.permissions.length = 0;
            this.emit("connection:disposed", connection);
            this.logger.debug("Connection disposed by LRU cache", {
                connectionId: connection.id,
                userId: connection.userId,
            });
        }
        catch (error) {
            this.logger.error("Error during connection disposal", error, {
                connectionId: connection.id,
            });
        }
    }
    /**
     * Handle user connections disposal
     */
    handleUserConnectionsDisposal(connectionSet, userId) {
        try {
            connectionSet.clear();
            this.stringSetPool.release(connectionSet);
            this.logger.debug("User connections disposed by LRU cache", { userId });
        }
        catch (error) {
            this.logger.error("Error during user connections disposal", error, { userId });
        }
    }
    /**
     * Handle room disposal
     */
    handleRoomDisposal(memberSet, roomId) {
        try {
            memberSet.clear();
            this.stringSetPool.release(memberSet);
            this.emit("room:disposed", roomId);
            this.logger.debug("Room disposed by LRU cache", { roomId });
        }
        catch (error) {
            this.logger.error("Error during room disposal", error, {
                roomId,
            });
        }
    }
}
//# sourceMappingURL=ConnectionManager.js.map