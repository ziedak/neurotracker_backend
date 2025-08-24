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
  UnifiedSessionManager,
  type EnterpriseSessionData as SessionData,
  type SessionCreateOptions,
  type SessionUpdateData,
  SessionAuthMethod,
  PermissionService,
  DEFAULT_PERMISSION_SERVICE_CONFIG,
} from "@libs/auth";
import { DatabaseUtils } from "@libs/database";

/**
 * Authentication result interface
 */
interface AuthenticationResult {
  authenticated: boolean;
  payload?: JWTPayload;
  error?: string;
  authMethod?: SessionAuthMethod;
}

/**
 * Extended WebSocket context with session data
 */
export interface WebSocketSessionContext extends WebSocketContext {
  session?: SessionData;
  sessionId?: string;
  authMethod?: SessionAuthMethod;
  // Enterprise PermissionService integration fields
  cachedPermissions?: Map<string, any>; // PermissionCheckResult from permission service
  resolvedPermissions?: any[]; // Permission[] from permission service
  userRoles?: string[];
}

// Export the enhanced context type
export type { WebSocketSessionContext as EnhancedWebSocketContext };

/**
 * Production-grade WebSocket Authentication Middleware with Session Management
 * Integrates with existing auth infrastructure and UnifiedSessionManager for secure WebSocket connections
 */
export class WebSocketAuthMiddleware extends BaseWebSocketMiddleware<WebSocketAuthConfig> {
  private readonly jwtService: EnhancedJWTService;
  private readonly sessionManager: UnifiedSessionManager;
  private readonly permissionService: PermissionService;

  constructor(
    config: WebSocketAuthConfig,
    sessionManager: UnifiedSessionManager,
    logger: Logger = Logger.getInstance("WebSocketAuthMiddleware"),
    metrics?: MetricsCollector,
    permissionService?: PermissionService
  ) {
    super("websocket-auth", config, logger, metrics);
    this.jwtService = EnhancedJWTService.getInstance();
    this.sessionManager = sessionManager;
    this.permissionService =
      permissionService ||
      new PermissionService(
        DEFAULT_PERMISSION_SERVICE_CONFIG, // Enterprise config with cache, hierarchy, conditions
        logger,
        metrics || MetricsCollector.getInstance()
        // database parameter is optional - will use MockPermissionDatabase for now
      );
  }

  /**
   * Execute authentication checks for WebSocket connections with session management
   */
  async execute(
    context: WebSocketSessionContext,
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

      // Check for existing session first (session-based auth)
      const sessionResult = await this.authenticateWithSession(context);

      if (sessionResult.authenticated && sessionResult.session) {
        await this.setAuthenticatedContext(
          context,
          sessionResult.session,
          SessionAuthMethod.SESSION_TOKEN
        );
        await this.checkMessageAuthorization(context);
        await next();

        // Update session activity
        await this.updateSessionActivity(sessionResult.session.sessionId);
        await this.recordMetric("ws_auth_success");
        return;
      }

      // If no session, try other authentication methods
      const authResult = await this.authenticateConnection(context);

      if (authResult.authenticated && authResult.payload) {
        // Create session for successful authentication
        const session = await this.createSessionFromAuth(context, authResult);
        await this.setAuthenticatedContext(
          context,
          session,
          authResult.authMethod || SessionAuthMethod.JWT
        );

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
   * Authenticate using existing session
   */
  private async authenticateWithSession(
    context: WebSocketSessionContext
  ): Promise<{
    authenticated: boolean;
    session?: SessionData;
    error?: string;
  }> {
    try {
      // Try to extract session ID from various sources
      const sessionId = this.extractSessionId(context);

      if (!sessionId) {
        return { authenticated: false, error: "No session ID provided" };
      }

      // Get session from UnifiedSessionManager
      const session = await this.sessionManager.getSession(sessionId);

      if (!session) {
        return { authenticated: false, error: "Session not found" };
      }

      // Check if session is expired
      if (session.expiresAt < new Date()) {
        // Clean up expired session
        await this.sessionManager.deleteSession(sessionId);
        return { authenticated: false, error: "Session expired" };
      }

      // Check if session supports WebSocket protocol
      if (session.protocol !== "websocket" && session.protocol !== "both") {
        // Upgrade session to support both protocols
        await this.sessionManager.updateSession(sessionId, {
          protocol: "both" as any,
          connectionId: context.connectionId,
        });

        // Refresh session data
        const updatedSession = await this.sessionManager.getSession(sessionId);
        return {
          authenticated: true,
          session: updatedSession || session,
        };
      }

      this.logger.debug(
        "WebSocket connection authenticated via existing session",
        {
          connectionId: context.connectionId,
          sessionId: session.sessionId,
          userId: session.userId,
          protocol: session.protocol,
        }
      );

      return { authenticated: true, session };
    } catch (error) {
      this.logger.error("Session authentication failed", error as Error, {
        connectionId: context.connectionId,
      });

      return {
        authenticated: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Extract session ID from WebSocket context
   */
  private extractSessionId(context: WebSocketSessionContext): string | null {
    const { headers, query } = context.metadata;

    // Try session cookie first
    const cookieHeader = headers["cookie"];
    if (cookieHeader) {
      const sessionMatch = cookieHeader.match(/sessionId=([^;]+)/);
      if (sessionMatch && sessionMatch[1] !== undefined) {
        return sessionMatch[1];
      }
      return null;
    }

    // Try authorization header with session: prefix
    const authHeader = headers["authorization"] || headers["Authorization"];
    if (authHeader && authHeader.startsWith("Session ")) {
      return authHeader.substring(8);
    }

    // Try query parameters
    return query["sessionId"] || query["session_id"] || null;
  }

  /**
   * Set authenticated context with session data
   */
  private async setAuthenticatedContext(
    context: WebSocketSessionContext,
    session: SessionData,
    authMethod: SessionAuthMethod
  ): Promise<void> {
    context.authenticated = true;
    context.userId = session.userId;
    context.sessionId = session.sessionId;
    context.session = session;
    context.authMethod = authMethod;

    // Load user permissions and roles from session or database
    const userDetails = await this.getUserDetails(session.userId);
    context.userRoles = userDetails.roles || [];
    context.userPermissions = userDetails.permissions || [];

    // Preload permissions using Enterprise PermissionService for optimal performance
    await this.preloadUserPermissions(context);

    this.logger.debug(
      "WebSocket context authenticated with Enterprise permissions",
      {
        connectionId: context.connectionId,
        sessionId: session.sessionId,
        userId: session.userId,
        authMethod,
        roles: context.userRoles,
        permissions: context.userPermissions?.length || 0,
        cachedPermissions: context.cachedPermissions?.size || 0,
        resolvedPermissions: context.resolvedPermissions?.length || 0,
      }
    );
  }

  /**
   * Create session from authentication result
   */
  private async createSessionFromAuth(
    context: WebSocketSessionContext,
    authResult: AuthenticationResult
  ): Promise<SessionData> {
    if (!authResult.payload) {
      throw new Error("No payload in authentication result");
    }

    const sessionOptions: SessionCreateOptions = {
      protocol: "websocket" as any,
      authMethod: authResult.authMethod || SessionAuthMethod.JWT,
      ipAddress: context.metadata.clientIp,
      userAgent: context.metadata.userAgent,
      origin: context.metadata.headers["origin"],
      connectionId: context.connectionId,
      expirationHours: 24, // Default 24 hours
      deviceInfo: {
        deviceType: this.detectDeviceType(context.metadata.userAgent),
        os: this.extractOS(context.metadata.userAgent) ?? "unknown",
        browser: this.extractBrowser(context.metadata.userAgent) ?? "unknown",
      },
    };

    const session = await this.sessionManager.createSession(
      authResult.payload.sub,
      sessionOptions
    );

    this.logger.info("Session created for WebSocket connection", {
      connectionId: context.connectionId,
      sessionId: session.sessionId,
      userId: session.userId,
      authMethod: authResult.authMethod,
    });

    return session;
  }

  /**
   * Update session activity timestamp
   */
  private async updateSessionActivity(sessionId: string): Promise<void> {
    try {
      await this.sessionManager.updateSession(sessionId, {
        lastActivity: new Date(),
      });
    } catch (error) {
      this.logger.warn("Failed to update session activity", {
        sessionId,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get user details for context population
   */
  private async getUserDetails(userId: string): Promise<{
    roles: string[];
    permissions: string[];
  }> {
    try {
      // This should ideally be cached or optimized
      const userData = await DatabaseUtils.exportData(
        "users",
        { id: userId },
        {
          select: ["id", "role", "permissions"],
          limit: 1,
        }
      );

      if (!userData || userData.length === 0) {
        return { roles: [], permissions: [] };
      }

      const user = userData[0];
      return {
        roles: user.role ? [user.role] : [],
        permissions: Array.isArray(user.permissions) ? user.permissions : [],
      };
    } catch (error) {
      this.logger.error("Failed to load user details", error as Error, {
        userId,
      });
      return { roles: [], permissions: [] };
    }
  }

  /**
   * Extract device type from user agent
   */
  private detectDeviceType(
    userAgent?: string
  ): "desktop" | "mobile" | "tablet" | "server" | "unknown" {
    if (!userAgent) return "unknown";

    const ua = userAgent.toLowerCase();
    if (
      ua.includes("mobile") ||
      ua.includes("android") ||
      ua.includes("iphone")
    ) {
      return "mobile";
    }
    if (ua.includes("tablet") || ua.includes("ipad")) {
      return "tablet";
    }
    if (ua.includes("bot") || ua.includes("crawler") || ua.includes("spider")) {
      return "server";
    }
    return "desktop";
  }

  /**
   * Extract OS from user agent
   */
  private extractOS(userAgent?: string): string | undefined {
    if (!userAgent) return undefined;

    const ua = userAgent.toLowerCase();
    if (ua.includes("windows")) return "Windows";
    if (ua.includes("mac")) return "macOS";
    if (ua.includes("linux")) return "Linux";
    if (ua.includes("android")) return "Android";
    if (ua.includes("ios")) return "iOS";

    return undefined;
  }

  /**
   * Extract browser from user agent
   */
  private extractBrowser(userAgent?: string): string | undefined {
    if (!userAgent) return undefined;

    const ua = userAgent.toLowerCase();
    if (ua.includes("chrome")) return "Chrome";
    if (ua.includes("firefox")) return "Firefox";
    if (ua.includes("safari")) return "Safari";
    if (ua.includes("edge")) return "Edge";

    return undefined;
  }
  private async authenticateConnection(
    context: WebSocketSessionContext
  ): Promise<AuthenticationResult> {
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
            authMethod: SessionAuthMethod.JWT,
          };
        }
      }

      // Try API key authentication if token fails
      const apiKey = this.extractApiKey(headers, query);
      if (apiKey) {
        const apiKeyResult = await this.authenticateWithApiKey(context, apiKey);
        if (apiKeyResult.authenticated && apiKeyResult.payload) {
          return {
            ...apiKeyResult,
            authMethod: SessionAuthMethod.API_KEY,
          };
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
        authMethod: SessionAuthMethod.SESSION_TOKEN,
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
    context: WebSocketSessionContext,
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
   * Enhanced message-level authorization using Enterprise PermissionService
   * Leverages hierarchical permissions, conditions, and detailed evaluation
   */
  private async checkMessageAuthorization(
    context: WebSocketSessionContext
  ): Promise<void> {
    const messageType = context.message.type;
    const userId = context.userId;

    if (!userId) {
      throw new Error("User ID required for permission checking");
    }

    try {
      // Check if message type requires specific permissions using Enterprise service
      if (
        this.config.messagePermissions &&
        this.config.messagePermissions[messageType]
      ) {
        const requiredPermissions = this.config.messagePermissions[messageType];

        // Use Enterprise PermissionService for advanced permission checking
        for (const permission of requiredPermissions) {
          // Check cached permissions first for optimal performance
          let permissionCheck = context.cachedPermissions?.get(permission);

          if (!permissionCheck) {
            // Fallback to live permission check if not cached
            permissionCheck = await this.permissionService.checkUserPermission(
              userId,
              permission,
              {
                resource: `websocket.message.${messageType}`,
                action: "send",
                context: {
                  connectionId: context.connectionId,
                  sessionId: context.sessionId,
                  messageType,
                  timestamp: new Date(),
                  // Note: clientIp and userAgent would come from connection context if available
                },
              }
            );
          }

          if (!permissionCheck.allowed) {
            this.logger.warn(
              "Message authorization denied by Enterprise PermissionService",
              {
                userId,
                messageType,
                permission,
                evaluationPath: permissionCheck.evaluationPath,
                matchedPermissions: permissionCheck.matchedPermissions.length,
                evaluationTime: permissionCheck.evaluationTime,
                cached: permissionCheck.cached,
              }
            );

            throw new Error(
              `Access denied for message type: ${messageType}. Missing permission: ${permission}. ` +
                `Evaluation: ${permissionCheck.evaluationPath.join(" → ")}`
            );
          }

          // Log successful permission check with detailed metrics
          this.logger.debug("Message permission granted", {
            userId,
            messageType,
            permission,
            roles: permissionCheck.roles,
            matchedPermissions: permissionCheck.matchedPermissions.length,
            evaluationTime: permissionCheck.evaluationTime,
            cached: permissionCheck.cached,
            conditions: permissionCheck.conditions.length,
          });
        }
      }

      // Enhanced role-based checking (fallback/additional layer)
      if (this.config.messageRoles && this.config.messageRoles[messageType]) {
        const requiredRoles = this.config.messageRoles[messageType];

        // Get user's resolved permissions to check roles through Enterprise service
        const userPermissions = await this.permissionService.getUserPermissions(
          userId
        );
        const userRoles = new Set(
          userPermissions.flatMap((p) => p.metadata?.tags || [])
        );

        const hasRole = requiredRoles.some((role) => userRoles.has(role));

        if (!hasRole) {
          this.logger.warn(
            "Message authorization denied - insufficient roles",
            {
              userId,
              messageType,
              requiredRoles,
              userRoles: Array.from(userRoles),
            }
          );

          throw new Error(
            `Insufficient role privileges for message type: ${messageType}. Required roles: ${requiredRoles.join(
              ", "
            )}`
          );
        }
      }
    } catch (error) {
      // Record authorization failure metrics
      if (this.metrics) {
        await this.metrics.recordCounter(
          "websocket_message_authorization_denied",
          1,
          {
            messageType,
            userId,
            error: (error as Error).message,
          }
        );
      }

      throw error;
    }

    // Record successful authorization
    if (this.metrics) {
      await this.metrics.recordCounter(
        "websocket_message_authorization_granted",
        1,
        {
          messageType,
          userId,
        }
      );
    }
  }

  /**
   * Advanced permission preloading using Enterprise PermissionService
   * Leverages batch permission checking and caching for optimal performance
   */
  private async preloadUserPermissions(
    context: WebSocketSessionContext
  ): Promise<void> {
    if (!context.userId) return;

    try {
      // Get all possible message permissions that might be needed
      const allMessagePermissions = new Set<string>();

      if (this.config.messagePermissions) {
        Object.values(this.config.messagePermissions).forEach((permissions) => {
          permissions.forEach((permission) =>
            allMessagePermissions.add(permission)
          );
        });
      }

      if (allMessagePermissions.size > 0) {
        // Use batch permission checking for better performance
        const batchResult =
          await this.permissionService.batchCheckUserPermissions(
            context.userId,
            Array.from(allMessagePermissions),
            {
              connectionId: context.connectionId,
              sessionId: context.sessionId,
              preloadCache: true, // Enable caching for subsequent checks
            }
          );

        // Store results in context for quick access
        context.cachedPermissions = new Map(batchResult.results);

        // Log performance metrics
        this.logger.debug(
          "User permissions preloaded via Enterprise PermissionService",
          {
            userId: context.userId,
            permissionCount: allMessagePermissions.size,
            totalChecks: batchResult.totalChecks,
            allowedCount: batchResult.allowedCount,
            deniedCount: batchResult.deniedCount,
            cacheHitRate: batchResult.cacheHitRate,
            totalEvaluationTime: batchResult.totalEvaluationTime,
          }
        );
      }

      // Also preload user's full permission set with hierarchy resolution
      const userPermissions = await this.permissionService.getUserPermissions(
        context.userId
      );
      context.resolvedPermissions = userPermissions;

      // Extract roles from permission metadata for role-based checks
      const userRoles = new Set<string>();
      userPermissions.forEach((permission) => {
        if (permission.metadata?.tags) {
          permission.metadata.tags.forEach((tag) => userRoles.add(tag));
        }
      });
      context.userRoles = Array.from(userRoles);
    } catch (error) {
      this.logger.warn("Failed to preload user permissions", {
        userId: context.userId,
        error: (error as Error).message,
      });

      // Don't throw - fallback to individual permission checks
    }
  }

  /**
      userId: context.userId,
      userRole: context.userRoles?.[0],
      permissionCount: context.userPermissions?.length || 0,
    });
  }

  /**
   * Check if authentication should be skipped for this message type
   */
  private shouldSkipAuthentication(context: WebSocketSessionContext): boolean {
    const messageType = context.message.type;
    const skipTypes = this.config.skipAuthenticationForTypes || [];

    return skipTypes.includes(messageType);
  }

  /**
   * Handle authentication failure with proper error response
   */
  private async handleAuthenticationFailure(
    context: WebSocketSessionContext,
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
    sessionManager: UnifiedSessionManager,
    logger: Logger,
    metrics?: MetricsCollector
  ): WebSocketMiddlewareFunction {
    const middleware = new WebSocketAuthMiddleware(
      config,
      sessionManager,
      logger,
      metrics
    );
    return middleware.middleware();
  }
}
