# Messaging Library

This library provides comprehensive messaging capabilities for the neurotracker backend, including Kafka integration and WebSocket support for real-time communication.

## Features

### Kafka Integration

- Producer and consumer management
- Connection pooling
- SASL authentication support
- SSL/TLS encryption

### WebSocket Support

- Real-time bidirectional communication
- User authentication and session management
- Room-based messaging (chat rooms, team channels)
- Topic subscriptions for broadcast messages
- Automatic heartbeat and connection management
- Message rate limiting and compression
- Graceful connection handling

## Installation

```bash
pnpm add @libs/messaging
```

## WebSocket Usage

### Basic Setup

```typescript
import { WebSocketManager } from "@libs/messaging";

// Standalone WebSocket server
const wsManager = new WebSocketManager({
  port: 8080,
  path: "/ws",
  heartbeatInterval: 30000,
  maxConnections: 1000,
  enableCompression: true,
  enableHeartbeat: true,
});

// Or integrate with existing HTTP server
import { createServer } from "http";
const httpServer = createServer();
const wsManager = WebSocketManager.fromHttpServer(httpServer, {
  path: "/ws",
});
```

### Integration with Elysia Server

```typescript
import { createElysiaServer } from "@libs/elysia-server";
import { WebSocketManager } from "@libs/messaging";

const { app, server } = createElysiaServer({
  name: "My Service",
  port: 3000,
}).start();

// Add WebSocket support to the existing server
const wsManager = WebSocketManager.fromHttpServer(server, {
  path: "/ws",
});
```

### Client-Side Connection

```javascript
const ws = new WebSocket("ws://localhost:8080/ws");

// Authenticate after connection
ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "authenticate",
      payload: {
        userId: "user123",
        sessionId: "session456",
        token: "jwt-token-here",
      },
    })
  );
};

// Handle incoming messages
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log("Received:", message);
};
```

### Server-Side Messaging

```typescript
import { WebSocketManager, WebSocketMessage } from "@libs/messaging";

const wsManager = new WebSocketManager({ port: 8080 });

// Send to specific user
wsManager.sendToUser("user123", {
  type: "notification",
  payload: { message: "Hello user!" },
});

// Send to room members
wsManager.sendToRoom("team_alpha", {
  type: "team_message",
  payload: { message: "Team update!" },
});

// Broadcast to topic subscribers
wsManager.broadcastToTopic("system_updates", {
  type: "system_update",
  payload: { version: "1.2.0" },
});

// Broadcast to all connected clients
wsManager.broadcast({
  type: "announcement",
  payload: { message: "Server maintenance in 5 minutes" },
});
```

## Message Types

### Client to Server Messages

#### Authentication

```json
{
  "type": "authenticate",
  "payload": {
    "userId": "user123",
    "sessionId": "session456",
    "token": "jwt-token-here"
  }
}
```

#### Topic Subscription

```json
{
  "type": "subscribe",
  "payload": {
    "topic": "user_events"
  }
}
```

#### Room Management

```json
{
  "type": "join_room",
  "payload": {
    "room": "team_alpha"
  }
}
```

### Server to Client Messages

#### Connection Acknowledgment

```json
{
  "type": "connection",
  "payload": {
    "connectionId": "conn_1234567890_abc123",
    "message": "Connected successfully"
  },
  "timestamp": "2025-08-09T15:30:00.000Z"
}
```

#### User Notifications

```json
{
  "type": "notification",
  "payload": {
    "message": "Your analysis is complete",
    "data": { "analysisId": "analysis123" }
  },
  "timestamp": "2025-08-09T15:30:00.000Z"
}
```

#### Room Messages

```json
{
  "type": "room_message",
  "payload": {
    "room": "team_alpha",
    "message": "New task assigned",
    "senderId": "user456"
  },
  "timestamp": "2025-08-09T15:30:00.000Z"
}
```

## Use Cases

### Real-Time Notifications

- User event notifications (login, logout, data updates)
- AI analysis completion alerts
- System status updates

### Collaborative Features

- Team chat and messaging
- Shared workspace updates
- Real-time document collaboration

### Monitoring and Alerts

- System health monitoring
- Performance metrics streaming
- Critical alert broadcasting

### User Experience

- Live data updates without page refresh
- Progress indicators for long-running tasks
- Interactive dashboards

## Configuration

### Environment Variables

```bash
# WebSocket Configuration
WS_PORT=8080
WS_PATH=/ws
WS_HEARTBEAT_INTERVAL=30000
WS_MAX_CONNECTIONS=1000
WS_COMPRESSION=true
WS_HEARTBEAT=true

# Kafka Configuration (existing)
KAFKA_CLIENT_ID=neuro-backend
KAFKA_BROKERS=localhost:9092
KAFKA_SSL=false
```

### Advanced Configuration

```typescript
const wsManager = new WebSocketManager({
  port: 8080,
  path: "/ws",
  heartbeatInterval: 30000, // 30 seconds
  maxConnections: 1000, // Maximum concurrent connections
  enableCompression: true, // Enable message compression
  enableHeartbeat: true, // Enable automatic heartbeat
});
```

## API Reference

### WebSocketManager Methods

#### Connection Management

- `getConnectionCount(): number` - Get active connection count
- `getActiveRooms(): string[]` - Get list of active rooms
- `getRoomMembers(room: string): string[]` - Get room member list

#### Messaging

- `sendToConnection(connectionId: string, message: WebSocketMessage): boolean`
- `sendToUser(userId: string, message: WebSocketMessage): number`
- `sendToRoom(room: string, message: WebSocketMessage): number`
- `broadcastToTopic(topic: string, message: WebSocketMessage): number`
- `broadcast(message: WebSocketMessage): number`

#### Lifecycle

- `close(): void` - Gracefully close server and all connections

## Security Considerations

1. **Authentication**: Always validate user tokens and sessions
2. **Rate Limiting**: Built-in connection limits and message throttling
3. **Input Validation**: Validate all incoming message payloads
4. **CORS**: Configure appropriate origin restrictions
5. **SSL/TLS**: Use secure connections in production

## Performance Tips

1. **Message Size**: Keep messages under 16KB for optimal performance
2. **Connection Pooling**: Reuse connections when possible
3. **Heartbeat Tuning**: Adjust heartbeat intervals based on network conditions
4. **Compression**: Enable compression for large messages
5. **Room Management**: Clean up empty rooms automatically

## Monitoring

```typescript
// Get real-time statistics
const stats = {
  connections: wsManager.getConnectionCount(),
  rooms: wsManager.getActiveRooms().length,
  roomDetails: wsManager.getActiveRooms().map((room) => ({
    name: room,
    members: wsManager.getRoomMembers(room).length,
  })),
};
```

## Integration Examples

See `websocket-example.ts` for complete integration examples with the neurotracker microservices architecture.
