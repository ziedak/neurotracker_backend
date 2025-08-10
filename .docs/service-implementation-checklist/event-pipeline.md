# event-pipeline Service Implementation Checklist

## Current Status

- Stub implementation
- Event ingestion endpoints (`/events`, `/events/batch`) defined incompleted
- Event processing is a stub (console logging)

### Functional Responsibilities

- **Event Ingestion**: Multi-protocol event collection (WebSocket primary, REST fallback)
- **Event Processing**: Real-time stream processing, data enrichment
- **Schema Management**: Event schema validation, evolution, registry
- **Event Routing**: Intelligent routing to downstream consumers
- **Batch Processing**: High-throughput batch event processing
- **Dead Letter Handling**: Failed event retry and alerting

### Technical Implementation

#### Module Structure

```
event-pipeline/
├── src/
│   ├── ingestion/
│   │   ├── websocket.gateway.ts
│   │   ├── batch.controller.ts       # Batch processing endpoint
│   │   └── validation.service.ts     # Event validation
│   ├── processing/
│   │   ├── stream.processor.ts       # Kafka streams processing
│   │   ├── enrichment.service.ts     # Data enrichment logic
│   │   ├── deduplication.service.ts  # Event deduplication
│   │   └── routing.service.ts        # Event routing logic
│   ├── schema/
│   │   ├── registry.service.ts       # Schema version management
│   │   ├── validator.service.ts      # Schema validation
│   │   └── migration.service.ts      # Schema evolution
│   ├── deadletter/
│   │   ├── handler.service.ts        # Dead letter processing
│   │   └── retry.service.ts          # Retry mechanism
│   └── monitoring/
│   │    ├── metrics.service.ts        # Pipeline metrics
│   │    └── alerts.service.ts         # Alert generation
│   ├── main.ts #entry point (server)  # WebSocket  and REST fallback endpoint (see /home/zied/workspace/backend/libs/elysia-server)
```

#### Data Layer

```typescript
// Kafka Topics
cart-events-raw            -> Raw incoming events
cart-events-validated      -> Schema-validated events
cart-events-enriched       -> Enriched with user/store data
cart-events-dlq            -> Dead letter queue

// Redis Structures
event_dedup:{hash}         -> {eventId, timestamp} (TTL: 1 hour)
user_profile:{userId}      -> {lastSeen, purchaseHistory, preferences}
store_config:{storeId}     -> {timezone, businessHours, settings}
schema_cache:{version}     -> {schema, validationRules}

// ClickHouse Tables (Raw Events)
events_raw                 -> All incoming events (18 months retention)
events_processed          -> Processed events with enrichment
events_errors             -> Processing errors and failures
```

#### Kafka Streams Topology

```typescript
// Stream Processing Flow
Source: cart-events-raw
├── Filter: Remove duplicates
├── Transform: Validate schema
├── Branch:
│   ├── Valid Events -> Enrichment -> cart-events-enriched
│   └── Invalid Events -> cart-events-dlq
└── Sink: Store to ClickHouse

// Enrichment Process
1. Get user profile from Redis/PostgreSQL
2. Get store configuration
3. Add session context
4. Calculate derived features
5. Add processing metadata
```

#### API Endpoints

```typescript
// Event Ingestion
WS     /events/stream        # WebSocket event ingestion
POST   /events               # Single event (REST fallback)
POST   /events/batch         # Batch event processing
GET    /events/stats         # Ingestion statistics

// Schema Management
GET    /schemas              # List available schemas
POST   /schemas              # Register new schema
GET    /schemas/:version     # Get specific schema
PUT    /schemas/:version     # Update schema

// Monitoring
GET    /health               # Service health
GET    /metrics              # Processing metrics
GET    /pipeline/status      # Pipeline health status
```

## Missing Features

- Real event pipeline and validation logic
- Integration with Kafka or other message broker
- Event persistence (database integration)
- Batch processing and error handling
- Input validation and deduplication
- Monitoring, metrics, and health checks
- API documentation and versioning

## Action Plan

- [ ] Implement event pipeline and validation logic
- [ ] Integrate with Kafka/message broker for event streaming
- [ ] Add event persistence (database integration)
- [ ] Implement batch processing and error handling
- [ ] Add input validation and deduplication
- [ ] Integrate monitoring, metrics, and health checks
- [ ] Complete API documentation and versioning
