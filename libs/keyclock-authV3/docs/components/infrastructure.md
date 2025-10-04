# Infrastructure Layer

The Infrastructure Layer provides foundational services and abstractions for the authentication system, including identity provider integration, caching, event messaging, storage operations, and circuit breaker patterns.

## 3.1.1 IdentityProviderInterface

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

## 3.1.2 KeycloakIdentityProvider

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

## 3.1.3 CacheManager (libs/database)

**Purpose:** Unified caching layer supporting multiple backends with automatic failover.

**Responsibilities:**

- Abstract cache operations from backend
- Provide consistent caching interface
- Handle cache invalidation
- Support distributed caching
- Implement cache strategies (write-through, write-behind)

**Interface:** libs/database/src/cache/interfaces/ICache.ts
**Service:** libs/database/src/cache/cache.service.ts

## 3.1.4 EventBus (Skip for now )

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
