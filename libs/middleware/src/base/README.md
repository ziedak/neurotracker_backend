# Enhanced BaseMiddleware for Elysia

A production-grade base class for creating Elysia middleware with standardized patterns, comprehensive error handling, and metrics integration.

## Features

- **Framework Abstraction**: Works with Elysia while maintaining framework-agnostic patterns
- **Multiple Integration Patterns**: Simple plugins, advanced plugins with decorators, and framework-agnostic middleware functions
- **Built-in Monitoring**: Integrated logging and metrics collection
- **Production-Ready**: Error handling, security utilities, and performance optimization
- **TypeScript Strict Mode**: Full type safety and modern TypeScript patterns
- **Clean Architecture**: Follows SOLID principles with clear separation of concerns

## Quick Start

### 1. Extend BaseMiddleware

```typescript
import { BaseMiddleware } from "@libs/middleware";
import {
  type MiddlewareContext,
  type MiddlewareOptions,
} from "@libs/middleware";

interface MyConfig extends MiddlewareOptions {
  customOption?: string;
  threshold?: number;
}

class MyMiddleware extends BaseMiddleware<MyConfig> {
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    // Your middleware logic here
    this.logger.info("Processing request", {
      method: context.request.method,
      path: context.request.url,
    });

    await next(); // Call downstream middleware/handlers

    // Post-processing logic
    await this.recordMetric("requests_processed");
  }

  protected override createInstance(config: MyConfig): MyMiddleware {
    return new MyMiddleware(this.logger, this.metrics, config, this.name);
  }
}
```

### 2. Use with Elysia

#### Simple Plugin Pattern

```typescript
import { Elysia } from "elysia";

const middleware = new MyMiddleware(logger, metrics, config, "my-middleware");

const app = new Elysia()
  .use(middleware.elysia()) // Simple integration
  .get("/", () => "Hello World");
```

#### Advanced Plugin Pattern with Decorators

```typescript
const app = new Elysia()
  .use(middleware.plugin()) // Advanced integration with decorators
  .get("/", ({ myMiddleware }) => {
    return {
      message: "Hello World",
      middlewareConfig: myMiddleware.config,
    };
  });
```

#### Framework-Agnostic Usage

```typescript
const middlewareFunction = middleware.middleware();
// Use with any framework that supports standard middleware functions
```

## API Reference

### BaseMiddleware Methods

#### Core Methods

##### `execute(context, next)` - **Abstract**

Must be implemented by subclasses. Contains the core middleware logic.

```typescript
protected abstract execute(
  context: MiddlewareContext,
  next: () => Promise<void>
): Promise<void>;
```

##### `elysia(config?)` - Elysia Plugin

Returns a simple Elysia plugin function.

```typescript
public elysia(config?: Partial<TConfig>): (app: Elysia) => Elysia
```

##### `plugin(config?)` - Advanced Elysia Plugin

Returns an advanced Elysia plugin with decorators and derived context.

```typescript
public plugin(config?: Partial<TConfig>): Elysia
```

##### `middleware()` - Framework-Agnostic

Returns a standard middleware function for framework-agnostic usage.

```typescript
public middleware(): MiddlewareFunction
```

#### Utility Methods

##### `shouldSkip(context)` - Path Skipping

Checks if the current request should skip this middleware based on `skipPaths` configuration.

##### `getClientIp(context)` - IP Extraction

Extracts client IP from various headers (X-Forwarded-For, X-Real-IP, etc.).

##### `getRequestId(context)` - Request ID

Generates or extracts a unique request ID for correlation.

##### `sanitizeObject(obj, sensitiveFields?)` - Security

Sanitizes objects by masking sensitive fields for safe logging.

##### `recordMetric(name, value?, tags?)` - Metrics

Records counter metrics with optional tags.

##### `recordTimer(name, duration, tags?)` - Timing Metrics

Records timing metrics for performance monitoring.

##### `recordHistogram(name, value, tags?)` - Distribution Metrics

Records histogram metrics for value distribution analysis.

## Configuration

### Base Configuration (MiddlewareOptions)

```typescript
interface MiddlewareOptions {
  enabled?: boolean; // Enable/disable middleware (default: true)
  priority?: number; // Execution priority (default: 0)
  skipPaths?: string[]; // Paths to skip (supports wildcards)
  name?: string; // Middleware name for logging
}
```

### Path Skipping Examples

```typescript
const config = {
  skipPaths: [
    "/health", // Exact match
    "/public/*", // Wildcard prefix
    "/api/v1/auth", // Exact path with prefix matching
  ],
};
```

## Examples

### Simple Request Logging Middleware

```typescript
class RequestLoggerMiddleware extends BaseMiddleware {
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ) {
    const start = Date.now();
    const requestId = this.getRequestId(context);

    this.logger.info("Request started", {
      requestId,
      method: context.request.method,
      path: context.request.url,
      ip: this.getClientIp(context),
    });

    await next();

    const duration = Date.now() - start;
    this.logger.info("Request completed", {
      requestId,
      duration,
      status: context.set.status,
    });

    await this.recordTimer("request_duration", duration);
  }
}
```

### Authentication Middleware

```typescript
interface AuthConfig extends MiddlewareOptions {
  requireAuth?: boolean;
  allowedRoles?: string[];
}

class AuthMiddleware extends BaseMiddleware<AuthConfig> {
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ) {
    const token = context.request.headers.authorization?.replace("Bearer ", "");

    if (!token && this.config.requireAuth) {
      context.set.status = 401;
      throw new Error("Authentication required");
    }

    if (token) {
      // Validate token and set user context
      context.user = await this.validateToken(token);

      if (this.config.allowedRoles) {
        const hasRole = context.user.roles?.some((role) =>
          this.config.allowedRoles!.includes(role)
        );

        if (!hasRole) {
          context.set.status = 403;
          throw new Error("Insufficient permissions");
        }
      }
    }

    await next();
  }

  private async validateToken(token: string) {
    // Token validation logic
    return { id: "user123", roles: ["user"] };
  }
}
```

### Rate Limiting Middleware

```typescript
interface RateLimitConfig extends MiddlewareOptions {
  maxRequests: number;
  windowMs: number;
  keyStrategy: "ip" | "user";
}

class RateLimitMiddleware extends BaseMiddleware<RateLimitConfig> {
  private store = new Map<string, { count: number; resetTime: number }>();

  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ) {
    const key =
      this.config.keyStrategy === "ip"
        ? this.getClientIp(context)
        : context.user?.id || "anonymous";

    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetTime) {
      this.store.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
    } else {
      entry.count++;

      if (entry.count > this.config.maxRequests) {
        context.set.status = 429;
        context.set.headers["Retry-After"] = String(
          Math.ceil((entry.resetTime - now) / 1000)
        );

        await this.recordMetric("rate_limit_exceeded", 1, { key });
        throw new Error("Rate limit exceeded");
      }
    }

    await this.recordMetric("rate_limit_check", 1, {
      key: this.config.keyStrategy,
    });

    await next();
  }
}
```

## Error Handling

The BaseMiddleware automatically handles errors and provides comprehensive logging:

```typescript
// Errors are automatically logged with context
this.logger.error("Middleware error", error, {
  requestId: context.requestId,
  path: context.request.url,
  method: context.request.method,
});

// Metrics are recorded for errors
await this.recordMetric("middleware_error", 1, {
  middleware: this.name,
  errorType: error.constructor.name,
});
```

## Best Practices

1. **Always call `await next()`** in your execute method unless you want to short-circuit the request
2. **Override `createInstance()`** for proper configuration isolation
3. **Use meaningful metric names** that follow your monitoring conventions
4. **Sanitize sensitive data** before logging using `sanitizeObject()`
5. **Handle errors gracefully** and provide meaningful error messages
6. **Test path skipping** logic with your specific route patterns
7. **Use TypeScript strict types** for configuration interfaces

## Performance Considerations

- Middleware execution is optimized for minimal overhead
- Path skipping is performed early to avoid unnecessary processing
- Metrics recording includes error handling to prevent middleware failures
- Request ID generation is cached to avoid repeated UUID generation
- IP extraction checks multiple headers in order of preference

## Migration from Legacy Middleware

If you have existing middleware, follow these steps:

1. Extract configuration into a type extending `MiddlewareOptions`
2. Move core logic to the `execute()` method
3. Replace direct Elysia integration with `elysia()` or `plugin()` methods
4. Add proper error handling and metrics recording
5. Implement `createInstance()` for config isolation

The enhanced BaseMiddleware is backward compatible and provides a clear migration path for existing middleware implementations.
