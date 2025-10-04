# Service Layer

The Service Layer provides high-level business logic APIs that coordinate between managers and handle complex workflows. Services encapsulate use cases and provide clean interfaces for the application layer.

## 3.3.1 AuthenticationService

**Purpose:** Orchestrate complete authentication workflows including login, logout, token refresh, and user session management.

**Responsibilities:**

- Coordinate multi-step authentication flows
- Handle different authentication methods (password, token, API key)
- Manage user sessions and state
- Coordinate with identity providers
- Handle authentication failures and recovery
- Provide unified authentication interface

**Key Workflows:**

1. **Login Flow:** Validate credentials → Create session → Generate tokens → Return auth response
2. **Token Refresh:** Validate refresh token → Generate new tokens → Update session → Return response
3. **Logout Flow:** Revoke tokens → Destroy session → Clear caches → Return success

**Functions:**

```typescript
authenticateUser(credentials: LoginCredentials, options?: AuthOptions): Promise<AuthResult>
```

Complete user authentication workflow

- Validate credentials with identity provider
- Create user session
- Generate access and refresh tokens
- Setup session data and metadata
- **Parameters:** `{ username, password, rememberMe?, deviceInfo?, ip?, userAgent? }`
- **Returns:** `{ success: boolean, tokens?: TokenPair, user?: User, sessionId?: string, error?: AuthError }`
- **Throws:** InvalidCredentialsError, AccountLockedError, MFARequiredError
- Handles password validation, account status checks, MFA challenges

```typescript
refreshAuthentication(refreshToken: string, options?: RefreshOptions): Promise<AuthResult>
```

Refresh access token using refresh token

- Validate refresh token
- Check token rotation requirements
- Generate new token pair
- Update session metadata
- **Parameters:** refresh token string, options (deviceInfo, ip)
- **Returns:** `{ success: boolean, tokens?: TokenPair, error?: AuthError }`
- **Throws:** InvalidRefreshTokenError, TokenExpiredError
- Implements refresh token rotation for security

```typescript
logoutUser(sessionId: string, options?: LogoutOptions): Promise<LogoutResult>
```

Complete user logout process

- Revoke all user tokens
- Destroy user sessions
- Clear cached permissions
- Publish logout event
- **Parameters:** session ID, options (revokeAllDevices, clearCache)
- **Returns:** `{ success: boolean, revokedTokens: number, destroyedSessions: number }`
- **Throws:** SessionNotFoundError
- Supports single device vs all devices logout

```typescript
validateApiKeyAuthentication(apiKey: string, options?: ApiKeyOptions): Promise<ApiKeyAuthResult>
```

Authenticate using API key

- Validate API key format and checksum
- Check key permissions and expiration
- Track usage metrics
- **Parameters:** API key string, options (endpoint, ip, userAgent)
- **Returns:** `{ valid: boolean, userId?: string, permissions?: string[], metadata?: ApiKeyMetadata }`
- **Throws:** InvalidApiKeyError, ApiKeyExpiredError, InsufficientPermissionsError
- Updates last used timestamp and usage counters

```typescript
authenticateWebSocketConnection(connectionId: string, token: string, options?: WSOptions): Promise<WSAuthResult>
```

Authenticate WebSocket connection

- Validate JWT token
- Extract user context
- Setup connection permissions
- **Parameters:** connection ID, JWT token, options (subprotocol, origin)
- **Returns:** `{ authenticated: boolean, user?: User, permissions?: string[], connectionId: string }`
- **Throws:** InvalidTokenError, ConnectionRejectedError
- Maintains connection-to-user mapping

```typescript
handleMultiFactorChallenge(userId: string, method: MFAMethod, options?: MFAOptions): Promise<MFAChallenge>
```

Initiate MFA challenge

- Generate challenge code/token
- Send via configured method (SMS, email, app)
- Store challenge state
- **Parameters:** userId, method ('sms', 'email', 'totp', 'push'), options (phoneNumber, email)
- **Returns:** `{ challengeId: string, method: string, expiresAt: Date }`
- **Throws:** MFANotConfiguredError, MFAMethodUnavailableError

```typescript
verifyMultiFactorChallenge(challengeId: string, code: string): Promise<MFAVerification>
```

Verify MFA challenge response

- Validate challenge code
- Check expiration
- Mark challenge as used
- **Parameters:** challenge ID, verification code
- **Returns:** `{ verified: boolean, userId?: string, error?: string }`
- **Throws:** ChallengeExpiredError, InvalidChallengeError
- One-time use challenges

```typescript
getUserAuthenticationStatus(userId: string): Promise<AuthStatus>
```

Get comprehensive authentication status for user

- Active sessions, tokens, API keys
- Recent authentication events
- Security status (compromised accounts, etc.)
- **Parameters:** userId
- **Returns:** `{ activeSessions: number, activeTokens: number, lastLogin: Date, mfaEnabled: boolean, securityStatus: SecurityStatus }`

```typescript
revokeUserAuthentication(userId: string, reason?: string): Promise<RevocationResult>
```

Revoke all authentication for user

- Revoke all tokens and API keys
- Destroy all sessions
- Clear all caches
- **Parameters:** userId, optional reason
- **Returns:** `{ revokedTokens: number, destroyedSessions: number, revokedApiKeys: number }`
- Use case: account compromise, password change, admin action

```typescript
handleAuthenticationFailure(username: string, reason: FailureReason, metadata?: FailureMetadata): Promise<void>
```

Handle and log authentication failures

- Track failure attempts
- Implement progressive delays
- Lock accounts after threshold
- **Parameters:** username, reason ('invalid_password', 'account_locked', 'mfa_failed'), metadata (ip, userAgent)
- Updates failure counters and timestamps
- May trigger account lockout or security alerts

```typescript
recoverAuthentication(recoveryToken: string, newCredentials: NewCredentials): Promise<RecoveryResult>
```

Handle password recovery/authentication reset

- Validate recovery token
- Update user credentials
- Revoke old authentication
- **Parameters:** recovery token, new password/MFA settings
- **Returns:** `{ success: boolean, userId?: string, error?: string }`
- **Throws:** InvalidRecoveryTokenError, WeakPasswordError

```typescript
setupUserAuthentication(userId: string, setupData: AuthSetupData): Promise<AuthSetupResult>
```

Initial authentication setup for new users

- Configure MFA if required
- Set initial password policies
- Generate welcome tokens
- **Parameters:** userId, setup data (password, mfaMethod, preferences)
- **Returns:** `{ success: boolean, mfaRequired?: boolean, setupComplete: boolean }`

## 3.3.2 AuthorizationService

**Purpose:** Manage authorization decisions, permission evaluation, and access control enforcement.

**Responsibilities:**

- Evaluate user permissions for actions
- Build and cache authorization contexts
- Handle role-based and attribute-based access control
- Provide permission query APIs
- Enforce business rules and policies
- Generate authorization audit logs

**Key Workflows:**

1. **Permission Check:** Build user context → Evaluate permissions → Cache result → Return decision
2. **Resource Access:** Check resource ownership → Apply ABAC rules → Filter results → Audit access
3. **Policy Evaluation:** Load relevant policies → Evaluate conditions → Combine results → Make decision

**Functions:**

```typescript
authorizeAction(user: AuthUser, action: string, resource: any, context?: AuthContext): Promise<AuthorizationResult>
```

Authorize user action on resource

- Build user ability context
- Evaluate permissions and conditions
- Check resource ownership/attributes
- **Parameters:** user, action ('read', 'write', 'delete'), resource instance, context (additional attributes)
- **Returns:** `{ authorized: boolean, reason?: string, requiredPermissions?: string[], grantedPermissions?: string[] }`
- **Throws:** AuthorizationError
- Caches results for performance

```typescript
checkResourceAccess(user: AuthUser, action: string, resourceType: string, resourceIds: string[]): Promise<ResourceAccessResult>
```

Check access to multiple resources

- Batch permission evaluation
- Filter accessible resources
- **Parameters:** user, action, resource type, array of resource IDs
- **Returns:** `{ accessible: string[], denied: string[], reasons: Record<string, string> }`
- More efficient than individual checks

```typescript
buildUserPermissions(user: AuthUser, options?: PermissionOptions): Promise<UserPermissions>
```

Build complete permission set for user

- Combine role and custom permissions
- Apply permission inheritance
- Include conditional permissions
- **Parameters:** user, options (includeConditions, expandRoles)
- **Returns:** `{ roles: string[], permissions: Permission[], ability: Ability, conditions: Condition[] }`
- Cached with user-specific TTL

```typescript
evaluatePolicy(user: AuthUser, policy: Policy, context: PolicyContext): Promise<PolicyResult>
```

Evaluate authorization policy

- Check policy conditions
- Apply policy rules
- Combine with user permissions
- **Parameters:** user, policy object, evaluation context
- **Returns:** `{ satisfied: boolean, conditions: ConditionResult[], decision: PolicyDecision }`

```typescript
filterQueryByPermissions(user: AuthUser, query: BaseQuery, resourceType: string): Promise<FilteredQuery>
```

Apply permission filters to database queries

- Convert permissions to query constraints
- Add ownership and attribute filters
- **Parameters:** user, base query, resource type
- **Returns:** query with permission filters applied
- Example: Add `WHERE userId = ?` for user-owned resources

```typescript
getUserRolesAndPermissions(userId: string): Promise<UserAuthProfile>
```

Get user's complete authorization profile

- Roles from identity provider
- Custom permissions
- Permission grants and denials
- **Parameters:** userId
- **Returns:** `{ roles: string[], permissions: Permission[], restrictions: Restriction[], effectivePermissions: Permission[] }`

```typescript
grantPermission(userId: string, permission: Permission, options?: GrantOptions): Promise<void>
```

Grant additional permission to user

- Add to user's permission set
- Update permission cache
- Audit permission grant
- **Parameters:** userId, permission object, options (temporary, expiresAt, grantedBy)
- **Throws:** PermissionAlreadyGrantedError, InvalidPermissionError

```typescript
revokePermission(userId: string, permission: Permission, reason?: string): Promise<void>
```

Revoke user permission

- Remove from user's permission set
- Update caches and sessions
- Audit permission revocation
- **Parameters:** userId, permission, optional reason
- **Throws:** PermissionNotFoundError

```typescript
createPermissionRule(rule: PermissionRule): Promise<string>
```

Create new permission rule

- Validate rule structure
- Store in permission registry
- Update affected user caches
- **Parameters:** rule definition
- **Returns:** rule ID
- **Throws:** InvalidRuleError, DuplicateRuleError

```typescript
evaluateAttributeBasedAccess(user: AuthUser, resource: any, action: string, attributes: ResourceAttributes): Promise<ABACResult>
```

Evaluate attribute-based access control

- Check resource attributes against policies
- Apply environmental conditions
- **Parameters:** user, resource, action, resource attributes
- **Returns:** `{ access: boolean, matchedPolicies: string[], failedConditions: string[] }`

```typescript
getPermissionAuditTrail(userId: string, options?: AuditOptions): Promise<PermissionAudit[]>
```

Get permission change history

- Permission grants and revocations
- Role changes
- Policy evaluations
- **Parameters:** userId, options (dateRange, actions, limit)
- **Returns:** array of audit entries
- Used for compliance and debugging

```typescript
validatePermissionStructure(permission: Permission): boolean
```

Validate permission object structure

- Check required fields
- Validate action and subject formats
- **Parameters:** permission object
- **Returns:** boolean
- **Throws:** InvalidPermissionError with details

```typescript
getResourcePermissions(resourceType: string, action?: string): Promise<ResourcePermissions>
```

Get all permissions for resource type

- List available actions
- Get required permissions per action
- **Parameters:** resource type, optional specific action
- **Returns:** `{ actions: string[], permissions: Record<string, Permission[]> }`

```typescript
checkBulkAuthorization(user: AuthUser, requests: AuthorizationRequest[]): Promise<BulkAuthResult>
```

Authorize multiple actions at once

- Batch processing for performance
- **Parameters:** user, array of {action, resource, context}
- **Returns:** `{ results: AuthorizationResult[], summary: { total: number, authorized: number, denied: number } }`

## 3.3.3 TokenService

**Purpose:** Provide high-level token management operations including generation, validation, and lifecycle management.

**Responsibilities:**

- Coordinate token generation workflows
- Handle token validation and parsing
- Manage token storage and retrieval
- Coordinate token revocation
- Provide token introspection APIs
- Handle token rotation and renewal

**Key Workflows:**

1. **Token Generation:** Validate request → Generate token pair → Store refresh token → Return tokens
2. **Token Validation:** Parse token → Verify signature → Check revocation → Return claims
3. **Token Refresh:** Validate refresh → Generate new pair → Update storage → Return tokens

**Functions:**

```typescript
generateTokenPair(user: AuthUser, options?: TokenOptions): Promise<TokenPair>
```

Generate access and refresh token pair

- Create JWT access token
- Generate secure refresh token
- Store refresh token metadata
- **Parameters:** user object, options (ttl, scopes, audience, includeRefresh)
- **Returns:** `{ accessToken: string, refreshToken?: string, expiresIn: number, tokenType: 'Bearer' }`
- **Throws:** TokenGenerationError
- Access token TTL: 15 minutes default, refresh: 7 days

```typescript
validateAccessToken(token: string, options?: ValidationOptions): Promise<TokenValidation>
```

Validate JWT access token

- Verify signature and claims
- Check token revocation
- Extract user information
- **Parameters:** token string, options (skipExpiry, requiredScopes, audience)
- **Returns:** `{ valid: boolean, user?: AuthUser, claims?: TokenClaims, error?: string }`
- **Throws:** InvalidTokenError, TokenExpiredError, TokenRevokedError

```typescript
refreshTokenPair(refreshToken: string, options?: RefreshOptions): Promise<TokenPair>
```

Refresh access token using refresh token

- Validate refresh token
- Generate new access token
- Optionally rotate refresh token
- **Parameters:** refresh token, options (rotateRefresh, newScopes)
- **Returns:** new token pair
- **Throws:** InvalidRefreshTokenError, TokenExpiredError

```typescript
revokeToken(token: string, tokenType: TokenType, reason?: string): Promise<void>
```

Revoke specific token

- Add to revocation list
- Update caches
- **Parameters:** token string, type ('access'|'refresh'), optional reason
- **Throws:** TokenNotFoundError
- For refresh tokens, revokes entire family

```typescript
revokeAllUserTokens(userId: string, reason?: string): Promise<TokenRevocationSummary>
```

Revoke all tokens for user

- Revoke access and refresh tokens
- Clear validation caches
- **Parameters:** userId, optional reason
- **Returns:** `{ accessTokensRevoked: number, refreshTokensRevoked: number, sessionsDestroyed: number }`

```typescript
introspectToken(token: string, tokenType: TokenType): Promise<TokenIntrospection>
```

Get token metadata and status

- Parse token without full validation
- Check revocation status
- **Parameters:** token string, token type
- **Returns:** `{ active: boolean, clientId?: string, username?: string, scope?: string, tokenType: string, exp?: number, iat?: number, jti?: string }`
- RFC 7662 compliant introspection

```typescript
getTokenMetadata(token: string): Promise<TokenMetadata>
```

Extract token metadata

- Parse without verification
- Get claims and metadata
- **Parameters:** token string
- **Returns:** `{ userId: string, expiresAt: Date, issuedAt: Date, scopes: string[], jti: string, clientId?: string }`

```typescript
listUserTokens(userId: string, options?: TokenListOptions): Promise<UserTokenInfo[]>
```

List all active tokens for user

- Access and refresh tokens
- Include metadata and creation info
- **Parameters:** userId, options (includeExpired, tokenType, limit)
- **Returns:** array of token info objects
- Used for token management UI

```typescript
rotateRefreshToken(oldToken: string, userId: string): Promise<TokenPair>
```

Rotate refresh token for security

- Generate new refresh token
- Invalidate old token
- Maintain token family
- **Parameters:** old refresh token, userId
- **Returns:** new token pair with rotated refresh token

```typescript
validateTokenScopes(token: string, requiredScopes: string[]): Promise<ScopeValidation>
```

Validate token has required scopes

- Extract token scopes
- Check against requirements
- **Parameters:** token string, required scopes array
- **Returns:** `{ valid: boolean, missingScopes?: string[], tokenScopes?: string[] }`

```typescript
extendTokenLifetime(token: string, extension: number): Promise<string>
```

Extend token expiration

- Generate new token with extended expiry
- Maintain same claims
- **Parameters:** token string, extension in seconds
- **Returns:** new token string
- **Throws:** TokenExpiredError, InvalidTokenError

```typescript
getTokenFamilyInfo(familyId: string): Promise<TokenFamily>
```

Get information about token family

- All tokens in rotation chain
- Creation and revocation dates
- **Parameters:** family ID
- **Returns:** `{ familyId: string, tokens: TokenInfo[], createdAt: Date, lastRotated?: Date }`

```typescript
cleanupExpiredTokens(): Promise<number>
```

Remove expired tokens from storage

- Clean up refresh token storage
- Remove expired revocation entries
- **Returns:** number of tokens cleaned up
- Should be run periodically

```typescript
generateClientCredentialsToken(clientId: string, clientSecret: string, scopes?: string[]): Promise<ClientToken>
```

Generate token for client credentials flow

- Validate client credentials
- Generate access token
- **Parameters:** client ID, client secret, optional scopes
- **Returns:** `{ accessToken: string, expiresIn: number, scope?: string }`
- **Throws:** InvalidClientError, InvalidScopeError

```typescript
validateTokenSignature(token: string): Promise<boolean>
```

Validate only token signature

- Check cryptographic signature
- Don't validate claims or revocation
- **Parameters:** token string
- **Returns:** boolean
- Fast signature verification
