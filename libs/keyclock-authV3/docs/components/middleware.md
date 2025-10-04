# Middleware Layer

The Middleware Layer provides Elysia.js middleware that integrates authentication and authorization into HTTP request processing. Middleware handles request preprocessing, security enforcement, and response postprocessing.

## 3.4.1 AuthenticationMiddleware

**Purpose:** Handle authentication for incoming HTTP requests using multiple authentication methods.

**Responsibilities:**

- Extract and validate authentication credentials
- Support multiple authentication schemes (JWT, API Key, Basic Auth)
- Enforce authentication requirements
- Handle authentication failures gracefully
- Set request context with authenticated user
- Support optional authentication for public endpoints

**Authentication Methods:**

1. **JWT Bearer Token:** `Authorization: Bearer <token>`
2. **API Key:** `X-API-Key: <key>` or `Authorization: Bearer <key>`
3. **Basic Auth:** `Authorization: Basic <base64>`
4. **Session Cookie:** `sessionId` cookie
5. **Anonymous:** No authentication required

**Functions:**

```typescript
createAuthMiddleware(config: AuthMiddlewareConfig): ElysiaMiddleware
```

Create authentication middleware instance

- Configure authentication methods
- Setup error handling
- **Parameters:** `{ methods: AuthMethod[], required: boolean, optionalRoutes: string[], bypassRoutes: string[] }`
- **Returns:** Elysia middleware function
- Methods: ['jwt', 'apiKey', 'basic', 'session', 'anonymous']

```typescript
authenticateRequest(context: ElysiaContext): Promise<AuthResult>
```

Authenticate incoming request

- Try each configured method in order
- Set user context on success
- Handle authentication failures
- **Parameters:** Elysia context object
- **Returns:** `{ authenticated: boolean, user?: AuthUser, method?: string, error?: AuthError }`
- Stops at first successful authentication

```typescript
extractBearerToken(context: ElysiaContext): string | null
```

Extract JWT token from Authorization header

- Check for `Bearer <token>` format
- **Parameters:** Elysia context
- **Returns:** token string or null
- Validates basic format (not signature)

```typescript
extractApiKey(context: ElysiaContext): string | null
```

Extract API key from request

- Check `X-API-Key` header first
- Fallback to `Authorization: Bearer <key>`
- **Parameters:** Elysia context
- **Returns:** API key string or null

```typescript
extractBasicAuth(context: ElysiaContext): BasicCredentials | null
```

Extract Basic Auth credentials

- Decode base64 Authorization header
- Parse username:password format
- **Parameters:** Elysia context
- **Returns:** `{ username: string, password: string }` or null

```typescript
extractSessionId(context: ElysiaContext): string | null
```

Extract session ID from cookie

- Check `sessionId` cookie
- Validate cookie format
- **Parameters:** Elysia context
- **Returns:** session ID string or null

```typescript
validateJwtToken(token: string, context: ElysiaContext): Promise<AuthUser | null>
```

Validate JWT token and extract user

- Verify token signature and claims
- Check token revocation
- Extract user information
- **Parameters:** token string, Elysia context
- **Returns:** authenticated user or null
- Sets user context in request

```typescript
validateApiKeyAuth(apiKey: string, context: ElysiaContext): Promise<AuthUser | null>
```

Validate API key authentication

- Verify API key format and checksum
- Check key permissions and expiration
- Track usage metrics
- **Parameters:** API key string, Elysia context
- **Returns:** authenticated user or null

```typescript
validateBasicAuth(credentials: BasicCredentials, context: ElysiaContext): Promise<AuthUser | null>
```

Validate Basic Auth credentials

- Authenticate against identity provider
- Handle password verification
- **Parameters:** credentials object, Elysia context
- **Returns:** authenticated user or null

```typescript
validateSessionAuth(sessionId: string, context: ElysiaContext): Promise<AuthUser | null>
```

Validate session-based authentication

- Verify session exists and is active
- Check session expiration
- Update session access time
- **Parameters:** session ID, Elysia context
- **Returns:** authenticated user or null

```typescript
handleAuthFailure(error: AuthError, context: ElysiaContext): Promise<void>
```

Handle authentication failures

- Set appropriate HTTP status codes
- Return error responses
- Log security events
- **Parameters:** authentication error, Elysia context
- Status codes: 401 (unauthorized), 403 (forbidden), 429 (rate limited)

```typescript
setAuthContext(context: ElysiaContext, user: AuthUser, method: string): void
```

Set authenticated user context

- Store user in request context
- Set authentication method used
- Make user available to downstream middleware
- **Parameters:** Elysia context, authenticated user, auth method

```typescript
isRouteExcluded(path: string, config: AuthMiddlewareConfig): boolean
```

Check if route should bypass authentication

- Match against bypass patterns
- Support wildcards and regex
- **Parameters:** request path, middleware config
- **Returns:** boolean
- Examples: '/health', '/public/\*', '/api/v1/webhooks'

```typescript
getAuthMethods(): AuthMethod[]
```

Get configured authentication methods

- **Returns:** array of enabled auth methods
- Used for logging and debugging

```typescript
logAuthEvent(event: AuthEvent, context: ElysiaContext): void
```

Log authentication events

- Successful authentications
- Failed attempts
- Security violations
- **Parameters:** event object, Elysia context
- Events: 'auth_success', 'auth_failure', 'token_expired', 'invalid_key'

## 3.4.2 AuthorizationMiddleware

**Purpose:** Enforce authorization policies and permission checks on authenticated requests.

**Responsibilities:**

- Check user permissions for requested actions
- Enforce role-based access control
- Filter responses based on permissions
- Handle authorization failures
- Provide detailed permission error messages
- Support field-level and resource-level permissions

**Authorization Flow:**

1. **Extract Context:** Get user, action, resource from request
2. **Check Permissions:** Evaluate user permissions against requirements
3. **Apply Filters:** Filter response data based on permissions
4. **Handle Denials:** Return appropriate error responses

**Functions:**

```typescript
createAuthzMiddleware(config: AuthzMiddlewareConfig): ElysiaMiddleware
```

Create authorization middleware instance

- Configure permission requirements
- Setup error handling
- **Parameters:** `{ requiredPermissions: string[], resourceType: string, action: string, fieldPermissions?: FieldPermission[] }`

```typescript
authorizeRequest(context: ElysiaContext): Promise<AuthzResult>
```

Authorize request based on user permissions

- Extract action and resource from request
- Check user permissions
- Apply field-level restrictions
- **Parameters:** Elysia context
- **Returns:** `{ authorized: boolean, reason?: string, allowedFields?: string[] }`

```typescript
extractActionFromRequest(context: ElysiaContext): string
```

Determine action from HTTP method and path

- Map HTTP methods to actions
- Handle custom action mappings
- **Parameters:** Elysia context
- **Returns:** action string ('read', 'write', 'delete', 'manage')
- Mappings: GET→read, POST→write, PUT→write, DELETE→delete

```typescript
extractResourceFromRequest(context: ElysiaContext, resourceType: string): any
```

Extract resource instance from request

- Parse path parameters
- Get resource from request body/query
- **Parameters:** Elysia context, resource type
- **Returns:** resource object or resource ID
- Supports nested resources and relationships

```typescript
checkUserPermissions(user: AuthUser, action: string, resource: any, context: ElysiaContext): Promise<PermissionCheck>
```

Check if user has required permissions

- Build user ability
- Evaluate permissions
- Check conditions and ownership
- **Parameters:** user, action, resource, Elysia context
- **Returns:** `{ allowed: boolean, reason?: string, missingPermissions?: string[] }`

```typescript
filterResponseByPermissions(response: any, user: AuthUser, allowedFields: string[]): any
```

Filter response data based on field permissions

- Remove unauthorized fields
- Handle nested objects and arrays
- **Parameters:** response data, user, allowed field names
- **Returns:** filtered response object
- Preserves data structure

```typescript
handleAuthzFailure(error: AuthzError, context: ElysiaContext): Promise<void>
```

Handle authorization failures

- Set HTTP 403 status
- Return permission error details
- Log authorization denials
- **Parameters:** authorization error, Elysia context

```typescript
applyFieldLevelAuthz(data: any, user: AuthUser, fieldRules: FieldRule[]): any
```

Apply field-level authorization rules

- Check each field individually
- Apply conditional field access
- **Parameters:** data object, user, field permission rules
- **Returns:** data with unauthorized fields removed/nullified

```typescript
checkResourceOwnership(resource: any, user: AuthUser, ownerField?: string): boolean
```

Check if user owns the resource

- Compare user ID with resource owner
- Handle different ownership models
- **Parameters:** resource, user, owner field name (default 'userId')
- **Returns:** boolean

```typescript
getRequiredPermissionsForRoute(path: string, method: string): string[]
```

Get permissions required for route

- Lookup route permission requirements
- Support parameterized permissions
- **Parameters:** route path, HTTP method
- **Returns:** array of required permission strings

```typescript
validatePermissionFormat(permission: string): boolean
```

Validate permission string format

- Check action:subject format
- Validate known actions and subjects
- **Parameters:** permission string
- **Returns:** boolean

```typescript
logAuthzEvent(event: AuthzEvent, context: ElysiaContext): void
```

Log authorization events

- Permission checks
- Access denials
- Field filtering
- **Parameters:** event object, Elysia context

```typescript
createPermissionMiddleware(permissions: string[]): ElysiaMiddleware
```

Create middleware for specific permissions

- Shortcut for common permission checks
- **Parameters:** required permissions array
- **Returns:** Elysia middleware function

```typescript
bypassAuthzForPublicRoutes(context: ElysiaContext): boolean
```

Check if route should bypass authorization

- Public routes and health checks
- **Parameters:** Elysia context
- **Returns:** boolean

## 3.4.3 RateLimitMiddleware

**Purpose:** Implement rate limiting to protect against abuse and ensure fair resource usage.

**Responsibilities:**

- Track request rates per client
- Enforce rate limits with different strategies
- Provide rate limit headers in responses
- Handle rate limit violations gracefully
- Support distributed rate limiting with Redis
- Allow burst handling and gradual backoff

**Rate Limiting Strategies:**

1. **Fixed Window:** Requests per time window
2. **Sliding Window:** Rolling time window
3. **Token Bucket:** Burst handling with sustained rate
4. **Leaky Bucket:** Smooth rate enforcement

**Functions:**

```typescript
createRateLimitMiddleware(config: RateLimitConfig): ElysiaMiddleware
```

Create rate limiting middleware

- Configure limits and strategies
- Setup storage backend
- **Parameters:** `{ windowMs: number, maxRequests: number, strategy: 'fixed'|'sliding'|'token-bucket', keyGenerator?: Function }`

```typescript
checkRateLimit(context: ElysiaContext): Promise<RateLimitResult>
```

Check if request exceeds rate limit

- Generate client key
- Check current request count
- Apply rate limiting algorithm
- **Parameters:** Elysia context
- **Returns:** `{ allowed: boolean, remaining: number, resetTime: Date, retryAfter?: number }`

```typescript
generateClientKey(context: ElysiaContext): string
```

Generate unique key for rate limiting

- Use IP address by default
- Support user ID, API key, or custom keys
- **Parameters:** Elysia context
- **Returns:** client identifier string
- Examples: 'ip:192.168.1.1', 'user:123', 'apikey:abc123'

```typescript
enforceFixedWindowLimit(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult>
```

Apply fixed window rate limiting

- Count requests in current window
- Reset at window boundaries
- **Parameters:** client key, window duration, max requests
- **Returns:** rate limit result

```typescript
enforceSlidingWindowLimit(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult>
```

Apply sliding window rate limiting

- Smooth rolling window
- More accurate than fixed window
- **Parameters:** client key, window duration, max requests
- **Returns:** rate limit result

```typescript
enforceTokenBucketLimit(key: string, capacity: number, refillRate: number): Promise<RateLimitResult>
```

Apply token bucket algorithm

- Allow bursts up to capacity
- Refill tokens at steady rate
- **Parameters:** client key, bucket capacity, tokens per second
- **Returns:** rate limit result

```typescript
handleRateLimitExceeded(context: ElysiaContext, result: RateLimitResult): Promise<void>
```

Handle rate limit violations

- Set HTTP 429 status
- Add rate limit headers
- Return error response
- **Parameters:** Elysia context, rate limit result

```typescript
addRateLimitHeaders(context: ElysiaContext, result: RateLimitResult): void
```

Add standard rate limit headers

- X-RateLimit-Limit
- X-RateLimit-Remaining
- X-RateLimit-Reset
- Retry-After
- **Parameters:** Elysia context, rate limit result

```typescript
getRateLimitStatus(key: string): Promise<RateLimitStatus>
```

Get current rate limit status for client

- **Parameters:** client key
- **Returns:** `{ requests: number, remaining: number, resetTime: Date, windowStart: Date }`

```typescript
resetRateLimit(key: string): Promise<void>
```

Reset rate limit counters for client

- Clear request counters
- Reset window timers
- **Parameters:** client key
- Used for administrative resets

```typescript
configureRateLimit(config: RateLimitConfig): void
```

Update rate limiting configuration

- Change limits dynamically
- Update strategies
- **Parameters:** new configuration object

```typescript
logRateLimitEvent(event: RateLimitEvent, context: ElysiaContext): void
```

Log rate limiting events

- Limit exceeded
- Reset events
- Configuration changes
- **Parameters:** event object, Elysia context

```typescript
createTieredRateLimit(tiers: RateLimitTier[]): ElysiaMiddleware
```

Create tiered rate limiting

- Different limits per user tier
- **Parameters:** array of tier configurations
- **Returns:** Elysia middleware function

```typescript
bypassRateLimitForRoutes(routes: string[]): boolean
```

Check if route should bypass rate limiting

- Health checks, webhooks
- **Parameters:** route patterns
- **Returns:** boolean

```typescript
getRateLimitMetrics(): Promise<RateLimitMetrics>
```

Get rate limiting statistics

- Hit rates, violations
- Top clients by usage
- **Returns:** metrics object
