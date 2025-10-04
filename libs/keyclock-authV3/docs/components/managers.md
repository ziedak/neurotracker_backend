# Manager Layer

The Manager Layer orchestrates business logic and coordinates between services. Managers handle complex workflows, validation, and state management.

## 3.2.1 TokenManager

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

## 3.2.2 RefreshTokenManager

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

## 3.2.3 TokenRevocationService

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

## 3.2.4 ApiKeyManager

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

## 3.2.5 SessionManager

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

## 3.2.6 CaslAbilityBuilder

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

## 3.2.7 PermissionChecker

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
