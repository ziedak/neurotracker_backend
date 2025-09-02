/**
 * WebSocket Authentication Middleware
 * Provides WebSocket authentication middleware for real-time connections
 * Integrates with the authentication service for seamless WebSocket protection
 */

import {
  WebSocketAuthContext,
  AuthMiddlewareOptions,
  ForbiddenError,
  UnauthorizedError,
  ServiceDependencies,
  User,
  Session,
} from "../types";
import { AuthenticationService } from "../services/auth-service";

// ===================================================================
// WEBSOCKET MIDDLEWARE CLASS
// ===================================================================

export class WebSocketAuthMiddleware {
  constructor(
    private authService: AuthenticationService,
    private deps: ServiceDependencies
  ) {}

  /**
   * Authenticate WebSocket connection on upgrade
   */
  async authenticateConnection(
    connectionId: string,
    headers: Record<string, string>,
    query: Record<string, string>
  ): Promise<WebSocketAuthContext | null> {
    try {
      // Extract authentication token from headers or query parameters
      const token = this.extractToken(headers, query);

      if (!token) {
        this.deps.monitoring.logger.debug(
          "No authentication token provided for WebSocket",
          {
            connectionId,
          }
        );
        return null;
      }

      // Verify the token
      const user = await this.authService.verifyToken(token);
      if (!user) {
        this.deps.monitoring.logger.warn(
          "Invalid token for WebSocket connection",
          {
            connectionId,
          }
        );
        return null;
      }

      // Create session for WebSocket connection
      const session = await this.createWebSocketSession(
        user,
        connectionId,
        headers
      );

      // Create auth context
      const authContext = this.authService
        .getPermissionService()
        .createAuthContext(user);

      const wsAuthContext: WebSocketAuthContext = {
        user,
        session,
        permissions: authContext.permissions,
        roles: authContext.roles,
        ability: authContext.ability,
        isAuthenticated: authContext.isAuthenticated,
        connectionId,
        subscriptions: [],
      } as WebSocketAuthContext;

      this.deps.monitoring.logger.info("WebSocket connection authenticated", {
        connectionId,
        userId: user.id,
        roles: user.roles,
      });

      return wsAuthContext;
    } catch (error) {
      this.deps.monitoring.logger.error("WebSocket authentication failed", {
        connectionId,
        error,
      });
      return null;
    }
  }

  /**
   * Validate WebSocket message authentication
   */
  async validateMessage(
    wsAuthContext: WebSocketAuthContext,
    message: any
  ): Promise<boolean> {
    try {
      // Check if user is still authenticated
      if (!wsAuthContext.user || !wsAuthContext.isAuthenticated) {
        return false;
      }

      // Validate session is still active
      if (wsAuthContext.session) {
        const isSessionValid = await this.authService
          .getSessionService()
          .validateSession(wsAuthContext.session.id);

        if (!isSessionValid) {
          this.deps.monitoring.logger.warn("WebSocket session expired", {
            connectionId: wsAuthContext.connectionId,
            sessionId: wsAuthContext.session.id,
          });
          return false;
        }
      }

      // Check message-specific permissions if required
      if (message.action && message.resource) {
        const canPerform = this.authService.can(
          wsAuthContext.user,
          message.action,
          message.resource
        );

        if (!canPerform) {
          this.deps.monitoring.logger.warn(
            "WebSocket message permission denied",
            {
              connectionId: wsAuthContext.connectionId,
              userId: wsAuthContext.user.id,
              action: message.action,
              resource: message.resource,
            }
          );
          return false;
        }
      }

      return true;
    } catch (error) {
      this.deps.monitoring.logger.error("WebSocket message validation failed", {
        connectionId: wsAuthContext.connectionId,
        error,
      });
      return false;
    }
  }

  /**
   * Handle WebSocket connection close
   */
  async handleConnectionClose(
    wsAuthContext: WebSocketAuthContext
  ): Promise<void> {
    try {
      // Clean up session if it exists
      if (wsAuthContext.session) {
        await this.authService
          .getSessionService()
          .deleteSession(wsAuthContext.session.id);
      }

      // Clean up subscriptions
      wsAuthContext.subscriptions = [];

      this.deps.monitoring.logger.info("WebSocket connection closed", {
        connectionId: wsAuthContext.connectionId,
        userId: wsAuthContext.user?.id,
      });
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Failed to handle WebSocket connection close",
        {
          connectionId: wsAuthContext.connectionId,
          error,
        }
      );
    }
  }

  /**
   * Refresh WebSocket authentication
   */
  async refreshAuthentication(
    wsAuthContext: WebSocketAuthContext,
    newToken: string
  ): Promise<WebSocketAuthContext | null> {
    try {
      // Verify new token
      const user = await this.authService.verifyToken(newToken);
      if (!user) {
        return null;
      }

      // Update session activity
      if (wsAuthContext.session) {
        await this.authService
          .getSessionService()
          .updateSessionActivity(wsAuthContext.session.id);
      }

      // Create new auth context
      const authContext = this.authService
        .getPermissionService()
        .createAuthContext(user);

      const updatedWsAuthContext: WebSocketAuthContext = {
        ...authContext,
        user,
        session: wsAuthContext.session,
        connectionId: wsAuthContext.connectionId,
        subscriptions: wsAuthContext.subscriptions,
      } as WebSocketAuthContext;

      this.deps.monitoring.logger.info("WebSocket authentication refreshed", {
        connectionId: wsAuthContext.connectionId,
        userId: user.id,
      });

      return updatedWsAuthContext;
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Failed to refresh WebSocket authentication",
        {
          connectionId: wsAuthContext.connectionId,
          error,
        }
      );
      return null;
    }
  }

  /**
   * Check if user can subscribe to a topic/channel
   */
  async canSubscribe(
    wsAuthContext: WebSocketAuthContext,
    topic: string
  ): Promise<boolean> {
    try {
      if (!wsAuthContext.user) {
        return false;
      }

      // Check subscription permissions based on topic
      const canSubscribe = this.authService.can(
        wsAuthContext.user,
        "read",
        topic as any
      );

      if (!canSubscribe) {
        this.deps.monitoring.logger.warn("WebSocket subscription denied", {
          connectionId: wsAuthContext.connectionId,
          userId: wsAuthContext.user.id,
          topic,
        });
      }

      return canSubscribe;
    } catch (error) {
      this.deps.monitoring.logger.error(
        "Failed to check WebSocket subscription permission",
        {
          connectionId: wsAuthContext.connectionId,
          topic,
          error,
        }
      );
      return false;
    }
  }

  /**
   * Add subscription to WebSocket context
   */
  addSubscription(wsAuthContext: WebSocketAuthContext, topic: string): void {
    if (!wsAuthContext.subscriptions.includes(topic)) {
      wsAuthContext.subscriptions.push(topic);
    }
  }

  /**
   * Remove subscription from WebSocket context
   */
  removeSubscription(wsAuthContext: WebSocketAuthContext, topic: string): void {
    wsAuthContext.subscriptions = wsAuthContext.subscriptions.filter(
      (sub) => sub !== topic
    );
  }

  // ===================================================================
  // PRIVATE METHODS
  // ===================================================================

  private extractToken(
    headers: Record<string, string>,
    query: Record<string, string>
  ): string | null {
    // Try Authorization header first
    const authHeader = headers["authorization"] || headers["Authorization"];
    if (authHeader) {
      const token = this.authService
        .getJWTService()
        .extractTokenFromHeader(authHeader);
      if (token) {
        return token;
      }
    }

    // Try query parameter
    const tokenParam = query["token"] || query["access_token"];
    if (tokenParam) {
      return tokenParam;
    }

    return null;
  }

  private async createWebSocketSession(
    user: User,
    connectionId: string,
    headers: Record<string, string>
  ): Promise<Session | undefined> {
    try {
      const deviceInfo = {
        name: `WebSocket-${connectionId}`,
        type: "websocket",
        userAgent: headers["user-agent"] || headers["User-Agent"],
      };

      const session = await this.authService
        .getSessionService()
        .createSession(
          user.id,
          deviceInfo,
          headers["x-forwarded-for"] || headers["X-Forwarded-For"],
          deviceInfo.userAgent
        );

      return session;
    } catch (error) {
      this.deps.monitoring.logger.warn("Failed to create WebSocket session", {
        connectionId,
        userId: user.id,
        error,
      });
      return undefined;
    }
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create WebSocket auth middleware instance
 */
export function createWebSocketAuthMiddleware(
  authService: AuthenticationService,
  deps: ServiceDependencies
): WebSocketAuthMiddleware {
  return new WebSocketAuthMiddleware(authService, deps);
}

/**
 * WebSocket authentication guard
 */
export function wsAuthGuard(
  wsAuthContext: WebSocketAuthContext | null,
  options: AuthMiddlewareOptions = {}
): void {
  if (!wsAuthContext) {
    throw new UnauthorizedError("WebSocket authentication required");
  }

  // Check if authentication is required
  if (options.requireAuth && !wsAuthContext.isAuthenticated) {
    throw new UnauthorizedError("WebSocket authentication required");
  }

  // Check role requirements
  if (options.roles && options.roles.length > 0) {
    if (!wsAuthContext.user) {
      throw new UnauthorizedError("WebSocket authentication required");
    }

    const hasRequiredRole = options.roles.some((role: string) =>
      wsAuthContext.user!.roles.includes(role)
    );
    if (!hasRequiredRole) {
      throw new ForbiddenError("Insufficient WebSocket permissions");
    }
  }

  // Check permission requirements
  if (options.permissions && options.permissions.length > 0) {
    if (!wsAuthContext.user) {
      throw new UnauthorizedError("WebSocket authentication required");
    }

    const hasRequiredPermission = options.permissions.some(
      (permission: string) =>
        wsAuthContext.user!.permissions.includes(permission)
    );

    if (!hasRequiredPermission) {
      throw new ForbiddenError("Insufficient WebSocket permissions");
    }
  }

  // Check CASL ability requirements
  if (options.resource && options.action) {
    if (!wsAuthContext.user) {
      throw new UnauthorizedError("WebSocket authentication required");
    }

    // This would need access to the auth service to check ability
    // For now, we'll assume the ability check is done elsewhere
  }
}

/**
 * WebSocket subscription guard
 */
export function wsSubscriptionGuard(
  wsAuthContext: WebSocketAuthContext,
  topic: string
): void {
  if (!wsAuthContext.subscriptions.includes(topic)) {
    throw new ForbiddenError(`Subscription to topic '${topic}' not allowed`);
  }
}

export default WebSocketAuthMiddleware;
