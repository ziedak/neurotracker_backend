/**
 * WebSocket Authentication Middleware
 * Production-grade WebSocket authentication middleware following AbstractMiddleware patterns
 * Integrates with @libs/auth for comprehensive authentication and authorization
 */

import { type IMetricsCollector } from "@libs/monitoring";
import {
  BaseWebSocketMiddleware,
  type WebSocketMiddlewareConfig,
} from "../base";
import type { WebSocketContext } from "../types";
import {
  type AuthenticationService,
  type User,
  type AuthContext,
  UnauthorizedError,
  ForbiddenError,
  type Action,
  type Resource,
} from "@libs/auth";

/**
 * WebSocket authentication middleware configuration interface
 * Extends WebSocketMiddlewareConfig with authentication-specific options
 */
export interface AuthWebSocketMiddlewareConfig
  extends WebSocketMiddlewareConfig {
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
  readonly messageActions?: Record<
    string,
    { action: Action; resource: Resource }
  >;
  readonly authenticationTimeout?: number;
  readonly reauthenticationInterval?: number;
  readonly allowUnauthenticatedTypes?: readonly string[];
}

/**
 * Default WebSocket authentication middleware configuration constants
 */
const DEFAULT_WS_AUTH_OPTIONS = {
  REQUIRE_AUTH: true,
  ALLOW_ANONYMOUS: false,
  SKIP_AUTH_MESSAGE_TYPES: ["ping", "pong", "heartbeat"] as const,
  CLOSE_ON_AUTH_FAILURE: true,
  API_KEY_AUTH: true,
  JWT_AUTH: true,
  SESSION_AUTH: false,
  STRICT_MODE: true,
  EXTRACT_USER_INFO: true,
  AUTHENTICATION_TIMEOUT: 30000, // 30 seconds
  REAUTHENTICATION_INTERVAL: 3600000, // 1 hour
  PRIORITY: 5, // High priority for auth
} as const;

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
export class AuthWebSocketMiddleware extends BaseWebSocketMiddleware<AuthWebSocketMiddlewareConfig> {
  private readonly authenticatedConnections = new Map<
    string,
    AuthenticatedConnection
  >();

  constructor(
    metrics: IMetricsCollector,
    private readonly authService: AuthenticationService,
    config: Partial<AuthWebSocketMiddlewareConfig> = {}
  ) {
    // Create complete configuration with validated defaults
    const completeConfig = {
      name: config.name || "websocket-auth",
      enabled: config.enabled ?? true,
      priority: config.priority ?? DEFAULT_WS_AUTH_OPTIONS.PRIORITY,
      requireAuth: config.requireAuth ?? DEFAULT_WS_AUTH_OPTIONS.REQUIRE_AUTH,
      roles: config.roles || [],
      permissions: config.permissions || [],
      action: config.action,
      resource: config.resource,
      allowAnonymous:
        config.allowAnonymous ?? DEFAULT_WS_AUTH_OPTIONS.ALLOW_ANONYMOUS,
      skipAuthMessageTypes:
        config.skipAuthMessageTypes ||
        DEFAULT_WS_AUTH_OPTIONS.SKIP_AUTH_MESSAGE_TYPES,
      skipMessageTypes: [
        ...(config.skipMessageTypes || []),
        ...(config.skipAuthMessageTypes || []),
      ],
      closeOnAuthFailure:
        config.closeOnAuthFailure ??
        DEFAULT_WS_AUTH_OPTIONS.CLOSE_ON_AUTH_FAILURE,
      apiKeyAuth: config.apiKeyAuth ?? DEFAULT_WS_AUTH_OPTIONS.API_KEY_AUTH,
      jwtAuth: config.jwtAuth ?? DEFAULT_WS_AUTH_OPTIONS.JWT_AUTH,
      sessionAuth: config.sessionAuth ?? DEFAULT_WS_AUTH_OPTIONS.SESSION_AUTH,
      strictMode: config.strictMode ?? DEFAULT_WS_AUTH_OPTIONS.STRICT_MODE,
      extractUserInfo:
        config.extractUserInfo ?? DEFAULT_WS_AUTH_OPTIONS.EXTRACT_USER_INFO,
      messagePermissions: config.messagePermissions || {},
      messageRoles: config.messageRoles || {},
      messageActions: config.messageActions || {},
      authenticationTimeout:
        config.authenticationTimeout ??
        DEFAULT_WS_AUTH_OPTIONS.AUTHENTICATION_TIMEOUT,
      reauthenticationInterval:
        config.reauthenticationInterval ??
        DEFAULT_WS_AUTH_OPTIONS.REAUTHENTICATION_INTERVAL,
      allowUnauthenticatedTypes: config.allowUnauthenticatedTypes || [],
    } as AuthWebSocketMiddlewareConfig;

    super(metrics, completeConfig);
    this.validateConfiguration();
    this.startCleanupTimer();
  }

  /**
   * Core WebSocket authentication middleware execution logic
   * Handles connection-level and message-level authentication and authorization
   */
  protected async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      // Check if message type allows unauthenticated access
      if (
        this.config.allowUnauthenticatedTypes?.includes(context.message.type)
      ) {
        this.logger.debug("Message type allows unauthenticated access", {
          requestId,
          messageType: context.message.type,
          connectionId: context.connectionId,
        });
        await next();
        return;
      }

      // Attempt authentication for the connection
      const authResult = await this.authenticateConnection(context, requestId);

      // Enrich context with authentication information
      this.enrichContext(context, authResult);

      // Perform message-level authorization
      await this.authorizeMessage(context, authResult, requestId);

      // Continue to next middleware
      await next();

      // Record successful request metrics
      await this.recordAuthMetrics("ws_auth_success", {
        method: authResult.method,
        userId: authResult.user?.id || "anonymous",
        messageType: context.message.type,
        connectionId: context.connectionId,
      });
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.recordMetric("ws_auth_error_duration", duration, {
        error_type: error instanceof Error ? error.constructor.name : "unknown",
        messageType: context.message.type,
        connectionId: context.connectionId,
      });

      this.logger.error(
        "WebSocket authentication middleware error",
        error as Error,
        {
          requestId,
          messageType: context.message.type,
          connectionId: context.connectionId,
          duration: Math.round(duration),
        }
      );

      // Handle authentication failures
      await this.handleAuthenticationFailure(context, error as Error);
      throw error;
    } finally {
      const executionTime = performance.now() - startTime;
      await this.recordMetric("ws_auth_execution_time", executionTime, {
        messageType: context.message.type,
        connectionId: context.connectionId,
      });
    }
  }

  /**
   * Authenticate WebSocket connection using multiple methods
   */
  private async authenticateConnection(
    context: WebSocketContext,
    requestId: string
  ): Promise<WebSocketAuthenticationResult> {
    const connectionId = context.connectionId;

    // Check if connection is already authenticated and valid
    const existingAuth = this.authenticatedConnections.get(connectionId);
    if (existingAuth && this.isAuthenticationValid(existingAuth)) {
      this.logger.debug("Using existing authentication", {
        requestId,
        connectionId,
        userId: existingAuth.user.id,
        method: existingAuth.method,
      });
      return {
        user: existingAuth.user,
        authContext: existingAuth.authContext,
        method: existingAuth.method,
        error: null,
      };
    }

    // Remove expired authentication
    if (existingAuth) {
      this.authenticatedConnections.delete(connectionId);
    }

    // Attempt fresh authentication
    const authResult = await this.performAuthentication(context, requestId);

    // Store successful authentication
    if (authResult.user && authResult.authContext) {
      this.authenticatedConnections.set(connectionId, {
        user: authResult.user,
        authContext: authResult.authContext,
        method: authResult.method,
        authenticatedAt: new Date(),
        lastActivity: new Date(),
        connectionId,
      });
    }

    return authResult;
  }

  /**
   * Perform authentication using multiple methods
   */
  private async performAuthentication(
    context: WebSocketContext,
    requestId: string
  ): Promise<WebSocketAuthenticationResult> {
    const results: WebSocketAuthenticationResult[] = [];

    // Try JWT authentication
    if (this.config.jwtAuth) {
      const jwtResult = await this.tryJWTAuthentication(context, requestId);
      if (jwtResult.user) {
        return jwtResult;
      }
      results.push(jwtResult);
    }

    // Try API key authentication
    if (this.config.apiKeyAuth) {
      const apiKeyResult = await this.tryApiKeyAuthentication(
        context,
        requestId
      );
      if (apiKeyResult.user) {
        return apiKeyResult;
      }
      results.push(apiKeyResult);
    }

    // Try session authentication
    if (this.config.sessionAuth) {
      const sessionResult = await this.trySessionAuthentication(
        context,
        requestId
      );
      if (sessionResult.user) {
        return sessionResult;
      }
      results.push(sessionResult);
    }

    // Handle authentication failure based on configuration
    if (this.config.requireAuth && !results.some((r) => r.user)) {
      return {
        user: null,
        authContext: null,
        method: "none",
        error: "Authentication required",
      };
    }

    // Return the first attempted result or anonymous result
    return (
      results[0] || {
        user: null,
        authContext: null,
        method: "anonymous",
        error: null,
      }
    );
  }

  /**
   * Try JWT token authentication from message payload or connection metadata
   */
  private async tryJWTAuthentication(
    context: WebSocketContext,
    requestId: string
  ): Promise<WebSocketAuthenticationResult> {
    try {
      // Try to extract token from message payload first
      let token = context.message.payload?.token;

      // Fallback to connection metadata headers
      if (!token) {
        const authHeader = context.metadata.headers["authorization"];
        token = this.authService
          .getJWTService()
          .extractTokenFromHeader(authHeader || "");
      }

      // Fallback to connection query parameters
      if (!token) {
        token = context.metadata.query["token"];
      }

      if (!token) {
        return {
          user: null,
          authContext: null,
          method: "jwt",
          error: "No JWT token found",
        };
      }

      const user = await this.authService.verifyToken(token);
      if (!user) {
        return {
          user: null,
          authContext: null,
          method: "jwt",
          error: "Invalid JWT token",
        };
      }

      const authContext = this.authService
        .getPermissionService()
        .createAuthContext(user);

      this.logger.debug("WebSocket JWT authentication successful", {
        requestId,
        connectionId: context.connectionId,
        userId: user.id,
        roles: user.roles,
      });

      return {
        user,
        authContext,
        method: "jwt",
        error: null,
      };
    } catch (error) {
      this.logger.warn("WebSocket JWT authentication failed", {
        error: error instanceof Error ? error.message : "unknown",
        requestId,
        connectionId: context.connectionId,
      });

      return {
        user: null,
        authContext: null,
        method: "jwt",
        error:
          error instanceof Error ? error.message : "JWT authentication failed",
      };
    }
  }

  /**
   * Try API key authentication from message headers or connection metadata
   */
  private async tryApiKeyAuthentication(
    context: WebSocketContext,
    requestId: string
  ): Promise<WebSocketAuthenticationResult> {
    try {
      // Try to extract API key from message payload
      let apiKey = context.message.payload?.apiKey;

      // Fallback to connection metadata headers
      if (!apiKey) {
        apiKey = context.metadata.headers["x-api-key"];
      }

      // Fallback to connection query parameters
      if (!apiKey) {
        apiKey = context.metadata.query["apiKey"];
      }

      if (!apiKey) {
        return {
          user: null,
          authContext: null,
          method: "api_key",
          error: "No API key found",
        };
      }

      const validationResult = await this.authService
        .getApiKeyService()
        .validateApiKey(apiKey);

      if (!validationResult) {
        return {
          user: null,
          authContext: null,
          method: "api_key",
          error: "Invalid API key",
        };
      }

      const user = await this.authService.getUserById(validationResult.userId);
      if (!user) {
        return {
          user: null,
          authContext: null,
          method: "api_key",
          error: "User not found for API key",
        };
      }

      const authContext = this.authService
        .getPermissionService()
        .createAuthContext(user);

      this.logger.debug("WebSocket API key authentication successful", {
        requestId,
        connectionId: context.connectionId,
        userId: user.id,
      });

      return {
        user,
        authContext,
        method: "api_key",
        error: null,
      };
    } catch (error) {
      this.logger.warn("WebSocket API key authentication failed", {
        error: error instanceof Error ? error.message : "unknown",
        requestId,
        connectionId: context.connectionId,
      });

      return {
        user: null,
        authContext: null,
        method: "api_key",
        error:
          error instanceof Error
            ? error.message
            : "API key authentication failed",
      };
    }
  }

  /**
   * Try session-based authentication from connection metadata
   */
  private async trySessionAuthentication(
    context: WebSocketContext,
    requestId: string
  ): Promise<WebSocketAuthenticationResult> {
    try {
      // Extract session ID from various sources
      const sessionId = this.extractSessionId(context);

      if (!sessionId) {
        return {
          user: null,
          authContext: null,
          method: "session",
          error: "No session ID found",
        };
      }

      // Validate session and get user
      const session = await this.authService
        .getSessionService()
        .getSession(sessionId);
      if (!session || !session.isActive) {
        return {
          user: null,
          authContext: null,
          method: "session",
          error: "Invalid or expired session",
        };
      }

      const user = await this.authService.getUserById(session.userId);
      if (!user) {
        return {
          user: null,
          authContext: null,
          method: "session",
          error: "User not found for session",
        };
      }

      const authContext = this.authService
        .getPermissionService()
        .createAuthContext(user);

      this.logger.debug("WebSocket session authentication successful", {
        requestId,
        connectionId: context.connectionId,
        userId: user.id,
        sessionId,
      });

      return {
        user,
        authContext,
        method: "session",
        error: null,
      };
    } catch (error) {
      this.logger.warn("WebSocket session authentication failed", {
        error: error instanceof Error ? error.message : "unknown",
        requestId,
        connectionId: context.connectionId,
      });

      return {
        user: null,
        authContext: null,
        method: "session",
        error:
          error instanceof Error
            ? error.message
            : "Session authentication failed",
      };
    }
  }

  /**
   * Perform message-level authorization checks
   */
  private async authorizeMessage(
    context: WebSocketContext,
    authResult: WebSocketAuthenticationResult,
    requestId: string
  ): Promise<void> {
    const messageType = context.message.type;

    // Check if authentication is required but missing
    if (this.config.requireAuth && !authResult.user) {
      await this.recordAuthMetrics("ws_auth_failure", {
        reason: "authentication_required",
        messageType,
        connectionId: context.connectionId,
      });
      throw new UnauthorizedError("Authentication required");
    }

    // If no user, skip authorization checks (assuming allowAnonymous is true)
    if (!authResult.user || !authResult.authContext) {
      if (this.config.requireAuth) {
        throw new UnauthorizedError("Authentication required");
      }
      return;
    }

    const user = authResult.user;

    // Check global role requirements
    if (this.config.roles && this.config.roles.length > 0) {
      const hasRequiredRole = this.config.roles.some((role) =>
        user.roles.includes(role)
      );
      if (!hasRequiredRole) {
        await this.recordAuthMetrics("ws_auth_failure", {
          reason: "insufficient_roles",
          userId: user.id,
          messageType,
          requiredRoles: this.config.roles.join(","),
          userRoles: user.roles.join(","),
        });
        throw new ForbiddenError("Insufficient role permissions");
      }
    }

    // Check message-specific role requirements
    const messageRoles = this.config.messageRoles?.[messageType];
    if (messageRoles && messageRoles.length > 0) {
      const hasMessageRole = messageRoles.some((role) =>
        user.roles.includes(role)
      );
      if (!hasMessageRole) {
        await this.recordAuthMetrics("ws_auth_failure", {
          reason: "insufficient_message_roles",
          userId: user.id,
          messageType,
          requiredRoles: messageRoles.join(","),
          userRoles: user.roles.join(","),
        });
        throw new ForbiddenError(
          `Insufficient role permissions for message type: ${messageType}`
        );
      }
    }

    // Check global permission requirements
    if (this.config.permissions && this.config.permissions.length > 0) {
      const hasRequiredPermission = this.config.permissions.some((permission) =>
        user.permissions.includes(permission)
      );
      if (!hasRequiredPermission) {
        await this.recordAuthMetrics("ws_auth_failure", {
          reason: "insufficient_permissions",
          userId: user.id,
          messageType,
          requiredPermissions: this.config.permissions.join(","),
        });
        throw new ForbiddenError("Insufficient permissions");
      }
    }

    // Check message-specific permission requirements
    const messagePermissions = this.config.messagePermissions?.[messageType];
    if (messagePermissions && messagePermissions.length > 0) {
      const hasMessagePermission = messagePermissions.some((permission) =>
        user.permissions.includes(permission)
      );
      if (!hasMessagePermission) {
        await this.recordAuthMetrics("ws_auth_failure", {
          reason: "insufficient_message_permissions",
          userId: user.id,
          messageType,
          requiredPermissions: messagePermissions.join(","),
        });
        throw new ForbiddenError(
          `Insufficient permissions for message type: ${messageType}`
        );
      }
    }

    // Check global CASL ability requirements
    if (this.config.action && this.config.resource) {
      const canPerform = this.authService.can(
        user,
        this.config.action,
        this.config.resource
      );
      if (!canPerform) {
        await this.recordAuthMetrics("ws_auth_failure", {
          reason: "insufficient_ability",
          userId: user.id,
          messageType,
          action: this.config.action,
          resource: this.config.resource,
        });
        throw new ForbiddenError("Insufficient permissions for this action");
      }
    }

    // Check message-specific CASL ability requirements
    const messageAction = this.config.messageActions?.[messageType];
    if (messageAction) {
      const canPerformMessage = this.authService.can(
        user,
        messageAction.action,
        messageAction.resource
      );
      if (!canPerformMessage) {
        await this.recordAuthMetrics("ws_auth_failure", {
          reason: "insufficient_message_ability",
          userId: user.id,
          messageType,
          action: messageAction.action,
          resource: messageAction.resource,
        });
        throw new ForbiddenError(
          `Insufficient permissions for message action: ${messageType}`
        );
      }
    }

    // Update last activity
    const connection = this.authenticatedConnections.get(context.connectionId);
    if (connection) {
      connection.lastActivity = new Date();
    }

    // Log successful authorization
    this.logger.debug("WebSocket message authorization successful", {
      requestId,
      userId: user.id,
      messageType,
      connectionId: context.connectionId,
      roles: user.roles,
      permissions: user.permissions,
    });
  }

  /**
   * Enrich context with authentication information
   */
  private enrichContext(
    context: WebSocketContext,
    authResult: WebSocketAuthenticationResult
  ): void {
    if (this.config.extractUserInfo) {
      context.authenticated = !!authResult.user;
      if (authResult.user) {
        context.userId = authResult.user.id;
        context.userRoles = authResult.user.roles;
        context.userPermissions = authResult.user.permissions;
        context["authContext"] = authResult.authContext;
        context["authMethod"] = authResult.method;
      }
    }
  }

  /**
   * Extract session ID from various sources in WebSocket context
   */
  private extractSessionId(context: WebSocketContext): string | null {
    // Check message payload first
    const payloadSessionId = context.message.payload?.sessionId;
    if (payloadSessionId) {
      return payloadSessionId;
    }

    // Check connection headers
    const sessionHeader = context.metadata.headers["x-session-id"];
    if (sessionHeader) {
      return sessionHeader;
    }

    // Check connection query parameters
    const querySessionId = context.metadata.query["sessionId"];
    if (querySessionId) {
      return querySessionId;
    }

    // Check cookies from headers
    const cookies = context.metadata.headers["cookie"];
    if (cookies) {
      const sessionCookieMatch = cookies.match(/sessionid=([^;]+)/);
      if (sessionCookieMatch && sessionCookieMatch[1]) {
        return sessionCookieMatch[1];
      }
    }

    return null;
  }

  /**
   * Check if existing authentication is still valid
   */
  private isAuthenticationValid(connection: AuthenticatedConnection): boolean {
    const now = new Date();
    const timeSinceAuth = now.getTime() - connection.authenticatedAt.getTime();
    const timeSinceActivity = now.getTime() - connection.lastActivity.getTime();

    const reauthInterval =
      this.config.reauthenticationInterval ||
      DEFAULT_WS_AUTH_OPTIONS.REAUTHENTICATION_INTERVAL;
    const authTimeout =
      this.config.authenticationTimeout ||
      DEFAULT_WS_AUTH_OPTIONS.AUTHENTICATION_TIMEOUT;

    // Check if authentication has expired
    if (timeSinceAuth > reauthInterval) {
      this.logger.debug("Authentication expired, reauthentication required", {
        connectionId: connection.connectionId,
        userId: connection.user.id,
        timeSinceAuth,
        reauthenticationInterval: reauthInterval,
      });
      return false;
    }

    // Check if connection has been inactive too long
    if (timeSinceActivity > authTimeout) {
      this.logger.debug("Connection inactive, authentication invalidated", {
        connectionId: connection.connectionId,
        userId: connection.user.id,
        timeSinceActivity,
        authenticationTimeout: authTimeout,
      });
      return false;
    }

    return true;
  }

  /**
   * Handle authentication failures
   */
  private async handleAuthenticationFailure(
    context: WebSocketContext,
    error: Error
  ): Promise<void> {
    if (
      this.config.closeOnAuthFailure &&
      (error instanceof UnauthorizedError || error instanceof ForbiddenError)
    ) {
      this.logger.warn(
        "Closing WebSocket connection due to authentication failure",
        {
          connectionId: context.connectionId,
          messageType: context.message.type,
          error: error.message,
        }
      );

      // Send error message before closing
      this.sendResponse(context, {
        type: "auth_error",
        error: error.message,
        code: error instanceof UnauthorizedError ? 401 : 403,
      });

      // Close connection
      try {
        context.ws.close(
          error instanceof UnauthorizedError ? 4401 : 4403,
          error.message
        );
      } catch (closeError) {
        this.logger.error(
          "Failed to close WebSocket connection",
          closeError as Error,
          {
            connectionId: context.connectionId,
          }
        );
      }

      // Remove from authenticated connections
      this.authenticatedConnections.delete(context.connectionId);
    }
  }

  /**
   * Generate unique request ID for WebSocket messages
   */
  private generateRequestId(): string {
    return `ws_auth_req_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 15)}`;
  }

  /**
   * Record authentication-specific metrics
   */
  private async recordAuthMetrics(
    action: string,
    additionalTags: Record<string, string> = {}
  ): Promise<void> {
    await this.recordMetric(`ws_${action}`, 1, additionalTags);
  }

  /**
   * Start cleanup timer for expired connections
   */
  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupExpiredConnections();
    }, 300000); // Cleanup every 5 minutes
  }

  /**
   * Clean up expired authenticated connections
   */
  private cleanupExpiredConnections(): void {
    const expiredConnections: string[] = [];

    for (const [connectionId, connection] of this.authenticatedConnections) {
      if (!this.isAuthenticationValid(connection)) {
        expiredConnections.push(connectionId);
      }
    }

    expiredConnections.forEach((connectionId) => {
      this.authenticatedConnections.delete(connectionId);
    });

    if (expiredConnections.length > 0) {
      this.logger.debug(
        "Cleaned up expired WebSocket authentication sessions",
        {
          expiredCount: expiredConnections.length,
          totalConnections: this.authenticatedConnections.size,
        }
      );
    }
  }

  /**
   * Validate configuration on instantiation
   */
  private validateConfiguration(): void {
    if (
      !this.config.jwtAuth &&
      !this.config.apiKeyAuth &&
      !this.config.sessionAuth
    ) {
      throw new Error("At least one authentication method must be enabled");
    }

    if (this.config.action && !this.config.resource) {
      throw new Error("Resource must be specified when action is provided");
    }

    if (this.config.resource && !this.config.action) {
      throw new Error("Action must be specified when resource is provided");
    }

    const authTimeout =
      this.config.authenticationTimeout ||
      DEFAULT_WS_AUTH_OPTIONS.AUTHENTICATION_TIMEOUT;
    const reauthInterval =
      this.config.reauthenticationInterval ||
      DEFAULT_WS_AUTH_OPTIONS.REAUTHENTICATION_INTERVAL;

    if (authTimeout < 1000) {
      throw new Error("Authentication timeout must be at least 1000ms");
    }

    if (reauthInterval < authTimeout) {
      throw new Error(
        "Reauthentication interval must be greater than authentication timeout"
      );
    }
  }

  /**
   * Get authentication statistics
   */
  public getAuthenticationStats(): {
    totalConnections: number;
    authenticatedConnections: number;
    authenticationMethods: Record<string, number>;
  } {
    const methods: Record<string, number> = {};

    for (const connection of this.authenticatedConnections.values()) {
      methods[connection.method] = (methods[connection.method] || 0) + 1;
    }

    return {
      totalConnections: this.authenticatedConnections.size,
      authenticatedConnections: this.authenticatedConnections.size,
      authenticationMethods: methods,
    };
  }

  /**
   * Manually invalidate authentication for a connection
   */
  public invalidateConnection(connectionId: string): boolean {
    return this.authenticatedConnections.delete(connectionId);
  }

  /**
   * Create require authentication configuration preset
   */
  static createRequireAuthConfig(): Partial<AuthWebSocketMiddlewareConfig> {
    return {
      name: "ws-auth-required",
      requireAuth: true,
      allowAnonymous: false,
      closeOnAuthFailure: true,
      enabled: true,
      priority: DEFAULT_WS_AUTH_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create optional authentication configuration preset
   */
  static createOptionalAuthConfig(): Partial<AuthWebSocketMiddlewareConfig> {
    return {
      name: "ws-auth-optional",
      requireAuth: false,
      allowAnonymous: true,
      closeOnAuthFailure: false,
      enabled: true,
      priority: DEFAULT_WS_AUTH_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create role-based authentication configuration preset
   */
  static createRoleBasedConfig(
    roles: string[]
  ): Partial<AuthWebSocketMiddlewareConfig> {
    return {
      name: "ws-auth-role-based",
      requireAuth: true,
      roles,
      allowAnonymous: false,
      closeOnAuthFailure: true,
      enabled: true,
      priority: DEFAULT_WS_AUTH_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create message-specific permission configuration preset
   */
  static createMessagePermissionConfig(
    messagePermissions: Record<string, readonly string[]>
  ): Partial<AuthWebSocketMiddlewareConfig> {
    return {
      name: "ws-auth-message-permissions",
      requireAuth: true,
      messagePermissions,
      allowAnonymous: false,
      closeOnAuthFailure: true,
      enabled: true,
      priority: DEFAULT_WS_AUTH_OPTIONS.PRIORITY,
    };
  }
}

/**
 * WebSocket authentication result interface
 */
interface WebSocketAuthenticationResult {
  user: User | null;
  authContext: AuthContext | null;
  method: string;
  error: string | null;
}

/**
 * Authenticated connection tracking interface
 */
interface AuthenticatedConnection {
  user: User;
  authContext: AuthContext;
  method: string;
  authenticatedAt: Date;
  lastActivity: Date;
  connectionId: string;
}

/**
 * Factory function for WebSocket authentication middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export function createAuthWebSocketMiddleware(
  metrics: IMetricsCollector,
  authService: AuthenticationService,
  config?: Partial<AuthWebSocketMiddlewareConfig>
): AuthWebSocketMiddleware {
  return new AuthWebSocketMiddleware(metrics, authService, config);
}

/**
 * Preset configurations for common WebSocket authentication scenarios
 * Immutable configuration objects for different environments and use cases
 */
export const WS_AUTH_PRESETS = {
  requireAuth: (): Partial<AuthWebSocketMiddlewareConfig> =>
    AuthWebSocketMiddleware.createRequireAuthConfig(),

  optionalAuth: (): Partial<AuthWebSocketMiddlewareConfig> =>
    AuthWebSocketMiddleware.createOptionalAuthConfig(),

  adminOnly: (): Partial<AuthWebSocketMiddlewareConfig> =>
    AuthWebSocketMiddleware.createRoleBasedConfig(["admin"]),

  userOrAdmin: (): Partial<AuthWebSocketMiddlewareConfig> =>
    AuthWebSocketMiddleware.createRoleBasedConfig(["user", "admin"]),

  realtimeChat: (): Partial<AuthWebSocketMiddlewareConfig> => ({
    name: "ws-auth-realtime-chat",
    requireAuth: true,
    jwtAuth: true,
    sessionAuth: true,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    allowUnauthenticatedTypes: ["ping", "pong"],
    messagePermissions: {
      send_message: ["chat:write"],
      delete_message: ["chat:delete"],
      moderate: ["chat:moderate"],
    },
    authenticationTimeout: 300000, // 5 minutes
    reauthenticationInterval: 3600000, // 1 hour
    enabled: true,
    priority: DEFAULT_WS_AUTH_OPTIONS.PRIORITY,
  }),

  apiAccess: (): Partial<AuthWebSocketMiddlewareConfig> => ({
    name: "ws-auth-api-access",
    requireAuth: true,
    apiKeyAuth: true,
    jwtAuth: false,
    sessionAuth: false,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    strictMode: true,
    allowUnauthenticatedTypes: ["ping"],
    authenticationTimeout: 600000, // 10 minutes
    enabled: true,
    priority: DEFAULT_WS_AUTH_OPTIONS.PRIORITY,
  }),

  development: (): Partial<AuthWebSocketMiddlewareConfig> => ({
    name: "ws-auth-development",
    requireAuth: false,
    allowAnonymous: true,
    closeOnAuthFailure: false,
    strictMode: false,
    allowUnauthenticatedTypes: ["ping", "pong", "heartbeat", "debug"],
    authenticationTimeout: 1800000, // 30 minutes
    enabled: true,
    priority: DEFAULT_WS_AUTH_OPTIONS.PRIORITY,
  }),

  production: (): Partial<AuthWebSocketMiddlewareConfig> => ({
    name: "ws-auth-production",
    requireAuth: true,
    allowAnonymous: false,
    closeOnAuthFailure: true,
    strictMode: true,
    allowUnauthenticatedTypes: ["ping", "pong"],
    authenticationTimeout: 300000, // 5 minutes
    reauthenticationInterval: 1800000, // 30 minutes
    enabled: true,
    priority: DEFAULT_WS_AUTH_OPTIONS.PRIORITY,
  }),
} as const;
