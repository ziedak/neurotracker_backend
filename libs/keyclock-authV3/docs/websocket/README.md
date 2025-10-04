# WebSocket Authentication & Authorization

This section covers real-time authentication and authorization for WebSocket connections, enabling secure bidirectional communication with the authentication system.

## Overview

The WebSocket authentication system provides:

- **Connection Authentication:** Authenticate WebSocket upgrade requests
- **Real-time Authorization:** Authorize messages and subscriptions
- **Connection Management:** Track authenticated connections
- **Permission Updates:** Real-time permission synchronization
- **Security Monitoring:** Monitor WebSocket security events

## Architecture

```
WebSocket Client → WebSocket Server → Auth Middleware → Authz Middleware → Application
                        ↓
                   Connection Manager
                        ↓
                 Permission Cache
```

## Components

### [Connection Manager](connection-manager.md)

Manages WebSocket connection lifecycle and authentication state.

### [Authentication Middleware](auth-middleware.md)

Handles WebSocket connection authentication during upgrade.

### [Authorization Middleware](authz-middleware.md)

Enforces real-time permissions on WebSocket messages.

### [Message Handler](message-handler.md)

Processes authenticated WebSocket messages with authorization.

### [Subscription Manager](subscription-manager.md)

Manages topic/channel subscriptions with permission checks.

## Quick Start

```typescript
import { createWebSocketAuth } from "@libs/auth";

// Create WebSocket auth middleware
const wsAuth = createWebSocketAuth({
  tokenValidator: jwtValidator,
  permissionChecker: caslChecker,
});

// Use in WebSocket server
app.ws("/realtime", {
  beforeHandle: [wsAuth.authenticateConnection],
  message: wsAuth.authorizeMessage,
});
```

## Authentication Methods

### Token Authentication

```typescript
// URL parameter
//host/realtime?token=jwt_token_here

// Subprotocol negotiation
ws: const ws = new WebSocket("ws://host/realtime", ["auth", "jwt_token_here"]);
```

### Session Authentication

```typescript
// Use existing session cookies
const ws = new WebSocket("ws://host/realtime");
// Cookies automatically included in upgrade request
```

## Message Authorization

```typescript
// Client sends
{
  "type": "subscribe",
  "topic": "user:123",
  "token": "jwt_token"
}

// Server validates permissions for topic subscription
const allowed = await wsAuth.checkTopicPermission(user, 'user:123', 'read');
```

## Security Features

- **Connection Rate Limiting:** Prevent connection floods
- **Message Validation:** Validate message structure and content
- **Permission Caching:** Cache permissions per connection
- **Audit Logging:** Log all WebSocket security events
- **Automatic Cleanup:** Clean up disconnected sessions

## Error Handling

```typescript
// Authentication failure
ws.send(
  JSON.stringify({
    type: "error",
    code: "AUTH_FAILED",
    message: "Invalid authentication token",
  })
);

// Authorization failure
ws.send(
  JSON.stringify({
    type: "error",
    code: "FORBIDDEN",
    message: "Insufficient permissions for topic",
  })
);
```

## Monitoring

WebSocket connections expose metrics:

- Active connections by user
- Message throughput
- Authentication success/failure rates
- Permission check latency
- Connection duration statistics
