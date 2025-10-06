# Session Management - Handling Required DB Fields

## 🎯 Problem: Schema Constraints vs Business Logic

### Database Schema Reality

```prisma
model UserSession {
  id       String @id @default(cuid())
  userId   String  // ✅ Required
  storeId  String  // ⚠️ Required in schema but not all sessions have a store
  sessionId String @unique  // ✅ Required
  token    String @unique  // ⚠️ Required in schema but only for Better-Auth
  // ... other fields
}
```

### Business Requirements

- **Keycloak Sessions**: Don't need `storeId` or Better-Auth `token`
- **Better-Auth Sessions**: Need `token` field, may or may not have `storeId`
- **Store-based Sessions**: Need `storeId` for multi-tenant scenarios

## 💡 Solution Options

### Option 1: Use Default/Placeholder Values (Recommended)

**Approach:** Provide sensible defaults for required fields when not applicable.

```typescript
// libs/keycloak-authV2/src/services/session/SessionStore.ts

export class SessionStore {
  private readonly DEFAULT_STORE_ID = "00000000-0000-0000-0000-000000000000"; // System default
  private readonly DEFAULT_TOKEN_PREFIX = "keycloak_"; // Not used by Better-Auth

  async storeSession(sessionData: UserSession): Promise<void> {
    const dbData: UserSessionCreateInput = {
      // Required fields
      userId: sessionData.userId,
      sessionId: sessionData.sessionId,

      // Handle optional but DB-required fields
      storeId: sessionData.storeId || this.DEFAULT_STORE_ID,
      token:
        sessionData.token ||
        `${this.DEFAULT_TOKEN_PREFIX}${sessionData.sessionId}`,

      // Optional fields
      keycloakSessionId: sessionData.keycloakSessionId,
      accessToken: sessionData.accessToken,
      refreshToken: sessionData.refreshToken,
      // ... rest of fields
    };

    await this.userSessionRepo.create(dbData);
  }
}
```

**Pros:**

- ✅ No schema changes needed
- ✅ Works immediately
- ✅ Compatible with existing data
- ✅ Clear defaults

**Cons:**

- ⚠️ Placeholder data in DB
- ⚠️ Need to filter out defaults in queries

---

### Option 2: Make Schema Fields Nullable (Requires Migration)

**Approach:** Update Prisma schema to make fields optional.

```prisma
model UserSession {
  id       String  @id @default(cuid())
  userId   String
  storeId  String? // ✅ Made optional
  sessionId String @unique
  token    String? @unique // ✅ Made optional
  // ... other fields
}
```

**Migration required:**

```sql
-- Make fields nullable
ALTER TABLE user_sessions ALTER COLUMN store_id DROP NOT NULL;
ALTER TABLE user_sessions ALTER COLUMN token DROP NOT NULL;

-- Drop unique constraint on token if it allows nulls
DROP INDEX user_sessions_token_key;
CREATE UNIQUE INDEX user_sessions_token_key ON user_sessions(token) WHERE token IS NOT NULL;
```

**Pros:**

- ✅ Cleaner data model
- ✅ No placeholder values
- ✅ More accurate representation

**Cons:**

- ❌ Requires schema migration
- ❌ May break existing Better-Auth integration
- ❌ Need to handle null in foreign key relations

---

### Option 3: Discriminated Sessions (Advanced)

**Approach:** Use session type field to differentiate between session types.

```prisma
model UserSession {
  id          String      @id @default(cuid())
  sessionType SessionType @default(KEYCLOAK) // KEYCLOAK | BETTER_AUTH | STORE
  userId      String
  storeId     String?     // Required only if sessionType = STORE
  token       String?     // Required only if sessionType = BETTER_AUTH
  // ... other fields
}

enum SessionType {
  KEYCLOAK
  BETTER_AUTH
  STORE
}
```

**Implementation:**

```typescript
export type SessionVariant =
  | { type: "keycloak"; keycloakSessionId: string }
  | { type: "betterAuth"; token: string }
  | { type: "store"; storeId: string; token?: string };

export class SessionStore {
  async storeSession(
    baseData: BaseSessionData,
    variant: SessionVariant
  ): Promise<void> {
    const dbData: UserSessionCreateInput = {
      ...baseData,
      sessionType: variant.type.toUpperCase(),

      // Conditional fields based on type
      ...(variant.type === "keycloak" && {
        keycloakSessionId: variant.keycloakSessionId,
        storeId: this.DEFAULT_STORE_ID,
        token: `keycloak_${baseData.sessionId}`,
      }),

      ...(variant.type === "betterAuth" && {
        token: variant.token,
        storeId: this.DEFAULT_STORE_ID,
      }),

      ...(variant.type === "store" && {
        storeId: variant.storeId,
        token: variant.token || `store_${baseData.sessionId}`,
      }),
    };

    await this.userSessionRepo.create(dbData);
  }
}
```

**Pros:**

- ✅ Type-safe session variants
- ✅ Clear business logic
- ✅ Flexible for future session types

**Cons:**

- ❌ More complex implementation
- ❌ Requires enum type in schema
- ❌ Still needs defaults or nullable fields

---

## 🎯 Recommended Approach: **Option 1 with Type Helpers**

### Implementation Strategy

```typescript
// libs/keycloak-authV2/src/services/session/sessionTypes.ts

import type {
  UserSession,
  UserSessionCreateInput,
} from "@libs/database/models";

/**
 * Session creation options with smart defaults
 */
export interface SessionCreationOptions {
  userId: string;
  sessionId: string;

  // Keycloak-specific
  keycloakSessionId?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  tokenExpiresAt?: Date;

  // Better-Auth specific (optional)
  betterAuthToken?: string;

  // Store-specific (optional)
  storeId?: string;

  // Common fields
  fingerprint?: string;
  ipAddress?: string;
  userAgent?: string;
  expiresAt?: Date;
  metadata?: unknown;
}

/**
 * Convert creation options to database input with smart defaults
 */
export function toUserSessionCreateInput(
  options: SessionCreationOptions
): UserSessionCreateInput {
  const DEFAULT_STORE_ID = "00000000-0000-0000-0000-000000000000";

  return {
    userId: options.userId,
    sessionId: options.sessionId,

    // Smart defaults for required fields
    storeId: options.storeId || DEFAULT_STORE_ID,
    token: options.betterAuthToken || `keycloak_${options.sessionId}`,

    // Optional fields
    keycloakSessionId: options.keycloakSessionId || null,
    accessToken: options.accessToken || null,
    refreshToken: options.refreshToken || null,
    idToken: options.idToken || null,
    tokenExpiresAt: options.tokenExpiresAt || null,
    fingerprint: options.fingerprint || null,
    ipAddress: options.ipAddress || null,
    userAgent: options.userAgent || null,
    expiresAt: options.expiresAt || null,
    metadata: options.metadata || null,

    // Defaults
    isActive: true,
    lastAccessedAt: new Date(),
  };
}

/**
 * Check if session uses default store
 */
export function isDefaultStore(storeId: string): boolean {
  return storeId === "00000000-0000-0000-0000-000000000000";
}

/**
 * Check if session uses Better-Auth token
 */
export function isBetterAuthSession(token: string): boolean {
  return !token.startsWith("keycloak_") && !token.startsWith("store_");
}
```

### Updated SessionStore

```typescript
// libs/keycloak-authV2/src/services/session/SessionStore.ts

import { UserSessionRepository } from "@libs/database/repositories";
import {
  toUserSessionCreateInput,
  type SessionCreationOptions,
} from "./sessionTypes";

export class SessionStore {
  constructor(
    private readonly userSessionRepo: UserSessionRepository,
    private readonly sessionLogRepo: SessionLogRepository,
    private readonly cacheService?: CacheService,
    logger?: ILogger,
    private readonly metrics?: IMetricsCollector
  ) {
    this.logger = logger || createLogger("SessionStore");
  }

  /**
   * Store session with smart defaults for required fields
   */
  async storeSession(options: SessionCreationOptions): Promise<UserSession> {
    const startTime = performance.now();

    try {
      this.logger.debug("Storing session", {
        sessionId: options.sessionId,
        userId: options.userId,
        hasStore: !!options.storeId,
        hasBetterAuthToken: !!options.betterAuthToken,
      });

      // Convert to DB input with smart defaults
      const dbData = toUserSessionCreateInput(options);

      // Use repository
      const session = await this.userSessionRepo.create(dbData);

      // Cache if enabled
      if (this.cacheService && this.config.cacheEnabled) {
        await this.cacheService.set(
          this.getCacheKey(options.sessionId),
          session,
          this.config.defaultCacheTTL
        );
      }

      this.metrics?.recordTimer(
        "session.store.duration",
        performance.now() - startTime
      );

      return session;
    } catch (error) {
      this.logger.error("Failed to store session", { error });
      throw error;
    }
  }

  /**
   * Retrieve session by sessionId
   */
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

    if (session && this.cacheService) {
      await this.cacheService.set(
        this.getCacheKey(sessionId),
        session,
        this.config.defaultCacheTTL
      );
    }

    return session;
  }

  /**
   * Get user sessions (excluding default store placeholder)
   */
  async getUserSessions(userId: string): Promise<UserSession[]> {
    const sessions = await this.userSessionRepo.findActiveByUserId(userId);

    // Optionally filter out default store sessions in response
    // Or keep them - depends on your use case
    return sessions;
  }
}
```

### Updated SessionManager

```typescript
// libs/keycloak-authV2/src/services/session/SessionManager.ts

import type { SessionCreationOptions } from "./sessionTypes";

export class SessionManager {
  async createSession(
    userId: string,
    tokens: {
      accessToken: string;
      refreshToken?: string;
      idToken?: string;
      expiresAt: Date;
    },
    requestContext: {
      ipAddress: string;
      userAgent: string;
      fingerprint?: Record<string, string>;
    },
    // Optional parameters
    options?: {
      storeId?: string; // Only if needed
      betterAuthToken?: string; // Only for Better-Auth
    }
  ): Promise<AuthResult> {
    const context = this.createOperationContext("create_session", { userId });

    try {
      // ... security checks ...

      // Create session options
      const sessionOptions: SessionCreationOptions = {
        userId,
        sessionId: crypto.randomUUID(),
        keycloakSessionId: crypto.randomUUID(), // Or from Keycloak
        accessToken: await this.encryptionManager.encryptCompact(
          tokens.accessToken
        ),
        refreshToken: tokens.refreshToken
          ? await this.encryptionManager.encryptCompact(tokens.refreshToken)
          : undefined,
        idToken: tokens.idToken
          ? await this.encryptionManager.encryptCompact(tokens.idToken)
          : undefined,
        tokenExpiresAt: tokens.expiresAt,
        fingerprint: this.generateFingerprint(requestContext),
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
        expiresAt: tokens.expiresAt,

        // Optional: only if provided
        storeId: options?.storeId,
        betterAuthToken: options?.betterAuthToken,
      };

      // Delegate to SessionStore (handles defaults)
      const session = await this.sessionStore.storeSession(sessionOptions);

      this.logger.info("Session created successfully", {
        operationId: context.operationId,
        sessionId: session.sessionId,
        userId,
      });

      return {
        success: true,
        sessionId: session.sessionId,
        expiresAt: session.expiresAt || undefined,
        token: session.token, // Return for Better-Auth if needed
      };
    } catch (error) {
      this.logger.error("Session creation failed", { error });
      return {
        success: false,
        reason: "Session creation failed",
      };
    }
  }
}
```

---

## 📊 Benefits of This Approach

### 1. **No Schema Changes**

- ✅ Works with existing database
- ✅ No migrations required
- ✅ Backward compatible

### 2. **Flexible API**

- ✅ Optional `storeId` and `betterAuthToken`
- ✅ Smart defaults applied transparently
- ✅ Type-safe with helper functions

### 3. **Clear Semantics**

- ✅ Helper functions identify session types
- ✅ Easy to query real vs default values
- ✅ Logging shows which fields are provided

### 4. **Repository Integration**

- ✅ Uses existing `UserSessionRepository`
- ✅ Full type safety
- ✅ Transaction support
- ✅ Relation loading

---

## 🔄 Migration Path

### Step 1: Add Helper Functions

```typescript
// Add toUserSessionCreateInput() and helpers
// Update sessionTypes.ts
```

### Step 2: Update SessionStore

```typescript
// Change storeSession() signature
// Use helper for DB input
// Keep repository integration
```

### Step 3: Update SessionManager

```typescript
// Make storeId/token optional in createSession()
// Pass through to SessionStore
```

### Step 4: Test

```typescript
// Test Keycloak sessions (no store, no token)
// Test Better-Auth sessions (with token)
// Test Store sessions (with storeId)
```

---

## 📝 Summary

**Approach:** Smart defaults for required DB fields

- `storeId`: Defaults to `00000000-0000-0000-0000-000000000000` (system store)
- `token`: Defaults to `keycloak_{sessionId}` for non-Better-Auth sessions

**Benefits:**

- ✅ No schema changes
- ✅ Optional parameters in API
- ✅ Repository pattern maintained
- ✅ Type-safe with helpers
- ✅ Clear session type identification

**Implementation Time:** ~4 hours

- Helper functions: 1 hour
- SessionStore update: 1 hour
- SessionManager update: 1 hour
- Testing: 1 hour

This approach gives you the flexibility you need while working within the existing schema constraints! 🎯
