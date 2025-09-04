import { WebSocketContext, WebSocketMiddlewareFunction, WebSocketAuthConfig } from "../../types";
import { BaseWebSocketMiddleware } from "./BaseWebSocketMiddleware";
import { MetricsCollector } from "@libs/monitoring";
import { UnifiedSessionManager, type EnterpriseSessionData as SessionData, SessionAuthMethod, PermissionService } from "@libs/auth";
/**
 * Extended WebSocket context with session data
 */
export interface WebSocketSessionContext extends WebSocketContext {
    session?: SessionData;
    sessionId?: string;
    authMethod?: SessionAuthMethod;
    cachedPermissions?: Map<string, any>;
    resolvedPermissions?: any[];
    userRoles?: string[];
}
export type { WebSocketSessionContext as EnhancedWebSocketContext };
/**
 * Production-grade WebSocket Authentication Middleware with Session Management
 * Integrates with existing auth infrastructure and UnifiedSessionManager for secure WebSocket connections
 */
export declare class WebSocketAuthMiddleware extends BaseWebSocketMiddleware<WebSocketAuthConfig> {
    private readonly jwtService;
    private readonly sessionManager;
    private readonly permissionService;
    constructor(config: WebSocketAuthConfig, sessionManager: UnifiedSessionManager, logger?: ILogger, metrics?: MetricsCollector, permissionService?: PermissionService);
    /**
     * Execute authentication checks for WebSocket connections with session management
     */
    execute(context: WebSocketSessionContext, next: () => Promise<void>): Promise<void>;
    /**
     * Authenticate using existing session
     */
    private authenticateWithSession;
    /**
     * Extract session ID from WebSocket context
     */
    private extractSessionId;
    /**
     * Set authenticated context with session data
     */
    private setAuthenticatedContext;
    /**
     * Create session from authentication result
     */
    private createSessionFromAuth;
    /**
     * Update session activity timestamp
     */
    private updateSessionActivity;
    /**
     * Get user details for context population
     */
    private getUserDetails;
    /**
     * Extract device type from user agent
     */
    private detectDeviceType;
    /**
     * Extract OS from user agent
     */
    private extractOS;
    /**
     * Extract browser from user agent
     */
    private extractBrowser;
    private authenticateConnection;
    /**
     * Extract Bearer token from headers or query parameters
     */
    private extractBearerToken;
    /**
     * Extract API key from headers or query parameters
     */
    private extractApiKey;
    /**
     * Authenticate using API key with database validation
     */
    private authenticateWithApiKey;
    /**
     * Enhanced message-level authorization using Enterprise PermissionService
     * Leverages hierarchical permissions, conditions, and detailed evaluation
     */
    private checkMessageAuthorization;
    /**
     * Advanced permission preloading using Enterprise PermissionService
     * Leverages batch permission checking and caching for optimal performance
     */
    private preloadUserPermissions;
    /**
        userId: context.userId,
        userRole: context.userRoles?.[0],
        permissionCount: context.userPermissions?.length || 0,
      });
    }
  
    /**
     * Check if authentication should be skipped for this message type
     */
    private shouldSkipAuthentication;
    /**
     * Handle authentication failure with proper error response
     */
    private handleAuthenticationFailure;
    /**
     * Map error messages to standardized error codes
     */
    private getAuthErrorCode;
    /**
     * Create factory function for easy instantiation
     */
    static create(config: WebSocketAuthConfig, sessionManager: UnifiedSessionManager, logger: ILogger, metrics?: MetricsCollector): WebSocketMiddlewareFunction;
}
//# sourceMappingURL=WebSocketAuthMiddleware.d.ts.map