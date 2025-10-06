# Session Management Architecture - Delegation Pattern

## Component Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      SessionManager                              │
│                   (Orchestrator Layer)                           │
│                                                                   │
│  Responsibilities:                                                │
│  - Coordinate components                                          │
│  - Handle cross-component workflows                               │
│  - Provide unified API                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Delegates to:
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Core Components                                │
└─────────────────────────────────────────────────────────────────┘
         │                │                │                │
         ▼                ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│SessionStore  │ │TokenCoord.   │ │Encryption    │ │SessionValid. │
│              │ │              │ │Manager       │ │              │
│- DB ops      │ │- Refresh     │ │              │ │- Validation  │
│- Cache ops   │ │- Scheduling  │ │- Encrypt     │ │- Fingerprint │
│- Retrieval   │ │- Keycloak    │ │- Decrypt     │ │- Expiration  │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘

         │                │                │                │
         ▼                ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│SessionSec.   │ │SessionMetrics│ │SessionCleaner│ │TokenManager  │
│              │ │              │ │              │ │              │
│- Concurrent  │ │- Statistics  │ │- Cleanup     │ │- Token ops   │
│- Fingerprint │ │- Monitoring  │ │- Maintenance │ │- Lifecycle   │
│- Threats     │ │- Tracking    │ │- Batch ops   │ │              │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

## Method-Level Delegation Flow

### createSession() Delegation Chain

```
SessionManager.createSession()
    │
    ├─► SessionSecurity.enforceConcurrentSessionLimits()
    │   └─► SessionStore.getUserSessions()
    │       └─► terminateSessionsBatch()
    │           └─► SessionStore.markSessionInactive()
    │
    ├─► SessionValidator.generateFingerprint()
    │
    ├─► EncryptionManager.encryptCompact()
    │   (for accessToken, refreshToken, idToken)
    │
    ├─► SessionStore.storeSession()
    │
    ├─► SessionSecurity.validateDeviceFingerprint()
    │
    └─► SessionMetrics.recordSessionCreation()
```

### validateSession() Delegation Chain

```
SessionManager.validateSession()
    │
    ├─► SessionStore.retrieveSession()
    │
    ├─► SessionValidator.validateSession()
    │   └─► (checks expiration, rotation, fingerprint)
    │
    ├─► [if refresh needed]
    │   └─► SessionTokenCoordinator.refreshSessionTokens()
    │       ├─► EncryptionManager.decryptCompact()
    │       ├─► KeycloakClient.refreshToken()
    │       ├─► SessionStore.updateSessionTokens()
    │       └─► TokenRefreshScheduler.scheduleRefresh()
    │
    ├─► SessionSecurity.detectSuspiciousActivity()
    │
    ├─► SessionStore.updateSessionAccess()
    │
    └─► SessionMetrics.recordSessionValidation()
```

### refreshSessionTokens() Delegation Chain

```
SessionManager.refreshSessionTokens()
    │
    ├─► EncryptionManager.decryptCompact()
    │
    ├─► SessionTokenCoordinator.refreshSessionTokens()
    │   ├─► KeycloakClient.refreshToken()
    │   ├─► SessionStore.updateSessionTokens()
    │   └─► TokenRefreshScheduler.scheduleRefresh()
    │       └─► (background timer for automatic refresh)
    │
    ├─► SessionStore.retrieveSession()
    │
    └─► SessionMetrics.recordTokenRefresh()
```

### destroySession() Delegation Chain

```
SessionManager.destroySession()
    │
    ├─► SessionTokenCoordinator.cancelAutomaticRefresh()
    │   └─► TokenRefreshScheduler.cancelRefresh()
    │
    ├─► SessionStore.markSessionInactive()
    │
    ├─► SessionStore.invalidateSessionCache()
    │
    └─► SessionMetrics.updateSessionStats()
```

## Component Interaction Patterns

### 1. **Pure Delegation** (No Business Logic)

```typescript
// SessionManager acts as a pure orchestrator
async destroySession(sessionId: string): Promise<void> {
  // Step 1: Delegate to coordinator
  this.tokenCoordinator.cancelAutomaticRefresh(sessionId);

  // Step 2: Delegate to store
  await this.sessionStore.markSessionInactive(sessionId);

  // Step 3: Delegate to store
  await this.sessionStore.invalidateSessionCache(sessionId);

  // Step 4: Delegate to metrics
  await this.sessionMetrics.updateSessionStats({ ... });
}
```

### 2. **Coordinated Delegation** (Orchestration Logic)

```typescript
// SessionManager coordinates multiple components
async validateSession(sessionId: string): Promise<ValidationResult> {
  // Orchestration: retrieve, validate, refresh if needed, check security
  const session = await this.sessionStore.retrieveSession(sessionId);

  const validation = await this.sessionValidator.validateSession(session);

  if (validation.shouldRefreshToken) {
    await this.tokenCoordinator.refreshSessionTokens(session);
  }

  const security = await this.sessionSecurity.detectSuspiciousActivity(session);

  return { isValid: validation.isValid && security.isValid };
}
```

### 3. **Transform and Delegate** (Data Transformation)

```typescript
// SessionManager transforms data before delegating
async createSession(userId, tokens, context): Promise<AuthResult> {
  // Transform fingerprint data
  const fingerprint = this.sessionValidator.generateFingerprint({
    userAgent: context.fingerprint["userAgent"] || context.userAgent,
    acceptLanguage: context.fingerprint["acceptLanguage"] || "en-US",
    // ... other transformations
  });

  // Encrypt tokens
  const encryptedTokens = {
    accessToken: await this.encryptionManager.encryptCompact(tokens.accessToken),
    refreshToken: await this.encryptionManager.encryptCompact(tokens.refreshToken),
  };

  // Delegate storage
  await this.sessionStore.storeSession({ ...sessionData, fingerprint, ...encryptedTokens });
}
```

## Dependency Graph

```
SessionManager
    │
    ├── Required Dependencies (Core)
    │   ├── SessionStore (Database + Cache)
    │   ├── SessionTokenCoordinator (Token operations)
    │   ├── EncryptionManager (Encryption)
    │   ├── TokenManager (Token lifecycle)
    │   ├── KeycloakClient (External auth)
    │   ├── PostgreSQLClient (Database)
    │   └── Logger (Logging)
    │
    └── Optional Dependencies (Components)
        ├── CacheService (Redis)
        ├── MetricsCollector (Monitoring)
        ├── SessionValidator (Validation)
        ├── SessionSecurity (Security)
        ├── SessionMetrics (Statistics)
        └── SessionCleaner (Maintenance)
```

## Component Responsibility Matrix

| Operation    | Store        | Coordinator | Validator       | Security       | Metrics    | Cleaner     |
| ------------ | ------------ | ----------- | --------------- | -------------- | ---------- | ----------- |
| **Create**   | ✓ (persist)  | -           | ✓ (fingerprint) | ✓ (concurrent) | ✓ (track)  | -           |
| **Validate** | ✓ (retrieve) | ✓ (refresh) | ✓ (check)       | ✓ (threats)    | ✓ (track)  | -           |
| **Refresh**  | ✓ (update)   | ✓ (execute) | -               | -              | ✓ (track)  | -           |
| **Destroy**  | ✓ (mark)     | ✓ (cancel)  | -               | -              | ✓ (update) | -           |
| **Cleanup**  | ✓ (batch)    | -           | -               | -              | -          | ✓ (execute) |

## Data Flow

### Session Creation Flow

```
User Request
    ↓
SessionManager.createSession()
    ↓
[1] Security Check
    ↓ (sessionIds to terminate)
SessionStore.getUserSessions() → SessionSecurity.enforceConcurrent()
    ↓
[2] Generate Fingerprint
    ↓ (fingerprint string)
SessionValidator.generateFingerprint()
    ↓
[3] Encrypt Tokens
    ↓ (encrypted tokens)
EncryptionManager.encryptCompact()
    ↓
[4] Store Session
    ↓ (session persisted)
SessionStore.storeSession()
    ↓
[5] Validate Device
    ↓ (validation result)
SessionSecurity.validateDeviceFingerprint()
    ↓
[6] Record Metrics
    ↓
SessionMetrics.recordSessionCreation()
    ↓
Success Response
```

### Session Validation Flow

```
User Request
    ↓
SessionManager.validateSession()
    ↓
[1] Retrieve Session
    ↓ (session data)
SessionStore.retrieveSession()
    ↓
[2] Validate Session
    ↓ (validation result)
SessionValidator.validateSession()
    ↓
[3] Refresh if Needed?
    ↓ (YES → refresh)
SessionTokenCoordinator.refreshSessionTokens()
    ├─► KeycloakClient.refreshToken()
    ├─► SessionStore.updateSessionTokens()
    └─► TokenRefreshScheduler.scheduleRefresh()
    ↓
[4] Security Check
    ↓ (security result)
SessionSecurity.detectSuspiciousActivity()
    ↓
[5] Update Access Time
    ↓
SessionStore.updateSessionAccess()
    ↓
[6] Record Metrics
    ↓
SessionMetrics.recordSessionValidation()
    ↓
Validation Response
```

## Benefits of Delegation Architecture

### 1. **Separation of Concerns**

- Each component has a single, well-defined responsibility
- SessionManager only orchestrates, doesn't implement business logic
- Easy to locate where specific functionality lives

### 2. **Testability**

```typescript
// Mock individual components
const mockTokenCoordinator = {
  refreshSessionTokens: jest.fn(),
  cancelAutomaticRefresh: jest.fn(),
};

// Test only orchestration logic
test("validateSession delegates to coordinator when refresh needed", async () => {
  await sessionManager.validateSession(sessionId);
  expect(mockTokenCoordinator.refreshSessionTokens).toHaveBeenCalled();
});
```

### 3. **Maintainability**

- Changes to token refresh logic only affect SessionTokenCoordinator
- Security enhancements isolated to SessionSecurity
- Database optimizations contained in SessionStore

### 4. **Extensibility**

- Add new components without modifying existing ones (Open/Closed Principle)
- Replace implementations without breaking contracts
- Optional components can be enabled/disabled via configuration

### 5. **Performance**

- SessionTokenCoordinator handles automatic background refresh
- SessionStore optimizes cache usage
- SessionCleaner performs batch operations efficiently

### 6. **Error Handling**

- Each component handles its own error scenarios
- Errors propagate with component-specific context
- Failed operations don't affect other components

## Configuration-Driven Architecture

```typescript
const sessionManager = new SessionManager(
  tokenManager,
  dbClient,
  keycloakClient,
  cacheService,
  metrics,
  {
    encryptionKey: "...",
    tokenRefreshBuffer: 300,

    // Enable/disable components
    enableComponents: {
      metrics: true, // SessionMetrics
      security: true, // SessionSecurity
      cleanup: true, // SessionCleaner
      validation: true, // SessionValidator
    },

    // Component-specific configuration
    sessionSecurity: {
      maxConcurrentSessions: 5,
      deviceTrackingEnabled: true,
    },
    sessionValidator: {
      sessionTimeout: 86400000,
      requireFingerprint: true,
    },
  }
);
```

## Summary

The refactored SessionManager follows a **pure delegation pattern** where:

1. **SessionManager** = Orchestrator (coordinates components)
2. **Components** = Specialized services (implement business logic)
3. **Delegation** = Clear, one-directional calls
4. **Configuration** = Component behavior is configurable
5. **Testing** = Components can be mocked independently

This architecture ensures **SOLID principles**, improves **maintainability**, enhances **testability**, and provides **clear separation of concerns** throughout the session management system.
