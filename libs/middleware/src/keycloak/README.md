# Industry-Standard Keycloak Middleware

A comprehensive refactoring of the Keycloak middleware following industry-standard patterns including dependency injection, interface segregation, and clean architecture principles.

## 🚀 What's New - Industry Standards Implementation

- **Dependency Injection**: Proper service factory pattern with injectable dependencies
- **Interface Segregation**: Cleanly separated interfaces for different service concerns
- **Clean Architecture**: Separated layers with clear boundaries and responsibilities
- **Configuration Validation**: Production-grade validation with development and production presets
- **Error Handling**: Comprehensive error types and proper error propagation
- **Metrics & Monitoring**: Built-in metrics collection and health checks
- **Caching**: Redis-based caching with proper invalidation strategies

### Key Improvements Over Legacy Implementation

| Aspect              | Legacy               | Industry-Standard                    |
| ------------------- | -------------------- | ------------------------------------ |
| **Dependencies**    | Direct instantiation | Dependency injection with factory    |
| **Configuration**   | Mixed validation     | Comprehensive validator with presets |
| **Error Handling**  | Basic try-catch      | Typed errors with proper propagation |
| **Testing**         | Tightly coupled      | Fully mockable with interfaces       |
| **Maintainability** | Monolithic           | Modular with clear separation        |
| **Performance**     | Basic caching        | Optimized caching with metrics       |

## 🛠 Industry-Standard Usage

### Basic Setup

```typescript
import { createKeycloakMiddleware } from "@libs/middleware/keycloak";

const middleware = await createKeycloakMiddleware(
  logger, // ILogger implementation
  metrics, // IMetricsCollector implementation
  redis, // RedisClient instance
  {
    serverUrl: "https://keycloak.example.com",
    realm: "my-realm",
    clientId: "my-client",
    requireAuth: true,
    verifyTokenLocally: true,
  }
);
```

### Development Environment

```typescript
import { createDevKeycloakMiddleware } from "@libs/middleware/keycloak";

const devMiddleware = await createDevKeycloakMiddleware(
  logger,
  metrics,
  redis,
  {
    serverUrl: "http://localhost:8080",
    realm: "development",
    clientId: "dev-client",
  }
);
```

### Request Context Usage

```typescript
import { KeycloakAuthenticatedContext } from "@libs/middleware/keycloak";

async function handleRequest(context: KeycloakAuthenticatedContext) {
  // Execute authentication middleware
  await middleware.execute(context);

  // Access authenticated user data
  if (context.keycloak.authenticated) {
    const { user, roles, scopes } = context.keycloak;

    // Check permissions with helper methods
    const isAdmin = context.keycloak.hasRole("admin");
    const canWrite = context.keycloak.hasScope("api:write");
    const hasMultipleRoles = context.keycloak.hasAnyRole(["admin", "manager"]);

    return {
      userId: user.sub,
      username: user.preferredUsername,
      permissions: { isAdmin, canWrite, hasMultipleRoles },
    };
  }
}
```

## 📊 Benefits Summary

✅ **Better Testability** - Full interface mocking and dependency injection  
✅ **Improved Maintainability** - Clean separation of concerns  
✅ **Enhanced Reliability** - Comprehensive error handling and validation  
✅ **Better Performance** - Optimized caching and metrics  
✅ **Production Ready** - Built-in monitoring and health checks  
✅ **Developer Experience** - Better types, documentation, and examples

---

## 📚 Legacy Documentation (Backward Compatibility)

The following documentation covers the original implementation which is still supported for backward compatibility.

## Features

- **JWT Token Validation**: Local and remote token verification
- **Role-Based Access Control**: Fine-grained permission checking
- **Redis Integration**: High-performance caching and rate limiting
- **Circuit Breaker Pattern**: Resilient error handling
- **JWKS Support**: Automatic public key rotation
- **Rate Limiting**: Protection against brute force attacks
- **Comprehensive Logging**: Structured logging with contextual information
- **Metrics Collection**: Performance monitoring and analytics
- **Multiple Integration Patterns**: Flexible usage options

- 🔐 **JWT Token Validation**: Local and remote token verification with Keycloak
- 🚀 **High Performance**: Intelligent caching with configurable TTL
- 🌐 **WebSocket Support**: Real-time authentication for WebSocket connections
- 👥 **Role-Based Access Control**: Flexible role and permission mapping
- 📊 **Comprehensive Logging**: Detailed audit trails and metrics
- 🛡️ **Security First**: Industry-standard security practices
- 🔄 **Flexible Configuration**: Extensive customization options
- 📈 **Production Ready**: Battle-tested for enterprise environments

## Installation

The Keycloak middleware is part of the `@libs/middleware` package:

```bash
pnpm add @libs/middleware
```

## Quick Start

### Basic Setup

```typescript
import { Elysia } from "@libs/elysia-server";
import { createKeycloakPlugin } from "@libs/middleware/keycloak";

const app = new Elysia()
  .use(
    createKeycloakPlugin({
      keycloak: {
        serverUrl: "https://your-keycloak.com",
        realm: "your-realm",
        clientId: "your-client",
        requireAuth: true,
        verifyTokenLocally: true,
      },
    })
  )
  .get("/protected", ({ keycloak }) => {
    return {
      user: keycloak.user,
      roles: keycloak.roles,
      authenticated: keycloak.authenticated,
    };
  });
```

### With Guards

```typescript
import { keycloakGuards } from "@libs/middleware/keycloak";

const app = new Elysia()
  .use(createKeycloakPlugin(config))
  .use(keycloakGuards.authenticated)
  .get("/admin", ({ keycloak }) => {
    return { message: "Admin area" };
  })
  .guard(keycloakGuards.admin)
  .post("/admin/users", ({ keycloak, body }) => {
    // Only admin users can access this
    return createUser(body);
  });
```

### WebSocket Authentication

```typescript
import { createKeycloakWebSocketMiddleware } from "@libs/middleware/keycloak";

const wsAuth = createKeycloakWebSocketMiddleware({
  serverUrl: "https://your-keycloak.com",
  realm: "your-realm",
  clientId: "your-client",
  requireAuth: true,
  messagePermissions: {
    "chat:send": ["message:chat", "websocket:send"],
    "admin:broadcast": ["system:admin", "websocket:admin"],
  },
  messageRoles: {
    "admin:command": ["admin", "administrator"],
    "user:message": ["admin", "user", "customer"],
  },
});

// Use in your WebSocket middleware chain
```

## Configuration

### Basic Configuration

```typescript
interface KeycloakConfig {
  serverUrl: string; // Keycloak server URL
  realm: string; // Keycloak realm name
  clientId: string; // Client ID
  clientSecret?: string; // Client secret (for confidential clients)
  publicKey?: string; // Public key for local validation
  jwksUri?: string; // JWKS endpoint (auto-generated if not provided)
  requireAuth?: boolean; // Require authentication (default: true)
  verifyTokenLocally?: boolean; // Use local validation (default: true)
  cacheTTL?: number; // Cache TTL in seconds (default: 300)
}
```

### Advanced Configuration

```typescript
const advancedConfig = {
  keycloak: {
    serverUrl: "https://your-keycloak.com",
    realm: "production",
    clientId: "backend-api",
    clientSecret: "your-secret",
    requireAuth: true,
    verifyTokenLocally: true,
    cacheTTL: 600,

    // Custom claim mappings
    rolesClaim: "realm_access.roles",
    usernameClaim: "preferred_username",
    emailClaim: "email",
    groupsClaim: "groups",

    // Performance settings
    connectTimeout: 5000,
    readTimeout: 5000,
    enableUserInfoEndpoint: false,

    // Paths to skip authentication
    skipPaths: ["/health", "/metrics", "/docs"],
  },
};
```

### WebSocket Configuration

```typescript
const wsConfig = {
  serverUrl: "https://your-keycloak.com",
  realm: "your-realm",
  clientId: "websocket-client",
  requireAuth: true,
  closeOnAuthFailure: true,

  // Skip auth for certain message types
  skipAuthenticationForTypes: ["ping", "heartbeat"],

  // Message-level permissions
  messagePermissions: {
    "chat:send": ["message:chat", "websocket:send"],
    "data:sync": ["message:data", "websocket:send"],
    "admin:broadcast": ["system:admin", "websocket:broadcast"],
  },

  // Role-based message access
  messageRoles: {
    "admin:command": ["admin", "administrator"],
    "manager:report": ["admin", "manager"],
    "user:chat": ["admin", "manager", "user", "customer"],
  },
};
```

## Authentication Flow

### REST API Authentication

1. **Token Extraction**: From `Authorization: Bearer <token>` header or `access_token` query parameter
2. **Token Validation**: Local verification (using public key/JWKS) or remote introspection
3. **User Context**: Extract user information, roles, and permissions
4. **Caching**: Cache valid tokens to improve performance
5. **Context Population**: Add user data to request context

### WebSocket Authentication

1. **Connection Authentication**: Validate token during WebSocket handshake
2. **Message-Level Authorization**: Check permissions for each message type
3. **Real-Time Validation**: Handle token expiration during active connections
4. **Role-Based Filtering**: Filter messages based on user roles

## Role and Permission Mapping

The middleware includes built-in role-to-permission mapping:

```typescript
const rolePermissions = {
  admin: [
    "user:read",
    "user:write",
    "user:delete",
    "system:admin",
    "api:full_access",
    "websocket:connect",
    "websocket:broadcast",
  ],
  manager: [
    "user:read",
    "user:write",
    "reports:read",
    "api:write",
    "websocket:connect",
    "message:data",
  ],
  user: ["user:read", "api:read", "websocket:connect", "message:chat"],
};
```

### Custom Role Mapping

```typescript
class CustomKeycloakMiddleware extends KeycloakMiddleware {
  protected mapRolesToPermissions(roles: string[]): string[] {
    const permissions: string[] = [];

    roles.forEach((role) => {
      switch (role) {
        case "data-scientist":
          permissions.push("data:read", "data:analyze", "models:read");
          break;
        case "api-consumer":
          permissions.push("api:read", "api:limited-write");
          break;
        default:
          permissions.push(`role:${role}`);
      }
    });

    return [...new Set(permissions)];
  }
}
```

## Guards and Access Control

### Built-in Guards

```typescript
import { keycloakGuards } from "@libs/middleware/keycloak";

// Require authentication
app.use(keycloakGuards.authenticated);

// Require admin role
app.use(keycloakGuards.admin);

// Optional authentication
app.use(keycloakGuards.optional);
```

### Custom Guards

```typescript
const middleware = new KeycloakMiddleware(config);

// Require specific role
app.use(middleware.requireRole("data-scientist"));

// Require multiple roles (any of)
app.use(middleware.requireRole(["admin", "manager"]));

// Require specific permission
app.use(middleware.requirePermission("data:read"));

// Require group membership
app.use(middleware.requireGroup("analytics-team"));
```

### Route-Level Guards

```typescript
app
  .get("/public", () => "Public endpoint")
  .guard(middleware.requireRole("user"))
  .get("/user-data", ({ keycloak }) => getUserData(keycloak.user.sub))
  .guard(middleware.requireRole("admin"))
  .delete("/users/:id", ({ params }) => deleteUser(params.id));
```

## Error Handling

The middleware provides comprehensive error handling with specific error types:

```typescript
import { KeycloakError, KeycloakErrorType } from "@libs/middleware/keycloak";

try {
  await keycloakService.verifyToken(token);
} catch (error) {
  if (error instanceof KeycloakError) {
    switch (error.type) {
      case KeycloakErrorType.TOKEN_EXPIRED:
        // Handle expired token
        break;
      case KeycloakErrorType.INVALID_TOKEN:
        // Handle invalid token
        break;
      case KeycloakErrorType.PERMISSION_DENIED:
        // Handle permission denied
        break;
      case KeycloakErrorType.CONNECTION_ERROR:
        // Handle connection error
        break;
    }
  }
}
```

## Caching and Performance

### Cache Management

```typescript
const middleware = new KeycloakMiddleware(config);

// Get cache statistics
const stats = middleware.getCacheStats();
console.log("Token cache size:", stats.tokenCacheSize);
console.log("User info cache size:", stats.userInfoCacheSize);

// Clear caches
middleware.clearCache();
```

### Performance Optimization

1. **Local Token Validation**: Use `verifyTokenLocally: true` for better performance
2. **Appropriate Cache TTL**: Balance between performance and security
3. **Skip Paths**: Exclude health checks and metrics from authentication
4. **Efficient Role Mapping**: Avoid complex role-to-permission calculations

## Integration Examples

### API Gateway Integration

```typescript
import { Elysia } from "@libs/elysia-server";
import { createKeycloakPlugin } from "@libs/middleware/keycloak";

const gateway = new Elysia()
  .use(
    createKeycloakPlugin({
      keycloak: {
        serverUrl: process.env.KEYCLOAK_URL,
        realm: process.env.KEYCLOAK_REALM,
        clientId: process.env.KEYCLOAK_CLIENT_ID,
        clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
        requireAuth: false, // Gateway allows public endpoints
        skipPaths: ["/health", "/metrics", "/docs", "/auth/login"],
      },
    })
  )
  .get("/health", () => ({ status: "OK" }))
  .group("/api/v1", (app) =>
    app.use(keycloakGuards.authenticated).get("/profile", ({ keycloak }) => ({
      user: keycloak.user,
      roles: keycloak.roles,
    }))
  );
```

### Service Integration

```typescript
// Data Intelligence Service
const dataService = new Elysia()
  .use(
    createKeycloakPlugin({
      keycloak: {
        serverUrl: process.env.KEYCLOAK_URL,
        realm: "data-platform",
        clientId: "data-intelligence",
        requireAuth: true,
        verifyTokenLocally: true,
      },
    })
  )
  .guard(middleware.requirePermission("data:read"))
  .get("/datasets", ({ keycloak }) => getDatasets(keycloak.user.sub))
  .guard(middleware.requireRole(["admin", "data-scientist"]))
  .post("/datasets", ({ body, keycloak }) =>
    createDataset(body, keycloak.user.sub)
  );
```

### WebSocket Service Integration

```typescript
import { WebSocketMiddlewareChain } from "@libs/middleware";
import { createKeycloakWebSocketMiddleware } from "@libs/middleware/keycloak";

const wsChain = new WebSocketMiddlewareChain([
  createKeycloakWebSocketMiddleware({
    serverUrl: process.env.KEYCLOAK_URL,
    realm: "realtime",
    clientId: "websocket-service",
    requireAuth: true,
    messagePermissions: {
      "chat:send": ["message:chat"],
      "data:stream": ["data:read", "websocket:stream"],
    },
  }),
]);
```

## Testing

### Unit Tests

```typescript
import { KeycloakService, KeycloakMiddleware } from "@libs/middleware/keycloak";

describe("KeycloakMiddleware", () => {
  let middleware: KeycloakMiddleware;

  beforeEach(() => {
    middleware = new KeycloakMiddleware(testConfig);
  });

  it("should authenticate valid token", async () => {
    const context = createMockContext();
    context.request.headers.authorization = "Bearer valid-token";

    await middleware.execute(context, jest.fn());

    expect(context.keycloak.authenticated).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe("Keycloak Integration", () => {
  let app: Elysia;

  beforeEach(() => {
    app = new Elysia()
      .use(createKeycloakPlugin(integrationConfig))
      .get("/test", ({ keycloak }) => keycloak);
  });

  it("should authenticate with real token", async () => {
    const token = await getTestToken();
    const response = await app.fetch("/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.ok).toBe(true);
  });
});
```

## Troubleshooting

### Common Issues

1. **Token Verification Fails**

   - Check Keycloak server URL and realm configuration
   - Verify client ID and secret
   - Ensure public key is correct for local validation

2. **Performance Issues**

   - Enable local token validation
   - Adjust cache TTL settings
   - Use appropriate skip paths

3. **WebSocket Authentication Fails**
   - Check token transmission method (header vs query)
   - Verify WebSocket-specific configuration
   - Review message permission mappings

### Debug Logging

```typescript
const config = {
  keycloak: {
    // ... other config
    logLevel: "debug",
  },
};
```

### Health Checks

```typescript
app.get("/health/keycloak", ({ keycloak }) => {
  const service = keycloak.service;
  const stats = service.getCacheStats();

  return {
    status: "healthy",
    cache: stats,
    config: {
      realm: service.config.realm,
      verifyLocally: service.config.verifyTokenLocally,
    },
  };
});
```

## Security Considerations

1. **Token Storage**: Never log or store JWT tokens
2. **Cache TTL**: Balance performance vs security with appropriate TTL
3. **HTTPS Only**: Always use HTTPS in production
4. **Client Secrets**: Protect client secrets, use environment variables
5. **Permission Validation**: Validate permissions at both middleware and application level
6. **Regular Updates**: Keep Keycloak and dependencies updated

## License

This middleware is part of the enterprise backend system and follows the same license terms.
