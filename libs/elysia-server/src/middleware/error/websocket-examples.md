# WebSocket Error Middleware Examples

This file demonstrates how to use the WebSocket Error Middleware with our new AbstractMiddleware architecture.

## Basic WebSocket Error Middleware Setup

```typescript
import { 
  createWebSocketErrorMiddleware, 
  WebSocketErrorMiddleware,
  type WebSocketErrorMiddlewareConfig 
} from "@libs/middleware";
import { MetricsCollector } from "@libs/monitoring";

// Initialize metrics collector
const metrics = new MetricsCollector();

// Example 1: Simple factory usage
const wsErrorMiddleware = createWebSocketErrorMiddleware(metrics, {
  includeStackTrace: process.env.NODE_ENV === "development",
  logErrors: true,
  errorResponseType: "error",
});

// Get WebSocket middleware function
const middlewareFunction = wsErrorMiddleware.middleware();
console.log("✅ Created WebSocket error middleware");
```

## Direct Instantiation with Custom Config

```typescript
const customConfig: WebSocketErrorMiddlewareConfig = {
  name: "custom-ws-error-handler",
  enabled: true,
  priority: 1000,
  includeStackTrace: false,
  logErrors: true,
  errorResponseType: "error",
  customErrorMessages: {
    WebSocketValidationError: "Invalid message format",
    WebSocketAuthenticationError: "Authentication required for WebSocket",
    WebSocketAuthorizationError: "You don't have permission for this action",
    WebSocketConnectionError: "Connection issue occurred",
    WebSocketRateLimitError: "Too many messages sent",
  },
  sensitiveFields: ["password", "token", "apiKey", "secret", "sessionId"],
  skipMessageTypes: ["ping", "pong"], // Skip error handling for these message types
};

const customWsErrorMiddleware = new WebSocketErrorMiddleware(metrics, customConfig);
console.log("✅ Created custom WebSocket error middleware");
```

## WebSocket Chain Integration

```typescript
import { WebSocketMiddlewareChain } from "@libs/middleware";

const wsChain = new WebSocketMiddlewareChain(metrics, "websocket-error-chain");

// Register error middleware with high priority
wsChain.register(
  {
    name: "error-handler",
    priority: 1000, // Highest priority to catch all errors
    enabled: true,
  },
  wsErrorMiddleware.middleware()
);

// Register other middleware with lower priorities
wsChain.register(
  {
    name: "auth",
    priority: 900,
    enabled: true,
  },
  authMiddleware.middleware()
);

wsChain.register(
  {
    name: "rate-limit",
    priority: 800,
    enabled: true,
  },
  rateLimitMiddleware.middleware()
);

// Create executor for WebSocket handler
const chainExecutor = wsChain.createExecutor();
console.log("✅ Configured WebSocket chain with error handling");
```

## Per-Connection Configuration

```typescript
const baseWsErrorMiddleware = createWebSocketErrorMiddleware(metrics, {
  includeStackTrace: false,
  logErrors: true,
});

// Different configs for different connection types
const adminWsErrorMiddleware = baseWsErrorMiddleware.withConfig({
  includeStackTrace: true, // More details for admin connections
  customErrorMessages: {
    WebSocketValidationError: "Admin: Detailed validation error with context",
  },
});

const publicWsErrorMiddleware = baseWsErrorMiddleware.withConfig({
  includeStackTrace: false, // Minimal info for public connections
  customErrorMessages: {
    WebSocketValidationError: "Invalid message",
    WebSocketAuthenticationError: "Access denied",
    WebSocketConnectionError: "Connection error",
  },
});

console.log("✅ Configured per-connection error handling");
```

## Custom WebSocket Error Types

```typescript
// Create custom WebSocket errors
const validationError = WebSocketErrorMiddleware.createWebSocketValidationError(
  "Invalid message format", 
  { messageType: "subscribe", reason: "missing channel" }
);

const authError = WebSocketErrorMiddleware.createWebSocketAuthenticationError();
const authzError = WebSocketErrorMiddleware.createWebSocketAuthorizationError("Insufficient permissions");
const connectionError = WebSocketErrorMiddleware.createWebSocketConnectionError("Connection lost");
const rateLimitError = WebSocketErrorMiddleware.createWebSocketRateLimitError();

console.log("✅ Created custom WebSocket error types");
```

## Environment-Specific Presets

```typescript
// Development preset with detailed errors
const devWsErrorConfig = WebSocketErrorMiddleware.createDevelopmentConfig();
const devWsErrorHandler = createWebSocketErrorMiddleware(metrics, {
  name: "dev-ws-error-handler",
  enabled: true,
  priority: 1000,
  ...devWsErrorConfig,
});

// Production preset with minimal error exposure
const prodWsErrorConfig = WebSocketErrorMiddleware.createProductionConfig();
const prodWsErrorHandler = createWebSocketErrorMiddleware(metrics, {
  name: "prod-ws-error-handler",
  enabled: true,
  priority: 1000,
  ...prodWsErrorConfig,
});

// Audit preset for compliance
const auditWsErrorConfig = WebSocketErrorMiddleware.createAuditConfig();
const auditWsErrorHandler = createWebSocketErrorMiddleware(metrics, {
  name: "audit-ws-error-handler",
  enabled: true,
  priority: 1000,
  ...auditWsErrorConfig,
});

console.log("✅ Created environment-specific WebSocket error handlers");
```

## Direct Error Handling

```typescript
// Mock WebSocket context
const mockWsContext = {
  connectionId: "conn_123",
  authenticated: true,
  user: { id: "user_456" },
  message: { type: "subscribe", channel: "notifications" },
  ws: {
    readyState: 1, // WebSocket.OPEN
    url: "wss://api.example.com/ws",
    send: (data: string) => console.log("Sent:", data),
  },
} as any;

// Create error response directly
const testError = WebSocketErrorMiddleware.createWebSocketValidationError(
  "Invalid subscription request", 
  { channel: "notifications", reason: "channel not found" }
);

wsErrorMiddleware.createWebSocketErrorResponse(testError, mockWsContext).then(response => {
  console.log("✅ Created WebSocket error response:", {
    type: response.type,
    success: response.success,
    error: response.error,
    connectionId: response.connectionId,
  });
});
```

## Async Error Handling

```typescript
// Wrap risky WebSocket operations
const riskyWebSocketOperation = async (data: any) => {
  if (!data.channel) {
    throw WebSocketErrorMiddleware.createWebSocketValidationError("Channel is required");
  }
  if (!data.auth) {
    throw WebSocketErrorMiddleware.createWebSocketAuthenticationError();
  }
  return { success: true, subscribed: true };
};

// Safe wrapper
const safeWebSocketOperation = wsErrorMiddleware.wrapWebSocketHandler(riskyWebSocketOperation);

// Test the wrapped function
safeWebSocketOperation({ message: "test" }).then(result => {
  console.log("✅ Safe WebSocket operation result:", result);
});
```

## Integration with WebSocket Server

```typescript
// Example integration with a WebSocket server
class WebSocketServer {
  private errorMiddleware: WebSocketErrorMiddleware;

  constructor() {
    this.errorMiddleware = createWebSocketErrorMiddleware(metrics, {
      includeStackTrace: process.env.NODE_ENV === "development",
      logErrors: true,
      errorResponseType: "error",
    });
  }

  async handleMessage(ws: WebSocket, message: any) {
    const context = {
      connectionId: ws.id,
      authenticated: ws.authenticated,
      user: ws.user,
      message: message,
      ws: ws,
    };

    try {
      // Process message
      await this.processMessage(context);
    } catch (error) {
      // Let error middleware handle the error
      const errorResponse = await this.errorMiddleware.createWebSocketErrorResponse(
        error as Error, 
        context
      );
      
      // Send error response to client
      ws.send(JSON.stringify(errorResponse));
    }
  }

  private async processMessage(context: any) {
    // Your message processing logic
    if (context.message.type === "subscribe") {
      // Handle subscription
    } else if (context.message.type === "publish") {
      // Handle publishing
    } else {
      throw WebSocketErrorMiddleware.createWebSocketValidationError(
        "Unknown message type",
        { type: context.message.type }
      );
    }
  }
}

console.log("✅ WebSocket server with error handling configured");
```

## Testing Configuration

```typescript
const testWsErrorMiddleware = createWebSocketErrorMiddleware(metrics, {
  name: "test-ws-error-handler",
  enabled: true,
  priority: 1000,
  includeStackTrace: true, // Useful for debugging tests
  logErrors: false, // Disable logging in tests
  errorResponseType: "test_error",
  customErrorMessages: {
    WebSocketValidationError: "Test validation error",
  },
});

console.log("✅ Created test WebSocket error configuration");
```

## Error Response Format

WebSocket error responses follow this format:

```typescript
interface WebSocketErrorResponse {
  type: string;           // "error" or custom type
  success: false;
  error: string;          // Error type (WebSocketValidationError, etc.)
  message: string;        // User-friendly message
  timestamp: string;      // ISO timestamp
  connectionId?: string;  // WebSocket connection ID
  details?: any;          // Additional error details (sanitized)
  stackTrace?: string;    // Stack trace (if enabled)
}
```

Example response:
```json
{
  "type": "error",
  "success": false,
  "error": "WebSocketValidationError",
  "message": "Invalid message format",
  "timestamp": "2025-09-07T10:30:00.000Z",
  "connectionId": "conn_123",
  "details": {
    "messageType": "subscribe",
    "reason": "missing channel"
  }
}
```

## Security Features

The WebSocket error middleware automatically sanitizes:

- **Sensitive fields**: Configurable patterns become `[REDACTED]`
- **File paths**: Replaced with `[FILE_PATH]`
- **Credentials**: Connection strings become `[CREDENTIALS]`
- **Email addresses**: Replaced with `[EMAIL]`

## Best Practices

1. **High Priority**: Register error middleware with priority 1000 to catch all errors
2. **Environment-Specific**: Use different configs for dev/staging/production
3. **Connection-Specific**: Use `withConfig()` for different connection types
4. **Message Type Filtering**: Use `skipMessageTypes` for heartbeat messages
5. **Comprehensive Logging**: Enable logging in production for monitoring
6. **Minimal Error Exposure**: Don't include stack traces in production

The WebSocket Error Middleware provides comprehensive error handling for WebSocket connections while following the same architectural patterns as our HTTP error middleware! 🎉
