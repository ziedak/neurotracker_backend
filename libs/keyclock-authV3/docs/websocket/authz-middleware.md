# WebSocket Authorization Middleware

**Purpose:** Enforce real-time authorization on WebSocket messages and maintain permission state per connection.

**Responsibilities:**

- Authorize incoming WebSocket messages
- Check permissions for message actions
- Filter message content by permissions
- Control topic/channel subscriptions
- Handle authorization failures
- Update permissions in real-time

**Authorization Flow:**

```
Message Received → Extract Action → Check Permissions → Filter Content → Allow/Deny
```

## Core Functions

```typescript
authorizeMessage(connectionId: string, message: WSMessage): Promise<MessageAuthzResult>
```

Authorize WebSocket message

- Check message type permissions
- Validate resource access
- Apply content filtering
- **Parameters:** connectionId, message object
- **Returns:** `{ authorized: boolean, filteredMessage?: WSMessage, reason?: string }`

```typescript
checkMessagePermissions(connectionId: string, messageType: string, payload: any): Promise<PermissionResult>
```

Check permissions for message type

- Get required permissions for message type
- Validate user has permissions
- **Parameters:** connectionId, messageType ('subscribe', 'publish', 'unsubscribe'), payload
- **Returns:** `{ allowed: boolean, requiredPermissions: string[], userPermissions: string[] }`

```typescript
authorizeSubscription(connectionId: string, topic: string, options?: SubscriptionOptions): Promise<SubscriptionResult>
```

Authorize topic subscription

- Check topic access permissions
- Validate subscription parameters
- **Parameters:** connectionId, topic name, options (filter, QoS)
- **Returns:** `{ allowed: boolean, filteredTopic?: string, reason?: string }`

```typescript
filterMessageContent(message: WSMessage, user: AuthUser): WSMessage
```

Filter message content based on field permissions

- Remove unauthorized fields
- Apply field-level restrictions
- **Parameters:** original message, user
- **Returns:** filtered message

## Message Types

### Subscription Messages

```typescript
// Client subscribes to topic
{
  "type": "subscribe",
  "topic": "orders:user:123",
  "filter": { "status": "active" }
}

// Server checks permission: 'read:orders' with user ownership condition
```

### Publication Messages

```typescript
// Client publishes to topic
{
  "type": "publish",
  "topic": "orders:updates",
  "payload": { "orderId": "123", "status": "shipped" }
}

// Server checks permission: 'update:orders' for specific order
```

### Control Messages

```typescript
// Client sends control message
{
  "type": "control",
  "action": "ping",
  "timestamp": 1234567890
}

// Server checks permission: 'control:connection'
```

## Permission Mapping

```typescript
const messagePermissions = {
  subscribe: (topic: string) => `read:${topic.split(":")[0]}`,
  publish: (topic: string) => `write:${topic.split(":")[0]}`,
  unsubscribe: (topic: string) => `read:${topic.split(":")[0]}`,
  control: (action: string) => `control:${action}`,
};
```

## Content Filtering

```typescript
// Original message
{
  "type": "publish",
  "topic": "user:profile",
  "payload": {
    "id": "123",
    "name": "John Doe",
    "email": "john@example.com",
    "ssn": "123-45-6789",
    "salary": 100000
  }
}

// Filtered for basic user
{
  "type": "publish",
  "topic": "user:profile",
  "payload": {
    "id": "123",
    "name": "John Doe",
    "email": "john@example.com"
    // ssn and salary removed
  }
}
```

## Real-time Permission Updates

```typescript
updateConnectionPermissions(connectionId: string, newPermissions: string[]): Promise<void>
```

Update permissions for active connection

- Apply new permission set
- Invalidate cached checks
- Notify client of changes
- **Parameters:** connectionId, new permissions array

```typescript
broadcastPermissionUpdate(userId: string, permissions: string[]): Promise<void>
```

Broadcast permission changes to user's connections

- Update all user connections
- Send permission update message
- **Parameters:** userId, updated permissions

## Error Handling

### Authorization Denied

```typescript
// Send to client
ws.send(
  JSON.stringify({
    type: "error",
    code: "FORBIDDEN",
    message: "Insufficient permissions",
    details: {
      required: ["read:orders"],
      missing: ["read:orders"],
    },
  })
);
```

### Subscription Rejected

```typescript
ws.send(
  JSON.stringify({
    type: "subscription_rejected",
    topic: "admin:users",
    reason: "Admin access required",
  })
);
```

## Caching

```typescript
cacheMessagePermission(connectionId: string, messageType: string, result: PermissionResult, ttl: number): void
```

Cache permission check results

- Reduce repeated checks
- **Parameters:** connectionId, messageType, result, TTL in seconds

```typescript
getCachedPermission(connectionId: string, messageType: string): PermissionResult | null
```

Retrieve cached permission result

- **Parameters:** connectionId, messageType
- **Returns:** cached result or null

## Rate Limiting

```typescript
checkMessageRateLimit(connectionId: string, messageType: string): Promise<boolean>
```

Check rate limits per message type

- Per-connection limits
- Per-message-type limits
- **Parameters:** connectionId, messageType
- **Returns:** within limits boolean

## Monitoring

```typescript
getWSAuthzMetrics(): Promise<WSAuthzMetrics>
```

Get WebSocket authorization metrics

- **Returns:** `{ messagesProcessed: number, authorized: number, denied: number, filtered: number, avgCheckTime: number }`
