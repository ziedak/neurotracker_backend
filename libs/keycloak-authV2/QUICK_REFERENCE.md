# Quick Reference - KeycloakIntegrationService v2.1.0

**Quick access to all new methods and features**

---

## 🔑 API Key Management (9 Methods)

### Create API Key

```typescript
const result = await service.createAPIKey({
  userId: "user-123",
  name: "My API Key",
  scopes: ["read", "write"],
  permissions: ["admin"],
  expiresAt: new Date("2025-12-31"),
  storeId: "store-456",
  prefix: "sk_",
});

// Returns: { success: boolean, apiKey?: ApiKey, rawKey?: string, error?: string }
// ⚠️ rawKey is only returned once - store it securely!
```

### Validate API Key

```typescript
const result = await service.validateAPIKey("sk_test_abc123");

// Returns: { valid: boolean, keyData?: ApiKey, error?: string }
```

### Revoke API Key

```typescript
const result = await service.revokeAPIKey("key-id-123", "Security breach");

// Returns: { success: boolean, error?: string }
```

### List User's API Keys

```typescript
const result = await service.listAPIKeys("user-123");

// Returns: { success: boolean, keys?: ApiKey[], error?: string }
```

### Get Specific API Key

```typescript
const result = await service.getAPIKey("key-id-123");

// Returns: { success: boolean, key?: ApiKey, error?: string }
```

### Update API Key

```typescript
const result = await service.updateAPIKey("key-id-123", {
  name: "Updated Name",
  scopes: ["read", "write", "delete"],
  permissions: ["admin", "moderator"],
  expiresAt: new Date("2026-01-01"),
});

// Returns: { success: boolean, key?: ApiKey, error?: string }
```

### Rotate API Key

```typescript
const result = await service.rotateAPIKey("key-id-123", {
  expiresAt: new Date("2026-06-30"),
});

// Returns: { success: boolean, newKey?: ApiKey, rawKey?: string, error?: string }
// Old key is revoked, new key is created with same metadata
```

### Delete API Key

```typescript
const result = await service.deleteAPIKey("key-id-123");

// Returns: { success: boolean, error?: string }
// Soft delete - key is revoked with reason "Deleted"
```

### Get API Key Statistics

```typescript
const stats = await service.getAPIKeyStats();

// Returns: {
//   totalKeys: number,
//   activeKeys: number,
//   revokedKeys: number,
//   expiredKeys: number,
//   validationCount: number,
//   cacheHitRate: number
// }
```

---

## 🔐 Session Management (7 Methods)

### Create Session

```typescript
const result = await service.createSession(
  "user-123",
  {
    accessToken: "eyJhbGc...",
    refreshToken: "eyJhbGc...",
    idToken: "eyJhbGc...",
    expiresAt: new Date(Date.now() + 3600000),
    refreshExpiresAt: new Date(Date.now() + 86400000),
  },
  {
    ipAddress: "192.168.1.1",
    userAgent: "Mozilla/5.0...",
    fingerprint: { browser: "Chrome", os: "Linux" },
  }
);

// Returns: { success: boolean, sessionId?: string, sessionData?: any, error?: string }
```

### Get Session

```typescript
const result = await service.getSession("session-id-123");

// Returns: { success: boolean, session?: SessionData, error?: string }
```

### Update Session

```typescript
const result = await service.updateSession("session-id-123", {
  lastActivity: new Date(),
  metadata: { lastPage: "/dashboard", action: "view" },
});

// Returns: { success: boolean, error?: string }
```

### Refresh Session Tokens

```typescript
const result = await service.refreshSessionTokens("session-id-123");

// Returns: {
//   success: boolean,
//   tokens?: {
//     accessToken: string,
//     refreshToken?: string,
//     expiresAt: Date
//   },
//   error?: string
// }
```

### Invalidate Session

```typescript
const result = await service.invalidateSession("session-id-123");

// Returns: { success: boolean, error?: string }
```

### List User Sessions

```typescript
const result = await service.listUserSessions("user-123");

// Returns: { success: boolean, sessions?: SessionData[], error?: string }
```

### Get Session Statistics

```typescript
const stats = await service.getSessionStats();

// Returns: {
//   activeSessions: number,
//   totalSessions: number,
//   sessionsCreated: number,
//   sessionsExpired: number,
//   averageSessionDuration: number,
//   peakConcurrentSessions: number,
//   successfulLogins: number,
//   failedLogins: number,
//   tokenRefreshCount: number,
//   securityViolations: number
// }
```

---

## ⚙️ Service Creation

### Standard Creation (Backward Compatible)

```typescript
import { KeycloakIntegrationService } from "@libs/keycloak-authV2";

const service = KeycloakIntegrationService.create(
  {
    serverUrl: "http://localhost:8080",
    realm: "my-realm",
    clientId: "my-client",
    clientSecret: "my-secret",
  },
  dbClient,
  metrics
);
```

### Advanced Creation (With Optional Features)

```typescript
import { KeycloakIntegrationService } from "@libs/keycloak-authV2";
import { CacheService } from "@libs/database";

const cacheService = new CacheService(redisClient);

const service = KeycloakIntegrationService.createWithOptions({
  keycloakOptions: {
    serverUrl: "http://localhost:8080",
    realm: "my-realm",
    clientId: "my-client",
    clientSecret: "my-secret",
  },
  dbClient,
  cacheService, // ✅ Enable caching for 70%+ performance boost
  metrics,
  syncService, // ✅ Enable user synchronization
});
```

---

## 📊 Enhanced Statistics

### Get Comprehensive Stats

```typescript
const stats = await service.getStats();

// Returns: {
//   session: SessionStats,
//   client: {
//     discoveryLoaded: boolean,
//     cacheEnabled: boolean,
//     requestCount: number
//   },
//   token: {
//     cacheHits: number,
//     cacheMisses: number,
//     validationCount: number,
//     jwksLoaded: boolean
//   },
//   apiKey?: {
//     totalKeys: number,
//     activeKeys: number,
//     revokedKeys: number,
//     expiredKeys: number,
//     validationCount: number,
//     cacheHitRate: number
//   }
// }
```

---

## 🛡️ Error Handling Pattern

All methods follow a consistent error handling pattern:

```typescript
const result = await service.someMethod(...);

if (result.success) {
  // Handle success
  console.log('Operation successful:', result.data);
} else {
  // Handle error
  console.error('Operation failed:', result.error);
  // Error is also logged automatically
  // Metrics are recorded automatically
}
```

---

## 🔄 Common Workflows

### Complete Auth Flow

```typescript
// 1. Authenticate
const auth = await service.authenticateWithPassword("username", "password", {
  ipAddress: req.ip,
  userAgent: req.headers["user-agent"],
});

if (!auth.success) {
  return res.status(401).json({ error: "Authentication failed" });
}

// 2. Session is automatically created
const sessionId = auth.session?.sessionId;

// 3. Later: Validate session
const validation = await service.validateSession(sessionId, {
  ipAddress: req.ip,
  userAgent: req.headers["user-agent"],
});

if (!validation.valid) {
  return res.status(401).json({ error: "Invalid session" });
}

// 4. Later: Refresh tokens when needed
const refreshed = await service.refreshSessionTokens(sessionId);

// 5. Finally: Logout
const logout = await service.logout(
  sessionId,
  {
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  },
  {
    logoutFromKeycloak: true,
  }
);
```

### API Key Lifecycle

```typescript
// 1. Create
const created = await service.createAPIKey({
  userId: "user-123",
  name: "Production Key",
  scopes: ["read", "write"],
});

// Store the raw key securely!
const rawKey = created.rawKey;

// 2. Use in requests
const headers = { "X-API-Key": rawKey };

// 3. Validate in middleware
const validation = await service.validateAPIKey(req.headers["x-api-key"]);
if (!validation.valid) {
  return res.status(401).json({ error: "Invalid API key" });
}

// 4. Rotate when needed (e.g., every 90 days)
const rotated = await service.rotateAPIKey(created.apiKey.id);
// Send new key to user via secure channel

// 5. Revoke if compromised
await service.revokeAPIKey(created.apiKey.id, "Key compromised");
```

### Session Management

```typescript
// Create custom session
const session = await service.createSession(userId, tokens, requestContext);

// Monitor active sessions
const sessions = await service.listUserSessions(userId);
console.log(`User has ${sessions.sessions?.length} active sessions`);

// Force logout all sessions
for (const session of sessions.sessions || []) {
  await service.invalidateSession(session.sessionId);
}

// Get statistics
const stats = await service.getSessionStats();
console.log(`Peak concurrent sessions: ${stats.peakConcurrentSessions}`);
```

---

## 🎯 Best Practices

### API Key Security

```typescript
// ✅ DO: Store raw key securely (encrypt in database)
const encrypted = encrypt(created.rawKey);
await db.apiKeys.create({ userId, key: encrypted });

// ✅ DO: Set expiration dates
const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

// ✅ DO: Rotate keys regularly
async function rotateExpiringSoon() {
  const keys = await service.listAPIKeys(userId);
  for (const key of keys.keys || []) {
    if (isExpiringSoon(key.expiresAt)) {
      await service.rotateAPIKey(key.id);
    }
  }
}

// ❌ DON'T: Log or expose raw API keys
console.log(created.rawKey); // ❌ Never do this!
```

### Session Management

```typescript
// ✅ DO: Update session activity regularly
app.use(async (req, res, next) => {
  if (req.sessionId) {
    await service.updateSession(req.sessionId, {
      lastActivity: new Date(),
    });
  }
  next();
});

// ✅ DO: Refresh tokens before expiry
if (session.expiresAt < Date.now() + 5 * 60 * 1000) {
  const refreshed = await service.refreshSessionTokens(sessionId);
}

// ✅ DO: Validate session on sensitive operations
if (req.path === "/transfer-money") {
  const validation = await service.validateSession(req.sessionId, context);
  if (!validation.valid) {
    return res.status(401).json({ error: "Session invalid" });
  }
}
```

### Performance Optimization

```typescript
// ✅ DO: Enable caching
const service = KeycloakIntegrationService.createWithOptions({
  ...options,
  cacheService, // 70%+ performance improvement!
});

// ✅ DO: Use API keys for service-to-service auth
// (Faster than OAuth flows)

// ✅ DO: Monitor cache hit rates
const stats = await service.getAPIKeyStats();
if (stats.cacheHitRate < 0.5) {
  console.warn("Low cache hit rate - investigate!");
}
```

---

## 📚 Additional Resources

- **Full Documentation**: See `FINAL_SUMMARY.md`
- **Implementation Plan**: See `INTEGRATION_SERVICE_REFACTOR_PLAN.md`
- **Testing Strategy**: See `TESTING_STRATEGY.md`
- **Architecture Diagrams**: See `ARCHITECTURE_DIAGRAMS.md`
- **Flows & Sequences**: See `IMPLEMENTATION_FLOWS.md`

---

## 🆘 Troubleshooting

### Issue: API Key validation always returns invalid

```typescript
// Check if API key manager is initialized
const service = KeycloakIntegrationService.createWithOptions({
  // ... ensure cacheService is provided if using caching
});

// Verify API key format
const result = await service.getAPIKey(keyId);
console.log("Key details:", result.key);
```

### Issue: Session refresh fails

```typescript
// Ensure session has refresh token
const session = await service.getSession(sessionId);
if (!session.session?.refreshToken) {
  console.error("No refresh token available");
}

// Check token expiration
if (session.session?.expiresAt < Date.now()) {
  console.error("Session already expired");
}
```

### Issue: Cache not improving performance

```typescript
// Verify cache service is initialized
const stats = await service.getStats();
console.log("Cache enabled:", stats.client.cacheEnabled);

// Check cache hit rate
const apiKeyStats = await service.getAPIKeyStats();
console.log("Cache hit rate:", apiKeyStats.cacheHitRate);
// Should be >0.7 for good performance
```

---

**Quick Reference Version**: 2.1.0  
**Last Updated**: October 7, 2025  
**Status**: Production Ready ✅
