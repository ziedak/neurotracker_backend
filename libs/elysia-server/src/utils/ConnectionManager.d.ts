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
import { EventEmitter } from "events";
import { WebSocketConnection, ConnectionMetadata } from "../types/validation.types";
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
    connectionTtl: number;
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
export declare class ConnectionManager extends EventEmitter {
    private readonly connections;
    private readonly userConnections;
    private readonly rooms;
    private readonly logger;
    private readonly scheduler;
    private readonly config;
    private readonly stringSetPool;
    private readonly metadataPool;
    private readonly metrics;
    constructor(config?: Partial<ConnectionManagerConfig>);
    /**
     * Add a new connection with automatic memory management
     */
    addConnection(socket: WebSocketConnection, userId?: string, sessionId?: string, metadata?: ConnectionMetadata): Connection;
    /**
     * Remove a connection and clean up resources
     */
    removeConnection(connectionId: string): boolean;
    /**
     * Clean up connection resources to prevent memory leaks
     */
    private cleanupConnectionResources;
    /**
     * Update connection activity timestamp
     */
    updateActivity(connectionId: string): void;
    /**
     * Join a connection to a room
     */
    joinRoom(connectionId: string, roomId: string): boolean;
    /**
     * Remove a connection from a room
     */
    leaveRoom(connectionId: string, roomId: string): boolean;
    /**
     * Get connection by ID
     */
    getConnection(connectionId: string): Connection | undefined;
    /**
     * Get all connections for a user
     */
    getUserConnections(userId: string): Connection[];
    /**
     * Get all members of a room
     */
    getRoomMembers(roomId: string): Connection[];
    /**
     * Get comprehensive metrics
     */
    getMetrics(): ConnectionMetrics;
    /**
     * Graceful shutdown with connection cleanup
     */
    shutdown(): Promise<void>;
    /**
     * Setup scheduled maintenance tasks
     */
    private setupScheduledTasks;
    /**
     * Clean up stale connections based on last activity
     */
    private cleanupStaleConnections;
    /**
     * Perform heartbeat check on connections
     */
    private performHeartbeatCheck;
    /**
     * Update metrics
     */
    private updateMetrics;
    /**
     * Update memory usage metrics
     */
    private updateMemoryMetrics;
    /**
     * Handle connection disposal from LRU cache
     */
    private handleConnectionDisposal;
    /**
     * Handle user connections disposal
     */
    private handleUserConnectionsDisposal;
    /**
     * Handle room disposal
     */
    private handleRoomDisposal;
}
//# sourceMappingURL=ConnectionManager.d.ts.map