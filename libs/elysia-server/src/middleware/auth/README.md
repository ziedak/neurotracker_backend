# Authentication Middleware

Production-grade HTTP authentication middleware following AbstractMiddleware patterns. Provides comprehensive authentication and authorization with full integration to `@libs/auth` services.

## Features

- **Multi-Protocol Authentication**: JWT tokens, API keys, session-based authentication
- **Role-Based Access Control (RBAC)**: Fine-grained role and permission checking
- **CASL Ability System**: Advanced ability-based authorization
- **Framework Agnostic**: Works with any HTTP framework through AbstractMiddleware
- **Enterprise Monitoring**: Comprehensive metrics and logging integration
- **Type-Safe Configuration**: Full TypeScript support with strict typing
- **Preset Configurations**: Pre-built configurations for common use cases
- **Error Handling**: Structured error responses with detailed context

## Architecture Overview

```
AuthMiddleware (extends BaseMiddleware)
├── Authentication Methods
│   ├── JWT Token Authentication
│   ├── API Key Authentication
│   └── Session-Based Authentication
├── Authorization Checks
│   ├── Role-Based Access Control
│   ├── Permission-Based Access Control
│   └── CASL Ability Checks
├── Context Enrichment
│   ├── User Information
│   ├── Authentication Context
│   └── Request Metadata
└── Enterprise Features
    ├── Metrics Collection
    ├── Structured Logging
    └── Error Tracking
```

## Usage Examples

### Basic Usage

```typescript
import { createAuthMiddleware, AUTH_PRESETS } from "@libs/middleware/auth";
import { AuthenticationService } from "@libs/auth";
import { MetricsCollector } from "@libs/monitoring";

// Initialize dependencies
const metrics = new MetricsCollector();
const authService = new AuthenticationService(/* dependencies */);

// Create authentication middleware
const authMiddleware = createAuthMiddleware(
  metrics,
  authService,
  AUTH_PRESETS.requireAuth()
);

// Use with your HTTP framework
app.use(authMiddleware.getMiddlewareFunction());
```

### Configuration Examples

#### Required Authentication

```typescript
const authMiddleware = createAuthMiddleware(metrics, authService, {
  name: "secure-api",
  requireAuth: true,
  allowAnonymous: false,
  jwtAuth: true,
  apiKeyAuth: true,
  sessionAuth: false,
});
```

#### Role-Based Access Control

```typescript
const adminMiddleware = createAuthMiddleware(metrics, authService, {
  name: "admin-only",
  requireAuth: true,
  roles: ["admin", "super_admin"],
  allowAnonymous: false,
});
```

#### Permission-Based Access Control

```typescript
const writeMiddleware = createAuthMiddleware(metrics, authService, {
  name: "write-access",
  requireAuth: true,
  permissions: ["write:documents", "edit:content"],
  allowAnonymous: false,
});
```

#### CASL Ability-Based Authorization

```typescript
const resourceMiddleware = createAuthMiddleware(metrics, authService, {
  name: "resource-access",
  requireAuth: true,
  action: "read",
  resource: "Document",
  allowAnonymous: false,
});
```

### Preset Configurations

#### Pre-built Configuration Presets

```typescript
// Require authentication
const authRequired = createAuthMiddleware(
  metrics,
  authService,
  AUTH_PRESETS.requireAuth()
);

// Optional authentication
const authOptional = createAuthMiddleware(
  metrics,
  authService,
  AUTH_PRESETS.optionalAuth()
);

// Admin-only access
const adminOnly = createAuthMiddleware(
  metrics,
  authService,
  AUTH_PRESETS.adminOnly()
);

// API access with API keys
const apiAccess = createAuthMiddleware(
  metrics,
  authService,
  AUTH_PRESETS.apiAccess()
);

// Web application configuration
const webApp = createAuthMiddleware(
  metrics,
  authService,
  AUTH_PRESETS.webApp()
);

// Development environment
const development = createAuthMiddleware(
  metrics,
  authService,
  AUTH_PRESETS.development()
);

// Production environment
const production = createAuthMiddleware(
  metrics,
  authService,
  AUTH_PRESETS.production()
);
```

### Framework Integration Examples

#### ElysiaJS Integration

```typescript
import { Elysia } from "elysia";
import { createAuthMiddleware } from "@libs/middleware/auth";

const app = new Elysia();

// Apply authentication middleware
app.use(authMiddleware.getMiddlewareFunction());

// Protected routes
app.get("/protected", (context) => {
  // Access user information from context
  const user = context.user;
  const isAuthenticated = context.isAuthenticated;

  return { message: `Hello ${user?.name}` };
});
```

#### Express.js Integration

```typescript
import express from "express";
import { createAuthMiddleware } from "@libs/middleware/auth";

const app = express();

// Apply authentication middleware
app.use(authMiddleware.getMiddlewareFunction());

// Protected routes
app.get("/protected", (req, res) => {
  // Access user information from request context
  const user = req.user;
  res.json({ message: `Hello ${user?.name}` });
});
```

### Advanced Configuration

#### Multiple Authentication Methods

```typescript
const multiAuthMiddleware = createAuthMiddleware(metrics, authService, {
  name: "multi-auth",
  requireAuth: false,
  jwtAuth: true,
  apiKeyAuth: true,
  sessionAuth: true,
  allowAnonymous: true,
  bypassRoutes: ["/health", "/docs", "/metrics"],
  extractUserInfo: true,
});
```

#### Strict Mode Configuration

```typescript
const strictAuthMiddleware = createAuthMiddleware(metrics, authService, {
  name: "strict-auth",
  requireAuth: true,
  strictMode: true,
  jwtAuth: true,
  apiKeyAuth: false,
  sessionAuth: false,
  allowAnonymous: false,
  bypassRoutes: ["/health"], // Minimal bypass routes
});
```

### Error Handling

The middleware provides structured error responses for authentication failures:

```typescript
// Unauthorized errors (401)
{
  error: "UnauthorizedError",
  message: "Authentication required",
  statusCode: 401,
  requestId: "auth_req_1234567890_abc123"
}

// Forbidden errors (403)
{
  error: "ForbiddenError",
  message: "Insufficient role permissions",
  statusCode: 403,
  requestId: "auth_req_1234567890_abc123"
}
```

### Context Enrichment

When `extractUserInfo` is enabled, the middleware enriches the request context with:

```typescript
interface EnrichedContext {
  user?: User; // Authenticated user object
  authContext?: AuthContext; // CASL authorization context
  isAuthenticated: boolean; // Authentication status
  authMethod: string; // Authentication method used
}
```

### Metrics and Monitoring

The middleware provides comprehensive metrics:

- `auth_success`: Successful authentication attempts
- `auth_failure`: Failed authentication attempts
- `auth_execution_time`: Middleware execution time
- `auth_error_duration`: Error handling duration

Metric tags include:

- `method`: Authentication method used
- `userId`: User identifier (if authenticated)
- `path`: Request path
- `error_type`: Error type for failures

### Custom Configuration

#### Creating Custom Presets

```typescript
// Custom preset for microservice communication
const microserviceAuth = (): Partial<AuthMiddlewareConfig> => ({
  name: "microservice-auth",
  requireAuth: true,
  apiKeyAuth: true,
  jwtAuth: false,
  sessionAuth: false,
  allowAnonymous: false,
  bypassRoutes: ["/health", "/metrics"],
  strictMode: true,
  priority: 15, // Higher priority
});

const middleware = createAuthMiddleware(
  metrics,
  authService,
  microserviceAuth()
);
```

#### Dynamic Configuration

```typescript
// Environment-based configuration
const getAuthConfig = (env: string): Partial<AuthMiddlewareConfig> => {
  switch (env) {
    case "development":
      return AUTH_PRESETS.development();
    case "staging":
      return AUTH_PRESETS.webApp();
    case "production":
      return AUTH_PRESETS.production();
    default:
      return AUTH_PRESETS.requireAuth();
  }
};

const middleware = createAuthMiddleware(
  metrics,
  authService,
  getAuthConfig(process.env.NODE_ENV)
);
```

## Configuration Reference

### AuthMiddlewareConfig Interface

```typescript
interface AuthMiddlewareConfig extends HttpMiddlewareConfig {
  readonly requireAuth?: boolean; // Require authentication
  readonly roles?: readonly string[]; // Required roles
  readonly permissions?: readonly string[]; // Required permissions
  readonly action?: Action; // CASL action
  readonly resource?: Resource; // CASL resource
  readonly allowAnonymous?: boolean; // Allow anonymous access
  readonly bypassRoutes?: readonly string[]; // Routes to bypass
  readonly apiKeyAuth?: boolean; // Enable API key auth
  readonly jwtAuth?: boolean; // Enable JWT auth
  readonly sessionAuth?: boolean; // Enable session auth
  readonly strictMode?: boolean; // Strict authentication mode
  readonly extractUserInfo?: boolean; // Extract user to context
}
```

### Default Values

```typescript
const DEFAULT_AUTH_OPTIONS = {
  REQUIRE_AUTH: false,
  ALLOW_ANONYMOUS: true,
  BYPASS_ROUTES: ["/health", "/metrics", "/docs"],
  API_KEY_AUTH: true,
  JWT_AUTH: true,
  SESSION_AUTH: false,
  STRICT_MODE: false,
  EXTRACT_USER_INFO: true,
  PRIORITY: 10,
};
```

## Best Practices

1. **Use Presets**: Start with pre-built configurations for common scenarios
2. **Environment-Specific Config**: Use different configurations for dev/staging/production
3. **Bypass Critical Routes**: Always bypass health checks and metrics endpoints
4. **Monitor Performance**: Track authentication metrics for performance optimization
5. **Error Handling**: Implement proper error handling for authentication failures
6. **Security Headers**: Combine with security middleware for comprehensive protection
7. **Rate Limiting**: Use with rate limiting middleware for additional security

## Security Considerations

- **Token Validation**: All tokens are validated against the authentication service
- **Session Management**: Sessions are validated for activity and expiration
- **Permission Checking**: Multiple layers of authorization (roles, permissions, abilities)
- **Audit Logging**: All authentication attempts are logged for security monitoring
- **Error Information**: Error messages provide minimal information to prevent enumeration attacks
- **Context Isolation**: User context is properly isolated per request

## Testing

```typescript
import { AuthMiddleware } from "@libs/middleware/auth";
import { mockMetricsCollector, mockAuthService } from "./test-helpers";

describe("AuthMiddleware", () => {
  it("should authenticate valid JWT tokens", async () => {
    const middleware = new AuthMiddleware(
      mockMetricsCollector,
      mockAuthService,
      { requireAuth: true, jwtAuth: true }
    );

    const context = createMockContext({
      headers: { authorization: "Bearer valid-token" },
    });

    await middleware.execute(context, () => Promise.resolve());

    expect(context.isAuthenticated).toBe(true);
    expect(context.user).toBeDefined();
  });
});
```
