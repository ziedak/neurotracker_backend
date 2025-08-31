/**
 * Keycloak WebSocket Authentication Middleware
 *
 * Extends BaseWebSocketMiddleware to provide Keycloak-based authentication
 * for WebSocket connections with real-time token validation and role-based access control.
 */

import { BaseWebSocketMiddleware } from "../websocket/BaseWebSocketMiddleware";
import { WebSocketContext, WebSocketMiddlewareFunction } from "../types";
import { ILogger, MetricsCollector } from "@libs/monitoring";
import { KeycloakService } from "./service";
import {
  KeycloakWebSocketConfig,
  KeycloakAuthContext,
  KeycloakUserInfo,
  KeycloakError,
  KeycloakErrorType,
} from "./types";

/**
 * Extended WebSocket context with Keycloak authentication data
 */
export interface KeycloakWebSocketContext extends WebSocketContext {
  keycloak: KeycloakAuthContext;
}

/**
 * Keycloak WebSocket Authentication Middleware
 *
 * Provides JWT-based authentication for WebSocket connections using Keycloak.
 * Supports token validation, role-based message filtering, and real-time
 * permission checking for enhanced security.
 */
export class KeycloakWebSocketMiddleware extends BaseWebSocketMiddleware<KeycloakWebSocketConfig> {
  private readonly keycloakService: KeycloakService;
  private readonly requireAuth: boolean;

  constructor(
    config: KeycloakWebSocketConfig,
    logger?: ILogger,
    metrics?: MetricsCollector
  ) {
    super("keycloak-websocket-auth", config, logger, metrics);

    this.keycloakService = new KeycloakService(config, this.logger);
    this.requireAuth = config.requireAuth ?? true;

    this.logger.info("Keycloak WebSocket middleware initialized", {
      serverUrl: config.serverUrl,
      realm: config.realm,
      clientId: config.clientId,
      requireAuth: this.requireAuth,
      messagePermissions: Object.keys(config.messagePermissions || {}).length,
      messageRoles: Object.keys(config.messageRoles || {}).length,
    });
  }

  /**
   * Execute Keycloak authentication for WebSocket connections
   */
  async execute(
    context: KeycloakWebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // Initialize Keycloak context
      context.keycloak = {
        authenticated: false,
        roles: [],
        groups: [],
        permissions: [],
        clientRoles: {},
      };

      // Skip authentication for certain message types if configured
      if (this.shouldSkipAuthentication(context)) {
        this.logger.debug("Authentication skipped for message type", {
          messageType: context.message.type,
          connectionId: context.connectionId,
        });
        await next();
        return;
      }

      // Extract token from connection metadata
      const token = this.extractToken(context);

      if (!token) {
        if (this.requireAuth) {
          await this.handleAuthenticationFailure(
            context,
            new KeycloakError(
              "No authentication token provided",
              KeycloakErrorType.INVALID_TOKEN
            )
          );
          return;
        } else {
          // Allow unauthenticated connections
          await this.recordMetric("ws_keycloak_unauthenticated_allowed");
          await next();
          return;
        }
      }

      // Verify token with Keycloak
      const verification = await this.keycloakService.verifyToken(token);

      if (!verification.valid) {
        await this.handleAuthenticationFailure(
          context,
          new KeycloakError(
            verification.error || "Token verification failed",
            this.getErrorTypeFromMessage(verification.error)
          )
        );
        return;
      }

      // Set authenticated context
      await this.setAuthenticatedContext(
        context,
        verification.userInfo!,
        token
      );

      // Check message-level permissions
      await this.checkMessageAuthorization(context);

      // Log successful authentication
      this.logger.debug("WebSocket Keycloak authentication successful", {
        connectionId: context.connectionId,
        userId: verification.userInfo!.sub,
        username: verification.userInfo!.preferredUsername,
        messageType: context.message.type,
        roles: verification.userInfo!.roles.length,
        source: verification.source,
      });

      await this.recordMetric("ws_keycloak_auth_success", 1, {
        source: verification.source,
        messageType: context.message.type,
        realm: this.config.realm,
      });

      // Continue to next middleware
      await next();
    } catch (error) {
      const keycloakError =
        error instanceof KeycloakError
          ? error
          : new KeycloakError(
              (error as Error).message,
              KeycloakErrorType.INVALID_TOKEN
            );

      await this.handleAuthenticationFailure(context, keycloakError);
    } finally {
      const duration = performance.now() - startTime;
      await this.recordTimer("ws_keycloak_auth_duration", duration, {
        authenticated: context.keycloak.authenticated.toString(),
        messageType: context.message.type,
        realm: this.config.realm,
      });
    }
  }

  /**
   * Extract JWT token from WebSocket connection metadata
   */
  private extractToken(context: KeycloakWebSocketContext): string | null {
    const { headers, query } = context.metadata;

    // Try Authorization header first
    const authHeader = headers["authorization"] || headers["Authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    // Try query parameters as fallback
    return query["access_token"] || query["token"] || null;
  }

  /**
   * Set authenticated context with user information
   */
  private async setAuthenticatedContext(
    context: KeycloakWebSocketContext,
    userInfo: KeycloakUserInfo,
    token: string
  ): Promise<void> {
    context.keycloak = {
      authenticated: true,
      user: userInfo,
      token,
      roles: userInfo.roles,
      groups: userInfo.groups,
      permissions: this.mapRolesToPermissions(userInfo.roles),
      clientRoles: userInfo.clientRoles,
    };

    // Set standard WebSocket context properties
    context.authenticated = true;
    context.userId = userInfo.sub;
    context["userRole"] = userInfo.roles[0]; // Primary role
    context.userPermissions = context.keycloak.permissions;
  }

  /**
   * Map Keycloak roles to permissions for WebSocket operations
   */
  private mapRolesToPermissions(roles: string[]): string[] {
    const permissions: string[] = [];

    roles.forEach((role) => {
      switch (role.toLowerCase()) {
        case "admin":
        case "administrator":
          permissions.push(
            "websocket:connect",
            "websocket:send",
            "websocket:receive",
            "websocket:broadcast",
            "websocket:admin",
            "message:*"
          );
          break;
        case "manager":
          permissions.push(
            "websocket:connect",
            "websocket:send",
            "websocket:receive",
            "message:chat",
            "message:notification",
            "message:data"
          );
          break;
        case "user":
        case "customer":
          permissions.push(
            "websocket:connect",
            "websocket:send",
            "websocket:receive",
            "message:chat",
            "message:notification"
          );
          break;
        case "readonly":
        case "viewer":
          permissions.push(
            "websocket:connect",
            "websocket:receive",
            "message:notification"
          );
          break;
        default:
          // Basic permissions for unknown roles
          permissions.push("websocket:connect", "websocket:receive");
      }
    });

    return [...new Set(permissions)]; // Remove duplicates
  }

  /**
   * Check message-level authorization based on Keycloak roles and permissions
   */
  private async checkMessageAuthorization(
    context: KeycloakWebSocketContext
  ): Promise<void> {
    const messageType = context.message.type;
    const userId = context.userId!;

    try {
      // Check message permissions if configured
      if (
        this.config.messagePermissions &&
        this.config.messagePermissions[messageType]
      ) {
        const requiredPermissions = this.config.messagePermissions[messageType];

        for (const permission of requiredPermissions) {
          if (!context.keycloak.permissions.includes(permission)) {
            throw new KeycloakError(
              `Access denied for message type: ${messageType}. Missing permission: ${permission}`,
              KeycloakErrorType.PERMISSION_DENIED
            );
          }
        }
      }

      // Check message roles if configured
      if (this.config.messageRoles && this.config.messageRoles[messageType]) {
        const requiredRoles = this.config.messageRoles[messageType];
        const hasRole = requiredRoles.some((role) =>
          context.keycloak.roles.includes(role)
        );

        if (!hasRole) {
          throw new KeycloakError(
            `Insufficient role privileges for message type: ${messageType}. Required roles: ${requiredRoles.join(
              ", "
            )}`,
            KeycloakErrorType.PERMISSION_DENIED
          );
        }
      }

      // Log successful authorization
      this.logger.debug("WebSocket message authorization granted", {
        connectionId: context.connectionId,
        userId,
        messageType,
        roles: context.keycloak.roles,
        permissions: context.keycloak.permissions.length,
      });

      await this.recordMetric("ws_keycloak_message_authorized", 1, {
        messageType,
        realm: this.config.realm,
        source: "local",
      });
    } catch (error) {
      this.logger.warn("WebSocket message authorization denied", {
        connectionId: context.connectionId,
        userId,
        messageType,
        error: (error as Error).message,
        roles: context.keycloak.roles,
        permissions: context.keycloak.permissions,
      });

      await this.recordMetric("ws_keycloak_message_denied", 1, {
        messageType,
        error_type: error instanceof KeycloakError ? error.type : "unknown",
        realm: this.config.realm,
      });

      throw error;
    }
  }

  /**
   * Check if authentication should be skipped for this message type
   */
  private shouldSkipAuthentication(context: KeycloakWebSocketContext): boolean {
    const messageType = context.message.type;
    const skipTypes = this.config.skipAuthenticationForTypes || [];
    return skipTypes.includes(messageType);
  }

  /**
   * Handle authentication failures with proper error responses
   */
  private async handleAuthenticationFailure(
    context: KeycloakWebSocketContext,
    error: KeycloakError
  ): Promise<void> {
    this.logger.warn("WebSocket Keycloak authentication failed", {
      connectionId: context.connectionId,
      messageType: context.message.type,
      error: error.message,
      type: error.type,
      clientIp: context.metadata.clientIp,
    });

    await this.recordMetric("ws_keycloak_auth_failed", 1, {
      error_type: error.type,
      messageType: context.message.type,
      realm: this.config.realm,
    });

    // Send structured error response
    this.sendResponse(context, {
      type: "keycloak_auth_error",
      error: {
        code: error.type,
        message: error.message,
        timestamp: new Date().toISOString(),
        connection_id: context.connectionId,
      },
    });

    // Close connection if configured to do so
    if (this.config.closeOnAuthFailure !== false) {
      this.logger.info(
        "Closing WebSocket connection due to Keycloak authentication failure",
        {
          connectionId: context.connectionId,
          error: error.message,
          errorType: error.type,
        }
      );

      const closeCode = this.getWebSocketCloseCode(error.type);
      context.ws.close(
        closeCode,
        `Keycloak authentication failed: ${error.message}`
      );
    }
  }

  /**
   * Map Keycloak error types to WebSocket close codes
   */
  private getWebSocketCloseCode(errorType: KeycloakErrorType): number {
    switch (errorType) {
      case KeycloakErrorType.TOKEN_EXPIRED:
        return 1008; // Policy violation
      case KeycloakErrorType.INVALID_TOKEN:
      case KeycloakErrorType.INVALID_SIGNATURE:
        return 1008; // Policy violation
      case KeycloakErrorType.PERMISSION_DENIED:
        return 1008; // Policy violation
      case KeycloakErrorType.CONNECTION_ERROR:
        return 1011; // Server error
      default:
        return 1008; // Policy violation
    }
  }

  /**
   * Determine error type from error message
   */
  private getErrorTypeFromMessage(message?: string): KeycloakErrorType {
    if (!message) return KeycloakErrorType.INVALID_TOKEN;

    if (message.includes("expired")) return KeycloakErrorType.TOKEN_EXPIRED;
    if (message.includes("signature"))
      return KeycloakErrorType.INVALID_SIGNATURE;
    if (message.includes("issuer")) return KeycloakErrorType.INVALID_ISSUER;
    if (message.includes("audience")) return KeycloakErrorType.INVALID_AUDIENCE;
    if (message.includes("connection"))
      return KeycloakErrorType.CONNECTION_ERROR;
    if (message.includes("permission"))
      return KeycloakErrorType.PERMISSION_DENIED;

    return KeycloakErrorType.INVALID_TOKEN;
  }

  /**
   * Get Keycloak service instance
   */
  public getService(): KeycloakService {
    return this.keycloakService;
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): Record<string, number> {
    return this.keycloakService.getCacheStats();
  }

  /**
   * Clear authentication caches
   */
  public clearCache(): void {
    this.keycloakService.clearCache();
  }

  /**
   * Create factory function for easy instantiation
   */
  static create(
    config: KeycloakWebSocketConfig,
    logger?: ILogger,
    metrics?: MetricsCollector
  ): WebSocketMiddlewareFunction {
    const middleware = new KeycloakWebSocketMiddleware(config, logger, metrics);
    return middleware.middleware();
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    this.keycloakService.destroy();
  }
}

/**
 * Create Keycloak WebSocket middleware function
 */
export function createKeycloakWebSocketMiddleware(
  config: KeycloakWebSocketConfig,
  logger?: ILogger,
  metrics?: MetricsCollector
): WebSocketMiddlewareFunction {
  return KeycloakWebSocketMiddleware.create(config, logger, metrics);
}
