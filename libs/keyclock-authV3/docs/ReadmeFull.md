# Authentication & Authorization Library for ElysiaJS Microservices

**Complete Functional Specification v2.0**

## Table of Contents

1. [Executive Summary](#1-executive-summary)
   1.1 [Overview](#11-overview)
   1.2 [Core Technologies](#12-core-technologies)
   1.3 [Key Features](#13-key-features)

2. [Architecture](#2-architecture)
   2.1 [Layered Architecture](#21-layered-architecture)
   2.2 [Component Interaction Flow](#22-component-interaction-flow)

3. [Core Components Specification](#3-core-components-specification)
   3.1 [Infrastructure Layer](#31-infrastructure-layer)
   3.2 [Manager Layer](#32-manager-layer)
   3.3 [Service Layer](#33-service-layer)
   3.4 [Middleware Layer](#34-middleware-layer)

---

## 1. EXECUTIVE SUMMARY

### 1.1 Overview

A production-ready authentication and authorization library for ElysiaJS microservices built on Bun runtime. The library provides comprehensive auth capabilities including user authentication, token management, permission control, and session management for both REST APIs and WebSocket connections.

### 1.2 Core Technologies

- **Runtime**: Bun
- **Framework**: ElysiaJS
- **Identity Provider**: Keycloak (pluggable architecture supports others)
- **Authorization**: CASL (Attribute-Based Access Control)
- **Caching**: Redis (primary), In-memory (fallback)
- **Storage**: Redis/PostgreSQL for sessions and tokens

### 1.3 Key Features

- Multiple authentication methods (password, JWT, API keys)
- Token lifecycle management (generation, refresh, revocation)
- Role-based and attribute-based permissions (CASL)
- Session management with distributed support
- WebSocket authentication and authorization
- Multi-tenant isolation
- Horizontal scalability
- Circuit breaker and graceful degradation
- Comprehensive audit logging
- Real-time metrics and health monitoring

---

## 2. ARCHITECTURE

### 2.1 Layered Architecture

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

### 2.2 Component Interaction Flow

**REST API Request:**

```
Request → AuthMiddleware → CacheCheck → TokenValidation
→ UserContextAttachment → AuthzMiddleware → PermissionCheck
→ RouteHandler → Response
```

**WebSocket Connection:**

```
WSUpgrade → WSAuthHandler → TokenValidation → ConnectionEstablishment
→ MessageReceived → WSAuthzHandler → PermissionCheck → MessageProcessing
```

---

## 3. CORE COMPONENTS SPECIFICATION

### 3.1 INFRASTRUCTURE LAYER

#### 3.1.1 IdentityProviderInterface

**Purpose:** Abstract interface for identity provider integration, enabling support for multiple IdPs.

**Responsibilities:**

- Define contract for identity provider operations
- Enable provider switching without code changes
- Facilitate testing with mock providers

**Functions:**

```typescript
initialize(config: ProviderConfig): Promise<void>
```

Initialize connection to identity provider

- **Parameters:** `config` (realm, clientId, clientSecret, serverUrl, timeout)
- **Throws:** `ConfigurationError` if invalid config

```typescript
authenticateUser(username: string, password: string): Promise<AuthResult>
```

Validate user credentials

- **Parameters:** `username`, `password`
- **Returns:** `{ userId, accessToken, refreshToken, expiresIn, userProfile }`
- **Throws:** `InvalidCredentialsError`, `ProviderUnavailableError`

```typescript
refreshToken(refreshToken: string): Promise<TokenResult>
```

Exchange refresh token for new access token

- **Parameters:** `refreshToken`
- **Returns:** `{ accessToken, refreshToken, expiresIn }`
- **Throws:** `InvalidTokenError`, `TokenExpiredError`

```typescript
introspectToken(token: string): Promise<TokenIntrospection>
```

Validate token with provider

- **Parameters:** `token` (access or refresh)
- **Returns:** `{ active, userId, scope, exp, iat, clientId }`
- **Throws:** `ProviderUnavailableError`

```typescript
revokeToken(token: string, tokenTypeHint?: string): Promise<void>
```

Revoke token at provider level

- **Parameters:** `token`, `tokenTypeHint` ('access_token' | 'refresh_token')
- **Returns:** `void` (revocation always succeeds per OAuth2 spec)

```typescript
getUserInfo(accessToken: string): Promise<UserProfile>
```

Retrieve user profile information

- **Parameters:** `accessToken`
- **Returns:** `{ userId, username, email, firstName, lastName, roles, attributes }`
- **Throws:** `InvalidTokenError`, `ProviderUnavailableError`

```typescript
getPublicKeys(): Promise<PublicKeySet>
```

Retrieve JWT signing keys

- **Returns:** `{ keys: [{ kid, kty, alg, use, n, e }] }`
- Cache keys with TTL

```typescript
validateClientCredentials(clientId: string, clientSecret: string): Promise<boolean>
```

Validate service-to-service credentials

- **Parameters:** `clientId`, `clientSecret`
- **Returns:** `boolean`

```typescript
logout(userId: string, sessionId?: string): Promise<void>
```

Notify provider of logout (SSO scenarios)

- **Parameters:** `userId`, optional `sessionId`

```typescript
healthCheck(): Promise<HealthStatus>
```

Check provider availability

- **Returns:** `{ healthy: boolean, responseTime: number, error?: string }`

#### 3.1.2 KeycloakIdentityProvider

**Purpose:** Concrete implementation of IdentityProviderInterface for Keycloak.

**Additional Responsibilities:**

- Keycloak-specific token handling
- Admin API integration
- Realm configuration management
- User federation support

**Additional Functions:**

```typescript
configureRealm(realmConfig: RealmConfig): Promise<void>
```

Configure realm-specific settings

- Set token lifetimes, password policies
- **Parameters:** `realmConfig` object

```typescript
syncUserRoles(userId: string): Promise<string[]>
```

Retrieve latest roles from Keycloak

- Handle composite roles
- **Parameters:** `userId`
- **Returns:** array of role names

```typescript
subscribeToAdminEvents(): EventEmitter
```

Listen for Keycloak admin events

- Emit events for user/role changes
- **Returns:** `EventEmitter` instance

```typescript
getRealmPublicKey(): Promise<string>
```

Get realm public key (legacy method)

- For backward compatibility
- **Returns:** PEM-encoded public key

```typescript
exchangeExternalToken(token: string, provider: string): Promise<TokenResult>
```

Exchange external IdP token (Google, Facebook)

- Enable social login scenarios
- **Parameters:** external token, provider name
- **Returns:** Keycloak token pair

#### 3.1.3 CacheManager

**Purpose:** Unified caching layer supporting multiple backends with automatic failover.

**Responsibilities:**

- Abstract cache operations from backend
- Provide consistent caching interface
- Handle cache invalidation
- Support distributed caching
- Implement cache strategies (write-through, write-behind)

**Functions:**

```typescript
initialize(config: CacheConfig): Promise<void>
```

Initialize cache backend (Redis or in-memory)

- Establish connection pool
- Configure eviction policies
- **Parameters:** `{ backend: 'redis' | 'memory', redisUrl?, maxMemory?, evictionPolicy? }`

```typescript
get<T>(key: string): Promise<T | null>
```

Retrieve value from cache

- Return null if not found or expired
- **Parameters:** cache key
- **Returns:** cached value or null
- Handles deserialization automatically

```typescript
set<T>(key: string, value: T, ttl?: number): Promise<void>
```

Store value in cache with optional TTL

- Serialize value automatically
- **Parameters:** `key`, `value`, `TTL` in seconds
- TTL defaults to configuration value

```typescript
delete(key: string): Promise<void>
```

Remove key from cache

- **Parameters:** cache key
- **Returns:** void (idempotent)

```typescript
deletePattern(pattern: string): Promise<number>
```

Delete all keys matching pattern

- Use carefully (expensive operation)
- **Parameters:** glob pattern (e.g., `"user:*:tokens"`)
- **Returns:** number of keys deleted

```typescript
exists(key: string): Promise<boolean>
```

Check if key exists without retrieving value

- **Parameters:** cache key
- **Returns:** boolean

```typescript
increment(key: string, delta?: number): Promise<number>
```

Atomically increment counter

- Create key with delta if doesn't exist
- **Parameters:** `key`, `delta` (default 1)
- **Returns:** new value

```typescript
expire(key: string, ttl: number): Promise<boolean>
```

Set/update TTL for existing key

- **Parameters:** `key`, `TTL` in seconds
- **Returns:** true if key exists

```typescript
getTTL(key: string): Promise<number>
```

Get remaining TTL for key

- **Parameters:** `key`
- **Returns:** seconds remaining, -1 if no expiry, -2 if not exists

```typescript
mGet<T>(keys: string[]): Promise<(T | null)[]>
```

Batch get multiple keys

- Maintain order of results
- **Parameters:** array of keys
- **Returns:** array of values (null for missing keys)

```typescript
mSet<T>(entries: Record<string, T>, ttl?: number): Promise<void>
```

Batch set multiple keys

- All keys get same TTL
- **Parameters:** key-value object, `TTL` in seconds

```typescript
getOrCompute<T>(key: string, computeFn: () => Promise<T>, ttl?: number): Promise<T>
```

Get from cache or compute if missing

- Automatically cache computed value
- Prevent cache stampede with locking
- **Parameters:** `key`, async compute function, `TTL`
- **Returns:** cached or computed value

```typescript
invalidate(tags: string[]): Promise<void>
```

Invalidate all cache entries with tags

- Requires tag tracking
- **Parameters:** array of tags
- Useful for related data invalidation

```typescript
healthCheck(): Promise<HealthStatus>
```

Check cache backend health

- Return latency metrics
- **Returns:** `{ healthy: boolean, latency: number, hitRate?: number }`

```typescript
getStats(): Promise<CacheStats>
```

Retrieve cache statistics

- **Returns:** `{ hits, misses, hitRate, size, evictions }`

#### 3.1.4 EventBus

**Purpose:** Distributed event messaging for cross-instance coordination and real-time notifications.

**Responsibilities:**

- Publish events to all service instances
- Subscribe to event types
- Handle event delivery guarantees
- Support event filtering
- Enable reactive patterns

**Functions:**

```typescript
initialize(config: EventBusConfig): Promise<void>
```

Initialize event bus (Redis pub/sub or message queue)

- Establish connections
- **Parameters:** `{ backend: 'redis' | 'nats', connectionUrl, retryPolicy }`

```typescript
publish(event: Event): Promise<void>
```

Publish event to all subscribers

- **Parameters:** `{ type, payload, timestamp, metadata }`
- Fire-and-forget semantics
- Events: `TokenRevoked`, `SessionDestroyed`, `PermissionChanged`, `UserLoggedOut`

```typescript
subscribe(eventType: string, handler: EventHandler): Subscription
```

Subscribe to specific event type

- **Parameters:** event type, handler function
- **Returns:** subscription object with unsubscribe method
- Handler signature: `(event: Event) => Promise<void>`

```typescript
subscribePattern(pattern: string, handler: EventHandler): Subscription
```

Subscribe to events matching pattern

- **Parameters:** glob pattern, handler
- Example: `"user::*"` matches all user events

```typescript
unsubscribe(subscription: Subscription): Promise<void>
```

Remove event subscription

- **Parameters:** subscription object
- Cleanup resources

```typescript
publishAndWait(event: Event, timeout?: number): Promise<void>
```

Publish and wait for acknowledgments

- Used for critical events
- **Parameters:** event, timeout in ms (default 5000)
- **Throws:** `TimeoutError` if acks not received

```typescript
getEventHistory(eventType: string, limit?: number): Promise<Event[]>
```

Retrieve recent events of type

- Requires event persistence
- **Parameters:** event type, max events (default 100)
- **Returns:** array of events

```typescript
healthCheck(): Promise<HealthStatus>
```

Check event bus connectivity

- **Returns:** `{ healthy: boolean, publishLatency: number, subscriptionCount: number }`

#### 3.1.5 StorageAdapter

**Purpose:** Abstract interface for persistent storage operations (sessions, tokens, API keys).

**Responsibilities:**

- Provide unified storage interface
- Support multiple backends (PostgreSQL, MongoDB, Redis)
- Handle connection pooling
- Implement retry logic

**Functions:**

```typescript
initialize(config: StorageConfig): Promise<void>
```

Initialize storage connection

- Run migrations if needed
- **Parameters:** `{ type: 'postgres' | 'mongo' | 'redis', connectionUrl, poolSize }`

```typescript
create(table: string, data: Record<string, any>): Promise<string>
```

Insert new record

- **Parameters:** table name, data object
- **Returns:** generated ID

```typescript
findById(table: string, id: string): Promise<Record<string, any> | null>
```

Retrieve record by ID

- **Parameters:** table, ID
- **Returns:** record or null

```typescript
findOne(table: string, filter: Record<string, any>): Promise<Record<string, any> | null>
```

Find first record matching filter

- **Parameters:** table, filter object
- **Returns:** record or null

```typescript
findMany(table: string, filter: Record<string, any>, options?: QueryOptions): Promise<Record<string, any>[]>
```

Find all matching records

- **Parameters:** table, filter, options (limit, offset, sort)
- **Returns:** array of records

```typescript
update(table: string, id: string, data: Record<string, any>): Promise<boolean>
```

Update existing record

- **Parameters:** table, ID, partial data
- **Returns:** true if updated

```typescript
delete(table: string, id: string): Promise<boolean>
```

Delete record by ID

- **Parameters:** table, ID
- **Returns:** true if deleted

```typescript
deleteMany(table: string, filter: Record<string, any>): Promise<number>
```

Delete all matching records

- **Parameters:** table, filter
- **Returns:** count of deleted records

```typescript
transaction<T>(operations: () => Promise<T>): Promise<T>
```

Execute operations in transaction

- Auto-rollback on error
- **Parameters:** async function with operations
- **Returns:** result of operations

```typescript
healthCheck(): Promise<HealthStatus>
```

Check storage connectivity

- **Returns:** `{ healthy: boolean, queryLatency: number }`

#### 3.1.6 CircuitBreaker

**Purpose:** Protect external service calls with circuit breaker pattern, preventing cascade failures.

**Responsibilities:**

- Monitor external service health
- Open circuit on failure threshold
- Allow recovery attempts (half-open state)
- Provide fallback mechanisms
- Track failure metrics

**States:** CLOSED (normal), OPEN (failing), HALF_OPEN (testing recovery)

**Functions:**

```typescript
constructor(config: CircuitBreakerConfig)
```

Initialize circuit breaker

- **Parameters:** `{ failureThreshold, resetTimeout, monitoringPeriod, fallback? }`
- `failureThreshold`: % failures to open circuit (default 50%)
- `resetTimeout`: ms before attempting recovery (default 60000)

```typescript
execute<T>(operation: () => Promise<T>, fallback?: () => Promise<T>): Promise<T>
```

Execute operation through circuit breaker

- **Parameters:** async operation, optional fallback
- **Returns:** operation result or fallback result
- **Throws:** `CircuitOpenError` if circuit is open and no fallback

```typescript
executeWithTimeout<T>(operation: () => Promise<T>, timeout: number): Promise<T>
```

Execute with timeout protection

- **Parameters:** operation, timeout in ms
- **Throws:** `TimeoutError` if exceeds timeout

```typescript
recordSuccess(): void
```

Record successful operation

- Update metrics
- Transition from HALF_OPEN to CLOSED if threshold met

```typescript
recordFailure(error: Error): void
```

Record failed operation

- Update metrics
- Open circuit if failure threshold exceeded
- **Parameters:** error that occurred

```typescript
getState(): CircuitState
```

Get current circuit state

- **Returns:** `'CLOSED' | 'OPEN' | 'HALF_OPEN'`

```typescript
forceOpen(): void
```

Manually open circuit

- Used for maintenance or known issues

```typescript
forceClose(): void
```

Manually close circuit

- Reset failure counters

```typescript
forceHalfOpen(): void
```

Manually set to half-open

- Allow single test request

```typescript
getMetrics(): CircuitMetrics
```

Get circuit breaker statistics

- **Returns:** `{ totalCalls, successCount, failureCount, rejectedCount, currentState, failureRate }`

```typescript
onStateChange(callback: (oldState: CircuitState, newState: CircuitState) => void): void
```

Register state change listener

- **Parameters:** callback function
- Useful for alerting

```typescript
reset(): void
```

Reset circuit breaker to initial state

- Clear all metrics

### 3.2 Manager Layer

The Manager Layer orchestrates business logic and coordinates between services. Managers handle complex workflows, validation, and state management.

#### 3.2.1 TokenManager

**Purpose:** Core token operations including validation, parsing, and verification.

**Responsibilities:**

- JWT signature verification
- Token structure validation
- Claims extraction and validation
- Token expiry checking
- Public key management and caching
- Token validation result caching

**Functions:**

```typescript
initialize(config: TokenConfig): Promise<void>
```

Initialize token manager

- Load public keys from provider
- Setup validation cache
- **Parameters:** `{ issuer, audience, clockTolerance, algorithms, cacheEnabled }`

```typescript
verifyToken(token: string, options?: VerifyOptions): Promise<TokenPayload>
```

Verify JWT signature and claims

- Check issuer, audience, expiration
- **Parameters:** token string, options (skipExpiry?, skipAudience?)
- **Returns:** decoded token payload
- **Throws:** TokenExpiredError, InvalidSignatureError, InvalidTokenError
- Uses cache if enabled (5-minute TTL)

```typescript
parseToken(token: string): TokenPayload
```

Decode token without verification

- Use only for inspection, not trust
- **Parameters:** token string
- **Returns:** decoded payload
- **Throws:** MalformedTokenError

```typescript
validateTokenStructure(token: string): boolean
```

Check if token has valid JWT structure

- Verify header.payload.signature format
- **Parameters:** token string
- **Returns:** boolean
- Does not verify signature or claims

```typescript
extractClaims(token: string): TokenClaims
```

Get all claims from token

- **Parameters:** token string
- **Returns:** `{ sub, iss, aud, exp, iat, jti, scope, ...custom }`
- **Throws:** MalformedTokenError

```typescript
extractRoles(token: string): string[]
```

Extract roles from token claims

- Handle realm and client roles
- **Parameters:** token string
- **Returns:** array of role names
- Keycloak format: realm_access.roles + resource_access.{client}.roles

```typescript
extractPermissions(token: string): Permission[]
```

Extract permissions from token

- Parse authorization claims
- **Parameters:** token string
- **Returns:** array of permission objects
- Format: `{ resource, scopes }`

```typescript
getTokenExpiry(token: string): Date
```

Get token expiration time

- **Parameters:** token string
- **Returns:** Date object
- **Throws:** MalformedTokenError

```typescript
isTokenExpired(token: string, clockTolerance?: number): boolean
```

Check if token is expired

- Account for clock skew
- **Parameters:** token, tolerance in seconds (default 60)
- **Returns:** boolean

```typescript
getTokenMetadata(token: string): TokenMetadata
```

Extract metadata without full verification

- **Parameters:** token string
- **Returns:** `{ userId, expiresAt, issuedAt, jti, scope }`

```typescript
getPublicKey(kid: string): Promise<PublicKey>
```

Get public key for verification

- **Parameters:** Key ID from token header
- **Returns:** public key object
- Cached with 1-hour TTL
- Auto-refreshes from provider if not found

```typescript
refreshPublicKeys(): Promise<void>
```

Force refresh of public keys from provider

- Called on key rotation or signature verification failure
- Updates cache

```typescript
hashToken(token: string): string
```

Create hash of token for caching

- Use SHA-256 hash of token
- **Parameters:** token string
- **Returns:** hex-encoded hash

```typescript
cacheValidation(tokenHash: string, result: ValidationResult, ttl: number): Promise<void>
```

Cache token validation result

- **Parameters:** token hash, validation result, TTL in seconds
- TTL should be less than token expiry

```typescript
getCachedValidation(tokenHash: string): Promise<ValidationResult | null>
```

Retrieve cached validation result

- **Parameters:** token hash
- **Returns:** cached result or null
- Result: `{ valid: boolean, payload?: TokenPayload, error?: string }`

```typescript
invalidateTokenCache(tokenHash: string): Promise<void>
```

Remove token from validation cache

- Called on revocation
- **Parameters:** token hash

#### 3.2.2 RefreshTokenManager

**Purpose:** Manage refresh token lifecycle including storage, rotation, and revocation detection.

**Responsibilities:**

- Store refresh tokens securely
- Implement refresh token rotation
- Detect token reuse (security)
- Track token families
- Handle token expiration cleanup

**Functions:**

```typescript
storeRefreshToken(userId: string, refreshToken: string, metadata: RefreshTokenMetadata): Promise<string>
```

Store refresh token with metadata

- Generate token family ID for rotation tracking
- **Parameters:** userId, refresh token, metadata (sessionId, deviceInfo, ip, userAgent)
- **Returns:** token family ID
- Storage includes: hash of token, userId, familyId, createdAt, expiresAt, lastUsedAt

```typescript
validateRefreshToken(refreshToken: string, userId: string): Promise<RefreshTokenValidation>
```

Validate refresh token

- Check if token exists and not revoked
- Verify userId match
- Check expiration
- Update lastUsedAt
- **Parameters:** refresh token, userId
- **Returns:** `{ valid: boolean, familyId?: string, metadata?: RefreshTokenMetadata }`
- **Throws:** TokenRevokedException, TokenExpiredException

```typescript
rotateRefreshToken(oldToken: string, newToken: string, userId: string): Promise<void>
```

Implement refresh token rotation

- Store new token with same familyId
- Invalidate old token
- Maintain token chain for reuse detection
- **Parameters:** old refresh token, new refresh token, userId
- Chain structure: familyId links all rotated tokens

```typescript
revokeRefreshToken(refreshToken: string, reason?: string): Promise<void>
```

Revoke specific refresh token

- Mark as revoked in storage
- Publish revocation event
- **Parameters:** refresh token, optional reason
- Does not revoke entire family

```typescript
revokeTokenFamily(familyId: string, reason?: string): Promise<void>
```

Revoke all tokens in family

- Used when token reuse detected
- **Parameters:** family ID, optional reason
- Security measure against token theft

```typescript
revokeAllUserRefreshTokens(userId: string, except?: string): Promise<number>
```

Revoke all refresh tokens for user

- Optional: keep one token (current session)
- **Parameters:** userId, optional token to keep
- **Returns:** count of revoked tokens
- Used on password change, account compromise

```typescript
detectTokenReuse(refreshToken: string): Promise<ReuseDetection>
```

Detect if old refresh token is being reused

- Check if token was already rotated
- **Parameters:** refresh token
- **Returns:** `{ isReuse: boolean, familyId?: string, revokedAt?: Date }`
- If reuse detected, auto-revoke entire family

```typescript
getTokenFamily(familyId: string): Promise<RefreshTokenChain[]>
```

Retrieve all tokens in family

- Useful for auditing
- **Parameters:** family ID
- **Returns:** array of tokens in rotation chain
- Each entry: `{ tokenHash, createdAt, revokedAt?, lastUsedAt }`

```typescript
getUserRefreshTokens(userId: string): Promise<RefreshTokenInfo[]>
```

List all active refresh tokens for user

- **Parameters:** userId
- **Returns:** array of token info (without actual tokens)
- Info: `{ familyId, createdAt, lastUsedAt, deviceInfo, ip }`

```typescript
cleanupExpiredTokens(): Promise<number>
```

Remove expired refresh tokens from storage

- Should be called periodically (cron job)
- **Returns:** count of removed tokens
- Delete tokens where expiresAt < now

```typescript
getTokenMetrics(): Promise<RefreshTokenMetrics>
```

Get refresh token statistics

- **Returns:** `{ totalActive, byUser, rotationRate, reuseDetections }`

#### 3.2.3 TokenRevocationService

**Purpose:** Manage token blacklist efficiently with minimal performance impact.

**Responsibilities:**

- Maintain revoked token registry
- Implement fast revocation checks
- Auto-cleanup expired revocations
- Sync with identity provider
- Use Bloom filter for optimization

**Functions:**

```typescript
initialize(config: RevocationConfig): Promise<void>
```

Initialize revocation service

- Setup Bloom filter and Redis storage
- **Parameters:** `{ bloomFilterSize, falsePositiveRate, autoCleanupInterval }`
- Start cleanup job

```typescript
revokeToken(token: string, reason?: string, expiresAt?: Date): Promise<void>
```

Add token to revocation list

- Extract JTI from token
- Add to Bloom filter and storage
- Publish revocation event
- **Parameters:** token string, optional reason, optional expiry
- If expiresAt not provided, extract from token
- Storage key expires at token expiry time (auto-cleanup)

```typescript
isTokenRevoked(jti: string): Promise<boolean>
```

Check if token is revoked

- Fast path: check Bloom filter first
- If might be revoked, confirm with storage
- **Parameters:** JTI (token ID)
- **Returns:** boolean
- Performance: ~1ms for not revoked (Bloom filter), ~2ms for revoked (Redis check)

```typescript
revokeUserTokens(userId: string, reason?: string): Promise<number>
```

Revoke all tokens for user

- Query active sessions and tokens
- Revoke each individually
- **Parameters:** userId, optional reason
- **Returns:** count of revoked tokens
- Also triggers session cleanup

```typescript
bulkRevoke(jtis: string[], reason?: string): Promise<void>
```

Revoke multiple tokens at once

- Batch operation for performance
- **Parameters:** array of JTIs, optional reason
- Uses pipeline for Redis operations

```typescript
syncWithProvider(token: string): Promise<void>
```

Revoke token at identity provider level

- Ensure SSO logout works
- **Parameters:** token string
- Calls provider's revoke endpoint
- Failure is logged but doesn't throw (best effort)

```typescript
getRevokedTokens(userId?: string, limit?: number): Promise<RevokedToken[]>
```

Query revoked tokens

- Optional: filter by user
- **Parameters:** optional userId, optional limit (default 100)
- **Returns:** array of revocation records
- Record: `{ jti, userId, revokedAt, reason, expiresAt }`

```typescript
cleanupExpiredRevocations(): Promise<number>
```

Remove expired revocation entries

- Called automatically by scheduler
- **Returns:** count of cleaned entries
- Redis TTL handles most cleanup, this is backup

```typescript
getRevocationMetrics(): Promise<RevocationMetrics>
```

Get revocation statistics

- **Returns:** `{ totalRevoked, recentRevocations, checkLatency, bloomFilterFalsePositiveRate }`

```typescript
rebuildBloomFilter(): Promise<void>
```

Rebuild Bloom filter from storage

- Called on startup or if filter becomes full
- Queries all active revocations
- Repopulates filter

```typescript
addToBloomFilter(jti: string): void
```

Add JTI to Bloom filter

- Called during revocation
- **Parameters:** JTI
- Synchronous operation

```typescript
checkBloomFilter(jti: string): boolean
```

Check Bloom filter only

- Fast negative check
- **Parameters:** JTI
- **Returns:** false (definitely not revoked) or true (might be revoked)

#### 3.2.4 ApiKeyManager

**Purpose:** Manage API key lifecycle including generation, validation, storage, and permissions.

**Responsibilities:**

- Generate cryptographically secure API keys
- Hash and store keys securely
- Validate API key authenticity
- Manage API key scopes and permissions
- Handle API key rotation
- Track usage and rate limits

**Key Format:** `{prefix}_{environment}_{random}\_{checksum}`
**Example:** sk_live_a8f3k2m9x7c1v5b4n6p0_3k9m

**Functions:**

```typescript
generateApiKey(userId: string, scopes: string[], metadata: ApiKeyMetadata): Promise<ApiKeyResult>
```

Generate new API key

- Create secure random key (32 bytes)
- Format with prefix and checksum
- Hash for storage (Argon2)
- Store with metadata
- **Parameters:** userId, scopes (permissions), metadata (name, description, expiresAt)
- **Returns:** `{ apiKey (only time shown), apiKeyId, keyPrefix, scopes }`
- Scopes examples: `['read:users', 'write:orders', 'admin:*']`

```typescript
hashApiKey(apiKey: string): string
```

Create secure hash of API key

- Use Argon2id algorithm
- **Parameters:** API key string
- **Returns:** hash string
- Used for storage and comparison
- Time-constant comparison to prevent timing attacks

```typescript
validateApiKey(apiKey: string): Promise<ApiKeyValidation>
```

Validate API key authenticity

- Verify checksum first (fast rejection)
- Hash and compare with stored hash
- Check expiration
- Check if revoked
- Update last used timestamp
- **Parameters:** API key string
- **Returns:** `{ valid: boolean, userId?: string, scopes?: string[], metadata?: ApiKeyMetadata }`
- **Throws:** InvalidApiKeyError, ApiKeyRevokedException, ApiKeyExpiredError

```typescript
getApiKeyDetails(apiKeyId: string): Promise<ApiKeyDetails>
```

Retrieve API key information

- Does not return actual key
- **Parameters:** API key ID
- **Returns:** `{ apiKeyId, userId, name, scopes, createdAt, lastUsedAt, expiresAt, keyPrefix }`

```typescript
listUserApiKeys(userId: string, options?: ListOptions): Promise<ApiKeyDetails[]>
```

Get all API keys for user

- **Parameters:** userId, options (includeRevoked, limit, offset)
- **Returns:** array of API key details
- Default: only active keys

```typescript
revokeApiKey(apiKeyId: string, reason?: string): Promise<void>
```

Revoke API key immediately

- Mark as revoked in storage
- Add to revocation cache
- Publish revocation event
- **Parameters:** API key ID, optional reason

```typescript
rotateApiKey(apiKeyId: string): Promise<ApiKeyResult>
```

Generate new API key, revoke old one

- Maintain same scopes and metadata
- **Parameters:** old API key ID
- **Returns:** new API key details
- Use case: periodic rotation, suspected compromise

```typescript
updateApiKeyScopes(apiKeyId: string, scopes: string[]): Promise<void>
```

Modify API key permissions

- **Parameters:** API key ID, new scopes array
- Validate scopes before update
- Invalidate permission cache

```typescript
trackApiKeyUsage(apiKeyId: string, endpoint: string, metadata?: UsageMetadata): Promise<void>
```

Log API key usage

- Update last used timestamp
- Track usage patterns
- **Parameters:** API key ID, endpoint called, optional metadata (ip, userAgent)
- Used for analytics and anomaly detection

```typescript
getApiKeyUsageStats(apiKeyId: string, period?: TimePeriod): Promise<UsageStats>
```

Get usage statistics for API key

- **Parameters:** API key ID, optional period (day, week, month)
- **Returns:** `{ totalCalls, uniqueEndpoints, lastUsed, callsByEndpoint }`

```typescript
checkRateLimit(apiKeyId: string): Promise<RateLimitStatus>
```

Check if API key is within rate limits

- **Parameters:** API key ID
- **Returns:** `{ allowed: boolean, remaining: number, resetAt: Date }`
- Rate limits configurable per key or globally

```typescript
parseApiKey(apiKey: string): ApiKeyParts
```

Parse API key structure

- Extract prefix, environment, random, checksum
- **Parameters:** API key string
- **Returns:** `{ prefix, environment, random, checksum }`
- **Throws:** MalformedApiKeyError

```typescript
verifyChecksum(apiKey: string): boolean
```

Verify API key checksum

- Fast validation before hash comparison
- **Parameters:** API key string
- **Returns:** boolean
- Prevents unnecessary hashing for malformed keys

```typescript
setApiKeyExpiry(apiKeyId: string, expiresAt: Date): Promise<void>
```

Set or update expiration date

- **Parameters:** API key ID, expiration date
- Null expiresAt = no expiration

```typescript
cleanupExpiredApiKeys(): Promise<number>
```

Remove expired API keys

- Periodic cleanup job
- **Returns:** count of removed keys
- Also removes from cache

#### 3.2.5 SessionManager

**Purpose:** Manage user sessions across requests with distributed support for horizontal scaling.

**Responsibilities:**

- Create and destroy sessions
- Store session data (user preferences, state)
- Handle session expiration
- Support distributed sessions (Redis)
- Track active sessions per user
- Enforce concurrent session limits
- Session fixation prevention

**Session Structure:**

```typescript
{
  sessionId: string,
  userId: string,
  createdAt: Date,
  expiresAt: Date,
  lastAccessedAt: Date,
  data: Record<string, any>,
  metadata: {
    ip: string,
    userAgent: string,
    deviceId?: string,
    location?: string
  }
}
```

**Functions:**

```typescript
createSession(userId: string, sessionData: SessionData, options?: SessionOptions): Promise<Session>
```

Create new session

- Generate secure session ID (UUID v4 + entropy)
- Store in Redis/database
- Set TTL based on configuration
- **Parameters:** userId, initial session data, options (ttl, slidingExpiration, deviceId)
- **Returns:** Session object with sessionId
- Default TTL: 24 hours for web, 30 days for mobile
- Sliding expiration: extends TTL on each access

```typescript
getSession(sessionId: string): Promise<Session | null>
```

Retrieve session by ID

- Check expiration
- Update lastAccessedAt if sliding expiration enabled
- Extend TTL if sliding expiration
- **Parameters:** session ID
- **Returns:** Session object or null if not found/expired
- Cache result for 60 seconds

```typescript
updateSession(sessionId: string, data: Partial<SessionData>): Promise<void>
```

Update session data

- Merge with existing data
- Extend TTL if sliding expiration
- **Parameters:** session ID, partial data to update
- **Throws:** SessionNotFoundError

```typescript
destroySession(sessionId: string): Promise<void>
```

Remove session from storage

- Clear from cache
- Publish session destroyed event
- **Parameters:** session ID
- Idempotent operation

```typescript
refreshSessionTTL(sessionId: string, ttl?: number): Promise<void>
```

Manually extend session lifetime

- **Parameters:** session ID, optional new TTL (uses default if not provided)
- Updates expiresAt and storage TTL
- **Throws:** SessionNotFoundError

```typescript
listUserSessions(userId: string, options?: ListOptions): Promise<Session[]>
```

Get all active sessions for user

- Useful for "active sessions" view
- **Parameters:** userId, options (includeExpired, limit, offset)
- **Returns:** array of sessions sorted by lastAccessedAt desc
- Includes metadata for display (device, location, last active)

```typescript
destroyAllUserSessions(userId: string, exceptSessionId?: string): Promise<number>
```

Terminate all sessions for user

- Optional: keep current session
- **Parameters:** userId, optional session to preserve
- **Returns:** count of destroyed sessions
- Use case: "logout from all devices", password change

```typescript
enforceSessionLimit(userId: string, maxSessions: number): Promise<void>
```

Ensure user doesn't exceed session limit

- Remove oldest sessions if over limit
- **Parameters:** userId, max allowed sessions
- Called during session creation
- Removes sessions by lastAccessedAt (oldest first)

```typescript
getUserSessionCount(userId: string): Promise<number>
```

Count active sessions for user

- **Parameters:** userId
- **Returns:** session count
- Uses cache for performance

```typescript
validateSession(sessionId: string, userId: string): Promise<boolean>
```

Validate session belongs to user and is active

- **Parameters:** session ID, user ID
- **Returns:** boolean
- Security check for session hijacking

```typescript
regenerateSessionId(oldSessionId: string): Promise<string>
```

Generate new session ID, preserve data

- Prevents session fixation attacks
- **Parameters:** old session ID
- **Returns:** new session ID
- Called after privilege escalation (login, sudo)
- Transfers all data to new session
- Destroys old session

```typescript
touchSession(sessionId: string): Promise<void>
```

Update lastAccessedAt without data changes

- Lightweight session ping
- **Parameters:** session ID
- Used to prevent timeout on active connections

```typescript
getSessionMetadata(sessionId: string): Promise<SessionMetadata>
```

Get session metadata without full data

- **Parameters:** session ID
- **Returns:** `{ userId, createdAt, expiresAt, lastAccessedAt, device, location }`
- Faster than full session retrieval

```typescript
cleanupExpiredSessions(): Promise<number>
```

Remove expired sessions

- Periodic cleanup job
- **Returns:** count of removed sessions
- Redis TTL handles most, this is backup for DB storage

```typescript
lockSession(sessionId: string, timeout: number): Promise<boolean>
```

Acquire distributed lock on session

- Prevents concurrent modifications
- **Parameters:** session ID, lock timeout in ms
- **Returns:** true if lock acquired
- Use for critical session updates

```typescript
unlockSession(sessionId: string): Promise<void>
```

Release session lock

- **Parameters:** session ID
- Should always be called after lockSession

```typescript
getSessionStats(): Promise<SessionStats>
```

Get session statistics

- **Returns:** `{ totalActive, activeUsers, avgSessionsPerUser, sessionsCreatedToday }`

#### 3.2.6 CaslAbilityBuilder

**Purpose:** Construct CASL Ability instances based on user roles, permissions, and dynamic conditions.

**Responsibilities:**

- Define permission rules
- Build CASL Ability objects
- Map identity provider roles to CASL permissions
- Handle dynamic permission loading
- Support conditional permissions
- Cache ability instances

**Permission Format:**

```typescript
{
  action: string, // 'read', 'write', 'delete', 'manage'
  subject: string, // 'User', 'Order', 'Product', 'all'
  fields?: string[], // specific fields
  conditions?: object // dynamic conditions
}
```

**Functions:**

```typescript
initialize(config: AbilityConfig): Promise<void>
```

Initialize ability builder

- Load permission definitions
- Setup caching
- **Parameters:** `{ permissionRules, roleHierarchy, dynamicPermissions }`

```typescript
buildAbilityForUser(user: AuthUser, options?: BuildOptions): Promise<Ability>
```

Create CASL Ability instance for user

- Combine role-based and custom permissions
- Apply permission inheritance
- **Parameters:** user object (with roles, permissions), options (includeDisabled)
- **Returns:** CASL Ability instance
- Caches result by role combination hash
- Cache TTL: 5 minutes

```typescript
defineRolePermissions(role: string): Rule[]
```

Define what a specific role can do

- **Parameters:** role name
- **Returns:** array of CASL rules
- Example rules:
  - Admin: manage all
  - User: read own data, update own profile
  - Guest: read public resources

```typescript
defineResourcePermissions(resource: string, actions: ActionConfig[]): Rule[]
```

Define permissions for specific resource type

- **Parameters:** resource name, action configurations
- **Returns:** array of rules
- Example: defineResourcePermissions('Order', [
  { action: 'read', roles: ['user', 'admin'] },
  { action: 'write', roles: ['admin'], conditions: { status: 'pending' } }
  ])

```typescript
mapProviderRolesToPermissions(providerRoles: string[]): Permission[]
```

Convert identity provider roles to CASL permissions

- Handle realm roles and client roles
- **Parameters:** array of role names from provider
- **Returns:** array of permission objects
- Mapping configuration loaded from config
- Example: 'keycloak:admin' → `{ action: 'manage', subject: 'all' }`

```typescript
mergeAbilities(abilities: Ability[]): Ability
```

Combine multiple ability sets

- Useful for union of permissions
- **Parameters:** array of CASL Ability instances
- **Returns:** merged Ability
- Rules are combined with OR logic

```typescript
loadPermissionsFromConfig(configPath: string): Promise<void>
```

Load permission definitions from file

- Supports JSON, YAML formats
- **Parameters:** path to config file
- Updates internal permission registry
- Hot-reload support if configured

```typescript
applyRoleHierarchy(roles: string[]): string[]
```

Expand roles based on hierarchy

- Admin includes User permissions
- **Parameters:** user's assigned roles
- **Returns:** expanded role list with inherited roles
- Example: `['admin']` → `['admin', 'user', 'guest']`

```typescript
buildConditionalRule(action: string, subject: string, condition: ConditionBuilder): Rule
```

Create rule with dynamic conditions

- **Parameters:** action, subject, condition function
- **Returns:** CASL rule object
- Example: buildConditionalRule('update', 'Order', (user) => ({ userId: user.id }))

```typescript
defineFieldPermissions(subject: string, roleFieldMap: RoleFieldMap): Rule[]
```

Define field-level access control

- **Parameters:** subject name, role-to-fields mapping
- **Returns:** array of rules with field restrictions
- Example: User subject → admin sees all fields, user sees only own fields

```typescript
validatePermissionDefinition(rule: Rule): boolean
```

Validate rule structure

- Check for conflicts or errors
- **Parameters:** CASL rule
- **Returns:** boolean
- **Throws:** InvalidPermissionError if malformed

```typescript
getCachedAbility(cacheKey: string): Promise<Ability | null>
```

Retrieve cached ability instance

- **Parameters:** cache key (hash of roles + permissions)
- **Returns:** Ability or null
- Uses CacheManager

```typescript
cacheAbility(cacheKey: string, ability: Ability, ttl: number): Promise<void>
```

Store ability in cache

- **Parameters:** cache key, ability instance, TTL in seconds
- CASL abilities are serialized for caching

```typescript
invalidateAbilityCache(userId?: string): Promise<void>
```

Clear ability cache

- **Parameters:** optional userId (clears only user's abilities)
- Called on permission changes, role updates

```typescript
getPermissionRules(): Rule[]
```

Get all defined permission rules

- **Returns:** array of all CASL rules
- Used for auditing and documentation

```typescript
addCustomRule(rule: Rule): void
```

Add runtime permission rule

- **Parameters:** CASL rule
- Updates rule registry
- Invalidates cache

```typescript
removeRule(ruleId: string): void
```

Remove specific permission rule

- **Parameters:** rule identifier
- Invalidates cache

#### 3.2.7 PermissionChecker

**Purpose:** Evaluate permissions using CASL abilities with caching and performance optimization.

**Responsibilities:**

- Check user permissions for actions
- Evaluate field-level permissions
- Handle conditional permissions
- Filter resources by permissions
- Provide detailed permission denial reasons
- Cache permission check results

**Functions:**

```typescript
canPerformAction(ability: Ability, action: string, subject: any): boolean
```

Check if user can perform action on subject

- **Parameters:** CASL ability, action name, subject (object or type)
- **Returns:** boolean
- Example: canPerformAction(ability, 'update', order)
- Subject can be instance or subject type string

```typescript
canPerformActionWithReason(ability: Ability, action: string, subject: any): PermissionResult
```

Check permission and get denial reason

- **Parameters:** same as canPerformAction
- **Returns:** `{ allowed: boolean, reason?: string, missingPermissions?: string[] }`
- Useful for user-friendly error messages

```typescript
canAccessField(ability: Ability, subject: any, field: string): boolean
```

Check field-level access

- **Parameters:** ability, subject instance, field name
- **Returns:** boolean
- Example: canAccessField(ability, user, 'socialSecurityNumber')

```typescript
filterAllowedFields(ability: Ability, subject: any, fields: string[]): string[]
```

Return only accessible fields

- **Parameters:** ability, subject instance, array of field names
- **Returns:** filtered array of allowed fields
- Used for response serialization

```typescript
filterForbiddenFields(ability: Ability, subject: any, fields: string[]): string[]
```

Return fields user cannot access

- Inverse of filterAllowedFields
- **Parameters:** ability, subject instance, array of field names
- **Returns:** array of forbidden fields
- Useful for auditing

```typescript
filterAllowedResources<T>(ability: Ability, action: string, resources: T[]): T[]
```

Filter array of resources by permission

- **Parameters:** ability, action name, array of resources
- **Returns:** filtered array
- Example: show only orders user can view
- Applies conditions from ability rules

```typescript
checkBulkPermissions(ability: Ability, checks: PermissionCheck[]): BulkPermissionResult
```

Verify multiple permissions at once

- **Parameters:** ability, array of {action, subject} pairs
- **Returns:** `{ results: PermissionResult[], allAllowed: boolean }`
- More efficient than multiple individual checks

```typescript
evaluateCondition(ability: Ability, action: string, subject: any, user: AuthUser): boolean
```

Evaluate conditional permission

- **Parameters:** ability, action, subject instance, user context
- **Returns:** boolean
- Resolves dynamic conditions like ownership checks

```typescript
getRequiredPermissions(action: string, subjectType: string): Permission[]
```

Get permissions needed for action

- **Parameters:** action name, subject type
- **Returns:** array of permission objects
- Used for documentation and UI

```typescript
getPermissionReason(ability: Ability, action: string, subject: any): string
```

Get human-readable denial reason

- **Parameters:** ability, action, subject
- **Returns:** reason string
- Examples: "Missing 'write:orders' permission", "Order status must be 'draft'"

```typescript
checkOwnership(subject: any, userId: string, ownerField?: string): boolean
```

Check if user owns resource

- **Parameters:** subject instance, user ID, owner field name (default 'userId')
- **Returns:** boolean
- Common condition for permissions

```typescript
canAccessAny(ability: Ability, action: string, subjects: any[]): boolean
```

Check if user can access at least one resource

- **Parameters:** ability, action, array of subjects
- **Returns:** boolean
- Short-circuits on first allowed

```typescript
canAccessAll(ability: Ability, action: string, subjects: any[]): boolean
```

Check if user can access all resources

- **Parameters:** ability, action, array of subjects
- **Returns:** boolean
- All must be allowed

```typescript
getAccessibleFields(ability: Ability, subjectType: string): string[]
```

Get all fields user can access for subject type

- **Parameters:** ability, subject type name
- **Returns:** array of field names
- Used for generating schemas, forms

```typescript
createPermissionFilter(ability: Ability, action: string, subjectType: string): QueryFilter
```

Generate database query filter from ability

- **Parameters:** ability, action, subject type
- **Returns:** query filter object (MongoDB, SQL WHERE clause)
- Converts CASL conditions to database queries
- Example: `{ userId: user.id, status: 'active' }`

```typescript
cachePermissionCheck(cacheKey: string, result: boolean, ttl: number): Promise<void>
```

Cache permission check result

- **Parameters:** cache key (hash of ability + action + subject), result, TTL
- Short TTL (60 seconds) to allow permission updates

```typescript
getCachedPermissionCheck(cacheKey: string): Promise<boolean | null>
```

Retrieve cached permission result

- **Parameters:** cache key
- **Returns:** boolean or null if not cached

### 3.3 Service Layer

The Service Layer provides high-level business logic orchestration, coordinating between multiple managers and handling complex workflows.

#### 3.3.1 AuthenticationService

**Purpose:** High-level authentication orchestration, coordinating multiple managers and providers.

**Responsibilities:**

- Orchestrate login flow
- Coordinate token operations
- Manage authentication state
- Handle authentication errors
- Provide unified authentication interface
- Integrate with audit logging

**Functions:**

```typescript
initialize(config: AuthServiceConfig): Promise<void>
```

Initialize service and dependencies

- Setup identity provider, token manager, session manager
- **Parameters:** configuration object
- Validates all required components available

```typescript
authenticateWithPassword(username: string, password: string, context: AuthContext): Promise<AuthResult>
```

Authenticate user with credentials

- Full login flow orchestration
- **Parameters:** username, password, context (ip, userAgent, deviceId)
- **Returns:** `{ userId, accessToken, refreshToken, sessionId, expiresIn, user }`
- Flow:
  - Validate credentials with identity provider
  - Create session
  - Store refresh token
  - Generate response
  - Log authentication event
  - Return tokens and session
- **Throws:** InvalidCredentialsError, AccountLockedError, MfaRequiredError

```typescript
authenticateWithToken(accessToken: string, options?: TokenAuthOptions): Promise<TokenAuthResult>
```

Authenticate using access token

- Validate token and extract user
- **Parameters:** access token, options (skipExpiry, skipCache)
- **Returns:** `{ userId, user, roles, permissions, tokenExpiry }`
- Flow:
  - Check token cache
  - Verify token signature and claims
  - Check revocation
  - Build user context
  - Cache result
- **Throws:** TokenExpiredError, InvalidTokenError, TokenRevokedException

```typescript
authenticateWithApiKey(apiKey: string, context: AuthContext): Promise<ApiKeyAuthResult>
```

Authenticate using API key

- Validate key and return user context
- **Parameters:** API key, context
- **Returns:** `{ userId, scopes, apiKeyId, rateLimitStatus }`
- Flow:
  - Validate API key format
  - Check revocation
  - Verify hash
  - Check rate limits
  - Track usage
  - Return scopes and limits
- **Throws:** InvalidApiKeyError, ApiKeyRevokedException, RateLimitExceededError

```typescript
authenticateWithRefreshToken(refreshToken: string, userId: string, context: AuthContext): Promise<AuthResult>
```

Exchange refresh token for new access token

- Implement token rotation
- **Parameters:** refresh token, user ID, context
- **Returns:** new token pair and updated session
- Flow:
  - Validate refresh token
  - Detect token reuse
  - Get new tokens from provider
  - Rotate refresh token
  - Update session
  - Return new tokens
- **Throws:** InvalidTokenError, TokenReusedError (revokes family)

```typescript
verifyAuthentication(token: string): Promise<boolean>
```

Quick authentication verification

- Check if token is valid
- **Parameters:** access token
- **Returns:** boolean
- Lightweight check for middleware

```typescript
logout(userId: string, sessionId: string, accessToken?: string): Promise<void>
```

Complete logout process

- **Parameters:** user ID, session ID, optional access token
- Flow:
  - Destroy session
  - Revoke refresh tokens for session
  - Revoke access token if provided
  - Notify identity provider
  - Publish logout event
  - Log logout event

```typescript
logoutAllSessions(userId: string, reason?: string): Promise<void>
```

Logout user from all devices

- **Parameters:** user ID, optional reason
- Flow:
  - Get all user sessions
  - Destroy all sessions
  - Revoke all refresh tokens
  - Revoke all access tokens
  - Log event
- Use case: password change, account compromise

```typescript
refreshSession(sessionId: string): Promise<void>
```

Extend session lifetime

- **Parameters:** session ID
- Updates lastAccessedAt and TTL

```typescript
validateAuthContext(context: AuthContext): boolean
```

Validate authentication context data

- **Parameters:** context object
- **Returns:** boolean
- Ensures required fields present

```typescript
getAuthenticatedUser(token: string): Promise<AuthUser>
```

Get full user object from token

- **Parameters:** access token
- **Returns:** complete user profile
- Enriches token claims with user data

```typescript
handleAuthenticationFailure(error: Error, context: AuthContext): void
```

Process failed authentication

- Log failure, check rate limits, detect attacks
- **Parameters:** error, context
- Side effects: increment failure counter, trigger lockout if needed

```typescript
checkAccountLockout(userId: string): Promise<LockoutStatus>
```

Check if account is locked

- **Parameters:** user ID
- **Returns:** `{ locked: boolean, until?: Date, reason?: string }`
- Based on failed login attempts

#### 3.3.2 AuthorizationService

**Purpose:** High-level authorization orchestration, managing permission checks and policy enforcement.

**Responsibilities:**

- Orchestrate permission checks
- Build and cache user abilities
- Enforce authorization policies
- Handle authorization errors
- Provide unified authorization interface
- Integrate with audit logging

**Functions:**

```typescript
initialize(config: AuthzServiceConfig): Promise<void>
```

Initialize authorization service

- Setup ability builder, permission checker
- Load permission policies
- **Parameters:** configuration object

```typescript
authorize(user: AuthUser, action: string, subject: any, options?: AuthzOptions): Promise<AuthorizationResult>
```

Check if user authorized for action

- Main authorization entry point
- **Parameters:** user, action, subject, options (throwOnDeny, includeReason)
- **Returns:** `{ allowed: boolean, reason?: string, requiredPermissions?: Permission[] }`
- Flow:
  - Get user ability
  - Check permission
  - Evaluate conditions
  - Log authorization check
  - Return result
- **Throws:** UnauthorizedError if options.throwOnDeny and denied

```typescript
authorizeMultiple(user: AuthUser, checks: AuthzCheck[]): Promise<BulkAuthzResult>
```

Authorize multiple actions at once

- **Parameters:** user, array of {action, subject} pairs
- **Returns:** `{ results: AuthorizationResult[], allAllowed: boolean }`
- More efficient than individual calls

```typescript
getUserAbility(user: AuthUser, options?: AbilityOptions): Promise<Ability>
```

Get CASL ability for user

- **Parameters:** user, options (skipCache, includeDisabled)
- **Returns:** CASL Ability instance
- Checks cache first
- Cache key: hash of user roles + permissions

```typescript
can(user: AuthUser, action: string, subject: any): Promise<boolean>
```

Simple permission check

- **Parameters:** user, action, subject
- **Returns:** boolean
- Shorthand for authorize without details

```typescript
cannot(user: AuthUser, action: string, subject: any): Promise<boolean>
```

Inverse permission check

- **Parameters:** user, action, subject
- **Returns:** boolean

```typescript
filterAuthorizedResources<T>(user: AuthUser, action: string, resources: T[]): Promise<T[]>
```

Filter resources by permission

- **Parameters:** user, action, resource array
- **Returns:** filtered array
- Applies bulk permission check

```typescript
getAccessibleFields(user: AuthUser, subject: any): Promise<string[]>
```

Get fields user can access

- **Parameters:** user, subject
- **Returns:** array of field names
- Used for response filtering

```typescript
enforceFieldPermissions(user: AuthUser, subject: any, data: Record<string, any>): Record<string, any>
```

Filter object fields by permissions

- **Parameters:** user, subject, data object
- **Returns:** filtered data object
- Removes fields user cannot access

```typescript
checkResourceOwnership(user: AuthUser, resource: any, ownerField?: string): boolean
```

Verify user owns resource

- **Parameters:** user, resource, owner field (default 'userId')
- **Returns:** boolean
- Common authorization condition

```typescript
createPermissionFilter(user: AuthUser, action: string, subjectType: string): Promise<QueryFilter>
```

Generate database query filter

- **Parameters:** user, action, subject type
- **Returns:** filter object for queries
- Converts permissions to WHERE clauses

```typescript
getDenialReason(user: AuthUser, action: string, subject: any): Promise<string>
```

Get human-readable denial reason

- **Parameters:** user, action, subject
- **Returns:** reason string
- For user-friendly error messages

```typescript
hasRole(user: AuthUser, role: string): boolean
```

Check if user has specific role

- **Parameters:** user, role name
- **Returns:** boolean
- Includes inherited roles

```typescript
hasAnyRole(user: AuthUser, roles: string[]): boolean
```

Check if user has any of the roles

- **Parameters:** user, array of role names
- **Returns:** boolean

```typescript
hasAllRoles(user: AuthUser, roles: string[]): boolean
```

Check if user has all roles

- **Parameters:** user, array of role names
- **Returns:** boolean

```typescript
hasPermission(user: AuthUser, permission: Permission): Promise<boolean>
```

Check specific permission

- **Parameters:** user, permission object {action, subject, conditions}
- **Returns:** boolean

```typescript
updateUserPermissions(userId: string, permissions: Permission[]): Promise<void>
```

Update custom user permissions

- **Parameters:** user ID, permissions array
- Invalidates ability cache
- Logs permission change

```typescript
invalidateUserAbility(userId: string): Promise<void>
```

Clear cached ability for user

- **Parameters:** user ID
- Called on role/permission changes

```typescript
getEffectivePermissions(user: AuthUser): Promise<Permission[]>
```

Get all permissions for user

- Includes role-based and custom permissions
- **Parameters:** user
- **Returns:** array of permission objects

```typescript
auditAuthorizationCheck(user: AuthUser, action: string, subject: any, allowed: boolean): void
```

Log authorization check

- **Parameters:** user, action, subject, result
- Side effect: writes to audit log

#### 3.3.3 TokenService

**Purpose:** High-level token operations coordinating multiple token-related managers.

**Responsibilities:**

- Coordinate token lifecycle
- Manage token generation and validation
- Handle token refresh flow
- Coordinate revocation
- Provide token utilities

**Functions:**

```typescript
generateTokenPair(user: AuthUser, sessionId: string): Promise<TokenPair>
```

Generate access and refresh tokens

- **Parameters:** user, session ID
- **Returns:** `{ accessToken, refreshToken, tokenType, expiresIn }`
- Delegates to identity provider
- Stores refresh token

```typescript
validateAccessToken(token: string, options?: ValidateOptions): Promise<TokenValidation>
```

Validate access token

- **Parameters:** token, options
- **Returns:** `{ valid: boolean, payload?: TokenPayload, error?: string }`
- Checks signature, expiry, revocation

```typescript
refreshAccessToken(refreshToken: string, userId: string): Promise<TokenPair>
```

Get new access token

- **Parameters:** refresh token, user ID
- **Returns:** new token pair
- Implements rotation if configured

```typescript
revokeToken(token: string, tokenType: 'access' | 'refresh'): Promise<void>
```

Revoke specific token

- **Parameters:** token, token type
- Revokes at provider and locally

```typescript
revokeAllUserTokens(userId: string): Promise<void>
```

Revoke all tokens for user

- **Parameters:** user ID
- Revokes access and refresh tokens

```typescript
introspectToken(token: string): Promise<TokenIntrospection>
```

Get token details

- **Parameters:** token
- **Returns:** full token metadata
- Calls provider introspection

```typescript
decodeToken(token: string): TokenPayload
```

Decode token without validation

- **Parameters:** token
- **Returns:** payload
- For inspection only

```typescript
getTokenMetadata(token: string): TokenMetadata
```

Get metadata without full validation

- **Parameters:** token
- **Returns:** basic token info

```typescript
isTokenValid(token: string): Promise<boolean>
```

Quick validity check

- **Parameters:** token
- **Returns:** boolean

```typescript
getTokenExpiry(token: string): Date
```

Get expiration time

- **Parameters:** token
- **Returns:** Date

```typescript
getRemainingTokenTime(token: string): number
```

Get seconds until expiry

- **Parameters:** token
- **Returns:** seconds

### 3.4 Middleware Layer

The Middleware Layer provides ElysiaJS middleware for authentication and authorization in HTTP APIs.

#### 3.4.1 AuthenticationMiddleware

**Purpose:** ElysiaJS middleware for REST API authentication.

**Responsibilities:**

- Intercept HTTP requests
- Extract authentication credentials
- Validate credentials
- Attach user context
- Handle authentication errors
- Support multiple auth methods

**Functions:**

```typescript
authenticate(options?: AuthMiddlewareOptions): MiddlewareHandler
```

Middleware factory

- **Parameters:** options (optional, strategies, skipRoutes)
- **Returns:** ElysiaJS middleware function
- Options:
  - strategies: `['bearer', 'apikey']` - auth methods to try
  - skipRoutes: `['/health', '/public']` - routes to skip
  - required: true - fail if no auth (default true)

**Middleware execution flow:**

```typescript
async (context, next) => {
  // 1. Check if route should skip auth
  // 2. Extract credentials from request
  // 3. Validate credentials
  // 4. Attach user to context
  // 5. Call next()
  // 6. Handle errors
};
```

```typescript
extractBearerToken(headers: Headers): string | null
```

Extract JWT from Authorization header

- **Parameters:** request headers
- **Returns:** token string or null
- Format: `"Authorization: Bearer {token}"`

```typescript
extractApiKey(request: Request): string | null
```

Extract API key from request

- Check header (X-API-Key) and query param (api_key)
- **Parameters:** request object
- **Returns:** API key or null

```typescript
validateAndAttachUser(context: Context, credentials: Credentials): Promise<void>
```

Validate credentials and add user to context

- **Parameters:** ElysiaJS context, credentials
- Side effect: sets `context.user`
- **Throws:** authentication errors

```typescript
handleAuthenticationFailure(context: Context, error: Error): Response
```

Generate error response

- **Parameters:** context, error
- **Returns:** HTTP response (401)
- Logs failure

```typescript
isPublicRoute(path: string, publicRoutes: string[]): boolean
```

Check if route requires auth

- **Parameters:** request path, public routes array
- **Returns:** boolean
- Supports glob patterns

```typescript
getAuthStrategy(request: Request): AuthStrategy | null
```

Detect which auth method to use

- **Parameters:** request
- **Returns:** strategy name or null
- Priority: Bearer token > API key

#### 3.4.2 AuthorizationMiddleware

**Purpose:** ElysiaJS middleware for permission checking.

**Responsibilities:**

- Verify user permissions
- Check resource-level access
- Handle authorization failures
- Support declarative requirements
- Provide flexible policy enforcement

**Functions:**

```typescript
authorize(requirements: AuthzRequirement | AuthzRequirement[]): MiddlewareHandler
```

Middleware factory with permission requirements

- **Parameters:** permission requirements
- **Returns:** ElysiaJS middleware function
- Example usage:

```typescript
.get('/orders', authorize({ action: 'read', subject: 'Order' }))
.patch('/orders/:id', authorize([
  { action: 'update', subject: 'Order' },
  { condition: 'ownership' }
]))
```

- AuthzRequirement types:

```typescript
{
  action: string,
  subject: string,
  fields?: string[],
  condition?: 'ownership' | ((user, resource) => boolean)
}
```

**Middleware execution flow:**

```typescript
async (context, next) => {
  // 1. Get user from context (set by auth middleware)
  // 2. Extract resource from request (if needed)
  // 3. Check permissions
  // 4. If allowed, call next()
  // 5. If denied, return 403
};
```

```typescript
checkPermissions(context: Context, requirements: AuthzRequirement[]): Promise<boolean>
```

Verify all requirements met

- **Parameters:** context, requirements array
- **Returns:** boolean
- Uses AuthorizationService

```typescript
extractResourceFromContext(context: Context): any
```

Get resource being accessed

- **Parameters:** context
- **Returns:** resource object or type
- Handles: path params, request body

```typescript
checkResourceOwnership(context: Context, resource: any): boolean
```

Verify user owns resource

- **Parameters:** context, resource
- **Returns:** boolean
- Uses ownership field from resource

```typescript
handleAuthorizationFailure(context: Context, reason: string): Response
```

Generate error response

- **Parameters:** context, denial reason
- **Returns:** HTTP response (403)
- Includes reason in response

```typescript
requireRole(role: string | string[]): MiddlewareHandler
```

Simple role check middleware

- **Parameters:** role name(s)
- **Returns:** middleware function
- Shorthand for role-based auth

```typescript
requirePermission(permission: Permission): MiddlewareHandler
```

Simple permission check middleware

- **Parameters:** permission object
- **Returns:** middleware function

#### 3.4.3 RateLimitMiddleware

**Purpose:** Rate limiting for authentication endpoints and API usage.

**Responsibilities:**

- Track request rates
- Enforce rate limits
- Prevent brute force attacks
- Support multiple limit strategies
- Provide rate limit headers

**Functions:**

```typescript
rateLimit(options: RateLimitOptions): MiddlewareHandler
```

Middleware factory

- **Parameters:** options
- **Returns:** ElysiaJS middleware function
- Options:
  - windowMs: number - time window in ms
  - maxRequests: number - max requests per window
  - keyGenerator?: (request) => string - custom key function
  - skipSuccessfulRequests?: boolean - only count failures
  - handler?: (context) => Response - custom limit exceeded handler

**Middleware execution flow:**

```typescript
async (context, next) => {
  // 1. Generate rate limit key (IP, user ID, API key)
  // 2. Increment request counter
  // 3. Check if limit exceeded
  // 4. If exceeded, return 429
  // 5. If allowed, add rate limit headers
  // 6. Call next()
};
```

```typescript
checkRateLimit(key: string, limit: number, window: number): Promise<RateLimitResult>
```

Check if request within limits

- **Parameters:** identifier key, max requests, window in ms
- **Returns:** `{ allowed: boolean, remaining: number, resetAt: Date }`
- Uses sliding window algorithm

```typescript
incrementCounter(key: string, window: number): Promise<number>
```

Record request

- **Parameters:** key, window
- **Returns:** current count
- Implements sliding window in Redis

```typescript
getRemainingRequests(key: string, limit: number, window: number): Promise<number>
```

Get requests remaining

- **Parameters:** key, limit, window
- **Returns:** remaining count

```typescript
getResetTime(key: string, window: number): Promise<Date>
```

Get when counter resets

- **Parameters:** key, window
- **Returns:** reset timestamp

```typescript
resetCounter(key: string): Promise<void>
```

Clear rate limit counter

- **Parameters:** key
- Admin function for manual reset

```typescript
generateRateLimitKey(request: Request, prefix: string): string
```

Create identifier for rate limiting

- **Parameters:** request, key prefix
- **Returns:** unique key
- Default: IP address + endpoint
- For authenticated: user ID + endpoint

```typescript
addRateLimitHeaders(response: Response, limitInfo: RateLimitInfo): void
```

Add standard rate limit headers

- **Parameters:** response, limit info
- Headers:
  - X-RateLimit-Limit: maximum requests
  - X-RateLimit-Remaining: remaining requests
  - X-RateLimit-Reset: reset timestamp
  - Retry-After: seconds to wait (if limited)

```typescript
handleRateLimitExceeded(context: Context, resetAt: Date): Response
```

Generate rate limit error response

- **Parameters:** context, reset time
- **Returns:** HTTP 429 response
- Includes Retry-After header

```typescript
configureEndpointLimits(endpoint: string, limits: RateLimitConfig): void
```

Set custom limits for endpoint

- **Parameters:** endpoint path, limit config
- Allows different limits per endpoint
- Example: stricter limits on /login

```typescript
getEndpointLimits(endpoint: string): RateLimitConfig
```

Get configured limits for endpoint

- **Parameters:** endpoint path
- **Returns:** limit configuration
- Falls back to default if not configured

  3.4.4 TenantMiddleware
  Purpose: Multi-tenant isolation and context management.
  Responsibilities:

Extract tenant identifier
Validate tenant access
Attach tenant context
Isolate tenant data
Handle tenant-specific configuration

Functions:
tenantContext(options?: TenantOptions): MiddlewareHandler

Middleware factory
Parameters: options (resolver, required, headerName)
Returns: ElysiaJS middleware function
Options:

resolver: (request) => string - custom tenant ID extraction
required: boolean - fail if no tenant (default true)
headerName: string - header for tenant ID (default X-Tenant-ID)

Middleware execution flow:
{
username: string,
password: string,
deviceId?: string,
remember?: boolean
}
validateLoginInput(request: LoginRequest): ValidationResult

Validate login request data
Parameters: login request
Returns: { valid: boolean, errors?: string[] }
Checks: required fields, format

authenticateCredentials(username: string, password: string): Promise<UserProfile>

Validate credentials with provider
Parameters: username, password
Returns: user profile
Throws: InvalidCredentialsError

handleMfaChallenge(userId: string, mfaMethod: string): Promise<MfaChallenge>

Initiate MFA flow
Parameters: user ID, MFA method (totp, sms, email)
Returns: { challengeId, method, expiresAt }
Sends code to user

verifyMfaCode(challengeId: string, code: string): Promise<boolean>

Verify MFA code
Parameters: challenge ID, code
Returns: boolean
Time-limited verification

createLoginSession(userId: string, context: AuthContext, remember: boolean): Promise<string>

Create session after successful login
Parameters: user ID, context, remember flag
Returns: session ID
TTL: 24h (web) or 30d (remember me)

generateLoginResponse(user: UserProfile, tokens: TokenPair, sessionId: string): LoginResponse

Format login response
Parameters: user, tokens, session ID
Returns: complete login response
Includes user profile subset

handleLoginFailure(username: string, reason: string, context: AuthContext): void

Process failed login attempt
Parameters: username, failure reason, context
Side effects:

Increment failure counter
Log failure
Check for account lockout
Check for brute force attack

checkAccountLockout(username: string): Promise<LockoutStatus>

Check if account is locked
Parameters: username
Returns: { locked: boolean, until?: Date, failedAttempts: number }
Locks after N failed attempts (configurable)

recordLoginAttempt(username: string, success: boolean, context: AuthContext): Promise<void>

Log login attempt
Parameters: username, success flag, context
Stored in audit log and failure tracking

### 3.5 Handler Layer

The Handler Layer provides HTTP request handlers for authentication endpoints.

#### 3.5.1 LoginHandler

**Purpose:** Handle user login requests.

**Responsibilities:**

- Process login credentials
- Validate user identity
- Generate authentication tokens
- Handle login failures
- Support multiple login methods

**Functions:**

```typescript
handleLogin(request: Request): Promise<Response>
```

Main login endpoint handler

- **Parameters:** HTTP request
- **Returns:** HTTP response with tokens
- Supports: username/password, social login, API key

**Request handling flow:**

```typescript
async (request) => {
  // 1. Parse login credentials from request body
  // 2. Validate credentials format
  // 3. Authenticate user
  // 4. Generate tokens (access + refresh)
  // 5. Return tokens in response
  // 6. Log successful login
};
```

```typescript
validateLoginRequest(body: any): LoginCredentials
```

Validate login request data

- **Parameters:** request body
- **Returns:** validated credentials
- **Throws:** validation errors
- Supports: email/password, username/password

```typescript
authenticateCredentials(credentials: LoginCredentials): Promise<User>
```

Verify user credentials

- **Parameters:** credentials
- **Returns:** user object
- **Throws:** authentication errors
- Uses AuthenticationService

```typescript
generateLoginTokens(user: User): Promise<TokenPair>
```

Create access and refresh tokens

- **Parameters:** user
- **Returns:** `{ accessToken, refreshToken }`
- Uses TokenService

```typescript
handleLoginSuccess(user: User, tokens: TokenPair): Promise<Response>
```

Format successful login response

- **Parameters:** user, tokens
- **Returns:** HTTP 200 response
- Includes: tokens, user info, expiration

```typescript
handleLoginFailure(error: Error): Response
```

Format login error response

- **Parameters:** error
- **Returns:** HTTP 401 response
- Includes: error message, retry info

```typescript
logLoginAttempt(credentials: LoginCredentials, success: boolean, error?: string): void
```

Record login attempt

- **Parameters:** credentials, success flag, error message
- Uses AuditLogger

```typescript
checkAccountLockout(userId: string): Promise<boolean>
```

Check if account is locked

- **Parameters:** user ID
- **Returns:** boolean
- Implements progressive lockout

```typescript
incrementFailedAttempts(userId: string): Promise<number>
```

Track failed login attempts

- **Parameters:** user ID
- **Returns:** current attempt count
- Triggers lockout after threshold

#### 3.5.2 LogoutHandler

Purpose: Process logout requests and cleanup.
Responsibilities:

Handle logout endpoint
Revoke tokens
Destroy sessions
Notify identity provider
Handle single logout (SLO)
Support logout from all devices

Functions:
handleLogout(request: LogoutRequest, user: AuthUser): Promise<LogoutResponse>

Main logout handler
Parameters: logout request, authenticated user
Returns: { success: boolean, message: string }
Flow:

Validate session
Revoke tokens
Destroy session
Notify provider (SLO)
Publish logout event
Log logout
Return success

LogoutRequest structure:
{
sessionId: string,
accessToken?: string,
refreshToken?: string,
logoutAll?: boolean
}
revokeSessionTokens(sessionId: string, userId: string): Promise<void>

Revoke all tokens for session
Parameters: session ID, user ID
Revokes access and refresh tokens

destroySession(sessionId: string): Promise<void>

Remove user session
Parameters: session ID
Clears from storage and cache

notifyProviderLogout(accessToken: string): Promise<void>

Inform identity provider of logout
Parameters: access token
For SSO single logout
Best effort (doesn't throw)

handleGlobalLogout(userId: string): Promise<number>

Logout user from all devices
Parameters: user ID
Returns: count of sessions terminated
Revokes all tokens and sessions

publishLogoutEvent(userId: string, sessionId: string): Promise<void>

Publish logout to event bus
Parameters: user ID, session ID
Other instances can react
Useful for WebSocket disconnection

recordLogout(userId: string, sessionId: string, reason?: string): Promise<void>

Log logout event
Parameters: user ID, session ID, optional reason
Stored in audit log

generateLogoutResponse(logoutCount: number): LogoutResponse

Format logout response
Parameters: sessions logged out count
Returns: response object

handleLogoutFailure(error: Error, userId: string): LogoutResponse

Process logout failure
Parameters: error, user ID
Returns: partial success response
Logs error but returns success (logout is best effort)

3.5.3 TokenRefreshHandler
Purpose: Handle token refresh requests with rotation.
Responsibilities:

Process refresh requests
Validate refresh tokens
Generate new tokens
Implement rotation
Detect token reuse
Handle refresh failures

Functions:
handleTokenRefresh(request: RefreshRequest, context: AuthContext): Promise<RefreshResponse>

Main refresh handler
Parameters: refresh request, context
Returns: { accessToken, refreshToken, expiresIn }
Flow:

Validate refresh token
Check token reuse
Get new tokens from provider
Rotate refresh token
Update session
Log refresh
Return new tokens

Throws: InvalidTokenError, TokenReusedError

RefreshRequest structure:
{
refreshToken: string,
deviceId?: string
}
validateRefreshRequest(request: RefreshRequest): ValidationResult

Validate refresh request
Parameters: refresh request
Returns: validation result
Checks: required fields, format

verifyRefreshToken(refreshToken: string, context: AuthContext): Promise<RefreshTokenInfo>

Validate refresh token
Parameters: refresh token, context
Returns: { userId, sessionId, familyId, metadata }
Checks: signature, expiry, revocation, reuse

detectTokenReuse(refreshToken: string): Promise<boolean>

Check if old token being reused
Parameters: refresh token
Returns: boolean (true = reuse detected)
If reuse detected:

Revoke entire token family
Terminate all sessions
Notify security team

exchangeRefreshToken(refreshToken: string): Promise<TokenPair>

Get new tokens from provider
Parameters: refresh token
Returns: new token pair
Calls identity provider

rotateRefreshToken(oldToken: string, newToken: string, userId: string): Promise<void>

Implement refresh token rotation
Parameters: old token, new token, user ID
Links tokens in same family
Invalidates old token

updateSessionOnRefresh(sessionId: string): Promise<void>

Update session after refresh
Parameters: session ID
Updates lastAccessedAt
Extends TTL if sliding expiration

handleRefreshFailure(refreshToken: string, error: Error, context: AuthContext): void

Process failed refresh
Parameters: refresh token, error, context
Logs failure
Checks for attack patterns

generateRefreshResponse(tokens: TokenPair): RefreshResponse

Format refresh response
Parameters: new tokens
Returns: response object

recordTokenRefresh(userId: string, sessionId: string, success: boolean): Promise<void>

Log refresh event
Parameters: user ID, session ID, success
Audit trail

3.5.4 WebSocketAuthHandler
Purpose: Handle WebSocket connection authentication.
Responsibilities:

Authenticate WebSocket connections
Validate tokens during upgrade
Manage WebSocket sessions
Handle token refresh over WebSocket
Track authenticated connections
Handle disconnection cleanup

Functions:
authenticateConnection(ws: WebSocket, request: Request): Promise<WSAuthResult>

Authenticate WebSocket connection
Parameters: WebSocket instance, upgrade request
Returns: { authenticated: boolean, userId?: string, sessionId?: string, error?: string }
Flow:

Extract token from request
Validate token
Create WebSocket session
Attach user context
Register connection
Return result

Called during WebSocket upgrade

extractTokenFromRequest(request: Request): string | null

Get auth token from WebSocket request
Parameters: upgrade request
Returns: token or null
Checks: query param (?token=...), Sec-WebSocket-Protocol header
Example: ws://api.com/ws?token=eyJ...

validateWebSocketToken(token: string): Promise<TokenValidation>

Validate token for WebSocket
Parameters: token
Returns: validation result
Similar to REST but allows longer expiry

attachUserToWebSocket(ws: WebSocket, user: AuthUser, sessionId: string): void

Store user context in WebSocket
Parameters: WebSocket, user, session ID
Side effect: sets ws.data.user, ws.data.sessionId
Available to message handlers

createWebSocketSession(userId: string, connectionId: string, metadata: WSMetadata): Promise<string>

Create session for WebSocket
Parameters: user ID, connection ID, metadata
Returns: session ID
Longer TTL than HTTP sessions
Tracks connection info

registerConnection(userId: string, connectionId: string, ws: WebSocket): Promise<void>

Register active WebSocket connection
Parameters: user ID, connection ID, WebSocket instance
Stores in registry for routing
Enables user notifications

handleTokenRefreshOverWS(ws: WebSocket, refreshToken: string): Promise<TokenPair>

Refresh token for active connection
Parameters: WebSocket, refresh token
Returns: new token pair
Sends new tokens via WebSocket message
Updates connection context

sendAuthenticationError(ws: WebSocket, error: AuthError): void

Send auth error to client
Parameters: WebSocket, error
Message format: { type: 'auth_error', code: string, message: string }
Closes connection after sending

handleWebSocketDisconnect(ws: WebSocket): Promise<void>

Cleanup on connection close
Parameters: WebSocket
Flow:

Remove from connection registry
Update session lastDisconnectedAt
Log disconnection
Cleanup resources

disconnectUnauthenticated(ws: WebSocket, reason: string): void

Force close unauthenticated connection
Parameters: WebSocket, reason
Sends error message
Closes with code 4401 (Unauthorized)

getConnectionInfo(connectionId: string): Promise<WSConnectionInfo | null>

Get connection details
Parameters: connection ID
Returns: connection info or null
Info: userId, connectedAt, ip, userAgent

getUserConnections(userId: string): Promise<WSConnectionInfo[]>

Get all WebSocket connections for user
Parameters: user ID
Returns: array of connection info
Used for user notifications

trackConnectionMetrics(connectionId: string, event: WSEvent): Promise<void>

Track WebSocket events
Parameters: connection ID, event
Events: message_sent, message_received, ping, pong
For monitoring and analytics

3.5.5 WebSocketAuthorizationHandler
Purpose: Handle authorization for WebSocket messages and channels.
Responsibilities:

Check permissions for messages
Validate channel subscriptions
Authorize publish actions
Handle authorization failures
Support real-time permission updates

Functions:
authorizeMessage(ws: WebSocket, message: WSMessage): Promise<AuthzResult>

Authorize incoming WebSocket message
Parameters: WebSocket, message
Returns: { allowed: boolean, reason?: string }
Flow:

Get user from WebSocket context
Parse message action and resource
Check permissions
Return result

Called before processing each message

authorizeChannelSubscription(ws: WebSocket, channel: string): Promise<boolean>

Check if user can subscribe to channel
Parameters: WebSocket, channel name
Returns: boolean
Examples:

user:{userId}:notifications (own notifications)
orders:_ (all orders - admin only)
public:_ (public channels - all users)

authorizeChannelPublish(ws: WebSocket, channel: string, data: any): Promise<AuthzResult>

Check if user can publish to channel
Parameters: WebSocket, channel, message data
Returns: authorization result
Stricter than subscription (fewer can publish)

getWebSocketUserAbility(ws: WebSocket): Promise<Ability>

Get CASL ability for WebSocket user
Parameters: WebSocket
Returns: CASL Ability
Cached per connection

parseChannelPermissions(channel: string): ChannelPermissions

Extract permission requirements from channel name
Parameters: channel name
Returns: { resource: string, action: string, conditions: object }
Channel format: {resource}:{id}:{action}
Example: orders:123:updates → read Order 123

handleWSAuthorizationFailure(ws: WebSocket, reason: string): void

Send authorization error
Parameters: WebSocket, reason
Message format: { type: 'authorization_error', message: string }
Doesn't close connection (unlike auth failure)

subscribeToChannel(ws: WebSocket, channel: string): Promise<void>

Subscribe after authorization
Parameters: WebSocket, channel
Tracks subscription
Enables message routing

unsubscribeFromChannel(ws: WebSocket, channel: string): Promise<void>

Remove channel subscription
Parameters: WebSocket, channel
Cleanup subscription tracking

getUserSubscriptions(ws: WebSocket): string[]

Get all channels user subscribed to
Parameters: WebSocket
Returns: array of channel names
For connection state

checkMessagePermission(user: AuthUser, messageType: string, payload: any): Promise<boolean>

Check permission for message type
Parameters: user, message type, payload
Returns: boolean
Message types: chat_send, order_update, admin_command

filterMessageFields(user: AuthUser, message: any): any

Remove fields user can't see
Parameters: user, message object
Returns: filtered message
Applied before sending to client

validateMessageFormat(message: WSMessage): ValidationResult

Validate WebSocket message structure
Parameters: message
Returns: validation result
Required: type, optionally payload

### 3.6 Utility Components

The Utility Components provide supporting functionality for monitoring, configuration, and system health.

#### 3.6.1 AuditLogger

**Purpose:** Log authentication and authorization events for compliance and security.

**Responsibilities:**

- Log auth events
- Store audit trail
- Support audit queries
- Archive old logs
- Provide compliance reports

**Functions:**

```typescript
initialize(config: AuditConfig): Promise<void>
```

Initialize audit logger

- Setup storage backend
- **Parameters:** `{ storage: 'db' | 'file', retentionDays, logLevel }`

```typescript
logAuthenticationAttempt(event: AuthEvent): Promise<void>
```

Record login attempt

- **Parameters:** auth event
- Event: `{ userId, username, success, reason, ip, userAgent, timestamp }`
- Severity: INFO (success), WARNING (failure)

```typescript
logAuthorizationCheck(event: AuthzEvent): Promise<void>
```

Record permission check

- **Parameters:** authz event
- Event: `{ userId, action, resource, allowed, reason, timestamp }`
- Only logs denials by default (configurable)

```typescript
logTokenOperation(event: TokenEvent): Promise<void>
```

Record token operation

- **Parameters:** token event
- Event: `{ operation: 'generated' | 'refreshed' | 'revoked', tokenId, userId, timestamp }`

```typescript
logApiKeyUsage(event: ApiKeyEvent): Promise<void>
```

Record API key usage

- **Parameters:** API key event
- Event: `{ apiKeyId, userId, endpoint, ip, timestamp }`

```typescript
logSessionEvent(event: SessionEvent): Promise<void>
```

Record session event

- **Parameters:** session event
- Event: `{ sessionId, userId, event: 'created' | 'destroyed' | 'expired', metadata, timestamp }`

```typescript
logSecurityEvent(event: SecurityEvent): Promise<void>
```

Record security incident

- **Parameters:** security event
- Event: `{ type: 'token_reuse' | 'brute_force' | 'account_lockout', severity, userId, details, timestamp }`
- High severity events trigger alerts

```typescript
queryAuditLogs(query: AuditQuery): Promise<AuditLog[]>
```

Retrieve audit records

- **Parameters:** query object
- Query: `{ userId?, eventType?, startDate?, endDate?, limit?, offset? }`
- **Returns:** matching audit logs

```typescript
getUserAuditTrail(userId: string, options?: AuditOptions): Promise<AuditLog[]>
```

Get complete audit trail for user

- **Parameters:** user ID, options
- **Returns:** all events for user
- Options: dateRange, eventTypes, limit

```typescript
getFailedLoginAttempts(userId: string, since: Date): Promise<number>
```

Count failed login attempts

- **Parameters:** user ID, start date
- **Returns:** failure count
- Used for lockout logic

```typescript
archiveOldLogs(retentionDays: number): Promise<number>
```

Archive or delete old logs

- **Parameters:** retention period
- **Returns:** count of archived logs
- Periodic cleanup job

```typescript
exportAuditLogs(query: AuditQuery, format: 'json' | 'csv'): Promise<string>
```

Export audit logs

- **Parameters:** query, output format
- **Returns:** formatted data
- For compliance reports

```typescript
generateComplianceReport(startDate: Date, endDate: Date): Promise<ComplianceReport>
```

Generate audit report

- **Parameters:** date range
- **Returns:** comprehensive report
- Includes: auth stats, security events, access patterns

#### 3.6.2 MetricsCollector

**Purpose:** Collect authentication/authorization metrics for monitoring and observability.

**Responsibilities:**

- Track auth performance
- Record operation counts
- Calculate success rates
- Support monitoring systems
- Provide real-time metrics

**Functions:**

```typescript
initialize(config: MetricsConfig): Promise<void>
```

Initialize metrics collector

- Setup metrics backend
- **Parameters:** `{ backend: 'prometheus' | 'statsd', endpoint, interval }`

```typescript
recordAuthenticationAttempt(success: boolean, duration: number, method: string): void
```

Track login attempt

- **Parameters:** success, duration ms, auth method
- Increments counters
- Records latency histogram

```typescript
recordTokenValidation(cached: boolean, duration: number): void
```

Track token validation

- **Parameters:** from cache flag, duration
- Metrics: cache hit rate, validation latency

```typescript
recordPermissionCheck(duration: number, result: boolean): void
```

Track authorization check

- **Parameters:** duration, allowed
- Metrics: check latency, denial rate

```typescript
recordApiKeyUsage(apiKeyId: string): void
```

Track API key usage

- **Parameters:** API key ID
- Counts calls per key

```typescript
recordSessionOperation(operation: string, duration: number): void
```

Track session operations

- **Parameters:** operation type, duration
- Operations: create, read, update, destroy

```typescript
recordTokenRefresh(success: boolean, duration: number): void
```

Track token refresh

- **Parameters:** success, duration
- Metrics: refresh rate, failure rate

```typescript
recordRateLimitHit(endpoint: string): void
```

Track rate limit exceeded

- **Parameters:** endpoint
- Identifies abuse patterns

```typescript
incrementCounter(name: string, tags?: Record<string, string>): void
```

Increment custom counter

- **Parameters:** counter name, optional tags
- Generic counter for custom metrics

```typescript
recordGauge(name: string, value: number, tags?: Record<string, string>): void
```

Set gauge value

- **Parameters:** gauge name, value, tags
- Examples: active sessions, cache size

```typescript
recordHistogram(name: string, value: number, tags?: Record<string, string>): void
```

Record value distribution

- **Parameters:** histogram name, value, tags
- Examples: latencies, response sizes

```typescript
getMetrics(): Promise<MetricsSnapshot>
```

Get current metrics

- **Returns:** snapshot of all metrics
- Format: `{ counters, gauges, histograms, timestamp }`

```typescript
getAuthenticationStats(): Promise<AuthStats>
```

Get auth statistics

- **Returns:** `{ totalAttempts, successRate, avgDuration, failuresByReason }`

```typescript
getPerformanceMetrics(): Promise<PerformanceMetrics>
```

Get performance stats

- **Returns:** `{ avgTokenValidation, avgPermissionCheck, cacheHitRate, p95Latency, p99Latency }`

```typescript
resetMetrics(): void
```

Reset all counters

- Used for testing or periodic reset

#### 3.6.3 HealthCheckService

**Purpose:** Monitor health of auth system and dependencies.

**Responsibilities:**

- Check component health
- Monitor dependencies
- Provide health status
- Support readiness/liveness probes
- Detect degraded state

**Functions:**

```typescript
initialize(): Promise<void>
```

Initialize health check service

- Register health checks
- Setup monitoring interval

```typescript
getHealth(): Promise<HealthStatus>
```

Get overall system health

- **Returns:** `{ healthy: boolean, status: 'healthy' | 'degraded' | 'unhealthy', checks: HealthCheck[], timestamp }`
- Aggregates all component checks

```typescript
checkKeycloakHealth(): Promise<HealthCheck>
```

Check identity provider health

- **Returns:** `{ name: 'keycloak', healthy: boolean, responseTime: number, error?: string }`
- Tests connectivity and response time

```typescript
checkCacheHealth(): Promise<HealthCheck>
```

Check cache backend health

- **Returns:** `{ name: 'cache', healthy: boolean, hitRate: number, latency: number }`
- Tests Redis/memory cache

```typescript
checkDatabaseHealth(): Promise<HealthCheck>
```

Check storage backend health

- **Returns:** `{ name: 'database', healthy: boolean, connectionPool: number, latency: number }`
- Tests database connectivity

```typescript
checkEventBusHealth(): Promise<HealthCheck>
```

Check event bus health

- **Returns:** `{ name: 'eventbus', healthy: boolean, latency: number }`

```typescript
getReadinessStatus(): Promise<boolean>
```

Check if ready to serve requests

- **Returns:** boolean
- All critical components must be healthy
- Used for Kubernetes readiness probe

```typescript
getLivenessStatus(): Promise<boolean>
```

Check if service is alive

- **Returns:** boolean
- Basic health check
- Used for Kubernetes liveness probe

```typescript
getDetailedHealth(): Promise<DetailedHealth>
```

Get comprehensive health info

- **Returns:** detailed status of all components
- Includes: uptime, version, config status, dependency health

```typescript
registerHealthCheck(name: string, checkFn: () => Promise<boolean>): void
```

Add custom health check

- **Parameters:** check name, async check function
- Extensibility for custom components

```typescript
removeHealthCheck(name: string): void
```

Remove health check

- **Parameters:** check name

#### 3.6.4 ConfigManager

**Purpose:** Centralized configuration management with validation and hot-reload.

**Responsibilities:**

- Load configuration
- Validate config
- Provide config access
- Support environment overrides
- Enable hot-reload

**Functions:**

```typescript
loadConfig(sources: ConfigSource[]): Promise<Config>
```

Load configuration from multiple sources

- **Parameters:** config sources (file, env, remote)
- **Returns:** merged configuration
- Priority: env vars > file > defaults

```typescript
validateConfig(config: Config): ValidationResult
```

Validate configuration

- **Parameters:** config object
- **Returns:** validation result
- Checks: required fields, types, ranges

```typescript
getKeycloakConfig(): KeycloakConfig
```

Get identity provider config

- **Returns:** `{ serverUrl, realm, clientId, clientSecret, timeout }`

```typescript
getTokenConfig(): TokenConfig
```

Get token settings

- **Returns:** `{ issuer, audience, algorithms, accessTokenTTL, refreshTokenTTL, clockTolerance }`

```typescript
getSessionConfig(): SessionConfig
```

Get session settings

- **Returns:** `{ storage, ttl, slidingExpiration, maxSessions, cookieSettings }`

```typescript
getCacheConfig(): CacheConfig
```

Get cache settings

- **Returns:** `{ backend, redisUrl, ttl, maxSize }`

```typescript
getApiKeyConfig(): ApiKeyConfig
```

Get API key settings

- **Returns:** `{ keyLength, hashAlgorithm, defaultExpiry, prefix }`

```typescript
getRateLimitConfig(): RateLimitConfig
```

Get rate limit settings

- **Returns:** `{ windowMs, maxRequests, endpointLimits }`

```typescript
getAuditConfig(): AuditConfig
```

Get audit settings

- **Returns:** `{ enabled, storage, retentionDays, logLevel }`

```typescript
updateConfig(path: string, value: any): void
```

Update configuration value

- **Parameters:** config path (dot notation), new value
- Example: `updateConfig('rateLimit.maxRequests', 200)`
- Validates before applying

```typescript
reloadConfig(): Promise<void>
```

Reload configuration from sources

- Hot-reload without restart
- Publishes config change event

```typescript
watchConfig(path: string, callback: (value: any) => void): () => void
```

Watch config changes

- **Parameters:** config path, callback
- **Returns:** unwatch function
- Callback called on config updates

```typescript
mergeWithDefaults(config: Partial<Config>): Config
```

Apply default values

- **Parameters:** partial config
- **Returns:** complete config
- Fills missing values with defaults

```typescript
exportConfig(format: 'json' | 'yaml'): string
```

Export current configuration

- **Parameters:** output format
- **Returns:** formatted config string
- Excludes secrets

### 3.7 WebSocket Specific

The WebSocket Specific components provide real-time communication capabilities with authentication and authorization.

#### 3.7.1 WebSocketConnectionRegistry

**Purpose:** Track and manage WebSocket connections across service instances.

**Responsibilities:**

- Register active connections
- Route messages to connections
- Support load-balanced WS
- Track connection metadata
- Enable user notifications

**Functions:**

```typescript
registerConnection(userId: string, connectionId: string, instanceId: string, metadata: WSMetadata): Promise<void>
```

Register new WebSocket connection

- **Parameters:** user ID, connection ID, instance ID, metadata
- Metadata: `{ ip, userAgent, connectedAt, sessionId }`
- Stores in Redis for cross-instance access
- TTL: connection timeout + buffer

```typescript
unregisterConnection(connectionId: string): Promise<void>
```

Remove connection from registry

- **Parameters:** connection ID
- Called on disconnect
- Cleanup associated data

```typescript
getConnectionsForUser(userId: string): Promise<WSConnectionInfo[]>
```

Find all connections for user

- **Parameters:** user ID
- **Returns:** array of connection info
- Includes instance IDs for routing
- Used for user-targeted messages

```typescript
getConnection(connectionId: string): Promise<WSConnectionInfo | null>
```

Get connection details

- **Parameters:** connection ID
- **Returns:** connection info or null
- Info: `{ userId, instanceId, connectedAt, metadata }`

```typescript
isUserConnected(userId: string): Promise<boolean>
```

Check if user has active connections

- **Parameters:** user ID
- **Returns:** boolean
- Fast check using Redis

```typescript
getUserConnectionCount(userId: string): Promise<number>
```

Count active connections for user

- **Parameters:** user ID
- **Returns:** connection count

```typescript
getAllConnections(instanceId?: string): Promise<WSConnectionInfo[]>
```

Get all active connections

- **Parameters:** optional instance ID filter
- **Returns:** array of connections
- Used for broadcasting

```typescript
getConnectionsByInstance(instanceId: string): Promise<WSConnectionInfo[]>
```

Get connections for specific instance

- **Parameters:** instance ID
- **Returns:** connections on that instance
- Used for instance-specific operations

```typescript
routeMessageToUser(userId: string, message: any): Promise<number>
```

Send message to all user connections

- **Parameters:** user ID, message
- **Returns:** count of connections messaged
- Uses event bus for cross-instance delivery

```typescript
routeMessageToConnection(connectionId: string, message: any): Promise<boolean>
```

Send message to specific connection

- **Parameters:** connection ID, message
- **Returns:** true if delivered
- Routes to correct instance

```typescript
broadcastMessage(message: any, filter?: ConnectionFilter): Promise<number>
```

Send message to multiple connections

- **Parameters:** message, optional filter
- Filter: `{ userIds?, instanceIds?, channels? }`
- **Returns:** count of connections messaged

```typescript
updateConnectionMetadata(connectionId: string, metadata: Partial<WSMetadata>): Promise<void>
```

Update connection metadata

- **Parameters:** connection ID, partial metadata
- Example: update last activity timestamp

```typescript
cleanupStaleConnections(timeout: number): Promise<number>
```

Remove inactive connections

- **Parameters:** timeout in seconds
- **Returns:** count of cleaned connections
- Periodic cleanup job

```typescript
getConnectionStats(): Promise<ConnectionStats>
```

Get registry statistics

- **Returns:** `{ totalConnections, uniqueUsers, connectionsByInstance }`

```typescript
lockConnection(connectionId: string, timeout: number): Promise<boolean>
```

Acquire distributed lock on connection

- **Parameters:** connection ID, timeout ms
- **Returns:** true if lock acquired
- Prevents concurrent operations

```typescript
unlockConnection(connectionId: string): Promise<void>
```

Release connection lock

- **Parameters:** connection ID

#### 3.7.2 WebSocketChannelManager

**Purpose:** Manage pub/sub channels for WebSocket communication.

**Responsibilities:**

- Manage channel subscriptions
- Route messages to channels
- Handle channel permissions
- Support pattern-based channels
- Track channel members

**Functions:**

```typescript
subscribeToChannel(connectionId: string, channel: string): Promise<void>
```

Subscribe connection to channel

- **Parameters:** connection ID, channel name
- Stores subscription in Redis
- Enables message routing

```typescript
unsubscribeFromChannel(connectionId: string, channel: string): Promise<void>
```

Remove channel subscription

- **Parameters:** connection ID, channel name
- Cleanup subscription

```typescript
unsubscribeAll(connectionId: string): Promise<void>
```

Remove all subscriptions for connection

- **Parameters:** connection ID
- Called on disconnect

```typescript
publishToChannel(channel: string, message: any, excludeConnections?: string[]): Promise<number>
```

Publish message to channel

- **Parameters:** channel, message, optional exclusions
- **Returns:** count of recipients
- Uses Redis pub/sub for cross-instance

```typescript
getChannelSubscribers(channel: string): Promise<string[]>
```

Get all connections subscribed to channel

- **Parameters:** channel name
- **Returns:** array of connection IDs

```typescript
getSubscriptions(connectionId: string): Promise<string[]>
```

Get channels for connection

- **Parameters:** connection ID
- **Returns:** array of channel names

```typescript
getChannelCount(): Promise<number>
```

Count active channels

- **Returns:** channel count

```typescript
getUserChannels(userId: string): Promise<string[]>
```

Get channels user is subscribed to

- **Parameters:** user ID
- **Returns:** channel names
- Across all user connections

```typescript
createPrivateChannel(participants: string[]): Promise<string>
```

Create private channel for users

- **Parameters:** array of user IDs
- **Returns:** channel ID
- Format: `private:{hash}`
- Used for direct messages

```typescript
deleteChannel(channel: string): Promise<void>
```

Remove channel and subscriptions

- **Parameters:** channel name
- Unsubscribes all members
- Cleanup channel data

```typescript
matchChannelPattern(pattern: string): Promise<string[]>
```

Find channels matching pattern

- **Parameters:** glob pattern
- **Returns:** matching channel names
- Example: `"orders:*"` matches all order channels

```typescript
getChannelMetadata(channel: string): Promise<ChannelMetadata | null>
```

Get channel information

- **Parameters:** channel name
- **Returns:** `{ createdAt, memberCount, lastActivity, permissions }`

```typescript
setChannelMetadata(channel: string, metadata: Partial<ChannelMetadata>): Promise<void>
```

Update channel metadata

- **Parameters:** channel name, metadata
- Store channel configuration

```typescript
cleanupEmptyChannels(): Promise<number>
```

Remove channels with no subscribers

- **Returns:** count of deleted channels
- Periodic cleanup

### 3.8 Security & Resilience

The Security & Resilience components provide fault tolerance and security enhancements.

#### 3.8.1 RetryPolicy

**Purpose:** Implement retry logic with exponential backoff for resilience.

**Responsibilities:**

- Retry failed operations
- Implement backoff strategies
- Prevent retry storms
- Handle transient failures
- Support custom retry conditions

**Functions:**

```typescript
constructor(config: RetryConfig)
```

Initialize retry policy

- **Parameters:** `{ maxRetries, initialDelay, maxDelay, backoffMultiplier, retryableErrors }`
- Defaults: maxRetries=3, initialDelay=100ms, maxDelay=10s, multiplier=2

```typescript
execute<T>(operation: () => Promise<T>, context?: string): Promise<T>
```

Execute operation with retries

- **Parameters:** async operation, optional context
- **Returns:** operation result
- Implements exponential backoff
- **Throws:** original error if all retries exhausted

```typescript
executeWithTimeout<T>(operation: () => Promise<T>, timeout: number): Promise<T>
```

Execute with timeout and retries

- **Parameters:** operation, timeout ms
- **Returns:** operation result
- Combines timeout and retry logic
- **Throws:** TimeoutError or operation error

```typescript
shouldRetry(error: Error, attemptNumber: number): boolean
```

Determine if error is retryable

- **Parameters:** error, attempt number
- **Returns:** boolean
- Checks: error type, attempt count, retry conditions
- Only retries transient errors (network, timeout, 503)

```typescript
calculateDelay(attemptNumber: number): number
```

Calculate backoff delay

- **Parameters:** attempt number
- **Returns:** delay in ms
- Formula: min(initialDelay \* (multiplier ^ attempt), maxDelay)
- Adds jitter to prevent thundering herd

```typescript
addJitter(delay: number): number
```

Add random jitter to delay

- **Parameters:** base delay
- **Returns:** delay with jitter
- Jitter: ±10% of delay
- Prevents synchronized retries

```typescript
onRetry(callback: (error: Error, attempt: number) => void): void
```

Register retry callback

- **Parameters:** callback function
- Called before each retry
- Used for logging, metrics

```typescript
reset(): void
```

Reset retry state

- Clears attempt counter

#### 3.8.2 DegradationManager

**Purpose:** Manage graceful degradation when dependencies fail.

**Responsibilities:**

- Detect service degradation
- Enable degraded modes
- Fallback to cached data
- Provide limited functionality
- Track degradation state

**Functions:**

```typescript
initialize(config: DegradationConfig): void
```

Initialize degradation manager

- **Parameters:** `{ features, fallbacks, thresholds }`
- Configure degradation policies

```typescript
enableDegradedMode(feature: string, reason: string): void
```

Enable degraded mode for feature

- **Parameters:** feature name, reason
- Disables feature or enables fallback
- Publishes degradation event
- Logs degradation

```typescript
disableDegradedMode(feature: string): void
```

Restore normal mode

- **Parameters:** feature name
- Re-enables feature
- Publishes restoration event

```typescript
isFeatureAvailable(feature: string): boolean
```

Check if feature is available

- **Parameters:** feature name
- **Returns:** boolean
- False if in degraded mode

```typescript
getDegradedFeatures(): string[]
```

Get list of degraded features

- **Returns:** array of feature names

```typescript
registerFallback(feature: string, fallback: FallbackHandler): void
```

Register fallback for feature

- **Parameters:** feature name, fallback function
- Called when feature degraded
- Example: cache-only auth when Keycloak down

```typescript
executeFallback<T>(feature: string, defaultValue?: T): Promise<T>
```

Execute fallback handler

- **Parameters:** feature name, optional default
- **Returns:** fallback result
- **Throws:** if no fallback registered

```typescript
checkDependencyHealth(dependency: string): Promise<boolean>
```

Check if dependency is healthy

- **Parameters:** dependency name
- **Returns:** boolean
- Used to trigger degradation

```typescript
setHealthThreshold(dependency: string, threshold: HealthThreshold): void
```

Configure health threshold

- **Parameters:** dependency, threshold config
- Threshold: `{ errorRate, responseTime, consecutiveFailures }`
- Triggers degradation when exceeded

```typescript
getDegradationStatus(): DegradationStatus
```

Get current degradation state

- **Returns:** `{ degraded: boolean, features: DegradedFeature[], since?: Date }`

```typescript
onDegradation(callback: (feature: string, reason: string) => void): void
```

Register degradation listener

- **Parameters:** callback
- Called when degradation triggered

```typescript
onRestoration(callback: (feature: string) => void): void
```

Register restoration listener

- **Parameters:** callback
- Called when feature restored

#### 3.8.3 PasswordPolicyValidator

**Purpose:** Enforce password complexity and security policies.

**Responsibilities:**

- Validate password strength
- Check password history
- Enforce complexity rules
- Prevent common passwords
- Check password expiry

**Functions:**

```typescript
initialize(config: PasswordPolicyConfig): void
```

Initialize validator

- **Parameters:** policy configuration
- Config: `{ minLength, requireUppercase, requireLowercase, requireNumbers, requireSymbols, maxAge, historySize, bannedPasswords }`

```typescript
validatePasswordStrength(password: string): ValidationResult
```

Check password meets policy

- **Parameters:** password
- **Returns:** `{ valid: boolean, errors: string[], score: number }`
- Checks: length, complexity, patterns
- Score: 0-100 (strength indicator)

```typescript
checkPasswordComplexity(password: string): ComplexityResult
```

Evaluate password complexity

- **Parameters:** password
- **Returns:** `{ hasUppercase, hasLowercase, hasNumbers, hasSymbols, length, entropy }`
- Detailed complexity analysis

```typescript
checkPasswordHistory(userId: string, password: string): Promise<boolean>
```

Prevent password reuse

- **Parameters:** user ID, new password
- **Returns:** true if password not in history
- Checks last N passwords (configurable)
- Compares hashed values

```typescript
isPasswordExpired(userId: string): Promise<boolean>
```

Check if password expired

- **Parameters:** user ID
- **Returns:** boolean
- Based on last password change date

```typescript
checkCommonPassword(password: string): boolean
```

Check if password is commonly used

- **Parameters:** password
- **Returns:** true if common
- Uses list of top 10k common passwords

```typescript
calculatePasswordEntropy(password: string): number
```

Calculate password entropy

- **Parameters:** password
- **Returns:** entropy in bits
- Higher = stronger

```typescript
suggestStrongPassword(length?: number): string
```

Generate strong password suggestion

- **Parameters:** optional length (default 16)
- **Returns:** random strong password
- Meets all policy requirements

```typescript
addPasswordToHistory(userId: string, passwordHash: string): Promise<void>
```

Add password to history

- **Parameters:** user ID, password hash
- Maintains history size limit
- Stores only hashes

```typescript
getPasswordPolicy(): PasswordPolicyConfig
```

Get current policy configuration

- **Returns:** policy config
- For display to users

```typescript
validatePasswordChange(userId: string, oldPassword: string, newPassword: string): Promise<ValidationResult>
```

Validate password change

- **Parameters:** user ID, old password, new password
- **Returns:** validation result
- Checks: old password correct, new password valid, not in history

---

## 3.9 PLUGIN & INITIALIZATION

### 3.9.1 AuthPlugin

**Purpose:** Main ElysiaJS plugin that integrates all auth components.

**Responsibilities:**

- Initialize auth system
- Register middleware
- Expose auth routes
- Configure WebSocket auth
- Provide utilities to app
- Manage lifecycle

**Functions:**

```typescript
install(app: Elysia, config: AuthPluginConfig): Elysia
```

- Install plu```gin on ElysiaJS app
- Parameters: Elysia instance, configuration
- Returns: configured Elysia instance
- Main entry point for library
- Usage:

```typescript

registerMiddleware(app: Elysia): void
```

Add authentication middleware
Parameters: Elysia instance
Adds: auth middleware, rate limiting, tenant context
Makes middleware available globally or per-route

```typescript
registerRoutes(app: Elysia, config: RouteConfig): void
```

Add auth endpoints
Parameters: Elysia instance, route config
Routes:

POST /auth/login - login endpoint
POST /auth/logout - logout endpoint
POST /auth/refresh - token refresh
GET /auth/me - get current user
GET /auth/sessions - list user sessions
POST /apikeys - generate API key
GET /apikeys - list API keys
DELETE /apikeys/:id - revoke API key

Prefix configurable (default /auth)

```typescript
initializeServices(config: AuthPluginConfig): Promise<void>
```

Initialize all auth services
Parameters: configuration
Creates and configures all managers and services
Establishes connections to dependencies

configureWebSocket(app: Elysia): void

Setup WebSocket authentication
Parameters: Elysia instance
Adds: WS auth handler, WS authz handler
Configures WebSocket upgrade handler

```typescript
exposeUtilities(app: Elysia): void
```

Make auth functions available to routes
Parameters: Elysia instance
Adds to context:

context.auth - AuthenticationService
context.authz - AuthorizationService
context.user - current user (if authenticated)
context.session - current session
context.can - permission check function

registerHealthCheck(app: Elysia): void

Add health check endpoints
Parameters: Elysia instance
Endpoints:

GET /health - overall health
GET /health/live - liveness probe
GET /health/ready - readiness probe

startBackgroundJobs(): void

Start periodic tasks
Jobs:

Session cleanup (every 5 minutes)
Token revocation cleanup (every 10 minutes)
API key cleanup (hourly)
Audit log archival (daily)
Metrics aggregation (every minute)
Public key refresh (every 30 minutes)

shutdown(): Promise<void>

Graceful shutdown
Cleanup:

Stop background jobs
Close connections (cache, storage, event bus)
Flush metrics
Archive pending audit logs

Called on process termination

getVersion(): string

Get library version
Returns: version string

getConfig(): AuthPluginConfig

Get current configuration
Returns: configuration object
Secrets masked

3.9.2 UserContextManager
Purpose: Manage user context throughout request lifecycle.
Responsibilities:

Store user in request context
Provide user access to handlers
Cache user data during request
Support tenant context
Clean up after request

Functions:
setUserContext(context: Context, user: AuthUser, session: Session): void

Store user in request context
Parameters: Elysia context, user, session
Side effect: sets context.user, context.session
Available to all handlers

getUserContext(context: Context): AuthUser | null

Retrieve current user
Parameters: Elysia context
Returns: user or null if not authenticated

getSessionContext(context: Context): Session | null

Get current session
Parameters: Elysia context
Returns: session or null

getUserRoles(context: Context): string[]

Get user roles from context
Parameters: context
Returns: array of role names
Empty array if not authenticated

getUserPermissions(context: Context): Permission[]

Get user permissions
Parameters: context
Returns: array of permissions

getUserAbility(context: Context): Promise<Ability>

Get CASL ability for current user
Parameters: context
Returns: Ability instance
Cached per request

getTenantContext(context: Context): string | null

Get tenant from context
Parameters: context
Returns: tenant ID or null

setTenantContext(context: Context, tenantId: string): void

Store tenant in context
Parameters: context, tenant ID
Side effect: sets context.tenant

enrichUserContext(context: Context, additionalData: Record<string, any>): void

Add extra data to user context
Parameters: context, data object
Merges with existing user data

clearUserContext(context: Context): void

Remove user data from context
Parameters: context
Called after request processing

hasRole(context: Context, role: string): boolean

Check if user has role
Parameters: context, role name
Returns: boolean
Convenience function

can(context: Context, action: string, subject: any): Promise<boolean>

Check permission from context
Parameters: context, action, subject
Returns: boolean
Convenience function

requireUser(context: Context): AuthUser

Get user or throw
Parameters: context
Returns: user
Throws: UnauthenticatedError if no user

getUserId(context: Context): string | null

Get user ID from context
Parameters: context
Returns: user ID or null
Quick access to ID only ### 3.10 Data Models & Types

The Data Models & Types section defines the core interfaces and types used throughout the authentication library.

#### 3.10.1 Core Types

**AuthUser:** Represents an authenticated user with all profile information.

```typescript
interface AuthUser {
  userId: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  permissions: Permission[];
  tenantId?: string;
  metadata: Record<string, any>;
  emailVerified: boolean;
  accountLocked: boolean;
  passwordExpiresAt?: Date;
  lastLogin?: Date;
}
```

**TokenPair:** Contains access and refresh tokens with metadata.

```typescript
interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number; // seconds
  scope?: string;
}
```

**TokenPayload:** JWT payload structure with standard and custom claims.

```typescript
interface TokenPayload {
  sub: string; // user ID
  iss: string; // issuer
  aud: string | string[]; // audience
  exp: number; // expiry (unix timestamp)
  iat: number; // issued at
  jti: string; // JWT ID
  scope?: string;
  roles?: string[];
  permissions?: Permission[];
  tenantId?: string;
  [key: string]: any; // custom claims
}
```

**Session:** User session data with metadata and expiration.

```typescript
interface Session {
  sessionId: string;
  userId: string;
  tenantId?: string;
  createdAt: Date;
  expiresAt: Date;
  lastAccessedAt: Date;
  data: Record<string, any>;
  metadata: {
    ip: string;
    userAgent: string;
    deviceId?: string;
    location?: string;
  };
}
```

**Permission:** CASL permission structure with actions and conditions.

```typescript
interface Permission {
  action: string; // 'create', 'read', 'update', 'delete', 'manage'
  subject: string; // resource type
  fields?: string[]; // specific fields
  conditions?: Record<string, any>; // dynamic conditions
  inverted?: boolean; // permission denial
}
```

**ApiKeyInfo:** API key metadata and configuration.

```typescript
interface ApiKeyInfo {
  apiKeyId: string;
  userId: string;
  tenantId?: string;
  name: string;
  description?: string;
  keyPrefix: string; // first 8 chars for identification
  scopes: string[];
  createdAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
  revoked: boolean;
  metadata: Record<string, any>;
}
```

**RefreshTokenInfo:** Refresh token tracking for rotation and revocation.

```typescript
interface RefreshTokenInfo {
  tokenId: string;
  userId: string;
  familyId: string; // for rotation tracking
  sessionId: string;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt?: Date;
  rotatedFrom?: string; // previous token ID
  revoked: boolean;
  revokedAt?: Date;
}
```

**AuthContext:** Request context information for security tracking.

```typescript
interface AuthContext {
  ip: string;
  userAgent: string;
  deviceId?: string;
  location?: string;
  timestamp: Date;
}
```

#### 3.10.2 Configuration Types

**AuthPluginConfig:** Main configuration interface for the plugin.

```typescript
interface AuthPluginConfig {
  identityProvider: {
    type: "keycloak" | "custom";
    config: KeycloakConfig | CustomProviderConfig;
  };
  token: TokenConfig;
  session: SessionConfig;
  cache: CacheConfig;
  storage: StorageConfig;
  apiKey: ApiKeyConfig;
  rateLimit: RateLimitConfig;
  permissions: PermissionConfig;
  audit: AuditConfig;
  metrics: MetricsConfig;
  routes: RouteConfig;
  webSocket: WebSocketConfig;
  security: SecurityConfig;
}
```

**KeycloakConfig:** Keycloak identity provider configuration.

```typescript
interface KeycloakConfig {
  serverUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
  timeout?: number;
  sslRequired?: boolean;
  publicKeyCache?: {
    enabled: boolean;
    ttl: number;
  };
}
```

**TokenConfig:** Token generation and validation settings.

```typescript
interface TokenConfig {
  issuer: string;
  audience: string | string[];
  algorithms: string[]; // ['RS256', 'HS256']
  accessTokenTTL: number; // seconds
  refreshTokenTTL: number; // seconds
  clockTolerance: number; // seconds
  cacheEnabled: boolean;
  cacheTTL: number;
  rotation: {
    enabled: boolean;
    reuseInterval: number; // seconds
  };
}
```

**SessionConfig:** Session management configuration.

```typescript
interface SessionConfig {
  storage: "redis" | "database" | "memory";
  ttl: number; // seconds
  slidingExpiration: boolean;
  maxSessions: number;
  cookieSettings: {
    name: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: "strict" | "lax" | "none";
    domain?: string;
    path: string;
  };
}
```

**CacheConfig:** Caching backend configuration.

```typescript
interface CacheConfig {
  backend: "redis" | "memory";
  redisUrl?: string;
  maxSize?: number; // for memory cache
  ttl: number; // default TTL
  evictionPolicy: "lru" | "lfu" | "ttl";
}
```

#### 3.10.3 Response Types

**LoginResponse:** Response structure for successful login.

```typescript
interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  sessionId: string;
  user: {
    userId: string;
    username: string;
    email: string;
    roles: string[];
  };
  requiresMfa?: boolean;
  mfaChallenge?: {
    challengeId: string;
    method: string;
    expiresAt: Date;
  };
}
```

**AuthorizationResult:** Result of permission check with details.

```typescript
interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  requiredPermissions?: Permission[];
  missingPermissions?: Permission[];
}
```

**HealthStatus:** Overall system health status.

```typescript
interface HealthStatus {
  healthy: boolean;
  status: "healthy" | "degraded" | "unhealthy";
  checks: HealthCheck[];
  timestamp: Date;
  uptime: number;
  version: string;
}
```

**HealthCheck:** Individual health check result.

````typescript
interface HealthCheck {
  name: string;
  healthy: boolean;
  responseTime?: number;
  error?: string;
  details?: Record<string, any>;
} ### 3.11 Integration Patterns

The Integration Patterns section demonstrates how to use the authentication library in various scenarios.

#### 3.11.1 REST API Usage

**Basic Authentication:** Standard authentication setup with middleware.

```typescript
import { AuthPlugin } from '@your-org/elysia-auth'

const app = new Elysia()
.use(AuthPlugin.install(app, {
  // configuration
}))

// Public route (no auth)
.get('/public', () => 'Hello World')

// Protected route (auth required)
.get('/protected', ({ user }) => ({
  message: 'Hello ' + user.username
}), {
  beforeHandle: authenticate()
})

// Permission-based route
.get('/admin', () => 'Admin Panel', {
  beforeHandle: [
    authenticate(),
    authorize({ action: 'manage', subject: 'all' })
  ]
})

// Role-based route
.get('/users', () => users, {
  beforeHandle: [
    authenticate(),
    requireRole('admin')
  ]
})
````

**Custom Authentication:** Direct service usage for custom flows.

```typescript
app.post("/custom-auth", async ({ body, auth }) => {
  // Custom authentication logic
  const result = await auth.authenticateWithPassword(
    body.username,
    body.password,
    { ip: "127.0.0.1" }
  );

  return result;
});
```

**Permission Checking:** Fine-grained authorization in route handlers.

```typescript
app.patch("/orders/:id", async ({ params, body, user, authz }) => {
  const order = await getOrder(params.id);

  // Check if user can update order
  const canUpdate = await authz.can(user, "update", order);
  if (!canUpdate) {
    throw new UnauthorizedError("Cannot update this order");
  }

  // Filter fields user can update
  const allowedFields = await authz.getAccessibleFields(user, order);
  const updates = filterFields(body, allowedFields);

  return await updateOrder(params.id, updates);
});
```

#### 3.11.2 WebSocket Usage

**WebSocket Authentication:** Authenticate during WebSocket upgrade.

```typescript
app.ws("/ws", {
  upgrade: async ({ request }) => {
    // Authenticate during upgrade
    const token = request.url.searchParams.get("token");
    const authResult = await wsAuthHandler.authenticateConnection(ws, request);

    if (!authResult.authenticated) {
      throw new Error("Unauthorized");
    }

    return { user: authResult.user };
  },

  open: (ws) => {
    console.log("Client connected:", ws.data.user.userId);
  },

  message: async (ws, message) => {
    // Authorize message
    const msg = JSON.parse(message);
    const authorized = await wsAuthzHandler.authorizeMessage(ws, msg);

    if (!authorized.allowed) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Unauthorized action",
        })
      );
      return;
    }

    // Process message
    await handleMessage(ws, msg);
  },

  close: (ws) => {
    wsAuthHandler.handleWebSocketDisconnect(ws);
  },
});
```

**Channel Subscriptions:** Manage WebSocket channel subscriptions with authorization.

```typescript
ws.message = async (ws, message) => {
  const msg = JSON.parse(message);

  if (msg.type === "subscribe") {
    // Check permission to subscribe
    const canSubscribe = await wsAuthzHandler.authorizeChannelSubscription(
      ws,
      msg.channel
    );

    if (!canSubscribe) {
      ws.send(JSON.stringify({ type: "error", message: "Cannot subscribe" }));
      return;
    }

    await channelManager.subscribeToChannel(ws.data.connectionId, msg.channel);
    ws.send(JSON.stringify({ type: "subscribed", channel: msg.channel }));
  }

  if (msg.type === "publish") {
    // Check permission to publish
    const canPublish = await wsAuthzHandler.authorizeChannelPublish(
      ws,
      msg.channel,
      msg.data
    );

    if (!canPublish.allowed) {
      ws.send(JSON.stringify({ type: "error", message: "Cannot publish" }));
      return;
    }

    await channelManager.publishToChannel(msg.channel, msg.data);
  }
};
```

#### 3.11.3 API Key Authentication

**API Key Generation:** Create API keys with specific scopes.

```typescript
app.post("/apikeys", async ({ user, body }) => {
  const apiKey = await apiKeyManager.generateApiKey(
    user.userId,
    body.scopes || ["read:*"],
    {
      name: body.name,
      description: body.description,
      expiresAt: body.expiresAt,
    }
  );

  return {
    apiKey: apiKey.apiKey, // Only time this is shown
    apiKeyId: apiKey.apiKeyId,
    keyPrefix: apiKey.keyPrefix,
    scopes: apiKey.scopes,
    message: "Save this key securely. It will not be shown again.",
  };
});
```

**API Key Usage:** Authenticate requests using API keys.

```typescript
// Client includes key in header
// X-API-Key: sk_live_a8f3k2m9x7c1v5b4n6p0_3k9m

// Server validates automatically via middleware
app.get(
  "/api/data",
  ({ user }) => {
    // user contains API key owner info
    return getData(user.userId);
  },
  {
    beforeHandle: authenticate({ strategies: ["apikey"] }),
  }
);
```

#### 3.11.4 Multi-Tenant Usage

**Tenant Context:** Automatic tenant resolution and isolation.

```typescript
app.use(
  tenantContext({
    resolver: (request) => {
      // Extract tenant from subdomain
      const hostname = request.headers.get("host");
      return getTenantFromSubdomain(hostname);
    },
  })
);

app.get("/data", ({ user, tenant }) => {
  // Data automatically filtered by tenant
  return getData({ tenantId: tenant.id, userId: user.userId });
});
```

**Tenant Isolation:** All operations automatically scoped to tenant.

````typescript
// All queries automatically scoped to tenant
const session = await sessionManager.createSession(userId, data)
// Session includes tenantId from context

const apiKey = await apiKeyManager.generateApiKey(userId, scopes, metadata)
// API key scoped to tenant

// Authorization checks tenant access
const can = await authz.can(user,

### 3.12 Error Handling

The Error Handling section covers error types and handling patterns for robust error management.

#### 3.12.1 Error Types

**AuthenticationError:** Base class for authentication-related errors.

```typescript
class AuthenticationError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, any>;
}

// Specific authentication errors:
- InvalidCredentialsError(401) - Invalid username/password
- TokenExpiredError(401) - JWT token expired
- InvalidTokenError(401) - Malformed or invalid token
- TokenRevokedException(401) - Token has been revoked
- InvalidApiKeyError(401) - API key invalid or malformed
- ApiKeyRevokedException(401) - API key has been revoked
- MfaRequiredError(401) - Multi-factor authentication required
- AccountLockedError(403) - Account temporarily locked
- AccountDisabledError(403) - Account permanently disabled
````

**AuthorizationError:** Errors related to permission and access control.

```typescript
class AuthorizationError extends Error {
  code: string;
  statusCode: number;
  requiredPermissions?: Permission[];
  reason?: string;
}

// Specific authorization errors:
- InsufficientPermissionsError(403) - User lacks required permissions
- ResourceAccessDeniedError(403) - Access to specific resource denied
- TenantAccessDeniedError(403) - Access to tenant data denied
- RoleRequiredError(403) - Specific role required
```

**ValidationError:** Input validation errors with detailed field information.

```typescript
class ValidationError extends Error {
  code: string;
  statusCode: number;
  errors: ValidationIssue[];
}

interface ValidationIssue {
  field: string;
  message: string;
  code: string;
}
```

**ServiceError:** Errors from external service dependencies.

```typescript
class ServiceError extends Error {
  code: string;
  statusCode: number;
  service: string; // 'keycloak', 'redis', 'database'
  cause?: Error;
}

// Specific service errors:
- ProviderUnavailableError(503) - Identity provider unreachable
- CacheUnavailableError(503) - Cache service unavailable
- StorageUnavailableError(503) - Database unavailable
- CircuitOpenError(503) - Circuit breaker open
```

#### 3.12.2 Error Handling Patterns

**Global Error Handler:** Centralized error handling in Elysia.

```typescript
app.onError(({ code, error, set }) => {
  // Log error
  logger.error("Request error:", {
    code,
    error: error.message,
    stack: error.stack,
  });

  // Handle specific error types
  if (error instanceof AuthenticationError) {
    set.status = error.statusCode;
    return {
      error: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof AuthorizationError) {
    set.status = error.statusCode;
    return {
      error: error.code,
      message: error.message,
      requiredPermissions: error.requiredPermissions,
      reason: error.reason,
    };
  }

  if (error instanceof RateLimitError) {
    set.status = 429;
    set.headers["Retry-After"] = error.retryAfter.toString();
    set.headers["X-RateLimit-Limit"] = error.limit.toString();
    set.headers["X-RateLimit-Remaining"] = "0";
    set.headers["X-RateLimit-Reset"] = error.resetAt.toISOString();
    return {
      error: "rate_limit_exceeded",
      message: error.message,
      retryAfter: error.retryAfter,
    };
  }

  // Default error response
  set.status = 500;
  return {
    error: "internal_server_error",
    message: "An unexpected error occurred",
  };
});
```

**Graceful Degradation:** Handle service failures with fallbacks.

````typescript
// When Keycloak is unavailable
try {
  const user = await identityProvider.getUserInfo(token)
} catch (error) {
  if (error instanceof ProviderUnavailableError) {
    // Fallback to cached token validation
    const cached = await cacheManager.get(`token:${tokenHash}`)
    if (cached) {
      logger.warn('Using cached token validation (provider unavailable)')
      return cached
    }
    // If no cache, enable degraded mode
    degradationManager.enableDegradedMode('token_validation', 'Provider unavailable')
    throw new ServiceError('Authentication service temporarily unavailable')
  }
  throw error
}

### 3.13 Background Jobs & Maintenance

The Background Jobs & Maintenance section covers scheduled tasks and maintenance operations.

#### 3.13.1 Scheduled Jobs

**Session Cleanup Job:** Removes expired sessions periodically.

```typescript
function sessionCleanupJob() {
  schedule: '*/5 * * * *', // Every 5 minutes

  async execute() {
    try {
      const cleaned = await sessionManager.cleanupExpiredSessions()
      logger.info('Session cleanup completed', { cleaned })

      metricsCollector.recordGauge('sessions.expired_cleanup', cleaned)
    } catch (error) {
      logger.error('Session cleanup failed', { error })
    }
  }
}
````

**Token Revocation Cleanup:** Cleans up expired token revocations.

```typescript
function tokenRevocationCleanupJob() {
  schedule: '*/10 * * * *', // Every 10 minutes

  async execute() {
    try {
      const cleaned = await tokenRevocationService.cleanupExpiredRevocations()
      logger.info('Token revocation cleanup completed', { cleaned })

      // Rebuild bloom filter periodically
      if (shouldRebuildBloomFilter()) {
        await tokenRevocationService.rebuildBloomFilter()
        logger.info('Bloom filter rebuilt')
      }
    } catch (error) {
      logger.error('Token revocation cleanup failed', { error })
    }
  }
}
```

**Refresh Token Cleanup:** Removes expired refresh tokens.

```typescript
function refreshTokenCleanupJob() {
  schedule: '0 * * * *', // Every hour

  async execute() {
    try {
      const cleaned = await refreshTokenManager.cleanupExpiredTokens()
      logger.info('Refresh token cleanup completed', { cleaned })
    } catch (error) {
      logger.error('Refresh token cleanup failed', { error })
    }
  }
}
```

**API Key Cleanup:** Removes expired API keys.

```typescript
function apiKeyCleanupJob() {
  schedule: '0 * * * *', // Every hour

  async execute() {
    try {
      const cleaned = await apiKeyManager.cleanupExpiredApiKeys()
      logger.info('API key cleanup completed', { cleaned })
    } catch (error) {
      logger.error('API key cleanup failed', { error })
    }
  }
}
```

**Audit Log Archival:** Archives old audit logs to long-term storage.

```typescript
function auditLogArchivalJob() {
  schedule: '0 2 * * *', // Daily at 2 AM

  async execute() {
    try {
      const retentionDays = config.audit.retentionDays
      const archived = await auditLogger.archiveOldLogs(retentionDays)
      logger.info('Audit log archival completed', { archived, retentionDays })
    } catch (error) {
      logger.error('Audit log archival failed', { error })
    }
  }
}
```

**Public Key Refresh:** Refreshes identity provider public keys.

```typescript
function publicKeyRefreshJob() {
  schedule: '*/30 * * * *', // Every 30 minutes

  async execute() {
    try {
      await tokenManager.refreshPublicKeys()
      logger.info('Public keys refreshed')
    } catch (error) {
      logger.error('Public key refresh failed', { error })
    }
  }
}
```

**Metrics Aggregation:** Aggregates and pushes metrics to monitoring systems.

```typescript
function metricsAggregationJob() {
  schedule: '* * * * *', // Every minute

  async execute() {
    try {
      const metrics = await metricsCollector.getMetrics()

      // Push to monitoring system
      await pushMetricsToMonitoring(metrics)

      // Calculate derived metrics
      const stats = {
        authSuccessRate: calculateSuccessRate(metrics),
        avgTokenValidationTime: calculateAverage(metrics.tokenValidation),
        cacheHitRate: calculateCacheHitRate(metrics)
      }

      logger.debug('Metrics aggregated', stats)
    } catch (error) {
      logger.error('Metrics aggregation failed', { error })
    }
  }
}
```

**WebSocket Connection Cleanup:** Removes stale WebSocket connections.

```typescript
function wsConnectionCleanupJob() {
  schedule: '*/5 * * * *', // Every 5 minutes

  async execute() {
    try {
      // Cleanup stale connections (not responding to ping)
      const timeout = 300 // 5 minutes
      const cleaned = await wsConnectionRegistry.cleanupStaleConnections(timeout)

      logger.info('WebSocket cleanup completed', { cleaned })
    } catch (error) {
      logger.error('WebSocket cleanup failed', { error })
    }
  }
}
```

#### 3.13.2 Job Management

**JobScheduler:** Manages and executes scheduled background jobs.

```typescript
class JobScheduler {
  private jobs: Map<string, ScheduledJob>;
  private running: boolean;

  registerJob(name: string, job: ScheduledJob): void {
    this.jobs.set(name, job);
    logger.info("Job registered", { name, schedule: job.schedule });
  }

  async start(): Promise<void> {
    this.running = true;

    for (const [name, job] of this.jobs) {
      // Parse cron schedule and start job
      const cronJob = new CronJob(job.schedule, async () => {
        if (!this.running) return;

        logger.debug("Job starting", { name });
        const startTime = Date.now();

        try {
          await job.execute();
          const duration = Date.now() - startTime;
          logger.debug("Job completed", { name, duration });
          metricsCollector.recordHistogram("job.duration", duration, {
            job: name,
          });
        } catch (error) {
          logger.error("Job failed", { name, error });
          metricsCollector.incrementCounter("job.failures", { job: name });
        }
      });

      cronJob.start();
    }

    logger.info("Job scheduler started", { jobCount: this.jobs.size });
  }

  async stop(): Promise<void> {
    this.running = false;
    logger.info("Job scheduler stopped");
  }

  async runJobNow(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Job not found: ${name}`);

    logger.info("Manually running job", { name });
    await job.execute();
  }

  getJobStatus(): JobStatus[] {
    return Array.from(this.jobs.entries()).map(([name, job]) => ({
      name,
      schedule: job.schedule,
      lastRun: job.lastRun,
      nextRun: job.nextRun,
      enabled: job.enabled,
    }));
  }
}
```

### 3.14 Monitoring & Observability

The Monitoring & Observability section covers metrics collection, logging, and alerting for system health.

#### 3.14.1 Metrics

**Authentication Metrics:**

- `auth.attempts.total` - Total authentication attempts (counter)
- `auth.attempts.success` - Successful authentications (counter)
- `auth.attempts.failure` - Failed authentications (counter)
- `auth.duration` - Authentication duration (histogram)
- `auth.method` - Authentication method used (labeled: password, token, apikey)

**Token Metrics:**

- `token.validations.total` - Total token validations (counter)
- `token.validations.cache_hit` - Cache hits (counter)
- `token.validations.cache_miss` - Cache misses (counter)
- `token.validations.duration` - Validation duration (histogram)
- `token.refreshes.total` - Token refresh attempts (counter)
- `token.refreshes.success` - Successful refreshes (counter)
- `token.revocations.total` - Token revocations (counter)

**Authorization Metrics:**

- `authz.checks.total` - Total permission checks (counter)
- `authz.checks.allowed` - Allowed checks (counter)
- `authz.checks.denied` - Denied checks (counter)
- `authz.duration` - Authorization check duration (histogram)

**Session Metrics:**

- `sessions.active` - Active sessions (gauge)
- `sessions.created` - Sessions created (counter)
- `sessions.destroyed` - Sessions destroyed (counter)
- `sessions.duration` - Session lifetime (histogram)

**API Key Metrics:**

- `apikeys.active` - Active API keys (gauge)
- `apikeys.requests.total` - Requests using API keys (counter)
- `apikeys.validations.duration` - API key validation duration (histogram)

**Rate Limit Metrics:**

- `ratelimit.exceeded.total` - Rate limit violations (counter)
- `ratelimit.requests` - Requests tracked (counter)

**System Metrics:**

- `cache.size` - Cache size (gauge)
- `cache.hit_rate` - Cache hit rate percentage (gauge)
- `database.connections` - Active database connections (gauge)
- `websocket.connections` - Active WebSocket connections (gauge)

#### 3.14.2 Logging

**Key Log Events:**

**Authentication Events:**

- User login attempt (username, ip, method)
- Successful login (userId, sessionId, duration)
- Failed login (username, reason, ip)
- Account lockout (userId, reason, failedAttempts)
- Logout (userId, sessionId)

**Authorization Events:**

- Permission denied (userId, action, resource, reason)
- Role check failed (userId, requiredRole)

**Token Events:**

- Token generated (userId, tokenId, type)
- Token refreshed (userId, tokenId)
- Token revoked (userId, tokenId, reason)
- Token reuse detected (userId, tokenId, familyId)

**Security Events:**

- Suspicious activity detected (type, userId, details)
- Brute force attempt (ip, username)
- Rate limit exceeded (identifier, endpoint)
- Circuit breaker opened (service, reason)

**System Events:**

- Service started (version, config)
- Service shutdown (reason)
- Health check failed (component, error)
- Job completed (jobName, duration, result)

#### 3.14.3 Alerting

**Critical Alerts:**

- Identity provider unavailable > 5 minutes
- Database connection failure
- Circuit breaker open > 10 minutes
- Error rate > 10% for 5 minutes
- No successful authentications for 10 minutes

**Warning Alerts:**

- Authentication failure rate > 20%
- Token validation cache hit rate < 50%
- Active sessions > 90% of limit
- Rate limit exceeded > 100 times/minute
- Job failure

**Info Alerts:**

- New service deployment
- Configuration change
- Scheduled maintenance

**Alert Channels:**

- PagerDuty for critical alerts
- Slack for warnings
- Email for info
- Webhook for custom integrations

### 3.15 Security Considerations

The Security Considerations section covers security best practices and OWASP Top 10 mitigations.

#### 3.15.1 Token Security

**Best Practices:**

- Use short-lived access tokens (15 minutes)
- Long-lived refresh tokens (30 days max)
- Implement refresh token rotation
- Detect and prevent token reuse
- Store tokens securely (httpOnly cookies for web)
- Use token binding where possible
- Always use HTTPS in production
- Implement proper CORS policies

**Token Storage:**

- Access tokens: memory only (SPA), httpOnly cookie (server-rendered)
- Refresh tokens: httpOnly, secure, SameSite=strict cookie
- Never store tokens in localStorage (XSS vulnerability)

#### 3.15.2 Session Security

**Best Practices:**

- Regenerate session ID after login
- Use secure, httpOnly, SameSite cookies
- Implement absolute and idle timeouts
- Limit concurrent sessions per user
- Track session metadata (IP, user agent)
- Detect session hijacking attempts
- Support remote session termination

#### 3.15.3 API Key Security

**Best Practices:**

- Use cryptographically secure random generation
- Hash keys with Argon2 or bcrypt
- Include checksum in key format
- Show key only once on generation
- Support key rotation
- Implement key-specific rate limits
- Scope keys to minimum required permissions
- Allow key revocation
- Track key usage

#### 3.15.4 Password Security

**Best Practices:**

- Enforce strong password policies
- Use bcrypt, Argon2, or scrypt for hashing
- Implement password history
- Support password expiration
- Detect common/breached passwords
- Implement account lockout after failed attempts
- Use CAPTCHA after multiple failures
- Support password reset with secure tokens

#### 3.15.5 OWASP Top 10 Mitigations

**Broken Access Control:**

- Always verify authorization before actions
- Use CASL for fine-grained permissions
- Implement tenant isolation
- Validate ownership for resources

**Cryptographic Failures:**

- Use TLS 1.2+ for all connections
- Proper key management
- Secure token storage
- Strong hashing algorithms

**Injection:**

- Parameterized queries
- Input validation
- Output encoding
- Use ORM/query builders

**Insecure Design:**

- Threat modeling
- Security by design
- Principle of least privilege
- Defense in depth

**Security Misconfiguration:**

- Secure defaults
- Minimal surface area
- Regular updates
- Proper error handling (don't leak info)

**Vulnerable Components:**

- Regular dependency updates
- Security scanning
- Monitor advisories
- Use lock files

**Identification & Authentication Failures:**

- Multi-factor authentication support
- Session management
- Credential stuffing protection
- Brute force protection

**Software & Data Integrity:**

- Verify token signatures
- Use HTTPS everywhere
- Implement CORS properly
- CSP headers

**Security Logging & Monitoring:**

- Comprehensive audit logging
- Real-time monitoring
- Alerting on suspicious activity
- Incident response procedures

**Server-Side Request Forgery:**

- Validate all external URLs
- Whitelist allowed domains
- Network segmentation
- Input validation

```

```
