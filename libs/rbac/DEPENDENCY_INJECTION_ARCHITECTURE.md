# RBAC Dependency Injection Architecture

## Phase 1.5 - Dependency Injection Planning

### Overview

This document outlines the dependency injection architecture for the Enterprise RBAC Library. This design ensures clean service composition, testability, and seamless integration with the existing ServiceRegistry pattern used throughout the application.

### Architectural Principles

#### 1. Inversion of Control (IoC)

- **Service Interfaces**: All dependencies defined as interfaces (`IRBACService`, `IUserRoleRepository`, etc.)
- **Constructor Injection**: Primary method for dependency provision
- **Factory Pattern**: Service creation abstracted through factory functions
- **Configuration Injection**: Runtime configuration provided through dependency injection

#### 2. Service Registry Integration

- **Existing Pattern**: Integrate with current ServiceRegistry used across the application
- **Service Resolution**: Leverage existing service resolution mechanisms
- **Lifecycle Management**: Follow established service lifecycle patterns
- **Registration**: Seamless service registration within existing infrastructure

### Dependency Graph

```
RBACService (IRBACService)
├── IUserRoleRepository
├── IRolePermissionRepository
├── IRoleHierarchyRepository
├── IRBACCacheService
│   ├── Redis Client (ioredis)
│   └── Local Cache (LRU)
├── IRBACLogger
├── IRBACMetricsCollector
└── IRBACConfig
```

### Service Factory Pattern

#### Core Factory Interface

```typescript
interface IRBACServiceFactory {
  createRBACService(config: IRBACConfig): IRBACService;
  createCacheService(config: ICacheConfig): IRBACCacheService;
  createRepositories(config: IRepositoryConfig): {
    userRole: IUserRoleRepository;
    rolePermission: IRolePermissionRepository;
    roleHierarchy: IRoleHierarchyRepository;
  };
}
```

#### Configuration-Based Creation

- **Development Mode**: In-memory repositories, console logging, local caching only
- **Production Mode**: Database repositories, structured logging, Redis + local caching
- **Testing Mode**: Mock repositories, test loggers, no external dependencies

### Repository Injection Strategy

#### Database Integration

```typescript
// Repository implementations will be injected based on configuration
interface IRepositoryConfig {
  databaseConnection: DatabaseConnection; // From @libs/database
  transactionManager: TransactionManager;
  queryBuilder: QueryBuilder;
}
```

#### Implementation Variants

- **Prisma Repositories**: Primary implementation using existing Prisma models
- **Mock Repositories**: For testing and development
- **Cached Repositories**: Decorator pattern for caching layer

### Cache Service Injection

#### Multi-Level Caching

```typescript
interface ICacheConfig {
  redis: {
    enabled: boolean;
    connection: RedisConnection;
    keyPrefix: string;
    ttl: number;
  };
  local: {
    enabled: boolean;
    maxSize: number;
    ttl: number;
  };
}
```

#### Cache Strategy

- **L1 Cache**: Local LRU cache for hot data
- **L2 Cache**: Redis distributed cache for shared data
- **Cache Invalidation**: Event-driven cache invalidation
- **Fallback Strategy**: Graceful degradation when cache unavailable

### Middleware Factory Pattern

#### Framework-Agnostic Design

```typescript
interface IMiddlewareFactory {
  createElysiaMiddleware(rbacService: IRBACService): IElysiaRBACMiddleware;
  createGenericMiddleware(rbacService: IRBACService): IRBACMiddleware;
}
```

#### Integration Points

- **Request Context**: Extract user context from framework-specific request objects
- **Error Handling**: Framework-specific error response formatting
- **Performance Monitoring**: Integration with existing monitoring infrastructure

### Configuration Injection

#### Environment-Aware Configuration

```typescript
// Configuration will be resolved at startup based on environment
const configResolver: IConfigResolver = {
  resolve(): IRBACConfig {
    const env = process.env.NODE_ENV || "development";
    const preset = getPresetFromEnv(env);
    const envOverrides = loadRBACConfigFromEnv();
    return mergeRBACConfig(getRBACConfig(preset), envOverrides);
  },
};
```

#### Configuration Validation

- **Startup Validation**: Validate configuration at application startup
- **Runtime Validation**: Validate configuration changes
- **Schema Validation**: Use schema validation for type safety

### Service Registration

#### ServiceRegistry Integration

```typescript
// Integration with existing ServiceRegistry pattern
export function registerRBACServices(registry: ServiceRegistry): void {
  // Register configuration
  registry.register("rbac.config", configResolver.resolve());

  // Register repositories
  const repositories = createRepositories(registry.get("database.connection"));
  registry.register("rbac.repositories.userRole", repositories.userRole);
  registry.register(
    "rbac.repositories.rolePermission",
    repositories.rolePermission
  );
  registry.register(
    "rbac.repositories.roleHierarchy",
    repositories.roleHierarchy
  );

  // Register cache service
  const cacheService = createCacheService({
    redis: registry.get("redis.connection"),
    config: registry.get("rbac.config").cache,
  });
  registry.register("rbac.cache", cacheService);

  // Register main RBAC service
  const rbacService = createRBACService({
    repositories,
    cache: cacheService,
    logger: registry.get("logger"),
    metrics: registry.get("metrics"),
    config: registry.get("rbac.config"),
  });
  registry.register("rbac.service", rbacService);

  // Register middleware factory
  const middlewareFactory = createMiddlewareFactory(rbacService);
  registry.register("rbac.middleware", middlewareFactory);
}
```

### Testing Strategy

#### Dependency Injection for Testing

```typescript
// Test utilities for dependency injection
export const createTestRBACService = (
  overrides?: Partial<IRBACDependencies>
) => {
  const defaultDeps: IRBACDependencies = {
    userRoleRepo: new MockUserRoleRepository(),
    rolePermissionRepo: new MockRolePermissionRepository(),
    roleHierarchyRepo: new MockRoleHierarchyRepository(),
    cache: new MockCacheService(),
    logger: new MockLogger(),
    metrics: new MockMetricsCollector(),
    config: DEV_RBAC_CONFIG,
  };

  return new RBACService({ ...defaultDeps, ...overrides });
};
```

#### Test Isolation

- **Mock Implementations**: Complete mock implementations for all dependencies
- **Test Doubles**: Spy, stub, and fake implementations as needed
- **Integration Testing**: Test with real database but isolated data

### Migration Strategy

#### Gradual Migration

1. **Phase 2.1**: Extract service with dependency injection structure
2. **Phase 2.2**: Replace direct authV2 dependencies with injected dependencies
3. **Phase 2.3**: Migrate middleware to use factory pattern
4. **Phase 2.4**: Update service registration to use new RBAC services

#### Backwards Compatibility

- **Adapter Pattern**: Provide adapters for existing service consumers
- **Feature Flags**: Gradual rollout using feature flags
- **Fallback Strategy**: Fallback to existing authV2 services during migration

### Performance Considerations

#### Lazy Loading

- **Service Creation**: Services created on-demand rather than at startup
- **Repository Connections**: Database connections established lazily
- **Cache Initialization**: Cache services initialized when first accessed

#### Memory Management

- **Service Lifecycle**: Proper cleanup when services are no longer needed
- **Connection Pooling**: Efficient database connection management
- **Cache Memory**: Bounded cache sizes with eviction policies

### Error Handling Strategy

#### Graceful Degradation

- **Repository Failures**: Fallback to cached data or fail-safe defaults
- **Cache Failures**: Continue operation without caching
- **Service Failures**: Isolate failures and maintain system stability

#### Error Propagation

- **Service Layer**: Structured error types for different failure modes
- **Middleware Layer**: Framework-appropriate error responses
- **Application Layer**: Actionable error information for consumers

---

## Implementation Checklist

### Phase 1.5 Tasks (Dependency Injection Planning)

- [x] **Architecture Design**: Complete dependency injection architecture
- [x] **Service Factory Pattern**: Define factory interfaces and creation strategies
- [x] **Repository Injection**: Plan database integration and repository patterns
- [x] **Cache Service Injection**: Design multi-level cache dependency strategy
- [x] **Middleware Factory**: Plan framework-agnostic middleware creation
- [x] **Configuration Injection**: Design environment-aware configuration resolution
- [x] **ServiceRegistry Integration**: Plan integration with existing service infrastructure
- [x] **Testing Strategy**: Design dependency injection for comprehensive testing
- [x] **Migration Strategy**: Plan gradual migration with backwards compatibility
- [x] **Performance Considerations**: Plan lazy loading and memory management
- [x] **Error Handling**: Design graceful degradation and error propagation

### Next Phase (Phase 2.1)

- [ ] Extract PermissionServiceV2 enterprise logic to RBACService
- [ ] Implement dependency injection structure
- [ ] Create service factory implementations
- [ ] Test dependency injection architecture

---

**Phase 1 Status**: ✅ **COMPLETE**

- Architecture Design & Interface Definition completed
- Comprehensive dependency injection planning finished
- Ready to proceed to Phase 2 - Core RBAC Service Extraction

**Key Deliverables**:

1. Complete RBAC interface definitions with all enterprise features
2. Framework-agnostic middleware contracts
3. Configuration system with environment presets
4. Comprehensive dependency injection architecture
5. ServiceRegistry integration strategy
6. Testing and migration strategies

**Extraction Progress**: Ready for Phase 2 implementation with solid architectural foundation ensuring all 1,354 lines of PermissionServiceV2 enterprise logic will be preserved while achieving clean separation from authV2 middleware coupling.
