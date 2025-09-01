# CORS Middleware - Enhanced Implementation

A production-grade CORS (Cross-Origin Resource Sharing) middleware built on the enhanced BaseMiddleware foundation, providing comprehensive security, monitoring, and flexible configuration options.

## Features

- **Production-Ready**: Built on the enhanced BaseMiddleware with full error handling and metrics
- **Flexible Origin Control**: Supports strings, arrays, functions, and boolean origin validation
- **Preflight Handling**: Automatic OPTIONS request handling with proper status codes
- **Security-First**: Configurable headers, credentials, and methods with sensible defaults
- **Monitoring Integration**: Built-in metrics for CORS requests and preflight handling
- **Multiple Usage Patterns**: Simple plugins, advanced plugins, and framework-agnostic functions
- **Preset Configurations**: Ready-to-use configurations for common scenarios

## Quick Start

### Basic Usage

```typescript
import { Elysia } from "elysia";
import { createCorsMiddleware } from "@libs/middleware";

const app = new Elysia()
  .use(
    createCorsMiddleware({
      origin: ["https://myapp.com", "https://admin.myapp.com"],
      credentials: true,
    })
  )
  .get("/", () => "Hello World");
```

### Using Presets

```typescript
import { createCorsMiddlewareInstance, corsPresets } from "@libs/middleware";

// Development - permissive settings
const devCors = createCorsMiddlewareInstance(corsPresets.development());

// Production - secure settings
const prodCors = createCorsMiddlewareInstance(
  corsPresets.production(["https://myapp.com"])
);

// API-specific settings
const apiCors = createCorsMiddlewareInstance(corsPresets.api());
```

## Configuration Options

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
