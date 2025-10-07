# KeycloakIntegrationService - Implementation Flows

**Visual Guides and Sequence Diagrams**

---

## 🔄 Flow Diagrams

### 1. Service Initialization Flow

```mermaid
sequenceDiagram
    participant App as Application
    participant Builder as ServiceBuilder
    participant Service as IntegrationService
    participant KC as KeycloakClient
    participant DB as DatabaseClient
    participant Cache as CacheService

    App->>Builder: new ServiceBuilder()
    App->>Builder: .withKeycloakOptions()
    App->>Builder: .withDatabase()
    App->>Builder: .withCache()
    App->>Builder: .withMetrics()
    App->>Builder: .build()

    Builder->>Builder: validate()
    Builder->>Service: new IntegrationService(...)

    Service->>KC: Initialize KeycloakClient
    KC-->>Service: Client Ready

    Service->>DB: Verify Connection
    DB-->>Service: Connected

    Service->>Cache: Verify Connection
    Cache-->>Service: Connected

    Service->>Service: Initialize Components
    Note over Service: - AuthenticationManager<br/>- SessionManager<br/>- UserFacade<br/>- APIKeyManager<br/>- ResourceManager

    Service-->>Builder: Service Instance
    Builder-->>App: Ready to Use
```

---

### 2. API Key Creation Flow

```mermaid
sequenceDiagram
    participant Client as Client App
    participant Service as IntegrationService
    participant Validator as InputValidator
    participant Manager as APIKeyManager
    participant Ops as APIKeyOperations
    participant Storage as APIKeyStorage
    participant DB as Database
    participant Cache as CacheService
    participant Metrics as MetricsCollector

    Client->>Service: createAPIKey(options)
    Service->>Validator: validate(options)
    Validator-->>Service: ✓ Valid

    Service->>Manager: createAPIKey(options)
    Manager->>Ops: generateSecureKey()
    Ops->>Ops: crypto.randomBytes()
    Ops-->>Manager: secureKey

    Manager->>Ops: hashKey(secureKey)
    Ops-->>Manager: keyHash

    Manager->>Storage: createAPIKey(keyData)
    Storage->>DB: INSERT api_key
    DB-->>Storage: Created

    Storage->>Cache: set(keyHash, keyData)
    Cache-->>Storage: Cached

    Storage-->>Manager: ApiKey
    Manager->>Metrics: recordCounter('apikey.created')
    Manager-->>Service: ApiKey
    Service-->>Client: ApiKey
```

---

### 3. Authentication & Session Creation Flow

```mermaid
sequenceDiagram
    participant User as User
    participant Service as IntegrationService
    participant Auth as AuthenticationManager
    participant KC as KeycloakClient
    participant UserFacade as UserFacade
    participant Session as SessionManager
    participant Store as SessionStore
    participant DB as Database
    participant Cache as CacheService

    User->>Service: authenticateWithPassword(username, password)
    Service->>Auth: authenticateWithPassword(...)

    Auth->>KC: authenticate(username, password)
    KC-->>Auth: tokens + userInfo

    Auth->>UserFacade: getUserByUsername(username)
    UserFacade->>DB: SELECT user WHERE username
    DB-->>UserFacade: User
    UserFacade-->>Auth: User

    Auth->>Session: createSession(userId, tokens, context)

    Session->>Session: Security checks
    Note over Session: - Concurrent session limits<br/>- Device fingerprint<br/>- IP validation

    Session->>Session: Encrypt tokens

    Session->>Store: storeSession(sessionData)
    Store->>DB: INSERT user_session
    DB-->>Store: Created

    Store->>Cache: set(sessionId, sessionData)
    Cache-->>Store: Cached

    Store-->>Session: SessionData
    Session-->>Auth: AuthResult
    Auth-->>Service: AuthResult
    Service-->>User: {user, tokens, session}
```

---

### 4. Session Validation with Token Refresh

```mermaid
sequenceDiagram
    participant Client as Client
    participant Service as IntegrationService
    participant Validator as SessionValidator
    participant Manager as SessionManager
    participant Store as SessionStore
    participant Cache as CacheService
    participant DB as Database
    participant Coordinator as TokenCoordinator
    participant KC as KeycloakClient

    Client->>Service: validateSession(sessionId)
    Service->>Validator: validateSession(sessionId)
    Validator->>Manager: validateSession(sessionId)

    Manager->>Store: retrieveSession(sessionId)
    Store->>Cache: get(sessionId)

    alt Cache Hit
        Cache-->>Store: SessionData
    else Cache Miss
        Store->>DB: SELECT session
        DB-->>Store: SessionData
        Store->>Cache: set(sessionId, data)
    end

    Store-->>Manager: SessionData

    Manager->>Manager: Basic validation
    Note over Manager: - Expiration check<br/>- Active status<br/>- Security rules

    alt Token Near Expiry
        Manager->>Coordinator: refreshSessionTokens()
        Coordinator->>KC: refreshToken(refreshToken)
        KC-->>Coordinator: New tokens

        Coordinator->>Store: updateSessionTokens()
        Store->>DB: UPDATE session SET tokens
        Store->>Cache: set(sessionId, updated)
        Store-->>Coordinator: Updated
        Coordinator-->>Manager: Refreshed
    end

    Manager->>Store: updateLastAccess(sessionId)
    Manager-->>Validator: Valid + SessionData
    Validator-->>Service: Valid + SessionData
    Service-->>Client: ValidationResult
```

---

### 5. User Registration with Async Keycloak Sync

```mermaid
sequenceDiagram
    participant Client as Client
    participant Service as IntegrationService
    participant UserFacade as UserFacade
    participant Validation as Validation
    participant LocalDB as Local Database
    participant SyncService as SyncService
    participant Queue as SyncQueue
    participant Worker as BackgroundWorker
    participant KC as Keycloak

    Client->>Service: registerUser(userData)
    Service->>UserFacade: registerUser(userData)

    UserFacade->>Validation: validateUniqueness()
    Validation->>LocalDB: Check username/email
    Validation->>KC: Check username/email
    Validation-->>UserFacade: ✓ Unique

    UserFacade->>LocalDB: INSERT user
    Note over LocalDB: Local DB is<br/>SOURCE OF TRUTH
    LocalDB-->>UserFacade: User created

    UserFacade->>SyncService: queueUserCreate(userId)
    SyncService->>Queue: enqueue(CREATE_USER, userId)
    Queue-->>SyncService: Queued
    SyncService-->>UserFacade: Queued (non-blocking)

    UserFacade-->>Service: User
    Service-->>Client: User created ✓

    Note over Queue,Worker: Async processing

    Worker->>Queue: dequeue()
    Queue-->>Worker: CREATE_USER task

    Worker->>KC: createUser(userData)

    alt Success
        KC-->>Worker: User created in Keycloak
        Worker->>LocalDB: UPDATE sync_status = SYNCED
    else Failure
        KC-->>Worker: Error
        Worker->>Queue: requeue with backoff
        Worker->>LocalDB: UPDATE sync_status = FAILED
    end
```

---

### 6. API Key Validation Flow (Cached)

```mermaid
flowchart TD
    Start([Client Request]) --> Input[Extract API Key]
    Input --> CheckCache{Check Cache}

    CheckCache -->|Hit| ValidateExp[Validate Expiration]
    CheckCache -->|Miss| HashKey[Hash API Key]

    HashKey --> QueryDB[(Query Database)]
    QueryDB --> Found{Found?}
    Found -->|No| Invalid[Return Invalid]
    Found -->|Yes| CacheResult[Cache Result]
    CacheResult --> ValidateExp

    ValidateExp --> Expired{Expired?}
    Expired -->|Yes| Invalid
    Expired -->|No| CheckActive{Active?}

    CheckActive -->|No| Invalid
    CheckActive -->|Yes| CheckPerms[Check Permissions]

    CheckPerms --> HasPerms{Has Perms?}
    HasPerms -->|No| Forbidden[Return Forbidden]
    HasPerms -->|Yes| TrackUsage[Track Usage]

    TrackUsage --> RecordMetrics[Record Metrics]
    RecordMetrics --> Valid[Return Valid]

    Invalid --> End([Response])
    Forbidden --> End
    Valid --> End

    style Start fill:#e1f5e1
    style End fill:#e1f5e1
    style Valid fill:#90EE90
    style Invalid fill:#FFB6C1
    style Forbidden fill:#FFB6C1
```

---

### 7. Complete Health Check Flow

```mermaid
flowchart TD
    Start([Health Check Request]) --> Service[Integration Service]

    Service --> CheckKC[Check Keycloak]
    Service --> CheckDB[Check Database]
    Service --> CheckCache[Check Cache]
    Service --> CheckSession[Check Session Manager]
    Service --> CheckAPIKey[Check API Key Manager]
    Service --> CheckUser[Check User Facade]

    CheckKC --> KCResult{Connected?}
    CheckDB --> DBResult{Connected?}
    CheckCache --> CacheResult{Connected?}
    CheckSession --> SessionResult{Healthy?}
    CheckAPIKey --> APIKeyResult{Healthy?}
    CheckUser --> UserResult{Healthy?}

    KCResult -->|No| Unhealthy[Status: UNHEALTHY]
    DBResult -->|No| Unhealthy

    KCResult -->|Yes| Aggregate[Aggregate Results]
    DBResult -->|Yes| Aggregate
    CacheResult -->|Yes/No| Aggregate
    SessionResult -->|Yes/No| Aggregate
    APIKeyResult -->|Yes/No| Aggregate
    UserResult -->|Yes/No| Aggregate

    Aggregate --> Evaluate{All Critical<br/>Services OK?}

    Evaluate -->|Yes| AllHealthy{All Optional<br/>Services OK?}
    Evaluate -->|No| Unhealthy

    AllHealthy -->|Yes| Healthy[Status: HEALTHY]
    AllHealthy -->|No| Degraded[Status: DEGRADED]

    Healthy --> Response[Return Health Status]
    Degraded --> Response
    Unhealthy --> Response
    Response --> End([Response])

    style Healthy fill:#90EE90
    style Degraded fill:#FFD700
    style Unhealthy fill:#FFB6C1
```

---

### 8. Error Handling & Retry Flow

```mermaid
stateDiagram-v2
    [*] --> OperationStart

    OperationStart --> Validate: Input received
    Validate --> Execute: Valid input
    Validate --> ReturnError: Invalid input

    Execute --> Success: Operation succeeds
    Execute --> CheckRetryable: Operation fails

    CheckRetryable --> RetryableError: Network/Timeout
    CheckRetryable --> NonRetryableError: Auth/Validation

    RetryableError --> CheckAttempts: Can retry?
    CheckAttempts --> WaitBackoff: Attempts < Max
    CheckAttempts --> ReturnError: Attempts >= Max

    WaitBackoff --> Execute: After backoff

    NonRetryableError --> LogError
    LogError --> ReturnError

    Success --> RecordMetrics
    RecordMetrics --> ReturnSuccess

    ReturnSuccess --> [*]
    ReturnError --> [*]

    note right of WaitBackoff
        Exponential backoff:
        - Attempt 1: 1s
        - Attempt 2: 2s
        - Attempt 3: 4s
    end note

    note right of RecordMetrics
        Record:
        - Duration
        - Success/Failure
        - Error type
    end note
```

---

### 9. Cache Strategy Decision Tree

```mermaid
flowchart TD
    Start([Request Received]) --> CacheEnabled{Cache<br/>Enabled?}

    CacheEnabled -->|No| DirectDB[Query Database]
    CacheEnabled -->|Yes| CheckCache[Check Cache]

    CheckCache --> CacheHit{Found?}

    CacheHit -->|Yes| ValidateTTL{Valid TTL?}
    CacheHit -->|No| QueryDB[Query Database]

    ValidateTTL -->|Yes| Return[Return Cached Data]
    ValidateTTL -->|No| QueryDB

    QueryDB --> DBResult{Found?}
    DBResult -->|No| NotFound[Return Not Found]
    DBResult -->|Yes| UpdateCache[Update Cache]

    UpdateCache --> Return
    DirectDB --> DBDirectResult{Found?}
    DBDirectResult -->|No| NotFound
    DBDirectResult -->|Yes| Return

    Return --> RecordHit[Record Cache Hit]
    NotFound --> RecordMiss[Record Cache Miss]

    RecordHit --> End([Return Response])
    RecordMiss --> End

    style Return fill:#90EE90
    style NotFound fill:#FFB6C1
```

---

### 10. Concurrent Session Limit Enforcement

```mermaid
sequenceDiagram
    participant User as User Login
    participant Security as SessionSecurity
    participant Store as SessionStore
    participant DB as Database

    User->>Security: Create new session
    Security->>Store: getUserSessions(userId)
    Store->>DB: SELECT * WHERE userId AND active
    DB-->>Store: Active sessions list
    Store-->>Security: [Session1, Session2, ...]

    Security->>Security: Count active sessions

    alt Sessions < Limit
        Security-->>User: Allow creation
    else Sessions >= Limit
        Security->>Security: Identify oldest sessions

        loop For each excess session
            Security->>Store: terminateSession(sessionId)
            Store->>DB: UPDATE active = false
        end

        Security-->>User: Allow creation<br/>(after terminating old ones)
    end
```

---

## 🎯 Implementation Decision Matrix

### When to Use Each Component

| Scenario                     | Component to Use                           | Reason                  |
| ---------------------------- | ------------------------------------------ | ----------------------- |
| User login with password     | `AuthenticationManager` → `SessionManager` | Full auth flow          |
| API request authentication   | `APIKeyManager.validateAPIKey()`           | API key validation      |
| Check if session still valid | `SessionValidator.validateSession()`       | Session validation      |
| Create new user account      | `UserFacade.registerUser()`                | Complete registration   |
| Update user profile          | `UserFacade.updateUser()`                  | User management         |
| Change password              | `UserFacade.updatePassword()`              | Keycloak-only operation |
| Assign roles                 | `UserFacade.assignRealmRoles()`            | Role management         |
| Admin session termination    | `SessionManager.destroySession()`          | Admin operation         |
| Token expired, need refresh  | `SessionManager.refreshSessionTokens()`    | Token refresh           |
| Check system health          | `ResourceManager.checkHealth()`            | Monitoring              |

---

## 🚀 Quick Start Implementation Guide

### Scenario 1: Add API Key Support to Existing Service

**Current Code (Before)**:

```typescript
const integrationService = KeycloakIntegrationService.create(
  keycloakOptions,
  dbClient,
  metrics
);

// API keys not available!
```

**Updated Code (After)**:

```typescript
const integrationService = createIntegrationServiceBuilder()
  .withKeycloakOptions(keycloakOptions)
  .withDatabase(dbClient)
  .withCache(cacheService) // ← Add cache for better performance
  .withMetrics(metrics)
  .build();

await integrationService.initialize();

// Now API keys work!
const apiKey = await integrationService.createAPIKey({
  userId: "user-123",
  name: "Production API Key",
  scopes: ["read", "write"],
  permissions: ["users:read", "users:write"],
});

console.log(`API Key: ${apiKey.keyPreview}`);
```

---

### Scenario 2: Implement Complete User Registration

**Implementation**:

```typescript
import { createIntegrationServiceBuilder } from "@libs/keycloak-authV2";

// Build service with all features
const service = createIntegrationServiceBuilder()
  .withKeycloakOptions(keycloakOptions)
  .withDatabase(dbClient)
  .withCache(cacheService)
  .withMetrics(metrics)
  .withSyncService(syncService) // ← Enable async Keycloak sync
  .build();

// Register user
const user = await service.registerUser({
  username: "newuser",
  email: "user@example.com",
  password: "SecurePass123!",
  firstName: "John",
  lastName: "Doe",
  storeId: "store-123",
  roleId: "role-user",
});

// User is immediately available in local DB
console.log(`User created: ${user.id}`);

// Keycloak sync happens asynchronously in background
// Check sync status
const syncStatus = await service.getUserSyncStatus(user.id);
console.log(`Sync status: ${syncStatus.status}`);
```

---

### Scenario 3: Implement Session Management with Auto-Refresh

**Implementation**:

```typescript
const service = createIntegrationServiceBuilder()
  .withKeycloakOptions(keycloakOptions)
  .withDatabase(dbClient)
  .withCache(cacheService)
  .withMetrics(metrics)
  .build();

// Authenticate user
const authResult = await service.authenticateWithPassword(
  "username",
  "password",
  {
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  }
);

if (authResult.success) {
  const sessionId = authResult.session!.sessionId;

  // Store session ID in cookie/header
  res.cookie("sessionId", sessionId, { httpOnly: true });

  // On subsequent requests
  const validation = await service.validateSession(sessionId, {
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  if (validation.valid) {
    // Token automatically refreshed if near expiry
    if (validation.refreshed) {
      console.log("Token was automatically refreshed");
    }

    // Access user data
    const user = validation.session?.userInfo;
    console.log(`Authenticated as: ${user?.username}`);
  }
}
```

---

### Scenario 4: Implement Comprehensive Health Monitoring

**Implementation**:

```typescript
const service = createIntegrationServiceBuilder()
  .withKeycloakOptions(keycloakOptions)
  .withDatabase(dbClient)
  .withCache(cacheService)
  .withMetrics(metrics)
  .withSyncService(syncService)
  .build();

// Health check endpoint
app.get("/health", async (req, res) => {
  const health = await service.checkHealth();

  const statusCode =
    health.status === "healthy"
      ? 200
      : health.status === "degraded"
      ? 200
      : 503;

  res.status(statusCode).json({
    status: health.status,
    timestamp: health.details.timestamp,
    components: {
      keycloak: health.details.components.keycloakClient,
      database: health.details.components.database,
      cache: health.details.components.cache,
      sessions: health.details.components.sessionManager,
      apiKeys: health.details.components.apiKeyManager,
      userSync: health.details.components.userSync,
    },
    uptime: process.uptime(),
  });
});

// Detailed statistics endpoint
app.get("/stats", async (req, res) => {
  const stats = await service.getStats();

  res.json({
    sessions: stats.session,
    apiKeys: stats.apiKey,
    client: stats.client,
    tokens: stats.token,
  });
});
```

---

## 🔍 Debugging Guide

### Common Issues & Solutions

#### Issue 1: Cache Not Working

**Symptom**: Performance slower than expected, high DB load

**Diagnosis**:

```typescript
const health = await service.checkHealth();
console.log("Cache enabled:", health.details.components.cache?.enabled);
```

**Solution**:

```typescript
// Ensure cache service is provided
const service = createIntegrationServiceBuilder()
  .withCache(cacheService) // ← Don't forget this!
  .build();
```

---

#### Issue 2: User Sync Failing

**Symptom**: Users created in local DB but not in Keycloak

**Diagnosis**:

```typescript
const syncHealth = await service.getSyncHealthStatus();
console.log("Sync status:", syncHealth.overall);
console.log("Failed operations:", syncHealth.queue.metrics.failed);
```

**Solution**:

```typescript
// Retry failed operations
const retried = await service.retrySyncOperations(10);
console.log(`Retried ${retried} operations`);

// Or check individual user
const userSyncStatus = await service.getUserSyncStatus(userId);
if (userSyncStatus.status === "FAILED") {
  console.log("Sync failed for user:", userId);
}
```

---

#### Issue 3: Session Validation Failing

**Symptom**: Users getting logged out unexpectedly

**Diagnosis**:

```typescript
const validation = await service.validateSession(sessionId, context);
if (!validation.valid) {
  console.log("Validation failed:", validation.reason);
}
```

**Common Reasons**:

- Session expired: Token TTL passed
- Fingerprint mismatch: User changed browser/device
- Concurrent limit: Too many active sessions
- Security violation: Suspicious activity detected

---

## 📊 Performance Optimization Tips

### 1. Enable Caching

```typescript
const service = createIntegrationServiceBuilder()
  .withCache(cacheService) // 70%+ performance improvement
  .build();
```

### 2. Use API Keys for Service-to-Service

```typescript
// Instead of OAuth for every request
const apiKey = await service.createAPIKey({
  userId: "service-account",
  scopes: ["read", "write"],
});

// Validation is much faster (cached)
const validation = await service.validateAPIKey(apiKey.keyPreview);
```

### 3. Batch Operations

```typescript
// Instead of individual user lookups
const users = await service.searchUsers({
  storeId: "store-123",
  take: 100,
});
```

### 4. Monitor and Tune

```typescript
const stats = await service.getStats();
console.log(
  "Cache hit rate:",
  stats.token.cacheHits / (stats.token.cacheHits + stats.token.cacheMisses)
);
```

---

**Document Version**: 1.0.0  
**Last Updated**: October 7, 2025  
**Status**: ✅ Ready for Use
