# @libs/elysia-server

A shared library for creating Elysia-based microservices with consistent configuration, middleware, and best practices.

## Features

- ✅ **Consistent Server Setup** - Standardized Elysia server configuration
- 📚 **Built-in Swagger** - Automatic API documentation
- 🛡️ **CORS Support** - Configurable cross-origin resource sharing
- ⚡ **Rate Limiting** - Built-in rate limiting with Redis fallback
- 📝 **Request Logging** - Comprehensive request/response logging
- 🚨 **Error Handling** - Standardized error handling and responses
- 🔧 **Type Safety** - Full TypeScript support
- 🏃 **Quick Start** - Minimal boilerplate for new services

## Quick Start

### Basic Usage

```typescript
import { createElysiaServer } from "@libs/elysia-server";

const { app, server } = createElysiaServer(
  {
    name: "My Service",
    port: 3000,
    version: "1.0.0",
  },
  (app) => {
    return app
      .get("/", () => ({ message: "Hello World!" }))
      .post("/api/data", ({ body }) => {
        // Handle your business logic
        return { success: true, data: body };
      });
  }
).start();
```

### Advanced Configuration

```typescript
import { createElysiaServer } from "@libs/elysia-server";

const { app, server } = createElysiaServer(
  {
    name: "Advanced Service",
    port: 3001,
    version: "2.0.0",
    description: "A more complex microservice",

    // Swagger configuration
    swagger: {
      enabled: true,
      path: "/docs",
      title: "My API",
      description: "Custom API documentation",
    },

    // CORS configuration
    cors: {
      origin: ["http://localhost:3000", "https://myapp.com"],
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE"],
    },

    // Rate limiting
    rateLimiting: {
      enabled: true,
      requests: 500,
      windowMs: 60000, // 1 minute
      skipPaths: ["/health", "/docs"],
    },

    // Logging
    logging: {
      enabled: true,
      level: "info",
    },
  },
  (app) => {
    // Your routes here
    return app.get("/", () => ({ status: "advanced" }));
  }
).start();
```

## Configuration Options

### ServerConfig

```typescript
interface ServerConfig {
  port: number;
  name: string;
  version: string;
  description?: string;

  cors?: {
    origin?: string | string[];
    credentials?: boolean;
    methods?: string[];
    allowedHeaders?: string[];
  };

  swagger?: {
    enabled?: boolean;
    path?: string;
    title?: string;
    version?: string;
    description?: string;
  };

  rateLimiting?: {
    enabled?: boolean;
    requests?: number;
    windowMs?: number;
    skipPaths?: string[];
  };

  logging?: {
    enabled?: boolean;
    level?: "debug" | "info" | "warn" | "error";
  };
}
```

## Default Configuration

```typescript
{
  port: 3000,
  version: "1.0.0",
  cors: {
    origin: ["http://localhost:3000"],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
  },
  swagger: {
    enabled: true,
    path: "/swagger",
  },
  rateLimiting: {
    enabled: true,
    requests: 1000,
    windowMs: 60000,
    skipPaths: ["/swagger", "/swagger/", "/health", "/docs"],
  },
  logging: {
    enabled: true,
    level: "info",
  },
}
```

## Built-in Endpoints

Every service automatically gets:

- `GET /health` - Health check endpoint
- `GET /swagger` - API documentation (if enabled)

## Creating New Microservices

Use the provided generator script:

```bash
./scripts/create-microservice.sh my-service 3002
```

This creates a complete microservice with:

- ✅ Package.json with correct dependencies
- ✅ TypeScript configuration
- ✅ Dockerfile
- ✅ Sample routes and documentation
- ✅ Ready to run with `pnpm dev`

## Examples

### Event Processing Service

```typescript
import { t } from "elysia";
import { createElysiaServer } from "@libs/elysia-server";

createElysiaServer(
  {
    name: "Event Processor",
    port: 3001,
    rateLimiting: { requests: 500 }, // Lower limit for processing
  },
  (app) => {
    return app.post(
      "/events",
      ({ body }) => {
        // Process events
        console.log("Processing event:", body);
        return { status: "processed", id: Date.now() };
      },
      {
        body: t.Object({
          type: t.String(),
          data: t.Any(),
        }),
      }
    );
  }
).start();
```

### Authentication Service

```typescript
createElysiaServer(
  {
    name: "Auth Service",
    port: 3003,
    rateLimiting: { requests: 100, windowMs: 60000 }, // Strict limiting
  },
  (app) => {
    return app
      .post("/login", ({ body }) => {
        // Handle login
        return { token: "jwt-token", expires: Date.now() + 3600000 };
      })
      .post("/register", ({ body }) => {
        // Handle registration
        return { success: true, userId: "user-123" };
      });
  }
).start();
```

## Benefits

1. **Consistency** - All microservices follow the same patterns
2. **Reduced Boilerplate** - Focus on business logic, not setup
3. **Best Practices** - Built-in security, logging, and monitoring
4. **Type Safety** - Full TypeScript support throughout
5. **Documentation** - Automatic Swagger documentation
6. **Rapid Development** - New services in minutes, not hours

## Migration from Raw Elysia

**Before:**

```typescript
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";

const app = new Elysia({ adapter: node() })
  .use(
    cors({
      /* config */
    })
  )
  .use(
    swagger({
      /* config */
    })
  )
  .get("/", () => ({ message: "Hello" }))
  .listen(3000);
```

**After:**

```typescript
import { createElysiaServer } from "@libs/elysia-server";

createElysiaServer(
  {
    name: "My Service",
    port: 3000,
  },
  (app) => {
    return app.get("/", () => ({ message: "Hello" }));
  }
).start();
```

Much cleaner and more maintainable! 🚀
