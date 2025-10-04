# WebSocket Message Handler

**Purpose:** Process authenticated WebSocket messages with proper authorization and business logic handling.

**Responsibilities:**

- Parse and validate message structure
- Route messages to appropriate handlers
- Apply business rules and validation
- Handle message acknowledgments
- Support message queuing and ordering
- Provide error handling and recovery

**Message Processing Flow:**

```
Message Received → Parse → Validate → Authorize → Process → Respond/Acknowledge
```

## Core Functions

```typescript
processMessage(connectionId: string, rawMessage: string): Promise<MessageResult>
```

Process incoming WebSocket message

- Parse JSON message
- Validate structure
- Check authorization
- Route to handler
- **Parameters:** connectionId, raw message string
- **Returns:** `{ success: boolean, response?: WSMessage, error?: MessageError }`

```typescript
parseMessage(rawMessage: string): WSMessage | null
```

Parse WebSocket message from string

- Parse JSON
- Validate message structure
- **Parameters:** raw message string
- **Returns:** parsed message object or null

```typescript
validateMessageStructure(message: WSMessage): ValidationResult
```

Validate message structure and content

- Check required fields
- Validate field types
- Check message size limits
- **Parameters:** message object
- **Returns:** `{ valid: boolean, errors?: ValidationError[] }`

```typescript
routeMessage(message: WSMessage, connectionId: string): Promise<MessageResult>
```

Route message to appropriate handler

- Determine message type
- Call corresponding handler
- **Parameters:** message, connectionId
- **Returns:** handler result

## Message Types

### Control Messages

```typescript
handleControlMessage(connectionId: string, message: ControlMessage): Promise<MessageResult>
```

Handle control messages

- Ping/pong
- Connection status
- Configuration updates
- **Parameters:** connectionId, control message
- **Returns:** response message

```typescript
// Ping message
{
  "type": "control",
  "action": "ping",
  "timestamp": 1234567890
}

// Pong response
{
  "type": "control",
  "action": "pong",
  "timestamp": 1234567890
}
```

### Data Messages

```typescript
handleDataMessage(connectionId: string, message: DataMessage): Promise<MessageResult>
```

Handle data operation messages

- CRUD operations
- Real-time updates
- **Parameters:** connectionId, data message
- **Returns:** operation result

```typescript
// Create operation
{
  "type": "data",
  "action": "create",
  "resource": "orders",
  "payload": { "customerId": "123", "items": [...] }
}
```

### Subscription Messages

```typescript
handleSubscriptionMessage(connectionId: string, message: SubscriptionMessage): Promise<MessageResult>
```

Handle subscription management

- Subscribe/unsubscribe
- Filter updates
- **Parameters:** connectionId, subscription message
- **Returns:** subscription result

## Message Validation

```typescript
validateMessageSize(message: WSMessage): boolean
```

Check message size limits

- Prevent abuse
- **Parameters:** message object
- **Returns:** within limits boolean

```typescript
validateMessageRate(connectionId: string): boolean
```

Check message rate limits

- Per-connection limits
- Burst handling
- **Parameters:** connectionId
- **Returns:** within limits boolean

## Error Handling

```typescript
handleMessageError(connectionId: string, error: MessageError): Promise<void>
```

Handle message processing errors

- Log errors
- Send error response
- Update error metrics
- **Parameters:** connectionId, error object

```typescript
sendErrorResponse(connectionId: string, error: MessageError): void
```

Send error message to client

- Format error response
- Include error details
- **Parameters:** connectionId, error

```typescript
// Error response
{
  "type": "error",
  "code": "VALIDATION_ERROR",
  "message": "Invalid message structure",
  "details": { "field": "type", "issue": "required" }
}
```

## Acknowledgments

```typescript
sendAcknowledgment(connectionId: string, messageId: string, result: any): void
```

Send message acknowledgment

- Confirm processing
- Include result data
- **Parameters:** connectionId, original message ID, result data

```typescript
// Acknowledgment
{
  "type": "ack",
  "messageId": "msg_123",
  "result": { "success": true, "recordId": "rec_456" }
}
```

## Message Queuing

```typescript
queueMessage(connectionId: string, message: WSMessage): Promise<void>
```

Queue message for processing

- Handle load balancing
- Maintain message ordering
- **Parameters:** connectionId, message

```typescript
processMessageQueue(connectionId: string): Promise<void>
```

Process queued messages

- FIFO processing
- Error recovery
- **Parameters:** connectionId

## Monitoring

```typescript
getMessageMetrics(): Promise<MessageMetrics>
```

Get message processing metrics

- **Returns:** `{ messagesProcessed: number, errors: number, avgProcessingTime: number, queueSize: number }`

```typescript
logMessageEvent(event: MessageEvent): void
```

Log message processing events

- Processing success/failure
- Performance metrics
- **Parameters:** event object
