# Security Middleware - BaseMiddleware Implementation Update

## Summary

Successfully updated the `SecurityMiddleware` to follow the new `BaseMiddleware` pattern, maintaining all existing security header functionality while improving architecture and consistency.

## 🔧 Changes Made

### 1. Extended BaseMiddleware

- **Before**: Standalone class with custom implementation
- **After**: Extends `BaseMiddleware<SecurityConfig>` for consistent behavior
- **Impact**: Inherits all BaseMiddleware features (skip paths, error handling, metrics, etc.)

```typescript
// Before
export class SecurityMiddleware {
  constructor(private config: SecurityConfig = {}) {}

// After
export class SecurityMiddleware extends BaseMiddleware<SecurityConfig> {
  constructor(
    @inject("ILogger") logger: ILogger,
    @inject("IMetricsCollector") metrics: IMetricsCollector,
    config: SecurityConfig
  ) {
    super(logger, metrics, config, "security");
  }
```

### 2. Updated Configuration Interface

- **Before**: Plain interface without middleware options
- **After**: Extends `MiddlewareOptions` for consistency
- **Impact**: Supports enabled/disabled, skip paths, priority, and other standard options

```typescript
// Before
export interface SecurityConfig {
  contentSecurityPolicy?: { ... };

// After
export interface SecurityConfig extends MiddlewareOptions {
  contentSecurityPolicy?: { ... };
```

### 3. Implemented Execute Method

- **New**: Implements required `execute()` method from BaseMiddleware
- **Purpose**: Handles middleware execution flow with proper error handling
- **Benefits**: Consistent execution pattern across all middlewares

```typescript
protected override async execute(
  context: MiddlewareContext,
  next: () => Promise<void>
): Promise<void> {
  const startTime = performance.now();

  try {
    await this.setSecurityHeaders(context);
    await this.recordMetric("security_headers_applied");
    await next();
  } catch (error) {
    // Proper error handling with metrics and logging
  } finally {
    await this.recordTimer("security_middleware_duration", performance.now() - startTime);
  }
}
```

### 4. Added createInstance Method

- **New**: Implements `createInstance()` for configuration isolation
- **Purpose**: Allows creating new instances with different configurations
- **Benefits**: Better testing and per-route configuration support

### 5. Dependency Injection Pattern

- **Before**: No dependency injection
- **After**: Proper DI with logger and metrics
- **Impact**: Better testability and consistency with other middlewares

### 6. Enhanced Factory Methods

- **Before**: Single factory function
- **After**: Multiple factory methods for different environments
- **Impact**: Better developer experience with preset configurations

## ✅ Preserved Functionality

All original security features remain intact:

- ✅ Content Security Policy (CSP) with configurable directives
- ✅ HTTP Strict Transport Security (HSTS)
- ✅ X-Frame-Options protection
- ✅ X-Content-Type-Options (nosniff)
- ✅ X-XSS-Protection with modes
- ✅ Referrer Policy configuration
- ✅ Permissions Policy for modern browsers
- ✅ Custom headers support
- ✅ Server signature removal
- ✅ Environment-specific presets (dev, prod, api, strict)

## 🏗️ Architecture Benefits

### Consistent Middleware Pattern

```typescript
// All middlewares now follow the same pattern
const securityMiddleware = new SecurityMiddleware(logger, metrics, config);
const rateLimitMiddleware = new RateLimitMiddleware(
  logger,
  metrics,
  redis,
  config
);
const keycloakMiddleware = await createKeycloakMiddleware(
  logger,
  metrics,
  redis,
  config
);

// Consistent usage
app.use(securityMiddleware.elysia());
app.use(rateLimitMiddleware.elysia());
app.use(keycloakMiddleware.elysia());
```

### Built-in Error Handling and Metrics

- ✅ Automatic error logging with context
- ✅ Performance metrics collection
- ✅ Request tracing and debugging
- ✅ Skip paths functionality (inherited)

### Better Testing Support

```typescript
// Mockable dependencies
const mockLogger = jest.mocked(logger);
const mockMetrics = jest.mocked(metrics);

const middleware = new SecurityMiddleware(mockLogger, mockMetrics, config);

// Testable execution
const context = createMockContext();
await middleware.execute(context, mockNext);

expect(mockMetrics.recordMetric).toHaveBeenCalledWith(
  "security_headers_applied"
);
```

## 📊 Usage Examples

### Environment-Specific Factory Methods

```typescript
// Development - relaxed security for easier debugging
const devSecurity = SecurityMiddleware.createDevelopment(logger, metrics, {
  customHeaders: { "X-Environment": "development" },
});

// Production - strict security headers
const prodSecurity = SecurityMiddleware.createProduction(logger, metrics);

// API - optimized for API endpoints
const apiSecurity = SecurityMiddleware.createApi(logger, metrics);

// Strict - maximum security for sensitive applications
const strictSecurity = SecurityMiddleware.createStrict(logger, metrics);
```

### Custom Configuration

```typescript
const customSecurity = new SecurityMiddleware(logger, metrics, {
  name: "custom-security",
  enabled: true,
  skipPaths: ["/health", "/metrics"],
  contentSecurityPolicy: {
    enabled: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "https://cdn.example.com"],
      "style-src": ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: {
    enabled: true,
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  customHeaders: {
    "X-Custom-Header": "MyValue",
    "Cache-Control": "no-store",
  },
});

// Use with Elysia
app.use(customSecurity.elysia());
```

### Per-Route Configuration

```typescript
// Different security for different routes
const apiRoutes = customSecurity.elysia({
  contentSecurityPolicy: { enabled: false }, // APIs don't need CSP
  customHeaders: { "Cache-Control": "no-store" },
});

const webRoutes = customSecurity.elysia({
  contentSecurityPolicy: { enabled: true },
  frameOptions: "SAMEORIGIN",
});

app.group("/api", (app) => app.use(apiRoutes));
app.group("/web", (app) => app.use(webRoutes));
```

## 🔍 Headers Applied

The middleware applies the following security headers based on configuration:

### Core Security Headers

- `Content-Security-Policy` - Prevents XSS and injection attacks
- `Strict-Transport-Security` - Enforces HTTPS connections
- `X-Frame-Options` - Prevents clickjacking attacks
- `X-Content-Type-Options` - Prevents MIME type sniffing
- `X-XSS-Protection` - Browser XSS protection
- `Referrer-Policy` - Controls referrer information

### Modern Security Headers

- `Permissions-Policy` - Controls browser feature access
- Custom headers for application-specific needs

### Server Hardening

- Removes `X-Powered-By` header
- Removes `Server` header

## 📈 Monitoring and Debugging

### Built-in Metrics

```typescript
// Automatic metrics collection
security_headers_applied_total; // Headers successfully applied
security_middleware_duration; // Execution time
security_middleware_error_duration; // Error handling time
```

### Debug Logging

```typescript
// Detailed logging for troubleshooting
this.logger.debug("Security headers applied", {
  path: context.request.url,
  headersCount: Object.keys(set.headers).length,
  requestId: context.requestId,
});
```

## 🧪 Testing Improvements

### Unit Testing

```typescript
describe("SecurityMiddleware", () => {
  let middleware: SecurityMiddleware;
  let mockLogger: jest.Mocked<ILogger>;
  let mockMetrics: jest.Mocked<IMetricsCollector>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockMetrics = createMockMetrics();
    middleware = new SecurityMiddleware(mockLogger, mockMetrics, testConfig);
  });

  it("should apply security headers", async () => {
    const context = createMockContext();
    const next = jest.fn();

    await middleware.execute(context, next);

    expect(context.set.headers["X-Frame-Options"]).toBe("DENY");
    expect(context.set.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(mockMetrics.recordMetric).toHaveBeenCalledWith(
      "security_headers_applied"
    );
  });
});
```

### Integration Testing

```typescript
// Test with real Elysia app
const app = new Elysia()
  .use(SecurityMiddleware.createProduction(logger, metrics).elysia())
  .get("/", () => "Hello");

const response = await app.handle(new Request("http://localhost/"));
expect(response.headers.get("X-Frame-Options")).toBe("DENY");
```

## 🎯 Migration Guide

### For Existing Code

1. **Update Constructor**: Add logger and metrics parameters
2. **Update Factory Usage**: Use new factory methods or update function signature
3. **Configuration**: No changes needed - all existing config options work
4. **Elysia Integration**: No changes - `.elysia()` method still works

### Breaking Changes

- ✅ **Constructor signature changed** (internal usage)
- ✅ **Factory function signature changed** (better DI support)
- ✅ **All public APIs preserved** for backward compatibility

## ✅ Validation

- ✅ All TypeScript compilation errors resolved
- ✅ All existing functionality preserved
- ✅ Proper inheritance from BaseMiddleware
- ✅ Consistent architecture with other middlewares
- ✅ Better testability and maintainability
- ✅ Industry-standard security headers
- ✅ OWASP recommended configurations

The SecurityMiddleware now follows the same high-quality patterns as other middlewares while maintaining its comprehensive security header functionality and OWASP compliance!
