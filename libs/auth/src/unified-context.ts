/**
 * Unified Authentication Context
 * Provides consistent authentication data across HTTP and WebSocket protocols
 */

import { EventEmitter } from "events";

// Core type definitions
export type UserRole = "admin" | "store_owner" | "api_user" | "customer";
export type UserStatus = "active" | "inactive" | "suspended" | "pending";
export type AuthMethod = "jwt" | "api_key" | "session" | "anonymous";
export type SessionProtocol = "http" | "websocket" | "both";

/**
 * User identity information
 */
export interface UserIdentity {
  readonly id: string;
  readonly email: string;
  readonly storeId?: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Session data structure
 */
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

/**
 * Token information
 */
export interface TokenInfo {
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly tokenType: "Bearer" | "API-Key";
  readonly expiresAt?: Date;
  readonly refreshExpiresAt?: Date;
  readonly scopes?: readonly string[];
}

/**
 * HTTP-specific authentication context
 */
export interface HTTPAuthContext {
  readonly headers: Record<string, string>;
  readonly cookies: Record<string, string>;
  readonly query: Record<string, string>;
  readonly body?: unknown;
  readonly ip?: string;
  readonly userAgent?: string;

  // Elysia-specific context methods
  setStatus(status: number): void;
  setHeader(name: string, value: string): void;
  setCookie(name: string, value: string, options?: any): void;
  redirect(url: string): void;
}

/**
 * WebSocket-specific authentication context
 */
export interface WebSocketAuthContext {
  readonly connectionId: string;
  readonly ws: any; // WebSocket interface
  readonly message: {
    type: string;
    data?: unknown;
    id?: string;
  };
  readonly metadata: {
    readonly headers: Record<string, string>;
    readonly query: Record<string, string>;
    readonly origin?: string;
    readonly protocol?: string;
    readonly connectedAt: Date;
    readonly lastMessageAt?: Date;
  };

  // WebSocket-specific methods
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
  ping(): void;
  isAlive(): boolean;
}

/**
 * Serializable authentication context for storage
 */
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

/**
 * Main Unified Authentication Context Interface
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

  // Event system
  on(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

/**
 * Context validation result
 */
export interface ContextValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Context creation options
 */
export interface ContextCreateOptions {
  readonly sessionManager?: any; // Will be properly typed when SessionManager is implemented
  readonly jwtService?: any; // Will be properly typed
  readonly permissionService?: any; // Will be properly typed
  readonly logger?: any; // Will be properly typed
  readonly metrics?: any; // Will be properly typed
}

/**
 * UnifiedAuthContext implementation
 */
export class UnifiedAuthContextImpl implements UnifiedAuthContext {
  private eventEmitter = new EventEmitter();

  constructor(
    public readonly authenticated: boolean,
    public readonly sessionId: string,
    public readonly session: SessionData,
    public readonly authMethod: AuthMethod,
    public readonly lastActivity: Date,
    public readonly userId?: string,
    public readonly user?: UserIdentity,
    public readonly roles: readonly string[] = [],
    public readonly permissions: readonly string[] = [],
    public readonly tokens?: TokenInfo,
    public readonly http?: HTTPAuthContext,
    public readonly websocket?: WebSocketAuthContext,
    private readonly options: ContextCreateOptions = {}
  ) {}

  toHTTPContext(): HTTPAuthContext {
    if (!this.http) {
      throw new Error(
        "HTTP context not available in this authentication context"
      );
    }
    return this.http;
  }

  toWebSocketContext(): WebSocketAuthContext {
    if (!this.websocket) {
      throw new Error(
        "WebSocket context not available in this authentication context"
      );
    }
    return this.websocket;
  }

  toSerializable(): SerializableAuthContext {
    return {
      authenticated: this.authenticated,
      sessionId: this.sessionId,
      userId: this.userId,
      user: this.user,
      roles: this.roles,
      permissions: this.permissions,
      authMethod: this.authMethod,
      lastActivity: this.lastActivity.toISOString(),
      tokens: this.tokens
        ? {
            tokenType: this.tokens.tokenType,
            expiresAt: this.tokens.expiresAt?.toISOString(),
            scopes: this.tokens.scopes,
          }
        : undefined,
    };
  }

  isValid(): boolean {
    // Basic validation rules
    if (!this.sessionId || !this.session) return false;
    if (this.authenticated && !this.userId) return false;
    if (this.session.expiresAt && this.session.expiresAt < new Date())
      return false;
    return true;
  }

  canAccess(resource: string, action: string): boolean {
    if (!this.authenticated) return false;

    // Admin has access to everything
    if (this.roles.includes("admin")) return true;

    // Check specific permissions
    const requiredPermission = `${action}:${resource}`;
    return this.permissions.includes(requiredPermission);
  }

  hasRole(role: string | string[]): boolean {
    if (!this.roles || this.roles.length === 0) return false;

    const requiredRoles = Array.isArray(role) ? role : [role];
    return requiredRoles.some((r) => this.roles.includes(r));
  }

  hasPermission(permission: string | string[]): boolean {
    if (!this.permissions || this.permissions.length === 0) return false;

    const requiredPermissions = Array.isArray(permission)
      ? permission
      : [permission];
    return requiredPermissions.some((p) => this.permissions.includes(p));
  }

  async refreshSession(): Promise<UnifiedAuthContext> {
    if (!this.options.sessionManager) {
      throw new Error(
        "Session refresh not available - SessionManager not configured"
      );
    }

    // This will be implemented when SessionManager is available
    throw new Error(
      "Session refresh not implemented - requires SessionManager integration"
    );
  }

  async invalidateSession(): Promise<void> {
    if (!this.options.sessionManager) {
      throw new Error(
        "Session invalidation not available - SessionManager not configured"
      );
    }

    // This will be implemented when SessionManager is available
    throw new Error(
      "Session invalidation not implemented - requires SessionManager integration"
    );
  }

  // Event system implementation
  on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  emit(event: string, ...args: any[]): void {
    this.eventEmitter.emit(event, ...args);
  }

  /**
   * Validate the context and return detailed results
   */
  validate(): ContextValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required field validation
    if (!this.sessionId) {
      errors.push("Session ID is required");
    }

    if (!this.session) {
      errors.push("Session data is required");
    }

    if (this.authenticated && !this.userId) {
      errors.push("User ID is required for authenticated contexts");
    }

    // Session expiration check
    if (this.session && this.session.expiresAt < new Date()) {
      errors.push("Session has expired");
    }

    // Token expiration warnings
    if (this.tokens?.expiresAt && this.tokens.expiresAt < new Date()) {
      warnings.push("Access token has expired");
    }

    // Role/permission consistency
    if (this.authenticated && this.roles.length === 0) {
      warnings.push("Authenticated user has no assigned roles");
    }

    return {
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
    };
  }

  /**
   * Create a copy with updated properties
   */
  with(
    updates: Partial<{
      authenticated: boolean;
      user: UserIdentity;
      roles: string[];
      permissions: string[];
      tokens: TokenInfo;
      session: SessionData;
    }>
  ): UnifiedAuthContext {
    return new UnifiedAuthContextImpl(
      updates.authenticated ?? this.authenticated,
      this.sessionId,
      updates.session ?? this.session,
      this.authMethod,
      new Date(), // Update last activity
      updates.user?.id ?? this.userId,
      updates.user ?? this.user,
      updates.roles ? Object.freeze([...updates.roles]) : this.roles,
      updates.permissions
        ? Object.freeze([...updates.permissions])
        : this.permissions,
      updates.tokens ?? this.tokens,
      this.http,
      this.websocket,
      this.options
    );
  }
}
