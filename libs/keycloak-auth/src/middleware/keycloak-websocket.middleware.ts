/**
 * Keycloak WebSocket Middleware for Elysia.js
 *
 * Provides WebSocket authentication integration with the HTTP middleware patterns.
 * Reuses the same authentication logic but adapts it for WebSocket connections.
 */

import type { IMetricsCollector } from "@libs/monitoring";
import type {
  IKeycloakClientFactory,
  ITokenIntrospectionService,
  WebSocketAuthContext,
  WebSocketConnectionData,
  AuthContext,
  ClientType,
} from "../types";
import type { KeycloakAuthenticationResult } from "./keycloak-http.middleware";

/**
 * WebSocket-specific configuration extending the HTTP middleware config
 */
export interface KeycloakWebSocketConfig {
  // HTTP middleware configuration (reused for consistency)
  httpConfig: {
    name: string;
    keycloakClient: ClientType;
    requireAuth: boolean;
    requiredScopes?: string[];
    requiredPermissions?: string[];
    requiredRoles?: string[];
    bypassRoutes?: string[];
  };

  // WebSocket-specific configuration
  websocket: {
    allowAnonymous: boolean;
    heartbeatInterval?: number; // seconds
    maxConnectionsPerUser?: number;
    tokenRefreshThreshold?: number; // seconds before expiry
  };

  // Lifecycle hooks
  hooks?: WebSocketHooks;
}

/**
 * WebSocket lifecycle hooks
 */
export interface WebSocketHooks {
  onConnect?: (context: WebSocketConnectionInfo) => Promise<void>;
  onDisconnect?: (context: WebSocketConnectionInfo) => Promise<void>;
  onAuthenticate?: (context: WebSocketConnectionInfo) => Promise<void>;
  onAuthenticationFailed?: (
    context: WebSocketConnectionInfo,
    error: Error
  ) => Promise<void>;
}

/**
 * WebSocket connection information
 */
export interface WebSocketConnectionInfo {
  connectionId: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  authContext?: AuthContext;
  connectedAt: Date;
  lastValidated: Date;
}

/**
 * WebSocket authentication result
 */
export interface WebSocketAuthenticationResult {
  success: boolean;
  authContext: AuthContext | null;
  connectionInfo: WebSocketConnectionInfo;
  error?: string;
}

/**
 * Keycloak WebSocket Middleware
 *
 * Provides WebSocket authentication integration with the HTTP middleware patterns.
 * Reuses the same authentication logic but adapts it for WebSocket connections.
 */
export class KeycloakWebSocketMiddleware {
  private readonly httpMiddleware: any; // Will import the HTTP middleware
  private readonly activeConnections = new Map<
    string,
    WebSocketConnectionData
  >();

  constructor(
    private readonly metrics: IMetricsCollector,
    keycloakClientFactory: IKeycloakClientFactory,
    tokenIntrospectionService: ITokenIntrospectionService,
    private readonly config: KeycloakWebSocketConfig
  ) {
    // Import HTTP middleware for consistency
    const {
      KeycloakAuthHttpMiddleware,
    } = require("./keycloak-http.middleware");
    this.httpMiddleware = new KeycloakAuthHttpMiddleware(
      metrics,
      keycloakClientFactory,
      tokenIntrospectionService,
      {
        name: config.httpConfig.name,
        keycloakClient: config.httpConfig.keycloakClient,
        requireAuth: config.httpConfig.requireAuth,
        requiredScopes: config.httpConfig.requiredScopes,
        requiredPermissions: config.httpConfig.requiredPermissions,
        requiredRoles: config.httpConfig.requiredRoles,
        bypassRoutes: config.httpConfig.bypassRoutes,
      }
    );
  }

  /**
   * Authenticate WebSocket connection using HTTP middleware patterns
   */
  public async authenticateWebSocket(
    headers: Record<string, string>,
    query: Record<string, string>,
    cookies?: Record<string, string>
  ): Promise<WebSocketAuthenticationResult> {
    const connectionId = this.generateConnectionId();
    const connectedAt = new Date();

    try {
      // Use HTTP middleware authentication logic
      const authResult: KeycloakAuthenticationResult =
        await this.httpMiddleware.authenticate(headers, query, cookies);

      const connectionInfo: WebSocketConnectionInfo = {
        connectionId,
        headers,
        query,
        connectedAt,
        lastValidated: new Date(),
      };

      if (authResult.authContext && !authResult.error) {
        connectionInfo.authContext = authResult.authContext;

        // Store connection data
        const connectionData: WebSocketConnectionData = {
          auth: this.createWebSocketAuthContext(
            authResult.authContext,
            connectionId
          ),
          query,
          headers,
          connectionTime: connectedAt.getTime(),
        };

        this.activeConnections.set(connectionId, connectionData);

        // Execute connection hook
        if (this.config.hooks?.onConnect) {
          await this.config.hooks.onConnect(connectionInfo);
        }

        if (this.config.hooks?.onAuthenticate) {
          await this.config.hooks.onAuthenticate(connectionInfo);
        }

        this.metrics.recordCounter(
          "keycloak_websocket_connections_authenticated",
          1,
          {
            client_id: authResult.authContext.clientId || "unknown",
          }
        );

        return {
          success: true,
          authContext: authResult.authContext,
          connectionInfo,
        };
      } else {
        // Handle anonymous connections if allowed
        if (this.config.websocket.allowAnonymous) {
          connectionInfo.authContext = {
            authenticated: false,
            method: "none",
            scopes: [],
            permissions: [],
            validatedAt: new Date(),
            cached: false,
          };

          const connectionData: WebSocketConnectionData = {
            auth: this.createWebSocketAuthContext(
              connectionInfo.authContext,
              connectionId
            ),
            query,
            headers,
            connectionTime: connectedAt.getTime(),
          };

          this.activeConnections.set(connectionId, connectionData);

          if (this.config.hooks?.onConnect) {
            await this.config.hooks.onConnect(connectionInfo);
          }

          return {
            success: true,
            authContext: connectionInfo.authContext,
            connectionInfo,
          };
        }

        // Authentication failed and anonymous not allowed
        if (this.config.hooks?.onAuthenticationFailed) {
          await this.config.hooks.onAuthenticationFailed(
            connectionInfo,
            new Error(authResult.error || "Authentication failed")
          );
        }

        this.metrics.recordCounter(
          "keycloak_websocket_connections_rejected",
          1,
          {
            reason: authResult.error || "authentication_failed",
          }
        );

        return {
          success: false,
          authContext: null,
          connectionInfo,
          error: authResult.error || "Authentication failed",
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown authentication error";

      const connectionInfo: WebSocketConnectionInfo = {
        connectionId,
        headers,
        query,
        connectedAt,
        lastValidated: new Date(),
      };

      if (this.config.hooks?.onAuthenticationFailed) {
        await this.config.hooks.onAuthenticationFailed(
          connectionInfo,
          error as Error
        );
      }

      this.metrics.recordCounter(
        "keycloak_websocket_authentication_errors",
        1,
        {
          error: errorMessage,
        }
      );

      return {
        success: false,
        authContext: null,
        connectionInfo,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle WebSocket connection establishment
   */
  public async handleConnection(connectionId: string): Promise<void> {
    const connectionData = this.activeConnections.get(connectionId);
    if (!connectionData) return;

    this.metrics.recordGauge(
      "keycloak_websocket_active_connections",
      this.activeConnections.size
    );

    // Start heartbeat if configured
    if (this.config.websocket.heartbeatInterval) {
      this.startHeartbeat(connectionId);
    }
  }

  /**
   * Handle WebSocket disconnection
   */
  public async handleDisconnection(connectionId: string): Promise<void> {
    const connectionData = this.activeConnections.get(connectionId);
    if (connectionData && this.config.hooks?.onDisconnect) {
      const connectionInfo: WebSocketConnectionInfo = {
        connectionId,
        headers: connectionData.headers,
        query: connectionData.query,
        authContext: this.convertWebSocketAuthToAuthContext(
          connectionData.auth
        ),
        connectedAt: new Date(connectionData.connectionTime),
        lastValidated: connectionData.auth.lastValidated,
      };

      await this.config.hooks.onDisconnect(connectionInfo);
    }

    this.activeConnections.delete(connectionId);
    this.metrics.recordGauge(
      "keycloak_websocket_active_connections",
      this.activeConnections.size
    );
  }

  /**
   * Get connection information by connection ID
   */
  public getConnection(
    connectionId: string
  ): WebSocketConnectionData | undefined {
    return this.activeConnections.get(connectionId);
  }

  /**
   * Get all connections for a specific user
   */
  public getUserConnections(userId: string): WebSocketConnectionData[] {
    return Array.from(this.activeConnections.values()).filter(
      (conn) => conn.auth.userId === userId
    );
  }

  /**
   * Validate connection is still active and authenticated
   */
  public async validateConnection(connectionId: string): Promise<boolean> {
    const connectionData = this.activeConnections.get(connectionId);
    if (!connectionData) return false;

    // Check if token needs refresh
    const now = new Date();
    const timeSinceValidation =
      now.getTime() - connectionData.auth.lastValidated.getTime();
    const refreshThreshold =
      (this.config.websocket.tokenRefreshThreshold || 300) * 1000; // Default 5 minutes

    if (timeSinceValidation > refreshThreshold && connectionData.auth.userId) {
      // Re-validate the token
      try {
        const authResult = await this.httpMiddleware.authenticate(
          connectionData.headers,
          connectionData.query
        );

        if (authResult.authContext && !authResult.error) {
          // Update connection data with fresh auth context
          connectionData.auth = this.createWebSocketAuthContext(
            authResult.authContext,
            connectionId
          );
          this.activeConnections.set(connectionId, connectionData);
          return true;
        } else {
          // Authentication failed, remove connection
          this.activeConnections.delete(connectionId);
          return false;
        }
      } catch (error) {
        // Validation failed, remove connection
        this.activeConnections.delete(connectionId);
        return false;
      }
    }

    return true;
  }

  /**
   * Get middleware statistics
   */
  public getStats() {
    return {
      activeConnections: this.activeConnections.size,
      connectionsByUser: this.getConnectionsByUser(),
    };
  }

  // Private helper methods

  private generateConnectionId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private createWebSocketAuthContext(
    authContext: AuthContext,
    connectionId: string
  ): WebSocketAuthContext {
    return {
      method: this.mapAuthMethodToWebSocket(authContext.method),
      ...(authContext.token && { token: authContext.token }),
      ...(authContext.claims && { claims: authContext.claims }),
      ...(authContext.sessionId && { sessionId: authContext.sessionId }),
      clientId: authContext.clientId || "unknown",
      ...(authContext.userId && { userId: authContext.userId }),
      scopes: authContext.scopes,
      permissions: authContext.permissions,
      connectionId,
      connectedAt: new Date(),
      lastValidated: authContext.validatedAt,
    };
  }

  private mapAuthMethodToWebSocket(
    method: AuthContext["method"]
  ): WebSocketAuthContext["method"] {
    switch (method) {
      case "jwt":
        return "jwt_token";
      case "api_key":
        return "api_key";
      case "introspection":
        return "jwt_token"; // Treat introspection as JWT
      default:
        return "session_based";
    }
  }

  public convertWebSocketAuthToAuthContext(
    wsAuth: WebSocketAuthContext
  ): AuthContext {
    return {
      authenticated: !!wsAuth.userId,
      method:
        wsAuth.method === "jwt_token"
          ? "jwt"
          : wsAuth.method === "api_key"
          ? "api_key"
          : "introspection",
      ...(wsAuth.token && { token: wsAuth.token }),
      ...(wsAuth.claims && { claims: wsAuth.claims }),
      ...(wsAuth.clientId && { clientId: wsAuth.clientId }),
      ...(wsAuth.userId && { userId: wsAuth.userId }),
      scopes: wsAuth.scopes,
      permissions: wsAuth.permissions,
      ...(wsAuth.sessionId && { sessionId: wsAuth.sessionId }),
      validatedAt: wsAuth.lastValidated,
      cached: false, // WebSocket connections are always fresh
    };
  }

  private startHeartbeat(connectionId: string): void {
    const interval = setInterval(async () => {
      const isValid = await this.validateConnection(connectionId);
      if (!isValid) {
        clearInterval(interval);
      }
    }, (this.config.websocket.heartbeatInterval || 30) * 1000);
  }

  private getConnectionsByUser(): Record<string, number> {
    const userConnections: Record<string, number> = {};
    for (const connectionData of this.activeConnections.values()) {
      const userId = connectionData.auth.userId || "anonymous";
      userConnections[userId] = (userConnections[userId] || 0) + 1;
    }
    return userConnections;
  }
}
