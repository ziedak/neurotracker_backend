# WebSocket Connection Manager

**Purpose:** Manage WebSocket connection lifecycle, authentication state, and connection-to-user mappings.

**Responsibilities:**

- Track authenticated WebSocket connections
- Maintain connection metadata
- Handle connection cleanup
- Provide connection lookup APIs
- Support connection migration
- Monitor connection health

**Connection States:**

```
Connecting → Authenticating → Authenticated → Active → Disconnecting → Disconnected
```

## Core Functions

```typescript
registerConnection(connectionId: string, user: AuthUser, metadata: ConnectionMetadata): Promise<void>
```

Register authenticated WebSocket connection

- Store connection-to-user mapping
- Set connection metadata
- Initialize connection state
- **Parameters:** connectionId (UUID), authenticated user, metadata (ip, userAgent, clientVersion)

```typescript
unregisterConnection(connectionId: string): Promise<void>
```

Remove WebSocket connection

- Clean up connection mapping
- Clear cached permissions
- Log disconnection event
- **Parameters:** connectionId

```typescript
getConnectionUser(connectionId: string): Promise<AuthUser | null>
```

Get user for WebSocket connection

- Lookup connection mapping
- Return authenticated user
- **Parameters:** connectionId
- **Returns:** user object or null if not found

```typescript
updateConnectionMetadata(connectionId: string, metadata: Partial<ConnectionMetadata>): Promise<void>
```

Update connection metadata

- Update IP, user agent, etc.
- Track connection activity
- **Parameters:** connectionId, metadata updates

```typescript
getUserConnections(userId: string): Promise<ConnectionInfo[]>
```

Get all connections for user

- Useful for multi-device logout
- **Parameters:** userId
- **Returns:** array of connection info (connectionId, connectedAt, metadata)

```typescript
validateConnection(connectionId: string): Promise<boolean>
```

Validate connection exists and is active

- Check connection mapping
- Verify not expired
- **Parameters:** connectionId
- **Returns:** boolean

```typescript
extendConnectionTTL(connectionId: string, ttl: number): Promise<void>
```

Extend connection lifetime

- Update connection expiration
- Reset inactivity timers
- **Parameters:** connectionId, TTL in seconds

```typescript
migrateConnection(oldConnectionId: string, newConnectionId: string): Promise<void>
```

Migrate connection to new ID

- Transfer user mapping
- Preserve metadata
- **Parameters:** old and new connection IDs

## Connection Metadata

```typescript
interface ConnectionMetadata {
  ip: string;
  userAgent: string;
  connectedAt: Date;
  lastActivity: Date;
  clientVersion?: string;
  connectionType: "websocket" | "sse";
  permissions: string[];
  rateLimit: {
    messagesPerMinute: number;
    lastReset: Date;
  };
}
```

## Connection Health

```typescript
getConnectionHealth(): Promise<ConnectionHealth>
```

Get connection system health

- Active connections count
- Connection distribution
- Memory usage
- **Returns:** `{ activeConnections: number, usersWithConnections: number, memoryUsage: number }`

```typescript
cleanupExpiredConnections(): Promise<number>
```

Remove expired connections

- Connections with expired TTL
- Stale connections
- **Returns:** number of cleaned connections

```typescript
forceDisconnect(connectionId: string, reason?: string): Promise<void>
```

Force disconnect WebSocket connection

- Send disconnect message
- Clean up state
- **Parameters:** connectionId, optional reason

## Connection Limits

```typescript
enforceConnectionLimits(userId: string, newConnectionId: string): Promise<boolean>
```

Enforce per-user connection limits

- Check max connections per user
- Disconnect oldest if over limit
- **Parameters:** userId, new connection ID
- **Returns:** allowed boolean

```typescript
getConnectionLimits(): ConnectionLimits
```

Get current connection limits

- **Returns:** `{ maxPerUser: number, maxTotal: number, ttlSeconds: number }`

## Monitoring

```typescript
getConnectionStats(): Promise<ConnectionStats>
```

Get connection statistics

- **Returns:** `{ totalConnections: number, activeUsers: number, messagesPerSecond: number, avgConnectionDuration: number }`

```typescript
logConnectionEvent(event: ConnectionEvent): void
```

Log connection lifecycle events

- Connect, disconnect, errors
- **Parameters:** event object with connectionId, eventType, timestamp, details
