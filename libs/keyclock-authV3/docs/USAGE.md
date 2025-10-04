# Authentication & Authorization Library for ElysiaJS Microservices

**Complete Functional Specification v2.0**

[![Documentation](https://img.shields.io/badge/docs-complete-green)](docs/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A production-ready authentication and authorization library for ElysiaJS microservices built on Bun runtime. The library provides comprehensive auth capabilities including user authentication, token management, permission control, and session management for both REST APIs and WebSocket connections.

## 🚀 Quick Start

```bash
# Install the library
pnpm add @your-org/elysia-auth

# Basic setup
import { AuthPlugin } from '@your-org/elysia-auth'

const app = new Elysia()
  .use(AuthPlugin.install(app, {
    identityProvider: {
      type: 'keycloak',
      config: { /* Keycloak config */ }
    },
    token: { /* Token config */ },
    session: { /* Session config */ }
  }))

// Protected route
app.get('/protected', ({ user }) => ({
  message: `Hello ${user.username}!`
}), {
  beforeHandle: authenticate()
})
```

## 📚 Documentation

### Core Documentation

- **[Architecture Overview](docs/architecture.md)** - System design and component interactions
- **[Components](docs/components/)** - Detailed component specifications
- **[Integration Patterns](docs/integration/)** - Usage examples and patterns

### Component Specifications

- **[Infrastructure](docs/components/infrastructure.md)** - Core infrastructure components
- **[Managers](docs/components/managers.md)** - Business logic managers
- **[Services](docs/components/services.md)** - Service layer APIs
- **[Middleware](docs/components/middleware.md)** - ElysiaJS middleware
- **[Handlers](docs/components/handlers.md)** - Request handlers
- **[Utilities](docs/components/utilities.md)** - Utility components

### Advanced Topics

- **[WebSocket Support](docs/websocket/)** - Real-time authentication
- **[Security & Resilience](docs/security/)** - Security considerations and fault tolerance
- **[Monitoring](docs/monitoring/)** - Observability and metrics
- **[API Reference](docs/api/)** - Complete API documentation

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│ ElysiaJS Application Layer │
│ (Routes, Controllers, WebSocket Handlers) │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Middleware Layer │
│ (Authentication, Authorization, Rate Limiting) │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Service Layer │
│ (AuthService, TokenService, PermissionService) │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Manager Layer │
│ (Token, Session, ApiKey, Permission Managers) │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Infrastructure Layer │
│ (Cache, Storage, Identity Provider, EventBus) │
└─────────────────────────────────────────────────┘
```

## ✨ Key Features

- **🔐 Multiple Authentication Methods**: Password, JWT tokens, API keys
- **🎫 Advanced Token Management**: Generation, refresh, rotation, revocation
- **👥 Role-Based & Attribute-Based Permissions**: CASL integration
- **📊 Session Management**: Distributed sessions with Redis/PostgreSQL
- **🔌 WebSocket Authentication**: Real-time connection auth & authorization
- **🏢 Multi-Tenant Support**: Complete tenant isolation
- **📈 Horizontal Scalability**: Load-balanced, distributed architecture
- **🛡️ Fault Tolerance**: Circuit breakers, graceful degradation
- **📋 Comprehensive Auditing**: Full audit trail with retention
- **📊 Real-Time Monitoring**: Metrics, health checks, alerting

## 🛠️ Core Technologies

- **Runtime**: Bun
- **Framework**: ElysiaJS
- **Identity Provider**: Keycloak (pluggable)
- **Authorization**: CASL (Attribute-Based Access Control)
- **Caching**: Redis (primary), In-memory (fallback)
- **Storage**: Redis/PostgreSQL for sessions and tokens
- **Database**: PostgreSQL (primary data), ClickHouse (analytics)
- **Message Bus**: Redis pub/sub for distributed events

## 📦 Installation

```bash
# Using pnpm (recommended)
pnpm add @your-org/elysia-auth

# Using npm
npm install @your-org/elysia-auth

# Using yarn
yarn add @your-org/elysia-auth
```

## 🔧 Basic Configuration

```typescript
import { AuthPlugin } from "@your-org/elysia-auth";

const app = new Elysia().use(
  AuthPlugin.install(app, {
    identityProvider: {
      type: "keycloak",
      config: {
        serverUrl: "https://keycloak.example.com",
        realm: "my-realm",
        clientId: "my-client",
        clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
      },
    },
    token: {
      issuer: "my-app",
      audience: "my-api",
      accessTokenTTL: 900, // 15 minutes
      refreshTokenTTL: 2592000, // 30 days
    },
    session: {
      storage: "redis",
      ttl: 3600, // 1 hour
    },
    cache: {
      backend: "redis",
      redisUrl: process.env.REDIS_URL,
    },
  })
);
```

## 🎯 Usage Examples

### REST API Authentication

```typescript
// Public route
app.get("/public", () => "Hello World");

// Protected route (requires authentication)
app.get(
  "/protected",
  ({ user }) => ({
    message: `Hello ${user.username}!`,
  }),
  {
    beforeHandle: authenticate(),
  }
);

// Role-based access
app.get("/admin", ({ user }) => "Admin Panel", {
  beforeHandle: [authenticate(), requireRole("admin")],
});

// Permission-based access
app.get("/users", ({ user, authz }) => users, {
  beforeHandle: [
    authenticate(),
    authorize({ action: "read", subject: "User" }),
  ],
});
```

### WebSocket Authentication

```typescript
app.ws("/realtime", {
  upgrade: async ({ request }) => {
    const authResult = await wsAuthHandler.authenticateConnection(request);
    if (!authResult.authenticated) {
      throw new Error("Unauthorized");
    }
    return { user: authResult.user };
  },
  open: (ws) => {
    console.log("Connected:", ws.data.user.username);
  },
  message: async (ws, message) => {
    // Handle authenticated WebSocket messages
  },
});
```

### API Key Authentication

```typescript
// Generate API key
app.post("/apikeys", async ({ user, body }) => {
  return await apiKeyManager.generateApiKey(
    user.userId,
    body.scopes || ["read:*"],
    { name: body.name }
  );
});

// Use API key
app.get("/api/data", ({ user }) => getData(user.userId), {
  beforeHandle: authenticate({ strategies: ["apikey"] }),
});
```

## 🔒 Security Features

- **Token Security**: Short-lived access tokens, refresh token rotation
- **Session Security**: Secure cookies, session hijacking detection
- **API Key Security**: Cryptographically secure generation, scoped permissions
- **Password Security**: Strong policy enforcement, breach detection
- **OWASP Compliance**: Mitigations for top 10 security risks
- **Audit Logging**: Comprehensive security event tracking

## 📊 Monitoring & Observability

- **Metrics Collection**: Authentication, authorization, and system metrics
- **Health Checks**: Component-level health monitoring
- **Structured Logging**: JSON logging with correlation IDs
- **Alerting**: Configurable alerts for security and system events
- **Performance Monitoring**: Response times, throughput, error rates

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and contribution guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 📞 Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](../../issues)
- **Discussions**: [GitHub Discussions](../../discussions)

---

**Built with ❤️ for the ElysiaJS ecosystem**
