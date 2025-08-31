# Shared Middleware Library Design

## Library Structure

```
libs/middleware/
├── src/
│   ├── index.ts                 # Main exports
│   ├── types/                   # Common types and interfaces
│   │   ├── index.ts
│   │   ├── context.types.ts
│   │   ├── middleware.types.ts
│   │   └── config.types.ts
│   ├── base/                    # Base classes and utilities
│   │   ├── index.ts
│   │   ├── BaseMiddleware.ts
│   │   └── MiddlewareChain.ts
│   ├── auth/                    # Authentication middleware
│   │   ├── index.ts
│   │   ├── AuthMiddleware.ts
│   │   ├── ApiKeyAuth.ts
│   │   ├── JwtAuth.ts
│   │   └── RoleBasedAuth.ts
│   ├── validation/              # Validation middleware
│   │   ├── index.ts
│   │   ├── ValidationMiddleware.ts
│   │   ├── ZodValidator.ts
│   │   └── RuleValidator.ts
│   ├── rateLimit/              # Rate limiting middleware
│   │   ├── index.ts
│   │   ├── RateLimitMiddleware.ts
│   │   ├── RedisRateLimit.ts
│   │   └── strategies/
│   │       ├── IpStrategy.ts
│   │       ├── UserStrategy.ts
│   │       └── ApiKeyStrategy.ts
│   ├── audit/                   # Audit middleware
│   │   ├── index.ts
│   │   ├── AuditMiddleware.ts
│   │   ├── EventLogger.ts
│   │   └── storage/
│   │       ├── RedisStorage.ts
│   │       ├── ClickHouseStorage.ts
│   │       └── InMemoryStorage.ts
│   ├── logging/                 # Request logging middleware
│   │   ├── index.ts
│   │   ├── RequestLogger.ts
│   │   └── ResponseLogger.ts
│   ├── error/                   # Error handling middleware
│   │   ├── index.ts
│   │   ├── ErrorHandler.ts
│   │   └── ErrorResponse.ts
│   └── utils/                   # Utility functions
│       ├── index.ts
│       ├── sanitizer.ts
│       ├── headers.ts
│       └── requestId.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Core Design Principles

### 1. **Composability**

- Middleware can be easily combined and chained
- Each middleware is independent and focused
- Clear interfaces for middleware composition

### 2. **Configuration-Driven**

- All middleware accepts configuration objects
- Default configurations for common use cases
- Environment-specific overrides

### 3. **Framework Agnostic**

- Works with Elysia (primary) but extensible
- Clear abstraction layer for context and request/response
- Plugin architecture for framework-specific adapters

### 4. **Performance First**

- Minimal overhead and optimized execution
- Async operations where beneficial
- Caching and batching for expensive operations

### 5. **Type Safety**

- Full TypeScript support with strict typing
- Generic interfaces for extensibility
- Runtime type validation where needed

## Common Types and Interfaces

```typescript
// libs/middleware/src/types/context.types.ts
export interface MiddlewareContext {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: any;
    query?: Record<string, any>;
    params?: Record<string, any>;
    ip?: string;
  };
  response?: {
    status?: number;
    headers?: Record<string, string>;
    body?: any;
  };
  set: {
    status?: number;
    headers: Record<string, string>;
  };
  user?: {
    id?: string;
    roles?: string[];
    permissions?: string[];
    [key: string]: any;
  };
  session?: {
    id?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

// libs/middleware/src/types/middleware.types.ts
export type MiddlewareFunction = (
  context: MiddlewareContext,
  next: () => Promise<void>
) => Promise<void | any>;

export interface MiddlewareOptions {
  enabled?: boolean;
  priority?: number;
  skipPaths?: string[];
}

export interface ConfigurableMiddleware<T = any> {
  (config?: T): MiddlewareFunction;
}
```

## Base Middleware Class

```typescript
// libs/middleware/src/base/BaseMiddleware.ts
import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  MiddlewareContext,
  MiddlewareFunction,
  MiddlewareOptions,
} from "../types";

export abstract class BaseMiddleware<TConfig = any> {
  protected logger: ILogger;
  protected metrics?: MetricsCollector;
  protected config: TConfig & MiddlewareOptions;

  constructor(
    name: string,
    config: TConfig & MiddlewareOptions,
    logger: ILogger,
    metrics?: MetricsCollector
  ) {
    this.logger = logger.child({ middleware: name });
    this.metrics = metrics;
    this.config = { enabled: true, priority: 0, skipPaths: [], ...config };
  }

  abstract execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void | any>;

  public middleware(): MiddlewareFunction {
    return async (context: MiddlewareContext, next: () => Promise<void>) => {
      if (!this.config.enabled) {
        return next();
      }

      if (this.shouldSkip(context)) {
        return next();
      }

      return this.execute(context, next);
    };
  }

  protected shouldSkip(context: MiddlewareContext): boolean {
    const path = context.request.url.split("?")[0];
    return (
      this.config.skipPaths?.some((skipPath) => {
        if (skipPath.endsWith("*")) {
          return path.startsWith(skipPath.slice(0, -1));
        }
        return path === skipPath || path.startsWith(skipPath + "/");
      }) || false
    );
  }

  protected async recordMetric(name: string, value: number = 1): Promise<void> {
    if (this.metrics) {
      await this.metrics.recordCounter(name, value);
    }
  }

  protected async recordTimer(name: string, duration: number): Promise<void> {
    if (this.metrics) {
      await this.metrics.recordTimer(name, duration);
    }
  }
}
```

## Authentication Middleware

```typescript
// libs/middleware/src/auth/AuthMiddleware.ts
export interface AuthConfig extends MiddlewareOptions {
  apiKeys?: Set<string>;
  jwtSecret?: string;
  requiredRoles?: string[];
  requiredPermissions?: string[];
  allowAnonymous?: boolean;
  bypassRoutes?: string[];
}

export class AuthMiddleware extends BaseMiddleware<AuthConfig> {
  private apiKeyAuth: ApiKeyAuth;
  private jwtAuth: JwtAuth;

  constructor(config: AuthConfig, logger: ILogger, metrics?: MetricsCollector) {
    super("auth", config, logger, metrics);
    this.apiKeyAuth = new ApiKeyAuth(config, logger);
    this.jwtAuth = new JwtAuth(config, logger);
  }

  async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void | any> {
    const startTime = performance.now();

    try {
      const authResult = await this.authenticate(context);

      if (!authResult.authenticated) {
        context.set.status = 401;
        await this.recordMetric("auth_failed");
        return {
          error: "Authentication failed",
          message: authResult.error,
          code: "AUTH_FAILED",
        };
      }

      // Check authorization
      if (!(await this.authorize(authResult, context))) {
        context.set.status = 403;
        await this.recordMetric("auth_forbidden");
        return {
          error: "Insufficient permissions",
          code: "INSUFFICIENT_PERMISSIONS",
        };
      }

      context.user = authResult.user;
      await this.recordMetric("auth_success");
      await next();
    } catch (error) {
      this.logger.error("Authentication error", error as Error);
      context.set.status = 500;
      return {
        error: "Authentication service error",
        code: "AUTH_SERVICE_ERROR",
      };
    } finally {
      await this.recordTimer("auth_duration", performance.now() - startTime);
    }
  }

  private async authenticate(context: MiddlewareContext): Promise<AuthResult> {
    const authHeader = context.request.headers.authorization;
    const apiKey = context.request.headers["x-api-key"];

    if (this.config.allowAnonymous && !authHeader && !apiKey) {
      return { authenticated: true, user: { anonymous: true } };
    }

    if (apiKey) {
      return this.apiKeyAuth.authenticate(apiKey);
    }

    if (authHeader) {
      return this.jwtAuth.authenticate(authHeader);
    }

    return { authenticated: false, error: "No authentication provided" };
  }

  private async authorize(
    authResult: AuthResult,
    context: MiddlewareContext
  ): Promise<boolean> {
    if (!authResult.user || authResult.user.anonymous) {
      return this.config.allowAnonymous || false;
    }

    // Check roles
    if (this.config.requiredRoles?.length) {
      const hasRole = this.config.requiredRoles.some(
        (role) =>
          authResult.user.roles?.includes(role) ||
          authResult.user.roles?.includes("admin")
      );
      if (!hasRole) return false;
    }

    // Check permissions
    if (this.config.requiredPermissions?.length) {
      const hasPermission = this.config.requiredPermissions.some(
        (permission) =>
          authResult.user.permissions?.includes(permission) ||
          authResult.user.permissions?.includes("*")
      );
      if (!hasPermission) return false;
    }

    return true;
  }
}
```

## Rate Limiting Middleware

```typescript
// libs/middleware/src/rateLimit/RateLimitMiddleware.ts
export interface RateLimitConfig extends MiddlewareOptions {
  windowMs: number;
  maxRequests: number;
  keyStrategy: "ip" | "user" | "apiKey" | "custom";
  customKeyGenerator?: (context: MiddlewareContext) => string;
  redis?: {
    enabled: boolean;
    keyPrefix?: string;
  };
  standardHeaders?: boolean;
  message?: string;
}

export class RateLimitMiddleware extends BaseMiddleware<RateLimitConfig> {
  private redisRateLimit: RedisRateLimit;
  private strategies: Map<string, RateLimitStrategy>;

  constructor(
    config: RateLimitConfig,
    logger: ILogger,
    metrics?: MetricsCollector
  ) {
    super("rateLimit", config, logger, metrics);
    this.redisRateLimit = new RedisRateLimit(config, logger);
    this.initializeStrategies();
  }

  async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void | any> {
    const startTime = performance.now();

    try {
      const key = this.generateKey(context);
      const result = await this.checkRateLimit(key);

      if (result.limited) {
        context.set.status = 429;
        if (this.config.standardHeaders) {
          this.setRateLimitHeaders(context, result);
        }

        await this.recordMetric("rate_limit_exceeded");
        return {
          error: "Rate limit exceeded",
          message: this.config.message || "Too many requests",
          retryAfter: result.resetTime,
          code: "RATE_LIMIT_EXCEEDED",
        };
      }

      if (this.config.standardHeaders) {
        this.setRateLimitHeaders(context, result);
      }

      await next();
      await this.recordMetric("rate_limit_allowed");
    } catch (error) {
      this.logger.error("Rate limit error", error as Error);
      // Fail open - allow request on error
      await next();
    } finally {
      await this.recordTimer(
        "rate_limit_duration",
        performance.now() - startTime
      );
    }
  }

  private generateKey(context: MiddlewareContext): string {
    const strategy = this.strategies.get(this.config.keyStrategy);
    if (!strategy) {
      throw new Error(
        `Unknown rate limit strategy: ${this.config.keyStrategy}`
      );
    }
    return strategy.generateKey(context);
  }

  // Implementation details...
}
```

## Validation Middleware

```typescript
// libs/middleware/src/validation/ValidationMiddleware.ts
export interface ValidationConfig extends MiddlewareOptions {
  engine: "zod" | "rules";
  schemas?: Record<string, any>;
  maxRequestSize?: number;
  sanitizeInputs?: boolean;
  strictMode?: boolean;
}

export class ValidationMiddleware extends BaseMiddleware<ValidationConfig> {
  private zodValidator?: ZodValidator;
  private ruleValidator?: RuleValidator;

  constructor(
    config: ValidationConfig,
    logger: ILogger,
    metrics?: MetricsCollector
  ) {
    super("validation", config, logger, metrics);

    if (config.engine === "zod") {
      this.zodValidator = new ZodValidator(config, logger);
    } else {
      this.ruleValidator = new RuleValidator(config, logger);
    }
  }

  async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void | any> {
    const startTime = performance.now();

    try {
      const validator = this.zodValidator || this.ruleValidator;
      if (!validator) {
        throw new Error("No validator configured");
      }

      const result = await validator.validate(context);

      if (!result.valid) {
        context.set.status = 400;
        await this.recordMetric("validation_failed");
        return {
          error: "Validation failed",
          message: "Request contains invalid data",
          details: result.errors,
          code: "VALIDATION_ERROR",
        };
      }

      // Attach validated data to context
      context.validated = result.data;
      await this.recordMetric("validation_success");
      await next();
    } catch (error) {
      this.logger.error("Validation error", error as Error);
      context.set.status = 500;
      return {
        error: "Validation service error",
        code: "VALIDATION_SERVICE_ERROR",
      };
    } finally {
      await this.recordTimer(
        "validation_duration",
        performance.now() - startTime
      );
    }
  }
}
```

## Factory Functions for Easy Usage

```typescript
// libs/middleware/src/index.ts
export * from "./types";
export * from "./base";
export * from "./auth";
export * from "./validation";
export * from "./rateLimit";
export * from "./audit";
export * from "./logging";
export * from "./error";

// Factory functions for quick middleware creation
export const createAuthMiddleware = (config: AuthConfig) => {
  return new AuthMiddleware(
    config,
    Logger.getInstance(),
    MetricsCollector.getInstance()
  ).middleware();
};

export const createRateLimitMiddleware = (config: RateLimitConfig) => {
  return new RateLimitMiddleware(
    config,
    Logger.getInstance(),
    MetricsCollector.getInstance()
  ).middleware();
};

export const createValidationMiddleware = (config: ValidationConfig) => {
  return new ValidationMiddleware(
    config,
    Logger.getInstance(),
    MetricsCollector.getInstance()
  ).middleware();
};

// Common configurations
export const commonConfigs = {
  auth: {
    apiGateway: {
      allowAnonymous: true,
      bypassRoutes: ["/health", "/metrics"],
    },
    aiEngine: {
      requiredPermissions: ["predict"],
      apiKeys: new Set(["ai-engine-key-prod-2024"]),
    },
    dataIntelligence: {
      requiredRoles: ["user", "admin"],
      strictMode: true,
    },
  },
  rateLimit: {
    general: { windowMs: 60000, maxRequests: 1000, keyStrategy: "ip" as const },
    strict: { windowMs: 60000, maxRequests: 100, keyStrategy: "user" as const },
    api: { windowMs: 60000, maxRequests: 5000, keyStrategy: "apiKey" as const },
  },
  validation: {
    zod: { engine: "zod" as const, strictMode: true },
    rules: { engine: "rules" as const, sanitizeInputs: true },
  },
};
```

## Integration Examples

```typescript
// Service integration example
import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  commonConfigs,
} from "@libs/middleware";

const authMiddleware = createAuthMiddleware({
  ...commonConfigs.auth.aiEngine,
  requiredPermissions: ["predict", "batch_predict"],
});

const rateLimitMiddleware = createRateLimitMiddleware({
  ...commonConfigs.rateLimit.api,
  maxRequests: 2000, // Override for this service
});

// Apply to Elysia app
app.use(authMiddleware).use(rateLimitMiddleware).post("/predict", handler);
```

## Migration Strategy

### Phase 1: Create Library (Current)

1. Design and implement base classes
2. Create auth, validation, rate limit middleware
3. Set up testing framework

### Phase 2: Parallel Implementation

1. Implement shared middleware alongside existing
2. Create service-specific configurations
3. Test compatibility with existing functionality

### Phase 3: Gradual Migration

1. Start with least complex service (Event Pipeline)
2. Migrate one middleware type at a time
3. Validate functionality and performance

### Phase 4: Cleanup

1. Remove old middleware implementations
2. Optimize shared library based on usage
3. Update documentation and examples

## Benefits

### Immediate

- Reduced code duplication
- Consistent middleware behavior
- Easier testing and debugging

### Long-term

- Faster development of new services
- Centralized security and compliance
- Simplified maintenance and updates
- Better observability and monitoring
