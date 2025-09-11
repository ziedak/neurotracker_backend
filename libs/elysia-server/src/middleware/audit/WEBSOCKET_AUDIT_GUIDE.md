# WebSocket Audit Middleware

A comprehensive WebSocket audit middleware providing enterprise-grade audit trail functionality for WebSocket connections and real-time communications.

## Features

- **Complete Connection Lifecycle Tracking**: Monitor connection, message, disconnection, and error events
- **Event Batching**: High-performance event batching with configurable batch sizes and flush intervals
- **Multi-Storage Strategy**: Support for Redis (real-time) and ClickHouse (analytics) storage
- **Compliance Support**: Built-in support for GDPR, SOX, HIPAA, and PCI DSS compliance requirements
- **Real-time Analytics**: Live statistics on connection patterns, message types, and user behavior
- **Data Sanitization**: Automatic anonymization and redaction of sensitive information
- **Performance Optimization**: Configurable payload size limits and message type filtering
- **Room/Namespace Support**: Track WebSocket rooms and namespaces for multi-tenant applications

## Installation

```bash
npm install @libs/middleware
```

## Quick Start

### Basic Usage

```typescript
import { WebSocketAuditMiddleware, WS_AUDIT_FACTORIES } from "@libs/middleware";
import { MetricsCollector } from "@libs/monitoring";
import { RedisClient, ClickHouseClient } from "@libs/database";

// Get dependencies
const metrics = MetricsCollector.getInstance();
const redis = RedisClient.getInstance();
const clickhouse = ClickHouseClient.getInstance();

// Create middleware for production environment
const auditMiddleware = WS_AUDIT_FACTORIES.forProduction(
  metrics,
  redis,
  clickhouse
);

// Use in your WebSocket server
ws.on("connection", async (socket, request) => {
  const context = createWebSocketContext(socket, request);
  await auditMiddleware.handleConnection(context);
});

ws.on("message", async (socket, message) => {
  const context = createWebSocketContext(socket, null, message);
  await auditMiddleware.handleMessage(context);
});

ws.on("close", async (socket) => {
  const context = createWebSocketContext(socket);
  await auditMiddleware.handleDisconnection(context);
});

ws.on("error", async (socket, error) => {
  const context = createWebSocketContext(socket);
  await auditMiddleware.handleError(context, error);
});
```

### Custom Configuration

```typescript
import { createWebSocketAuditMiddleware } from "@libs/middleware";

const customMiddleware = createWebSocketAuditMiddleware(
  metrics,
  redis,
  clickhouse,
  {
    name: "my-websocket-audit",
    logConnections: true,
    logMessages: true,
    logDisconnections: true,
    logErrors: true,
    includePayload: false,
    includeMetadata: true,
    storageStrategy: "both",
    batchInserts: true,
    batchSize: 100,
    flushInterval: 5000,
    retentionDays: 90,
    anonymizePersonalData: true,
    complianceMode: "GDPR",
    skipMessageTypes: ["ping", "pong", "heartbeat"],
    sensitiveFields: ["password", "token", "email"],
  }
);
```

## Presets

The middleware comes with pre-configured presets for common use cases:

### Environment Presets

```typescript
import { WS_AUDIT_FACTORIES } from "@libs/middleware";

// Development - Detailed logging, short retention
const devMiddleware = WS_AUDIT_FACTORIES.forDevelopment(
  metrics,
  redis,
  clickhouse
);

// Production - Optimized for performance and security
const prodMiddleware = WS_AUDIT_FACTORIES.forProduction(
  metrics,
  redis,
  clickhouse
);

// High Performance - Minimal overhead for high-throughput systems
const perfMiddleware = WS_AUDIT_FACTORIES.forHighPerformance(
  metrics,
  redis,
  clickhouse
);
```

### Application-Specific Presets

```typescript
// Real-time Chat - Privacy-focused with content filtering
const chatMiddleware = WS_AUDIT_FACTORIES.forRealtimeChat(
  metrics,
  redis,
  clickhouse
);

// Gaming - High-performance with selective event logging
const gamingMiddleware = WS_AUDIT_FACTORIES.forGaming(
  metrics,
  redis,
  clickhouse
);

// IoT Monitoring - Optimized for device communications
const iotMiddleware = WS_AUDIT_FACTORIES.forIoT(metrics, redis, clickhouse);

// API Monitoring - External API usage tracking
const apiMiddleware = WS_AUDIT_FACTORIES.forAPI(metrics, redis, clickhouse);
```

### Compliance Presets

```typescript
// GDPR Compliance - Enhanced data protection
const gdprMiddleware = WS_AUDIT_FACTORIES.forGDPR(metrics, redis, clickhouse);

// SOX Compliance - Financial transaction auditing
const soxMiddleware = WS_AUDIT_FACTORIES.forSOX(metrics, redis, clickhouse);

// HIPAA Compliance - Healthcare data protection
const hipaaMiddleware = WS_AUDIT_FACTORIES.forHIPAA(metrics, redis, clickhouse);

// PCI DSS Compliance - Payment card industry security
const pciMiddleware = WS_AUDIT_FACTORIES.forPCI(metrics, redis, clickhouse);
```

## Configuration Options

### Basic Configuration

| Option              | Type    | Default           | Description                        |
| ------------------- | ------- | ----------------- | ---------------------------------- |
| `name`              | string  | "websocket-audit" | Middleware instance name           |
| `logConnections`    | boolean | true              | Log WebSocket connection events    |
| `logMessages`       | boolean | true              | Log WebSocket message events       |
| `logDisconnections` | boolean | true              | Log WebSocket disconnection events |
| `logErrors`         | boolean | true              | Log WebSocket error events         |

### Data Inclusion

| Option             | Type    | Default    | Description                           |
| ------------------ | ------- | ---------- | ------------------------------------- |
| `includePayload`   | boolean | false      | Include message payload in audit logs |
| `includeMetadata`  | boolean | true       | Include connection metadata           |
| `trackRooms`       | boolean | true       | Track WebSocket rooms/namespaces      |
| `trackMessageSize` | boolean | true       | Track message size statistics         |
| `maxPayloadSize`   | number  | 1024 \* 10 | Maximum payload size to log (bytes)   |

### Storage Configuration

| Option            | Type                              | Default       | Description              |
| ----------------- | --------------------------------- | ------------- | ------------------------ |
| `storageStrategy` | "redis" \| "clickhouse" \| "both" | "both"        | Storage backend strategy |
| `redisTtl`        | number                            | 7 _ 24 _ 3600 | Redis TTL in seconds     |
| `retentionDays`   | number                            | 90            | Data retention period    |

### Performance Configuration

| Option             | Type     | Default          | Description               |
| ------------------ | -------- | ---------------- | ------------------------- |
| `batchInserts`     | boolean  | true             | Enable event batching     |
| `batchSize`        | number   | 100              | Events per batch          |
| `flushInterval`    | number   | 5000             | Batch flush interval (ms) |
| `skipMessageTypes` | string[] | ["ping", "pong"] | Message types to skip     |

### Compliance Configuration

| Option                  | Type                                                  | Default    | Description                |
| ----------------------- | ----------------------------------------------------- | ---------- | -------------------------- |
| `anonymizePersonalData` | boolean                                               | false      | Enable data anonymization  |
| `complianceMode`        | "standard" \| "GDPR" \| "SOX" \| "HIPAA" \| "PCI_DSS" | "standard" | Compliance framework       |
| `sensitiveFields`       | string[]                                              | []         | Fields to redact/anonymize |

### Analytics Configuration

| Option                    | Type    | Default | Description                |
| ------------------------- | ------- | ------- | -------------------------- |
| `enableRealTimeAnalytics` | boolean | true    | Enable real-time analytics |

## WebSocket Context

The middleware expects a WebSocket context object with the following structure:

```typescript
interface WebSocketContext {
  ws: WebSocket; // WebSocket instance
  connectionId: string; // Unique connection identifier
  message?: {
    // Message data (for message events)
    type: string;
    payload: any;
    timestamp?: string;
    id?: string;
  };
  metadata?: {
    // Connection metadata
    connectedAt: Date;
    lastActivity: Date;
    messageCount: number;
    clientIp: string;
    userAgent: string;
    headers: Record<string, string>;
    query: Record<string, string>;
  };
  authenticated?: boolean; // Authentication status
  userId?: string; // User identifier
  userRoles?: string[]; // User roles
  userPermissions?: string[]; // User permissions
  rooms?: string[]; // WebSocket rooms/namespaces
}
```

## Querying Audit Data

### Query Events

```typescript
// Query connection events for a specific user
const userConnections = await auditMiddleware.query({
  userId: "user-123",
  eventType: "connection",
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
  endDate: new Date(),
  limit: 100,
});

// Query error events
const errors = await auditMiddleware.query({
  eventType: "error",
  startDate: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
  endDate: new Date(),
});

// Query by IP address
const ipEvents = await auditMiddleware.query({
  ip: "192.168.1.100",
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
});
```

### Get Summary Statistics

```typescript
// Get daily summary
const dailySummary = await auditMiddleware.getSummary({
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
  endDate: new Date(),
});

console.log(dailySummary);
// {
//   totalEvents: 1250,
//   connectionEvents: 400,
//   messageEvents: 800,
//   disconnectionEvents: 380,
//   errorEvents: 20,
//   uniqueUsers: 150,
//   uniqueConnections: 400,
//   averageSessionDuration: 450000, // milliseconds
//   averageMessageSize: 256,
//   topMessageTypes: [
//     { messageType: "chat_message", count: 500 },
//     { messageType: "status_update", count: 200 }
//   ],
//   errorDistribution: [
//     { errorType: "ConnectionError", count: 12 },
//     { errorType: "ValidationError", count: 8 }
//   ]
// }
```

## Real-time Analytics

When real-time analytics are enabled, the middleware provides live metrics:

```typescript
// Metrics are automatically recorded and can be accessed via your metrics system
// Examples of metrics recorded:

// Counters
"websocket_audit_events_total"; // Total events by type
"websocket_audit_connections_total"; // Total connections
"websocket_audit_errors_total"; // Total errors by type
"websocket_audit_analytics_active_connections"; // Active connections

// Timers
"websocket_audit_session_duration"; // Session duration tracking
"websocket_audit_event_processing_time"; // Event processing time

// Histograms
"websocket_audit_message_size"; // Message size distribution
"websocket_audit_batch_size"; // Batch size distribution
```

## Compliance Features

### GDPR Compliance

```typescript
const gdprMiddleware = WS_AUDIT_FACTORIES.forGDPR(metrics, redis, clickhouse, {
  // Additional GDPR-specific overrides
  retentionDays: 365 * 7, // 7 years
  anonymizePersonalData: true,
  sensitiveFields: [
    "email",
    "phone",
    "address",
    "birth_date",
    "medical_record",
    "biometric",
  ],
});
```

### SOX Compliance

```typescript
const soxMiddleware = WS_AUDIT_FACTORIES.forSOX(metrics, redis, clickhouse, {
  // SOX requires non-anonymized audit trails
  anonymizePersonalData: false,
  retentionDays: 365 * 7, // 7 years
  includePayload: true,
  includeMetadata: true,
});
```

### PCI DSS Compliance

```typescript
const pciMiddleware = WS_AUDIT_FACTORIES.forPCI(metrics, redis, clickhouse, {
  // Never log payment data
  logMessages: false,
  includePayload: false,
  skipMessageTypes: ["payment", "card_data", "transaction"],
  sensitiveFields: [
    "credit_card",
    "card_number",
    "cvv",
    "cvc",
    "pan",
    "track",
    "magnetic_stripe",
  ],
});
```

## Integration Examples

### Elysia WebSocket Server

```typescript
import { Elysia } from "elysia";
import { WS_AUDIT_FACTORIES } from "@libs/middleware";

const app = new Elysia();
const auditMiddleware = WS_AUDIT_FACTORIES.forProduction(
  metrics,
  redis,
  clickhouse
);

app.ws("/chat", {
  async open(ws, request) {
    const context = {
      ws,
      connectionId: generateConnectionId(),
      metadata: {
        connectedAt: new Date(),
        clientIp: request.headers["x-forwarded-for"] || "127.0.0.1",
        userAgent: request.headers["user-agent"] || "unknown",
        headers: request.headers,
        query: request.query,
      },
    };

    await auditMiddleware.handleConnection(context);
  },

  async message(ws, message) {
    const context = {
      ws,
      connectionId: getConnectionId(ws),
      message: {
        type: message.type,
        payload: message.data,
        timestamp: new Date().toISOString(),
        id: generateMessageId(),
      },
    };

    await auditMiddleware.handleMessage(context);
  },

  async close(ws) {
    const context = {
      ws,
      connectionId: getConnectionId(ws),
    };

    await auditMiddleware.handleDisconnection(context);
  },

  async error(ws, error) {
    const context = {
      ws,
      connectionId: getConnectionId(ws),
    };

    await auditMiddleware.handleError(context, error);
  },
});
```

### Socket.io Integration

```typescript
import { Server } from "socket.io";
import { WS_AUDIT_FACTORIES } from "@libs/middleware";

const io = new Server();
const auditMiddleware = WS_AUDIT_FACTORIES.forRealtimeChat(
  metrics,
  redis,
  clickhouse
);

io.on("connection", async (socket) => {
  const context = {
    ws: socket,
    connectionId: socket.id,
    metadata: {
      connectedAt: new Date(),
      clientIp: socket.handshake.address,
      userAgent: socket.handshake.headers["user-agent"],
      headers: socket.handshake.headers,
    },
  };

  await auditMiddleware.handleConnection(context);

  socket.on("message", async (data) => {
    const messageContext = {
      ...context,
      message: {
        type: "chat_message",
        payload: data,
        timestamp: new Date().toISOString(),
      },
    };

    await auditMiddleware.handleMessage(messageContext);
  });

  socket.on("disconnect", async () => {
    await auditMiddleware.handleDisconnection(context);
  });

  socket.on("error", async (error) => {
    await auditMiddleware.handleError(context, error);
  });
});
```

## Testing

The middleware includes comprehensive testing utilities:

```typescript
import { WS_AUDIT_TESTING_UTILS } from "@libs/middleware";

describe("WebSocket Audit Tests", () => {
  it("should track connection events", async () => {
    const { middleware, mocks } = WS_AUDIT_TESTING_UTILS.createMockMiddleware();
    const context = WS_AUDIT_TESTING_UTILS.createTestContext();

    await middleware.handleConnection(context);

    expect(mocks.metrics.recordCounter).toHaveBeenCalledWith(
      "websocket_audit_events_total",
      1,
      { event_type: "connection" }
    );
  });
});
```

## Performance Considerations

### High-Throughput Environments

```typescript
// For high-throughput scenarios, use minimal configuration
const highPerfMiddleware = WS_AUDIT_FACTORIES.forHighPerformance(
  metrics,
  redis,
  clickhouse,
  {
    // Custom optimizations
    logMessages: false, // Skip message logging
    enableRealTimeAnalytics: false, // Disable real-time analytics
    batchSize: 1000, // Large batches
    flushInterval: 10000, // 10-second intervals
    includePayload: false, // Skip payload logging
    includeMetadata: false, // Skip metadata
  }
);
```

### Memory Management

```typescript
// Cleanup resources when shutting down
process.on("SIGTERM", async () => {
  await auditMiddleware.cleanup();
});
```

## Security Considerations

1. **Data Sanitization**: Always enable `anonymizePersonalData` in production
2. **Payload Logging**: Disable `includePayload` for sensitive applications
3. **Retention Policies**: Set appropriate `retentionDays` based on compliance requirements
4. **Field Redaction**: Configure `sensitiveFields` to automatically redact sensitive data
5. **Access Controls**: Secure access to audit data storage systems

## Troubleshooting

### Common Issues

1. **High Memory Usage**: Reduce `batchSize` or increase `flushInterval`
2. **Storage Errors**: Check Redis and ClickHouse connectivity
3. **Performance Issues**: Enable `highPerformance` preset or disable real-time analytics
4. **Missing Events**: Verify WebSocket context structure and configuration

### Debug Mode

```typescript
const debugMiddleware = createWebSocketAuditMiddleware(
  metrics,
  redis,
  clickhouse,
  {
    // Enable debug logging
    name: "debug-ws-audit",
  }
);
```

## Migration Guide

### From HTTP Audit Middleware

The WebSocket audit middleware follows similar patterns to the HTTP audit middleware:

```typescript
// HTTP Audit (existing)
const httpAudit = createAuditMiddleware(config);

// WebSocket Audit (new)
const wsAudit = createWebSocketAuditMiddleware(
  metrics,
  redis,
  clickhouse,
  config
);
```

Key differences:

- WebSocket middleware tracks connection lifecycle events
- Event types are different (connection/message/disconnection vs request/response)
- Real-time analytics are more relevant for WebSocket connections
- Room/namespace tracking is WebSocket-specific

## License

This middleware is part of the `@libs/middleware` package and follows the same licensing terms as the main project.
