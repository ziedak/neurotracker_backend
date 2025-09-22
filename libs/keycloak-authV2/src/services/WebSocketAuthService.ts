/**
 * WebSocket Authentication Service for Keycloak AuthV2
 *
 * Provides WebSocket authentication integration with V2 architecture.
 * Supports PKCE flows, modern OIDC patterns, and real-time token management.
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { TokenManager } from "./KeycloakTokenManager";
import type { KeycloakSessionManager } from "./KeycloakSessionManager";
import { PKCEManager } from "./PKCEManager";
import { AuthorizationService } from "./AuthorizationService";
import type { RefreshTokenManager } from "./RefreshTokenManager";
import type { KeycloakTokenResponse } from "../client/KeycloakClient";

/**
 * WebSocket connection data with V2 integration
 */
export interface WebSocketConnection {
  readonly connectionId: string;
  readonly userId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly clientId: string;
  readonly connectedAt: Date;
  readonly lastValidated: Date;
  readonly authMethod: "jwt" | "session" | "pkce" | "anonymous";
  readonly permissions: string[];
  readonly scopes: string[];
  readonly token?:
    | {
        accessToken: string;
        tokenType: "bearer";
        expiresAt: Date;
      }
    | undefined;
  readonly pkcePair?:
    | {
        codeChallenge: string;
        state: string;
        expiresAt: Date;
      }
    | undefined;
  /** Track if this connection supports automatic token refresh */
  readonly supportsTokenRefresh?: boolean | undefined;
  /** Last token refresh timestamp */
  readonly lastTokenRefresh?: Date | undefined;
}

/**
 * WebSocket authentication result
 */
export interface WebSocketAuthResult {
  readonly success: boolean;
  readonly connection?: WebSocketConnection;
  readonly error?: string;
  readonly errorCode?:
    | "invalid_token"
    | "expired_token"
    | "insufficient_permissions"
    | "connection_limit_exceeded"
    | "unknown_error";
}

/**
 * WebSocket message with authentication context
 */
export interface AuthenticatedMessage {
  readonly connectionId: string;
  readonly userId?: string | undefined;
  readonly data: string | ArrayBuffer;
  readonly timestamp: Date;
  readonly authenticated: boolean;
}

/**
 * WebSocket configuration
 */
export interface WebSocketConfig {
  readonly enabled: boolean;
  readonly allowAnonymous: boolean;
  readonly heartbeatInterval: number; // seconds
  readonly tokenRefreshThreshold: number; // seconds before expiry
  readonly pkcePairTTL: number; // seconds
  readonly connectionTimeout: number; // seconds
}

/**
 * Default WebSocket configuration
 */
export const DEFAULT_WEBSOCKET_CONFIG: WebSocketConfig = {
  enabled: true,
  allowAnonymous: false,
  heartbeatInterval: 30,
  tokenRefreshThreshold: 300, // 5 minutes
  pkcePairTTL: 600, // 10 minutes
  connectionTimeout: 60,
} as const;

/**
 * WebSocket lifecycle hooks
 */
export interface WebSocketHooks {
  onConnect?: (connection: WebSocketConnection) => Promise<void>;
  onDisconnect?: (connection: WebSocketConnection) => Promise<void>;
  onAuthenticate?: (connection: WebSocketConnection) => Promise<void>;
  onAuthenticationFailed?: (
    connectionId: string,
    error: string
  ) => Promise<void>;
  onMessage?: (message: AuthenticatedMessage) => Promise<void>;
  onTokenRefresh?: (
    connection: WebSocketConnection,
    newToken: string
  ) => Promise<void>;
}

/**
 * WebSocket Authentication Service for Keycloak V2
 */
export class WebSocketAuthService {
  private readonly logger = createLogger("WebSocketAuthService");
  private activeConnections = new Map<string, WebSocketConnection>();
  private heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly config: WebSocketConfig = DEFAULT_WEBSOCKET_CONFIG,
    private readonly tokenManager: TokenManager,
    private readonly sessionManager: KeycloakSessionManager,
    private readonly pkceManager: PKCEManager,
    private readonly authorizationService: AuthorizationService,
    private readonly refreshTokenManager?: RefreshTokenManager,
    private readonly metrics?: IMetricsCollector,
    private readonly hooks?: WebSocketHooks
  ) {
    // Set up refresh token event handlers if RefreshTokenManager is provided
    if (this.refreshTokenManager) {
      this.setupRefreshTokenHandlers();
    }

    this.logger.info("WebSocket Auth Service initialized", {
      allowAnonymous: this.config.allowAnonymous,
      heartbeatInterval: this.config.heartbeatInterval,
      hasRefreshTokenSupport: !!this.refreshTokenManager,
    });
  }

  /**
   * Set up refresh token event handlers
   */
  private setupRefreshTokenHandlers(): void {
    // Note: This would typically involve creating event handlers
    // that could notify WebSocket clients of token refresh events
    this.logger.debug("Refresh token handlers set up for WebSocket service");
  }

  /**
   * Store tokens for a connection with automatic refresh support
   */
  async storeConnectionTokens(
    connectionId: string,
    tokens: KeycloakTokenResponse
  ): Promise<boolean> {
    const connection = this.activeConnections.get(connectionId);
    if (!connection || !connection.userId || !connection.sessionId) {
      this.logger.warn(
        "Cannot store tokens: connection not found or missing user/session info",
        {
          connectionId,
          hasConnection: !!connection,
          hasUserId: !!connection?.userId,
          hasSessionId: !!connection?.sessionId,
        }
      );
      return false;
    }

    if (!this.refreshTokenManager) {
      this.logger.debug(
        "RefreshTokenManager not available, skipping token storage",
        {
          connectionId,
        }
      );
      return false;
    }

    try {
      await this.refreshTokenManager.storeTokens(
        connection.userId,
        connection.sessionId,
        tokens
      );

      // Update connection with refresh support flag
      this.activeConnections.set(connectionId, {
        ...connection,
        supportsTokenRefresh: true,
        lastTokenRefresh: new Date(),
      });

      this.logger.debug("Connection tokens stored with refresh support", {
        connectionId,
        userId: connection.userId,
        sessionId: connection.sessionId,
        expiresIn: tokens.expires_in,
      });

      return true;
    } catch (error) {
      this.logger.error("Failed to store connection tokens", {
        connectionId,
        userId: connection.userId,
        sessionId: connection.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Check if connection has valid stored tokens
   */
  async hasValidStoredTokens(connectionId: string): Promise<boolean> {
    const connection = this.activeConnections.get(connectionId);
    if (
      !connection ||
      !connection.userId ||
      !connection.sessionId ||
      !this.refreshTokenManager
    ) {
      return false;
    }

    return await this.refreshTokenManager.hasValidTokens(
      connection.userId,
      connection.sessionId
    );
  }

  /**
   * Get remaining time until stored tokens expire
   */
  async getStoredTokenTimeRemaining(connectionId: string): Promise<number> {
    const connection = this.activeConnections.get(connectionId);
    if (
      !connection ||
      !connection.userId ||
      !connection.sessionId ||
      !this.refreshTokenManager
    ) {
      return 0;
    }

    return await this.refreshTokenManager.getTokenTimeRemaining(
      connection.userId,
      connection.sessionId
    );
  }

  /**
   * Manually refresh tokens for a connection
   */
  async refreshConnectionTokens(connectionId: string): Promise<boolean> {
    const connection = this.activeConnections.get(connectionId);
    if (!connection || !connection.userId || !connection.sessionId) {
      this.logger.warn(
        "Cannot refresh tokens: connection not found or missing user/session info",
        {
          connectionId,
        }
      );
      return false;
    }

    if (!this.refreshTokenManager) {
      this.logger.warn(
        "RefreshTokenManager not available, cannot refresh tokens",
        {
          connectionId,
        }
      );
      return false;
    }

    try {
      const result = await this.refreshTokenManager.refreshTokens(
        connection.userId,
        connection.sessionId
      );

      if (result.success) {
        // Update connection's last refresh time
        this.activeConnections.set(connectionId, {
          ...connection,
          lastTokenRefresh: new Date(),
        });

        this.logger.info("Connection tokens refreshed successfully", {
          connectionId,
          userId: connection.userId,
          sessionId: connection.sessionId,
        });

        // Notify connection about token refresh if needed
        if (this.hooks?.onTokenRefresh) {
          await this.hooks.onTokenRefresh(
            connection,
            result.tokens!.access_token
          );
        }

        return true;
      } else {
        this.logger.warn("Token refresh failed", {
          connectionId,
          userId: connection.userId,
          sessionId: connection.sessionId,
          error: result.error,
        });
        return false;
      }
    } catch (error) {
      this.logger.error("Failed to refresh connection tokens", {
        connectionId,
        userId: connection.userId,
        sessionId: connection.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Remove stored tokens when connection is disconnected
   */
  async removeConnectionTokens(connectionId: string): Promise<void> {
    const connection = this.activeConnections.get(connectionId);
    if (
      !connection ||
      !connection.userId ||
      !connection.sessionId ||
      !this.refreshTokenManager
    ) {
      return;
    }

    try {
      await this.refreshTokenManager.removeTokens(
        connection.userId,
        connection.sessionId
      );

      this.logger.debug("Connection tokens removed", {
        connectionId,
        userId: connection.userId,
        sessionId: connection.sessionId,
      });
    } catch (error) {
      this.logger.error("Failed to remove connection tokens", {
        connectionId,
        userId: connection.userId,
        sessionId: connection.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if refresh token support is available
   */
  hasRefreshTokenSupport(): boolean {
    return !!this.refreshTokenManager;
  }

  /**
   * Authenticate WebSocket connection
   */
  async authenticateConnection(
    headers: Record<string, string>,
    query: Record<string, string>,
    cookies?: Record<string, string>
  ): Promise<WebSocketAuthResult> {
    const startTime = performance.now();
    const connectionId = this.generateConnectionId();

    try {
      // Extract authentication data
      const authData = this.extractAuthData(headers, query, cookies);

      // Try different authentication methods
      let connection: WebSocketConnection | undefined;

      // 1. JWT Token authentication
      if (authData.token) {
        connection = await this.authenticateWithJWT(
          connectionId,
          authData.token,
          authData.clientId
        );
      }

      // 2. Session authentication
      else if (authData.sessionId) {
        connection = await this.authenticateWithSession(
          connectionId,
          authData.sessionId,
          authData.clientId
        );
      }

      // 3. PKCE authentication
      else if (authData.codeChallenge && authData.state) {
        connection = await this.authenticateWithPKCE(
          connectionId,
          authData.codeChallenge,
          authData.state,
          authData.clientId
        );
      }

      // 4. Anonymous connection (if allowed)
      else if (this.config.allowAnonymous) {
        connection = await this.createAnonymousConnection(
          connectionId,
          authData.clientId
        );
      }

      if (!connection) {
        this.metrics?.recordCounter("websocket.authentication_failed", 1);
        return {
          success: false,
          error: "Authentication failed",
          errorCode: "invalid_token",
        };
      }

      // Store connection
      this.activeConnections.set(connectionId, connection);

      // Start heartbeat
      this.startHeartbeat(connectionId);

      // Record metrics
      this.metrics?.recordCounter("websocket.connections_established", 1, {
        method: connection.authMethod,
        client_id: connection.clientId,
      });
      this.metrics?.recordTimer(
        "websocket.authentication_duration",
        performance.now() - startTime
      );

      // Execute hook
      if (this.hooks?.onConnect) {
        await this.hooks.onConnect(connection);
      }

      this.logger.debug("WebSocket connection authenticated", {
        connectionId,
        userId: connection.userId,
        authMethod: connection.authMethod,
        clientId: connection.clientId,
        permissions: connection.permissions.length,
      });

      return {
        success: true,
        connection,
      };
    } catch (error) {
      this.metrics?.recordCounter("websocket.authentication_error", 1);
      this.logger.error("WebSocket authentication error", {
        error,
        connectionId,
      });

      if (this.hooks?.onAuthenticationFailed) {
        await this.hooks.onAuthenticationFailed(
          connectionId,
          error instanceof Error ? error.message : "Unknown error"
        );
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
        errorCode: "unknown_error",
      };
    }
  }

  /**
   * Handle connection close
   */
  async handleDisconnection(connectionId: string): Promise<void> {
    try {
      const connection = this.activeConnections.get(connectionId);
      if (!connection) {
        return;
      }

      // Remove from active connections
      this.activeConnections.delete(connectionId);

      // Stop heartbeat
      const heartbeatTimer = this.heartbeatTimers.get(connectionId);
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        this.heartbeatTimers.delete(connectionId);
      }

      // Record metrics
      this.metrics?.recordCounter("websocket.connections_closed", 1, {
        method: connection.authMethod,
        client_id: connection.clientId,
      });

      // Execute hook
      if (this.hooks?.onDisconnect) {
        await this.hooks.onDisconnect(connection);
      }

      this.logger.debug("WebSocket connection closed", {
        connectionId,
        userId: connection.userId,
        duration: Date.now() - connection.connectedAt.getTime(),
      });
    } catch (error) {
      this.logger.error("Error handling WebSocket disconnection", {
        error,
        connectionId,
      });
    }
  }

  /**
   * Handle incoming message with authentication context
   */
  async handleMessage(
    connectionId: string,
    data: string | ArrayBuffer
  ): Promise<AuthenticatedMessage | null> {
    try {
      const connection = this.activeConnections.get(connectionId);
      if (!connection) {
        this.logger.warn("Message from unknown connection", { connectionId });
        return null;
      }

      // TODO: Check authorization with AuthorizationService

      // Create authenticated message
      const message: AuthenticatedMessage = {
        connectionId,
        userId: connection.userId,
        data,
        timestamp: new Date(),
        authenticated: connection.authMethod !== "anonymous",
      };

      // Record metrics
      this.metrics?.recordCounter("websocket.messages_received", 1, {
        authenticated: message.authenticated.toString(),
        client_id: connection.clientId,
      });

      // Execute hook
      if (this.hooks?.onMessage) {
        await this.hooks.onMessage(message);
      }

      return message;
    } catch (error) {
      this.logger.error("Error handling WebSocket message", {
        error,
        connectionId,
      });
      this.metrics?.recordCounter("websocket.message_error", 1);
      return null;
    }
  }

  /**
   * Get connection by ID
   */
  getConnection(connectionId: string): WebSocketConnection | undefined {
    return this.activeConnections.get(connectionId);
  }

  /**
   * Get all connections for a user
   */
  getUserConnections(userId: string): WebSocketConnection[] {
    return Array.from(this.activeConnections.values()).filter(
      (conn) => conn.userId === userId
    );
  }

  /**
   * Check if connection has permission using AuthorizationService
   */
  async hasPermission(
    connectionId: string,
    action: string,
    resource?: string
  ): Promise<boolean> {
    const connection = this.activeConnections.get(connectionId);
    if (!connection || !connection.userId) {
      return false;
    }

    try {
      const context: any = {
        userId: connection.userId,
        roles: (connection.permissions as any[]) || [], // Convert permissions to roles for now
      };

      if (connection.sessionId) {
        context.sessionId = connection.sessionId;
      }

      const result = await this.authorizationService.can(
        context,
        action as any,
        resource as any
      );
      return result.granted;
    } catch (error) {
      this.logger.error("Permission check failed", {
        connectionId,
        action,
        resource,
        error,
      });
      return false;
    }
  }

  /**
   * Get user permissions for a connection using AuthorizationService
   */
  async getUserPermissions(connectionId: string): Promise<string[]> {
    const connection = this.activeConnections.get(connectionId);
    if (!connection || !connection.userId) {
      return [];
    }

    try {
      const context: any = {
        userId: connection.userId,
        roles: (connection.permissions as any[]) || [],
      };

      if (connection.sessionId) {
        context.sessionId = connection.sessionId;
      }

      const permissions = await this.authorizationService.getUserPermissions(
        context
      );
      return permissions;
    } catch (error) {
      this.logger.error("Failed to get user permissions", {
        connectionId,
        error,
      });
      return [];
    }
  }

  /**
   * Refresh connection token
   */
  async refreshConnectionToken(connectionId: string): Promise<boolean> {
    try {
      const connection = this.activeConnections.get(connectionId);
      if (!connection || !connection.token) {
        return false;
      }

      // This would integrate with your token refresh logic
      // For now, we just update the last validated time
      const updatedConnection: WebSocketConnection = {
        ...connection,
        lastValidated: new Date(),
      };

      this.activeConnections.set(connectionId, updatedConnection);

      if (this.hooks?.onTokenRefresh && connection.token) {
        await this.hooks.onTokenRefresh(
          updatedConnection,
          connection.token.accessToken
        );
      }

      this.logger.debug("Connection token refreshed", {
        connectionId,
        userId: connection.userId,
      });
      return true;
    } catch (error) {
      this.logger.error("Error refreshing connection token", {
        error,
        connectionId,
      });
      return false;
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    totalConnections: number;
    authenticatedConnections: number;
    anonymousConnections: number;
    connectionsByMethod: Record<string, number>;
    connectionsByClient: Record<string, number>;
    userConnectionCounts: Record<string, number>;
  } {
    const stats = {
      totalConnections: this.activeConnections.size,
      authenticatedConnections: 0,
      anonymousConnections: 0,
      connectionsByMethod: {} as Record<string, number>,
      connectionsByClient: {} as Record<string, number>,
      userConnectionCounts: {} as Record<string, number>,
    };

    for (const connection of this.activeConnections.values()) {
      if (connection.authMethod === "anonymous") {
        stats.anonymousConnections++;
      } else {
        stats.authenticatedConnections++;
      }

      stats.connectionsByMethod[connection.authMethod] =
        (stats.connectionsByMethod[connection.authMethod] || 0) + 1;

      stats.connectionsByClient[connection.clientId] =
        (stats.connectionsByClient[connection.clientId] || 0) + 1;

      if (connection.userId) {
        stats.userConnectionCounts[connection.userId] =
          (stats.userConnectionCounts[connection.userId] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * Shutdown service and cleanup resources
   */
  async shutdown(): Promise<void> {
    // Clear all heartbeat timers
    for (const timer of this.heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.heartbeatTimers.clear();

    // Close all connections (would be handled by the WebSocket server)
    const connectionCount = this.activeConnections.size;
    this.activeConnections.clear();

    this.logger.info("WebSocket Auth Service shutdown completed", {
      closedConnections: connectionCount,
    });
  }

  /**
   * Authenticate with JWT token
   */
  private async authenticateWithJWT(
    connectionId: string,
    token: string,
    clientId: string
  ): Promise<WebSocketConnection | undefined> {
    try {
      const validation = await this.tokenManager.validateToken(token);
      if (!validation.success || !validation.user) {
        return undefined;
      }

      return {
        connectionId,
        userId: validation.user.id,
        clientId: clientId, // Use provided clientId
        connectedAt: new Date(),
        lastValidated: new Date(),
        authMethod: "jwt",
        permissions: validation.user.permissions || [],
        scopes: validation.scopes || [],
        token: {
          accessToken: token,
          tokenType: "bearer",
          expiresAt: validation.expiresAt || new Date(Date.now() + 3600000), // Default 1 hour if not provided
        },
      };
    } catch (error) {
      this.logger.error("JWT authentication failed", { error });
      return undefined;
    }
  }

  /**
   * Authenticate with session
   */
  private async authenticateWithSession(
    connectionId: string,
    sessionId: string,
    clientId: string
  ): Promise<WebSocketConnection | undefined> {
    try {
      const validation = await this.sessionManager.validateSession(sessionId, {
        ipAddress: "websocket", // WebSocket doesn't have IP address readily available
        userAgent: "websocket-client",
      });

      if (!validation.valid || !validation.session) {
        return undefined;
      }

      const session = validation.session;

      return {
        connectionId,
        userId: session.userId,
        sessionId: session.id,
        clientId: clientId, // Use the provided clientId since session doesn't store it
        connectedAt: new Date(),
        lastValidated: new Date(),
        authMethod: "session",
        permissions: [], // Session doesn't store permissions - would need additional lookup
        scopes: [], // Session doesn't store scopes - would need additional lookup
      };
    } catch (error) {
      this.logger.error("Session authentication failed", { error });
      return undefined;
    }
  }

  /**
   * Authenticate with PKCE
   */
  private async authenticateWithPKCE(
    connectionId: string,
    codeChallenge: string,
    state: string,
    clientId: string
  ): Promise<WebSocketConnection | undefined> {
    try {
      // This is a simplified PKCE validation for WebSocket
      // In practice, you'd validate the PKCE flow completion
      const validation = await this.pkceManager.validatePKCE(state, "");
      if (!validation.valid || !validation.pkce) {
        return undefined;
      }

      return {
        connectionId,
        userId: validation.pkce.userId,
        clientId: validation.pkce.clientId || clientId,
        connectedAt: new Date(),
        lastValidated: new Date(),
        authMethod: "pkce",
        permissions: [], // Would be extracted from PKCE context
        scopes: [], // Would be extracted from PKCE context
        pkcePair: {
          codeChallenge,
          state,
          expiresAt: validation.pkce.expiresAt,
        },
      };
    } catch (error) {
      this.logger.error("PKCE authentication failed", { error });
      return undefined;
    }
  }

  /**
   * Create anonymous connection
   */
  private async createAnonymousConnection(
    connectionId: string,
    clientId: string
  ): Promise<WebSocketConnection> {
    return {
      connectionId,
      clientId: clientId || "anonymous",
      connectedAt: new Date(),
      lastValidated: new Date(),
      authMethod: "anonymous",
      permissions: [],
      scopes: [],
    };
  }

  /**
   * Extract authentication data from request
   */
  private extractAuthData(
    headers: Record<string, string>,
    query: Record<string, string>,
    cookies?: Record<string, string>
  ): {
    token?: string | undefined;
    sessionId?: string | undefined;
    codeChallenge?: string | undefined;
    state?: string | undefined;
    clientId: string;
  } {
    const authHeader = headers["authorization"] || headers["Authorization"];
    const token =
      authHeader?.replace(/^Bearer\s+/, "") || query["token"] || undefined;
    const sessionId =
      cookies?.["session_id"] || query["session_id"] || undefined;
    const codeChallenge = query["code_challenge"] || undefined;
    const state = query["state"] || undefined;
    const clientId =
      query["client_id"] || headers["x-client-id"] || "websocket";

    return {
      token,
      sessionId,
      codeChallenge,
      state,
      clientId,
    };
  }

  /**
   * Generate unique connection ID
   */
  private generateConnectionId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start heartbeat for connection
   */
  private startHeartbeat(connectionId: string): void {
    const timer = setInterval(() => {
      const connection = this.activeConnections.get(connectionId);
      if (!connection) {
        clearInterval(timer);
        this.heartbeatTimers.delete(connectionId);
        return;
      }

      // Check if token needs refresh
      if (connection.token) {
        const timeUntilExpiry =
          connection.token.expiresAt.getTime() - Date.now();
        if (timeUntilExpiry < this.config.tokenRefreshThreshold * 1000) {
          this.refreshConnectionToken(connectionId).catch((error) => {
            this.logger.error("Heartbeat token refresh failed", {
              error,
              connectionId,
            });
          });
        }
      }

      this.logger.debug("WebSocket heartbeat", { connectionId });
    }, this.config.heartbeatInterval * 1000);

    this.heartbeatTimers.set(connectionId, timer);
  }
}

/**
 * Create WebSocket authentication service
 */
export function createWebSocketAuthService(
  config: Partial<WebSocketConfig> = {},
  tokenManager: TokenManager,
  sessionManager: KeycloakSessionManager,
  pkceManager: PKCEManager,
  authorizationService: AuthorizationService,
  refreshTokenManager?: RefreshTokenManager,
  metrics?: IMetricsCollector,
  hooks?: WebSocketHooks
): WebSocketAuthService {
  const finalConfig: WebSocketConfig = {
    ...DEFAULT_WEBSOCKET_CONFIG,
    ...config,
  };

  return new WebSocketAuthService(
    finalConfig,
    tokenManager,
    sessionManager,
    pkceManager,
    authorizationService,
    refreshTokenManager,
    metrics,
    hooks
  );
}

export default WebSocketAuthService;
