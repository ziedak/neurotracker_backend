# @libs/middleware

Unified middleware library for the Neurotracker backend services. Provides standardized middleware for authentication, validation, rate limiting, audit, logging, and error handling.

## Features

- **Framework Agnostic**: Works with Elysia (primary) and extensible to other frameworks
- **Type Safe**: Full TypeScript support with strict typing
- **Configurable**: Extensive configuration options with sensible defaults
- **Performance Focused**: Optimized for high-throughput applications
- **Observable**: Built-in metrics and logging support
- **Composable**: Easy to chain and combine middleware

## Installation

```bash
# Install as workspace dependency
pnpm add @libs/middleware
```

## Quick Start

### Basic Authentication

```typescript
import { createAuthMiddleware, commonConfigs } from '@libs/middleware';

// Use predefined service configuration
const authMiddleware = createAuthMiddleware(commonConfigs.auth.aiEngine);

// Or create custom configuration
const customAuth = createAuthMiddleware({
  requiredPermissions: ['predict', 'batch_predict'],
  apiKeys: new Set(['my-api-key']),
  allowAnonymous: false,
});

// Apply to Elysia app
app
  .use(authMiddleware)
  .post('/predict', handler);
```

### Service Presets

```typescript
import { servicePresets } from '@libs/middleware';

// Get all middleware for a specific service
const { auth } = servicePresets.aiEngine();

app
  .use(auth)
  .post('/predict', handler);
```

## Middleware Types

### 1. Authentication Middleware

Supports API key, JWT token, and anonymous authentication with role-based access control.

```typescript
import { AuthMiddleware } from '@libs/middleware';

const authConfig = {
  apiKeys: new Set(['key1', 'key2']),
  requiredRoles: ['user', 'admin'],
  requiredPermissions: ['predict'],
  allowAnonymous: true,
  bypassRoutes: ['/health', '/metrics'],
};

const auth = new AuthMiddleware(authConfig, logger, metrics);
app.use(auth.middleware());
```

**Features:**
- API key validation with permissions
- JWT token validation and decoding
- Role-based access control (RBAC)
- Permission checking
- Route-specific requirements
- Anonymous access support

### 2. Rate Limiting Middleware *(Coming Soon)*

Redis-based rate limiting with multiple strategies.

### 3. Validation Middleware *(Coming Soon)*

Request validation using Zod or custom rules.

### 4. Audit Middleware *(Coming Soon)*

Comprehensive request/response auditing with multiple storage backends.

### 5. Logging Middleware *(Coming Soon)*

Structured request/response logging.

### 6. Error Handling Middleware *(Coming Soon)*

Centralized error handling with custom error responses.

## Configuration

### Service-Specific Configurations

Pre-built configurations for each service:

```typescript
import { commonConfigs } from '@libs/middleware';

// API Gateway - allows anonymous access
const apiGatewayAuth = commonConfigs.auth.apiGateway;

// AI Engine - requires predictions permissions
const aiEngineAuth = commonConfigs.auth.aiEngine;

// Data Intelligence - requires user role
const dataIntelAuth = commonConfigs.auth.dataIntelligence;

// Event Pipeline - requires event ingestion permissions
const eventPipelineAuth = commonConfigs.auth.eventPipeline;
```

### Custom Configuration

```typescript
const customConfig = {
  // Enable/disable middleware
  enabled: true,
  
  // Execution priority (higher = earlier)
  priority: 10,
  
  // Skip middleware for specific paths
  skipPaths: ['/health', '/metrics'],
  
  // Service-specific settings
  requiredRoles: ['admin'],
  requiredPermissions: ['special_access'],
  allowAnonymous: false,
};
```

## Advanced Usage

### Middleware Chaining

```typescript
import { MiddlewareChain } from '@libs/middleware';

const chain = new MiddlewareChain({
  middlewares: [
    { name: 'auth', middleware: authMiddleware, priority: 100 },
    { name: 'rateLimit', middleware: rateLimitMiddleware, priority: 90 },
    { name: 'validation', middleware: validationMiddleware, priority: 80 },
  ],
  errorHandler: (error, context) => ({
    error: 'Middleware chain failed',
    details: error.message,
  }),
}, logger);

app.use(chain.execute());
```

### Custom Middleware

```typescript
import { BaseMiddleware, MiddlewareContext } from '@libs/middleware';

class CustomMiddleware extends BaseMiddleware {
  async execute(context: MiddlewareContext, next: () => Promise<void>) {
    // Pre-processing
    const startTime = performance.now();
    
    try {
      await next();
      
      // Post-processing
      await this.recordTimer('custom_duration', performance.now() - startTime);
    } catch (error) {
      await this.recordMetric('custom_error');
      throw error;
    }
  }
}
```

## Context Interface

The middleware context provides a standardized interface across frameworks:

```typescript
interface MiddlewareContext {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
    query?: Record<string, any>;
    params?: Record<string, any>;
    ip?: string;
  };
  set: {
    status?: number;
    headers: Record<string, string>;
  };
  user?: {
    id?: string;
    roles?: string[];
    permissions?: string[];
    authenticated?: boolean;
  };
  validated?: {
    body?: any;
    query?: any;
    params?: any;
  };
  // Framework-specific extensions
  [key: string]: any;
}
```

## API Reference

### AuthMiddleware

#### Configuration Options

- `apiKeys?: Set<string>` - Allowed API keys
- `jwtSecret?: string` - JWT secret for token validation
- `requiredRoles?: string[]` - Required user roles
- `requiredPermissions?: string[]` - Required permissions
- `allowAnonymous?: boolean` - Allow anonymous access
- `bypassRoutes?: string[]` - Routes that bypass authentication
- `tokenExpiry?: number` - JWT token expiry in seconds

#### Methods

- `middleware(): MiddlewareFunction` - Get middleware function
- `static create(type, overrides?)` - Create preconfigured middleware

### BaseMiddleware

Base class for creating custom middleware.

#### Protected Methods

- `shouldSkip(context): boolean` - Check if request should be skipped
- `recordMetric(name, value?, tags?)` - Record metrics
- `recordTimer(name, duration, tags?)` - Record timing metrics
- `getClientIp(context): string` - Extract client IP
- `sanitizeObject(obj, sensitiveFields?)` - Remove sensitive data

## Examples

### AI Engine Service

```typescript
import { createAuthMiddleware, commonConfigs } from '@libs/middleware';

const app = new Elysia()
  .use(createAuthMiddleware({
    ...commonConfigs.auth.aiEngine,
    requiredPermissions: ['predict', 'batch_predict'],
  }))
  .post('/predict', async ({ body, user }) => {
    // user is automatically populated by auth middleware
    console.log('User:', user?.id, user?.permissions);
    return { prediction: 'result' };
  });
```

### Data Intelligence Service

```typescript
import { servicePresets } from '@libs/middleware';

const { auth } = servicePresets.dataIntelligence();

const app = new Elysia()
  .use(auth)
  .get('/analytics', async ({ user }) => {
    // Only users with 'user' or 'admin' role can access
    return { analytics: 'data' };
  });
```

## Migration Guide

### From Existing Middleware

1. **Replace imports**: Change from service-specific middleware to `@libs/middleware`
2. **Update configuration**: Use new configuration format
3. **Test compatibility**: Ensure all functionality works as expected

### Example Migration

```typescript
// Before
import { AuthMiddleware } from '../middleware/auth.middleware';
const auth = new AuthMiddleware(config, logger);

// After
import { createAuthMiddleware } from '@libs/middleware';
const auth = createAuthMiddleware(config);
```

## Development

### Building

```bash
pnpm build
```

### Testing

```bash
pnpm test
```

### Linting

```bash
pnpm lint
```

## Architecture

The middleware library follows these design principles:

1. **Separation of Concerns**: Each middleware type handles a specific responsibility
2. **Composition over Inheritance**: Middleware can be easily combined and chained
3. **Configuration over Code**: Behavior is controlled through configuration objects
4. **Framework Abstraction**: Common interface works across different frameworks
5. **Performance First**: Optimized for high-throughput applications

## Contributing

1. Follow existing code patterns and TypeScript conventions
2. Add comprehensive tests for new middleware
3. Update documentation and examples
4. Ensure backward compatibility

## License

Internal library for Neurotracker backend services.