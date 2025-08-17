# Middleware Inventory Analysis

## Services Analyzed

### 1. API Gateway
**Location**: `apps/api-gateway/src/middleware/`
**Middleware Found**:
- **Request Middleware** (`request-middleware.ts`)
  - Request logging (onBeforeHandle, onAfterHandle)
  - Rate limiting using @libs/monitoring RateLimiter
  - Request ID generation using @libs/utils generateId
  - IP extraction from headers
  - Rate limit bypass for configured paths

- **Error Middleware** (`error-middleware.ts`)
  - Global error handling (onError)
  - AppError handling with custom status codes
  - Request ID generation for errors
  - Error logging with context

### 2. AI Engine
**Location**: `apps/ai-engine/src/middleware/`
**Middleware Found**:
- **Validation Middleware** (`validation.middleware.ts`)
  - Comprehensive Zod-based validation
  - Business logic validation
  - Request size checking
  - Input sanitization
  - Performance tracking with metrics
  - Custom validation schemas for AI endpoints

- **Audit Middleware** (`audit.middleware.ts`)
  - Comprehensive request/response tracking
  - Ring buffer for in-memory audit trail
  - Metrics collection and performance tracking
  - Event-based auditing system
  - Sensitive data sanitization

- **Auth Middleware** (`auth.middleware.ts`)
  - API key and JWT token authentication
  - Permission-based access control
  - Role-based authorization
  - Route permission mapping
  - Custom error classes (AuthError, PermissionError)

- **Rate Limit Middleware** (`rateLimit.middleware.ts`)
  - Redis-based rate limiting
  - Multiple rate limit strategies (IP, user, API key, model-specific)
  - Configurable windows and limits
  - Standard headers and error responses
  - Pre-configured limiters for different endpoints

### 3. Data Intelligence
**Location**: `apps/data-intelligence/src/middleware/`
**Middleware Found**:
- **Validation Middleware** (`validation.middleware.ts`)
  - Rule-based validation system
  - Support for string, number, boolean, object, array types
  - Custom validation functions
  - Pre-built schemas for common operations
  - Error aggregation and detailed reporting

- **Rate Limit Middleware** (`rateLimit.middleware.ts`)
  - Redis-based rate limiting
  - Configurable key generators (IP, user, API key)
  - Pre-configured limiters for different operations
  - Headers and error response standardization
  - Fail-open approach for reliability

- **Auth Middleware** (`auth.middleware.ts`)
  - Integration with SecurityService
  - Role and permission-based access control
  - Token and API key authentication
  - Anonymous access support
  - Context enrichment with user data

- **Audit Middleware** (`audit.middleware.ts`)
  - Dual storage (Redis + ClickHouse)
  - Comprehensive event tracking
  - Data sanitization and privacy protection
  - Query and summary capabilities
  - Action-specific audit middleware

### 4. Event Pipeline
**Location**: `apps/event-pipeline/src/`
**Middleware Found**: **NONE**
- Uses @libs/elysia-server for server creation
- Built-in rate limiting and WebSocket support
- No custom middleware implementation

## Common Patterns Identified

### 1. **Logging & Request Tracking**
- All services implement request logging
- Request ID generation is common
- Performance tracking with start/end times
- Context enrichment for debugging

### 2. **Rate Limiting**
- Redis-based rate limiting is standard
- Sliding window approach
- IP, user, and API key-based limiting
- Standard headers (X-RateLimit-*)
- Configurable limits and windows

### 3. **Authentication & Authorization**
- API key authentication
- JWT token validation
- Role-based access control (RBAC)
- Permission checking
- Route-specific requirements

### 4. **Validation**
- Request body validation
- Query parameter validation
- Type checking and business rules
- Custom validation functions
- Error aggregation and reporting

### 5. **Audit & Compliance**
- Request/response tracking
- User action logging
- Sensitive data sanitization
- Multiple storage backends
- Query and reporting capabilities

### 6. **Error Handling**
- Centralized error processing
- Custom error types
- Structured error responses
- Request context in errors
- Error metrics tracking

## Duplication Analysis

### High Duplication
1. **Rate Limiting Logic**: Nearly identical implementations across AI Engine and Data Intelligence
2. **Request Logging**: Similar patterns in API Gateway and other services
3. **Error Response Structure**: Consistent error format across services
4. **Authentication Flow**: Similar API key and token validation

### Medium Duplication
1. **Validation Patterns**: Different libraries (Zod vs custom) but similar concepts
2. **Audit Event Structure**: Common fields and patterns
3. **Headers Management**: Similar header setting and reading

### Service-Specific Requirements

### AI Engine
- Model-specific rate limiting
- ML prediction validation schemas
- Feature computation tracking
- Cache invalidation patterns

### Data Intelligence
- GDPR compliance auditing
- Export operation limiting
- Business intelligence tracking
- Data quality validation

### API Gateway
- Proxy-specific logging
- Service discovery integration
- WebSocket connection tracking
- Route-based rate limiting

### Event Pipeline
- Minimal middleware (relies on @libs/elysia-server)
- Event-specific validation
- Stream processing patterns
- Real-time processing requirements

## Standardization Opportunities

### Immediate Wins
1. **Rate Limiting**: Identical patterns can be unified
2. **Request Logging**: Common logging middleware
3. **Error Handling**: Standardize error response format
4. **Basic Authentication**: Common API key/token validation

### Service-Specific Adaptations Needed
1. **Validation**: Keep domain-specific schemas but unify validation engine
2. **Audit**: Common base with service-specific extensions
3. **Authorization**: Unified RBAC with service-specific permissions

### New Middleware Needed for Event Pipeline
1. Basic authentication middleware
2. Request validation middleware
3. Audit middleware for compliance
4. Custom error handling

## Technology Dependencies

### Common Libraries Used
- `@libs/monitoring` - Logger, MetricsCollector, RateLimiter
- `@libs/database` - RedisClient, ClickHouseClient
- `@libs/utils` - generateId, AppError
- `@libs/elysia-server` - Context, server utilities

### Validation Libraries
- **Zod** (AI Engine) - Type-safe schema validation
- **Custom Rules** (Data Intelligence) - Flexible rule-based validation

### Storage Backends
- **Redis** - Rate limiting, caching, session storage
- **ClickHouse** - Audit events, analytics
- **In-Memory** - Ring buffers, temporary storage

## Next Steps

1. Design unified middleware library structure
2. Create common interfaces and base classes
3. Implement shared middleware modules
4. Create migration strategy for each service
5. Add missing middleware to Event Pipeline service