# WebSocket Subscription Manager

**Purpose:** Manage topic/channel subscriptions with permission checks and real-time message distribution.

**Responsibilities:**

- Handle subscription requests
- Maintain subscription registry
- Distribute messages to subscribers
- Enforce subscription permissions
- Support filtered subscriptions
- Handle subscription lifecycle

**Subscription Flow:**

```
Subscribe Request → Permission Check → Register Subscription → Message Distribution
```

## Core Functions

```typescript
subscribe(connectionId: string, topic: string, options?: SubscriptionOptions): Promise<SubscriptionResult>
```

Subscribe connection to topic

- Check subscription permissions
- Register subscription
- Send initial state if needed
- **Parameters:** connectionId, topic pattern, options (filter, QoS, persistence)
- **Returns:** `{ success: boolean, subscriptionId?: string, reason?: string }`

```typescript
unsubscribe(connectionId: string, topic: string): Promise<boolean>
```

Unsubscribe from topic

- Remove subscription
- Clean up resources
- **Parameters:** connectionId, topic
- **Returns:** success boolean

```typescript
publishToTopic(topic: string, message: any, publisher?: string): Promise<PublishResult>
```

Publish message to topic subscribers

- Filter subscribers by permissions
- Distribute to authorized connections
- **Parameters:** topic, message payload, optional publisher connectionId
- **Returns:** `{ subscribersNotified: number, filteredOut: number }`

```typescript
getTopicSubscribers(topic: string): Promise<SubscriberInfo[]>
```

Get subscribers for topic

- Active subscriptions
- Permission levels
- **Parameters:** topic
- **Returns:** array of subscriber info

## Subscription Registry

```typescript
interface Subscription {
  subscriptionId: string;
  connectionId: string;
  topic: string;
  userId: string;
  permissions: string[];
  filter?: SubscriptionFilter;
  createdAt: Date;
  lastActivity: Date;
  QoS: number; // 0, 1, or 2
}
```

## Permission Checks

```typescript
checkSubscriptionPermission(connectionId: string, topic: string): Promise<boolean>
```

Check if connection can subscribe to topic

- Validate topic permissions
- Check resource access
- **Parameters:** connectionId, topic
- **Returns:** authorized boolean

```typescript
getTopicPermission(topic: string): string
```

Get required permission for topic

- Map topic to permission
- **Parameters:** topic (e.g., 'orders:user:123')
- **Returns:** permission string (e.g., 'read:orders')

## Filtered Subscriptions

```typescript
createFilteredSubscription(connectionId: string, topic: string, filter: SubscriptionFilter): Promise<string>
```

Create subscription with content filtering

- Apply filter to messages
- Reduce message volume
- **Parameters:** connectionId, topic, filter conditions
- **Returns:** subscription ID

```typescript
// Filter example
const filter = {
  status: "active",
  priority: { $gte: 3 },
  createdAt: { $gt: "2024-01-01" },
};
```

```typescript
applyMessageFilter(message: any, filter: SubscriptionFilter): boolean
```

Apply filter to message

- Check if message matches filter
- Support complex conditions
- **Parameters:** message payload, filter
- **Returns:** matches filter boolean

## Message Distribution

```typescript
distributeMessage(topic: string, message: any): Promise<DistributionResult>
```

Distribute message to topic subscribers

- Filter by permissions and subscriptions
- Apply content filtering
- Handle QoS levels
- **Parameters:** topic, message
- **Returns:** `{ totalSubscribers: number, messagesSent: number, filtered: number }`

```typescript
sendToSubscriber(subscriber: SubscriberInfo, message: any): Promise<boolean>
```

Send message to individual subscriber

- Format message for subscriber
- Handle delivery confirmation
- **Parameters:** subscriber info, message
- **Returns:** delivery success boolean

## Subscription Lifecycle

```typescript
cleanupConnectionSubscriptions(connectionId: string): Promise<number>
```

Clean up subscriptions on disconnection

- Remove all subscriptions for connection
- Update subscription counts
- **Parameters:** connectionId
- **Returns:** number of subscriptions removed

```typescript
refreshSubscription(subscriptionId: string): Promise<void>
```

Refresh subscription activity

- Update last activity timestamp
- Extend subscription TTL
- **Parameters:** subscription ID

```typescript
expireStaleSubscriptions(): Promise<number>
```

Remove expired subscriptions

- Inactive subscriptions
- Permission changes
- **Returns:** number of expired subscriptions

## Topic Management

```typescript
createTopic(topic: string, config?: TopicConfig): Promise<void>
```

Create topic with configuration

- Set topic permissions
- Configure persistence
- **Parameters:** topic name, config (permissions, retention, maxSubscribers)

```typescript
deleteTopic(topic: string): Promise<void>
```

Delete topic and subscriptions

- Remove all subscriptions
- Clean up topic data
- **Parameters:** topic name

```typescript
getTopicInfo(topic: string): Promise<TopicInfo>
```

Get topic information

- Subscriber count
- Message rate
- Configuration
- **Parameters:** topic
- **Returns:** topic metadata

## Monitoring

```typescript
getSubscriptionMetrics(): Promise<SubscriptionMetrics>
```

Get subscription system metrics

- **Returns:** `{ activeSubscriptions: number, topics: number, messagesPerSecond: number, avgSubscribersPerTopic: number }`

```typescript
logSubscriptionEvent(event: SubscriptionEvent): void
```

Log subscription events

- Subscribe/unsubscribe
- Permission denials
- Distribution stats
- **Parameters:** event object
