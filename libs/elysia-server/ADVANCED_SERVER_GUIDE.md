# Advanced Elysia Server with Middleware Chaining

This enhanced Elysia server implementation leverages your advanced middleware system with priority-based chaining, comprehensive monitoring, and both HTTP and WebSocket support.

## Key Features

### 🔄 Advanced Middleware System

- **Priority-based execution** - Middleware executes in order of priority (highest first)
- **Dynamic middleware management** - Add, remove, or toggle middleware at runtime
- **HTTP and WebSocket support** - Separate chains for different protocols
- **Metrics integration** - Built-in performance monitoring and execution tracking
- **Error isolation** - Middleware failures don't break the entire chain

### 🏗️ Predefined Patterns

- **BASIC_HTTP_SECURITY** - Essential security middleware
- **BASIC_WS_SECURITY** - WebSocket-specific security
- **PRODUCTION_HTTP** - Full production-ready HTTP stack
- **PRODUCTION_WS** - Full production-ready WebSocket stack

### 📊 Built-in Monitoring

- Middleware execution metrics
- Chain performance tracking
- Connection statistics
- Real-time middleware stats endpoint

## Quick Start

### Basic Production Setup

```typescript
import {
  createAdvancedElysiaServer,
  type IMetricsCollector,
} from "@libs/elysia-server";

// Initialize metrics collector
const metrics: IMetricsCollector = new MetricsCollector();

// Create server with production middleware pattern
const server = createAdvancedElysiaServer(
  {
    name: "My API",
    port: 3000,
    websocket: { enabled: true },
  },
  metrics,
  {
    // Use production HTTP pattern
    httpPattern: "PRODUCTION_HTTP",
    wsPattern: "PRODUCTION_WS",

    // Configure individual middleware
    auth: { enabled: true, priority: 110 },
    cors: { enabled: true, priority: 140 },
    rateLimit: { enabled: true, priority: 120 },
    security: { enabled: true, priority: 130 },
    logging: { enabled: true, priority: 150 },
  }
);

// Add your routes
server.addRoutes((app) => {
  app.get("/api/users", async () => {
    return { users: [] };
  });

  app.post("/api/users", async ({ body }) => {
    return { created: body };
  });

  return app;
});

// Start the server
const { app, server: instance, wsServer } = server.start();
```

### Custom Middleware Chain

```typescript
import {
  createAdvancedElysiaServer,
  AuthMiddleware,
  CorsMiddleware,
  RateLimitMiddleware,
} from "@libs/elysia-server";

const server = createAdvancedElysiaServer(
  { name: "Custom API", port: 3000 },
  metrics,
  {
    customHttpChain: [
      {
        name: "cors",
        middleware: new CorsMiddleware(metrics, { origin: "*" }),
        priority: 100,
        enabled: true,
      },
      {
        name: "auth",
        middleware: new AuthMiddleware(metrics, authService, {}),
        priority: 90,
        enabled: true,
      },
      {
        name: "rate-limit",
        middleware: new RateLimitMiddleware(metrics, cache, { limit: 100 }),
        priority: 80,
        enabled: true,
      },
    ],
  }
);
```

### Dynamic Middleware Management

```typescript
// Add middleware at runtime
server.addHttpMiddleware("custom-validator", customValidatorMiddleware, 85);

// Add WebSocket middleware
server.addWebSocketMiddleware("ws-auth", wsAuthMiddleware, 95);

// Get middleware statistics
const stats = server.getMiddlewareStats();
console.log("HTTP Middlewares:", stats.http.count);
console.log("WebSocket Middlewares:", stats.websocket.count);
```

## Middleware Configuration

### Individual Middleware Settings

```typescript
const middlewareConfig = {
  auth: {
    enabled: true,
    priority: 110,
    config: {
      jwtSecret: process.env.JWT_SECRET,
      skipPaths: ["/health", "/swagger"],
    },
  },
  cors: {
    enabled: true,
    priority: 140,
    config: {
      origin: ["https://myapp.com", "https://admin.myapp.com"],
      credentials: true,
    },
  },
  rateLimit: {
    enabled: true,
    priority: 120,
    config: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
    },
  },
  security: {
    enabled: true,
    priority: 130,
    config: {
      hsts: true,
      xssProtection: true,
      contentTypeOptions: true,
    },
  },
};
```

## WebSocket Advanced Features

### Custom WebSocket Handler

```typescript
server.addWebSocketHandler({
  open: (ws) => {
    console.log("Client connected");
  },
  message: (ws, message) => {
    // Handle custom message types
    if (message.type === "chat") {
      server.sendToRoom(message.payload.room, {
        type: "chat_message",
        payload: message.payload,
      });
    }
  },
  close: (ws, code, reason) => {
    console.log("Client disconnected:", code, reason);
  },
});
```

### Room Management

```typescript
// Send to specific user
server.sendToUser("user123", {
  type: "notification",
  payload: { message: "Hello!" },
});

// Send to room
server.sendToRoom("room_general", {
  type: "announcement",
  payload: { text: "Server maintenance in 5 minutes" },
});

// Broadcast to all connections
server.broadcast({
  type: "system",
  payload: { status: "Server restarting" },
});
```

## Monitoring and Statistics

### Built-in Endpoints

- `GET /health` - Health check with middleware stats
- `GET /middleware/stats` - Detailed middleware statistics
- `GET /ws/stats` - WebSocket connection statistics

### Health Check Response

```json
{
  "status": "healthy",
  "timestamp": "2025-09-10T15:30:00.000Z",
  "uptime": 3600,
  "service": "My API",
  "version": "1.0.0",
  "middleware": {
    "http": {
      "count": 6,
      "middlewares": [
        { "name": "logging", "priority": 150, "enabled": true },
        { "name": "cors", "priority": 140, "enabled": true },
        { "name": "security", "priority": 130, "enabled": true },
        { "name": "rateLimit", "priority": 120, "enabled": true },
        { "name": "auth", "priority": 110, "enabled": true },
        { "name": "prometheus", "priority": 10, "enabled": true }
      ]
    },
    "websocket": {
      "count": 3,
      "middlewares": [
        { "name": "ws-logging", "priority": 150, "enabled": true },
        { "name": "ws-auth", "priority": 140, "enabled": true },
        { "name": "ws-rateLimit", "priority": 130, "enabled": true }
      ]
    }
  }
}
```

## Middleware Patterns

### Security-First Pattern

```typescript
const securityConfig = {
  httpPattern: "BASIC_HTTP_SECURITY" as const,
  security: {
    enabled: true,
    priority: 150,
    config: {
      hsts: { maxAge: 31536000 },
      contentSecurityPolicy: true,
      xssProtection: true,
    },
  },
  cors: {
    enabled: true,
    priority: 140,
    config: {
      origin: process.env.ALLOWED_ORIGINS?.split(","),
      credentials: true,
    },
  },
  rateLimit: {
    enabled: true,
    priority: 130,
    config: {
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
    },
  },
};
```

### Development Pattern

```typescript
const devConfig = {
  httpPattern: "BASIC_HTTP_SECURITY" as const,
  cors: {
    enabled: true,
    config: { origin: "*" },
  },
  auth: {
    enabled: false, // Disable auth in development
  },
  rateLimit: {
    enabled: false, // Disable rate limiting in development
  },
  logging: {
    enabled: true,
    config: { level: "debug" },
  },
};
```

## Performance Optimization

### Middleware Priorities

Higher numbers execute first:

- **150+**: Logging, monitoring
- **130-149**: Security headers, CORS
- **110-129**: Rate limiting, validation
- **90-109**: Authentication, authorization
- **50-89**: Business logic middleware
- **1-49**: Response transformation
- **0**: Error handling (should be last)

### Best Practices

1. **Keep middleware lightweight** - Heavy operations should be async
2. **Use proper priorities** - Security first, business logic last
3. **Monitor performance** - Check `/middleware/stats` regularly
4. **Handle errors gracefully** - Don't let one middleware break the chain
5. **Use patterns** - Leverage predefined patterns for common setups

## Migration from Simple Server

### Before (Simple Server)

```typescript
import { createElysiaServer } from "@libs/elysia-server";

const server = createElysiaServer({
  name: "My API",
  port: 3000,
});
```

### After (Advanced Server)

```typescript
import { createAdvancedElysiaServer } from "@libs/elysia-server";

const server = createAdvancedElysiaServer(
  {
    name: "My API",
    port: 3000,
  },
  metrics,
  {
    httpPattern: "PRODUCTION_HTTP",
    // Enable only needed middleware
    auth: { enabled: true },
    cors: { enabled: true },
    rateLimit: { enabled: true },
  }
);
```

The advanced server provides all the capabilities of the simple server plus the sophisticated middleware system, better monitoring, and production-ready defaults.
