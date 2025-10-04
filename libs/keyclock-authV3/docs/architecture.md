# Architecture

This document describes the system architecture for the ElysiaJS authentication and authorization library.

## Layered Architecture

The library follows a clean layered architecture that separates concerns and enables maintainability:

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

### Application Layer

- **Routes & Controllers**: Define API endpoints and handle HTTP requests
- **WebSocket Handlers**: Manage real-time connections and messaging
- **Request Processing**: Initial request parsing and response formatting

### Middleware Layer

- **AuthenticationMiddleware**: Validates user credentials and tokens
- **AuthorizationMiddleware**: Enforces permission checks on resources
- **RateLimitMiddleware**: Prevents abuse through request throttling

### Service Layer

- **AuthenticationService**: Orchestrates login, logout, and token operations
- **AuthorizationService**: Manages permissions and access control
- **TokenService**: Handles token generation, validation, and refresh

### Manager Layer

- **TokenManager**: JWT validation, parsing, and verification
- **RefreshTokenManager**: Refresh token lifecycle and rotation
- **TokenRevocationService**: Token blacklist management
- **ApiKeyManager**: API key generation, validation, and management
- **SessionManager**: User session lifecycle and state management
- **CaslAbilityBuilder**: CASL permission rule construction
- **PermissionChecker**: Permission evaluation and field-level access

### Infrastructure Layer

- **IdentityProviderInterface**: Abstract interface for identity providers
- **KeycloakIdentityProvider**: Keycloak-specific implementation
- **CacheManager**: Multi-backend caching (Redis/memory)
- **EventBus**: Distributed event messaging
- **StorageAdapter**: Abstract database operations
- **CircuitBreaker**: Fault tolerance for external services

## Component Interaction Flow

### REST API Request Flow

```
Request → AuthMiddleware → CacheCheck → TokenValidation
→ UserContextAttachment → AuthzMiddleware → PermissionCheck
→ RouteHandler → Response
```

1. **Request**: HTTP request enters Elysia application
2. **AuthMiddleware**: Validates authentication (token, API key, session)
3. **CacheCheck**: Checks cached validation results
4. **TokenValidation**: Verifies JWT signature and claims
5. **UserContextAttachment**: Attaches user data to request context
6. **AuthzMiddleware**: Checks permissions for requested action
7. **PermissionCheck**: Evaluates CASL ability rules
8. **RouteHandler**: Executes business logic
9. **Response**: Returns result to client

### WebSocket Connection Flow

```
WSUpgrade → WSAuthHandler → TokenValidation → ConnectionEstablishment
→ MessageReceived → WSAuthzHandler → PermissionCheck → MessageProcessing
```

1. **WSUpgrade**: WebSocket upgrade request received
2. **WSAuthHandler**: Authenticates WebSocket connection
3. **TokenValidation**: Validates provided token
4. **ConnectionEstablishment**: Registers connection in registry
5. **MessageReceived**: WebSocket message arrives
6. **WSAuthzHandler**: Checks message permissions
7. **PermissionCheck**: Validates action on resource
8. **MessageProcessing**: Executes message handler

## Key Design Principles

### Separation of Concerns

Each layer has a specific responsibility:

- **Infrastructure**: External dependencies and data persistence
- **Managers**: Business logic and state management
- **Services**: Orchestration and workflow coordination
- **Middleware**: Cross-cutting concerns (auth, authz, rate limiting)
- **Application**: Request/response handling and routing

### Dependency Inversion

- Higher layers depend on abstractions (interfaces) rather than concrete implementations
- Enables easy testing with mocks and swapping implementations
- Example: StorageAdapter interface allows different database backends

### Single Responsibility

- Each component has one primary responsibility
- Components are small and focused
- Easy to test, maintain, and replace

### Event-Driven Architecture

- Components communicate via events for loose coupling
- EventBus enables cross-instance coordination
- Supports reactive patterns and real-time updates

### Fault Tolerance

- Circuit breakers protect against cascading failures
- Graceful degradation when services are unavailable
- Retry policies with exponential backoff
- Comprehensive error handling and logging

### Security by Design

- Defense in depth with multiple security layers
- Secure defaults with explicit opt-in for less secure options
- Comprehensive audit logging
- Token security with rotation and revocation

## Data Flow Patterns

### Authentication Flow

```
Client → Login Request → AuthService → IdentityProvider
→ Token Generation → Session Creation → Response
```

### Authorization Flow

```
Request → Permission Check → Ability Building → Rule Evaluation
→ Field Filtering → Resource Access
```

### Token Refresh Flow

```
Client → Refresh Request → Token Validation → New Token Generation
→ Old Token Revocation → Response
```

## Scalability Considerations

### Horizontal Scaling

- Stateless services with external state storage
- Distributed caching with Redis
- Event-driven communication between instances
- Load balancing support for WebSocket connections

### Performance Optimization

- Multi-level caching (memory → Redis → database)
- Lazy loading of permissions and user data
- Batch operations for bulk requests
- Connection pooling for external services

### Monitoring & Observability

- Structured logging with correlation IDs
- Metrics collection for all operations
- Health checks for all dependencies
- Distributed tracing support

## Security Architecture

### Authentication Security

- Multi-factor authentication support
- Secure token storage and transmission
- Account lockout and brute force protection
- Session management with fixation prevention

### Authorization Security

- Role-based and attribute-based access control
- Field-level and record-level permissions
- Permission inheritance and hierarchy
- Dynamic permission evaluation

### Data Protection

- Encryption at rest and in transit
- Secure credential storage with hashing
- Token revocation and rotation
- Audit logging for all security events

## Deployment Architecture

### Microservices Integration

- Library designed for microservices environments
- Shared authentication across services
- Centralized session management
- Distributed permission evaluation

### Container & Orchestration

- Docker container support
- Kubernetes deployment manifests
- Health checks and readiness probes
- Configuration management

### Environment Support

- Development, staging, production configurations
- Environment-specific security settings
- Feature flags for gradual rollouts
- Rollback capabilities
