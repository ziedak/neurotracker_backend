/**
 * WebSocket Authentication Middleware
 * Production-grade WebSocket authentication middleware following AbstractMiddleware patterns
 * Integrates with @libs/auth for comprehensive authentication and authorization
 */
import { type IMetricsCollector } from "@libs/monitoring";
import { BaseWebSocketMiddleware, type WebSocketMiddlewareConfig } from "../base";
import type { WebSocketContext } from "../types";
import { type AuthenticationService, type Action, type Resource } from "@libs/auth";
/**
 * WebSocket authentication middleware configuration interface
 * Extends WebSocketMiddlewareConfig with authentication-specific options
 */
export interface AuthWebSocketMiddlewareConfig extends WebSocketMiddlewareConfig {
    readonly requireAuth?: boolean;
    readonly roles?: readonly string[];
    readonly permissions?: readonly string[];
    readonly action?: Action;
    readonly resource?: Resource;
    readonly allowAnonymous?: boolean;
    readonly skipAuthMessageTypes?: readonly string[];
    readonly closeOnAuthFailure?: boolean;
    readonly apiKeyAuth?: boolean;
    readonly jwtAuth?: boolean;
    readonly sessionAuth?: boolean;
    readonly strictMode?: boolean;
    readonly extractUserInfo?: boolean;
    readonly messagePermissions?: Record<string, readonly string[]>;
    readonly messageRoles?: Record<string, readonly string[]>;
    readonly messageActions?: Record<string, {
        action: Action;
        resource: Resource;
    }>;
    readonly authenticationTimeout?: number;
    readonly reauthenticationInterval?: number;
    readonly allowUnauthenticatedTypes?: readonly string[];
    readonly enableCleanupTimer?: boolean;
}
/**
 * Production-grade WebSocket Authentication Middleware
 * Framework-agnostic implementation with comprehensive authentication support
 *
 * Features:
 * - JWT token authentication via message payload or headers
 * - API key authentication via message headers
 * - Session-based authentication via connection metadata
 * - Role-based access control (RBAC) per message type
 * - Permission-based access control per message type
 * - CASL ability-based authorization per message type
 * - Connection-level authentication with persistent sessions
 * - Message-level authorization with fine-grained control
 * - Authentication timeout and reauthentication
 * - Comprehensive error handling with connection management
 * - Metrics and monitoring integration
 * - Message type-based authentication bypass
 *
 * @template AuthWebSocketMiddlewareConfig - WebSocket authentication-specific configuration
 */
export declare class AuthWebSocketMiddleware extends BaseWebSocketMiddleware<AuthWebSocketMiddlewareConfig> {
    private readonly authService;
    private readonly authenticatedConnections;
    private readonly scheduler;
    private static readonly CLEANUP_TIMER_KEY;
    constructor(metrics: IMetricsCollector, authService: AuthenticationService, config?: Partial<AuthWebSocketMiddlewareConfig>);
    /**
     * Core WebSocket authentication middleware execution logic
     * Handles connection-level and message-level authentication and authorization
     */
    protected execute(context: WebSocketContext, next: () => Promise<void>): Promise<void>;
    /**
     * Authenticate WebSocket connection using multiple methods
     */
    private authenticateConnection;
    /**
     * Perform authentication using multiple methods
     */
    private performAuthentication;
    /**
     * Try JWT token authentication from message payload or connection metadata
     */
    private tryJWTAuthentication;
    /**
     * Try API key authentication from message headers or connection metadata
     */
    private tryApiKeyAuthentication;
    /**
     * Try session-based authentication from connection metadata
     */
    private trySessionAuthentication;
    /**
     * Perform message-level authorization checks
     */
    private authorizeMessage;
    /**
     * Enrich context with authentication information
     */
    private enrichContext;
    /**
     * Extract session ID from various sources in WebSocket context
     */
    private extractSessionId;
    /**
     * Check if existing authentication is still valid
     */
    private isAuthenticationValid;
    /**
     * Handle authentication failures
     */
    private handleAuthenticationFailure;
    /**
     * Generate unique request ID for WebSocket messages
     */
    private generateRequestId;
    /**
     * Record authentication-specific metrics
     */
    private recordAuthMetrics;
    /**
     * Start cleanup timer for expired connections
     */
    private startCleanupTimer;
    /**
     * Clean up expired authenticated connections
     */
    private cleanupExpiredConnections;
    /**
     * Validate configuration on instantiation
     */
    private validateConfiguration;
    /**
     * Get authentication statistics
     */
    getAuthenticationStats(): {
        totalConnections: number;
        authenticatedConnections: number;
        authenticationMethods: Record<string, number>;
    };
    /**
     * Manually invalidate authentication for a connection
     */
    invalidateConnection(connectionId: string): boolean;
    /**
     * Cleanup middleware resources - prevents memory leaks
     */
    cleanup(): void;
    /**
     * Create require authentication configuration preset
     */
    static createRequireAuthConfig(): Partial<AuthWebSocketMiddlewareConfig>;
    /**
     * Create optional authentication configuration preset
     */
    static createOptionalAuthConfig(): Partial<AuthWebSocketMiddlewareConfig>;
    /**
     * Create role-based authentication configuration preset
     */
    static createRoleBasedConfig(roles: string[]): Partial<AuthWebSocketMiddlewareConfig>;
    /**
     * Create message-specific permission configuration preset
     */
    static createMessagePermissionConfig(messagePermissions: Record<string, readonly string[]>): Partial<AuthWebSocketMiddlewareConfig>;
}
/**
 * Factory function for WebSocket authentication middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export declare function createAuthWebSocketMiddleware(metrics: IMetricsCollector, authService: AuthenticationService, config?: Partial<AuthWebSocketMiddlewareConfig>): AuthWebSocketMiddleware;
/**
 * Preset configurations for common WebSocket authentication scenarios
 * Immutable configuration objects for different environments and use cases
 */
export declare const WS_AUTH_PRESETS: {
    readonly requireAuth: () => Partial<AuthWebSocketMiddlewareConfig>;
    readonly optionalAuth: () => Partial<AuthWebSocketMiddlewareConfig>;
    readonly adminOnly: () => Partial<AuthWebSocketMiddlewareConfig>;
    readonly userOrAdmin: () => Partial<AuthWebSocketMiddlewareConfig>;
    readonly realtimeChat: () => Partial<AuthWebSocketMiddlewareConfig>;
    readonly apiAccess: () => Partial<AuthWebSocketMiddlewareConfig>;
    readonly development: () => Partial<AuthWebSocketMiddlewareConfig>;
    readonly production: () => Partial<AuthWebSocketMiddlewareConfig>;
};
//# sourceMappingURL=auth.websocket.middleware.d.ts.map