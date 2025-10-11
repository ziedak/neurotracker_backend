# Phase 7: Integration Testing Plan

## Date: October 11, 2025

## Test Results from Phase 6.5b

### ✅ Unit Tests: ALL PASSING (19/19)

```
SessionStore - Error Handling (Critical Fixes)
  Fix #1: retrieveSession()
    ✓ Returns null for non-existent session (valid case)
    ✓ Returns null for inactive session (valid case)
    ✓ THROWS on database error (not return null)
    ✓ THROWS on Prisma query error
    ✓ Returns active session successfully (happy path)

  Fix #2: getUserSessions()
    ✓ Returns empty array for user with no sessions (valid case)
    ✓ THROWS on database error (not return empty array)
    ✓ THROWS on Prisma query error
    ✓ Returns user sessions successfully (happy path)

  Fix #3: getActiveSessionCount() - SECURITY CRITICAL
    ✓ Returns 0 for user with no sessions (valid case)
    ✓ THROWS on database error (SECURITY: not return 0)
    ✓ THROWS on Prisma query error (SECURITY)
    ✓ Returns correct count for user with sessions (happy path)
    ✓ Handles device fingerprint filtering

  Fix #4: getOldestSession()
    ✓ Returns null when user has no sessions (valid case)
    ✓ THROWS on database error (not return null)
    ✓ Returns oldest session successfully (happy path)

  Error Handling Philosophy
    ✓ Demonstrates difference between not-found and database-error
    ✓ Demonstrates why returning default values on errors is dangerous
```

---

## Integration Test Scenarios

### Scenario 1: Complete Authentication Flow ✅ READY

**Test**: Password authentication with token vault integration

```typescript
describe("Integration: Password Authentication", () => {
  it("should complete full authentication flow", async () => {
    // 1. Authenticate with Keycloak
    const authResult = await authManager.authenticateWithPassword(
      "test@example.com",
      "password123",
      clientContext
    );

    expect(authResult.success).toBe(true);
    expect(authResult.tokens).toBeDefined();
    expect(authResult.session).toBeDefined();

    // 2. Verify tokens stored in vault (encrypted)
    const account = await accountService.getKeycloakAccount(authResult.user.id);
    expect(account).toBeDefined();

    // 3. Verify session links to vault
    expect(authResult.session.accountId).toBe(account.accountId);

    // 4. Retrieve session with tokens
    const sessionWithTokens = await sessionStore.retrieveSession(
      authResult.session.id,
      true // includeTokens
    );
    expect(sessionWithTokens.accessToken).toBe(authResult.tokens.access_token);
  });
});
```

---

### Scenario 2: Token Refresh Flow ✅ READY

**Test**: Automatic token refresh with vault updates

```typescript
describe("Integration: Token Refresh", () => {
  it("should refresh tokens and update vault", async () => {
    // 1. Create session with near-expiry tokens
    const session = await createTestSession({
      expiresAt: new Date(Date.now() + 60000), // 1 minute
    });

    // 2. Trigger token refresh
    await sessionTokenCoordinator.refreshSessionTokens(session);

    // 3. Verify vault updated with new tokens
    const updatedTokens = await accountService.getTokens(session.accountId);
    expect(updatedTokens.accessToken).not.toBe(originalAccessToken);

    // 4. Verify session still works
    const validation = await sessionTokenCoordinator.validateSessionToken(
      session
    );
    expect(validation.success).toBe(true);
  });
});
```

---

### Scenario 3: Logout with Cleanup ✅ READY

**Test**: Session termination cleans up vault

```typescript
describe("Integration: Logout", () => {
  it("should terminate session and cleanup vault", async () => {
    // 1. Create active session
    const session = await createTestSession();

    // 2. Verify vault has tokens
    const tokensBefore = await accountService.getTokens(session.accountId);
    expect(tokensBefore).not.toBeNull();

    // 3. Mark session inactive (logout)
    await sessionStore.markSessionInactive(session.id, "user_logout");

    // 4. Verify session inactive
    const inactiveSession = await sessionStore.retrieveSession(session.id);
    expect(inactiveSession).toBeNull(); // Inactive sessions return null

    // 5. Verify vault cleaned (tokens deleted)
    const tokensAfter = await accountService.getTokens(session.accountId);
    expect(tokensAfter).toBeNull();
  });
});
```

---

### Scenario 4: Concurrent Session Limits ✅ READY

**Test**: Security control enforcement

```typescript
describe("Integration: Concurrent Session Limits", () => {
  it("should enforce max sessions and terminate oldest", async () => {
    const userId = "test-user-123";
    const maxSessions = 5;

    // 1. Create max number of sessions
    for (let i = 0; i < maxSessions; i++) {
      await createTestSession({ userId });
    }

    // 2. Verify count
    const count = await sessionStore.getActiveSessionCount(userId);
    expect(count).toBe(maxSessions);

    // 3. Create one more (should terminate oldest)
    const oldestBefore = await sessionStore.getOldestSession(userId);
    await createTestSession({ userId });

    // 4. Verify still at max
    const countAfter = await sessionStore.getActiveSessionCount(userId);
    expect(countAfter).toBe(maxSessions);

    // 5. Verify oldest was terminated
    const oldestSession = await sessionStore.retrieveSession(oldestBefore.id);
    expect(oldestSession).toBeNull();
  });
});
```

---

### Scenario 5: Database Error Handling ✅ READY

**Test**: Proper error propagation

```typescript
describe("Integration: Database Error Handling", () => {
  it("should fail session creation on database error", async () => {
    // Mock database connection failure
    jest
      .spyOn(prisma.userSession, "create")
      .mockRejectedValue(new Error("Connection lost"));

    // Attempt to create session should throw
    await expect(
      sessionManager.createSession(userId, tokens, context)
    ).rejects.toThrow();
  });

  it("should fail concurrent limit check on database error", async () => {
    // Mock database error in count query
    jest
      .spyOn(prisma.userSession, "count")
      .mockRejectedValue(new Error("Connection lost"));

    // Should throw (not bypass with 0)
    await expect(sessionStore.getActiveSessionCount(userId)).rejects.toThrow(
      "Failed to get active session count"
    );
  });
});
```

---

### Scenario 6: Token Vault Security ✅ READY

**Test**: Encryption at rest

```typescript
describe("Integration: Token Vault Security", () => {
  it("should store tokens encrypted", async () => {
    const plainTokens = {
      accessToken: "plain_access_token_123",
      refreshToken: "plain_refresh_token_456",
    };

    // 1. Store tokens
    const accountId = await accountService.storeTokens({
      userId: "test-user",
      keycloakUserId: "kc-user-123",
      ...plainTokens,
      accessTokenExpiresAt: new Date(),
    });

    // 2. Check database directly (should be encrypted)
    const accountRow = await prisma.account.findUnique({
      where: { id: accountId },
    });

    expect(accountRow.accessToken).not.toBe(plainTokens.accessToken);
    expect(accountRow.refreshToken).not.toBe(plainTokens.refreshToken);

    // 3. Retrieve through service (should be decrypted)
    const retrieved = await accountService.getTokens(accountId);
    expect(retrieved.accessToken).toBe(plainTokens.accessToken);
    expect(retrieved.refreshToken).toBe(plainTokens.refreshToken);
  });
});
```

---

### Scenario 7: Cache Performance ✅ READY

**Test**: Session count caching effectiveness

```typescript
describe("Integration: Cache Performance", () => {
  it("should use cache for session counts", async () => {
    const userId = "test-user";

    // 1. First call (cache miss)
    const startMiss = performance.now();
    const countMiss = await sessionStore.getActiveSessionCount(userId);
    const durationMiss = performance.now() - startMiss;

    // 2. Second call (cache hit)
    const startHit = performance.now();
    const countHit = await sessionStore.getActiveSessionCount(userId);
    const durationHit = performance.now() - startHit;

    // 3. Verify results match
    expect(countHit).toBe(countMiss);

    // 4. Verify cache is faster (significant difference)
    expect(durationHit).toBeLessThan(durationMiss / 10);
    console.log(`Cache speedup: ${(durationMiss / durationHit).toFixed(1)}x`);
  });
});
```

---

## Performance Benchmarks

### Target Metrics:

| Operation                | Target  | Status  |
| ------------------------ | ------- | ------- |
| Session creation         | < 100ms | ⏳ Test |
| Token retrieval (cached) | < 10ms  | ⏳ Test |
| Token retrieval (vault)  | < 50ms  | ⏳ Test |
| Session count (cached)   | < 5ms   | ⏳ Test |
| Session count (DB)       | < 100ms | ⏳ Test |
| Token refresh            | < 200ms | ⏳ Test |
| Concurrent limit check   | < 50ms  | ⏳ Test |

---

## Load Testing Scenarios

### Scenario 8: High Concurrency ⏳ PENDING

**Test**: Multiple simultaneous session creations

```bash
# Artillery load test
artillery quick --count 100 --num 10 \
  https://api.test/auth/login
```

**Expected**:

- All sessions created successfully
- Concurrent limits enforced correctly
- No race conditions
- Cache handles load

---

## Next Steps

### Immediate (30 minutes):

1. ✅ **DONE**: Run unit tests (all passing)
2. **TODO**: Run integration test suite
3. **TODO**: Verify all scenarios pass

### Short-term (2 hours):

1. **TODO**: Performance benchmarking
2. **TODO**: Load testing (optional)
3. **TODO**: Security audit checklist

### Documentation:

1. **TODO**: Update AUTHENTICATION_FLOW_VERIFICATION.md with test results
2. **TODO**: Create INTEGRATION_TEST_REPORT.md
3. **TODO**: Final production readiness assessment

---

## Current Status

- ✅ Unit tests: 19/19 passing
- ⏳ Integration tests: Ready to run
- ⏳ Performance tests: Defined, ready to run
- ⏳ Load tests: Optional, ready to run

**Next Command**:

```bash
# Run existing integration tests (if any)
cd /home/zied/workspace/backend
pnpm test --testPathPattern=integration

# Or create integration test file and run
```
