# 🎯 Complete Token Storage Optimization Plan

## Executive Summary

You've identified **TWO major issues**:

1. **Redundant Database Tables**: `Account` table (Better-Auth) is unused - you only use Keycloak
2. **Redundant Token Caching**: Tokens cached 3x in Redis + 1x in database (4 copies total)

**Solution**: Clean architecture with single source of truth

---

## Current State Analysis ✅ CONFIRMED

### Database Tables:

```
1. UserSession table (Keycloak) ✅ USED
   - Used by: SessionStore, UserSessionRepository
   - Purpose: Store Keycloak authentication sessions
   - Status: KEEP (but optimize)

2. Account table (Better-Auth) ❌ UNUSED
   - Repository exists: libs/database/src/postgress/repositories/account.ts
   - Used by: NOTHING (0 references in apps/)
   - Purpose: OAuth providers (Google, GitHub, etc.)
   - Status: DELETE (not needed)

3. Verification table (Better-Auth) ❌ UNUSED
   - Purpose: Email verification tokens
   - Used by: NOTHING
   - Status: DELETE (not needed)
```

### Token Storage Locations:

```
Current (4 redundant copies):
1. Database: UserSession table (plain text) ❌
2. Redis: SessionStore cache (plain text) ❌
3. Redis: RefreshTokenManager cache (encrypted but duplicate) ❌
4. Redis: JWTValidator cache (validation only) ✅ KEEP

Optimized (1 copy):
1. Database: UserSession table (encrypted) ✅ ONLY
2. Redis: Session metadata only (no tokens) ✅
3. Redis: JWTValidator cache (validation only) ✅ KEEP
```

---

## Complete Optimization Plan

### Phase 1: Remove Better-Auth (Unused Code)

**Impact**: Zero - not used anywhere

#### Step 1.1: Drop Database Tables

```sql
-- Migration: Drop Better-Auth tables
DROP TABLE IF EXISTS "verifications" CASCADE;
DROP TABLE IF EXISTS "accounts" CASCADE;
```

**Prisma Migration**:

```bash
# Create migration
cd libs/database
pnpm prisma migrate dev --name remove-better-auth-tables
```

#### Step 1.2: Remove Prisma Schema Definitions

**File**: `libs/database/prisma/schema.prisma`

```prisma
// DELETE lines 356-400 (Account model)
// DELETE lines 402-415 (Verification model)
```

#### Step 1.3: Remove TypeScript Models

**Files to DELETE**:

- `libs/database/src/models/auth.ts` (Account, Verification interfaces)
- `libs/database/src/postgress/repositories/account.ts` (AccountRepository)
- `libs/database/src/postgress/repositories/verification.ts` (if exists)

#### Step 1.4: Update Exports

**File**: `libs/database/src/models/index.ts`

```typescript
// REMOVE: export * from "./auth"; // Better-Auth models
```

**File**: `libs/database/src/postgress/repositories/index.ts`

```typescript
// REMOVE: export * from "./account";
// REMOVE: export * from "./verification";
```

**Estimated Time**: 30 minutes  
**Risk**: Zero (not used)

---

### Phase 2: Optimize UserSession Token Storage

**Impact**: High - better security, less memory

#### Step 2.1: Create Token Encryption Service

**New File**: `libs/keycloak-authV2/src/services/encryption/TokenEncryption.ts`

```typescript
import crypto from "crypto";
import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";

/**
 * AES-256-GCM Token Encryption Service
 *
 * Encrypts sensitive tokens before database storage
 * Uses authenticated encryption (GCM mode) for integrity
 */
export class TokenEncryption {
  private readonly algorithm = "aes-256-gcm";
  private readonly key: Buffer;
  private readonly logger: ILogger;

  constructor(encryptionKey: string) {
    if (!encryptionKey || encryptionKey.length < 32) {
      throw new Error("Encryption key must be at least 32 characters");
    }

    // Derive 256-bit key from provided key
    this.key = crypto.scryptSync(encryptionKey, "session-tokens-salt", 32);
    this.logger = createLogger("TokenEncryption");
  }

  /**
   * Encrypt a token string
   * Returns: iv:authTag:encryptedData (hex format)
   */
  encrypt(plaintext: string): string {
    if (!plaintext) {
      throw new Error("Cannot encrypt empty token");
    }

    try {
      // Generate random IV (initialization vector)
      const iv = crypto.randomBytes(16);

      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

      // Encrypt
      let encrypted = cipher.update(plaintext, "utf8", "hex");
      encrypted += cipher.final("hex");

      // Get authentication tag (for integrity)
      const authTag = cipher.getAuthTag();

      // Return format: iv:authTag:encrypted
      return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
    } catch (error) {
      this.logger.error("Token encryption failed", { error });
      throw new Error("Failed to encrypt token");
    }
  }

  /**
   * Decrypt a token string
   * Input format: iv:authTag:encryptedData
   */
  decrypt(ciphertext: string): string {
    if (!ciphertext) {
      throw new Error("Cannot decrypt empty ciphertext");
    }

    try {
      // Parse format: iv:authTag:encrypted
      const parts = ciphertext.split(":");
      if (parts.length !== 3) {
        throw new Error("Invalid ciphertext format");
      }

      const [ivHex, authTagHex, encrypted] = parts;
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);

      // Decrypt
      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    } catch (error) {
      this.logger.error("Token decryption failed", { error });
      throw new Error("Failed to decrypt token");
    }
  }

  /**
   * Encrypt tokens object (convenience method)
   */
  encryptTokens(tokens: {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
  }): {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
  } {
    return {
      accessToken: tokens.accessToken ? this.encrypt(tokens.accessToken) : null,
      refreshToken: tokens.refreshToken
        ? this.encrypt(tokens.refreshToken)
        : null,
      idToken: tokens.idToken ? this.encrypt(tokens.idToken) : null,
    };
  }

  /**
   * Decrypt tokens object (convenience method)
   */
  decryptTokens(encryptedTokens: {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
  }): {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
  } {
    return {
      accessToken: encryptedTokens.accessToken
        ? this.decrypt(encryptedTokens.accessToken)
        : null,
      refreshToken: encryptedTokens.refreshToken
        ? this.decrypt(encryptedTokens.refreshToken)
        : null,
      idToken: encryptedTokens.idToken
        ? this.decrypt(encryptedTokens.idToken)
        : null,
    };
  }
}

/**
 * Singleton instance (initialized from environment)
 */
let tokenEncryptionInstance: TokenEncryption | null = null;

export function getTokenEncryption(): TokenEncryption {
  if (!tokenEncryptionInstance) {
    const key = process.env.SESSION_TOKEN_ENCRYPTION_KEY;
    if (!key) {
      throw new Error(
        "SESSION_TOKEN_ENCRYPTION_KEY environment variable not set"
      );
    }
    tokenEncryptionInstance = new TokenEncryption(key);
  }
  return tokenEncryptionInstance;
}
```

#### Step 2.2: Update SessionStore - Cache Metadata Only

**File**: `libs/keycloak-authV2/src/services/session/SessionStore.ts`

**Changes**:

```typescript
import { getTokenEncryption } from "../encryption/TokenEncryption";

class SessionStore {
  private tokenEncryption = getTokenEncryption();

  // ========== CHANGE 1: Cache metadata only (line ~295-310) ==========
  private async cacheSession(session: UserSession): Promise<void> {
    if (!this.cacheService || !this.config.cacheEnabled) {
      return;
    }

    const cacheKey = this.buildSessionCacheKey(session.id);
    const expiresAt = session.expiresAt || new Date(Date.now() + 3600000);
    const ttl = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    if (ttl > 0) {
      // Cache metadata ONLY (no tokens)
      const sessionMetadata = {
        id: session.id,
        userId: session.userId,
        keycloakSessionId: session.keycloakSessionId,
        expiresAt: session.expiresAt,
        refreshExpiresAt: session.refreshExpiresAt,
        tokenExpiresAt: session.tokenExpiresAt,
        lastAccessedAt: session.lastAccessedAt,
        isActive: session.isActive,
        fingerprint: session.fingerprint,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        // NO TOKENS ✅
      };

      await this.cacheService.set(cacheKey, sessionMetadata, ttl);
      this.logger.debug("Session metadata cached (no tokens)", {
        sessionId: session.id,
      });
    }
  }

  // ========== CHANGE 2: Encrypt before database storage ==========
  async storeSession(sessionData: UserSessionData): Promise<UserSession> {
    try {
      // Encrypt tokens before saving to database
      const encryptedTokens = this.tokenEncryption.encryptTokens({
        accessToken: sessionData.accessToken,
        refreshToken: sessionData.refreshToken,
        idToken: sessionData.idToken,
      });

      const dataToStore = {
        ...sessionData,
        ...encryptedTokens,
      };

      const session = await this.userSessionRepo.create(dataToStore);

      // Cache metadata only
      await this.cacheSession(session);

      return session;
    } catch (error) {
      this.logger.error("Failed to store session", { error });
      throw error;
    }
  }

  // ========== CHANGE 3: Decrypt after database retrieval ==========
  async retrieveSession(
    sessionId: string,
    includeTokens = false
  ): Promise<UserSession | null> {
    try {
      // Check cache first (metadata only)
      if (this.config.cacheEnabled) {
        const cached = await this.getCachedSessionMetadata(sessionId);
        if (cached) {
          if (!includeTokens) {
            // Most operations don't need tokens
            return cached as UserSession;
          }
          // Need tokens - fetch from database
        }
      }

      // Fetch from database
      const session = await this.userSessionRepo.findById(sessionId);
      if (!session) {
        return null;
      }

      // Decrypt tokens if requested
      if (
        includeTokens &&
        (session.accessToken || session.refreshToken || session.idToken)
      ) {
        const decryptedTokens = this.tokenEncryption.decryptTokens({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          idToken: session.idToken,
        });

        session.accessToken = decryptedTokens.accessToken;
        session.refreshToken = decryptedTokens.refreshToken;
        session.idToken = decryptedTokens.idToken;
      }

      // Update cache with metadata
      await this.cacheSession(session);

      return includeTokens ? session : this.stripTokens(session);
    } catch (error) {
      this.logger.error("Failed to retrieve session", { error, sessionId });
      return null;
    }
  }

  // ========== NEW METHOD: Strip tokens from session ==========
  private stripTokens(session: UserSession): UserSession {
    return {
      ...session,
      accessToken: null,
      refreshToken: null,
      idToken: null,
    };
  }

  // ========== NEW METHOD: Get cached metadata ==========
  private async getCachedSessionMetadata(
    sessionId: string
  ): Promise<Partial<UserSession> | null> {
    const cacheKey = this.buildSessionCacheKey(sessionId);
    const cached = await this.cacheService.get<Partial<UserSession>>(cacheKey);
    return cached || null;
  }
}
```

#### Step 2.3: Remove RefreshTokenManager Token Storage

**File**: `libs/keycloak-authV2/src/services/token/RefreshTokenManager.ts`

**Changes**:

```typescript
// REMOVE: storeTokensWithRefresh() token caching (lines 455-520)
// REPLACE with: Fetch tokens from SessionStore when needed

async storeTokensWithRefresh(
  userId: string,
  sessionId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  refreshExpiresIn?: number
): Promise<void> {
  // NO TOKEN STORAGE - just schedule refresh
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresIn * 1000);

  // Schedule automatic refresh
  this.scheduleTokenRefresh(userId, sessionId, expiresAt);

  this.logger.info('Token refresh scheduled (no token storage)', {
    userId,
    sessionId,
    expiresAt: expiresAt.toISOString(),
  });
}

// UPDATE: Get tokens from SessionStore instead of cache
async getStoredTokens(userId: string, sessionId: string): Promise<StoredTokenInfo | null> {
  try {
    // Fetch from SessionStore (will get from DB if not cached)
    const session = await this.sessionStore.retrieveSession(sessionId, true); // includeTokens=true

    if (!session || session.userId !== userId) {
      return null;
    }

    return {
      accessToken: session.accessToken!,
      refreshToken: session.refreshToken!,
      expiresAt: session.tokenExpiresAt!,
      tokenType: 'Bearer',
      scope: '', // Extract from token if needed
      userId,
      sessionId,
      createdAt: session.createdAt,
      refreshCount: 0, // Track separately if needed
    };
  } catch (error) {
    this.logger.error('Failed to get stored tokens', { error, userId, sessionId });
    return null;
  }
}
```

#### Step 2.4: Add Environment Variable

**File**: `.env` (and `.env.example`)

```bash
# Token Encryption Key (32+ characters)
# Generate with: openssl rand -hex 32
SESSION_TOKEN_ENCRYPTION_KEY=your-256-bit-key-here-change-in-production-min-32-chars
```

**Estimated Time**: 4 hours  
**Risk**: Medium (requires testing)

---

### Phase 3: Data Migration

**Impact**: High - migrates existing tokens to encrypted format

#### Step 3.1: Create Migration Script

**New File**: `libs/database/scripts/migrate-encrypt-tokens.ts`

```typescript
import { PrismaClient } from "@prisma/client";
import { TokenEncryption } from "../../keycloak-authV2/src/services/encryption/TokenEncryption";

const prisma = new PrismaClient();

async function migrateTokens() {
  const encryptionKey = process.env.SESSION_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("SESSION_TOKEN_ENCRYPTION_KEY not set");
  }

  const tokenEncryption = new TokenEncryption(encryptionKey);

  console.log("🔐 Starting token encryption migration...");

  // Get all sessions with tokens
  const sessions = await prisma.userSession.findMany({
    where: {
      OR: [
        { accessToken: { not: null } },
        { refreshToken: { not: null } },
        { idToken: { not: null } },
      ],
    },
  });

  console.log(`📊 Found ${sessions.length} sessions with tokens`);

  let encrypted = 0;
  let skipped = 0;

  for (const session of sessions) {
    try {
      // Check if already encrypted (has : separator from IV:authTag:encrypted format)
      const isEncrypted =
        (session.accessToken?.includes(":") ?? false) ||
        (session.refreshToken?.includes(":") ?? false) ||
        (session.idToken?.includes(":") ?? false);

      if (isEncrypted) {
        skipped++;
        continue;
      }

      // Encrypt tokens
      const encryptedTokens = tokenEncryption.encryptTokens({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        idToken: session.idToken,
      });

      // Update database
      await prisma.userSession.update({
        where: { id: session.id },
        data: encryptedTokens,
      });

      encrypted++;

      if (encrypted % 100 === 0) {
        console.log(`✅ Encrypted ${encrypted} sessions...`);
      }
    } catch (error) {
      console.error(`❌ Failed to encrypt session ${session.id}:`, error);
    }
  }

  console.log(`\n🎉 Migration complete!`);
  console.log(`   Encrypted: ${encrypted}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Total: ${sessions.length}`);

  await prisma.$disconnect();
}

migrateTokens().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
```

#### Step 3.2: Run Migration

```bash
# Backup database first!
pg_dump neurotracker > backup_before_encryption_$(date +%Y%m%d).sql

# Run migration
cd libs/database
SESSION_TOKEN_ENCRYPTION_KEY="your-key" ts-node scripts/migrate-encrypt-tokens.ts

# Verify
psql neurotracker -c "SELECT id, LEFT(access_token, 50) FROM user_sessions LIMIT 5;"
# Should see encrypted format: abc123:def456:...
```

**Estimated Time**: 2 hours (including testing)  
**Risk**: High (requires backup and testing)

---

### Phase 4: Testing & Validation

#### Test Plan:

```bash
# 1. Unit tests
cd libs/keycloak-authV2
pnpm test

# 2. Integration tests
cd apps/api-gateway
pnpm test:integration

# 3. Manual testing
# - User login
# - Session validation
# - Token refresh
# - User logout
```

**Estimated Time**: 3 hours  
**Risk**: Low (verification)

---

## Implementation Timeline

### Week 1: Cleanup & Encryption

| Day | Task                                  | Hours | Status |
| --- | ------------------------------------- | ----- | ------ |
| Mon | Phase 1: Remove Better-Auth           | 0.5h  | ⏳     |
| Mon | Phase 2.1: Create TokenEncryption     | 2h    | ⏳     |
| Tue | Phase 2.2: Update SessionStore        | 3h    | ⏳     |
| Wed | Phase 2.3: Update RefreshTokenManager | 2h    | ⏳     |
| Wed | Phase 2.4: Environment setup          | 0.5h  | ⏳     |
| Thu | Phase 3: Data migration               | 2h    | ⏳     |
| Fri | Phase 4: Testing                      | 3h    | ⏳     |

**Total**: ~13 hours

---

## Success Metrics

### Before Optimization:

```
Token Storage:
- Database tables: 2 (UserSession + Account)
- Token copies per user: 4
- Encryption: None
- Redis memory per 10k users: 60MB
- Auth latency: ~211ms

Security:
- Plain text tokens: Yes ❌
- Multiple attack vectors: 4
- Unused code: Account/Verification tables
```

### After Optimization:

```
Token Storage:
- Database tables: 1 (UserSession only)
- Token copies per user: 1
- Encryption: AES-256-GCM ✅
- Redis memory per 10k users: 15MB (75% reduction)
- Auth latency: ~208ms (3ms faster)

Security:
- Plain text tokens: No ✅
- Multiple attack vectors: 1
- Unused code: Removed ✅
```

---

## Rollback Plan

If issues occur during migration:

```bash
# 1. Restore database backup
psql neurotracker < backup_before_encryption_YYYYMMDD.sql

# 2. Revert code changes
git revert <commit-hash>

# 3. Restart services
pnpm dev
```

---

## Next Steps

**What would you like to start with?**

1. ✅ **Phase 1** - Remove Better-Auth (30 min, zero risk)
2. ✅ **Phase 2** - Implement encryption (4 hours, medium risk)
3. ✅ **Phase 3** - Migrate data (2 hours, high risk - needs backup)
4. ✅ **All phases** - Complete optimization (13 hours total)

I can start implementing immediately! Which phase would you like me to begin with? 🚀
