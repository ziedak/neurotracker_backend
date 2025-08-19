# WebSocket Middleware Integration Guide

## Overview

This document provides guidance on how to integrate the production-grade WebSocket middleware system with Elysia-based applications. The middleware system includes:

- **WebSocketAuthMiddleware**: JWT and API key authentication for WebSocket connections
- **WebSocketRateLimitMiddleware**: Connection and message rate limiting with Redis backend
- **BaseWebSocketMiddleware**: Base class for custom WebSocket middleware

## Architecture

```
WebSocket Connection → Auth Middleware → Rate Limit Middleware → Your Handler
                        ↓                    ↓                      ↓
                   Authentication       Rate Limiting          Business Logic
                   Authorization        Connection Limits      Message Processing
                   JWT/API Key         Message Limits         Response Handling
```

## Installation and Setup

### 1. Install Dependencies

```bash
pnpm add @libs/middleware @libs/auth @libs/monitoring @libs/database
```

### 2. Basic WebSocket Middleware Configuration

```typescript
import {
  createWebSocketAuthMiddleware,
  createWebSocketRateLimitMiddleware,
  type WebSocketContext,
  type WebSocketAuthConfig,
  type WebSocketRateLimitConfig,
} from "@libs/middleware";

// Authentication Configuration
const wsAuthConfig: WebSocketAuthConfig = {
  name: "ws-auth",
  enabled: true,
  requireAuth: true,
  jwtSecret: process.env.JWT_SECRET!,
  apiKeyHeader: "x-api-key",
  closeOnAuthFailure: true,
  skipAuthenticationForTypes: ["ping", "heartbeat"],
  messagePermissions: {
    predict: ["ai:predict"],
    admin: ["admin:all"],
  },
  messageRoles: {
    admin_action: ["admin"],
  },
};

// Rate Limiting Configuration
const wsRateLimitConfig: WebSocketRateLimitConfig = {
  name: "ws-ratelimit",
  enabled: true,
  maxConnections: 50,
  maxMessagesPerMinute: 30,
  maxMessagesPerHour: 1000,
  keyGenerator: (context) =>
    context.userId
      ? `user:${context.userId}`
      : `ip:${context.metadata.clientIp}`,
};
```

### 3. Create Middleware Instances

```typescript
const wsAuthMiddleware = createWebSocketAuthMiddleware(wsAuthConfig);
const wsRateLimitMiddleware =
  createWebSocketRateLimitMiddleware(wsRateLimitConfig);
```

## Integration Patterns

### Pattern 1: Manual Middleware Chain

```typescript
export function createWebSocketHandler() {
  return new Elysia().ws("/ws/api", {
    message: async (ws, message) => {
      // Create WebSocket context
      const context: WebSocketContext = {
        ws,
        connectionId: generateConnectionId(),
        message: parseMessage(message),
        metadata: {
          connectedAt: new Date(),
          lastActivity: new Date(),
          messageCount: getMessageCount(ws),
          clientIp: getClientIP(ws),
          userAgent: getUserAgent(ws),
          headers: getHeaders(ws),
          query: getQuery(ws),
        },
        authenticated: false,
      };

      try {
        // Apply middleware chain
        const middlewares = [wsAuthMiddleware, wsRateLimitMiddleware];
        let index = 0;

        const next = async (): Promise<void> => {
          if (index < middlewares.length) {
            await middlewares[index++](context, next);
          } else {
            // Process business logic
            await handleBusinessLogic(context);
          }
        };

        await next();
      } catch (error) {
        await handleError(context, error);
      }
    },
  });
}
```

### Pattern 2: Middleware Factory Helper

```typescript
function createWebSocketMiddlewareChain(
  middlewares: WebSocketMiddlewareFunction[]
) {
  return async (
    context: WebSocketContext,
    businessLogic: () => Promise<void>
  ) => {
    let index = 0;

    const next = async (): Promise<void> => {
      if (index < middlewares.length) {
        await middlewares[index++](context, next);
      } else {
        await businessLogic();
      }
    };

    await next();
  };
}

// Usage
const middlewareChain = createWebSocketMiddlewareChain([
  wsAuthMiddleware,
  wsRateLimitMiddleware,
]);

// In your WebSocket handler
await middlewareChain(context, async () => {
  // Your business logic here
  await processWebSocketMessage(context);
});
```

## Message Flow Examples

### 1. Authenticated Prediction Request

```typescript
// Client sends:
{
  "type": "predict",
  "id": "req_123",
  "payload": {
    "input": "sample data"
  }
}

// Middleware processes:
// 1. Auth middleware validates JWT token
// 2. Rate limit middleware checks message limits
// 3. Business logic processes prediction

// Server responds:
{
  "type": "prediction_result",
  "requestId": "req_123",
  "result": {
    "confidence": 0.95,
    "prediction": "positive"
  },
  "timestamp": "2024-08-19T00:00:00.000Z"
}
```

### 2. Authentication Failure

```typescript
// Client sends invalid token:
{
  "type": "predict",
  "payload": {"input": "data"}
}

// Auth middleware responds and closes connection:
{
  "type": "auth_error",
  "error": {
    "code": "TOKEN_INVALID",
    "message": "Invalid or expired token",
    "timestamp": "2024-08-19T00:00:00.000Z"
  },
  "connectionId": "conn_12345"
}
// Connection closed with code 1008 (Policy violation)
```

### 3. Rate Limit Exceeded

```typescript
// Client exceeds rate limit:
{
  "type": "rate_limit_error",
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded for minute: 61/60 messages",
    "timestamp": "2024-08-19T00:00:00.000Z",
    "retryAfter": 60
  },
  "connectionId": "conn_12345"
}
// Message dropped, connection remains open
```

## Security Best Practices

### 1. Authentication Configuration

```typescript
const secureAuthConfig: WebSocketAuthConfig = {
  name: "secure-ws-auth",
  enabled: true,
  requireAuth: true, // Always require authentication in production
  jwtSecret: process.env.JWT_SECRET!, // Use strong secret from environment
  closeOnAuthFailure: true, // Close connections on auth failure
  skipAuthenticationForTypes: [], // Minimize skipped types
  messagePermissions: {
    // Define granular permissions
    sensitive_action: ["admin:write", "service:manage"],
  },
};
```

### 2. Rate Limiting Configuration

```typescript
const secureRateLimitConfig: WebSocketRateLimitConfig = {
  name: "secure-ws-ratelimit",
  enabled: true,
  maxConnections: 10, // Conservative connection limits
  maxMessagesPerMinute: 20, // Conservative message limits
  maxMessagesPerHour: 500,
  keyGenerator: (context) => {
    // Use most specific identifier available
    if (context.userId) return `user:${context.userId}`;
    if (context.metadata.headers["x-api-key"])
      return `api:${context.metadata.headers["x-api-key"]}`;
    return `ip:${context.metadata.clientIp}`;
  },
};
```

### 3. Error Handling

```typescript
async function handleWebSocketError(context: WebSocketContext, error: Error) {
  // Log security events
  if (error.message.includes("auth") || error.message.includes("permission")) {
    logger.security("WebSocket security violation", {
      connectionId: context.connectionId,
      userId: context.userId,
      clientIp: context.metadata.clientIp,
      error: error.message,
    });
  }

  // Don't expose internal errors to client
  const clientError = sanitizeError(error);
  context.ws.send(
    JSON.stringify({
      type: "error",
      error: clientError,
      timestamp: new Date().toISOString(),
    })
  );
}
```

## Performance Optimization

### 1. Connection Pooling

```typescript
// Track connections for cleanup
const connectionTracker = new Map<
  string,
  {
    userId?: string;
    connectedAt: Date;
    messageCount: number;
  }
>();

// Cleanup on disconnect
function cleanupConnection(connectionId: string) {
  const conn = connectionTracker.get(connectionId);
  if (conn) {
    // Clean up rate limiting state
    wsRateLimitMiddleware.cleanupConnection(connectionId, conn.userId);
    connectionTracker.delete(connectionId);
  }
}
```

### 2. Message Batching

```typescript
// Batch multiple predictions in a single request
{
  "type": "batch_predict",
  "requests": [
    {"id": "1", "input": "data1"},
    {"id": "2", "input": "data2"}
  ]
}

// Response includes all results
{
  "type": "batch_prediction_result",
  "results": [
    {"id": "1", "result": "..."},
    {"id": "2", "result": "..."}
  ]
}
```

## Monitoring and Metrics

The middleware automatically records metrics for:

- `ws_auth_success` - Successful authentications
- `ws_auth_failed` - Failed authentications
- `ws_auth_error` - Authentication errors
- `ws_rate_limit_allowed` - Messages allowed through rate limiting
- `ws_rate_limit_exceeded` - Messages blocked by rate limiting
- `ws_auth_duration` - Time spent in auth middleware
- `ws_rate_limit_duration` - Time spent in rate limit middleware

Access metrics through the monitoring system:

```typescript
import { MetricsCollector } from "@libs/monitoring";

const metrics = MetricsCollector.getInstance();
const authSuccessCount = await metrics.getCounter("ws_auth_success");
const avgAuthDuration = await metrics.getHistogram("ws_auth_duration");
```

## Production Deployment

### Environment Variables

```bash
# JWT Configuration
JWT_SECRET=your-super-secure-secret-key-here
JWT_EXPIRES_IN=24h

# Redis Configuration (for rate limiting)
REDIS_HOST=your-redis-host
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Rate Limiting
WS_MAX_CONNECTIONS_PER_USER=10
WS_MAX_MESSAGES_PER_MINUTE=30
WS_MAX_MESSAGES_PER_HOUR=1000
```

### Health Checks

```typescript
// Add WebSocket health check endpoint
app.get("/health/websocket", async () => {
  const redisHealth = await checkRedisHealth();
  const authHealth = await checkJWTServiceHealth();

  return {
    websocket: {
      status: redisHealth && authHealth ? "healthy" : "unhealthy",
      redis: redisHealth,
      auth: authHealth,
      timestamp: new Date().toISOString(),
    },
  };
});
```

## Troubleshooting

### Common Issues

1. **Authentication Failures**

   - Check JWT secret configuration
   - Verify token format and expiration
   - Ensure API keys are properly configured

2. **Rate Limiting Issues**

   - Verify Redis connection
   - Check rate limiting configuration
   - Monitor connection cleanup

3. **Performance Issues**
   - Monitor middleware execution time
   - Check Redis performance
   - Optimize message processing logic

### Debug Logging

Enable debug logging for middleware:

```typescript
const logger = Logger.getInstance("WebSocket");
logger.setLevel("debug");
```

This will provide detailed logs of middleware execution, authentication attempts, and rate limiting decisions.
