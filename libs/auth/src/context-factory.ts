/**
 * Factory for creating UnifiedAuthContext from various authentication sources
 * Integrates with Enterprise JWT Services for production-grade authentication
 */

import {
  EnhancedJWTService,
  type TokenVerificationResult,
} from "./services/enhanced-jwt-service-v2";
import { type JWTPayload } from "./types/jwt-types";
import {
  UnifiedAuthContext,
  UserIdentity,
  SessionData,
  AuthMethod,
  SessionProtocol,
  ContextCreateOptions,
} from "./unified-context";
import {
  UnifiedAuthContextBuilder,
  WebSocketContextInput,
} from "./context-builder";

/**
 * Authentication result from various sources
 */
export interface AuthResult {
  readonly success: boolean;
  readonly context?: UnifiedAuthContext;
  readonly error?: string;
  readonly errorCode?: string;
}

/**
 * Permission service interface (to be implemented)
 */
export interface PermissionService {
  getUserPermissions(userId: string): Promise<string[]>;
  getRolePermissions(role: string): Promise<string[]>;
}

/**
 * User service interface (to be implemented)
 */
export interface UserService {
  getUserById(userId: string): Promise<UserIdentity | null>;
  getUserByEmail(email: string): Promise<UserIdentity | null>;
}

/**
 * Session manager interface (to be implemented)
 */
export interface SessionManager {
  getSession(sessionId: string): Promise<SessionData | null>;
  createSession(userId: string, options: any): Promise<SessionData>;
  createAnonymousSession(options: any): Promise<SessionData>;
  getOrCreateSession(userId: string, options: any): Promise<SessionData>;
}

/**
 * Factory for creating UnifiedAuthContext from various sources
 */
export class AuthContextFactory {
  constructor(
    private jwtService: EnhancedJWTService,
    private permissionService: PermissionService,
    private userService: UserService,
    private sessionManager?: SessionManager,
    private logger?: any,
    private metrics?: any
  ) {}

  /**
   * Create authenticated context from JWT token
   */
  async fromJWTToken(
    token: string,
    protocolContext: any,
    options?: ContextCreateOptions
  ): Promise<AuthResult> {
    try {
      // Verify JWT token using EnhancedJWTService
      const verificationResult = await this.jwtService.verifyAccessToken(token);
      if (!verificationResult.valid || !verificationResult.payload) {
        return {
          success: false,
          error: "Invalid JWT token",
          errorCode: "INVALID_TOKEN",
        };
      }

      const payload = verificationResult.payload;

      // Get user permissions
      const permissions = await this.permissionService.getUserPermissions(
        payload.sub
      );

      // Create user identity from JWT payload
      const user: UserIdentity = {
        id: payload.sub,
        email: payload.email || "",
        storeId: payload.storeId,
        role: (payload.role as any) || "customer",
        status: "active", // Assume active if JWT is valid
      };

      // Create or get session if SessionManager is available
      let session: SessionData;
      if (this.sessionManager) {
        session = await this.sessionManager.getOrCreateSession(payload.sub, {
          authMethod: "jwt" as AuthMethod,
          protocol: this.detectProtocol(protocolContext),
          metadata: {
            tokenIssued: payload.iat,
            tokenExpires: payload.exp,
          },
        });
      } else {
        // Create temporary session data if no SessionManager
        const now = new Date();
        const issuedAt = payload.iat ? new Date(payload.iat * 1000) : now;
        const expiresAt = payload.exp
          ? new Date(payload.exp * 1000)
          : new Date(now.getTime() + 24 * 60 * 60 * 1000);

        session = {
          sessionId: `temp_${payload.sub}_${now.getTime()}`,
          userId: payload.sub,
          createdAt: issuedAt,
          lastActivity: now,
          expiresAt: expiresAt,
          protocol: this.detectProtocol(protocolContext),
          authMethod: "jwt",
          refreshCount: 0,
          metadata: {
            tokenIssued: payload.iat,
            tokenExpires: payload.exp,
          },
        };
      }

      // Build context
      const builder = this.createBuilder(protocolContext)
        .setAuthenticated(true)
        .setUser(user)
        .setPermissions(permissions)
        .setSession(session)
        .setTokens({
          accessToken: token,
          tokenType: "Bearer",
          expiresAt: payload.exp
            ? new Date(payload.exp * 1000)
            : new Date(Date.now() + 24 * 60 * 60 * 1000),
        });

      if (options) {
        builder.setOptions(options);
      }

      const context = builder.build();

      this.logger?.debug("JWT authentication successful", {
        userId: payload.sub,
        role: payload.role,
        sessionId: session.sessionId,
      });

      this.metrics?.increment("auth_jwt_success");

      return {
        success: true,
        context,
      };
    } catch (error) {
      this.logger?.error("JWT authentication failed", error as Error);
      this.metrics?.increment("auth_jwt_error");

      return {
        success: false,
        error: (error as Error).message,
        errorCode: "JWT_AUTH_FAILED",
      };
    }
  }

  /**
   * Create authenticated context from API key
   */
  async fromAPIKey(
    apiKey: string,
    protocolContext: any,
    options?: ContextCreateOptions
  ): Promise<AuthResult> {
    try {
      // This will integrate with the existing API key validation logic
      // For now, return a placeholder implementation

      // TODO: Implement API key validation
      // const apiKeyData = await this.validateAPIKey(apiKey);

      return {
        success: false,
        error: "API key authentication not yet implemented",
        errorCode: "NOT_IMPLEMENTED",
      };
    } catch (error) {
      this.logger?.error("API key authentication failed", error as Error);
      this.metrics?.increment("auth_api_key_error");

      return {
        success: false,
        error: (error as Error).message,
        errorCode: "API_KEY_AUTH_FAILED",
      };
    }
  }

  /**
   * Create context from existing session
   */
  async fromSessionId(
    sessionId: string,
    protocolContext: any,
    options?: ContextCreateOptions
  ): Promise<AuthResult> {
    try {
      if (!this.sessionManager) {
        return {
          success: false,
          error: "Session management not available",
          errorCode: "SESSION_MANAGER_UNAVAILABLE",
        };
      }

      const session = await this.sessionManager.getSession(sessionId);
      if (!session) {
        return {
          success: false,
          error: "Session not found",
          errorCode: "SESSION_NOT_FOUND",
        };
      }

      if (session.expiresAt < new Date()) {
        return {
          success: false,
          error: "Session expired",
          errorCode: "SESSION_EXPIRED",
        };
      }

      // Get user data and permissions
      const [user, permissions] = await Promise.all([
        this.userService.getUserById(session.userId),
        this.permissionService.getUserPermissions(session.userId),
      ]);

      if (!user) {
        return {
          success: false,
          error: "User not found",
          errorCode: "USER_NOT_FOUND",
        };
      }

      // Build context
      const builder = this.createBuilder(protocolContext)
        .setAuthenticated(true)
        .setUser(user)
        .setPermissions(permissions)
        .setSession(session);

      if (options) {
        builder.setOptions(options);
      }

      const context = builder.build();

      this.logger?.debug("Session authentication successful", {
        userId: session.userId,
        sessionId: session.sessionId,
      });

      this.metrics?.increment("auth_session_success");

      return {
        success: true,
        context,
      };
    } catch (error) {
      this.logger?.error("Session authentication failed", error as Error);
      this.metrics?.increment("auth_session_error");

      return {
        success: false,
        error: (error as Error).message,
        errorCode: "SESSION_AUTH_FAILED",
      };
    }
  }

  /**
   * Create anonymous context for public access
   */
  async createAnonymous(
    protocolContext: any,
    options?: ContextCreateOptions
  ): Promise<AuthResult> {
    try {
      // Create anonymous session if SessionManager is available
      let session: SessionData;
      if (this.sessionManager) {
        session = await this.sessionManager.createAnonymousSession({
          protocol: this.detectProtocol(protocolContext),
        });
      } else {
        // Create temporary anonymous session
        const now = new Date();
        const sessionId = `anon_${now.getTime()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        session = {
          sessionId,
          userId: "anonymous",
          createdAt: now,
          lastActivity: now,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours
          protocol: this.detectProtocol(protocolContext),
          authMethod: "anonymous",
          refreshCount: 0,
          metadata: {},
        };
      }

      // Build anonymous context
      const builder = this.createBuilder(protocolContext)
        .setAuthenticated(false)
        .setSession(session)
        .setPermissions(["public:read"]); // Default anonymous permissions

      if (options) {
        builder.setOptions(options);
      }

      const context = builder.build();

      this.logger?.debug("Anonymous context created", {
        sessionId: session.sessionId,
        protocol: session.protocol,
      });

      this.metrics?.increment("auth_anonymous_created");

      return {
        success: true,
        context,
      };
    } catch (error) {
      this.logger?.error("Anonymous context creation failed", error as Error);
      this.metrics?.increment("auth_anonymous_error");

      return {
        success: false,
        error: (error as Error).message,
        errorCode: "ANONYMOUS_AUTH_FAILED",
      };
    }
  }

  /**
   * Attempt to authenticate from multiple sources in order of preference
   */
  async authenticate(
    protocolContext: any,
    options?: ContextCreateOptions
  ): Promise<AuthResult> {
    // Extract authentication credentials from context
    const credentials = this.extractCredentials(protocolContext);

    // Try JWT token first
    if (credentials.jwtToken) {
      const result = await this.fromJWTToken(
        credentials.jwtToken,
        protocolContext,
        options
      );
      if (result.success) {
        return result;
      }
      this.logger?.debug("JWT authentication failed, trying next method", {
        error: result.error,
      });
    }

    // Try API key
    if (credentials.apiKey) {
      const result = await this.fromAPIKey(
        credentials.apiKey,
        protocolContext,
        options
      );
      if (result.success) {
        return result;
      }
      this.logger?.debug("API key authentication failed, trying next method", {
        error: result.error,
      });
    }

    // Try session ID
    if (credentials.sessionId) {
      const result = await this.fromSessionId(
        credentials.sessionId,
        protocolContext,
        options
      );
      if (result.success) {
        return result;
      }
      this.logger?.debug("Session authentication failed, creating anonymous", {
        error: result.error,
      });
    }

    // Fall back to anonymous
    return this.createAnonymous(protocolContext, options);
  }

  /**
   * Extract authentication credentials from protocol context
   */
  private extractCredentials(protocolContext: any): {
    jwtToken?: string;
    apiKey?: string;
    sessionId?: string;
  } {
    let headers: Record<string, string> = {};
    let query: Record<string, string> = {};
    let cookies: Record<string, string> = {};

    // Extract from HTTP context
    if (protocolContext.headers) {
      headers = protocolContext.headers;
      query = protocolContext.query || {};
      cookies = protocolContext.cookie || {};
    }

    // Extract from WebSocket context
    if (protocolContext.metadata) {
      headers = protocolContext.metadata.headers || {};
      query = protocolContext.metadata.query || {};
    }

    // Extract JWT token
    let jwtToken: string | undefined;
    const authHeader = headers.authorization || headers.Authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      jwtToken = authHeader.substring(7);
    } else {
      // Try query parameters as fallback
      jwtToken = query.token || query.access_token;
    }

    // Extract API key
    const apiKey =
      headers["x-api-key"] || headers["X-API-Key"] || query.api_key;

    // Extract session ID
    const sessionId = cookies.sessionId || query.sessionId;

    return {
      jwtToken,
      apiKey,
      sessionId,
    };
  }

  /**
   * Create appropriate builder based on protocol context
   */
  private createBuilder(protocolContext: any): UnifiedAuthContextBuilder {
    if (this.isWebSocketContext(protocolContext)) {
      return UnifiedAuthContextBuilder.fromWebSocket(
        protocolContext as WebSocketContextInput
      );
    } else {
      return UnifiedAuthContextBuilder.fromHTTP(protocolContext);
    }
  }

  /**
   * Detect protocol based on context structure
   */
  private detectProtocol(context: any): SessionProtocol {
    if (this.isWebSocketContext(context)) return "websocket";
    return "http";
  }

  /**
   * Check if context is WebSocket context
   */
  private isWebSocketContext(context: any): boolean {
    return !!(context.connectionId || context.ws || context.metadata);
  }

  /**
   * Create a lightweight factory instance for basic usage
   */
  static create(
    jwtService: EnhancedJWTService,
    permissionService: PermissionService,
    userService: UserService,
    logger?: any,
    metrics?: any
  ): AuthContextFactory {
    return new AuthContextFactory(
      jwtService,
      permissionService,
      userService,
      undefined, // No SessionManager yet
      logger,
      metrics
    );
  }

  /**
   * Create a full-featured factory instance with session management
   */
  static createWithSessionManager(
    jwtService: EnhancedJWTService,
    permissionService: PermissionService,
    userService: UserService,
    sessionManager: SessionManager,
    logger?: any,
    metrics?: any
  ): AuthContextFactory {
    return new AuthContextFactory(
      jwtService,
      permissionService,
      userService,
      sessionManager,
      logger,
      metrics
    );
  }
}
