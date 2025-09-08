# Logging Middleware Suite

Production-grade logging middleware for comprehensive HTTP request/response and WebSocket connection/message tracking with configurable security controls and performance optimization.

## Overview

The Logging Middleware Suite provides enterprise-level HTTP and WebSocket logging capabilities following the AbstractMiddleware architecture pattern. It offers comprehensive data capture, security sanitization, and performance optimization for production environments.

### Available Middleware

- **HTTP Logging Middleware**: Request/response logging for REST APIs and HTTP services
- **WebSocket Logging Middleware**: Connection lifecycle and message logging for real-time applications

## Features

- **Framework-Agnostic**: Pure TypeScript implementation following AbstractMiddleware patterns
- **Dual Protocol Support**: Both HTTP and WebSocket logging capabilities
- **Comprehensive Logging**: Request/response data capture with configurable detail levels
- **Security-First**: Built-in PII protection and sensitive data sanitization
- **Performance Optimized**: Minimal overhead with configurable content size limits
- **Request Correlation**: Automatic request ID generation and tracking
- **Configurable Exclusions**: Path and header filtering capabilities
- **Multiple Presets**: Environment-specific configurations (dev, prod, audit, minimal)

## Architecture Compliance

✅ **Extends BaseMiddleware**: Proper inheritance from AbstractMiddleware architecture
✅ **Immutable Configuration**: Readonly configuration with proper defaults
✅ **Direct Instantiation**: No dependency injection complexity
✅ **Framework Agnostic**: Returns generic middleware functions
✅ **Type Safety**: Full TypeScript strict mode compliance
✅ **Error Handling**: Comprehensive error boundaries and propagation
✅ **Metrics Integration**: Built-in performance and usage metrics

## Quick Start

### HTTP Logging

```typescript
import {
  createLoggingMiddleware,
  LOGGING_PRESETS,
} from "@libs/middleware/logging";

const httpLogging = createLoggingMiddleware(
  metrics,
  LOGGING_PRESETS.production()
);
```

### WebSocket Logging

```typescript
import {
  createWebSocketLoggingMiddleware,
  WEBSOCKET_LOGGING_PRESETS,
} from "@libs/middleware/logging";

const wsLogging = createWebSocketLoggingMiddleware(
  metrics,
  WEBSOCKET_LOGGING_PRESETS.production()
);
```

## Installation

```bash
# Install from middleware module
import {
  LoggingMiddleware,
  createLoggingMiddleware,
  LOGGING_PRESETS,
  WebSocketLoggingMiddleware,
  createWebSocketLoggingMiddleware,
  WEBSOCKET_LOGGING_PRESETS
} from "@libs/middleware/logging";
```

## HTTP Logging Usage

### Direct Instantiation

```typescript
import { MetricsCollector } from "@libs/monitoring";
import { LoggingMiddleware } from "@libs/middleware/logging";

const metrics = new MetricsCollector();
const loggingMiddleware = new LoggingMiddleware(metrics, {
  logLevel: "info",
  logRequestBody: false,
  logResponseBody: false,
  excludePaths: ["/health", "/metrics"],
});

// Use in your application
const middlewareFunction = loggingMiddleware.getMiddleware();
```

### Factory Function

```typescript
import { createLoggingMiddleware } from "@libs/middleware/logging";

const loggingMiddleware = createLoggingMiddleware(metrics, {
  logLevel: "debug",
  logRequestBody: true,
  logHeaders: true,
});
```

### Environment Presets

```typescript
import { LOGGING_PRESETS } from "@libs/middleware/logging";

// Development environment
const devLogging = createLoggingMiddleware(
  metrics,
  LOGGING_PRESETS.development()
);

// Production environment
const prodLogging = createLoggingMiddleware(
  metrics,
  LOGGING_PRESETS.production()
);

// Audit logging
const auditLogging = createLoggingMiddleware(metrics, LOGGING_PRESETS.audit());
```

## Configuration

### LoggingConfig Interface

```typescript
interface LoggingConfig extends HttpMiddlewareConfig {
  readonly logLevel?: "debug" | "info" | "warn" | "error";
  readonly logRequestBody?: boolean;
  readonly logResponseBody?: boolean;
  readonly logHeaders?: boolean;
  readonly excludePaths?: readonly string[];
  readonly excludeHeaders?: readonly string[];
  readonly maxBodySize?: number;
  readonly sensitiveFields?: readonly string[];
  readonly includeRequestTiming?: boolean;
  readonly includeUserAgent?: boolean;
  readonly includeClientIp?: boolean;
}
```

### Configuration Options

| Option                 | Type       | Default                                                  | Description                      |
| ---------------------- | ---------- | -------------------------------------------------------- | -------------------------------- |
| `logLevel`             | `string`   | `"info"`                                                 | Minimum log level for output     |
| `logRequestBody`       | `boolean`  | `false`                                                  | Include request body in logs     |
| `logResponseBody`      | `boolean`  | `false`                                                  | Include response body in logs    |
| `logHeaders`           | `boolean`  | `false`                                                  | Include headers in logs          |
| `excludePaths`         | `string[]` | `["/health", "/favicon.ico", "/metrics"]`                | Paths to exclude from logging    |
| `excludeHeaders`       | `string[]` | `["authorization", "cookie", "set-cookie", "x-api-key"]` | Headers to redact                |
| `maxBodySize`          | `number`   | `10240`                                                  | Maximum body size to log (bytes) |
| `sensitiveFields`      | `string[]` | `["password", "token", "secret", "key", "auth", "jwt"]`  | Fields to redact                 |
| `includeRequestTiming` | `boolean`  | `true`                                                   | Include response time metrics    |
| `includeUserAgent`     | `boolean`  | `true`                                                   | Include User-Agent header        |
| `includeClientIp`      | `boolean`  | `true`                                                   | Include client IP address        |

## Preset Configurations

### Development Preset

```typescript
LOGGING_PRESETS.development();
// - Debug level logging
// - Full request/response bodies
// - All headers included
// - 50KB body size limit
```

### Production Preset

```typescript
LOGGING_PRESETS.production();
// - Info level logging
// - No request/response bodies
// - No headers
// - 5KB body size limit
// - Enhanced path exclusions
```

### Audit Preset

```typescript
LOGGING_PRESETS.audit();
// - Complete data capture
// - 100KB body size limit
// - All paths logged
// - Comprehensive tracking
```

### Minimal Preset

```typescript
LOGGING_PRESETS.minimal();
// - Warning level only
// - No bodies or headers
// - Maximum path exclusions
// - 1KB size limit
```

## Security Features

### Data Sanitization

The middleware automatically sanitizes sensitive data:

- **Sensitive Fields**: Redacts fields matching configured patterns
- **Header Protection**: Removes authentication and security headers
- **URL Sanitization**: Redacts sensitive query parameters
- **Body Filtering**: Deep sanitization of request/response bodies

### PII Protection

Built-in protection for personally identifiable information:

```typescript
const config = {
  sensitiveFields: [
    "password",
    "token",
    "secret",
    "key",
    "auth",
    "jwt",
    "ssn",
    "email",
    "phone",
    "credit_card",
    "account",
  ],
  excludeHeaders: [
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-session-id",
  ],
};
```

## Log Format

### Request Log

```json
{
  "requestId": "req_1643723400000_abc123",
  "method": "POST",
  "url": "/api/users",
  "userAgent": "Mozilla/5.0...",
  "ip": "192.168.1.100",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "headers": {
    "content-type": "application/json",
    "authorization": "[REDACTED]"
  },
  "body": {
    "username": "john_doe",
    "password": "[REDACTED]"
  },
  "query": {},
  "params": { "id": "123" }
}
```

### Response Log

```json
{
  "requestId": "req_1643723400000_abc123",
  "statusCode": 201,
  "responseTime": 245,
  "contentLength": 156,
  "headers": {
    "content-type": "application/json"
  },
  "body": {
    "id": "456",
    "username": "john_doe",
    "token": "[REDACTED]"
  }
}
```

### Error Log

```json
{
  "requestId": "req_1643723400000_abc123",
  "statusCode": 500,
  "responseTime": 1234,
  "error": "Database connection timeout",
  "contentLength": 89
}
```

## Performance Considerations

### Optimization Features

- **Conditional Logging**: Path exclusion to reduce noise
- **Size Limits**: Configurable body size limits to prevent memory issues
- **Lazy Evaluation**: Data serialization only when needed
- **Metrics Integration**: Performance tracking for optimization

### Performance Metrics

The middleware tracks:

- `logging_execution_time`: Time spent in logging operations
- `logging_request_logged`: Count of logged requests
- `logging_error_logged`: Count of logged errors

### Best Practices

1. **Production Tuning**: Use production preset for optimal performance
2. **Size Limits**: Set appropriate body size limits for your use case
3. **Path Exclusions**: Exclude high-frequency health check endpoints
4. **Log Level**: Use appropriate log levels for different environments

## Integration Examples

### Express.js Integration

```typescript
import express from "express";
import {
  createLoggingMiddleware,
  LOGGING_PRESETS,
} from "@libs/middleware/logging";

const app = express();
const loggingMiddleware = createLoggingMiddleware(
  metrics,
  LOGGING_PRESETS.production()
);

// Apply logging middleware
app.use(loggingMiddleware.getMiddleware());
```

### Elysia Integration

```typescript
import { Elysia } from "elysia";
import { createLoggingMiddleware } from "@libs/middleware/logging";

const app = new Elysia();
const loggingMiddleware = createLoggingMiddleware(metrics, {
  logLevel: "info",
  logRequestBody: true,
});

app.use(loggingMiddleware.getElysiaMiddleware());
```

### NestJS Integration

```typescript
import { Injectable, NestMiddleware } from "@nestjs/common";
import { createLoggingMiddleware } from "@libs/middleware/logging";

@Injectable()
export class LoggingNestMiddleware implements NestMiddleware {
  private loggingMiddleware = createLoggingMiddleware(
    metrics,
    LOGGING_PRESETS.development()
  );

  use(req: Request, res: Response, next: NextFunction) {
    return this.loggingMiddleware.getMiddleware()(req, res, next);
  }
}
```

## Monitoring and Observability

### Structured Logging

All logs are structured JSON for easy parsing:

```typescript
// Request logs use consistent structure
logger.info("Incoming request", {
  requestId: "req_...",
  method: "GET",
  url: "/api/users",
  // ... additional fields
});

// Response logs include timing
logger.info("Outgoing response", {
  requestId: "req_...",
  statusCode: 200,
  responseTime: 123,
  // ... additional fields
});
```

### Request Correlation

Every request gets a unique ID for tracing:

- Added to request headers as `x-request-id`
- Included in all related log entries
- Useful for distributed tracing

### Error Tracking

Errors are comprehensively logged:

- Full error context
- Request correlation
- Response timing
- Stack traces (in development)

## Troubleshooting

### Common Issues

1. **High Memory Usage**: Reduce `maxBodySize` or disable body logging
2. **Performance Impact**: Use production preset and exclude high-frequency paths
3. **Sensitive Data Exposure**: Verify `sensitiveFields` and `excludeHeaders` configuration

### Debug Mode

Enable debug logging for troubleshooting:

```typescript
const debugLogging = createLoggingMiddleware(metrics, {
  logLevel: "debug",
  logRequestBody: true,
  logResponseBody: true,
  logHeaders: true,
});
```

## Migration Guide

### From Previous Implementations

1. **Constructor Changes**: Now requires `Partial<LoggingConfig>` instead of full config
2. **Method Removal**: Framework-specific methods removed
3. **Configuration**: New readonly configuration structure
4. **Factory Functions**: Use `createLoggingMiddleware` for easier instantiation

### Update Example

```typescript
// Old implementation
const logging = new LoggingMiddleware(metrics, fullConfig);
app.use(logging.middleware());

// New implementation
const logging = createLoggingMiddleware(metrics, partialConfig);
app.use(logging.getMiddleware());
```

## Contributing

When contributing to the logging middleware:

1. Maintain AbstractMiddleware compliance
2. Ensure comprehensive test coverage
3. Update documentation for new features
4. Follow security-first principles
5. Optimize for performance

## WebSocket Logging

For comprehensive WebSocket connection and message logging, see the dedicated WebSocket Logging Middleware:

### Quick Start

```typescript
import {
  createWebSocketLoggingMiddleware,
  WEBSOCKET_LOGGING_PRESETS,
} from "@libs/middleware/logging";

const wsLogging = createWebSocketLoggingMiddleware(
  metrics,
  WEBSOCKET_LOGGING_PRESETS.production()
);

// Log connections
await wsLogging.logConnection(context);

// Apply middleware to messages
await wsLogging.middleware()(context, next);

// Log disconnections
await wsLogging.logDisconnection(context, reason);
```

### Features

- Connection lifecycle tracking (connect/disconnect)
- Bidirectional message logging (incoming/outgoing)
- Real-time connection metrics
- Message type filtering
- Payload sanitization
- Performance optimization

### Documentation

See [WEBSOCKET_README.md](./WEBSOCKET_README.md) for complete WebSocket logging documentation.

## License

Part of the enterprise middleware suite. See main project license.
