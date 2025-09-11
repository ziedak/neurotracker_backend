# CORS Middleware Module

Production-grade Cross-Origin Resource Sharing (CORS) middleware for both HTTP and WebSocket connections.

## Features

- **Dual Protocol Support**: HTTP and WebSocket CORS validation
- **Comprehensive Origin Validation**: String, array, boolean, and function-based validation
- **Protocol & Extension Validation**: WebSocket-specific security controls
- **Environment Presets**: Development, production, and application-specific configurations
- **Performance Optimized**: Caching and efficient validation algorithms
- **Production Hardened**: Extensive error handling and security best practices
- **Comprehensive Monitoring**: Detailed metrics and logging

## Quick Start

### HTTP CORS Middleware

```typescript
import { createCorsMiddleware, CORS_PRESETS } from "@libs/middleware/cors";

// Basic HTTP CORS
const httpCorsMiddleware = createCorsMiddleware(metrics, {
  origin: ["https://myapp.com"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
});

// Use with HTTP middleware chain
app.use(httpCorsMiddleware.middleware());
```

### WebSocket CORS Middleware

```typescript
import {
  createWebSocketCorsMiddleware,
  WEBSOCKET_CORS_PRESETS,
} from "@libs/middleware/cors";

// Basic WebSocket CORS
const wsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  origin: ["https://myapp.com"],
  allowedProtocols: ["wss"],
  validateUpgrade: true,
});

// Use with WebSocket handler
websocketHandler.use(wsCorsMiddleware.middleware());
```

## HTTP CORS Configuration

### Interface

```typescript
interface CorsMiddlewareConfig extends HttpMiddlewareConfig {
  readonly origin?:
    | string
    | readonly string[]
    | boolean
    | ((origin: string) => boolean);
  readonly methods?: readonly string[];
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly credentials?: boolean;
  readonly maxAge?: number;
  readonly preflightContinue?: boolean;
  readonly optionsSuccessStatus?: number;
}
```

### Environment Presets

```typescript
// Development - permissive configuration
const devConfig = CORS_PRESETS.development();

// Production - strict origin validation
const prodConfig = CORS_PRESETS.production(["https://myapp.com"]);

// API-specific - optimized for API endpoints
const apiConfig = CORS_PRESETS.api();

// Strict - maximum security
const strictConfig = CORS_PRESETS.strict(["https://secure-app.com"]);
```

## WebSocket CORS Configuration

### Interface

```typescript
interface WebSocketCorsMiddlewareConfig extends WebSocketMiddlewareConfig {
  readonly origin?:
    | string
    | readonly string[]
    | boolean
    | ((origin: string) => boolean);
  readonly allowedProtocols?: readonly string[];
  readonly allowedExtensions?: readonly string[];
  readonly credentials?: boolean;
  readonly maxAge?: number;
  readonly validateUpgrade?: boolean;
  readonly allowOriginless?: boolean;
}
```

### Environment Presets

```typescript
// Development - permissive WebSocket configuration
const devWsConfig = WEBSOCKET_CORS_PRESETS.development();

// Production - secure WebSocket configuration
const prodWsConfig = WEBSOCKET_CORS_PRESETS.production(["https://myapp.com"]);

// Application-specific presets
const gamingConfig = WEBSOCKET_CORS_PRESETS.gaming([
  "https://game.example.com",
]);
const chatConfig = WEBSOCKET_CORS_PRESETS.chat(["https://chat.example.com"]);
const streamingConfig = WEBSOCKET_CORS_PRESETS.streaming([
  "https://stream.example.com",
]);
```

## Advanced Configuration

### Custom Origin Validation

```typescript
// Function-based origin validation
const customOriginValidation = (origin: string) => {
  return (
    origin.endsWith(".mycompany.com") || origin === "https://localhost:3000"
  );
};

const corsMiddleware = createCorsMiddleware(metrics, {
  origin: customOriginValidation,
  credentials: true,
});
```

### Environment-Based Configuration

```typescript
const corsConfig =
  process.env.NODE_ENV === "production"
    ? CORS_PRESETS.production(process.env.ALLOWED_ORIGINS?.split(",") || [])
    : CORS_PRESETS.development();

const corsMiddleware = createCorsMiddleware(metrics, {
  ...corsConfig,
  name: `cors-${process.env.NODE_ENV}`,
});
```

## WebSocket-Specific Features

### Connection Upgrade Validation

```typescript
const wsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  origin: ["https://trusted-app.com"],
  validateUpgrade: true, // Validate during WebSocket handshake
  allowedProtocols: ["wss"],
  allowedExtensions: ["permessage-deflate"],
});
```

### Protocol and Extension Security

```typescript
const secureWsConfig = {
  allowedProtocols: ["wss"], // Only secure WebSocket
  allowedExtensions: ["permessage-deflate"], // Only compression
  allowOriginless: false, // Require origin header
  validateUpgrade: true, // Strict handshake validation
};
```

## Integration Examples

### HTTP with Express/Elysia

```typescript
import { createCorsMiddleware } from "@libs/middleware/cors";

const app = new Elysia();
const corsMiddleware = createCorsMiddleware(metrics, {
  origin: ["https://myapp.com"],
  credentials: true,
});

app.use(corsMiddleware.middleware());
```

### WebSocket with Socket.IO/ws

```typescript
import { createWebSocketCorsMiddleware } from "@libs/middleware/cors";

const wsCorsMiddleware = createWebSocketCorsMiddleware(metrics, {
  origin: ["https://myapp.com"],
  validateUpgrade: true,
});

websocketServer.on("connection", async (ws, request) => {
  const context = {
    ws,
    connectionId: generateId(),
    message: { type: "connection" },
    metadata: extractMetadata(request),
    authenticated: false,
    upgradeHeaders: request.headers,
  };

  try {
    await wsCorsMiddleware.middleware()(context, async () => {
      console.log("WebSocket connection validated");
    });
  } catch (error) {
    ws.close(1008, "CORS validation failed");
  }
});
```

### Middleware Chain Integration

```typescript
import { MiddlewareChain, WebSocketMiddlewareChain } from "@libs/middleware";

// HTTP Chain
const httpChain = new MiddlewareChain(metrics, "http-chain");
httpChain.register(
  { name: "cors", priority: 1000, enabled: true },
  corsMiddleware.middleware()
);

// WebSocket Chain
const wsChain = new WebSocketMiddlewareChain(metrics, "ws-chain");
wsChain.register(
  { name: "websocket-cors", priority: 1000, enabled: true },
  wsCorsMiddleware.middleware()
);
```

## Error Handling

### HTTP CORS Errors

HTTP CORS middleware handles errors automatically:

- **Preflight failures**: Returns appropriate HTTP status codes
- **Origin validation failures**: Blocks requests with proper error responses
- **Configuration errors**: Throws during initialization

### WebSocket CORS Errors

WebSocket CORS middleware provides comprehensive error handling:

- **Connection upgrade failures**: Prevents WebSocket connection establishment
- **Origin validation failures**: Sends error message and optionally closes connection
- **Protocol/extension violations**: Immediate connection termination

```typescript
// WebSocket error response format
{
  "type": "error",
  "error": "CORS_VALIDATION_FAILED",
  "message": "WebSocket CORS validation failed",
  "timestamp": "2025-09-07T10:30:00.000Z"
}
```

## Monitoring and Metrics

Both HTTP and WebSocket CORS middleware provide comprehensive metrics:

### HTTP CORS Metrics

- `cors_request_processed` - Total requests processed
- `cors_preflight_handled` - Preflight requests handled
- `cors_execution_time` - Middleware execution time
- `cors_error` - CORS validation errors

### WebSocket CORS Metrics

- `websocket_cors_validation_success` - Successful validations
- `websocket_cors_upgrade_validated` - Successful upgrade validations
- `websocket_cors_execution_time` - Middleware execution time
- `websocket_cors_error` - CORS validation errors

## Security Best Practices

1. **Use Specific Origins**: Avoid wildcard (`*`) origins in production
2. **Secure Protocols**: Use `https://` and `wss://` in production
3. **Limit Methods**: Only allow necessary HTTP methods
4. **Restrict Headers**: Specify exact allowed headers
5. **Validate Extensions**: Limit WebSocket extensions for security
6. **Monitor Failures**: Set up alerts for unusual CORS failure patterns

## Configuration Examples

See [websocket-cors-examples.md](./websocket-cors-examples.md) for comprehensive WebSocket CORS examples.

## Architecture

Both HTTP and WebSocket CORS middleware follow the AbstractMiddleware pattern:

- **Immutable Configuration**: Thread-safe, readonly configurations
- **Metrics Integration**: Built-in monitoring and performance tracking
- **Error Boundaries**: Comprehensive error handling and recovery
- **Type Safety**: Full TypeScript support with strict typing
- **Production Ready**: Optimized for high-performance production environments

## Dependencies

- `@libs/monitoring` - Metrics collection and logging
- `@libs/middleware/base` - Base middleware abstractions
- `@libs/middleware/types` - Type definitions and interfaces

### CorsConfig Interface

```typescript
interface CorsConfig extends MiddlewareOptions {
  origin?: string | string[] | boolean | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
}
```

### Configuration Examples

#### String Origin

```typescript
{
  origin: "https://myapp.com";
}
```

#### Array of Origins

```typescript
{
  origin: [
    "https://myapp.com",
    "https://admin.myapp.com",
    "https://api.myapp.com",
  ];
}
```

#### Dynamic Origin Validation

```typescript
{
  origin: (origin) => {
    // Custom validation logic
    const allowedDomains = [".mycompany.com", ".myapp.io"];
    return allowedDomains.some((domain) => origin.endsWith(domain));
  };
}
```

#### Complete Configuration

```typescript
{
  origin: ["https://myapp.com"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  exposedHeaders: ["X-Total-Count", "X-Rate-Limit-Remaining"],
  credentials: true,
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 204,
  skipPaths: ["/health", "/metrics"]
}
```

## Available Presets

### Development Preset

Permissive settings for local development:

```typescript
corsPresets.development()
// Returns:
{
  origin: "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
  allowedHeaders: ["*"]
}
```

### Production Preset

Secure settings for production environments:

```typescript
corsPresets.production(["https://myapp.com"]);
// Returns secure configuration with specified origins
```

### API Preset

Optimized for REST APIs:

```typescript
corsPresets.api();
// Returns configuration optimized for API endpoints
```

### Strict Preset

Highly restrictive settings:

```typescript
corsPresets.strict(["https://myapp.com"]);
// Returns minimal permissions configuration
```

### WebSocket Preset

Optimized for WebSocket applications:

```typescript
corsPresets.websocket(["https://myapp.com"]);
// Returns configuration with WebSocket-specific headers
```

### GraphQL Preset

Optimized for GraphQL endpoints:

```typescript
corsPresets.graphql(["https://myapp.com"]);
// Returns configuration with GraphQL-specific headers
```

## Usage Patterns

### 1. Simple Plugin Pattern

```typescript
import { createCorsMiddleware } from "@libs/middleware";

const app = new Elysia()
  .use(
    createCorsMiddleware({
      origin: ["https://myapp.com"],
      credentials: true,
    })
  )
  .get("/", () => "Hello World");
```

### 2. Advanced Plugin Pattern

```typescript
import { createCorsMiddlewareInstance } from "@libs/middleware";

const cors = createCorsMiddlewareInstance({
  origin: corsPresets.production(["https://myapp.com"]),
  skipPaths: ["/health"],
});

const app = new Elysia()
  .use(cors.plugin()) // Advanced plugin with decorators
  .get("/", ({ cors }) => {
    return {
      message: "Hello World",
      corsEnabled: cors.isEnabled(),
    };
  });
```

### 3. Framework-Agnostic Pattern

```typescript
import { createCorsMiddlewareInstance } from "@libs/middleware";

const cors = createCorsMiddlewareInstance({
  origin: "*",
  methods: ["GET", "POST"],
});

const middlewareFunction = cors.middleware();
// Use with any framework that supports standard middleware functions
```

## Security Best Practices

### 1. Restrict Origins in Production

```typescript
// ❌ Avoid in production
{
  origin: "*";
}

// ✅ Use specific origins
{
  origin: ["https://myapp.com", "https://admin.myapp.com"];
}
```

### 2. Limit Methods

```typescript
// ✅ Only allow necessary methods
{
  methods: ["GET", "POST", "PUT", "DELETE"];
}
```

### 3. Control Headers

```typescript
// ✅ Be specific with allowed headers
{
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  exposedHeaders: ["X-Total-Count"] // Only expose necessary headers
}
```

### 4. Credentials Handling

```typescript
// ⚠️ Only enable if needed
{
  credentials: true,
  origin: ["https://myapp.com"] // Must be specific when credentials: true
}
```

## Monitoring and Metrics

The middleware automatically records the following metrics:

- `cors_request_processed` - Counter for processed CORS requests
- `cors_preflight_handled` - Counter for handled preflight requests
- Tags include: `origin`, `method`, `allowed` (true/false)

### Custom Metrics Integration

```typescript
const cors = createCorsMiddlewareInstance({
  origin: ["https://myapp.com"],
});

// Metrics are automatically recorded with each request
// Access via the monitoring system
```

## Error Handling

The middleware provides comprehensive error handling:

- **Invalid Origins**: Blocked with appropriate CORS headers
- **Method Not Allowed**: Handled via CORS method restrictions
- **Preflight Failures**: Proper error responses with CORS headers
- **Configuration Errors**: Detailed logging and error propagation

## Migration from Legacy CORS

If migrating from the previous CORS implementation:

### Before (Legacy)

```typescript
import { cors } from "@elysiajs/cors";

app.use(
  cors({
    origin: "https://myapp.com",
  })
);
```

### After (Enhanced)

```typescript
import { createCorsMiddleware } from "@libs/middleware";

app.use(
  createCorsMiddleware({
    origin: "https://myapp.com",
  })
);
```

### Additional Benefits

- Built-in monitoring and metrics
- Path skipping capabilities
- Enhanced error handling
- Consistent logging patterns
- Production-ready defaults

## Advanced Examples

### Environment-Based Configuration

```typescript
import { createCorsMiddlewareInstance, corsPresets } from "@libs/middleware";

const getCorsConfig = () => {
  switch (process.env.NODE_ENV) {
    case "development":
      return corsPresets.development();
    case "production":
      return corsPresets.production(
        process.env.ALLOWED_ORIGINS?.split(",") || []
      );
    case "test":
      return corsPresets.strict(["http://localhost:3000"]);
    default:
      return corsPresets.api();
  }
};

const cors = createCorsMiddlewareInstance(getCorsConfig());
```

### Multi-Origin with Custom Validation

```typescript
const cors = createCorsMiddlewareInstance({
  origin: (origin) => {
    // Allow localhost for development
    if (origin.includes("localhost")) return true;

    // Allow company domains
    const companyDomains = [".mycompany.com", ".mycompany.io"];
    if (companyDomains.some((domain) => origin.endsWith(domain))) return true;

    // Allow specific partners
    const partnerOrigins = ["https://partner1.com", "https://partner2.com"];
    return partnerOrigins.includes(origin);
  },
  credentials: true,
  maxAge: 3600,
});
```

### Path-Specific CORS

```typescript
const publicCors = createCorsMiddlewareInstance({
  origin: "*",
  credentials: false,
  skipPaths: ["/api/admin/*", "/api/internal/*"],
});

const restrictedCors = createCorsMiddlewareInstance({
  origin: ["https://admin.myapp.com"],
  credentials: true,
  skipPaths: ["/api/public/*", "/health"],
});

app.use(publicCors.elysia()).use(restrictedCors.elysia());
```

The enhanced CORS middleware provides enterprise-grade security, monitoring, and flexibility while maintaining simplicity for basic use cases.
