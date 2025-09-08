# Error Middleware - Enhanced Architecture

The Error Middleware system has been updated to follow our new AbstractMiddleware architecture, providing comprehensive error handling with framework-agnostic design and immutable configuration for both HTTP and WebSocket protocols.

## Architecture Overview

The Error Middleware system now includes two specialized implementations:

### HTTP Error Middleware

- ✅ **Extends BaseMiddleware**: HTTP-specific error handling
- ✅ **Framework Independence**: Works with any HTTP framework
- ✅ **Response Formatting**: Standardized HTTP error responses

### WebSocket Error Middleware

- ✅ **Extends BaseWebSocketMiddleware**: WebSocket-specific error handling
- ✅ **Message-Based**: Error responses as WebSocket messages
- ✅ **Connection Context**: Connection-aware error handling

### Shared Features

- ✅ **Immutable Configuration**: Per-route config with `withConfig()`
- ✅ **Production Ready**: Comprehensive monitoring and error sanitization
- ✅ **Direct Instantiation**: No dependency injection required
- ✅ **Environment Presets**: Development, production, minimal, and audit configs

## Quick Start

### 1. Basic Usage

```typescript
import { ErrorMiddleware, createErrorMiddleware } from "@libs/middleware/error";
import { MetricsCollector } from "@libs/monitoring";

// Using factory function (recommended)
const metrics = new MetricsCollector();
const errorMiddleware = createErrorMiddleware(metrics, {
  includeStackTrace: process.env.NODE_ENV === "development",
  logErrors: true,
});

// Get middleware function
const middlewareFunction = errorMiddleware.middleware();

// Use with any HTTP framework
app.use(middlewareFunction);
```

### 2. Direct Instantiation

```typescript
import { ErrorMiddleware, type ErrorConfig } from "@libs/middleware/error";
import { MetricsCollector } from "@libs/monitoring";

const metrics = new MetricsCollector();

const config: ErrorConfig = {
  name: "global-error-handler",
  enabled: true,
  priority: 1000, // High priority to catch errors early
  includeStackTrace: false,
  logErrors: true,
  customErrorMessages: {
    ValidationError: "Invalid request data",
    AuthenticationError: "Authentication required",
  },
  sensitiveFields: ["password", "token", "apiKey"],
};

const errorMiddleware = new ErrorMiddleware(metrics, config);
```

### 3. Framework Integration with Adapters

```typescript
import { ElysiaMiddlewareAdapter } from "@libs/middleware/adapters";
import { Elysia } from "elysia";

// Create error middleware
const errorMiddleware = createErrorMiddleware(metrics);

// Use adapter for Elysia integration
const adapter = new ElysiaMiddlewareAdapter(errorMiddleware);

const app = new Elysia()
  .use(adapter.plugin())
  .get("/", () => ({ message: "Hello World" }));
```

### 4. Per-Route Configuration

```typescript
// Base error middleware
const baseErrorMiddleware = createErrorMiddleware(metrics, {
  includeStackTrace: false,
  logErrors: true,
});

// Development route with stack traces
const devErrorMiddleware = baseErrorMiddleware.withConfig({
  includeStackTrace: true,
  customErrorMessages: {
    ValidationError: "Development: Validation failed with details",
  },
});

// Public API with minimal error info
const publicErrorMiddleware = baseErrorMiddleware.withConfig({
  includeStackTrace: false,
  customErrorMessages: {
    ValidationError: "Invalid request",
    AuthenticationError: "Access denied",
  },
});

// Use different configs for different routes
app.use("/dev/*", devErrorMiddleware.middleware());
app.use("/api/public/*", publicErrorMiddleware.middleware());
```

### 5. Chain Integration

```typescript
import { MiddlewareChain } from "@libs/middleware";

const errorChain = new MiddlewareChain(metrics, {
  name: "error-handling-chain",
  middlewares: [
    {
      name: "error-handler",
      middleware: errorMiddleware.middleware(),
      priority: 1000, // Highest priority
      enabled: true,
    },
    {
      name: "auth",
      middleware: authMiddleware.middleware(),
      priority: 500,
      enabled: true,
    },
    {
      name: "rate-limit",
      middleware: rateLimitMiddleware.middleware(),
      priority: 400,
      enabled: true,
    },
  ],
});

app.use(errorChain.execute());
```

## Configuration Options

### ErrorConfig Interface

```typescript
interface ErrorConfig extends HttpMiddlewareConfig {
  readonly includeStackTrace?: boolean; // Include stack traces in responses
  readonly logErrors?: boolean; // Enable error logging
  readonly customErrorMessages?: Record<string, string>; // Custom error messages
  readonly sensitiveFields?: readonly string[]; // Fields to sanitize
}
```

### Preset Configurations

```typescript
// Development configuration
const devConfig = ErrorMiddleware.createDevelopmentConfig();
const devErrorMiddleware = createErrorMiddleware(metrics, {
  name: "dev-error-handler",
  enabled: true,
  priority: 1000,
  ...devConfig,
});

// Production configuration
const prodConfig = ErrorMiddleware.createProductionConfig();
const prodErrorMiddleware = createErrorMiddleware(metrics, {
  name: "prod-error-handler",
  enabled: true,
  priority: 1000,
  ...prodConfig,
});

// Minimal configuration for performance
const minimalConfig = ErrorMiddleware.createMinimalConfig();
const minimalErrorMiddleware = createErrorMiddleware(metrics, {
  name: "minimal-error-handler",
  enabled: true,
  priority: 1000,
  ...minimalConfig,
});

// Audit configuration for compliance
const auditConfig = ErrorMiddleware.createAuditConfig();
const auditErrorMiddleware = createErrorMiddleware(metrics, {
  name: "audit-error-handler",
  enabled: true,
  priority: 1000,
  ...auditConfig,
});
```

## Error Response Format

```typescript
interface ErrorResponse {
  success: false;
  error: string; // Error type (ValidationError, AuthenticationError, etc.)
  message: string; // User-friendly message
  timestamp: string; // ISO timestamp
  requestId?: string; // Request correlation ID
  statusCode?: number; // HTTP status code
  details?: any; // Additional error details (sanitized)
  stackTrace?: string; // Stack trace (if enabled)
}
```

### Example Error Responses

```json
// Production error response
{
  "success": false,
  "error": "ValidationError",
  "message": "Invalid request data",
  "timestamp": "2025-09-07T10:30:00.000Z",
  "requestId": "req_abc123",
  "statusCode": 400
}

// Development error response with stack trace
{
  "success": false,
  "error": "DatabaseError",
  "message": "Database connection failed",
  "timestamp": "2025-09-07T10:30:00.000Z",
  "requestId": "req_abc123",
  "statusCode": 500,
  "details": {
    "host": "[REDACTED]",
    "database": "users"
  },
  "stackTrace": "Error: Connection failed\n    at Database.connect..."
}
```

## Custom Error Creation

The ErrorMiddleware provides static methods for creating custom errors:

```typescript
// Validation error with details
const validationError = ErrorMiddleware.createValidationError(
  "Invalid email format",
  { field: "email", received: "not-an-email" }
);

// Authentication error
const authError = ErrorMiddleware.createAuthenticationError();

// Authorization error
const authzError = ErrorMiddleware.createAuthorizationError(
  "Insufficient permissions"
);

// Not found error
const notFoundError = ErrorMiddleware.createNotFoundError("User not found");

// Rate limit error
const rateLimitError = ErrorMiddleware.createRateLimitError();

// Throw custom errors
throw validationError;
```

## Utility Methods

### Direct Error Handling

```typescript
// Handle specific errors
const errorResponse = await errorMiddleware.createErrorResponse(
  new Error("Something went wrong"),
  context
);

// Handle async operations
const result = await errorMiddleware.handleAsyncError(
  riskyAsyncOperation(),
  context
);

// Wrap functions with error handling
const safeFunction = errorMiddleware.wrapWithErrorHandling(
  async (data: any) => {
    // Risky operation
    return await processData(data);
  }
);
```

## Security Features

### Automatic Sanitization

The ErrorMiddleware automatically sanitizes:

- **File paths**: Replaced with `[FILE_PATH]`
- **Credentials**: Patterns like `password=secret` become `[CREDENTIALS]`
- **Email addresses**: Replaced with `[EMAIL]`
- **Sensitive fields**: Configurable field patterns become `[REDACTED]`

### Example Sanitization

```typescript
// Before sanitization
const error = new Error("Connection failed: postgres://user:password@localhost:5432/db");
error.details = {
  password: "secret123",
  apiKey: "key_abc123",
  email: "user@example.com",
  userId: 12345
};

// After sanitization
{
  "error": "DatabaseError",
  "message": "Connection failed: [CREDENTIALS]",
  "details": {
    "password": "[REDACTED]",
    "apiKey": "[REDACTED]",
    "email": "[EMAIL]",
    "userId": 12345
  }
}
```

## Monitoring and Metrics

The ErrorMiddleware automatically records:

### Error Metrics

- `error_handled` - Counter of handled errors by type and status code
- `error_handler_duration` - Execution time of error handling

### Error Logging

- **Server errors (5xx)**: Logged as `error` level with full context
- **Client errors (4xx)**: Logged as `warn` level with request context
- **Other errors**: Logged as `info` level

### Log Context

```json
{
  "requestId": "req_abc123",
  "errorType": "ValidationError",
  "errorMessage": "Invalid email format",
  "statusCode": 400,
  "timestamp": "2025-09-07T10:30:00.000Z",
  "method": "POST",
  "url": "/api/users",
  "userAgent": "Mozilla/5.0...",
  "ip": "192.168.1.100"
}
```

## Best Practices

### 1. Chain Positioning

Position error middleware early in the chain with high priority:

```typescript
const chain = new MiddlewareChain(metrics, {
  name: "api-chain",
  middlewares: [
    {
      name: "error-handler",
      middleware: errorMiddleware.middleware(),
      priority: 1000,
    },
    { name: "cors", middleware: corsMiddleware.middleware(), priority: 900 },
    { name: "auth", middleware: authMiddleware.middleware(), priority: 800 },
    // ... other middleware
  ],
});
```

### 2. Environment-Specific Configuration

```typescript
const createErrorMiddlewareForEnv = (
  env: string,
  metrics: IMetricsCollector
) => {
  const configs = {
    development: ErrorMiddleware.createDevelopmentConfig(),
    staging: ErrorMiddleware.createAuditConfig(),
    production: ErrorMiddleware.createProductionConfig(),
  };

  return createErrorMiddleware(metrics, {
    name: `${env}-error-handler`,
    enabled: true,
    priority: 1000,
    ...(configs[env as keyof typeof configs] || configs.production),
  });
};
```

### 3. Custom Error Types

```typescript
// Define custom error types for your domain
class BusinessLogicError extends Error {
  constructor(message: string, public readonly businessCode: string) {
    super(message);
    this.name = "BusinessLogicError";
  }
}

// Configure custom messages
const errorMiddleware = createErrorMiddleware(metrics, {
  customErrorMessages: {
    BusinessLogicError: "Business rule violation",
    ValidationError: "Invalid input provided",
  },
});
```

### 4. Testing

```typescript
describe("ErrorMiddleware", () => {
  let errorMiddleware: ErrorMiddleware;
  let mockMetrics: jest.Mocked<IMetricsCollector>;

  beforeEach(() => {
    mockMetrics = createMockMetrics();
    errorMiddleware = createErrorMiddleware(mockMetrics, {
      includeStackTrace: false,
      logErrors: false, // Disable logging in tests
    });
  });

  it("should handle validation errors", async () => {
    const error = ErrorMiddleware.createValidationError("Test error");
    const context = createMockContext();

    const response = await errorMiddleware.createErrorResponse(error, context);

    expect(response.success).toBe(false);
    expect(response.error).toBe("ValidationError");
    expect(response.statusCode).toBe(400);
  });
});
```

## WebSocket Error Handling

### WebSocket Error Middleware

For WebSocket connections, use the specialized `WebSocketErrorMiddleware`:

```typescript
import {
  WebSocketErrorMiddleware,
  createWebSocketErrorMiddleware,
  type WebSocketErrorMiddlewareConfig,
} from "@libs/middleware";

// Create WebSocket error middleware
const wsErrorMiddleware = createWebSocketErrorMiddleware(metrics, {
  includeStackTrace: process.env.NODE_ENV === "development",
  logErrors: true,
  errorResponseType: "error", // Message type for error responses
  customErrorMessages: {
    WebSocketValidationError: "Invalid message format",
    WebSocketAuthenticationError: "Authentication required",
    WebSocketAuthorizationError: "Access denied",
    WebSocketConnectionError: "Connection error",
    WebSocketRateLimitError: "Rate limit exceeded",
  },
  sensitiveFields: ["password", "token", "apiKey", "secret"],
  skipMessageTypes: ["ping", "pong"], // Skip error handling for heartbeat messages
});

// Get WebSocket middleware function
const wsMiddlewareFunction = wsErrorMiddleware.middleware();
```

### WebSocket Chain Integration

```typescript
import { WebSocketMiddlewareChain } from "@libs/middleware";

const wsChain = new WebSocketMiddlewareChain(metrics, "websocket-error-chain");

// Register error middleware with highest priority
wsChain.register(
  {
    name: "error-handler",
    priority: 1000,
    enabled: true,
  },
  wsErrorMiddleware.middleware()
);

// Register other middleware
wsChain.register(
  {
    name: "auth",
    priority: 900,
    enabled: true,
  },
  wsAuthMiddleware.middleware()
);

const chainExecutor = wsChain.createExecutor();
```

### WebSocket Error Response Format

WebSocket error responses are sent as messages:

```json
{
  "type": "error",
  "success": false,
  "error": "WebSocketValidationError",
  "message": "Invalid message format",
  "timestamp": "2025-09-07T10:30:00.000Z",
  "connectionId": "conn_123",
  "details": {
    "messageType": "subscribe",
    "reason": "missing channel"
  }
}
```

### Custom WebSocket Errors

```typescript
// Create custom WebSocket errors
const validationError = WebSocketErrorMiddleware.createWebSocketValidationError(
  "Invalid message format",
  { messageType: "subscribe", reason: "missing channel" }
);

const authError = WebSocketErrorMiddleware.createWebSocketAuthenticationError();
const connectionError =
  WebSocketErrorMiddleware.createWebSocketConnectionError();
const rateLimitError = WebSocketErrorMiddleware.createWebSocketRateLimitError();

// Throw in WebSocket handlers
throw validationError;
```

### WebSocket Per-Connection Configuration

```typescript
const baseWsErrorMiddleware = createWebSocketErrorMiddleware(
  metrics,
  baseConfig
);

// Admin connections with detailed errors
const adminWsErrorMiddleware = baseWsErrorMiddleware.withConfig({
  includeStackTrace: true,
  customErrorMessages: {
    WebSocketValidationError: "Admin: Detailed validation error",
  },
});

// Public connections with minimal errors
const publicWsErrorMiddleware = baseWsErrorMiddleware.withConfig({
  includeStackTrace: false,
  customErrorMessages: {
    WebSocketValidationError: "Invalid message",
    WebSocketAuthenticationError: "Access denied",
  },
});
```

### WebSocket Environment Presets

```typescript
// Development preset
const devWsConfig = WebSocketErrorMiddleware.createDevelopmentConfig();
const devWsErrorHandler = createWebSocketErrorMiddleware(metrics, {
  name: "dev-ws-error-handler",
  enabled: true,
  priority: 1000,
  ...devWsConfig,
});

// Production preset
const prodWsConfig = WebSocketErrorMiddleware.createProductionConfig();
const prodWsErrorHandler = createWebSocketErrorMiddleware(metrics, {
  name: "prod-ws-error-handler",
  enabled: true,
  priority: 1000,
  ...prodWsConfig,
});
```

For more WebSocket examples, see [websocket-examples.md](./websocket-examples.md).

## Migration from Legacy ErrorMiddleware

### Old Pattern

```typescript
// OLD: Direct Elysia integration
const logger = new Logger({ service: "Error" });
const errorMiddleware = new ErrorMiddleware(logger);
app.use(errorMiddleware.elysia(config));
```

### New Pattern

```typescript
// NEW: AbstractMiddleware pattern with adapter
const metrics = new MetricsCollector();
const errorMiddleware = createErrorMiddleware(metrics, config);
const adapter = new ElysiaMiddlewareAdapter(errorMiddleware);
app.use(adapter.plugin());

// Or framework-agnostic
app.use(errorMiddleware.middleware());
```

The updated ErrorMiddleware provides all the same functionality with improved architecture, better type safety, and framework independence while maintaining excellent error handling capabilities.
