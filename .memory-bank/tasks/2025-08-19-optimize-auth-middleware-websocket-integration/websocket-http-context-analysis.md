# WebSocket vs HTTP Context Analysis

## Context Structure Comparison

### HTTP Request Context (Elysia)

```typescript
interface HTTPContext {
  // Elysia context structure
  headers: Record<string, string | undefined>;
  set: {
    status: number;
    headers: Record<string, string>;
    cookie?: Record<string, Cookie>;
  };
  request: Request;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
  store?: Record<string, unknown>;

  // Auth extensions added by middleware
  user?: JWTPayload;
  authenticated?: boolean;
}
```

### WebSocket Context (Current Implementation)

```typescript
interface WebSocketContext {
  connectionId: string;
  ws: WebSocket;
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

  // Auth state (added during middleware processing)
  authenticated?: boolean;
  userId?: string;
  userRoles?: string[];
  userPermissions?: string[];
  session?: SessionData;
}
```

## Key Differences

### 1. **Request vs Connection Lifecycle**

- **HTTP**: Request-response cycle, stateless by design
- **WebSocket**: Long-lived connection, stateful communication
- **Impact**: Authentication state must persist across messages

### 2. **Header Access Patterns**

- **HTTP**: Headers available on every request
- **WebSocket**: Headers only available during handshake
- **Impact**: Auth tokens must be passed in initial connection or message data

### 3. **Error Handling**

- **HTTP**: Standard HTTP status codes (401, 403, etc.)
- **WebSocket**: Custom message responses + connection close codes
- **Impact**: Need unified error response transformation

### 4. **State Management**

- **HTTP**: Request-scoped state, middleware chain
- **WebSocket**: Connection-scoped state, message routing
- **Impact**: Session state needs connection-level persistence

## Common Authentication Data Structures

### Unified User Identity

```typescript
interface UserIdentity {
  userId: string;
  email: string;
  role: UserRole;
  permissions: string[];
  storeId?: string;
  sessionId: string;
}
```

### Unified Session Data

```typescript
interface SessionData {
  sessionId: string;
  userId: string;
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
  protocol: "http" | "websocket" | "both";
  authMethod: "jwt" | "api_key" | "session";
  metadata: {
    userAgent?: string;
    ipAddress?: string;
    origin?: string;
    connectionId?: string; // For WebSocket
  };
}
```

## Context Transformation Layer Design

### 1. **Base Authentication Context**

```typescript
interface BaseAuthContext {
  authenticated: boolean;
  user?: UserIdentity;
  session?: SessionData;
  permissions: string[];
  roles: string[];
}
```

### 2. **Protocol-Specific Adapters**

```typescript
class HTTPAuthAdapter {
  static fromElysiaContext(ctx: any): BaseAuthContext {
    return {
      authenticated: !!ctx.user,
      user: ctx.user ? this.mapJWTPayloadToUserIdentity(ctx.user) : undefined,
      session: ctx.session,
      permissions: ctx.user?.permissions || [],
      roles: ctx.user?.role ? [ctx.user.role] : [],
    };
  }

  static toElysiaContext(auth: BaseAuthContext, ctx: any): void {
    ctx.user = auth.user;
    ctx.authenticated = auth.authenticated;
    ctx.session = auth.session;
  }
}

class WebSocketAuthAdapter {
  static fromWebSocketContext(ctx: WebSocketContext): BaseAuthContext {
    return {
      authenticated: ctx.authenticated || false,
      user: ctx.userId ? this.mapWebSocketUserToIdentity(ctx) : undefined,
      session: ctx.session,
      permissions: ctx.userPermissions || [],
      roles: ctx.userRoles || [],
    };
  }

  static toWebSocketContext(
    auth: BaseAuthContext,
    ctx: WebSocketContext
  ): void {
    ctx.authenticated = auth.authenticated;
    ctx.userId = auth.user?.userId;
    ctx.userRoles = auth.roles;
    ctx.userPermissions = auth.permissions;
    ctx.session = auth.session;
  }
}
```

### 3. **Unified Error Handling Strategy**

```typescript
interface AuthError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

class UnifiedErrorHandler {
  static handleHTTPAuthError(error: AuthError, ctx: any): void {
    const statusCode = this.getHTTPStatusCode(error.code);
    ctx.set.status = statusCode;
    ctx.set.headers["Content-Type"] = "application/json";
    // Return JSON error response
  }

  static handleWebSocketAuthError(
    error: AuthError,
    ctx: WebSocketContext
  ): void {
    const closeCode = this.getWebSocketCloseCode(error.code);
    const response = {
      type: "auth_error",
      error: {
        code: error.code,
        message: error.message,
        timestamp: error.timestamp.toISOString(),
      },
    };

    // Send error message before closing (if configured)
    if (this.shouldSendErrorBeforeClose(error.code)) {
      ctx.ws.send(JSON.stringify(response));
    }

    // Close connection with appropriate code
    ctx.ws.close(closeCode, error.message);
  }
}
```

## Protocol-Specific Requirements

### HTTP-Specific Requirements

- **CSRF Protection**: Required for state-changing operations
- **Cookie Support**: Session cookies for browser-based auth
- **Redirect Support**: Login redirects for browser flows
- **Content Negotiation**: JSON/HTML response format support

### WebSocket-Specific Requirements

- **Origin Validation**: Prevent cross-origin WebSocket abuse
- **Heartbeat/Ping**: Connection health monitoring
- **Message Queuing**: Handle auth during message processing
- **Connection State**: Maintain auth across connection lifecycle

### Shared Requirements

- **Session Management**: Unified session store
- **Token Validation**: Consistent JWT/API key handling
- **Permission Checks**: Same RBAC logic
- **Audit Logging**: Unified auth event tracking

## Implementation Strategy

### Phase 1: Create Abstraction Layer

1. Define `UnifiedAuthContext` interface
2. Implement protocol adapters (HTTP/WebSocket)
3. Create error transformation utilities
4. Build context validation and sanitization

### Phase 2: Session Integration

1. Implement `SessionManager` with Redis/PostgreSQL
2. Create session synchronization between protocols
3. Add session lifecycle management
4. Implement session-based authentication flows

### Phase 3: Middleware Enhancement

1. Refactor existing HTTP auth middleware to use unified context
2. Enhance WebSocket middleware with session support
3. Create middleware composition utilities
4. Add comprehensive telemetry integration

## Validation Criteria

### Functional Validation

- [ ] HTTP and WebSocket contexts can be transformed bidirectionally
- [ ] Authentication state persists across protocol switches
- [ ] Error handling provides consistent user experience
- [ ] Session management works seamlessly across protocols

### Performance Validation

- [ ] Context transformation adds < 1ms latency
- [ ] Session lookup from cache < 10ms
- [ ] No performance degradation for existing HTTP flows
- [ ] WebSocket connection handling supports 1000+ concurrent connections

### Security Validation

- [ ] No auth bypass vulnerabilities in transformation
- [ ] Session fixation protection works across protocols
- [ ] CSRF protection maintained for HTTP
- [ ] Origin validation enforced for WebSocket
