# UnifiedAuthContext Interface Design

## Core Interface Architecture

### 1. Base UnifiedAuthContext Interface

```typescript
/**
 * Unified Authentication Context
 * Provides consistent authentication data across HTTP and WebSocket protocols
 */
export interface UnifiedAuthContext {
  // Core authentication state
  readonly authenticated: boolean;
  readonly sessionId: string;
  readonly userId?: string;

  // User attributes
  readonly user?: UserIdentity;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];

  // Session management
  readonly session: SessionData;
  readonly authMethod: AuthMethod;
  readonly lastActivity: Date;

  // Token information (when applicable)
  readonly tokens?: TokenInfo;

  // Protocol context adapters
  readonly http?: HTTPAuthContext;
  readonly websocket?: WebSocketAuthContext;

  // Context transformation methods
  toHTTPContext(): HTTPAuthContext;
  toWebSocketContext(): WebSocketAuthContext;
  toSerializable(): SerializableAuthContext;

  // State validation
  isValid(): boolean;
  canAccess(resource: string, action: string): boolean;
  hasRole(role: string | string[]): boolean;
  hasPermission(permission: string | string[]): boolean;

  // Session management
  refreshSession(): Promise<UnifiedAuthContext>;
  invalidateSession(): Promise<void>;
}
```

### 2. Supporting Interfaces

```typescript
export interface UserIdentity {
  readonly id: string;
  readonly email: string;
  readonly storeId?: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly metadata?: Record<string, unknown>;
}

export interface SessionData {
  readonly sessionId: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly lastActivity: Date;
  readonly expiresAt: Date;
  readonly protocol: SessionProtocol;
  readonly authMethod: AuthMethod;
  readonly ipAddress?: string;
  readonly userAgent?: string;
  readonly origin?: string;
  readonly connectionId?: string; // For WebSocket connections
  readonly refreshCount: number;
  readonly metadata: Record<string, unknown>;
}

export interface TokenInfo {
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly tokenType: "Bearer" | "API-Key";
  readonly expiresAt?: Date;
  readonly refreshExpiresAt?: Date;
  readonly scopes?: readonly string[];
}

export interface HTTPAuthContext {
  readonly headers: Record<string, string>;
  readonly cookies: Record<string, string>;
  readonly query: Record<string, string>;
  readonly body?: unknown;
  readonly ip?: string;
  readonly userAgent?: string;

  // Elysia-specific context
  setStatus(status: number): void;
  setHeader(name: string, value: string): void;
  setCookie(name: string, value: string, options?: CookieOptions): void;
  redirect(url: string): void;
}

export interface WebSocketAuthContext {
  readonly connectionId: string;
  readonly ws: WebSocket;
  readonly message: WebSocketMessage;
  readonly metadata: ConnectionMetadata;

  // WebSocket-specific methods
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
  ping(): void;
  isAlive(): boolean;
}

export interface ConnectionMetadata {
  readonly headers: Record<string, string>;
  readonly query: Record<string, string>;
  readonly origin?: string;
  readonly protocol?: string;
  readonly connectedAt: Date;
  readonly lastMessageAt?: Date;
}

// Type definitions
export type UserRole = "admin" | "store_owner" | "api_user" | "customer";
export type UserStatus = "active" | "inactive" | "suspended" | "pending";
export type AuthMethod = "jwt" | "api_key" | "session" | "anonymous";
export type SessionProtocol = "http" | "websocket" | "both";
```

### 3. Context Builder Pattern

```typescript
/**
 * Builder for creating UnifiedAuthContext instances
 * Provides type-safe construction with validation
 */
export class UnifiedAuthContextBuilder {
  private data: Partial<UnifiedAuthContext> = {};

  static create(): UnifiedAuthContextBuilder {
    return new UnifiedAuthContextBuilder();
  }

  static fromHTTP(httpContext: any): UnifiedAuthContextBuilder {
    return new UnifiedAuthContextBuilder().setHTTPContext(httpContext);
  }

  static fromWebSocket(wsContext: WebSocketContext): UnifiedAuthContextBuilder {
    return new UnifiedAuthContextBuilder().setWebSocketContext(wsContext);
  }

  static fromSession(session: SessionData): UnifiedAuthContextBuilder {
    return new UnifiedAuthContextBuilder().setSession(session);
  }

  setAuthenticated(authenticated: boolean): this {
    this.data.authenticated = authenticated;
    return this;
  }

  setUser(user: UserIdentity): this {
    this.data.user = user;
    this.data.userId = user.id;
    this.data.roles = [user.role];
    return this;
  }

  setSession(session: SessionData): this {
    this.data.session = session;
    this.data.sessionId = session.sessionId;
    this.data.userId = session.userId;
    this.data.authMethod = session.authMethod;
    this.data.lastActivity = session.lastActivity;
    return this;
  }

  setPermissions(permissions: string[]): this {
    this.data.permissions = Object.freeze([...permissions]);
    return this;
  }

  setTokens(tokens: TokenInfo): this {
    this.data.tokens = tokens;
    return this;
  }

  setHTTPContext(httpContext: any): this {
    this.data.http = {
      headers: httpContext.headers || {},
      cookies: httpContext.cookie || {},
      query: httpContext.query || {},
      body: httpContext.body,
      ip: httpContext.ip,
      userAgent: httpContext.headers?.["user-agent"],
      setStatus: (status: number) => (httpContext.set.status = status),
      setHeader: (name: string, value: string) =>
        (httpContext.set.headers[name] = value),
      setCookie: (name: string, value: string, options?: any) => {
        // Implementation depends on Elysia cookie handling
      },
      redirect: (url: string) => {
        httpContext.set.status = 302;
        httpContext.set.headers["Location"] = url;
      },
    };
    return this;
  }

  setWebSocketContext(wsContext: WebSocketContext): this {
    this.data.websocket = {
      connectionId: wsContext.connectionId,
      ws: wsContext.ws,
      message: wsContext.message,
      metadata: {
        headers: wsContext.metadata.headers,
        query: wsContext.metadata.query,
        origin: wsContext.metadata.origin,
        connectedAt: new Date(), // Should be tracked elsewhere
        lastMessageAt: new Date(),
      },
      send: (data: unknown) => wsContext.ws.send(JSON.stringify(data)),
      close: (code?: number, reason?: string) =>
        wsContext.ws.close(code, reason),
      ping: () => wsContext.ws.ping(),
      isAlive: () => wsContext.ws.readyState === WebSocket.OPEN,
    };
    return this;
  }

  build(): UnifiedAuthContext {
    // Validation
    if (!this.data.sessionId) {
      throw new Error("Session ID is required");
    }

    if (!this.data.session) {
      throw new Error("Session data is required");
    }

    // Set defaults
    const context: UnifiedAuthContext = {
      authenticated: this.data.authenticated ?? false,
      sessionId: this.data.sessionId!,
      userId: this.data.userId,
      user: this.data.user,
      roles: Object.freeze(this.data.roles ?? []),
      permissions: Object.freeze(this.data.permissions ?? []),
      session: this.data.session!,
      authMethod: this.data.authMethod ?? "anonymous",
      lastActivity: this.data.lastActivity ?? new Date(),
      tokens: this.data.tokens,
      http: this.data.http,
      websocket: this.data.websocket,

      // Methods
      toHTTPContext: () => this.buildHTTPContext(this.data),
      toWebSocketContext: () => this.buildWebSocketContext(this.data),
      toSerializable: () => this.buildSerializable(this.data),
      isValid: () => this.validateContext(this.data),
      canAccess: (resource: string, action: string) =>
        this.checkAccess(this.data, resource, action),
      hasRole: (role: string | string[]) => this.checkRoles(this.data, role),
      hasPermission: (permission: string | string[]) =>
        this.checkPermissions(this.data, permission),
      refreshSession: () => this.refreshSession(this.data),
      invalidateSession: () => this.invalidateSession(this.data),
    };

    return context;
  }

  private buildHTTPContext(data: Partial<UnifiedAuthContext>): HTTPAuthContext {
    if (!data.http) {
      throw new Error("HTTP context not available");
    }
    return data.http;
  }

  private buildWebSocketContext(
    data: Partial<UnifiedAuthContext>
  ): WebSocketAuthContext {
    if (!data.websocket) {
      throw new Error("WebSocket context not available");
    }
    return data.websocket;
  }

  private buildSerializable(
    data: Partial<UnifiedAuthContext>
  ): SerializableAuthContext {
    return {
      authenticated: data.authenticated ?? false,
      sessionId: data.sessionId!,
      userId: data.userId,
      user: data.user,
      roles: data.roles ?? [],
      permissions: data.permissions ?? [],
      authMethod: data.authMethod ?? "anonymous",
      lastActivity:
        data.lastActivity?.toISOString() ?? new Date().toISOString(),
      tokens: data.tokens
        ? {
            tokenType: data.tokens.tokenType,
            expiresAt: data.tokens.expiresAt?.toISOString(),
            scopes: data.tokens.scopes,
          }
        : undefined,
    };
  }

  private validateContext(data: Partial<UnifiedAuthContext>): boolean {
    // Basic validation rules
    if (!data.sessionId || !data.session) return false;
    if (data.authenticated && !data.userId) return false;
    if (data.session.expiresAt && data.session.expiresAt < new Date())
      return false;
    return true;
  }

  private checkAccess(
    data: Partial<UnifiedAuthContext>,
    resource: string,
    action: string
  ): boolean {
    if (!data.authenticated) return false;

    // Admin has access to everything
    if (data.roles?.includes("admin")) return true;

    // Check specific permissions
    const requiredPermission = `${action}:${resource}`;
    return data.permissions?.includes(requiredPermission) ?? false;
  }

  private checkRoles(
    data: Partial<UnifiedAuthContext>,
    role: string | string[]
  ): boolean {
    if (!data.roles || data.roles.length === 0) return false;

    const requiredRoles = Array.isArray(role) ? role : [role];
    return requiredRoles.some((r) => data.roles!.includes(r));
  }

  private checkPermissions(
    data: Partial<UnifiedAuthContext>,
    permission: string | string[]
  ): boolean {
    if (!data.permissions || data.permissions.length === 0) return false;

    const requiredPermissions = Array.isArray(permission)
      ? permission
      : [permission];
    return requiredPermissions.some((p) => data.permissions!.includes(p));
  }

  private async refreshSession(
    data: Partial<UnifiedAuthContext>
  ): Promise<UnifiedAuthContext> {
    // This would integrate with SessionManager
    throw new Error(
      "Session refresh not implemented - requires SessionManager integration"
    );
  }

  private async invalidateSession(
    data: Partial<UnifiedAuthContext>
  ): Promise<void> {
    // This would integrate with SessionManager
    throw new Error(
      "Session invalidation not implemented - requires SessionManager integration"
    );
  }
}

export interface SerializableAuthContext {
  readonly authenticated: boolean;
  readonly sessionId: string;
  readonly userId?: string;
  readonly user?: UserIdentity;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly authMethod: AuthMethod;
  readonly lastActivity: string; // ISO string
  readonly tokens?: {
    readonly tokenType: "Bearer" | "API-Key";
    readonly expiresAt?: string; // ISO string
    readonly scopes?: readonly string[];
  };
}
```

### 4. Context Factory

```typescript
/**
 * Factory for creating UnifiedAuthContext from various sources
 */
export class AuthContextFactory {
  constructor(
    private sessionManager: SessionManager,
    private jwtService: JWTService,
    private permissionService: PermissionService
  ) {}

  /**
   * Create authenticated context from JWT token
   */
  async fromJWTToken(
    token: string,
    protocolContext: any
  ): Promise<UnifiedAuthContext> {
    const payload = await this.jwtService.verifyToken(token);
    if (!payload) {
      throw new Error("Invalid JWT token");
    }

    // Get or create session
    const session = await this.sessionManager.getOrCreateSession(payload.sub, {
      authMethod: "jwt",
      protocol: this.detectProtocol(protocolContext),
    });

    // Get user permissions
    const permissions = await this.permissionService.getUserPermissions(
      payload.sub
    );

    return UnifiedAuthContextBuilder.create()
      .setAuthenticated(true)
      .setUser({
        id: payload.sub,
        email: payload.email,
        storeId: payload.storeId,
        role: payload.role,
        status: "active",
      })
      .setPermissions(permissions)
      .setSession(session)
      .setTokens({
        accessToken: token,
        tokenType: "Bearer",
        expiresAt: new Date(payload.exp * 1000),
      })
      .build();
  }

  /**
   * Create authenticated context from API key
   */
  async fromAPIKey(
    apiKey: string,
    protocolContext: any
  ): Promise<UnifiedAuthContext> {
    // Implementation similar to JWT but for API keys
    // This would integrate with the existing API key validation logic
    throw new Error("API key authentication not implemented");
  }

  /**
   * Create context from existing session
   */
  async fromSessionId(
    sessionId: string,
    protocolContext: any
  ): Promise<UnifiedAuthContext> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.expiresAt < new Date()) {
      throw new Error("Session expired");
    }

    // Get user data and permissions
    const [user, permissions] = await Promise.all([
      this.getUserById(session.userId),
      this.permissionService.getUserPermissions(session.userId),
    ]);

    return UnifiedAuthContextBuilder.create()
      .setAuthenticated(true)
      .setUser(user)
      .setPermissions(permissions)
      .setSession(session)
      .build();
  }

  /**
   * Create anonymous context
   */
  async createAnonymous(protocolContext: any): Promise<UnifiedAuthContext> {
    const session = await this.sessionManager.createAnonymousSession({
      protocol: this.detectProtocol(protocolContext),
    });

    return UnifiedAuthContextBuilder.create()
      .setAuthenticated(false)
      .setSession(session)
      .setPermissions(["public:read"]) // Default anonymous permissions
      .build();
  }

  private detectProtocol(context: any): SessionProtocol {
    if (context.connectionId || context.ws) return "websocket";
    if (context.headers || context.request) return "http";
    return "both";
  }

  private async getUserById(userId: string): Promise<UserIdentity> {
    // This would integrate with user service/database
    throw new Error("User lookup not implemented");
  }
}
```

## Integration Points

### 1. With Existing JWTService

- Use existing token generation/verification
- Enhance with session integration
- Add token caching for performance

### 2. With SessionManager (To Be Implemented)

- Session creation and lifecycle management
- Cross-protocol session synchronization
- Redis/PostgreSQL backing store

### 3. With Permission Service

- Role-based access control
- Permission caching
- Dynamic permission loading

### 4. With Middleware Chain

- HTTP middleware integration
- WebSocket middleware enhancement
- Error handling standardization

This design provides a solid foundation for unified authentication across HTTP and WebSocket protocols while maintaining type safety and performance.
