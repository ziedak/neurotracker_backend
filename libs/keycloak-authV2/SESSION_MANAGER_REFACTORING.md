# SessionManager Refactoring - Delegation Pattern Implementation

## Overview

The `SessionManager` class has been refactored to follow the **Single Responsibility Principle** and properly delegate operations to specialized service classes in the `libs/keycloak-authV2/src/services/session` directory.

## Key Changes

### 1. **Constructor Enhancements**

**Before:**

- SessionManager initialized components but keycloakClient was optional
- Token operations were handled inline

**After:**

```typescript
constructor(
  private readonly tokenManager: ITokenManager,
  private readonly dbClient: PostgreSQLClient,
  private readonly keycloakClient: KeycloakClient, // Now required
  private readonly cacheService?: CacheService,
  private readonly metrics?: IMetricsCollector,
  config: Partial<SessionManagerConfig> = {}
)
```

- `keycloakClient` is now a required dependency (no longer optional)
- Added `SessionTokenCoordinator` as a core component
- Added `tokenRefreshBuffer` configuration option (default: 300 seconds)

### 2. **Delegation Architecture**

#### **Session Creation** (`createSession`)

**Delegates to:**

1. **SessionSecurity** - Concurrent session limit enforcement
2. **SessionValidator** - Fingerprint generation
3. **EncryptionManager** - Token encryption
4. **SessionStore** - Session persistence
5. **SessionSecurity** - Device fingerprint validation
6. **SessionMetrics** - Success/failure tracking

**Benefits:**

- Clear separation of concerns
- Each security check is handled by the appropriate component
- Easier to test and maintain

#### **Session Validation** (`validateSession`)

**Delegates to:**

1. **SessionStore** - Session retrieval
2. **SessionValidator** - Basic validation (expiration, rotation)
3. **SessionTokenCoordinator** - Automatic token refresh if needed
4. **SessionSecurity** - Suspicious activity detection
5. **SessionStore** - Update access time
6. **SessionMetrics** - Validation tracking

**Benefits:**

- Automatic token refresh handled by coordinator
- Security checks are isolated
- Metrics collection is consistent

#### **Token Refresh** (`refreshSessionTokens`)

**Before:**

- Inline Keycloak client calls
- Manual token encryption/decryption
- Manual session store updates

**After:**

```typescript
async refreshSessionTokens(sessionData: SessionData): Promise<{
  success: boolean;
  sessionData?: SessionData;
  reason?: string;
}> {
  // Decrypt refresh token
  const decryptedRefreshToken =
    await this.encryptionManager.decryptCompact(sessionData.refreshToken);

  // Delegate to SessionTokenCoordinator
  // This handles: KeycloakClient + SessionStore + automatic refresh scheduling
  await this.tokenCoordinator.refreshSessionTokens(sessionData);

  // Retrieve updated session
  const updatedSessionData = await this.sessionStore.retrieveSession(sessionData.id);

  return { success: true, sessionData: updatedSessionData };
}
```

**Benefits:**

- SessionTokenCoordinator handles all token refresh logic
- Automatic token refresh scheduling (background refresh before expiration)
- Cleaner code with single responsibility

#### **Session Destruction** (`destroySession`)

**Delegates to:**

1. **SessionTokenCoordinator** - Cancel automatic refresh
2. **SessionStore** - Mark session inactive
3. **SessionStore** - Invalidate cache
4. **SessionMetrics** - Update active session count

**Benefits:**

- Proper cleanup of background refresh timers
- Consistent cache invalidation
- Metrics remain accurate

### 3. **Component Responsibilities**

| Component                   | Responsibility                                         | Used By                                                                 |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| **SessionStore**            | Database/cache operations                              | All methods                                                             |
| **SessionTokenCoordinator** | Token refresh, validation, scheduling                  | `validateSession`, `refreshSessionTokens`, `destroySession`             |
| **SessionValidator**        | Session validation, fingerprint generation             | `createSession`, `validateSession`                                      |
| **SessionSecurity**         | Concurrent limits, device validation, threat detection | `createSession`, `validateSession`                                      |
| **SessionMetrics**          | Statistics, monitoring                                 | `createSession`, `validateSession`, `destroySession`, `getSessionStats` |
| **SessionCleaner**          | Session cleanup, maintenance                           | `healthCheck`, `shutdown`                                               |
| **EncryptionManager**       | Token encryption/decryption                            | `createSession`, `validateSession`, `refreshSessionTokens`              |

### 4. **Health Check Enhancement**

**Added:**

- `tokenCoordinator` health check
- Scheduler health status
- Improved component status aggregation

```typescript
healthResults["tokenCoordinator"] = await this.tokenCoordinator.healthCheck();
```

### 5. **Shutdown Enhancement**

**Added:**

- `tokenCoordinator.dispose()` to cleanup background refresh timers
- Proper shutdown ordering to avoid race conditions

## Configuration Changes

### New Configuration Option

```typescript
export interface SessionManagerConfig {
  // ... existing options
  readonly tokenRefreshBuffer?: number; // Seconds before expiry to refresh (default: 300)
}
```

**Usage:**

```typescript
const sessionManager = new SessionManager(
  tokenManager,
  dbClient,
  keycloakClient, // Now required
  cacheService,
  metrics,
  {
    encryptionKey: process.env.ENCRYPTION_KEY,
    tokenRefreshBuffer: 300, // Refresh 5 minutes before expiration
    enableComponents: {
      metrics: true,
      security: true,
      cleanup: true,
      validation: true,
    },
  }
);
```

## Benefits of Refactoring

### 1. **Single Responsibility Principle (SRP)**

- SessionManager is now a pure orchestrator
- Each operation delegates to specialized components
- Components can be tested independently

### 2. **Improved Testability**

- Mock individual components easily
- Test delegation logic separately from business logic
- Clear component boundaries

### 3. **Enhanced Maintainability**

- Changes to token logic only affect SessionTokenCoordinator
- Security changes isolated to SessionSecurity
- Validation logic contained in SessionValidator

### 4. **Automatic Token Refresh**

- Background refresh prevents token expiration
- Configurable refresh buffer
- Automatic cleanup on session destruction

### 5. **Better Error Handling**

- Each component handles its own errors
- Clearer error messages with component context
- Consistent error propagation

### 6. **Performance Improvements**

- Automatic refresh reduces validation overhead
- Efficient batch operations for concurrent limit enforcement
- Proper resource cleanup prevents memory leaks

## Migration Guide

### Breaking Changes

1. **Constructor signature changed:**

   ```typescript
   // Before
   new SessionManager(tokenManager, dbClient, cacheService, metrics, config);

   // After
   new SessionManager(
     tokenManager,
     dbClient,
     keycloakClient,
     cacheService,
     metrics,
     config
   );
   ```

2. **keycloakClient is now required** - ensure it's always provided

### Non-Breaking Changes

- Existing session operations continue to work
- API interfaces remain unchanged
- Internal delegation is transparent to callers

## Example Usage

```typescript
import { SessionManager } from "@libs/keycloak-auth/services/session";
import { KeycloakClient } from "@libs/keycloak-auth/client";

// Initialize dependencies
const keycloakClient = new KeycloakClient(/* config */);
const sessionManager = new SessionManager(
  tokenManager,
  dbClient,
  keycloakClient, // Required
  cacheService,
  metrics,
  {
    encryptionKey: process.env.SESSION_ENCRYPTION_KEY,
    tokenRefreshBuffer: 300, // 5 minutes
    enableComponents: {
      metrics: true,
      security: true,
      cleanup: true,
      validation: true,
    },
  }
);

// Create session with automatic token refresh
const result = await sessionManager.createSession(
  userId,
  {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + 3600000), // 1 hour
  },
  {
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
    fingerprint: {
      userAgent: req.headers["user-agent"],
      acceptLanguage: req.headers["accept-language"],
    },
  }
);

// Validate session (automatically refreshes if needed)
const validation = await sessionManager.validateSession(sessionId, {
  ipAddress: req.ip,
  userAgent: req.headers["user-agent"],
});

// Destroy session (automatically cancels background refresh)
await sessionManager.destroySession(sessionId, "logout");
```

## Testing Recommendations

### Unit Tests

```typescript
describe("SessionManager", () => {
  let sessionManager: SessionManager;
  let mockTokenCoordinator: jest.Mocked<SessionTokenCoordinator>;
  let mockSessionStore: jest.Mocked<SessionStore>;

  beforeEach(() => {
    // Mock all dependencies
    mockTokenCoordinator = {
      refreshSessionTokens: jest.fn(),
      cancelAutomaticRefresh: jest.fn(),
      healthCheck: jest.fn(),
      dispose: jest.fn(),
    };

    // Test delegation logic
  });

  it("should delegate token refresh to SessionTokenCoordinator", async () => {
    await sessionManager.refreshSessionTokens(mockSessionData);
    expect(mockTokenCoordinator.refreshSessionTokens).toHaveBeenCalled();
  });
});
```

## Future Enhancements

1. **Session Analytics**: Aggregate detailed session metrics
2. **Advanced Security**: ML-based anomaly detection
3. **Session Migration**: Support for session transfer between devices
4. **Backup Refresh**: Fallback refresh strategies if primary fails

## Summary

The refactored `SessionManager` is now a true orchestrator that delegates all operations to specialized components. This follows SOLID principles, improves testability, and provides better separation of concerns. The automatic token refresh feature and proper resource cleanup enhance both reliability and performance.
