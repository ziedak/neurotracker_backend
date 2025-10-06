# Quick Reference: Repository Pattern Migration

**Status**: ✅ Complete (All 4 Phases)  
**For**: Developers working with session management  
**Updated**: 2025-10-06

---

## 🚀 Quick Start

### Import the Right Things

```typescript
// ✅ DO: Import from @libs/database
import {
  UserSessionRepository,
  SessionLogRepository,
  SessionActivityRepository,
  type UserSession,
  type UserSessionCreateInput,
} from "@libs/database";

// ❌ DON'T: Import PostgreSQLClient for session operations
import { PostgreSQLClient } from "@libs/database"; // OLD WAY
```

### Initialize SessionManager

```typescript
import { SessionManager } from "@libs/keycloak-authV2";

// Create repositories
const userSessionRepo = new UserSessionRepository(
  prisma,
  metricsCollector,
  cacheService
);
const sessionLogRepo = new SessionLogRepository(prisma, metricsCollector);
const sessionActivityRepo = new SessionActivityRepository(
  prisma,
  metricsCollector
);

// Create SessionManager
const sessionManager = new SessionManager(
  tokenManager,
  userSessionRepo, // ✅ Repository (not dbClient)
  sessionLogRepo, // ✅ For cleanup logging
  sessionActivityRepo, // ✅ For activity tracking
  keycloakClient,
  cacheService,
  metricsCollector,
  {
    encryptionKey: process.env.SESSION_ENCRYPTION_KEY,
    enableComponents: {
      cleanup: true, // ✅ Now works!
      metrics: true,
      security: true,
      validation: true,
    },
  }
);
```

---

## 📚 Common Patterns

### Pattern 1: Creating a Session

```typescript
// Using SessionManager (RECOMMENDED)
const result = await sessionManager.createSession(
  userId,
  {
    accessToken: "...",
    refreshToken: "...",
    expiresAt: new Date(Date.now() + 3600000),
  },
  {
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  }
);

// Using SessionStore directly
const sessionData = await sessionStore.storeSession({
  userId,
  storeId,
  sessionToken: "unique-token",
  accessToken: "...",
  expiresAt: new Date(),
});
```

### Pattern 2: Retrieving a Session

```typescript
// By token
const session = await sessionStore.retrieveSession("session-token");

// All user sessions
const sessions = await sessionStore.getUserSessions(userId);

// Using repository directly
const session = await userSessionRepo.findBySessionToken("session-token");
const activeSessions = await userSessionRepo.findActiveByUserId(userId);
```

### Pattern 3: Updating a Session

```typescript
// Mark inactive
await sessionStore.markSessionInactive(sessionId);

// Update using repository
await userSessionRepo.updateById(sessionId, {
  isActive: false,
  expiresAt: new Date(),
});
```

### Pattern 4: Cleanup Operations

```typescript
// Automatic cleanup (configured in SessionManager)
// Runs every hour by default

// Manual cleanup
const sessionCleaner = sessionManager.getSessionCleaner();
await sessionCleaner.performFullCleanup();

// Specific operations
await sessionCleaner.cleanExpiredSessions();
await sessionCleaner.cleanOrphanedTokens();
await sessionCleaner.optimizeCache();
```

---

## 🔧 Helper Functions

### toUserSessionCreateInput()

Converts flexible options to Prisma input format:

```typescript
import { toUserSessionCreateInput } from "@libs/keycloak-authV2";

const input = toUserSessionCreateInput({
  userId: "user-123",
  storeId: "store-456",
  sessionToken: "token-789",
  accessToken: "access-token",
  expiresAt: new Date(),
});

// Result uses Prisma relation syntax:
// {
//   user: { connect: { id: "user-123" } },
//   store: { connect: { id: "store-456" } },
//   sessionId: "token-789",
//   ...
// }
```

### userSessionToSessionData()

Converts Prisma UserSession to legacy SessionData:

```typescript
import { userSessionToSessionData } from "@libs/keycloak-authV2";

const prismaSession = await userSessionRepo.findById(sessionId);
const legacyFormat = userSessionToSessionData(prismaSession);

// Use with legacy code that expects SessionData interface
```

### generateSessionToken()

Generates unique session tokens:

```typescript
import { generateSessionToken } from "@libs/keycloak-authV2";

const token = generateSessionToken();
// Returns: "sess_<uuid>"
```

---

## 🧪 Testing Patterns

### Mock Repositories

```typescript
import { UserSessionRepository } from "@libs/database";

// Create mock
const mockRepo: jest.Mocked<UserSessionRepository> = {
  findBySessionToken: jest.fn(),
  findActiveByUserId: jest.fn(),
  create: jest.fn(),
  updateById: jest.fn(),
  deleteMany: jest.fn(),
  exists: jest.fn(),
  count: jest.fn(),
  // ... other methods
} as any;

// Setup mock data
mockRepo.findBySessionToken.mockResolvedValue({
  id: "session-1",
  userId: "user-1",
  sessionId: "token-1",
  storeId: "store-1",
  expiresAt: new Date(),
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastAccessedAt: new Date(),
  ipAddress: "127.0.0.1",
  userAgent: "test-agent",
  // ... other fields
});

// Use in tests
const sessionStore = new SessionStore(
  mockRepo,
  mockCache,
  mockLogger,
  mockMetrics
);
```

### Integration Tests

```typescript
describe("Session Management Integration", () => {
  let prisma: PrismaClient;
  let sessionManager: SessionManager;

  beforeAll(async () => {
    prisma = new PrismaClient();

    const userSessionRepo = new UserSessionRepository(prisma);
    const sessionLogRepo = new SessionLogRepository(prisma);
    const sessionActivityRepo = new SessionActivityRepository(prisma);

    sessionManager = new SessionManager(
      tokenManager,
      userSessionRepo,
      sessionLogRepo,
      sessionActivityRepo,
      keycloakClient
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("should create and retrieve session", async () => {
    const result = await sessionManager.createSession(
      testUserId,
      testTokens,
      testContext
    );

    expect(result.success).toBe(true);

    const retrieved = await sessionManager.validateSession(
      result.sessionId!,
      testContext
    );

    expect(retrieved.isValid).toBe(true);
  });
});
```

---

## ⚠️ Common Pitfalls

### Pitfall 1: Using PostgreSQLClient

```typescript
// ❌ DON'T:
const dbClient = new PostgreSQLClient(prisma);
const sessionStore = new SessionStore(dbClient, ...);

// ✅ DO:
const userSessionRepo = new UserSessionRepository(prisma, ...);
const sessionStore = new SessionStore(userSessionRepo, ...);
```

### Pitfall 2: Forgetting Required Repositories

```typescript
// ❌ DON'T: Only provide userSessionRepo
const sessionManager = new SessionManager(
  tokenManager,
  userSessionRepo,
  // Missing sessionLogRepo and sessionActivityRepo!
);

// ✅ DO: Provide all three repositories
const sessionManager = new SessionManager(
  tokenManager,
  userSessionRepo,
  sessionLogRepo,
  sessionActivityRepo,
  ...
);
```

### Pitfall 3: Manual Field Mapping

```typescript
// ❌ DON'T: Manually map Prisma types
const createInput = {
  userId: options.userId,
  storeId: options.storeId || DEFAULT_STORE_ID,
  sessionId: options.sessionToken || generateSessionToken(),
  // ...
};

// ✅ DO: Use helper function
const createInput = toUserSessionCreateInput(options);
```

### Pitfall 4: Ignoring Prisma Relations

```typescript
// ❌ DON'T: Pass IDs directly
await prisma.userSession.create({
  data: {
    userId: "user-123",  // ERROR: Not a relation!
    storeId: "store-456",
    ...
  },
});

// ✅ DO: Use connect syntax
await prisma.userSession.create({
  data: {
    user: { connect: { id: "user-123" } },
    store: { connect: { id: "store-456" } },
    ...
  },
});

// ✅ BETTER: Use helper function
const input = toUserSessionCreateInput({ userId: "user-123", ... });
await prisma.userSession.create({ data: input });
```

---

## 🔍 Debugging Tips

### Check Repository Initialization

```typescript
// Verify repositories are initialized
console.log("UserSessionRepo:", !!userSessionRepo);
console.log("SessionLogRepo:", !!sessionLogRepo);
console.log("SessionActivityRepo:", !!sessionActivityRepo);

// Check Prisma client
console.log("Prisma connected:", await prisma.$queryRaw`SELECT 1`);
```

### Enable Debug Logging

```typescript
const sessionManager = new SessionManager(
  ...,
  {
    sessionStore: {
      cacheEnabled: true,
      cacheTTL: 300,
    },
    sessionCleaner: {
      enableAutomaticCleanup: true,
      cleanupInterval: 60 * 60 * 1000, // 1 hour
    },
  }
);

// Check logs for repository operations
// Look for: "SessionStore", "SessionCleaner" log entries
```

### Inspect Database State

```typescript
// Count active sessions
const count = await userSessionRepo.count({
  where: { isActive: true },
});
console.log("Active sessions:", count);

// Check recent cleanup logs
const logs = await sessionLogRepo.findByEvent("cleanup_full_cleanup", {
  orderBy: { timestamp: "desc" },
  take: 10,
});
console.log("Recent cleanups:", logs);

// View session activities
const activities = await sessionActivityRepo.findByActivity(
  "session_expired_cleanup",
  { take: 10 }
);
console.log("Cleanup activities:", activities);
```

---

## 📊 Monitoring

### Key Metrics to Watch

```typescript
// Session operations
"session.store.retrieve.duration";
"session.store.store.duration";
"session.store.getUserSessions.duration";

// Cleanup operations
"session.cleanup.expired_sessions.duration";
"session.cleanup.expired_sessions.deleted";
"session.cleanup.orphaned_tokens.duration";
"session.cleanup.cache_optimization.duration";

// Error rates
"session.store.retrieve.error";
"session.cleanup.error";
```

### Health Checks

```typescript
// SessionStore health
const storeHealth = await sessionStore.healthCheck();
console.log("Store status:", storeHealth.status);

// SessionCleaner health
const cleanerHealth = await sessionCleaner.healthCheck();
console.log("Cleaner status:", cleanerHealth.status);
console.log("Cleanup overdue:", cleanerHealth.details.cleanupOverdue);

// SessionManager overall health
const overallHealth = await sessionManager.healthCheck();
console.log("Overall status:", overallHealth.status);
```

---

## 🎯 Performance Tips

### 1. Enable Caching

```typescript
const sessionStore = new SessionStore(
  userSessionRepo,
  cacheService, // ✅ Provide cache service
  logger,
  metrics,
  {
    cacheEnabled: true,
    cacheTTL: 300, // 5 minutes
  }
);
```

### 2. Optimize Cleanup

```typescript
const sessionCleaner = new SessionCleaner(
  userSessionRepo,
  sessionLogRepo,
  sessionActivityRepo,
  cacheService,
  logger,
  metrics,
  {
    batchSize: 1000, // Larger batches
    cleanupInterval: 3600000, // Run hourly
    enableDeepCleanup: true, // Full cleanup
  }
);
```

### 3. Use Selective Fields

```typescript
// ❌ DON'T: Fetch all fields
const sessions = await userSessionRepo.findActiveByUserId(userId);

// ✅ DO: Select only needed fields
const sessions = await userSessionRepo.findActiveByUserId(userId, {
  select: {
    id: true,
    sessionId: true,
    expiresAt: true,
  },
});
```

### 4. Batch Operations

```typescript
// ❌ DON'T: Loop with individual operations
for (const sessionId of sessionIds) {
  await userSessionRepo.deleteById(sessionId);
}

// ✅ DO: Use batch operations
await userSessionRepo.deleteMany({
  id: { in: sessionIds },
});
```

---

## 📞 Need Help?

### Documentation References

- **Phase 1**: Type system and helpers → `PHASE_1_TYPE_ALIGNMENT_COMPLETE.md`
- **Phase 2**: SessionStore refactoring → `PHASE_2_REPOSITORY_INTEGRATION_COMPLETE.md`
- **Phase 3**: SessionManager updates → `PHASE_3_SESSION_MANAGER_COMPLETE.md`
- **Phase 4**: SessionCleaner + logging → `PHASE_4_CLEANER_COMPLETE.md`
- **Overview**: Complete summary → `MIGRATION_COMPLETE_SUMMARY.md`

### Common Questions

**Q: Why can't I use PostgreSQLClient anymore?**  
A: The system has migrated to repository pattern for better type safety, testability, and maintainability.

**Q: How do I run cleanup manually?**  
A: Get the cleaner from SessionManager and call `performFullCleanup()`.

**Q: Where are session logs stored?**  
A: In the `session_logs` table via SessionLogRepository.

**Q: How do I track session activities?**  
A: Activities are automatically tracked in `session_activities` table during cleanup.

**Q: Can I disable cleanup?**  
A: Yes, set `enableComponents.cleanup: false` in SessionManager config.

---

**Quick Reference Version**: 1.0  
**Last Updated**: 2025-10-06  
**Status**: Production Ready ✅
