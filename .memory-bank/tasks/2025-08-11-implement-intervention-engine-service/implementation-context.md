# Intervention Engine Service - Implementation Context

## Service Architecture Reference

Based on `/home/zied/workspace/backend/.docs/Service_Architecture_Review.md`, the intervention-engine service specifications:

### Core Responsibilities

- **Real-time Delivery**: WebSocket-based instant interventions
- **Multi-channel Notifications**: Email, SMS, push notifications
- **Intervention Tracking**: Delivery confirmation, engagement tracking
- **Personalization**: Dynamic content personalization
- **Campaign Management**: Intervention templates, A/B testing
- **Delivery Optimization**: Channel selection, timing optimization

### Technical Architecture

```
intervention-engine/
├── src/
│   ├── delivery/          # Real-time WebSocket delivery
│   │   ├── websocket.gateway.ts      # Real-time WebSocket delivery
│   │   ├── delivery.controller.ts    # Delivery API endpoints
│   │   ├── delivery.service.ts       # Core delivery logic
│   │   ├── channel.service.ts        # Channel management
│   │   └── optimization.service.ts   # Delivery optimization
│   ├── notifications/     # Multi-channel notifications
│   │   ├── email.service.ts          # Email provider integration
│   │   ├── sms.service.ts            # SMS provider integration
│   │   ├── push.service.ts           # Push notification service
│   │   └── template.service.ts       # Template management
│   ├── tracking/          # Event tracking and analytics
│   │   ├── tracking.controller.ts    # Tracking API endpoints
│   │   ├── tracking.service.ts       # Event tracking logic
│   │   ├── attribution.service.ts    # Attribution modeling
│   │   └── analytics.service.ts      # Performance analytics
│   ├── personalization/   # Content personalization
│   │   ├── personalization.service.ts # Content personalization
│   │   ├── segmentation.service.ts    # User segmentation
│   │   └── optimization.service.ts    # Content optimization
│   ├── campaigns/         # Campaign management
│   │   ├── campaign.controller.ts     # Campaign management
│   │   ├── template.service.ts        # Template management
│   │   └── scheduler.service.ts       # Campaign scheduling
│   └── queue/             # Processing queues
│       ├── intervention.queue.ts      # Intervention processing queue
│       ├── notification.queue.ts      # Notification delivery queue
│       └── retry.service.ts           # Failed delivery retry
```

## Existing Infrastructure Verification

### ✅ @libs/elysia-server WebSocket Capabilities

**Verified Features**:

- Built-in WebSocket support with `ws()` method
- Connection management (open, message, close, drain handlers)
- Room-based messaging (`join_room`, `leave_room`)
- User connection tracking with authentication
- Broadcasting capabilities (`sendToConnection`, `sendToUser`, `sendToRoom`, `broadcast`)
- Connection pooling and cleanup
- WebSocket stats endpoint (`/ws/stats`)

**Usage Pattern**:

```typescript
import { createElysiaServer } from "@libs/elysia-server";

const { app, server, wsServer } = createElysiaServer(
  {
    name: "Intervention Engine",
    port: 3003,
    websocket: { enabled: true, path: "/ws" },
  },
  (app) => {
    // Add routes
  }
)
  .addWebSocketHandler({
    open: (ws) => handleConnection(ws),
    message: (ws, message) => handleMessage(ws, message),
    close: (ws, code, reason) => handleClose(ws, code, reason),
  })
  .start();
```

### ✅ Existing Service Patterns

**Verified Patterns from event-pipeline and ai-engine**:

- ServiceContainer dependency injection usage
- Package.json structure with workspace dependencies
- TypeScript configuration following workspace standards
- Health endpoints and monitoring integration
- Container setup in `src/container.ts`
- Main service entry in `src/index.ts`

### ✅ Dependencies Available

**Confirmed Workspace Libraries**:

- `@libs/elysia-server`: Server with WebSocket support ✅
- `@libs/database`: Redis, PostgreSQL, ClickHouse access ✅
- `@libs/monitoring`: Metrics, logging, observability ✅
- `@libs/messaging`: Kafka integration ✅
- `@libs/utils`: Utility functions ✅
- `@libs/config`: Configuration management ✅
- `@libs/auth`: Authentication utilities ✅

## Implementation Strategy

### Phase 1 Approach: Leverage Existing Infrastructure

**DO NOT CREATE FROM SCRATCH**:

- Use `createElysiaServer()` from @libs/elysia-server
- Follow package.json pattern from existing apps
- Copy TypeScript config structure
- Use ServiceContainer pattern like other services

### Critical Implementation Notes

1. **WebSocket Implementation**: Use built-in `addWebSocketHandler()` method
2. **Service Registration**: Follow ServiceContainer pattern from event-pipeline
3. **Configuration**: Use @libs/config patterns
4. **Monitoring**: Integrate with @libs/monitoring like other services
5. **Database**: Use @libs/database for Redis/PostgreSQL connections

### Integration Points

- **Consumes**: cart-events-enriched (Kafka), prediction-results (Kafka)
- **Produces**: intervention-events (Kafka), conversion-events (Kafka)
- **Redis**: WebSocket connections, intervention cache, user preferences
- **PostgreSQL**: Interventions, tracking, templates, campaigns
- **External**: Email providers, SMS providers, push notification services

## Next Steps

1. Create service directory structure in apps/intervention-engine
2. Set up package.json following existing service patterns
3. Configure @libs/elysia-server with WebSocket enabled
4. Implement WebSocket gateway using verified patterns
5. Build delivery and notification systems
6. Add tracking and campaign management
7. Integration testing with existing services
