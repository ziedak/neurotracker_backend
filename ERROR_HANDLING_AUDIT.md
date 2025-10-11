# Error Handling Audit - Silent Failure Analysis

## Executive Summary

🚨 **CRITICAL FINDINGS**: 3 silent failure patterns identified that can cause tests to pass while masking real errors

✅ **CRITICAL OPERATIONS**: All properly throw errors (token storage, session creation)
⚠️ **NON-CRITICAL OPERATIONS**: Some return default values on error (needs review)

---

## 1. Silent Failure Patterns Identified

### ❌ Pattern 1: `retrieveSession()` - Returns `null` on Error

**Location**: `libs/keycloak-authV2/src/services/session/SessionStore.ts:394-403`

```typescript
async retrieveSession(
  sessionId: string,
  includeTokens = false
): Promise<UserSession | null> {
  try {
    // ... database query logic ...
  } catch (error) {
    this.logger.error("Failed to retrieve session", {
      operationId,
      error,
      sessionId: this.hashSessionId(sessionId),
    });
    this.metrics?.recordCounter("session.retrieve.error", 1);
    return null;  // ⚠️ SILENT FAILURE - Prisma error becomes null
  }
}
```

**Problem**:

- If Prisma throws an error (connection lost, schema mismatch, query error), it's logged but returns `null`
- Caller interprets `null` as "session not found" instead of "database error"
- Tests checking for `null` will pass even if database is broken

**Impact**: **HIGH** - Authentication broken but tests pass

**Example Test That Would Fail Silently**:

```typescript
// Test passes even if Prisma is broken
const session = await sessionStore.retrieveSession("session-123");
expect(session).toBeNull(); // ✅ Passes (but for wrong reason!)
```

**Recommendation**: **DIFFERENTIATE** between "not found" and "error":

```typescript
async retrieveSession(
  sessionId: string,
  includeTokens = false
): Promise<UserSession | null> {
  try {
    const session = await this.userSessionRepo.findBySessionToken(sessionId);

    // Not found is OK - return null
    if (!session || !session.isActive) {
      return null;
    }

    // ... rest of logic ...
    return session;
  } catch (error) {
    this.logger.error("Database error retrieving session", { error, sessionId });
    this.metrics?.recordCounter("session.retrieve.database_error", 1);
    throw new Error(`Failed to retrieve session: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
```

---

### ❌ Pattern 2: `getUserSessions()` - Returns Empty Array on Error

**Location**: `libs/keycloak-authV2/src/services/session/SessionStore.ts:573-580`

```typescript
async getUserSessions(userId: string): Promise<UserSession[]> {
  try {
    const sessions = await this.userSessionRepo.findActiveByUserId(userId, {
      orderBy: { lastAccessedAt: "desc" },
    });
    return sessions;
  } catch (error) {
    this.logger.error("Failed to retrieve user sessions", {
      operationId,
      error,
      userId,
    });
    this.metrics?.recordCounter("session.get_user_sessions.error", 1);
    return [];  // ⚠️ SILENT FAILURE - Database error becomes empty array
  }
}
```

**Problem**:

- Prisma error masked as "user has no sessions"
- Tests expecting empty array will pass even if database is broken
- Callers can't distinguish between "no sessions" and "database failure"

**Impact**: **MEDIUM** - Concurrent session limit check may fail silently

**Recommendation**: **THROW** on database errors:

```typescript
async getUserSessions(userId: string): Promise<UserSession[]> {
  try {
    const sessions = await this.userSessionRepo.findActiveByUserId(userId, {
      orderBy: { lastAccessedAt: "desc" },
    });
    return sessions; // Empty array is valid (user has no sessions)
  } catch (error) {
    this.logger.error("Database error retrieving user sessions", { error, userId });
    this.metrics?.recordCounter("session.get_user_sessions.database_error", 1);
    throw new Error(`Failed to retrieve user sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
```

---

### ❌ Pattern 3: `getActiveSessionCount()` - Returns `0` on Error

**Location**: `libs/keycloak-authV2/src/services/session/SessionStore.ts:889-892`

```typescript
async getActiveSessionCount(
  userId: string,
  deviceFingerprint?: string
): Promise<number> {
  try {
    // ... cache and database logic ...
    return count;
  } catch (error) {
    this.logger.error("Failed to get active session count", {
      userId,
      error,
    });
    return 0;  // ⚠️ SILENT FAILURE - Database error becomes "no sessions"
  }
}
```

**Problem**:

- **CRITICAL**: Concurrent session limit check relies on this
- If database error occurs, returns `0` → concurrent limit never enforced
- User can create unlimited sessions when database is having issues

**Impact**: **HIGH** - Security control bypassed on database errors

**Recommendation**: **THROW** on database errors (security-critical operation):

```typescript
async getActiveSessionCount(
  userId: string,
  deviceFingerprint?: string
): Promise<number> {
  const cacheKey = `session:count:${userId}:${deviceFingerprint || "all"}`;

  try {
    // Try cache first
    if (this.cacheService && this.config.cacheEnabled) {
      const cached = await this.cacheService.get<number>(cacheKey);
      if (cached.data !== null) {
        return cached.data;
      }
    }

    // Query database
    const count = await this.userSessionRepo.count({
      where: {
        userId,
        isActive: true,
        expiresAt: { gt: new Date() },
        ...(deviceFingerprint && { fingerprint: deviceFingerprint }),
      },
    });

    // Cache result
    if (this.cacheService && this.config.cacheEnabled) {
      await this.cacheService.set(cacheKey, count, 30);
    }

    return count;
  } catch (error) {
    this.logger.error("Database error getting session count", { userId, error });
    this.metrics?.recordCounter("session.count.database_error", 1);
    // Security-critical: Don't allow sessions if we can't count them
    throw new Error(`Failed to get active session count: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
```

---

## 2. Acceptable Silent Failures (Non-Critical)

### ✅ Pattern: `updateSessionAccess()` - Silent Failure is OK

**Location**: `libs/keycloak-authV2/src/services/session/SessionStore.ts:444-447`

```typescript
async updateSessionAccess(sessionId: string): Promise<void> {
  try {
    // Update last access time
  } catch (error) {
    this.logger.warn("Failed to update session access time", {
      error,
      sessionId: this.hashSessionId(sessionId),
    });
    // Don't throw - this is not critical for session functionality
  }
}
```

**Why Acceptable**:

- Updating access time is **performance optimization**, not critical
- Session still works if access time update fails
- Doesn't affect authentication/authorization
- Logged for debugging

✅ **VERDICT**: Acceptable silent failure

---

### ✅ Pattern: `invalidateSessionCache()` - Silent Failure is OK

**Location**: `libs/keycloak-authV2/src/services/session/SessionStore.ts:717-720`

```typescript
async invalidateSessionCache(sessionId: string): Promise<void> {
  if (this.cacheService && this.config.cacheEnabled) {
    try {
      await Promise.all([
        this.cacheService.invalidate(this.buildSessionCacheKey(sessionId)),
        this.cacheService.invalidate(this.buildValidationCacheKey(sessionId)),
      ]);
    } catch (error) {
      this.logger.warn("Failed to invalidate session cache", {
        error,
        sessionId: this.hashSessionId(sessionId),
      });
      // Don't throw - cache invalidation failure is not critical
    }
  }
}
```

**Why Acceptable**:

- Cache is **performance optimization**, not source of truth
- Stale cache will eventually expire (TTL)
- Database remains consistent
- Session still works without cache

✅ **VERDICT**: Acceptable silent failure

---

### ⚠️ Pattern: `markSessionInactive()` Vault Cleanup - Partially OK

**Location**: `libs/keycloak-authV2/src/services/session/SessionStore.ts:607-621`

```typescript
async markSessionInactive(sessionId: string, reason: string): Promise<void> {
  try {
    const session = await this.userSessionRepo.findBySessionToken(sessionId);
    if (session) {
      // Clear tokens from vault before marking session inactive
      if (session.accountId) {
        try {
          await this.accountService.clearTokens(session.accountId);
          this.logger.info("Tokens cleared from vault on session termination");
        } catch (error) {
          this.logger.error("Failed to clear tokens from vault", { error });
          // Continue to mark session inactive even if vault cleanup fails
        }
      }

      await this.userSessionRepo.updateById(session.id, {
        isActive: false,
      });
    }
  } catch (error) {
    this.logger.error("Failed to mark session inactive", { error });
    this.metrics?.recordCounter("session.mark_inactive.error", 1);
    throw error;  // ✅ Re-throws outer error
  }
}
```

**Analysis**:

- **Inner try/catch** (vault cleanup): Silent failure acceptable - session still terminates
- **Outer try/catch**: Properly throws - session termination failure must be known

⚠️ **CONCERN**: Orphaned tokens in vault if cleanup fails repeatedly

**Recommendation**: Add cleanup job to detect orphaned tokens:

```typescript
// Background job to cleanup orphaned vault entries
async cleanupOrphanedVaultTokens(): Promise<number> {
  // Find Account records with no active UserSession
  const orphanedAccounts = await this.accountRepo.findOrphaned();

  for (const account of orphanedAccounts) {
    await this.accountService.clearTokens(account.id);
  }

  return orphanedAccounts.length;
}
```

---

## 3. Critical Operations - Error Handling Verified

### ✅ `storeTokens()` - Properly Throws

```typescript
async storeTokens(input: TokenVaultInput): Promise<string> {
  try {
    // Encrypt and store tokens
    return account.id;
  } catch (error) {
    this.metrics?.recordCounter("account.store_tokens_error", 1);
    this.logger.error("Failed to store tokens", { error, userId: input.userId });
    throw new Error("Failed to store tokens in vault");  // ✅ THROWS
  }
}
```

✅ **VERDICT**: Correct - token storage failure must fail loudly

---

### ✅ `getTokens()` - Properly Throws

```typescript
async getTokens(accountId: string): Promise<TokenVaultData | null> {
  try {
    const tokenData = await this.accountRepo.getTokens(accountId);

    if (!tokenData || !tokenData.accessToken) {
      this.logger.warn("No tokens found in vault", { accountId });
      return null;  // ✅ Not found is OK
    }

    // Decrypt and return
    return result;
  } catch (error) {
    this.metrics?.recordCounter("account.get_tokens_error", 1);
    this.logger.error("Failed to retrieve tokens", { error, accountId });
    throw new Error("Failed to retrieve tokens from vault");  // ✅ THROWS
  }
}
```

✅ **VERDICT**: Correct - distinguishes "not found" (null) from "error" (throw)

---

### ✅ `updateTokens()` - Properly Throws

```typescript
async updateTokens(input: TokenUpdateInput): Promise<void> {
  try {
    // Encrypt and update
  } catch (error) {
    this.metrics?.recordCounter("account.update_tokens_error", 1);
    this.logger.error("Failed to update tokens", { error, accountId: input.accountId });
    throw new Error("Failed to update tokens in vault");  // ✅ THROWS
  }
}
```

✅ **VERDICT**: Correct - token update failure must fail loudly

---

### ✅ `storeSession()` - Properly Throws

```typescript
async storeSession(sessionData: UserSession | SessionCreationOptions): Promise<UserSession> {
  try {
    // Create session with vault
    return createdSession;
  } catch (error) {
    this.logger.error("Failed to store session", { error, sessionId });
    this.metrics?.recordCounter("session.store.error", 1);
    throw error;  // ✅ RE-THROWS (preserves original error)
  }
}
```

✅ **VERDICT**: Correct - session creation failure must fail loudly

---

### ✅ `updateSessionTokens()` - Properly Throws

```typescript
async updateSessionTokens(sessionId: string, newTokens: {...}): Promise<void> {
  try {
    // Update tokens in vault
  } catch (error) {
    this.logger.error("Failed to update session tokens in vault", { error, sessionId });
    this.metrics?.recordCounter("session.update_vault_tokens.error", 1);
    throw error;  // ✅ THROWS - Critical operation
  }
}
```

✅ **VERDICT**: Correct - token update failure must fail loudly

---

## 4. Test Vulnerability Analysis

### 🚨 Vulnerable Test Pattern

```typescript
describe("SessionStore", () => {
  it("should return null for non-existent session", async () => {
    // ⚠️ VULNERABLE: This test passes even if Prisma is broken
    const session = await sessionStore.retrieveSession("fake-id");
    expect(session).toBeNull(); // Passes on "not found" OR "database error"
  });

  it("should return empty array for user with no sessions", async () => {
    // ⚠️ VULNERABLE: This test passes even if database connection fails
    const sessions = await sessionStore.getUserSessions("user-123");
    expect(sessions).toEqual([]); // Passes on "no sessions" OR "database error"
  });
});
```

### ✅ Robust Test Pattern

```typescript
describe("SessionStore", () => {
  it("should return null for non-existent session", async () => {
    // Mock repository to return null (valid "not found")
    mockRepo.findBySessionToken.mockResolvedValue(null);

    const session = await sessionStore.retrieveSession("fake-id");
    expect(session).toBeNull();
  });

  it("should throw error on database failure", async () => {
    // Mock repository to throw error
    mockRepo.findBySessionToken.mockRejectedValue(new Error("Connection lost"));

    // Should throw, not return null
    await expect(sessionStore.retrieveSession("session-123")).rejects.toThrow(
      "Failed to retrieve session"
    );
  });

  it("should return empty array for user with no sessions", async () => {
    // Mock repository to return empty array (valid "no sessions")
    mockRepo.findActiveByUserId.mockResolvedValue([]);

    const sessions = await sessionStore.getUserSessions("user-123");
    expect(sessions).toEqual([]);
  });

  it("should throw error on database failure when getting user sessions", async () => {
    // Mock repository to throw error
    mockRepo.findActiveByUserId.mockRejectedValue(new Error("Connection lost"));

    // Should throw, not return empty array
    await expect(sessionStore.getUserSessions("user-123")).rejects.toThrow(
      "Failed to retrieve user sessions"
    );
  });
});
```

---

## 5. Recommendations

### Priority 1: CRITICAL (Security/Authentication Breaking)

1. **Fix `getActiveSessionCount()`**: Throw on database errors

   - **Risk**: Security control (concurrent session limit) bypassed
   - **Impact**: Users can create unlimited sessions during database issues

2. **Fix `retrieveSession()`**: Throw on database errors

   - **Risk**: Authentication broken but appears as "session not found"
   - **Impact**: Login failures appear as invalid credentials

3. **Fix `getUserSessions()`**: Throw on database errors
   - **Risk**: Concurrent session check fails silently
   - **Impact**: Session limit enforcement broken

### Priority 2: MEDIUM (Data Consistency)

4. **Add Orphaned Vault Cleanup Job**
   - **Risk**: Tokens accumulate in vault when cleanup fails
   - **Impact**: Leaked credentials, database bloat

### Priority 3: LOW (Testing/Observability)

5. **Improve Test Coverage**

   - Add explicit database error tests
   - Verify error vs. not-found distinction
   - Mock Prisma errors in tests

6. **Add Alerting**
   - Alert on `session.retrieve.database_error` metric
   - Alert on `session.count.database_error` metric
   - Alert on repeated vault cleanup failures

---

## 6. Implementation Plan

### Step 1: Fix Silent Failures (2 hours)

```typescript
// File: libs/keycloak-authV2/src/services/session/SessionStore.ts

// Fix 1: retrieveSession()
async retrieveSession(sessionId: string, includeTokens = false): Promise<UserSession | null> {
  try {
    const session = await this.userSessionRepo.findBySessionToken(sessionId);
    if (!session || !session.isActive) {
      return null; // Valid "not found"
    }
    // ... rest of logic ...
  } catch (error) {
    this.logger.error("Database error retrieving session", { error, sessionId });
    throw new Error(`Failed to retrieve session: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

// Fix 2: getUserSessions()
async getUserSessions(userId: string): Promise<UserSession[]> {
  try {
    return await this.userSessionRepo.findActiveByUserId(userId, {
      orderBy: { lastAccessedAt: "desc" },
    });
  } catch (error) {
    this.logger.error("Database error retrieving user sessions", { error, userId });
    throw new Error(`Failed to retrieve user sessions: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

// Fix 3: getActiveSessionCount()
async getActiveSessionCount(userId: string, deviceFingerprint?: string): Promise<number> {
  try {
    // ... existing logic ...
    return count;
  } catch (error) {
    this.logger.error("Database error getting session count", { error, userId });
    throw new Error(`Failed to get active session count: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}
```

### Step 2: Add Comprehensive Tests (3 hours)

Create test file: `libs/keycloak-authV2/tests/session/SessionStore.error-handling.spec.ts`

```typescript
describe("SessionStore Error Handling", () => {
  describe("retrieveSession", () => {
    it("should return null for non-existent session", async () => {
      mockRepo.findBySessionToken.mockResolvedValue(null);
      const result = await store.retrieveSession("fake-id");
      expect(result).toBeNull();
    });

    it("should throw on database error", async () => {
      mockRepo.findBySessionToken.mockRejectedValue(
        new Error("DB connection lost")
      );
      await expect(store.retrieveSession("session-id")).rejects.toThrow(
        "Failed to retrieve session"
      );
    });
  });

  // ... more tests ...
});
```

### Step 3: Add Orphaned Vault Cleanup (2 hours)

```typescript
// File: libs/keycloak-authV2/src/services/account/AccountService.ts

async cleanupOrphanedTokens(): Promise<number> {
  try {
    const orphanedAccounts = await this.accountRepo.findAccountsWithoutActiveSessions();

    let cleanedCount = 0;
    for (const account of orphanedAccounts) {
      try {
        await this.clearTokens(account.id);
        cleanedCount++;
      } catch (error) {
        this.logger.error("Failed to cleanup orphaned account", { error, accountId: account.id });
      }
    }

    this.logger.info("Orphaned token cleanup completed", { cleanedCount, totalOrphaned: orphanedAccounts.length });
    return cleanedCount;
  } catch (error) {
    this.logger.error("Orphaned token cleanup failed", { error });
    throw error;
  }
}
```

### Step 4: Add Monitoring & Alerting (1 hour)

```typescript
// Add metrics for database errors
this.metrics?.recordCounter("session.database_error", 1, {
  operation: "retrieveSession",
  severity: "critical"
});

// Alert rules (pseudo-code)
alert: session_database_errors_high
  if: rate(session_database_error[5m]) > 10
  severity: critical
  message: "High rate of session database errors"
```

---

## 7. Summary

### 🚨 Critical Issues Found: 3

1. **`retrieveSession()` silent failure** - Returns `null` on database errors
2. **`getUserSessions()` silent failure** - Returns `[]` on database errors
3. **`getActiveSessionCount()` silent failure** - Returns `0` on database errors (SECURITY RISK)

### ✅ Correct Implementations: 5

1. `storeTokens()` - Throws on failure
2. `getTokens()` - Distinguishes not-found from error
3. `updateTokens()` - Throws on failure
4. `storeSession()` - Throws on failure
5. `updateSessionTokens()` - Throws on failure

### Total Effort: ~8 hours

- Fix silent failures: 2 hours
- Add comprehensive tests: 3 hours
- Add cleanup job: 2 hours
- Add monitoring: 1 hour

### Risk Mitigation

**Before Fixes**: HIGH risk of silent authentication failures
**After Fixes**: LOW risk - all errors propagate correctly

---

## Next Steps

1. ✅ Review and approve this audit
2. ⚠️ Implement fixes in order of priority
3. ✅ Add comprehensive error handling tests
4. ✅ Deploy with monitoring
5. ✅ Run integration tests to verify fixes
