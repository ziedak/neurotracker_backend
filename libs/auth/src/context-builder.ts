/**
 * Builder for creating UnifiedAuthContext instances
 * Provides type-safe construction with validation
 */

import {
  UnifiedAuthContext,
  UnifiedAuthContextImpl,
  UserIdentity,
  SessionData,
  TokenInfo,
  HTTPAuthContext,
  WebSocketAuthContext,
  AuthMethod,
  SessionProtocol,
  ContextCreateOptions,
} from "./unified-context";
import { Permission, PermissionMetadata, PermissionPriority } from "./models";

/**
 * WebSocket context structure for builder input
 */
export interface WebSocketContextInput {
  connectionId: string;
  ws: any; // WebSocket interface
  message: {
    type: string;
    data?: unknown;
    id?: string;
  };
  metadata: {
    headers: Record<string, string>;
    query: Record<string, string>;
    origin?: string;
  };
  authenticated?: boolean;
  userId?: string;
  userRole?: string; // Single role per Phase 3A architecture
  userPermissions?: string[]; // String permissions that get converted to Permission[]
  session?: any;
}

/**
 * Builder class for UnifiedAuthContext
 */
export class UnifiedAuthContextBuilder {
  private data: {
    authenticated?: boolean;
    sessionId?: string;
    userId?: string;
    user?: UserIdentity;
    roles?: readonly string[];
    permissions?: readonly Permission[];
    session?: SessionData;
    authMethod?: AuthMethod;
    lastActivity?: Date;
    tokens?: TokenInfo;
    http?: HTTPAuthContext;
    websocket?: WebSocketAuthContext;
    options?: ContextCreateOptions;
  } = {};

  static create(): UnifiedAuthContextBuilder {
    return new UnifiedAuthContextBuilder();
  }

  static fromHTTP(httpContext: any): UnifiedAuthContextBuilder {
    return new UnifiedAuthContextBuilder().setHTTPContext(httpContext);
  }

  static fromWebSocket(
    wsContext: WebSocketContextInput
  ): UnifiedAuthContextBuilder {
    return new UnifiedAuthContextBuilder().setWebSocketContext(wsContext);
  }

  static fromSession(session: SessionData): UnifiedAuthContextBuilder {
    return new UnifiedAuthContextBuilder().setSession(session);
  }

  /**
   * Set authentication state
   */
  setAuthenticated(authenticated: boolean): this {
    this.data.authenticated = authenticated;
    return this;
  }

  /**
   * Set user information
   */
  setUser(user: UserIdentity): this {
    this.data.user = user;
    this.data.userId = user.id;
    this.data.roles = [user.role];
    return this;
  }

  /**
   * Set session data
   */
  setSession(session: SessionData): this {
    this.data.session = session;
    this.data.sessionId = session.sessionId;
    this.data.userId = session.userId;
    this.data.authMethod = session.authMethod;
    this.data.lastActivity = session.lastActivity;
    return this;
  }

  /**
   * Set user permissions
   */
  setPermissions(permissions: Permission[]): this {
    this.data.permissions = Object.freeze([...permissions]);
    return this;
  }

  /**
   * Set user roles
   */
  setRoles(roles: string[]): this {
    this.data.roles = Object.freeze([...roles]);
    return this;
  }

  /**
   * Set token information
   */
  setTokens(tokens: TokenInfo): this {
    this.data.tokens = tokens;
    return this;
  }

  /**
   * Set auth method
   */
  setAuthMethod(method: AuthMethod): this {
    this.data.authMethod = method;
    return this;
  }

  /**
   * Set session ID
   */
  setSessionId(sessionId: string): this {
    this.data.sessionId = sessionId;
    return this;
  }

  /**
   * Set HTTP context from Elysia context
   */
  setHTTPContext(elysiaContext: any): this {
    this.data.http = {
      headers: elysiaContext.headers || {},
      cookies: this.extractCookies(elysiaContext),
      query: elysiaContext.query || {},
      body: elysiaContext.body,
      ip: elysiaContext.ip || this.extractIP(elysiaContext),
      userAgent: elysiaContext.headers?.["user-agent"],

      setStatus: (status: number) => {
        if (elysiaContext.set) {
          elysiaContext.set.status = status;
        }
      },

      setHeader: (name: string, value: string) => {
        if (elysiaContext.set) {
          if (!elysiaContext.set.headers) {
            elysiaContext.set.headers = {};
          }
          elysiaContext.set.headers[name] = value;
        }
      },

      setCookie: (name: string, value: string, options?: any) => {
        if (elysiaContext.set) {
          if (!elysiaContext.set.cookie) {
            elysiaContext.set.cookie = {};
          }
          elysiaContext.set.cookie[name] = {
            value,
            ...options,
          };
        }
      },

      redirect: (url: string) => {
        if (elysiaContext.set) {
          elysiaContext.set.status = 302;
          if (!elysiaContext.set.headers) {
            elysiaContext.set.headers = {};
          }
          elysiaContext.set.headers["Location"] = url;
        }
      },
    };

    return this;
  }

  /**
   * Set WebSocket context
   */
  setWebSocketContext(wsContext: WebSocketContextInput): this {
    this.data.websocket = {
      connectionId: wsContext.connectionId,
      ws: wsContext.ws,
      message: wsContext.message,
      metadata: {
        headers: wsContext.metadata.headers,
        query: wsContext.metadata.query,
        origin: wsContext.metadata.origin,
        protocol: wsContext.ws?.protocol,
        connectedAt: new Date(), // Should be tracked elsewhere in real implementation
        lastMessageAt: new Date(),
      },

      send: (data: unknown) => {
        if (wsContext.ws && wsContext.ws.send) {
          wsContext.ws.send(JSON.stringify(data));
        }
      },

      close: (code?: number, reason?: string) => {
        if (wsContext.ws && wsContext.ws.close) {
          wsContext.ws.close(code, reason);
        }
      },

      ping: () => {
        if (wsContext.ws && wsContext.ws.ping) {
          wsContext.ws.ping();
        }
      },

      isAlive: () => {
        return wsContext.ws && wsContext.ws.readyState === 1; // WebSocket.OPEN
      },
    };

    // Extract authentication data if available
    if (wsContext.authenticated) {
      this.data.authenticated = wsContext.authenticated;
    }
    if (wsContext.userId) {
      this.data.userId = wsContext.userId;
    }
    if (wsContext.userRole) {
      this.data.roles = Object.freeze([wsContext.userRole]); // Single role to array
    }
    if (wsContext.userPermissions) {
      // TODO: Convert string permissions to Permission[] objects when permission service is available
      // For now, this will cause a type error that needs to be resolved in Phase 3A.3
      this.data.permissions = Object.freeze([
        ...wsContext.userPermissions,
      ] as any);
    }

    return this;
  }

  /**
   * Set additional options
   */
  setOptions(options: ContextCreateOptions): this {
    this.data.options = options;
    return this;
  }

  /**
   * Build the UnifiedAuthContext instance
   */
  build(): UnifiedAuthContext {
    // Validation
    this.validateRequiredFields();

    // Set defaults
    const now = new Date();

    return new UnifiedAuthContextImpl(
      this.data.authenticated ?? false,
      this.data.sessionId!,
      this.data.session!,
      this.data.authMethod ?? "anonymous",
      this.data.lastActivity ?? now,
      this.data.userId ?? "anonymous",
      this.data.user,
      this.data.roles ?? Object.freeze([]),
      this.data.permissions ?? Object.freeze([]),
      this.data.tokens,
      this.data.http,
      this.data.websocket,
      this.data.options ?? {}
    );
  }

  /**
   * Build an anonymous context
   */
  buildAnonymous(): UnifiedAuthContext {
    const sessionId = this.data.sessionId || this.generateSessionId();
    const now = new Date();

    const anonymousSession: SessionData = {
      sessionId,
      userId: "anonymous",
      createdAt: now,
      lastActivity: now,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours
      protocol: this.detectProtocol(),
      authMethod: "anonymous",
      refreshCount: 0,
      metadata: {},
    };

    return new UnifiedAuthContextImpl(
      false, // not authenticated
      sessionId,
      anonymousSession,
      "anonymous",
      now,
      undefined, // no userId for anonymous
      undefined, // no user for anonymous
      Object.freeze([]), // no roles for anonymous
      Object.freeze([
        {
          // basic public permissions as Permission objects
          id: "public-read",
          name: "Public Read Access",
          resource: "public",
          action: "read",
          conditions: [],
          metadata: {
            description: "Basic public read access",
            category: "public",
            priority: "LOW" as PermissionPriority,
            tags: ["public", "read"],
            owner: "system",
            department: "system",
          },
          createdAt: now,
          updatedAt: now,
          version: "1.0.0",
        },
      ]),
      undefined, // no tokens for anonymous
      this.data.http,
      this.data.websocket,
      this.data.options ?? {}
    );
  }

  /**
   * Create authenticated context from JWT payload
   */
  buildFromJWTPayload(jwtPayload: any, token: string): UnifiedAuthContext {
    const now = new Date();
    const sessionId = this.data.sessionId || this.generateSessionId();

    // Create session from JWT data
    const session: SessionData = {
      sessionId,
      userId: jwtPayload.sub,
      createdAt: new Date(jwtPayload.iat * 1000),
      lastActivity: now,
      expiresAt: new Date(jwtPayload.exp * 1000),
      protocol: this.detectProtocol(),
      authMethod: "jwt",
      refreshCount: 0,
      metadata: {
        tokenIssued: jwtPayload.iat,
        tokenExpires: jwtPayload.exp,
      },
    };

    const user: UserIdentity = {
      id: jwtPayload.sub,
      email: jwtPayload.email,
      storeId: jwtPayload.storeId,
      role: jwtPayload.role,
      status: "active", // Assume active if JWT is valid
    };

    const tokens: TokenInfo = {
      accessToken: token,
      tokenType: "Bearer",
      expiresAt: new Date(jwtPayload.exp * 1000),
    };

    return new UnifiedAuthContextImpl(
      true, // authenticated
      sessionId,
      session,
      "jwt",
      now,
      jwtPayload.sub,
      user,
      Object.freeze([jwtPayload.role]),
      Object.freeze(jwtPayload.permissions || ([] as any)), // TODO: Convert to Permission[] objects in Phase 3A.3
      tokens,
      this.data.http,
      this.data.websocket,
      this.data.options ?? {}
    );
  }

  /**
   * Validate required fields before building
   */
  private validateRequiredFields(): void {
    if (!this.data.sessionId && !this.data.session) {
      throw new Error("Either sessionId or session data is required");
    }

    if (this.data.authenticated && !this.data.userId) {
      throw new Error("User ID is required for authenticated contexts");
    }

    if (!this.data.session && this.data.sessionId) {
      throw new Error("Session data is required when sessionId is provided");
    }
  }

  /**
   * Extract cookies from Elysia context
   */
  private extractCookies(context: any): Record<string, string> {
    if (context.cookie) {
      return context.cookie;
    }

    // Fallback: parse from headers
    const cookieHeader = context.headers?.cookie;
    if (!cookieHeader) {
      return {};
    }

    const cookies: Record<string, string> = {};
    cookieHeader.split(";").forEach((cookie: string) => {
      const [name, value] = cookie.trim().split("=");
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });

    return cookies;
  }

  /**
   * Extract IP address from context
   */
  private extractIP(context: any): string | undefined {
    // Try various common headers for IP extraction
    const headers = context.headers || {};

    return (
      headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      headers["x-real-ip"] ||
      headers["x-client-ip"] ||
      context.ip
    );
  }

  /**
   * Detect protocol based on available context
   */
  private detectProtocol(): SessionProtocol {
    if (this.data.websocket && this.data.http) return "both";
    if (this.data.websocket) return "websocket";
    if (this.data.http) return "http";
    return "http"; // default
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Utility functions for context creation
 */
export class AuthContextUtils {
  /**
   * Create context from HTTP request
   */
  static fromHTTPRequest(
    elysiaContext: any,
    options?: ContextCreateOptions
  ): UnifiedAuthContextBuilder {
    return UnifiedAuthContextBuilder.fromHTTP(elysiaContext).setOptions(
      options || {}
    );
  }

  /**
   * Create context from WebSocket connection
   */
  static fromWebSocketConnection(
    wsContext: WebSocketContextInput,
    options?: ContextCreateOptions
  ): UnifiedAuthContextBuilder {
    return UnifiedAuthContextBuilder.fromWebSocket(wsContext).setOptions(
      options || {}
    );
  }

  /**
   * Create anonymous context for public access
   */
  static createAnonymous(
    protocolContext: any,
    options?: ContextCreateOptions
  ): UnifiedAuthContext {
    const builder =
      protocolContext.connectionId || protocolContext.ws
        ? UnifiedAuthContextBuilder.fromWebSocket(protocolContext)
        : UnifiedAuthContextBuilder.fromHTTP(protocolContext);

    if (options) {
      builder.setOptions(options);
    }

    return builder.buildAnonymous();
  }

  /**
   * Create context from JWT token
   */
  static fromJWTToken(
    jwtPayload: any,
    token: string,
    protocolContext: any,
    options?: ContextCreateOptions
  ): UnifiedAuthContext {
    const builder =
      protocolContext.connectionId || protocolContext.ws
        ? UnifiedAuthContextBuilder.fromWebSocket(protocolContext)
        : UnifiedAuthContextBuilder.fromHTTP(protocolContext);

    if (options) {
      builder.setOptions(options);
    }

    return builder.buildFromJWTPayload(jwtPayload, token);
  }
}
