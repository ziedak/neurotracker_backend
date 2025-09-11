# WebSocket Logging Middleware

Production-grade WebSocket logging middleware for comprehensive connection and message tracking with configurable security controls and performance optimization.

## Overview

The WebSocketLoggingMiddleware provides enterprise-level WebSocket connection and message logging capabilities following the AbstractMiddleware architecture pattern. It offers comprehensive data capture, connection lifecycle tracking, security sanitization, and performance optimization for production WebSocket environments.

## Features

- **Framework-Agnostic**: Pure TypeScript implementation following AbstractMiddleware patterns
- **Connection Lifecycle Tracking**: Comprehensive connect/disconnect logging with duration metrics
- **Message Direction Logging**: Bidirectional message tracking (incoming/outgoing)
- **Security-First**: Built-in PII protection and sensitive data sanitization
- **Performance Optimized**: Minimal overhead with configurable message size limits
- **Message Correlation**: Automatic message ID generation and connection tracking
- **Real-time Metrics**: Connection duration, message counts, and processing times
- **Configurable Filtering**: Message type and size-based exclusions
- **Multiple Presets**: Environment-specific configurations (dev, prod, audit, minimal, performance, debug)

## Architecture Compliance

✅ **Extends BaseWebSocketMiddleware**: Proper inheritance from AbstractMiddleware architecture
✅ **Immutable Configuration**: Readonly configuration with proper defaults
✅ **Direct Instantiation**: No dependency injection complexity
✅ **Framework Agnostic**: Returns generic WebSocket middleware functions
✅ **Type Safety**: Full TypeScript strict mode compliance
✅ **Error Handling**: Comprehensive error boundaries and propagation
✅ **Metrics Integration**: Built-in performance and usage metrics

## Installation

```bash
# Install from middleware module
import {
  WebSocketLoggingMiddleware,
  createWebSocketLoggingMiddleware,
  WEBSOCKET_LOGGING_PRESETS
} from "@libs/middleware/logging";
```

## Basic Usage

### Direct Instantiation

```typescript
import { MetricsCollector } from "@libs/monitoring";
import { WebSocketLoggingMiddleware } from "@libs/middleware/logging";

const metrics = new MetricsCollector();
const wsLoggingMiddleware = new WebSocketLoggingMiddleware(metrics, {
  logLevel: "info",
  logIncomingMessages: true,
  logOutgoingMessages: false,
  excludeMessageTypes: ["ping", "pong"],
});

// Use in your WebSocket handler
const middlewareFunction = wsLoggingMiddleware.middleware();
```

### Factory Function

```typescript
import { createWebSocketLoggingMiddleware } from "@libs/middleware/logging";

const wsLoggingMiddleware = createWebSocketLoggingMiddleware(metrics, {
  logLevel: "debug",
  logConnections: true,
  logMetadata: true,
});
```

### Environment Presets

```typescript
import { WEBSOCKET_LOGGING_PRESETS } from "@libs/middleware/logging";

// Development environment
const devLogging = createWebSocketLoggingMiddleware(
  metrics,
  WEBSOCKET_LOGGING_PRESETS.development()
);

// Production environment
const prodLogging = createWebSocketLoggingMiddleware(
  metrics,
  WEBSOCKET_LOGGING_PRESETS.production()
);

// Performance-focused logging
const perfLogging = createWebSocketLoggingMiddleware(
  metrics,
  WEBSOCKET_LOGGING_PRESETS.performance()
);
```

## Configuration

### WebSocketLoggingConfig Interface

```typescript
interface WebSocketLoggingConfig extends WebSocketMiddlewareConfig {
  readonly logLevel?: "debug" | "info" | "warn" | "error";
  readonly logIncomingMessages?: boolean;
  readonly logOutgoingMessages?: boolean;
  readonly logConnections?: boolean;
  readonly logDisconnections?: boolean;
  readonly logMetadata?: boolean;
  readonly excludeMessageTypes?: readonly string[];
  readonly maxMessageSize?: number;
  readonly sensitiveFields?: readonly string[];
  readonly includeMessageTiming?: boolean;
  readonly includeUserContext?: boolean;
  readonly includeConnectionMetrics?: boolean;
  readonly logHeartbeat?: boolean;
  readonly redactPayload?: boolean;
}
```

### Configuration Options

| Option                     | Type       | Default                                                            | Description                                    |
| -------------------------- | ---------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| `logLevel`                 | `string`   | `"info"`                                                           | Minimum log level for output                   |
| `logIncomingMessages`      | `boolean`  | `true`                                                             | Log incoming WebSocket messages                |
| `logOutgoingMessages`      | `boolean`  | `false`                                                            | Log outgoing WebSocket messages                |
| `logConnections`           | `boolean`  | `true`                                                             | Log WebSocket connection events                |
| `logDisconnections`        | `boolean`  | `true`                                                             | Log WebSocket disconnection events             |
| `logMetadata`              | `boolean`  | `false`                                                            | Include connection metadata in logs            |
| `excludeMessageTypes`      | `string[]` | `["ping", "pong", "heartbeat"]`                                    | Message types to exclude                       |
| `maxMessageSize`           | `number`   | `5120`                                                             | Maximum message size to log (bytes)            |
| `sensitiveFields`          | `string[]` | `["password", "token", "secret", "key", "auth", "jwt", "session"]` | Fields to redact                               |
| `includeMessageTiming`     | `boolean`  | `true`                                                             | Include message processing times               |
| `includeUserContext`       | `boolean`  | `true`                                                             | Include user ID and authentication status      |
| `includeConnectionMetrics` | `boolean`  | `true`                                                             | Include connection duration and message counts |
| `logHeartbeat`             | `boolean`  | `false`                                                            | Log heartbeat/ping messages                    |
| `redactPayload`            | `boolean`  | `false`                                                            | Completely redact message payloads             |

## Preset Configurations

### Development Preset

```typescript
WEBSOCKET_LOGGING_PRESETS.development();
// - Debug level logging
// - All message directions logged
// - Full metadata included
// - 50KB message size limit
// - Heartbeat logging enabled
```

### Production Preset

```typescript
WEBSOCKET_LOGGING_PRESETS.production();
// - Info level logging
// - Incoming messages only
// - Payload redaction enabled
// - 5KB message size limit
// - Optimized exclusions
```

### Performance Preset

```typescript
WEBSOCKET_LOGGING_PRESETS.performance();
// - Connection events only
// - Message logging disabled
// - 512B size limit
// - Maximum exclusions
// - Timing metrics enabled
```

### Audit Preset

```typescript
WEBSOCKET_LOGGING_PRESETS.audit();
// - Complete data capture
// - All events logged
// - 100KB message size limit
// - No exclusions
// - Full context tracking
```

### Debug Preset

```typescript
WEBSOCKET_LOGGING_PRESETS.debug();
// - Debug level logging
// - All features enabled
// - 200KB message size limit
// - No exclusions
// - Maximum verbosity
```

### Minimal Preset

```typescript
WEBSOCKET_LOGGING_PRESETS.minimal();
// - Warning level only
// - Connection events only
// - Maximum exclusions
// - 1KB size limit
// - Minimal overhead
```

## Connection Lifecycle Logging

### Connection Event

The middleware automatically logs WebSocket connections:

```typescript
// Call this when a connection is established
await wsLoggingMiddleware.logConnection(context);
```

### Disconnection Event

Log disconnection events with optional reason:

```typescript
// Call this when a connection is closed
await wsLoggingMiddleware.logDisconnection(context, "client_disconnect");
```

## Log Format

### Connection Log

```json
{
  "connectionId": "conn_1643723400000_abc123",
  "event": "connect",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "authenticated": true,
  "userId": "user_456",
  "clientIp": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "query": {
    "room": "general",
    "token": "[REDACTED]"
  },
  "headers": {
    "origin": "https://example.com",
    "authorization": "[REDACTED]"
  }
}
```

### Disconnection Log

```json
{
  "connectionId": "conn_1643723400000_abc123",
  "event": "disconnect",
  "timestamp": "2024-01-01T12:05:30.000Z",
  "authenticated": true,
  "userId": "user_456",
  "clientIp": "192.168.1.100",
  "connectionDuration": 330000,
  "messageCount": 45,
  "reason": "client_disconnect"
}
```

### Message Log

```json
{
  "connectionId": "conn_1643723400000_abc123",
  "direction": "incoming",
  "messageType": "chat_message",
  "messageId": "msg_1643723401000_def456",
  "timestamp": "2024-01-01T12:00:01.000Z",
  "userId": "user_456",
  "authenticated": true,
  "messageSize": 156,
  "processingTime": 45,
  "payload": {
    "text": "Hello, world!",
    "room": "general",
    "token": "[REDACTED]"
  }
}
```

### Error Log

```json
{
  "connectionId": "conn_1643723400000_abc123",
  "direction": "incoming",
  "messageType": "invalid_message",
  "messageId": "msg_1643723402000_ghi789",
  "timestamp": "2024-01-01T12:00:02.000Z",
  "userId": "user_456",
  "authenticated": true,
  "messageSize": 89,
  "processingTime": 12,
  "error": "Validation failed: missing required field 'type'"
}
```

## Security Features

### Data Sanitization

The middleware automatically sanitizes sensitive data:

- **Sensitive Fields**: Redacts fields matching configured patterns
- **Query Protection**: Removes sensitive query parameters
- **Header Protection**: Redacts authentication and security headers
- **Payload Filtering**: Deep sanitization of message payloads

### PII Protection

Built-in protection for personally identifiable information:

```typescript
const config = {
  sensitiveFields: [
    "password",
    "token",
    "secret",
    "key",
    "auth",
    "jwt",
    "session",
    "ssn",
    "email",
    "phone",
    "credit_card",
    "account",
    "api_key",
  ],
  redactPayload: true, // For maximum security
};
```

## Performance Considerations

### Optimization Features

- **Message Type Filtering**: Exclude high-frequency message types
- **Size Limits**: Configurable message size limits to prevent memory issues
- **Conditional Logging**: Direction and event filtering
- **Lazy Evaluation**: Data serialization only when needed
- **Connection Tracking**: Efficient in-memory tracking with cleanup

### Performance Metrics

The middleware tracks:

- `websocket_logging_execution_time`: Time spent in logging operations
- `websocket_logging_message_logged`: Count of logged messages
- `websocket_logging_connection_logged`: Count of logged connections
- `websocket_logging_error_logged`: Count of logged errors

### Best Practices

1. **Production Tuning**: Use production or performance presets
2. **Size Limits**: Set appropriate message size limits
3. **Type Exclusions**: Exclude high-frequency heartbeat messages
4. **Direction Filtering**: Log only necessary message directions
5. **Payload Redaction**: Enable in production for sensitive applications

## Integration Examples

### Socket.IO Integration

```typescript
import { Server } from "socket.io";
import {
  createWebSocketLoggingMiddleware,
  WEBSOCKET_LOGGING_PRESETS,
} from "@libs/middleware/logging";

const io = new Server();
const wsLogging = createWebSocketLoggingMiddleware(
  metrics,
  WEBSOCKET_LOGGING_PRESETS.production()
);

io.on("connection", async (socket) => {
  const context = {
    connectionId: socket.id,
    ws: socket,
    metadata: {
      clientIp: socket.handshake.address,
      userAgent: socket.handshake.headers["user-agent"],
      headers: socket.handshake.headers,
      query: socket.handshake.query,
    },
    authenticated: false,
    message: { type: "connection" },
  };

  // Log connection
  await wsLogging.logConnection(context);

  socket.on("message", async (data) => {
    const messageContext = {
      ...context,
      message: { type: data.type, payload: data.payload },
    };

    // Apply middleware
    await wsLogging.middleware()(messageContext, async () => {
      // Process message
    });
  });

  socket.on("disconnect", async (reason) => {
    await wsLogging.logDisconnection(context, reason);
  });
});
```

### Native WebSocket Integration

```typescript
import WebSocket from "ws";
import { createWebSocketLoggingMiddleware } from "@libs/middleware/logging";

const wss = new WebSocket.Server({ port: 8080 });
const wsLogging = createWebSocketLoggingMiddleware(metrics, {
  logLevel: "info",
  logIncomingMessages: true,
});

wss.on("connection", async (ws, req) => {
  const connectionId = generateId();
  const context = {
    connectionId,
    ws,
    metadata: {
      clientIp: req.socket.remoteAddress,
      userAgent: req.headers["user-agent"],
      headers: req.headers,
      query: parseQuery(req.url),
    },
    authenticated: false,
    message: { type: "connection" },
  };

  // Log connection
  await wsLogging.logConnection(context);

  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const messageContext = {
        ...context,
        message: { type: message.type, payload: message.payload },
      };

      // Apply middleware
      await wsLogging.middleware()(messageContext, async () => {
        // Process message
      });
    } catch (error) {
      // Handle parsing error
    }
  });

  ws.on("close", async () => {
    await wsLogging.logDisconnection(context, "connection_closed");
  });
});
```

### Express WebSocket Integration

```typescript
import express from "express";
import expressWs from "express-ws";
import { createWebSocketLoggingMiddleware } from "@libs/middleware/logging";

const app = express();
expressWs(app);

const wsLogging = createWebSocketLoggingMiddleware(metrics, {
  logConnections: true,
  logIncomingMessages: true,
});

app.ws("/ws", async (ws, req) => {
  const connectionId = generateId();
  const context = {
    connectionId,
    ws,
    metadata: {
      clientIp: req.ip,
      userAgent: req.get("User-Agent"),
      headers: req.headers,
      query: req.query,
    },
    authenticated: req.user ? true : false,
    userId: req.user?.id,
    message: { type: "connection" },
  };

  // Log connection
  await wsLogging.logConnection(context);

  ws.on("message", async (data) => {
    // Process with logging middleware
  });

  ws.on("close", async () => {
    await wsLogging.logDisconnection(context);
  });
});
```

## Monitoring and Observability

### Connection Metrics

The middleware automatically tracks:

- Connection duration for each session
- Message count per connection
- Authentication status changes
- Client IP and user agent information

### Message Metrics

Comprehensive message tracking:

- Processing time per message
- Message size distribution
- Error rates by message type
- Throughput metrics

### Real-time Dashboards

Integration with monitoring systems:

```typescript
// Custom metrics example
const wsLogging = createWebSocketLoggingMiddleware(metrics, {
  includeConnectionMetrics: true,
  includeMessageTiming: true,
});

// Metrics will be automatically recorded:
// - websocket_logging_message_logged
// - websocket_logging_connection_logged
// - websocket_logging_execution_time
```

## Troubleshooting

### Common Issues

1. **High Memory Usage**: Reduce `maxMessageSize` or enable `redactPayload`
2. **Performance Impact**: Use performance preset and exclude frequent message types
3. **Sensitive Data Exposure**: Verify `sensitiveFields` and `redactPayload` configuration
4. **Connection Tracking**: Ensure proper cleanup on disconnection

### Debug Mode

Enable debug logging for troubleshooting:

```typescript
const debugLogging = createWebSocketLoggingMiddleware(
  metrics,
  WEBSOCKET_LOGGING_PRESETS.debug()
);
```

### Performance Monitoring

Track middleware performance:

```typescript
const perfLogging = createWebSocketLoggingMiddleware(metrics, {
  ...WEBSOCKET_LOGGING_PRESETS.performance(),
  includeMessageTiming: true,
});
```

## Migration Guide

### From Previous Implementations

1. **Constructor Changes**: Now requires `Partial<WebSocketLoggingConfig>` instead of full config
2. **Method Updates**: Use `logConnection()` and `logDisconnection()` for lifecycle events
3. **Configuration**: New readonly configuration structure
4. **Factory Functions**: Use `createWebSocketLoggingMiddleware` for easier instantiation

### Update Example

```typescript
// Old implementation
const wsLogging = new CustomWebSocketLogger(config);
ws.on("connection", wsLogging.onConnect);

// New implementation
const wsLogging = createWebSocketLoggingMiddleware(metrics, partialConfig);
ws.on("connection", (socket) => wsLogging.logConnection(context));
```

## Contributing

When contributing to the WebSocket logging middleware:

1. Maintain AbstractMiddleware compliance
2. Ensure comprehensive test coverage for connection lifecycle
3. Update documentation for new features
4. Follow security-first principles
5. Optimize for high-throughput WebSocket scenarios

## License

Part of the enterprise middleware suite. See main project license.
