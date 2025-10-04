# WebSocket Authentication Middleware

**Purpose:** Authenticate WebSocket upgrade requests and establish authenticated connections.

**Responsibilities:**

- Intercept WebSocket upgrade requests
- Extract and validate authentication credentials
- Establish connection-to-user mapping
- Handle authentication failures
- Support multiple authentication methods
- Rate limit connection attempts

**Authentication Flow:**

```
Client Request → Extract Credentials → Validate → Create Connection → Success/Failure
```

## Core Functions

```typescript
authenticateUpgrade(context: WSUpgradeContext): Promise<UpgradeResult>
```

Authenticate WebSocket upgrade request

- Extract auth credentials
- Validate authentication
- Create connection mapping
- **Parameters:** WebSocket upgrade context
- **Returns:** `{ allow: boolean, user?: AuthUser, connectionId?: string, error?: string }`

```typescript
extractWSCredentials(context: WSUpgradeContext): WSCredentials | null
```

Extract authentication credentials from WebSocket request

- Check query parameters
- Check subprotocol header
- Check cookies
- **Parameters:** upgrade context
- **Returns:** credentials object or null

**Supported Credential Methods:**

```typescript
// Query parameter
//host/realtime?token=jwt_token

// Subprotocol
ws: const ws = new WebSocket("ws://host/realtime", ["auth", "jwt_token"]);

// Cookie (automatic)
const ws = new WebSocket("ws://host/realtime"); // Uses session cookies
```

```typescript
validateWSToken(token: string, context: WSUpgradeContext): Promise<TokenValidation>
```

Validate WebSocket authentication token

- Verify JWT signature and claims
- Check token revocation
- Extract user information
- **Parameters:** token string, upgrade context
- **Returns:** `{ valid: boolean, user?: AuthUser, error?: string }`

```typescript
createWSConnection(user: AuthUser, metadata: ConnectionMetadata): Promise<string>
```

Create authenticated WebSocket connection

- Generate connection ID
- Register with connection manager
- Set initial permissions
- **Parameters:** authenticated user, connection metadata
- **Returns:** connection ID

```typescript
handleWSAuthFailure(error: WSAuthError, context: WSUpgradeContext): Promise<UpgradeResult>
```

Handle WebSocket authentication failures

- Log security events
- Return appropriate error response
- Implement progressive delays
- **Parameters:** auth error, upgrade context
- **Returns:** deny upgrade result

## Authentication Methods

### JWT Token Authentication

```typescript
const wsAuth = createWSAuthMiddleware({
  methods: ["jwt"],
  jwt: {
    secret: "your-secret",
    algorithms: ["HS256"],
    issuer: "your-app",
  },
});
```

### API Key Authentication

```typescript
const wsAuth = createWSAuthMiddleware({
  methods: ["apiKey"],
  apiKey: {
    headerName: "X-API-Key",
    validator: validateApiKeyFunction,
  },
});
```

### Session Cookie Authentication

```typescript
const wsAuth = createWSAuthMiddleware({
  methods: ["session"],
  session: {
    cookieName: "sessionId",
    store: sessionStore,
  },
});
```

## Rate Limiting

```typescript
const wsAuth = createWSAuthMiddleware({
  rateLimit: {
    windowMs: 60000, // 1 minute
    maxAttempts: 5, // 5 attempts per minute
    blockDuration: 300000, // 5 minutes block
  },
});
```

## Error Responses

### Authentication Failed

```typescript
// HTTP 401 response for upgrade request
{
  "error": "authentication_failed",
  "message": "Invalid authentication token",
  "code": "INVALID_TOKEN"
}
```

### Rate Limited

```typescript
// HTTP 429 response
{
  "error": "rate_limited",
  "message": "Too many authentication attempts",
  "retryAfter": 300
}
```

### Connection Rejected

```typescript
// HTTP 403 response
{
  "error": "connection_rejected",
  "message": "User account suspended",
  "code": "ACCOUNT_SUSPENDED"
}
```

## Security Features

- **Token Expiration Checks:** Reject expired tokens
- **Origin Validation:** Validate request origin
- **IP Whitelisting:** Restrict connections by IP
- **User-Agent Validation:** Check user agent patterns
- **Connection Fingerprinting:** Detect connection anomalies

## Monitoring

```typescript
getWSAuthMetrics(): Promise<WSAuthMetrics>
```

Get WebSocket authentication metrics

- **Returns:** `{ totalUpgrades: number, successfulAuth: number, failedAuth: number, rateLimited: number, avgAuthTime: number }`
