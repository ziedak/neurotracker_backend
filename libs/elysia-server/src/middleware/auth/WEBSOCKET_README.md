# WebSocket Authentication Middleware

Production-grade WebSocket authentication middleware following AbstractMiddleware patterns. Provides comprehensive authentication and authorization for WebSocket connections with full integration to `@libs/auth` services.

## Features

- **Multi-Protocol Authentication**: JWT tokens, API keys, session-based authentication
- **Connection-Level Authentication**: Persistent authentication for WebSocket connections
- **Message-Level Authorization**: Fine-grained authorization per message type
- **Role-Based Access Control (RBAC)**: Global and message-specific role checking
- **Permission-Based Access Control**: Global and message-specific permission validation
- **CASL Ability System**: Advanced ability-based authorization per message type
- **Authentication Persistence**: Connection tracking with timeout and reauthentication
- **Framework Agnostic**: Works with any WebSocket framework through AbstractMiddleware
- **Enterprise Monitoring**: Comprehensive metrics and logging integration
- **Type-Safe Configuration**: Full TypeScript support with strict typing
- **Preset Configurations**: Pre-built configurations for common use cases
- **Error Handling**: Structured error responses with connection management

## Architecture Overview

```
WebSocketAuthMiddleware (extends BaseWebSocketMiddleware)
├── Connection Authentication
│   ├── JWT Token Authentication (payload, headers, query)
│   ├── API Key Authentication (payload, headers, query)
│   └── Session Authentication (headers, cookies, query)
├── Message Authorization
│   ├── Global Role Checking
│   ├── Message-Specific Roles
│   ├── Global Permission Checking
│   ├── Message-Specific Permissions
│   └── CASL Ability Checking (global and per-message)
├── Connection Management
│   ├── Persistent Authentication Sessions
│   ├── Authentication Timeout Handling
│   ├── Reauthentication Intervals
│   └── Connection Cleanup
└── Enterprise Features
    ├── Comprehensive Metrics
    ├── Structured Logging
    ├── Error Handling with Connection Management
    └── Real-time Connection Statistics
```

## Usage Examples

### Basic Usage

```typescript
import {
  createWebSocketAuthMiddleware,
  WS_AUTH_PRESETS,
} from "@libs/middleware/auth";
import { AuthenticationService } from "@libs/auth";
import { MetricsCollector } from "@libs/monitoring";

// Initialize dependencies
const metrics = new MetricsCollector();
const authService = new AuthenticationService(/* dependencies */);

// Create WebSocket authentication middleware
const wsAuthMiddleware = createWebSocketAuthMiddleware(
  metrics,
  authService,
  WS_AUTH_PRESETS.requireAuth()
);

// Use with your WebSocket framework
websocketServer.use(wsAuthMiddleware.middleware());
```

### Configuration Examples

#### Real-time Chat Application

```typescript
const chatAuthMiddleware = createWebSocketAuthMiddleware(metrics, authService, {
  name: "chat-auth",
  requireAuth: true,
  jwtAuth: true,
  sessionAuth: true,
  allowUnauthenticatedTypes: ["ping", "pong", "heartbeat"],
  messagePermissions: {
    send_message: ["chat:write"],
    delete_message: ["chat:delete", "chat:moderate"],
    ban_user: ["chat:moderate"],
    create_room: ["chat:admin"],
  },
  messageRoles: {
    moderate: ["moderator", "admin"],
    admin_command: ["admin"],
  },
  authenticationTimeout: 300000, // 5 minutes
  reauthenticationInterval: 3600000, // 1 hour
});
```

#### Gaming WebSocket Authentication

```typescript
const gamingAuthMiddleware = createWebSocketAuthMiddleware(
  metrics,
  authService,
  {
    name: "gaming-auth",
    requireAuth: true,
    jwtAuth: true,
    roles: ["player"],
    allowUnauthenticatedTypes: ["ping", "pong"],
    messageActions: {
      make_move: { action: "update", resource: "user" },
      start_game: { action: "create", resource: "user" },
      admin_reset: { action: "manage", resource: "all" },
    },
    messageRoles: {
      admin_reset: ["admin"],
      moderate_game: ["moderator", "admin"],
    },
    authenticationTimeout: 180000, // 3 minutes
    strictMode: true,
  }
);
```

#### API Access with API Keys

```typescript
const apiAuthMiddleware = createWebSocketAuthMiddleware(metrics, authService, {
  name: "api-ws-auth",
  requireAuth: true,
  apiKeyAuth: true,
  jwtAuth: false,
  sessionAuth: false,
  allowAnonymous: false,
  closeOnAuthFailure: true,
  strictMode: true,
  allowUnauthenticatedTypes: ["ping"],
});
```

### Preset Configurations

#### Pre-built Configuration Presets

```typescript
// Require authentication for all connections
const authRequired = createWebSocketAuthMiddleware(
  metrics,
  authService,
  WS_AUTH_PRESETS.requireAuth()
);

// Optional authentication with graceful degradation
const authOptional = createWebSocketAuthMiddleware(
  metrics,
  authService,
  WS_AUTH_PRESETS.optionalAuth()
);

// Admin-only WebSocket access
const adminOnly = createWebSocketAuthMiddleware(
  metrics,
  authService,
  WS_AUTH_PRESETS.adminOnly()
);

// Real-time chat with comprehensive features
const realtimeChat = createWebSocketAuthMiddleware(
  metrics,
  authService,
  WS_AUTH_PRESETS.realtimeChat()
);

// API access configuration
const apiAccess = createWebSocketAuthMiddleware(
  metrics,
  authService,
  WS_AUTH_PRESETS.apiAccess()
);

// Environment-specific configurations
const development = createWebSocketAuthMiddleware(
  metrics,
  authService,
  WS_AUTH_PRESETS.development()
);

const production = createWebSocketAuthMiddleware(
  metrics,
  authService,
  WS_AUTH_PRESETS.production()
);
```

## Authentication Methods

### 1. JWT Token Authentication

The middleware can extract JWT tokens from multiple sources:

```typescript
// From message payload
{
  type: "authenticate",
  payload: {
    token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}

// From connection headers
WebSocket connection with header: "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

// From connection query parameters
ws://localhost:3000/socket?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 2. API Key Authentication

API keys can be provided through:

```typescript
// From message payload
{
  type: "authenticate",
  payload: {
    apiKey: "api_key_12345"
  }
}

// From connection headers
WebSocket connection with header: "X-API-Key: api_key_12345"

// From connection query parameters
ws://localhost:3000/socket?apiKey=api_key_12345
```

### 3. Session Authentication

Session-based authentication through:

```typescript
// From message payload
{
  type: "authenticate",
  payload: {
    sessionId: "session_12345"
  }
}

// From connection headers
WebSocket connection with header: "X-Session-ID: session_12345"

// From connection cookies
WebSocket connection with cookie: "sessionid=session_12345"

// From connection query parameters
ws://localhost:3000/socket?sessionId=session_12345
```

## Authorization Levels

### 1. Connection-Level Authorization

Authenticate once when connection is established:

```typescript
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  requireAuth: true,
  roles: ["user", "admin"],
  permissions: ["websocket:access"],
});
```

### 2. Message-Level Authorization

Authorize each message type individually:

```typescript
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  messagePermissions: {
    read_data: ["data:read"],
    write_data: ["data:write"],
    admin_action: ["admin:all"],
  },
  messageRoles: {
    admin_action: ["admin"],
    moderate: ["moderator", "admin"],
  },
});
```

### 3. CASL Ability-Based Authorization

Advanced authorization using actions and resources:

```typescript
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  // Global ability requirement
  action: "read",
  resource: "user",

  // Message-specific abilities
  messageActions: {
    edit_document: { action: "update", resource: "user" },
    delete_document: { action: "delete", resource: "user" },
    admin_override: { action: "manage", resource: "all" },
  },
});
```

## Connection Management

### Authentication Persistence

```typescript
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  authenticationTimeout: 300000, // 5 minutes of inactivity
  reauthenticationInterval: 3600000, // 1 hour maximum session
});
```

### Connection Statistics

```typescript
// Get real-time statistics
const stats = middleware.getAuthenticationStats();
console.log(stats);
// {
//   totalConnections: 150,
//   authenticatedConnections: 143,
//   authenticationMethods: {
//     jwt: 120,
//     api_key: 23,
//     session: 0
//   }
// }

// Manually invalidate a connection
middleware.invalidateConnection("connection-id-123");
```

## Advanced Configuration

### Message Type Filtering

```typescript
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  // Skip authentication for these message types
  allowUnauthenticatedTypes: [
    "ping",
    "pong",
    "heartbeat",
    "public_announcement",
  ],

  // Skip middleware entirely for these message types
  skipMessageTypes: ["system_internal"],
});
```

### Error Handling Configuration

```typescript
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  closeOnAuthFailure: true, // Close connection on auth failure
  strictMode: true, // Require at least one auth method to succeed
});
```

### Environment-Specific Timeouts

```typescript
const getTimeoutConfig = (env: string) => {
  switch (env) {
    case "development":
      return {
        authenticationTimeout: 1800000, // 30 minutes
        reauthenticationInterval: 7200000, // 2 hours
      };
    case "production":
      return {
        authenticationTimeout: 300000, // 5 minutes
        reauthenticationInterval: 1800000, // 30 minutes
      };
    default:
      return {
        authenticationTimeout: 600000, // 10 minutes
        reauthenticationInterval: 3600000, // 1 hour
      };
  }
};

const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  ...getTimeoutConfig(process.env.NODE_ENV),
});
```

## WebSocket Context Enrichment

When `extractUserInfo` is enabled, the middleware enriches the WebSocket context:

```typescript
interface EnrichedWebSocketContext {
  authenticated: boolean; // Authentication status
  userId?: string; // User identifier
  userRoles?: string[]; // User roles
  userPermissions?: string[]; // User permissions
  authContext?: AuthContext; // CASL authorization context
  authMethod?: string; // Authentication method used
}

// Usage in your WebSocket handlers
websocketHandler((context) => {
  if (context.authenticated) {
    console.log(`User ${context.userId} sent message`);
    console.log(`User roles: ${context.userRoles?.join(", ")}`);
  }
});
```

## Error Handling

### Authentication Errors

```typescript
// Unauthorized (401) - sent before closing connection
{
  type: "auth_error",
  error: "Authentication required",
  code: 401,
  timestamp: "2023-01-01T12:00:00.000Z"
}

// Forbidden (403) - sent before closing connection
{
  type: "auth_error",
  error: "Insufficient permissions for message type: admin_action",
  code: 403,
  timestamp: "2023-01-01T12:00:00.000Z"
}
```

### Connection Close Codes

```typescript
// WebSocket close codes used by the middleware
const CLOSE_CODES = {
  UNAUTHORIZED: 4401, // Authentication required
  FORBIDDEN: 4403, // Insufficient permissions
  AUTH_TIMEOUT: 4408, // Authentication timeout
  REAUTHENTICATION: 4409, // Reauthentication required
};
```

## Metrics and Monitoring

### Key Metrics

- `ws_auth_success`: Successful WebSocket authentication attempts
- `ws_auth_failure`: Failed WebSocket authentication attempts with reason
- `ws_auth_execution_time`: Middleware execution duration per message
- `ws_auth_error_duration`: Error handling time
- `ws_auth_connections_active`: Current number of authenticated connections
- `ws_auth_connections_total`: Total connections processed

### Metric Tags

- `method`: Authentication method (jwt, api_key, session)
- `userId`: User identifier
- `messageType`: WebSocket message type
- `connectionId`: WebSocket connection identifier
- `error_type`: Error classification
- `reason`: Specific failure reason

## Usage Patterns

### Pattern 1: Connection-Level Authentication

```typescript
// Authenticate once per connection, all messages allowed
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  requireAuth: true,
  allowAnonymous: false,
  closeOnAuthFailure: true,
  allowUnauthenticatedTypes: ["ping", "pong", "heartbeat"],
});
```

### Pattern 2: Message-Level Authorization

```typescript
// Authenticate connection + authorize each message type
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  requireAuth: true,
  messagePermissions: {
    read_data: ["data:read"],
    write_data: ["data:write"],
    admin_action: ["admin:all"],
  },
  messageRoles: {
    admin_action: ["admin"],
  },
});
```

### Pattern 3: Hybrid Authentication

```typescript
// Optional connection auth + strict message auth for sensitive operations
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  requireAuth: false, // Allow anonymous connections
  allowAnonymous: true,
  allowUnauthenticatedTypes: ["ping", "pong", "public_read"],
  messagePermissions: {
    private_read: ["user:read"],
    write: ["user:write"],
    admin: ["admin:all"],
  },
});
```

### Pattern 4: Tiered Access

```typescript
// Different permissions based on user tier
const middleware = createWebSocketAuthMiddleware(metrics, authService, {
  requireAuth: true,
  roles: ["user", "premium", "admin"],
  messageRoles: {
    basic_action: ["user", "premium", "admin"],
    premium_action: ["premium", "admin"],
    admin_action: ["admin"],
  },
});
```

## Integration Examples

### Socket.IO Integration

```typescript
import { Server } from "socket.io";

const io = new Server(server);
const authMiddleware = createWebSocketAuthMiddleware(metrics, authService, {
  requireAuth: true,
  jwtAuth: true,
});

io.use((socket, next) => {
  // Convert Socket.IO to middleware context
  const context = {
    ws: socket,
    connectionId: socket.id,
    message: { type: "connection", payload: {} },
    metadata: {
      connectedAt: new Date(),
      lastActivity: new Date(),
      messageCount: 0,
      clientIp: socket.handshake.address,
      headers: socket.handshake.headers,
      query: socket.handshake.query,
    },
    authenticated: false,
  };

  authMiddleware
    .middleware()(context, () => Promise.resolve())
    .then(() => next())
    .catch((err) => next(err));
});
```

### Native WebSocket Integration

```typescript
import WebSocket, { WebSocketServer } from "ws";

const wss = new WebSocketServer({ port: 8080 });
const authMiddleware = createWebSocketAuthMiddleware(metrics, authService, {
  requireAuth: true,
});

wss.on("connection", (ws, req) => {
  const connectionId = generateId();

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const context = {
        ws,
        connectionId,
        message,
        metadata: {
          connectedAt: new Date(),
          lastActivity: new Date(),
          messageCount: 1,
          clientIp: req.connection.remoteAddress,
          headers: req.headers,
          query: parseQuery(req.url),
        },
        authenticated: false,
      };

      await authMiddleware.middleware()(context, async () => {
        // Handle authenticated message
        await handleMessage(context);
      });
    } catch (error) {
      console.error("WebSocket error:", error);
    }
  });
});
```

## Testing

### Test Utilities

```typescript
import { WS_TESTING_UTILS } from "@libs/middleware/auth";

describe("WebSocket Authentication", () => {
  it("should authenticate valid JWT tokens", async () => {
    const { middleware, mocks } = WS_TESTING_UTILS.createMockMiddleware();

    const context = WS_TESTING_UTILS.createTestContext({
      message: {
        type: "authenticate",
        payload: { token: "valid-jwt" },
      },
    });

    mocks.authService.verifyToken.mockResolvedValue({
      id: "user123",
      roles: ["user"],
      permissions: ["basic:access"],
    });

    await middleware.middleware()(context, () => Promise.resolve());

    expect(context.authenticated).toBe(true);
    expect(context.userId).toBe("user123");
  });

  it("should close connection on authentication failure", async () => {
    const { middleware, mocks } = WS_TESTING_UTILS.createMockMiddleware();

    const context = WS_TESTING_UTILS.createTestContext({
      message: { type: "secure_action" },
    });

    try {
      await middleware.middleware()(context, () => Promise.resolve());
    } catch (error) {
      expect(error.message).toBe("Authentication required");
      expect(context.ws.close).toHaveBeenCalledWith(
        4401,
        "Authentication required"
      );
    }
  });
});
```

## Security Best Practices

1. **Authentication Timeout**: Set appropriate timeouts for inactive connections
2. **Reauthentication**: Require periodic reauthentication for long-lived connections
3. **Message Filtering**: Only allow unauthenticated access to truly public message types
4. **Connection Limits**: Implement connection limits per user/IP
5. **Rate Limiting**: Combine with rate limiting middleware for comprehensive protection
6. **Audit Logging**: Log all authentication attempts and authorization failures
7. **Token Validation**: Ensure tokens are properly validated against the authentication service
8. **Error Handling**: Provide minimal error information to prevent enumeration attacks

## Performance Considerations

1. **Connection Caching**: Authentication results are cached per connection
2. **Efficient Validation**: Fast token and session validation through auth service caching
3. **Cleanup Intervals**: Regular cleanup of expired authentication sessions
4. **Bypass Routes**: Skip authentication for system messages (ping/pong)
5. **Lazy Evaluation**: Only perform expensive checks when required
6. **Message Filtering**: Early filtering of unauthenticated message types

## Troubleshooting

### Common Issues

1. **Authentication Timing Out Too Quickly**

   ```typescript
   // Increase timeout values
   const middleware = createWebSocketAuthMiddleware(metrics, authService, {
     authenticationTimeout: 600000, // 10 minutes instead of 5
     reauthenticationInterval: 7200000, // 2 hours instead of 1
   });
   ```

2. **Messages Being Blocked Unexpectedly**

   ```typescript
   // Add message types to allowed list
   const middleware = createWebSocketAuthMiddleware(metrics, authService, {
     allowUnauthenticatedTypes: ["ping", "pong", "status", "your_message_type"],
   });
   ```

3. **Connection Closing on Permission Errors**
   ```typescript
   // Disable connection closing on auth failures
   const middleware = createWebSocketAuthMiddleware(metrics, authService, {
     closeOnAuthFailure: false,
   });
   ```

The WebSocket authentication middleware provides enterprise-grade security for real-time applications while maintaining the flexibility and performance needed for production deployments.
