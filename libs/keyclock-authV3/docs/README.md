# ElysiaJS Authentication Library Documentation

A comprehensive authentication and authorization library for ElysiaJS applications with Keycloak integration, multi-modal authentication, and enterprise-grade security features.

## 📚 Documentation Structure

This documentation has been organized into focused modules for better navigation and maintainability:

### 🏗️ Architecture & Overview

- **[Main README](../README.md)** - Project overview, installation, and quick start
- **[Architecture](architecture.md)** - System architecture, design patterns, and component interactions

### 🧩 Core Components

#### [Components](components/)

- **[Infrastructure](components/infrastructure.md)** - Identity providers, caching, storage, and circuit breakers
- **[Managers](components/managers.md)** - Token management, API keys, sessions, and permissions
- **[Services](components/services.md)** - Authentication, authorization, and user management services
- **[Middleware](components/middleware.md)** - Authentication and authorization middleware layers
- **[Handlers](components/handlers.md)** - Route handlers and request processing
- **[Utilities](components/utilities.md)** - Helper functions and common utilities

### 🌐 WebSocket Support

#### [WebSocket](websocket/)

- **[WebSocket Overview](websocket/README.md)** - WebSocket authentication and real-time features
- **[Connection Manager](websocket/connection-manager.md)** - WebSocket connection lifecycle management
- **[Auth Middleware](websocket/auth-middleware.md)** - WebSocket authentication middleware
- **[AuthZ Middleware](websocket/authz-middleware.md)** - WebSocket authorization middleware
- **[Message Handler](websocket/message-handler.md)** - WebSocket message processing and routing
- **[Subscription Manager](websocket/subscription-manager.md)** - Real-time subscription management

### 🔒 Security & Resilience

#### [Security](security/)

- **[Security Overview](security/README.md)** - Security architecture and principles
- **[Threat Model](security/threat-model.md)** - Threat modeling with STRIDE framework
- **[Security Controls](security/security-controls.md)** - Authentication, authorization, and cryptography controls
- **[Incident Response](security/incident-response.md)** - Incident detection, response, and recovery procedures
- **[Compliance](security/compliance.md)** - GDPR, SOX, HIPAA compliance and audit capabilities
- **[Key Management](security/key-management.md)** - Cryptographic key lifecycle and management
- **[Resilience](security/resilience.md)** - Fault tolerance, disaster recovery, and high availability

## 🚀 Quick Start

```bash
# Install the library
pnpm add @your-org/elysia-auth

# Basic setup
import { createAuthService } from '@your-org/elysia-auth';

const auth = createAuthService({
  keycloak: { /* config */ },
  redis: { /* config */ },
  database: { /* config */ }
});

// Use in Elysia app
app.use(auth.middleware());
```

## 📖 Key Features

- **Multi-modal Authentication**: JWT, API keys, sessions, and anonymous access
- **Keycloak Integration**: Enterprise SSO with role-based access control
- **CASL Authorization**: Granular permission management with ability-based authorization
- **WebSocket Support**: Real-time authentication for WebSocket connections
- **Enterprise Security**: Audit logging, rate limiting, threat detection
- **High Availability**: Circuit breakers, failover, and disaster recovery
- **Compliance Ready**: GDPR, SOX, HIPAA compliance with audit trails

## 🏛️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │    │   Middleware    │    │    Services     │
│   Layer         │◄──►│   Layer         │◄──►│    Layer        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Managers      │    │   Handlers      │    │  Infrastructure │
│   Layer         │◄──►│   Layer         │◄──►│    Layer        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Layer Responsibilities

- **Application**: Elysia route definitions and business logic
- **Middleware**: Authentication, authorization, and request processing
- **Services**: Core business logic and domain operations
- **Managers**: Resource management and coordination
- **Handlers**: Request/response processing and validation
- **Infrastructure**: External integrations and data persistence

## 🔧 Configuration

```typescript
interface AuthConfig {
  // Keycloak integration
  keycloak: {
    realm: string;
    clientId: string;
    clientSecret: string;
    serverUrl: string;
  };

  // Security settings
  security: {
    jwtSecret: string;
    apiKeyEncryptionKey: string;
    sessionTimeout: number;
  };
}
```

## 📊 Monitoring & Observability

The library provides comprehensive monitoring capabilities:

- **Metrics Collection**: Request latency, error rates, authentication success/failure
- **Audit Logging**: All authentication and authorization events
- **Health Checks**: Service availability and dependency health
- **Alerting**: Configurable alerts for security events and system issues

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run specific test suites
pnpm test -- --testPathPattern=auth
pnpm test -- --testPathPattern=websocket
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

## 📞 Support

- **Documentation**: This comprehensive documentation
- **Issues**: [GitHub Issues](../../issues)
- **Discussions**: [GitHub Discussions](../../discussions)
- **Security**: For security issues, please email security@your-org.com

---

_This documentation is automatically generated from the source code and maintained alongside the codebase._
