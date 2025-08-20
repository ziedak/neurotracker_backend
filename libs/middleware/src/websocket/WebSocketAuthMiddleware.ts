import {
  WebSocketContext,
  WebSocketMiddlewareFunction,
  WebSocketAuthConfig,
} from "../types";
import { BaseWebSocketMiddleware } from "./BaseWebSocketMiddleware";
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  EnhancedJWTService,
  type TokenVerificationResult,
  type JWTPayload,
} from "@libs/auth";
import { DatabaseUtils } from "@libs/database";

/**
 * Production-grade WebSocket Authentication Middleware
 * Integrates with existing auth infrastructure for secure WebSocket connections
 */
export class WebSocketAuthMiddleware extends BaseWebSocketMiddleware<WebSocketAuthConfig> {
  private readonly jwtService: EnhancedJWTService;

  constructor(
    config: WebSocketAuthConfig,
    logger: Logger = Logger.getInstance("WebSocketAuthMiddleware"),
    metrics?: MetricsCollector
  ) {
    super("websocket-auth", config, logger, metrics);
    this.jwtService = EnhancedJWTService.getInstance();
  }

  /**
   * Execute authentication checks for WebSocket connections
   */
  async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // Skip authentication for certain message types if configured
      if (this.shouldSkipAuthentication(context)) {
        this.logger.debug("Authentication skipped for message type", {
          messageType: context.message.type,
          connectionId: context.connectionId,
        });
        await next();
        return;
      }

      // If connection is already authenticated, check message-level authorization
      if (context.authenticated && context.userId) {
        await this.checkMessageAuthorization(context);
        await next();
        await this.recordMetric("ws_auth_success");
        return;
      }

      // Handle connection authentication
      const authResult = await this.authenticateConnection(context);

      if (authResult.authenticated && authResult.payload) {
        context.authenticated = true;
        context.userId = authResult.payload.sub;
        context.userRoles = authResult.payload.role
          ? [authResult.payload.role]
          : [];
        context.userPermissions = authResult.payload.permissions || [];

        // Check message authorization after successful authentication
        await this.checkMessageAuthorization(context);
        await next();
        await this.recordMetric("ws_auth_success");
      } else {
        await this.handleAuthenticationFailure(
          context,
          new Error(authResult.error || "Authentication failed")
        );
      }
    } catch (error) {
      this.logger.error("WebSocket authentication error", error as Error, {
        connectionId: context.connectionId,
        messageType: context.message.type,
        userId: context.userId,
      });

      await this.recordMetric("ws_auth_error");
      await this.handleAuthenticationFailure(context, error as Error);
    } finally {
      const duration = performance.now() - startTime;
      await this.recordTimer("ws_auth_duration", duration);
    }
  }

  /**
   * Authenticate WebSocket connection using available credentials
   */
  private async authenticateConnection(context: WebSocketContext): Promise<{
    authenticated: boolean;
    payload?: JWTPayload;
    error?: string;
  }> {
    const { headers, query } = context.metadata;

    try {
      // Try JWT token authentication first
      const token = this.extractBearerToken(headers, query);
      if (token) {
        const verificationResult = await this.jwtService.verifyAccessToken(
          token
        );
        if (verificationResult.valid && verificationResult.payload) {
          const payload = verificationResult.payload;
          this.logger.debug("WebSocket connection authenticated via JWT", {
            connectionId: context.connectionId,
            userId: payload.sub,
            role: payload.role,
            permissions: payload.permissions?.length || 0,
          });

          return {
            authenticated: true,
            payload,
          };
        }
      }

      // Try API key authentication if token fails
      const apiKey = this.extractApiKey(headers, query);
      if (apiKey) {
        const apiKeyResult = await this.authenticateWithApiKey(context, apiKey);
        if (apiKeyResult.authenticated && apiKeyResult.payload) {
          return apiKeyResult;
        }
      }

      // Check if authentication is required
      if (this.config.requireAuth) {
        return {
          authenticated: false,
          error: "Authentication required: No valid token or API key provided",
        };
      }

      // Allow unauthenticated connection if not required
      return {
        authenticated: true,
        payload: {
          sub: "anonymous",
          email: "anonymous@system",
          role: "customer" as const,
          permissions: ["websocket:connect"],
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
      };
    } catch (error) {
      return {
        authenticated: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Extract Bearer token from headers or query parameters
   */
  private extractBearerToken(
    headers: Record<string, string>,
    query: Record<string, string>
  ): string | null {
    // Try Authorization header first
    const authHeader = headers["authorization"] || headers["Authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    // Try query parameters as fallback
    return query["token"] || query["access_token"] || null;
  }

  /**
   * Extract API key from headers or query parameters
   */
  private extractApiKey(
    headers: Record<string, string>,
    query: Record<string, string>
  ): string | null {
    const apiKeyHeader = this.config.apiKeyHeader || "x-api-key";
    return headers[apiKeyHeader] || query["api_key"] || null;
  }

  /**
   * Authenticate using API key with database validation
   */
  private async authenticateWithApiKey(
    context: WebSocketContext,
    apiKey: string
  ): Promise<{
    authenticated: boolean;
    payload?: JWTPayload;
    error?: string;
  }> {
    try {
      // Validate API key format
      if (!apiKey || apiKey.length < 32) {
        throw new Error("Invalid API key format");
      }

      // Query database for API key validation
      const apiKeyData = await DatabaseUtils.exportData(
        "api_keys",
        {
          key: apiKey,
          is_active: true,
          expires_at: { operator: ">", value: new Date().toISOString() },
        },
        {
          select: ["id", "user_id", "name", "permissions", "last_used_at"],
          limit: 1,
        }
      );

      if (!apiKeyData || apiKeyData.length === 0) {
        throw new Error("Invalid or expired API key");
      }

      const keyRecord = apiKeyData[0];

      // Get user details
      const userData = await DatabaseUtils.exportData(
        "users",
        {
          id: keyRecord.user_id,
        },
        {
          select: ["id", "email", "role", "store_id"],
          limit: 1,
        }
      );

      if (!userData || userData.length === 0) {
        throw new Error("API key user not found");
      }

      const user = userData[0];

      // Update API key last used timestamp
      await DatabaseUtils.storeFeatures(
        `api_key_usage_${keyRecord.id}`,
        {
          last_used_at: new Date().toISOString(),
          connection_type: "websocket",
          connection_id: context.connectionId,
        },
        {
          cacheKeyPrefix: "api_usage",
          cacheTTL: 300,
        }
      );

      const payload: JWTPayload = {
        sub: user.id,
        email: user.email,
        storeId: user.store_id,
        role: user.role as JWTPayload["role"],
        permissions: Array.isArray(keyRecord.permissions)
          ? keyRecord.permissions
          : [],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour for API key sessions
      };

      this.logger.debug("WebSocket connection authenticated via API key", {
        connectionId: context.connectionId,
        userId: payload.sub,
        apiKeyId: keyRecord.id,
        apiKeyName: keyRecord.name,
      });

      return {
        authenticated: true,
        payload,
      };
    } catch (error) {
      this.logger.warn("API key authentication failed", {
        connectionId: context.connectionId,
        error: (error as Error).message,
      });

      return {
        authenticated: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Check message-level authorization based on user roles and permissions
   */
  private async checkMessageAuthorization(
    context: WebSocketContext
  ): Promise<void> {
    const messageType = context.message.type;

    // Check if message type requires specific permissions
    if (
      this.config.messagePermissions &&
      this.config.messagePermissions[messageType]
    ) {
      const requiredPermissions = this.config.messagePermissions[messageType];
      const hasPermission = requiredPermissions.some((permission) =>
        context.userPermissions?.includes(permission)
      );

      if (!hasPermission) {
        throw new Error(
          `Insufficient permissions for message type: ${messageType}. Required: ${requiredPermissions.join(
            ", "
          )}`
        );
      }
    }

    // Check if message type requires specific roles
    if (this.config.messageRoles && this.config.messageRoles[messageType]) {
      const requiredRoles = this.config.messageRoles[messageType];
      const hasRole = requiredRoles.some((role) =>
        context.userRoles?.includes(role)
      );

      if (!hasRole) {
        throw new Error(
          `Insufficient role for message type: ${messageType}. Required: ${requiredRoles.join(
            ", "
          )}`
        );
      }
    }

    // Log successful authorization
    this.logger.debug("Message authorization passed", {
      connectionId: context.connectionId,
      messageType,
      userId: context.userId,
      userRole: context.userRoles?.[0],
      permissionCount: context.userPermissions?.length || 0,
    });
  }

  /**
   * Check if authentication should be skipped for this message type
   */
  private shouldSkipAuthentication(context: WebSocketContext): boolean {
    const messageType = context.message.type;
    const skipTypes = this.config.skipAuthenticationForTypes || [];

    return skipTypes.includes(messageType);
  }

  /**
   * Handle authentication failure with proper error response
   */
  private async handleAuthenticationFailure(
    context: WebSocketContext,
    error?: Error
  ): Promise<void> {
    const errorMessage = error?.message || "Authentication failed";
    const errorCode = this.getAuthErrorCode(errorMessage);

    await this.recordMetric("ws_auth_failed");

    // Send structured authentication error response
    this.sendResponse(context, {
      type: "auth_error",
      error: {
        code: errorCode,
        message: errorMessage,
        timestamp: new Date().toISOString(),
      },
      connectionId: context.connectionId,
    });

    // Close connection if configured to do so (default: true for security)
    if (this.config.closeOnAuthFailure !== false) {
      this.logger.info(
        "Closing WebSocket connection due to authentication failure",
        {
          connectionId: context.connectionId,
          error: errorMessage,
          errorCode,
        }
      );

      // Use appropriate WebSocket close codes
      const closeCode = errorCode === "TOKEN_EXPIRED" ? 1008 : 1008; // Policy violation
      context.ws.close(closeCode, `Authentication failed: ${errorMessage}`);
    }
  }

  /**
   * Map error messages to standardized error codes
   */
  private getAuthErrorCode(errorMessage: string): string {
    if (errorMessage.includes("expired")) return "TOKEN_EXPIRED";
    if (errorMessage.includes("Invalid token")) return "TOKEN_INVALID";
    if (errorMessage.includes("API key")) return "API_KEY_INVALID";
    if (errorMessage.includes("permissions")) return "INSUFFICIENT_PERMISSIONS";
    if (errorMessage.includes("role")) return "INSUFFICIENT_ROLE";
    return "AUTH_FAILED";
  }

  /**
   * Create factory function for easy instantiation
   */
  static create(
    config: WebSocketAuthConfig,
    logger: Logger,
    metrics?: MetricsCollector
  ): WebSocketMiddlewareFunction {
    const middleware = new WebSocketAuthMiddleware(config, logger, metrics);
    return middleware.middleware();
  }
}
