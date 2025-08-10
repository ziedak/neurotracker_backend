# API Gateway Service Specification

## Overview

The API Gateway serves as the central entry point and WebSocket hub for the cart recovery platform. Built with Elysia framework, it handles request routing, authentication, and real-time communication while leveraging shared libraries for infrastructure concerns.

## Architecture

### Service Responsibilities
- **Request Routing**: Route HTTP requests to downstream services (ingestion, prediction, ai-engine)
- **WebSocket Hub**: Centralized WebSocket connection management with room/user tracking
- **Authentication Flow**: JWT token validation using @libs/auth
- **Rate Limiting**: Request throttling and CORS handling
- **Health Aggregation**: Monitor and report health of all services

### Technology Stack
- **Framework**: Elysia v1.3.8 with Node.js adapter
- **Shared Libraries**: @libs/elysia-server, @libs/auth, @libs/database, @libs/monitoring
- **Authentication**: JWT with jose library and RBAC (from @libs/auth)
- **WebSocket**: Native Elysia WebSocket with enhanced management
- **Databases**: Redis, PostgreSQL, ClickHouse clients (from @libs/database)

## Implementation Structure

### Actual Service Structure
```
apps/api-gateway/
├── src/
│   ├── main.ts                    # Server initialization using @libs/elysia-server
│   ├── routes/
│   │   ├── auth.routes.ts         # Authentication endpoints
│   │   ├── proxy.routes.ts        # Service proxying routes
│   │   ├── health.routes.ts       # Health check aggregation
│   │   └── websocket.routes.ts    # WebSocket endpoint configuration
│   ├── services/
│   │   ├── proxy.service.ts       # Service-to-service communication
│   │   ├── health.service.ts      # Health aggregation service
│   │   └── websocket.service.ts   # WebSocket business logic
│   ├── middleware/
│   │   ├── auth.middleware.ts     # Uses @libs/auth guards
│   │   ├── cors.middleware.ts     # CORS configuration
│   │   └── logging.middleware.ts  # Uses @libs/monitoring
│   └── types/
│       ├── api.types.ts           # API-specific types
│       └── websocket.types.ts     # WebSocket message types
├── package.json                   # Dependencies on @libs/*
└── tsconfig.json                  # Extends base config
```

### Integration with Shared Libraries

**Server Creation (main.ts)**
```typescript
import { createElysiaServer } from '@libs/elysia-server';
import { Logger } from '@libs/monitoring';
import { requireAuth } from '@libs/auth';

const logger = new Logger('api-gateway');

const { app, server, wsServer } = createElysiaServer(
  {
    port: parseInt(process.env.PORT || '3000'),
    name: 'API Gateway',
    version: '1.0.0',
    cors: { origin: true },
    websocket: { 
      path: '/ws',
      maxConnections: 10000
    }
  },
  (app) => {
    // Add gateway-specific routes
    return app
      .group('/auth', (app) => authRoutes(app))
      .group('/api', (app) => proxyRoutes(app))
      .get('/health', healthRoutes);
  }
).addWebSocketHandler({
  open: (ws) => websocketService.handleConnection(ws),
  message: (ws, message) => websocketService.handleMessage(ws, message),
  close: (ws, code, reason) => websocketService.handleDisconnection(ws, code, reason)
});
```
**Authentication Integration (@libs/auth)**
```typescript
import { requireAuth, requireRole, JWTPayload } from '@libs/auth';

// Protected route example
app.get('/protected', async ({ headers, set }) => {
  const user: JWTPayload = await requireAuth({ headers, set });
  return { user: user.sub, role: user.role };
});

// Role-based route example  
app.get('/admin', async ({ headers, set }) => {
  const user = await requireRole({ headers, set }, 'admin');
  return { message: 'Admin access granted' };
});
```

**Database Integration (@libs/database)**
```typescript
import { RedisClient, PostgreSQLClient } from '@libs/database';

class ApiGatewayService {
  private redis = RedisClient.getInstance();
  private pg = PostgreSQLClient.getInstance();

  async getUserSessions(userId: string) {
    return await this.redis.get(`session:${userId}`);
  }

  async getUserProfile(userId: string) {
    return await this.pg.query('SELECT * FROM users WHERE id = $1', [userId]);
  }
}
```
## Key Features & Patterns

### Service Proxying
```typescript
// Proxy requests to downstream services
class ProxyService {
  async routeToService(serviceName: 'ingestion' | 'prediction' | 'ai-engine', request: Request) {
    const serviceInstances = await this.serviceDiscovery.getHealthyInstances(serviceName);
    const instance = this.loadBalancer.selectInstance(serviceInstances);
    
    return await this.httpClient.forward(instance.url, request);
  }
}
```

### WebSocket Management
```typescript
// Enhanced WebSocket handling using @libs/messaging patterns
class WebSocketService {
  private wsManager = new WebSocketManager();

  handleConnection(ws: WebSocket) {
    const connectionId = this.wsManager.addConnection({
      id: generateId(),
      socket: ws,
      lastActivity: new Date(),
      metadata: {}
    });
    
    this.logger.info('WebSocket connection established', { connectionId });
  }

  handleMessage(ws: WebSocket, message: WebSocketMessage) {
    // Route messages to appropriate services
    switch (message.type) {
      case 'cart_event':
        this.forwardToIngestion(message);
        break;
      case 'prediction_request':
        this.forwardToPrediction(message);
        break;
    }
  }
}
```

### Health Aggregation
```typescript
// Aggregate health from all services
class HealthService {
  async getSystemHealth() {
    const serviceHealth = await Promise.allSettled([
      this.checkService('ingestion'),
      this.checkService('prediction'), 
      this.checkService('ai-engine'),
      this.checkDatabases()
    ]);

    return {
      status: serviceHealth.every(h => h.status === 'fulfilled') ? 'healthy' : 'degraded',
      services: serviceHealth,
      timestamp: new Date()
    };
  }
}
```

## API Endpoints

### Authentication Endpoints (using @libs/auth)
```typescript
// POST /auth/login
interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: JWTPayload;
  expiresIn: number;
}

// POST /auth/refresh  
interface RefreshRequest {
  refreshToken: string;
}

// GET /auth/me (protected)
interface MeResponse {
  user: JWTPayload;
  permissions: string[];
}
```

### Proxied Service Endpoints
```typescript
// Proxy to downstream services with authentication
// POST /api/events/* -> apps/ingestion service
// POST /api/predict/* -> apps/prediction service  
// POST /api/ai/* -> apps/ai-engine service

// Each proxied request includes:
// - JWT validation using @libs/auth
// - Request logging using @libs/monitoring
// - Circuit breaker using @libs/utils
// - Health check integration
```

### WebSocket Endpoints
```typescript
// WS /ws - Main WebSocket endpoint
interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp?: string;
  userId?: string;
  sessionId?: string;
}

// Message types handled:
// - 'cart_event' -> Forward to ingestion service
// - 'prediction_request' -> Forward to prediction service
// - 'join_room' -> Room management using @libs/messaging
// - 'heartbeat' -> Connection keepalive
```

### Health & Monitoring
```typescript
// GET /health - Aggregated system health
interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  services: {
    ingestion: ServiceHealth;
    prediction: ServiceHealth;
    aiEngine: ServiceHealth;
    databases: DatabaseHealth;
  };
  timestamp: Date;
}

// GET /metrics - Prometheus metrics (from @libs/monitoring)
```

## Production Considerations

### Performance Targets
- **Request Latency**: < 50ms for proxied requests
- **WebSocket Connections**: Support 10,000+ concurrent connections
- **Authentication**: < 10ms token validation using @libs/auth
- **Service Discovery**: < 5ms healthy instance lookup

### Scalability Patterns
- **Horizontal Scaling**: Multiple gateway instances behind load balancer
- **WebSocket Scaling**: Redis adapter for multi-instance WebSocket support
- **Circuit Breakers**: Per-service circuit breakers using @libs/utils
- **Database Connection Pooling**: Managed by @libs/database clients

### Monitoring & Observability
- **Logging**: Structured logging using @libs/monitoring Logger
- **Metrics**: Request/response metrics, WebSocket connection counts
- **Health Checks**: Continuous health monitoring of downstream services
- **Tracing**: Request correlation across service boundaries

This API Gateway specification reflects the actual implementation using Elysia framework and shared libraries, focusing on its role as a service coordinator rather than a monolithic platform.

