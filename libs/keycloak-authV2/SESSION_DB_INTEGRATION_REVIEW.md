# Session Management - Database Integration Review

## 🔴 Critical Issues Identified

### 1. **Type Mismatch - Custom Types vs Database Models**

**Problem:** The session system uses custom `SessionData` types that don't align with the database schema and models.

#### Current Implementation (WRONG):

```typescript
// libs/keycloak-authV2/src/services/session/sessionTypes.ts
export interface SessionData {
  readonly id: string;
  readonly userId: string;
  readonly userInfo: UserInfo;
  readonly SessionId?: string | undefined; // ❌ Mismatch with DB
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  readonly idToken?: string | undefined;
  // ... custom fields
}
```

#### Database Model (CORRECT):

```typescript
// libs/database/src/models/user.ts
export interface UserSession {
  id: string;
  userId: string;
  storeId: string; // ✅ Required in DB
  sessionId: string; // ✅ Unique identifier
  token: string; // ✅ Session token
  keycloakSessionId?: string | null; // ✅ Proper nullable
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  tokenExpiresAt?: Date | null;
  refreshExpiresAt?: Date | null;
  fingerprint?: string | null;
  lastAccessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: unknown | null;
  isActive: boolean;
  endedAt?: Date | null;
  // Relations
  user?: User;
  events?: UserEvent[];
  logs?: SessionLog[];
  store?: Store;
  activities?: SessionActivity[];
}
```

**Issues:**

- ⚠️ Missing `storeId` (required in DB schema, but may need default/optional handling)
- ⚠️ Missing `token` (required in DB but needs special handling for Keycloak sessions)
- ❌ Missing `updatedAt` (required in DB)
- ❌ Missing `endedAt` (for session termination tracking)
- ❌ Field name mismatch: `SessionId` vs `keycloakSessionId`
- ❌ No relation support for `user`, `logs`, `events`, `activities`
- ❌ Type inconsistency: `string | undefined` vs `string | null`

**Note:** While `storeId` and `token` are marked as required in the Prisma schema, for Keycloak sessions, these fields need special handling (default values or schema update to make them nullable).

---

### 2. **Not Using Repository Pattern**

**Problem:** `SessionStore` directly executes raw SQL and bypasses the repository system.

#### Current Implementation (WRONG):

```typescript
// libs/keycloak-authV2/src/services/session/SessionStore.ts
await this.dbClient.executeRaw(`INSERT INTO user_sessions (...) VALUES (...)`, [
  /* raw parameters */
]);
```

#### Should Use (CORRECT):

```typescript
// libs/database/src/postgress/repositories/userSession.ts
export class UserSessionRepository extends BaseRepository<
  UserSession,
  UserSessionCreateInput,
  UserSessionUpdateInput
> {
  async create(data: UserSessionCreateInput): Promise<UserSession>;
  async findById(id: string): Promise<UserSession | null>;
  async findBySessionToken(sessionToken: string): Promise<UserSession | null>;
  async findActiveByUserId(userId: string): Promise<UserSession[]>;
  async updateLastActivity(id: string): Promise<UserSession>;
  async invalidateSession(id: string): Promise<UserSession>;
  // ... 10+ more specialized methods
}
```

**Repository Benefits:**

- ✅ Type safety with Prisma types
- ✅ Transaction support
- ✅ Metrics collection
- ✅ Error handling
- ✅ Cache integration
- ✅ Batch operations
- ✅ Relation loading
- ✅ Query optimization

---

### 3. **Missing Repository Integration**

The database already provides comprehensive repositories that should be used:

#### Available Repositories:

1. **`UserSessionRepository`** - Main session CRUD

   - `findByUserId()`, `findActiveByUserId()`
   - `findBySessionToken()`
   - `updateLastActivity()`
   - `invalidateSession()`, `invalidateAllUserSessions()`
   - `cleanupExpiredSessions()`

2. **`SessionLogRepository`** - Session event logging

   - `findBySessionId()`
   - `findByEvent()`
   - `getSessionActivitySummary()`
   - `cleanupOldLogs()`

3. **`SessionActivityRepository`** - Activity tracking
   - `findBySessionId()`
   - `findByStoreId()`
   - `findByActivity()`

**These repositories are NOT being used!**

---

## 📋 Detailed Comparison

### Field Mapping Issues

| Custom SessionData | DB UserSession      | Status     | Issue                                                   |
| ------------------ | ------------------- | ---------- | ------------------------------------------------------- |
| `id`               | `sessionId`         | ❌ Wrong   | Should use `sessionId` as unique identifier             |
| -                  | `id`                | ❌ Missing | DB primary key not mapped                               |
| `SessionId`        | `keycloakSessionId` | ❌ Wrong   | Incorrect field name                                    |
| -                  | `token`             | ⚠️ Special | Required in DB but not for Keycloak sessions            |
| -                  | `storeId`           | ⚠️ Special | Required in DB but needs default for non-store sessions |
| -                  | `updatedAt`         | ❌ Missing | Required field                                          |
| -                  | `endedAt`           | ❌ Missing | Session termination tracking                            |
| `userInfo`         | Relations           | ❌ Wrong   | Should use `user` relation                              |
| `metadata`         | `metadata`          | ⚠️ Partial | Type mismatch: `Record<string, any>` vs `unknown`       |

### Type Safety Issues

```typescript
// ❌ Current: Loose typing
interface SessionData {
  accessToken?: string | undefined; // Inconsistent with DB
  metadata?: Record<string, any>; // Should be unknown
}

// ✅ Should be: Strict typing from DB
interface UserSession {
  accessToken?: string | null; // Matches Prisma nullable
  metadata?: unknown | null; // Type-safe unknown
}
```

---

## 🔧 Recommended Refactoring

### Phase 1: Type Alignment

**Action:** Replace custom `SessionData` with database `UserSession` type.

```typescript
// libs/keycloak-authV2/src/services/session/sessionTypes.ts

// ❌ Remove custom types
// export interface SessionData { ... }

// ✅ Use database types
export type {
  UserSession as SessionData,
  UserSessionCreateInput as SessionCreateInput,
  UserSessionUpdateInput as SessionUpdateInput,
  SessionLog,
  SessionActivity,
} from "@libs/database/models";

// ✅ Keep validation schemas but align with DB types
export const SessionDataSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  storeId: z.string().uuid(),
  sessionId: z.string().min(1),
  token: z.string().min(1),
  keycloakSessionId: z.string().nullable().optional(),
  accessToken: z.string().nullable().optional(),
  refreshToken: z.string().nullable().optional(),
  // ... match DB schema exactly
});
```

### Phase 2: Repository Integration

**Action:** Replace `SessionStore` with repository delegation.

```typescript
// libs/keycloak-authV2/src/services/session/SessionStore.ts

import { UserSessionRepository } from "@libs/database/repositories";
import { SessionLogRepository } from "@libs/database/repositories";

export class SessionStore {
  constructor(
    private readonly userSessionRepo: UserSessionRepository,
    private readonly sessionLogRepo: SessionLogRepository,
    private readonly cacheService?: CacheService,
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector
  ) {
    // ...
  }

  // ✅ Delegate to repository
  async storeSession(sessionData: UserSession): Promise<void> {
    const startTime = performance.now();

    try {
      // Use repository instead of raw SQL
      await this.userSessionRepo.create({
        userId: sessionData.userId,
        storeId: sessionData.storeId,
        sessionId: sessionData.sessionId,
        token: sessionData.token,
        keycloakSessionId: sessionData.keycloakSessionId,
        accessToken: sessionData.accessToken,
        refreshToken: sessionData.refreshToken,
        // ... all required fields
      });

      // Cache if enabled
      if (this.cacheService && this.config.cacheEnabled) {
        await this.cacheService.set(
          this.getCacheKey(sessionData.sessionId),
          sessionData,
          this.config.defaultCacheTTL
        );
      }

      this.metrics?.recordTimer(
        "session.store.duration",
        performance.now() - startTime
      );
    } catch (error) {
      this.logger.error("Failed to store session", { error });
      throw error;
    }
  }

  // ✅ Delegate retrieval
  async retrieveSession(sessionId: string): Promise<UserSession | null> {
    // Check cache first
    if (this.cacheService && this.config.cacheEnabled) {
      const cached = await this.cacheService.get<UserSession>(
        this.getCacheKey(sessionId)
      );
      if (cached) return cached;
    }

    // Use repository
    const session = await this.userSessionRepo.findBySessionToken(sessionId);

    // Cache result
    if (session && this.cacheService) {
      await this.cacheService.set(
        this.getCacheKey(sessionId),
        session,
        this.config.defaultCacheTTL
      );
    }

    return session;
  }

  // ✅ Delegate user sessions retrieval
  async getUserSessions(userId: string): Promise<UserSession[]> {
    return this.userSessionRepo.findActiveByUserId(userId);
  }

  // ✅ Delegate session invalidation
  async markSessionInactive(sessionId: string, reason: string): Promise<void> {
    await this.userSessionRepo.invalidateSession(sessionId);

    // Log the event
    await this.sessionLogRepo.create({
      sessionId,
      event: "session_ended",
      metadata: { reason },
    });
  }
}
```

### Phase 3: SessionManager Updates

**Action:** Update `SessionManager` to work with DB types.

```typescript
// libs/keycloak-authV2/src/services/session/SessionManager.ts

import type {
  UserSession,
  UserSessionCreateInput,
} from "@libs/database/models";
import {
  UserSessionRepository,
  SessionLogRepository,
} from "@libs/database/repositories";

export class SessionManager {
  private readonly userSessionRepo: UserSessionRepository;
  private readonly sessionLogRepo: SessionLogRepository;

  constructor(
    private readonly tokenManager: ITokenManager,
    private readonly dbClient: PostgreSQLClient,
    private readonly keycloakClient: KeycloakClient,
    private readonly cacheService?: CacheService,
    private readonly metrics?: IMetricsCollector,
    config: Partial<SessionManagerConfig> = {}
  ) {
    // Initialize repositories
    this.userSessionRepo = new UserSessionRepository(
      dbClient,
      metrics,
      cacheService
    );
    this.sessionLogRepo = new SessionLogRepository(
      dbClient,
      metrics,
      cacheService
    );

    // Initialize SessionStore with repositories
    this.sessionStore = new SessionStore(
      this.userSessionRepo,
      this.sessionLogRepo,
      cacheService,
      this.logger.child({ component: "SessionStore" }),
      metrics,
      config.sessionStore
    );

    // ... rest of initialization
  }

  async createSession(
    userId: string,
    storeId: string, // ✅ Now required
    tokens: {
      accessToken: string;
      refreshToken?: string;
      idToken?: string;
      expiresAt: Date;
    },
    requestContext: {
      ipAddress: string;
      userAgent: string;
    }
  ): Promise<AuthResult> {
    // Create proper UserSession data
    const sessionData: UserSessionCreateInput = {
      userId,
      storeId, // ✅ Required field
      sessionId: crypto.randomUUID(),
      token: crypto.randomUUID(), // ✅ Session token
      keycloakSessionId: tokens.keycloakSessionId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      tokenExpiresAt: tokens.expiresAt,
      fingerprint: this.generateFingerprint(requestContext),
      lastAccessedAt: new Date(),
      expiresAt: tokens.expiresAt,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
      isActive: true,
    };

    // Delegate to SessionStore (which uses repository)
    await this.sessionStore.storeSession(sessionData);

    return {
      success: true,
      sessionId: sessionData.sessionId,
      expiresAt: sessionData.expiresAt,
    };
  }
}
```

---

## 🎯 Benefits of Refactoring

### 1. **Type Safety**

- ✅ Full Prisma type checking
- ✅ No type casting or `as` assertions
- ✅ Compile-time error detection
- ✅ Better IDE autocomplete

### 2. **Code Reusability**

- ✅ Leverage existing repositories
- ✅ Consistent data access patterns
- ✅ Shared transaction logic
- ✅ Centralized error handling

### 3. **Maintainability**

- ✅ Single source of truth (DB schema)
- ✅ Automatic schema updates via Prisma
- ✅ Easier to modify session structure
- ✅ Better separation of concerns

### 4. **Features**

- ✅ Relation loading (`user`, `logs`, `activities`)
- ✅ Transaction support
- ✅ Batch operations
- ✅ Metrics collection
- ✅ Cache integration
- ✅ Query optimization

### 5. **Keycloak Integration**

- ✅ Proper session identification via `sessionId`
- ✅ Keycloak session tracking via `keycloakSessionId`
- ✅ Token management and refresh
- ✅ Integration with auth middleware

---

## 📊 Migration Checklist

### Immediate Actions

- [ ] **Replace custom `SessionData` with `UserSession`**

  - Update all type imports
  - Fix field name mismatches
  - Add missing required fields

- [ ] **Integrate repository pattern**

  - Replace raw SQL with repository calls
  - Remove manual query construction
  - Use typed methods

- [ ] **Update SessionStore**

  - Accept repository instances
  - Delegate CRUD operations
  - Keep cache logic

- [ ] **Update SessionManager**

  - Initialize repositories
  - Pass `storeId` parameter
  - Use `token` field for auth

- [ ] **Fix SessionTokenCoordinator**
  - Update token field references
  - Use proper session identification
  - Align with Keycloak patterns

### Testing Updates

- [ ] Update unit tests with proper types
- [ ] Mock repositories instead of dbClient
- [ ] Test relation loading
- [ ] Test transaction scenarios
- [ ] Verify cache integration

### Documentation Updates

- [ ] Update architecture docs
- [ ] Add repository usage examples
- [ ] Document type mappings
- [ ] Update migration guides

---

## 🚨 Breaking Changes

### API Changes

```typescript
// ❌ Old API
sessionManager.createSession(userId, tokens, requestContext);

// ✅ New API
sessionManager.createSession(
  userId,
  storeId, // Added
  tokens,
  requestContext
);
```

---

## 💡 Recommendations

1. **Phase the migration:**

   - Start with types
   - Then repositories
   - Finally SessionManager

2. **Test extensively:**

   - Unit tests with mocked repositories
   - Integration tests with real DB
   - E2E tests with auth flows

3. **Update incrementally:**

   - Keep old code until new code is tested
   - Use feature flags if needed
   - Migrate one component at a time

4. **Monitor in production:**
   - Track repository metrics
   - Monitor cache hit rates
   - Watch for type errors

---

## 📝 Summary

**Current State:** ❌

- Custom types not aligned with DB schema
- Raw SQL instead of repositories
- Missing required fields
- No relation support
- Type safety issues

**Target State:** ✅

- Use database `UserSession` types
- Leverage repository pattern
- Full type safety
- Relation support
- Keycloak compatible
- Consistent with codebase patterns

**Effort:** Medium (2-3 days)

- Type replacement: 1 day
- Repository integration: 1 day
- Testing & validation: 1 day

**Risk:** Low

- Well-defined repositories exist
- Clear migration path
- Testable changes
- Incremental rollout possible
