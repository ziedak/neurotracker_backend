# Handler Layer

The Handler Layer provides HTTP request handlers that implement authentication and authorization endpoints. Handlers process API requests, validate inputs, call service methods, and format responses.

## 3.5.1 LoginHandler

**Purpose:** Handle user login requests and coordinate the complete authentication workflow.

**Responsibilities:**

- Validate login request data
- Coordinate authentication service
- Handle different login methods
- Manage MFA challenges
- Return appropriate authentication responses
- Handle login failures and security events

**Supported Login Methods:**

1. **Password Login:** Username/password authentication
2. **Token Login:** Direct token authentication
3. **MFA Login:** Multi-factor authentication flow
4. **Social Login:** OAuth-based authentication
5. **API Key Login:** API key authentication

**Functions:**

```typescript
handleLogin(context: ElysiaContext): Promise<Response>
```

Main login endpoint handler

- Validate request body
- Authenticate user credentials
- Generate and return tokens
- **Parameters:** Elysia context with login data
- **Returns:** HTTP response with auth tokens or error
- **Request Body:** `{ username: string, password: string, rememberMe?: boolean, deviceInfo?: object }`

```typescript
handlePasswordLogin(credentials: LoginCredentials, context: ElysiaContext): Promise<LoginResponse>
```

Handle password-based authentication

- Validate username and password
- Check account status
- Create session and tokens
- **Parameters:** credentials object, Elysia context
- **Returns:** `{ success: boolean, tokens?: TokenPair, user?: User, requiresMFA?: boolean, mfaToken?: string }`

```typescript
handleMFALogin(mfaData: MFAData, context: ElysiaContext): Promise<LoginResponse>
```

Handle MFA verification during login

- Verify MFA token/code
- Complete authentication
- Return final tokens
- **Parameters:** `{ mfaToken: string, code: string, method: string }`, Elysia context
- **Returns:** complete login response with tokens

```typescript
handleTokenLogin(token: string, context: ElysiaContext): Promise<LoginResponse>
```

Handle direct token authentication

- Validate provided token
- Extract user information
- Create session if needed
- **Parameters:** JWT token, Elysia context
- **Returns:** login response with user data

```typescript
handleSocialLogin(providerData: SocialLoginData, context: ElysiaContext): Promise<LoginResponse>
```

Handle OAuth social login

- Validate OAuth token/callback
- Create or link user account
- Generate authentication tokens
- **Parameters:** `{ provider: string, code: string, state: string }`, Elysia context
- **Returns:** login response

```typescript
validateLoginRequest(body: any): LoginValidation
```

Validate login request structure

- Check required fields
- Validate field formats
- Sanitize inputs
- **Parameters:** request body
- **Returns:** `{ valid: boolean, errors?: ValidationError[], sanitizedData?: LoginCredentials }`

```typescript
createLoginResponse(result: AuthResult): Response
```

Format login response

- Set appropriate HTTP status
- Include tokens or error details
- Add security headers
- **Parameters:** authentication result
- **Returns:** Elysia Response object

```typescript
handleLoginFailure(error: AuthError, context: ElysiaContext): Response
```

Handle login failures

- Log security events
- Return appropriate error responses
- Implement progressive delays
- **Parameters:** authentication error, Elysia context
- **Returns:** error response

```typescript
logLoginAttempt(attempt: LoginAttempt, context: ElysiaContext): void
```

Log login attempts for security monitoring

- Successful and failed attempts
- Include metadata and context
- **Parameters:** attempt details, Elysia context

```typescript
getLoginMetrics(): Promise<LoginMetrics>
```

Get login statistics

- Success rates, failure rates
- Popular login methods
- **Returns:** metrics object

## 3.5.2 LogoutHandler

**Purpose:** Handle user logout requests and coordinate session/token cleanup.

**Responsibilities:**

- Process logout requests
- Revoke tokens and sessions
- Handle single vs multi-device logout
- Clear client-side state
- Log logout events
- Handle logout failures gracefully

**Logout Options:**

1. **Single Device:** Logout current session only
2. **All Devices:** Logout from all user sessions
3. **Token Revocation:** Revoke specific tokens
4. **Complete Cleanup:** Full authentication cleanup

**Functions:**

```typescript
handleLogout(context: ElysiaContext): Promise<Response>
```

Main logout endpoint handler

- Extract logout options
- Coordinate logout process
- Return success response
- **Parameters:** Elysia context
- **Request Body:** `{ revokeAll?: boolean, redirectUri?: string }`

```typescript
handleSingleDeviceLogout(sessionId: string, context: ElysiaContext): Promise<LogoutResult>
```

Logout from current device/session

- Destroy specific session
- Revoke associated tokens
- Clear session cookies
- **Parameters:** session ID, Elysia context
- **Returns:** `{ success: boolean, revokedTokens: number }`

```typescript
handleAllDevicesLogout(userId: string, context: ElysiaContext): Promise<LogoutResult>
```

Logout from all user devices

- Destroy all user sessions
- Revoke all user tokens
- Clear all session data
- **Parameters:** user ID, Elysia context
- **Returns:** `{ success: boolean, revokedTokens: number, destroyedSessions: number }`

```typescript
revokeTokensOnLogout(tokens: string[], reason?: string): Promise<number>
```

Revoke specific tokens during logout

- Add tokens to revocation list
- Update caches
- **Parameters:** array of token strings, optional reason
- **Returns:** number of tokens revoked

```typescript
clearSessionCookies(context: ElysiaContext): void
```

Clear authentication cookies

- Remove session cookies
- Set expired cookies
- **Parameters:** Elysia context

```typescript
handleLogoutRedirect(redirectUri: string, context: ElysiaContext): Response
```

Handle post-logout redirects

- Validate redirect URI
- Redirect to specified location
- **Parameters:** redirect URI, Elysia context
- **Returns:** redirect response

```typescript
validateLogoutRequest(body: any): LogoutValidation
```

Validate logout request

- Check logout options
- Validate redirect URIs
- **Parameters:** request body
- **Returns:** `{ valid: boolean, errors?: ValidationError[] }`

```typescript
createLogoutResponse(result: LogoutResult): Response
```

Format logout response

- Set success status
- Include logout details
- **Parameters:** logout result
- **Returns:** Elysia Response object

```typescript
logLogoutEvent(event: LogoutEvent, context: ElysiaContext): void
```

Log logout events

- Logout type and details
- Security monitoring
- **Parameters:** logout event, Elysia context

## 3.5.3 TokenRefreshHandler

**Purpose:** Handle token refresh requests to maintain user authentication sessions.

**Responsibilities:**

- Validate refresh tokens
- Generate new token pairs
- Handle token rotation
- Maintain session continuity
- Handle refresh failures
- Implement security measures

**Refresh Strategies:**

1. **Simple Refresh:** New access token, same refresh token
2. **Token Rotation:** New access token, new refresh token
3. **Session Extension:** Extend session lifetime
4. **Conditional Refresh:** Based on token age/usage

**Functions:**

```typescript
handleTokenRefresh(context: ElysiaContext): Promise<Response>
```

Main token refresh endpoint

- Extract refresh token
- Generate new token pair
- Return refreshed tokens
- **Parameters:** Elysia context
- **Request Body:** `{ refreshToken: string, scope?: string[] }`

```typescript
validateRefreshToken(token: string, context: ElysiaContext): Promise<RefreshValidation>
```

Validate refresh token

- Check token format and signature
- Verify not revoked
- Check expiration
- **Parameters:** refresh token, Elysia context
- **Returns:** `{ valid: boolean, userId?: string, sessionId?: string }`

```typescript
generateRefreshedTokens(userId: string, options?: RefreshOptions): Promise<TokenPair>
```

Generate new token pair

- Create new access token
- Optionally rotate refresh token
- Maintain user context
- **Parameters:** user ID, refresh options
- **Returns:** new token pair

```typescript
handleTokenRotation(oldToken: string, newTokens: TokenPair): Promise<void>
```

Handle refresh token rotation

- Store new refresh token
- Revoke old refresh token
- Update token family
- **Parameters:** old refresh token, new token pair

```typescript
extendSessionLifetime(sessionId: string, extension: number): Promise<void>
```

Extend session during refresh

- Update session expiration
- Maintain session data
- **Parameters:** session ID, extension in seconds

```typescript
validateRefreshRequest(body: any): RefreshValidation
```

Validate refresh request

- Check required fields
- Validate token format
- **Parameters:** request body
- **Returns:** `{ valid: boolean, errors?: ValidationError[] }`

```typescript
createRefreshResponse(tokens: TokenPair): Response
```

Format refresh response

- Include new tokens
- Set appropriate headers
- **Parameters:** token pair
- **Returns:** Elysia Response object

```typescript
handleRefreshFailure(error: RefreshError, context: ElysiaContext): Response
```

Handle refresh failures

- Invalid/expired tokens
- Security violations
- **Parameters:** refresh error, Elysia context
- **Returns:** error response

```typescript
logRefreshEvent(event: RefreshEvent, context: ElysiaContext): void
```

Log token refresh events

- Successful refreshes
- Failed attempts
- Security events
- **Parameters:** refresh event, Elysia context

## 3.5.4 WebSocketAuthHandler

**Purpose:** Handle WebSocket connection authentication and maintain authenticated WebSocket sessions.

**Responsibilities:**

- Authenticate WebSocket upgrade requests
- Validate connection tokens
- Maintain connection-to-user mapping
- Handle authentication during connection lifetime
- Clean up on disconnection
- Support different WebSocket auth methods

**WebSocket Auth Methods:**

1. **Token in URL:** `ws://host/path?token=jwt`
2. **Header Auth:** `Sec-WebSocket-Protocol: auth,jwt-token`
3. **Query Auth:** Token in query parameters
4. **Cookie Auth:** Session cookies
5. **Subprotocol Negotiation:** Custom auth subprotocol

**Functions:**

```typescript
handleWebSocketUpgrade(context: ElysiaContext): Promise<WSUpgradeResult>
```

Handle WebSocket upgrade authentication

- Validate auth credentials
- Check connection permissions
- Setup connection context
- **Parameters:** Elysia context
- **Returns:** `{ allow: boolean, user?: AuthUser, connectionId?: string }`

```typescript
extractWSAuthToken(context: ElysiaContext): string | null
```

Extract auth token from WebSocket request

- Check query parameters
- Check subprotocol header
- Check cookies
- **Parameters:** Elysia context
- **Returns:** auth token or null

```typescript
validateWSConnection(token: string, context: ElysiaContext): Promise<WSValidation>
```

Validate WebSocket connection auth

- Verify token authenticity
- Check user permissions
- Generate connection ID
- **Parameters:** auth token, Elysia context
- **Returns:** `{ valid: boolean, user?: AuthUser, connectionId?: string }`

```typescript
setupWSConnection(connectionId: string, user: AuthUser): Promise<void>
```

Setup authenticated WebSocket connection

- Store connection mapping
- Set connection metadata
- Initialize connection state
- **Parameters:** connection ID, authenticated user

```typescript
handleWSDisconnection(connectionId: string): Promise<void>
```

Handle WebSocket disconnection cleanup

- Remove connection mapping
- Clean up connection state
- Log disconnection event
- **Parameters:** connection ID

```typescript
reauthenticateWSConnection(connectionId: string, newToken: string): Promise<boolean>
```

Re-authenticate existing WebSocket connection

- Validate new token
- Update connection user
- **Parameters:** connection ID, new auth token
- **Returns:** success boolean

```typescript
getWSConnectionUser(connectionId: string): Promise<AuthUser | null>
```

Get user for WebSocket connection

- Lookup connection mapping
- Return authenticated user
- **Parameters:** connection ID
- **Returns:** user object or null

```typescript
validateWSMessageAuth(connectionId: string, message: WSMessage): Promise<boolean>
```

Validate authentication for WebSocket message

- Check connection is authenticated
- Verify message permissions
- **Parameters:** connection ID, message object
- **Returns:** authorized boolean

```typescript
logWSAuthEvent(event: WSAuthEvent, context: ElysiaContext): void
```

Log WebSocket authentication events

- Connection auth attempts
- Re-authentications
- Disconnections
- **Parameters:** auth event, Elysia context

## 3.5.5 WebSocketAuthorizationHandler

**Purpose:** Handle authorization for WebSocket messages and enforce real-time permission checks.

**Responsibilities:**

- Authorize WebSocket messages
- Enforce real-time permissions
- Filter message content by permissions
- Handle authorization failures
- Support subscription-based permissions
- Maintain permission state per connection

**Authorization Checks:**

1. **Message Type Auth:** Check permissions per message type
2. **Resource Auth:** Authorize access to specific resources
3. **Field Filtering:** Filter message fields based on permissions
4. **Subscription Auth:** Control topic/channel subscriptions
5. **Rate Limiting:** Per-connection rate limits

**Functions:**

```typescript
authorizeWSMessage(connectionId: string, message: WSMessage): Promise<WSAuthzResult>
```

Authorize WebSocket message

- Check message type permissions
- Validate resource access
- Apply field filtering
- **Parameters:** connection ID, message object
- **Returns:** `{ authorized: boolean, filteredMessage?: WSMessage, reason?: string }`

```typescript
checkMessagePermissions(connectionId: string, messageType: string, payload: any): Promise<PermissionCheck>
```

Check permissions for message type

- Get required permissions
- Validate user has permissions
- **Parameters:** connection ID, message type, message payload
- **Returns:** permission check result

```typescript
filterMessageContent(message: WSMessage, user: AuthUser): WSMessage
```

Filter message content by permissions

- Remove unauthorized fields
- Apply field-level restrictions
- **Parameters:** original message, user
- **Returns:** filtered message

```typescript
authorizeSubscription(connectionId: string, topic: string, options?: SubOptions): Promise<boolean>
```

Authorize topic subscription

- Check subscription permissions
- Validate topic access
- **Parameters:** connection ID, topic name, subscription options
- **Returns:** authorized boolean

```typescript
handleWSAuthzFailure(connectionId: string, error: WSAuthzError): Promise<void>
```

Handle WebSocket authorization failures

- Send error message to client
- Log authorization denial
- Optionally close connection
- **Parameters:** connection ID, authorization error

```typescript
updateWSConnectionPermissions(connectionId: string, permissions: string[]): Promise<void>
```

Update permissions for WebSocket connection

- Apply new permission set
- Update connection state
- **Parameters:** connection ID, new permissions array

```typescript
checkWSRateLimit(connectionId: string, messageType: string): Promise<boolean>
```

Check rate limits for WebSocket messages

- Per-connection limits
- Per-message-type limits
- **Parameters:** connection ID, message type
- **Returns:** within limits boolean

```typescript
validateMessageStructure(message: WSMessage): ValidationResult
```

Validate WebSocket message structure

- Check required fields
- Validate message format
- **Parameters:** message object
- **Returns:** `{ valid: boolean, errors?: ValidationError[] }`

```typescript
logWSAuthzEvent(event: WSAuthzEvent, connectionId: string): void
```

Log WebSocket authorization events

- Message authorizations
- Permission denials
- Subscription attempts
- **Parameters:** authz event, connection ID
