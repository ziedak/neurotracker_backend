# Enhanced Middleware Architecture

A production-grade middleware system with protocol-agnostic design, comprehensive error handling, and advanced chain management. Supports both HTTP and WebSocket protocols with consistent patterns and monitoring.

## Architecture Overview

Our middleware system follows a layered architecture:

- **AbstractMiddleware**: Common base functionality for all middleware types
- **BaseMiddleware**: HTTP-specific middleware implementation
- **BaseWebSocketMiddleware**: WebSocket-specific middleware implementation
- **MiddlewareChain**: HTTP middleware composition and execution
- **WebSocketMiddlewareChain**: WebSocket middleware with advanced features (circuit breakers, retry logic)
- **ElysiaMiddlewareAdapter**: Framework integration adapter
- **ChainFactory**: Convenient creation functions and patterns

## Key Principles

- ✅ **Direct Instantiation**: No dependency injection required
- ✅ **Immutable Configuration**: Per-route config via `withConfig()`
- ✅ **Framework Independence**: Core logic separated from framework specifics
- ✅ **Protocol Agnostic**: Shared patterns across HTTP and WebSocket
- ✅ **Production Ready**: Comprehensive monitoring and error handling

## Quick Start

### 1. HTTP Middleware

```typescript
import { BaseMiddleware, type HttpMiddlewareConfig } from "@libs/middleware";
import { type IMetricsCollector } from "@libs/monitoring";

interface SecurityConfig extends HttpMiddlewareConfig {
  readonly strictMode?: boolean;
  readonly allowedOrigins?: readonly string[];
}

class SecurityMiddleware extends BaseMiddleware<SecurityConfig> {
  constructor(metrics: IMetricsCollector, config: SecurityConfig) {
    super(metrics, config, "security");
  }

  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    // Add security headers
    context.set.headers = {
      ...context.set.headers,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
    };

    // Check origin if strict mode
    if (this.config.strictMode) {
      const origin = context.request.headers.origin;
      if (origin && !this.config.allowedOrigins?.includes(origin)) {
        context.set.status = 403;
        throw new Error("Origin not allowed");
      }
    }

    await next();
  }
}

// Usage
const metrics = new MetricsCollector();
const securityMiddleware = new SecurityMiddleware(metrics, {
  name: "security",
  enabled: true,
  priority: 100,
  strictMode: true,
  allowedOrigins: ["https://app.example.com"],
});

// Direct usage
const middlewareFunction = securityMiddleware.middleware();

// Framework integration
import { ElysiaMiddlewareAdapter } from "@libs/middleware/adapters";
const adapter = new ElysiaMiddlewareAdapter(securityMiddleware);
app.use(adapter.plugin());
```

### 2. WebSocket Middleware

```typescript
import {
  BaseWebSocketMiddleware,
  type WebSocketMiddlewareConfig,
} from "@libs/middleware";

interface WSAuthConfig extends WebSocketMiddlewareConfig {
  readonly requireAuth?: boolean;
  readonly allowedMessageTypes?: readonly string[];
}

class WSAuthMiddleware extends BaseWebSocketMiddleware<WSAuthConfig> {
  constructor(metrics: IMetricsCollector, config: WSAuthConfig) {
    super(metrics, config, "ws-auth");
  }

  protected async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    if (this.config.requireAuth && !context.authenticated) {
      this.sendResponse(context, {
        type: "error",
        message: "Authentication required",
      });
      return; // Don't call next() to stop execution
    }

    // Validate message type
    if (this.config.allowedMessageTypes) {
      const messageType = context.message.type;
      if (!this.config.allowedMessageTypes.includes(messageType)) {
        this.sendResponse(context, {
          type: "error",
          message: `Message type '${messageType}' not allowed`,
        });
        return;
      }
    }

    await next();
  }
}

// Usage
const wsAuthMiddleware = new WSAuthMiddleware(metrics, {
  name: "ws-auth",
  enabled: true,
  priority: 100,
  requireAuth: true,
  allowedMessageTypes: ["ping", "message", "subscribe"],
});

const middlewareFunction = wsAuthMiddleware.middleware();
```

### 3. Middleware Chains

```typescript
import { MiddlewareChain, WebSocketMiddlewareChain } from "@libs/middleware";

// HTTP Chain
const httpChain = new MiddlewareChain(metrics, {
  name: "api-security-chain",
  middlewares: [
    {
      name: "cors",
      middleware: corsMiddleware.middleware(),
      priority: 100,
      enabled: true,
    },
    {
      name: "security",
      middleware: securityMiddleware.middleware(),
      priority: 90,
      enabled: true,
    },
    {
      name: "auth",
      middleware: authMiddleware.middleware(),
      priority: 80,
      enabled: true,
    },
  ],
});

app.use(httpChain.execute());

// WebSocket Chain with Advanced Features
const wsChain = new WebSocketMiddlewareChain(metrics, "ws-chain");

wsChain.register(
  {
    name: "auth",
    priority: 100,
    circuitBreakerConfig: {
      failureThreshold: 5,
      recoveryTimeout: 30000,
      halfOpenMaxCalls: 3,
    },
  },
  wsAuthMiddleware.middleware()
);

wsChain.register(
  {
    name: "rate-limit",
    priority: 90,
    retryConfig: {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 5000,
      backoffMultiplier: 2,
    },
  },
  wsRateLimitMiddleware.middleware()
);

wsHandler.use(wsChain.createExecutor());
```

### 4. Factory Functions

```typescript
import {
  createHttpMiddlewareChain,
  createWebSocketMiddlewareChain,
  MiddlewareChainPatterns,
} from "@libs/middleware/factories";

// HTTP chain with auto-priorities
const securityChain = createHttpMiddlewareChain(metrics, "security", [
  { name: "cors", middleware: corsMiddleware },
  { name: "security", middleware: securityMiddleware },
  { name: "auth", middleware: authMiddleware },
]);

// WebSocket chain with patterns
const pattern = MiddlewareChainPatterns.PRODUCTION_WS();
const wsChain = createWebSocketMiddlewareChain(metrics, pattern.name, [
  {
    name: "auth",
    middleware: wsAuthMiddleware,
    priority: pattern.priorities.auth,
  },
  {
    name: "rate-limit",
    middleware: wsRateLimitMiddleware,
    priority: pattern.priorities.rateLimit,
  },
]);
```

## Configuration Management

### Immutable Configuration with withConfig()

```typescript
// Base middleware instance
const baseSecurityMiddleware = new SecurityMiddleware(metrics, {
  name: "security",
  enabled: true,
  strictMode: false,
});

// Per-route configuration (creates new instance)
const strictSecurityMiddleware = baseSecurityMiddleware.withConfig({
  strictMode: true,
  allowedOrigins: ["https://admin.example.com"],
});

// Different config for public routes
const publicSecurityMiddleware = baseSecurityMiddleware.withConfig({
  skipPaths: ["/public/*", "/health"],
});

// Each instance is independent
app.use("/admin/*", strictSecurityMiddleware.middleware());
app.use("/api/*", publicSecurityMiddleware.middleware());
```

## Advanced Features

### Circuit Breakers (WebSocket)

```typescript
wsChain.register(
  {
    name: "external-service",
    priority: 50,
    circuitBreakerConfig: {
      failureThreshold: 5, // Open after 5 failures
      recoveryTimeout: 30000, // Try recovery after 30s
      halfOpenMaxCalls: 3, // Allow 3 calls in half-open state
    },
  },
  externalServiceMiddleware
);
```

### Retry Logic (WebSocket)

```typescript
wsChain.register(
  {
    name: "rate-limit",
    priority: 90,
    retryConfig: {
      maxRetries: 3,
      baseDelay: 1000, // Start with 1s delay
      maxDelay: 5000, // Max 5s delay
      backoffMultiplier: 2, // Exponential backoff
    },
  },
  rateLimitMiddleware
);
```

### Dependency Resolution (WebSocket)

```typescript
// Register dependencies first
wsChain.register({ name: "auth", priority: 100 }, authMiddleware);

// Dependent middleware
wsChain.register(
  {
    name: "user-validation",
    priority: 90,
    dependencies: ["auth"], // Requires auth to run first
  },
  userValidationMiddleware
);
```

## Monitoring and Metrics

All middleware automatically provides:

### Execution Metrics

- `middleware_execution_success/failure` - Individual middleware results
- `middleware_execution_duration` - Execution timing
- `middleware_chain_success/failure` - Chain-level results
- `middleware_chain_duration` - Total chain execution time

### Error Tracking

- Automatic error logging with context
- Error type classification
- Request correlation IDs
- Sanitized context information

### Performance Monitoring

- Per-middleware execution timing
- Chain composition analysis
- Circuit breaker state tracking
- Retry attempt monitoring

## Framework Integration

### Elysia Integration

```typescript
import { ElysiaMiddlewareAdapter } from "@libs/middleware/adapters";

const middleware = new SecurityMiddleware(metrics, config);
const adapter = new ElysiaMiddlewareAdapter(middleware);

// Simple plugin
app.use(adapter.plugin());

// Advanced plugin with decorators
app.use(adapter.advancedPlugin());

// Per-route configuration
app.use("/api/*", adapter.plugin({ enabled: true }));
app.use("/public/*", adapter.plugin({ enabled: false }));
```

### Other Frameworks

```typescript
// Framework-agnostic middleware function
const middlewareFunction = securityMiddleware.middleware();

// Use with Express-like frameworks
expressApp.use(middlewareFunction);

// Use with custom framework
customFramework.addMiddleware(middlewareFunction);
```

## Best Practices

### 1. Configuration Design

```typescript
// ✅ Good: Immutable, specific interfaces
interface AuthConfig extends HttpMiddlewareConfig {
  readonly tokenSecret: string;
  readonly allowedRoles?: readonly string[];
}

// ❌ Bad: Mutable, generic config
interface AuthConfig {
  tokenSecret: string;
  allowedRoles: string[];
  [key: string]: any;
}
```

### 2. Error Handling

```typescript
// ✅ Good: Specific errors with context
protected async execute(context: MiddlewareContext, next: () => Promise<void>) {
  try {
    await this.validateToken(context);
    await next();
  } catch (error) {
    if (error instanceof TokenExpiredError) {
      context.set.status = 401;
      throw new Error("Token expired");
    }
    throw error; // Re-throw unknown errors
  }
}

// ❌ Bad: Generic error handling
protected async execute(context: MiddlewareContext, next: () => Promise<void>) {
  try {
    await next();
  } catch (error) {
    context.set.status = 500;
    // Swallowing specific error information
  }
}
```

### 3. Resource Management

```typescript
// ✅ Good: Clean resource management
class DatabaseMiddleware extends BaseMiddleware<DatabaseConfig> {
  private connectionPool: ConnectionPool;

  constructor(metrics: IMetricsCollector, config: DatabaseConfig) {
    super(metrics, config, "database");
    this.connectionPool = new ConnectionPool(config.database);
  }

  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ) {
    const connection = await this.connectionPool.acquire();
    try {
      context.db = connection;
      await next();
    } finally {
      this.connectionPool.release(connection);
    }
  }
}
```

### 4. Testing

```typescript
// ✅ Easy testing with direct instantiation
describe("SecurityMiddleware", () => {
  let middleware: SecurityMiddleware;
  let mockMetrics: jest.Mocked<IMetricsCollector>;

  beforeEach(() => {
    mockMetrics = createMockMetrics();
    middleware = new SecurityMiddleware(mockMetrics, {
      name: "security",
      enabled: true,
      strictMode: true,
    });
  });

  it("should add security headers", async () => {
    const context = createMockContext();
    const next = jest.fn();

    await middleware.middleware()(context, next);

    expect(context.set.headers["X-Frame-Options"]).toBe("DENY");
    expect(next).toHaveBeenCalled();
  });
});
```

## Migration Guide

### From Legacy Middleware

1. **Remove DI decorators**: No more `@injectable()` or `@inject()`
2. **Extend appropriate base**: `BaseMiddleware` for HTTP, `BaseWebSocketMiddleware` for WebSocket
3. **Update constructor**: Accept dependencies directly
4. **Implement execute method**: Move logic from old middleware function
5. **Update configuration**: Use immutable config interfaces

### From Old Chain Systems

1. **Replace custom chains**: Use `MiddlewareChain` or `WebSocketMiddlewareChain`
2. **Update registration**: Use new chain APIs
3. **Migrate priorities**: Use numeric priority system
4. **Add monitoring**: Leverage built-in metrics

## Performance Characteristics

- **Minimal Overhead**: Direct function calls, no reflection
- **Memory Efficient**: Immutable configs prevent leaks
- **Scalable**: Chain execution optimized for high throughput
- **Observable**: Comprehensive metrics with minimal impact
- **Maintainable**: Clear separation of concerns

The enhanced middleware architecture provides a robust foundation for building scalable, maintainable middleware systems with excellent developer experience and production-grade monitoring.
