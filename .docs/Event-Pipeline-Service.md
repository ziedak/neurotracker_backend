# Ingestion Service Specification

## Overview

The Ingestion Service handles high-throughput event collection and basic processing for the cart recovery platform. Built with Elysia framework, it focuses on fast event ingestion via WebSocket and REST endpoints, leveraging shared libraries for infrastructure concerns.

## Architecture

### Service Responsibilities
- **Event Collection**: WebSocket and REST endpoint for cart events
- **Basic Validation**: Event structure and format validation using @libs/models
- **Message Routing**: Forward validated events to downstream services
- **WebSocket Handling**: Real-time event streaming from client applications
- **Health Monitoring**: Service health and ingestion metrics

### Technology Stack
- **Framework**: Elysia v1.3.8 with Node.js adapter
- **Shared Libraries**: @libs/elysia-server, @libs/messaging, @libs/database, @libs/monitoring
- **WebSocket**: Native Elysia WebSocket with enhanced connection management
- **Databases**: Redis for session/cache, ClickHouse for raw events storage
- **Message Queue**: Kafka integration via @libs/messaging

## Implementation Structure

### Actual Service Structure
```
apps/ingestion/
├── src/
│   ├── main.ts                    # Server initialization using @libs/elysia-server
│   ├── routes/
│   │   ├── events.routes.ts       # REST event ingestion endpoints
│   │   ├── websocket.routes.ts    # WebSocket event streaming
│   │   ├── batch.routes.ts        # Batch event processing
│   │   └── health.routes.ts       # Health check endpoints
│   ├── services/
│   │   ├── ingestion.service.ts   # Core event ingestion logic
│   │   ├── validation.service.ts  # Event validation using @libs/models
│   │   ├── websocket.service.ts   # WebSocket message handling
│   │   └── routing.service.ts     # Event routing to downstream services
│   ├── middleware/
│   │   ├── auth.middleware.ts     # Uses @libs/auth for API authentication
│   │   ├── validation.middleware.ts # Event validation middleware
│   │   └── logging.middleware.ts  # Uses @libs/monitoring
│   └── types/
│       └── events.types.ts        # Event-specific TypeScript types
├── package.json                   # Dependencies on @libs/*
└── tsconfig.json                  # Extends base config
```

### Integration with Shared Libraries

**Server Creation (main.ts)**
```typescript
import { createElysiaServer } from '@libs/elysia-server';
import { Logger } from '@libs/monitoring';
import { WebSocketManager } from '@libs/messaging';

const logger = new Logger('ingestion');

const { app, server, wsServer } = createElysiaServer(
  {
    port: parseInt(process.env.PORT || '3001'),
    name: 'Ingestion Service',
    version: '1.0.0',
    cors: { origin: true },
    websocket: { 
      path: '/events/stream',
      maxConnections: 50000
    }
  },
  (app) => {
    // Add ingestion-specific routes
    return app
      .group('/events', (app) => eventsRoutes(app))
      .group('/batch', (app) => batchRoutes(app))
      .get('/health', healthRoutes);
  }
).addWebSocketHandler({
  open: (ws) => websocketService.handleConnection(ws),
  message: (ws, message) => websocketService.handleEventMessage(ws, message),
  close: (ws, code, reason) => websocketService.handleDisconnection(ws, code, reason)
});
```
**Event Validation (@libs/models)**
```typescript
import { CartEvent, EventSchema } from '@libs/models';

class ValidationService {
  validateCartEvent(event: any): CartEvent {
    // Use shared event models for validation
    const schema = EventSchema.parse(event);
    
    if (!schema.eventId || !schema.eventType || !schema.timestamp) {
      throw new ValidationError('Missing required event fields');
    }
    
    return schema as CartEvent;
  }

  sanitizeEvent(event: CartEvent): CartEvent {
    // Basic sanitization using shared utilities
    return {
      ...event,
      data: this.sanitizeEventData(event.data)
    };
  }
}
```

**Database Integration (@libs/database)**
```typescript
import { RedisClient, ClickHouseClient } from '@libs/database';

class IngestionService {
  private redis = RedisClient.getInstance();
  private clickhouse = ClickHouseClient.getInstance();

  async storeRawEvent(event: CartEvent): Promise<void> {
    // Store in ClickHouse for analytics
    await this.clickhouse.insert('raw_events', [event]);
    
    // Cache recent events in Redis for deduplication
    await this.redis.setex(`event:${event.eventId}`, 3600, JSON.stringify(event));
  }

  async checkDuplicateEvent(eventId: string): Promise<boolean> {
    const exists = await this.redis.exists(`event:${eventId}`);
    return exists === 1;
  }
}
```

**WebSocket Event Handling (@libs/messaging)**
```typescript
import { WebSocketManager } from '@libs/messaging';

class WebSocketService {
  private wsManager = new WebSocketManager();

  handleEventMessage(ws: WebSocket, message: any) {
    try {
      const event = this.validateIncomingEvent(message);
      
      // Process the event
      this.ingestionService.processEvent(event);
      
      // Send acknowledgment
      this.wsManager.sendToConnection(ws.id, {
        type: 'event_ack',
        eventId: event.eventId,
        status: 'received',
        timestamp: new Date()
      });
      
    } catch (error) {
      this.wsManager.sendToConnection(ws.id, {
        type: 'event_error',
        error: error.message,
        timestamp: new Date()
      });
    }
  }
}
```
## Key Features & Patterns

### Event Processing Flow
```typescript
class IngestionService {
  async processEvent(rawEvent: any): Promise<void> {
    try {
      // 1. Validate event structure
      const validatedEvent = await this.validationService.validateCartEvent(rawEvent);
      
      // 2. Check for duplicates
      const isDuplicate = await this.checkDuplicateEvent(validatedEvent.eventId);
      if (isDuplicate) {
        this.logger.info('Duplicate event ignored', { eventId: validatedEvent.eventId });
        return;
      }
      
      // 3. Sanitize event data
      const sanitizedEvent = this.validationService.sanitizeEvent(validatedEvent);
      
      // 4. Store raw event
      await this.storeRawEvent(sanitizedEvent);
      
      // 5. Route to downstream services
      await this.routingService.routeEvent(sanitizedEvent);
      
    } catch (error) {
      this.logger.error('Event processing failed', { error: error.message, event: rawEvent });
      throw error;
    }
  }
}
```

### Event Routing
```typescript
class RoutingService {
  async routeEvent(event: CartEvent): Promise<void> {
    // Route based on event type
    switch (event.eventType) {
      case 'cart_abandoned':
        // Send to prediction service for ML analysis
        await this.forwardToPredictionService(event);
        break;
        
      case 'cart_updated':
        // Update real-time analytics
        await this.forwardToAnalytics(event);
        break;
        
      case 'purchase_completed':
        // Trigger completion workflows
        await this.forwardToCompletionWorkflow(event);
        break;
    }
  }

  private async forwardToPredictionService(event: CartEvent): Promise<void> {
    // Use HTTP client to forward to prediction service
    await this.httpClient.post('/api/predict/analyze', event);
  }
}
```

### Batch Processing
```typescript
class BatchService {
  async processBatch(events: CartEvent[], options: BatchOptions = {}): Promise<BatchResult> {
    const maxBatchSize = options.maxSize || 1000;
    
    if (events.length > maxBatchSize) {
      throw new BadRequestException(`Batch size ${events.length} exceeds limit ${maxBatchSize}`);
    }
    
    const results = await Promise.allSettled(
      events.map(event => this.ingestionService.processEvent(event))
    );
    
    return {
      totalEvents: events.length,
      successful: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      errors: results
        .filter(r => r.status === 'rejected')
        .map(r => r.reason)
    };
  }
}
```
## API Endpoints

### Event Ingestion Endpoints
```typescript
// POST /events - Single event ingestion
interface CreateEventRequest {
  eventId: string;
  eventType: 'cart_created' | 'cart_updated' | 'cart_abandoned' | 'item_added' | 'item_removed' | 'purchase_completed';
  timestamp: string;
  userId?: string;
  sessionId: string;
  storeId: string;
  data: Record<string, any>;
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
    referrer?: string;
  };
}

interface EventResponse {
  eventId: string;
  status: 'accepted' | 'rejected';
  timestamp: Date;
  message?: string;
}

// POST /events/batch - Batch event processing
interface BatchEventRequest {
  events: CreateEventRequest[];
  options?: {
    maxSize?: number;
    failOnError?: boolean;
  };
}

interface BatchEventResponse {
  batchId: string;
  totalEvents: number;
  successful: number;
  failed: number;
  errors?: string[];
  processedAt: Date;
}
```

### WebSocket Event Streaming
```typescript
// WS /events/stream - Real-time event streaming
interface WebSocketEventMessage {
  type: 'cart_event' | 'heartbeat' | 'subscribe' | 'unsubscribe';
  payload: any;
  timestamp?: string;
  eventId?: string;
}

// WebSocket message types:
// - 'cart_event': Send cart event for processing
// - 'heartbeat': Keep connection alive
// - 'subscribe': Subscribe to event confirmations
// - 'unsubscribe': Unsubscribe from notifications

// Response message types:
// - 'event_ack': Event received and processed
// - 'event_error': Event processing failed
// - 'heartbeat_ack': Heartbeat acknowledgment
```

### Health & Monitoring
```typescript
// GET /health - Service health check
interface IngestionHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    redis: ServiceHealth;
    clickhouse: ServiceHealth;
    downstream: ServiceHealth;
  };
  metrics: {
    eventsPerSecond: number;
    activeConnections: number;
    errorRate: number;
  };
  timestamp: Date;
}

// GET /metrics - Processing metrics
interface IngestionMetricsResponse {
  ingestion: {
    eventsReceived: number;
    eventsProcessed: number;
    eventsFailed: number;
    averageProcessingTime: number;
  };
  websocket: {
    activeConnections: number;
    totalConnections: number;
    messagesReceived: number;
    messagesSent: number;
  };
  storage: {
    eventsStored: number;
    duplicatesIgnored: number;
    storageLatency: number;
  };
}
```

## Production Considerations

### Performance Targets
- **Event Throughput**: 10,000+ events/second sustained
- **WebSocket Connections**: Support 50,000+ concurrent connections
- **Event Processing Latency**: < 5ms from ingestion to storage
- **Batch Processing**: Up to 1,000 events per batch request

### Scalability Patterns
- **Horizontal Scaling**: Multiple ingestion instances with load balancing
- **WebSocket Distribution**: Redis adapter for multi-instance WebSocket support
- **Database Sharding**: ClickHouse cluster for high-volume event storage
- **Connection Pooling**: Redis connection pooling via @libs/database

### Error Handling & Resilience
- **Circuit Breakers**: Per-downstream service circuit breakers using @libs/utils
- **Retry Logic**: Exponential backoff for transient failures
- **Duplicate Detection**: Redis-based event deduplication
- **Health Monitoring**: Continuous health checks for all dependencies

### Monitoring & Observability
- **Structured Logging**: Using @libs/monitoring Logger for all operations
- **Metrics Collection**: Event throughput, error rates, connection counts
- **Health Checks**: Deep health checks for Redis, ClickHouse, downstream services
- **Tracing**: Request correlation for debugging event flow

### Security Considerations
- **Authentication**: Optional JWT validation using @libs/auth for API endpoints
- **Rate Limiting**: Per-client rate limiting to prevent abuse
- **Input Validation**: Comprehensive event validation using @libs/models
- **Data Sanitization**: XSS and injection protection for event data

This Ingestion Service specification reflects the actual implementation using Elysia framework and shared libraries, focusing on high-performance event collection and basic processing before routing to specialized services.
