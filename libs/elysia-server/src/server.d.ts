import { Elysia } from "elysia";
import { type IMetricsCollector } from "@libs/monitoring";
import { ServerConfig } from "./config";
import { type AdvancedMiddlewareConfig } from "./middleware";
/**
 * Advanced Elysia Server Builder with sophisticated middleware chaining
 *
 * Features:
 * - Priority-based middleware execution
 * - Factory patterns for common configurations
 * - WebSocket and HTTP middleware chains
 * - Metrics and monitoring integration
 * - Hot-swappable middleware configuration
 * - Production-ready patterns
 */
export declare class AdvancedElysiaServerBuilder {
    private app?;
    private readonly config;
    private readonly connections;
    private readonly rooms;
    private readonly userConnections;
    private readonly logger;
    private readonly metrics;
    private readonly createdAt;
    private httpChain?;
    private wsChain?;
    private middlewareConfig;
    private securityWebSocketMiddleware?;
    private rateLimitHttpMiddleware?;
    private rateLimitWebSocketMiddleware?;
    constructor(config: Partial<ServerConfig>, metrics: IMetricsCollector, middlewareConfig?: AdvancedMiddlewareConfig);
    /**
     * Initialize middleware chains with configuration
     */
    private initializeMiddlewareChains;
    /**
     * Get WebSocket middleware count
     */
    private getWebSocketMiddlewareCount;
    /**
     * Create HTTP middleware chain with factory patterns or custom configuration
     */
    private createHttpChain;
    /**
     * Create WebSocket middleware chain with factory patterns or custom configuration
     */
    private createWebSocketChain;
    /**
     * Build the advanced Elysia server with middleware chains
     */
    build(): Elysia;
    /**
     * Setup HTTP middleware chain
     */
    private setupHttpMiddleware;
    /**
     * Setup WebSocket with advanced middleware chain
     */
    private setupWebSocketWithMiddleware;
    /**
     * Default WebSocket message handler (called after middleware chain)
     */
    private handleDefaultWebSocketMessage;
    /**
     * Join a room
     */
    private joinRoom;
    /**
     * Leave a room
     */
    private leaveRoom;
    /**
     * Cleanup user connections on disconnect
     */
    private cleanupUserConnection;
    /**
     * Check if security middleware should be enabled
     */
    private shouldEnableSecurityMiddleware;
    /**
     * Create security WebSocket middleware with proper configuration
     */
    private createSecurityWebSocketMiddleware;
    /**
     * Get security middleware priority with fallback
     */
    private getSecurityMiddlewarePriority;
    /**
     * Register security WebSocket middleware in chain
     */
    private registerSecurityWebSocketMiddleware;
    /**
     * Generate unique connection ID
     */
    private generateConnectionId;
    /**
     * Get health status including middleware information
     */
    private getHealthStatus;
    /**
     * Get detailed middleware status
     */
    private getMiddlewareStatus;
    /**
     * Hot-swap middleware configuration
     */
    updateMiddlewareConfig(newConfig: Partial<AdvancedMiddlewareConfig>): void;
    /**
     * Get middleware configuration
     */
    getMiddlewareConfig(): AdvancedMiddlewareConfig | undefined;
    /**
     * Enable/disable specific middleware
     */
    toggleMiddleware(type: "http" | "websocket", name: string, enabled: boolean): boolean;
    /**
     * Get server instance
     */
    getApp(): Elysia | undefined;
    /**
     * Get server configuration
     */
    getConfig(): ServerConfig;
    /**
     * Cleanup method for testing - clears all internal state
     */
    cleanup(): Promise<void>;
}
/**
 * Factory function for creating advanced Elysia server
 */
export declare function createAdvancedElysiaServer(config: Partial<ServerConfig>, metrics: IMetricsCollector, middlewareConfig?: AdvancedMiddlewareConfig): AdvancedElysiaServerBuilder;
/**
 * Convenience function for creating production-ready server
 */
export declare function createProductionServer(config: Partial<ServerConfig>, metrics: IMetricsCollector, customConfig?: Partial<AdvancedMiddlewareConfig>): AdvancedElysiaServerBuilder;
/**
 * Convenience function for creating development server
 */
export declare function createDevelopmentServer(config: Partial<ServerConfig>, metrics: IMetricsCollector, customConfig?: Partial<AdvancedMiddlewareConfig>): AdvancedElysiaServerBuilder;
//# sourceMappingURL=server.d.ts.map