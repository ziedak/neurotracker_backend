# WebSocket CORS Middleware Examples

## Basic Usage

```typescript
import {
  WebSocketCorsMiddleware,
  createWebSocketCorsMiddleware,
  WEBSOCKET_CORS_PRESETS,
} from "@libs/middleware";

// Basic WebSocket CORS middleware
const metrics = new MetricsCollector();
const wsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  origin: ["https://example.com", "https://app.example.com"],
  allowedProtocols: ["wss"],
  credentials: true,
  validateUpgrade: true,
});

// Get middleware function
const middlewareFunction = wsCorsMiddleware.middleware();

// Use with WebSocket handler
websocketHandler.use(middlewareFunction);
```

## Environment-Specific Configurations

### Development Configuration

```typescript
const devConfig = WEBSOCKET_CORS_PRESETS.development();
const devWsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  ...devConfig,
  name: "dev-websocket-cors",
});
```

### Production Configuration

```typescript
const allowedOrigins = ["https://myapp.com", "https://api.myapp.com"];
const prodConfig = WEBSOCKET_CORS_PRESETS.production(allowedOrigins);
const prodWsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  ...prodConfig,
  name: "prod-websocket-cors",
});
```

### Strict Security Configuration

```typescript
const strictConfig = WEBSOCKET_CORS_PRESETS.strict(["https://secure-app.com"]);
const strictWsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  ...strictConfig,
  name: "strict-websocket-cors",
  allowOriginless: false, // No originless connections
  allowedExtensions: [], // No extensions allowed
});
```

## Application-Specific Presets

### Gaming Application

```typescript
const gamingConfig = WEBSOCKET_CORS_PRESETS.gaming([
  "https://game.example.com",
]);
const gamingWsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  ...gamingConfig,
  name: "gaming-websocket-cors",
});
```

### Chat Application

```typescript
const chatConfig = WEBSOCKET_CORS_PRESETS.chat([
  "https://chat.example.com",
  "https://mobile.chat.example.com",
]);
const chatWsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  ...chatConfig,
  name: "chat-websocket-cors",
});
```

### Streaming Application

```typescript
const streamingConfig = WEBSOCKET_CORS_PRESETS.streaming([
  "https://stream.example.com",
]);
const streamingWsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  ...streamingConfig,
  name: "streaming-websocket-cors",
});
```

## Advanced Configuration

### Custom Origin Validation

```typescript
const customWsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  name: "custom-websocket-cors",
  origin: (origin: string) => {
    // Custom validation logic
    return (
      origin.endsWith(".mycompany.com") || origin === "https://localhost:3000"
    );
  },
  allowedProtocols: ["wss"],
  credentials: true,
});
```

### Connection Upgrade Validation

```typescript
const upgradeValidationMiddleware = createWebSocketCorsMiddleware(metrics, {
  name: "upgrade-validation-cors",
  origin: ["https://trusted-app.com"],
  validateUpgrade: true, // Validate during connection upgrade
  allowedProtocols: ["wss"],
  allowedExtensions: ["permessage-deflate"],
  allowOriginless: false, // Strict origin requirement
});
```

## Integration with WebSocket Chain

```typescript
import { WebSocketMiddlewareChain } from "@libs/middleware";

const wsChain = new WebSocketMiddlewareChain(metrics, "websocket-chain");

// Register CORS middleware with high priority
wsChain.register(
  {
    name: "websocket-cors",
    priority: 1000, // High priority for CORS
    enabled: true,
  },
  wsCorsMiddleware.middleware()
);

// Register other middleware
wsChain.register(
  {
    name: "websocket-auth",
    priority: 900,
    enabled: true,
  },
  wsAuthMiddleware.middleware()
);

// Create chain executor
const chainExecutor = wsChain.createExecutor();

// Use with WebSocket server
websocketServer.on("connection", async (ws, request) => {
  const context = {
    ws,
    connectionId: generateConnectionId(),
    message: { type: "connection" },
    metadata: extractMetadata(request),
    authenticated: false,
    upgradeHeaders: request.headers, // Include upgrade headers for CORS validation
  };

  try {
    await chainExecutor(context, async () => {
      // Connection established successfully
      console.log("WebSocket connection established with CORS validation");
    });
  } catch (error) {
    console.error("WebSocket connection failed CORS validation:", error);
    ws.close(1008, "CORS validation failed");
  }
});
```

## Error Handling

### Custom Error Responses

```typescript
const wsCorsWithCustomErrors = createWebSocketCorsMiddleware(metrics, {
  name: "custom-error-websocket-cors",
  origin: ["https://allowed-app.com"],
  validateUpgrade: true,
});

// The middleware automatically sends error responses for CORS failures:
// {
//   "type": "error",
//   "error": "CORS_VALIDATION_FAILED",
//   "message": "WebSocket CORS validation failed",
//   "timestamp": "2025-09-07T10:30:00.000Z"
// }
```

### Connection Termination on CORS Failure

```typescript
websocketServer.on("connection", async (ws, request) => {
  const context = {
    ws,
    connectionId: generateConnectionId(),
    message: { type: "connection" },
    metadata: extractMetadata(request),
    authenticated: false,
    upgradeHeaders: request.headers,
  };

  try {
    await wsCorsMiddleware.middleware()(context, async () => {
      // CORS validation passed
    });
  } catch (error) {
    // CORS validation failed - close connection
    if (error.message.includes("CORS")) {
      ws.close(1008, "Policy Violation: CORS validation failed");
    } else {
      ws.close(1011, "Internal Server Error");
    }
  }
});
```

## Monitoring and Metrics

The WebSocket CORS middleware automatically records metrics:

- `websocket_cors_validation_success` - Successful CORS validations
- `websocket_cors_upgrade_validated` - Successful upgrade validations
- `websocket_cors_execution_time` - Middleware execution time
- `websocket_cors_error` - CORS validation errors

```typescript
// Access metrics through the metrics collector
const corsMetrics = await metrics.getMetrics("websocket_cors_*");
console.log("WebSocket CORS metrics:", corsMetrics);
```

## Best Practices

1. **Use HTTPS in Production**: Always use `wss://` protocol in production
2. **Strict Origin Validation**: Avoid wildcard origins in production
3. **Validate Extensions**: Limit allowed WebSocket extensions for security
4. **Monitor CORS Failures**: Set up alerts for unusual CORS failure patterns
5. **Cache CORS Results**: The middleware includes built-in validation caching
6. **Test CORS Policies**: Thoroughly test CORS configurations before deployment

```typescript
// Production-ready configuration
const productionWsCors = createWebSocketCorsMiddleware(metrics, {
  name: "production-websocket-cors",
  origin: process.env.ALLOWED_ORIGINS?.split(",") || [],
  allowedProtocols: ["wss"], // Only secure WebSocket
  allowedExtensions: ["permessage-deflate"], // Only compression
  credentials: true,
  validateUpgrade: true,
  allowOriginless: false,
  maxAge: 86400, // Cache CORS preflight for 24 hours
  enabled: true,
  priority: 1000,
});
```
