# 🏗️ Improved Architecture: Centralized Token Storage

## Your Insight is Brilliant! 💡

Instead of **deleting** the `Account` table, let's **repurpose** it as a **centralized token vault**!

---

## The New Architecture

### Separation of Concerns:

```
┌─────────────────────────────────────────────────────────┐
│  UserSession (Session Metadata)                         │
│  - Session ID, timestamps, fingerprint                  │
│  - User agent, IP address                               │
│  - Session state (active/expired)                       │
│  ❌ NO TOKENS                                            │
└─────────────────────────────────────────────────────────┘
                         │
                         │ References
                         ↓
┌─────────────────────────────────────────────────────────┐
│  Account (Token Vault) - Single Source of Truth         │
│  - Encrypted tokens (access, refresh, ID)               │
│  - Token expiration timestamps                          │
│  - Provider info (keycloak, google, github, etc.)       │
│  ✅ CENTRALIZED TOKEN STORAGE                            │
└─────────────────────────────────────────────────────────┘
```

**Benefits**:

1. ✅ **Single Source of Truth**: All tokens in one place
2. ✅ **Clear Separation**: Sessions ≠ Tokens
3. ✅ **Reusable**: Works for Keycloak AND future OAuth providers
4. ✅ **Secure**: Centralized encryption point
5. ✅ **Scalable**: Easy to add new token types

---

## Database Schema Changes

### Step 1: Update Prisma Schema

**File**: `libs/database/prisma/schema.prisma`

```prisma
// ==================== UserSession (Metadata Only) ====================
model UserSession {
  id                String    @id @default(cuid())
  userId            String
  accountId         String?   // Link to Account (token vault)
  keycloakSessionId String?   @unique @db.VarChar(255)

  // ❌ REMOVE: Token fields (moved to Account)
  // accessToken       String?   @db.Text
  // refreshToken      String?   @db.Text
  // idToken           String?   @db.Text
  // tokenExpiresAt    DateTime?
  // refreshExpiresAt  DateTime?

  // ✅ KEEP: Session metadata
  fingerprint       String?   @db.VarChar(64)
  lastAccessedAt    DateTime  @default(now())
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  expiresAt         DateTime?
  ipAddress         String?
  userAgent         String?
  metadata          Json?
  isActive          Boolean   @default(true)
  endedAt           DateTime?

  // Relations
  user           User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  account        Account?          @relation(fields: [accountId], references: [id], onDelete: SetNull)
  events         UserEvent[]
  logs           SessionLog[]
  recoveryEvents RecoveryEvent[]
  activities     SessionActivity[]

  @@index([userId])
  @@index([accountId])
  @@index([keycloakSessionId])
  @@index([expiresAt])
  @@index([lastAccessedAt])
  @@index([isActive, expiresAt])
  @@map("user_sessions")
}

// ==================== Account (Centralized Token Vault) ====================
model Account {
  id                    String    @id @default(cuid())
  accountId             String    @db.VarChar(255) // Provider-specific ID (e.g., Keycloak user ID)
  providerId            String    @db.VarChar(255) // Provider: "keycloak", "google", "github", etc.
  userId                String

  // ✅ ENCRYPTED TOKENS (Single Source of Truth)
  accessToken           String?   @db.Text        // Encrypted access token
  refreshToken          String?   @db.Text        // Encrypted refresh token
  idToken               String?   @db.Text        // Encrypted ID token
  accessTokenExpiresAt  DateTime?                 // Access token expiration
  refreshTokenExpiresAt DateTime?                 // Refresh token expiration

  // Additional metadata
  scope                 String?   @db.Text        // OAuth scopes
  tokenType             String?   @db.VarChar(50) @default("Bearer")
  password              String?   @db.VarChar(255) // For email/password provider (hashed)

  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  lastTokenRefresh      DateTime? // Track when tokens were last refreshed

  // Relations
  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessions UserSession[] // One account can have multiple active sessions

  @@unique([providerId, accountId]) // One account per provider
  @@index([userId])
  @@index([providerId])
  @@index([accessTokenExpiresAt])
  @@map("accounts")
}
```

**Key Changes**:

1. **UserSession**: Removed token fields, added `accountId` reference
2. **Account**: Becomes the centralized token vault
3. **Relationship**: One Account → Many Sessions

---

## Updated Models

### File: `libs/database/src/models/auth.ts`

```typescript
/**
 * Account Model - Centralized Token Vault
 *
 * Single source of truth for all authentication tokens.
 * Supports multiple providers: Keycloak, Google, GitHub, etc.
 */
export interface Account {
  id: string;
  accountId: string; // Provider-specific account ID
  providerId: string; // "keycloak", "google", "github", etc.
  userId: string;

  // ✅ ENCRYPTED TOKENS (Single Source of Truth)
  accessToken?: string | null;
  refreshToken?: string | null;
  idToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  refreshTokenExpiresAt?: Date | null;

  scope?: string | null;
  tokenType?: string | null;
  password?: string | null;

  createdAt: Date;
  updatedAt: Date;
  lastTokenRefresh?: Date | null;

  // Relations
  user?: User;
  sessions?: UserSession[];
}

/**
 * Helper: Create Keycloak account
 */
export interface KeycloakAccountInput {
  userId: string;
  keycloakUserId: string; // accountId
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt?: Date;
  scope?: string;
}

/**
 * Helper: Update account tokens
 */
export interface AccountTokenUpdate {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt?: Date;
  lastTokenRefresh?: Date;
}
```

### File: `libs/database/src/models/user.ts`

```typescript
export interface UserSession {
  id: string;
  userId: string;
  accountId?: string | null; // ✅ NEW: Link to Account (token vault)
  keycloakSessionId?: string | null;

  // ❌ REMOVED: Token fields
  // accessToken?: string | null;
  // refreshToken?: string | null;
  // idToken?: string | null;
  // tokenExpiresAt?: Date | null;
  // refreshExpiresAt?: Date | null;

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

  user?: User;
  account?: Account; // ✅ NEW: Relation to token vault
  events?: UserEvent[];
  logs?: SessionLog[];
  recoveryEvents?: RecoveryEvent[];
  activities?: SessionActivity[];
}
```

---

## Enhanced AccountRepository

### File: `libs/database/src/postgress/repositories/account.ts`

```typescript
/**
 * Account Repository - Centralized Token Vault
 *
 * Single source of truth for authentication tokens across all providers.
 * Handles token storage, retrieval, and encryption.
 */

import type { PrismaClient } from "@prisma/client";
import type {
  Account,
  AccountCreateInput,
  AccountUpdateInput,
  AccountTokenUpdate,
  KeycloakAccountInput,
} from "../../models/auth";

export class AccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ==================== Keycloak-Specific Methods ====================

  /**
   * Create or update Keycloak account with tokens
   */
  async upsertKeycloakAccount(input: KeycloakAccountInput): Promise<Account> {
    return this.prisma.account.upsert({
      where: {
        providerId_accountId: {
          providerId: "keycloak",
          accountId: input.keycloakUserId,
        },
      },
      create: {
        accountId: input.keycloakUserId,
        providerId: "keycloak",
        userId: input.userId,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        scope: input.scope,
        tokenType: "Bearer",
        lastTokenRefresh: new Date(),
      },
      update: {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        idToken: input.idToken,
        accessTokenExpiresAt: input.accessTokenExpiresAt,
        refreshTokenExpiresAt: input.refreshTokenExpiresAt,
        scope: input.scope,
        lastTokenRefresh: new Date(),
      },
      include: {
        user: true,
        sessions: true,
      },
    }) as Promise<Account>;
  }

  /**
   * Get Keycloak account for user
   */
  async getKeycloakAccount(userId: string): Promise<Account | null> {
    return this.prisma.account.findFirst({
      where: {
        userId,
        providerId: "keycloak",
      },
      include: {
        user: true,
        sessions: true,
      },
    }) as Promise<Account | null>;
  }

  /**
   * Get Keycloak account by Keycloak user ID
   */
  async getKeycloakAccountByKeycloakId(
    keycloakUserId: string
  ): Promise<Account | null> {
    return this.prisma.account.findUnique({
      where: {
        providerId_accountId: {
          providerId: "keycloak",
          accountId: keycloakUserId,
        },
      },
      include: {
        user: true,
        sessions: true,
      },
    }) as Promise<Account | null>;
  }

  // ==================== Token Management ====================

  /**
   * Update account tokens (for token refresh)
   */
  async updateTokens(
    accountId: string,
    tokens: AccountTokenUpdate
  ): Promise<Account> {
    return this.prisma.account.update({
      where: { id: accountId },
      data: {
        ...tokens,
        lastTokenRefresh: new Date(),
      },
      include: {
        user: true,
      },
    }) as Promise<Account>;
  }

  /**
   * Get account tokens (for session authentication)
   */
  async getTokens(accountId: string): Promise<{
    accessToken: string | null;
    refreshToken: string | null;
    idToken: string | null;
    accessTokenExpiresAt: Date | null;
    refreshTokenExpiresAt: Date | null;
  } | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        accessToken: true,
        refreshToken: true,
        idToken: true,
        accessTokenExpiresAt: true,
        refreshTokenExpiresAt: true,
      },
    });

    return account;
  }

  /**
   * Clear account tokens (for logout)
   */
  async clearTokens(accountId: string): Promise<void> {
    await this.prisma.account.update({
      where: { id: accountId },
      data: {
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      },
    });
  }

  /**
   * Check if tokens are expired
   */
  async areTokensExpired(accountId: string): Promise<boolean> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        accessTokenExpiresAt: true,
      },
    });

    if (!account || !account.accessTokenExpiresAt) {
      return true;
    }

    return account.accessTokenExpiresAt < new Date();
  }

  // ==================== Generic CRUD ====================

  async create(data: AccountCreateInput): Promise<Account> {
    return this.prisma.account.create({
      data,
      include: {
        user: true,
        sessions: true,
      },
    }) as Promise<Account>;
  }

  async findById(id: string): Promise<Account | null> {
    return this.prisma.account.findUnique({
      where: { id },
      include: {
        user: true,
        sessions: true,
      },
    }) as Promise<Account | null>;
  }

  async findByProvider(
    providerId: string,
    accountId: string
  ): Promise<Account | null> {
    return this.prisma.account.findUnique({
      where: {
        providerId_accountId: {
          providerId,
          accountId,
        },
      },
      include: {
        user: true,
        sessions: true,
      },
    }) as Promise<Account | null>;
  }

  async findByUserId(userId: string): Promise<Account[]> {
    return this.prisma.account.findMany({
      where: { userId },
      include: {
        user: true,
        sessions: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    }) as Promise<Account[]>;
  }

  async delete(id: string): Promise<Account> {
    return this.prisma.account.delete({
      where: { id },
    }) as Promise<Account>;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.prisma.account.deleteMany({
      where: { userId },
    });
    return result.count;
  }
}
```

---

## Updated SessionStore Integration

### File: `libs/keycloak-authV2/src/services/session/SessionStore.ts`

```typescript
import { AccountRepository } from "@libs/database";
import { getTokenEncryption } from "../encryption/TokenEncryption";

class SessionStore {
  private accountRepo: AccountRepository;
  private tokenEncryption = getTokenEncryption();

  constructor(/* ... */) {
    this.accountRepo = new AccountRepository(prisma);
  }

  // ========== Store Session with Tokens ==========
  async storeSession(sessionData: {
    userId: string;
    keycloakUserId: string;
    keycloakSessionId?: string;
    accessToken: string;
    refreshToken: string;
    idToken?: string;
    tokenExpiresAt: Date;
    refreshExpiresAt?: Date;
    fingerprint?: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAt?: Date;
  }): Promise<UserSession> {
    try {
      // 1. Encrypt tokens
      const encryptedTokens = this.tokenEncryption.encryptTokens({
        accessToken: sessionData.accessToken,
        refreshToken: sessionData.refreshToken,
        idToken: sessionData.idToken,
      });

      // 2. Store tokens in Account (centralized vault)
      const account = await this.accountRepo.upsertKeycloakAccount({
        userId: sessionData.userId,
        keycloakUserId: sessionData.keycloakUserId,
        accessToken: encryptedTokens.accessToken!,
        refreshToken: encryptedTokens.refreshToken!,
        idToken: encryptedTokens.idToken,
        accessTokenExpiresAt: sessionData.tokenExpiresAt,
        refreshTokenExpiresAt: sessionData.refreshExpiresAt,
      });

      // 3. Create session (metadata only - no tokens!)
      const session = await this.userSessionRepo.create({
        userId: sessionData.userId,
        accountId: account.id, // Link to token vault
        keycloakSessionId: sessionData.keycloakSessionId,
        fingerprint: sessionData.fingerprint,
        ipAddress: sessionData.ipAddress,
        userAgent: sessionData.userAgent,
        expiresAt: sessionData.expiresAt,
        isActive: true,
      });

      // 4. Cache metadata only (no tokens)
      await this.cacheSessionMetadata(session);

      this.logger.info("Session stored with tokens in vault", {
        sessionId: session.id,
        accountId: account.id,
      });

      return session;
    } catch (error) {
      this.logger.error("Failed to store session", { error });
      throw error;
    }
  }

  // ========== Retrieve Session with Tokens ==========
  async retrieveSession(
    sessionId: string,
    includeTokens = false
  ): Promise<UserSession | null> {
    try {
      // 1. Check cache (metadata only)
      const cached = await this.getCachedSessionMetadata(sessionId);
      if (cached && !includeTokens) {
        return cached as UserSession;
      }

      // 2. Fetch from database
      const session = await this.userSessionRepo.findById(sessionId, {
        include: { account: includeTokens }, // Include account if tokens needed
      });

      if (!session) {
        return null;
      }

      // 3. Decrypt tokens if needed
      if (includeTokens && session.account) {
        const decryptedTokens = this.tokenEncryption.decryptTokens({
          accessToken: session.account.accessToken,
          refreshToken: session.account.refreshToken,
          idToken: session.account.idToken,
        });

        // Attach decrypted tokens to session (for convenience)
        (session as any).accessToken = decryptedTokens.accessToken;
        (session as any).refreshToken = decryptedTokens.refreshToken;
        (session as any).idToken = decryptedTokens.idToken;
        (session as any).tokenExpiresAt = session.account.accessTokenExpiresAt;
        (session as any).refreshExpiresAt =
          session.account.refreshTokenExpiresAt;
      }

      // 4. Update cache
      await this.cacheSessionMetadata(session);

      return session;
    } catch (error) {
      this.logger.error("Failed to retrieve session", { error });
      return null;
    }
  }

  // ========== Refresh Tokens ==========
  async refreshSessionTokens(
    sessionId: string,
    newTokens: {
      accessToken: string;
      refreshToken: string;
      idToken?: string;
      tokenExpiresAt: Date;
      refreshExpiresAt?: Date;
    }
  ): Promise<void> {
    const session = await this.userSessionRepo.findById(sessionId);
    if (!session || !session.accountId) {
      throw new Error("Session or account not found");
    }

    // Encrypt new tokens
    const encryptedTokens = this.tokenEncryption.encryptTokens({
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      idToken: newTokens.idToken,
    });

    // Update tokens in centralized vault
    await this.accountRepo.updateTokens(session.accountId, {
      accessToken: encryptedTokens.accessToken!,
      refreshToken: encryptedTokens.refreshToken!,
      idToken: encryptedTokens.idToken,
      accessTokenExpiresAt: newTokens.tokenExpiresAt,
      refreshTokenExpiresAt: newTokens.refreshExpiresAt,
      lastTokenRefresh: new Date(),
    });

    this.logger.info("Session tokens refreshed", { sessionId });
  }

  // ========== Logout ==========
  async endSession(sessionId: string): Promise<void> {
    const session = await this.userSessionRepo.findById(sessionId);
    if (!session) return;

    // Clear tokens from vault
    if (session.accountId) {
      await this.accountRepo.clearTokens(session.accountId);
    }

    // Mark session as ended
    await this.userSessionRepo.update(sessionId, {
      isActive: false,
      endedAt: new Date(),
    });

    // Clear cache
    await this.invalidateSessionCache(sessionId);
  }
}
```

---

## Migration Script

### File: `libs/database/scripts/migrate-to-account-vault.ts`

```typescript
import { PrismaClient } from "@prisma/client";
import { TokenEncryption } from "../../keycloak-authV2/src/services/encryption/TokenEncryption";

const prisma = new PrismaClient();

async function migrateToAccountVault() {
  const encryptionKey = process.env.SESSION_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("SESSION_TOKEN_ENCRYPTION_KEY not set");
  }

  const tokenEncryption = new TokenEncryption(encryptionKey);

  console.log("🔄 Starting migration to Account vault...\n");

  // Get all sessions with tokens
  const sessions = await prisma.userSession.findMany({
    where: {
      OR: [{ accessToken: { not: null } }, { refreshToken: { not: null } }],
    },
    include: {
      user: true,
    },
  });

  console.log(`📊 Found ${sessions.length} sessions to migrate\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const session of sessions) {
    try {
      if (!session.accessToken && !session.refreshToken) {
        skipped++;
        continue;
      }

      // Encrypt tokens
      const encryptedTokens = tokenEncryption.encryptTokens({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        idToken: session.idToken,
      });

      // Create/update Account (token vault)
      const account = await prisma.account.upsert({
        where: {
          providerId_accountId: {
            providerId: "keycloak",
            accountId: session.user.keycloakId || session.userId,
          },
        },
        create: {
          accountId: session.user.keycloakId || session.userId,
          providerId: "keycloak",
          userId: session.userId,
          accessToken: encryptedTokens.accessToken,
          refreshToken: encryptedTokens.refreshToken,
          idToken: encryptedTokens.idToken,
          accessTokenExpiresAt: session.tokenExpiresAt,
          refreshTokenExpiresAt: session.refreshExpiresAt,
          tokenType: "Bearer",
        },
        update: {
          accessToken: encryptedTokens.accessToken,
          refreshToken: encryptedTokens.refreshToken,
          idToken: encryptedTokens.idToken,
          accessTokenExpiresAt: session.tokenExpiresAt,
          refreshTokenExpiresAt: session.refreshExpiresAt,
        },
      });

      // Update session to link to account
      await prisma.userSession.update({
        where: { id: session.id },
        data: {
          accountId: account.id,
          // Clear token fields (will be removed in next migration)
          accessToken: null,
          refreshToken: null,
          idToken: null,
        },
      });

      migrated++;

      if (migrated % 100 === 0) {
        console.log(`✅ Migrated ${migrated} sessions...`);
      }
    } catch (error) {
      console.error(`❌ Failed to migrate session ${session.id}:`, error);
      errors++;
    }
  }

  console.log(`\n🎉 Migration complete!`);
  console.log(`   Migrated: ${migrated}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total: ${sessions.length}`);

  await prisma.$disconnect();
}

migrateToAccountVault().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
```

---

## Summary: Why This is Better

### Before (Current):

```
❌ UserSession has tokens (mixed concerns)
❌ Tokens in 4 places (2 DB + 2 Redis)
❌ No clear separation
❌ Account table unused
```

### After (Optimized):

```
✅ UserSession = Session metadata only
✅ Account = Centralized token vault
✅ Tokens in 1 place (encrypted)
✅ Clear separation of concerns
✅ Redis cache = metadata only
✅ Reusable for multiple providers
```

---

## Next Steps

Would you like me to:

1. **Implement the Prisma schema changes**?
2. **Create the TokenEncryption service**?
3. **Update AccountRepository with vault methods**?
4. **Update SessionStore to use Account vault**?
5. **All of the above**?

This architecture is **production-ready** and **scalable**! 🚀
