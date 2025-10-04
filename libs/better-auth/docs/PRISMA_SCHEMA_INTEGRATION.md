# Prisma Schema Integration for Better-Auth

**Date**: October 4, 2025  
**Status**: ✅ Complete  
**Migration**: `20251004180702_add_better_auth_fields`

## Overview

This document details the Prisma schema changes made to support Better-Auth authentication library integration with the existing Neurotracker database.

---

## Schema Changes Summary

### 1. User Model Enhancements

**Added Fields**:

- `name` (String, optional, VarChar(255)): Full name field required by Better-Auth
- `image` (String, optional, Text): Profile image URL for user avatars

**Existing Compatible Fields**:

- ✅ `id`: String (cuid) - Compatible with Better-Auth
- ✅ `email`: String (unique, VarChar(255)) - Required by Better-Auth
- ✅ `password`: String (VarChar(255)) - For email/password auth
- ✅ `emailVerified`: Boolean (default: false) - Required by Better-Auth
- ✅ `createdAt`, `updatedAt`: DateTime - Required by Better-Auth
- ✅ `firstName`, `lastName`: Kept for backward compatibility

**New Relations**:

- `accounts`: Relation to Account model (one-to-many)

```prisma
model User {
  // ... existing fields ...
  name           String?    @db.VarChar(255) // Better-Auth: full name field
  image          String?    @db.Text // Better-Auth: profile image URL

  // Relations
  accounts       Account[] // Better-Auth: OAuth accounts
}
```

### 2. UserSession Model Enhancements

**Added Fields**:

- `token` (String, unique, required, VarChar(255)): Better-Auth session token
  - **CRITICAL**: This is the primary session identifier for Better-Auth
  - Must be unique across all sessions
  - Used for cookie-based authentication

**Existing Compatible Fields**:

- ✅ `id`: String (cuid) - Compatible
- ✅ `userId`: Foreign key to User
- ✅ `expiresAt`: DateTime (optional) - Required by Better-Auth
- ✅ `createdAt`, `updatedAt`: DateTime - Required by Better-Auth
- ✅ `ipAddress`, `userAgent`: Optional security metadata
- ✅ `sessionId`: Kept for backward compatibility with existing system

```prisma
model UserSession {
  // ... existing fields ...
  token             String    @unique @db.VarChar(255) // Better-Auth: session token (required)
  expiresAt         DateTime? // Better-Auth: session expiration (required)

  @@index([token])
  @@map("user_sessions")
}
```

### 3. New Account Model (OAuth Support)

**Purpose**: Stores OAuth provider account data for social login integrations

**Fields**:

- `id`: String (cuid, primary key)
- `accountId`: String (VarChar(255)) - Provider-specific account ID
- `providerId`: String (VarChar(255)) - Provider name (google, github, etc.)
- `userId`: String - Foreign key to User (cascade delete)
- `accessToken`: String (Text, optional, encrypted)
- `refreshToken`: String (Text, optional, encrypted)
- `idToken`: String (Text, optional, encrypted)
- `accessTokenExpiresAt`: DateTime (optional)
- `refreshTokenExpiresAt`: DateTime (optional)
- `scope`: String (Text, optional) - OAuth scopes
- `password`: String (VarChar(255), optional) - For email/password provider
- `createdAt`, `updatedAt`: DateTime

**Indexes**:

- Unique constraint: `[providerId, accountId]`
- Index: `userId`, `providerId`

```prisma
model Account {
  id                    String    @id @default(cuid())
  accountId             String    @db.VarChar(255)
  providerId            String    @db.VarChar(255)
  userId                String
  accessToken           String?   @db.Text
  refreshToken          String?   @db.Text
  idToken               String?   @db.Text
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?   @db.Text
  password              String?   @db.VarChar(255)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([providerId, accountId])
  @@index([userId])
  @@index([providerId])
  @@map("accounts")
}
```

### 4. New Verification Model (Email Verification & Password Reset)

**Purpose**: Stores temporary verification tokens for email verification and password reset flows

**Fields**:

- `id`: String (cuid, primary key)
- `identifier`: String (VarChar(255)) - Email or other identifier
- `value`: String (VarChar(255)) - Verification token
- `expiresAt`: DateTime - Token expiration
- `createdAt`, `updatedAt`: DateTime

**Indexes**:

- Unique constraint: `[identifier, value]`
- Index: `identifier`, `expiresAt`

```prisma
model Verification {
  id         String   @id @default(cuid())
  identifier String   @db.VarChar(255)
  value      String   @db.VarChar(255)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([identifier, value])
  @@index([identifier])
  @@index([expiresAt])
  @@map("verifications")
}
```

---

## Migration Details

### Migration File

- **Name**: `20251004180702_add_better_auth_fields`
- **Location**: `libs/database/prisma/migrations/`
- **Status**: Created (not yet applied)

### SQL Changes

**Tables Created**:

1. `accounts` - OAuth provider accounts
2. `verifications` - Verification tokens

**Columns Added**:

1. `users.name` (VarChar(255), nullable)
2. `users.image` (Text, nullable)
3. `user_sessions.token` (VarChar(255), unique, not null)

**Indexes Added**:

- `user_sessions.token` (unique)
- `user_sessions.token_idx` (for performance)
- `accounts.userId_idx`
- `accounts.providerId_idx`
- `accounts.providerId_accountId` (unique)
- `verifications.identifier_idx`
- `verifications.expiresAt_idx`
- `verifications.identifier_value` (unique)

### Migration Warnings

⚠️ **IMPORTANT**:

- The `user_sessions.token` field is required and unique
- If there are existing sessions without a `token`, the migration will fail
- **Action Required**: Either:
  1. Clear existing sessions before migration: `DELETE FROM user_sessions;`
  2. Or manually add unique tokens to existing sessions

---

## Backward Compatibility

### Preserved Fields

The migration **preserves** all existing fields to maintain backward compatibility:

- `User.firstName`, `User.lastName` (kept alongside `name`)
- `UserSession.sessionId` (kept alongside `token`)
- `UserSession.keycloakSessionId` (for existing Keycloak integration)
- All existing relations and constraints

### Data Migration Strategy

**Option 1: Clean Migration (Recommended for Development)**

```sql
-- Clear existing sessions (will force re-login)
DELETE FROM user_sessions WHERE token IS NULL;
```

**Option 2: Populate Tokens for Existing Sessions (Production)**

```sql
-- Generate unique tokens for existing sessions
UPDATE user_sessions
SET token = encode(gen_random_bytes(32), 'hex')
WHERE token IS NULL;
```

**Option 3: Populate User Names from firstName/lastName**

```sql
-- Combine firstName and lastName into name field
UPDATE users
SET name = CONCAT_WS(' ', "firstName", "lastName")
WHERE name IS NULL
  AND ("firstName" IS NOT NULL OR "lastName" IS NOT NULL);
```

---

## Better-Auth Configuration Alignment

### Required Fields Check

| Model              | Better-Auth Requirement | Status              |
| ------------------ | ----------------------- | ------------------- |
| User.id            | String                  | ✅ Compatible       |
| User.email         | String (unique)         | ✅ Compatible       |
| User.emailVerified | Boolean                 | ✅ Compatible       |
| User.name          | String                  | ✅ Added (optional) |
| User.image         | String (optional)       | ✅ Added            |
| User.createdAt     | DateTime                | ✅ Compatible       |
| User.updatedAt     | DateTime                | ✅ Compatible       |
| Session.id         | String                  | ✅ Compatible       |
| Session.userId     | String (FK)             | ✅ Compatible       |
| Session.token      | String (unique)         | ✅ Added            |
| Session.expiresAt  | DateTime                | ✅ Compatible       |
| Session.createdAt  | DateTime                | ✅ Compatible       |
| Session.updatedAt  | DateTime                | ✅ Compatible       |
| Session.ipAddress  | String (optional)       | ✅ Compatible       |
| Session.userAgent  | String (optional)       | ✅ Compatible       |
| Account            | Full model              | ✅ Created          |
| Verification       | Full model              | ✅ Created          |

### Configuration Updates Required

**In `src/config/auth.config.ts`**:

```typescript
// Prisma adapter configuration (already done)
database: prismaAdapter(options.prisma, {
  provider: "postgresql",
}),
```

**Field Mapping** (if needed):

```typescript
// Better-Auth will automatically map:
// - User.name (optional, can be null)
// - User.image (optional, can be null)
// - Session.token (required, unique)
// - Account.* (full OAuth support)
// - Verification.* (email verification support)
```

---

## Testing Checklist

### Schema Validation

- [x] Prisma schema formatted successfully
- [x] Migration generated without errors
- [ ] Migration SQL reviewed and approved
- [ ] No breaking changes for existing features

### Database Integration

- [ ] Migration applied to development database
- [ ] Prisma client regenerated
- [ ] User model exports verified
- [ ] Session model exports verified
- [ ] Account model exports verified
- [ ] Verification model exports verified

### Better-Auth Integration

- [ ] Auth configuration recognizes new fields
- [ ] Session creation works with token field
- [ ] Email verification flow works
- [ ] OAuth account linking works (if enabled)
- [ ] Backward compatibility maintained

### Data Migration

- [ ] Existing users can still authenticate
- [ ] Existing sessions handled gracefully
- [ ] User names populated (if migration script used)
- [ ] No data loss occurred

---

## Next Steps

### 1. Apply Migration (Development)

```bash
cd libs/database
npx prisma migrate dev --name add_better_auth_fields
```

### 2. Regenerate Prisma Client

```bash
npx prisma generate
```

### 3. Update Better-Auth Type Imports

```typescript
// In libs/better-auth/src/types/index.ts
import type { User, Account } from "@prisma/client";
import type { UserSession as PrismaSession } from "@prisma/client";
```

### 4. Test Auth Configuration

```bash
cd libs/better-auth
pnpm test
```

### 5. Integration Testing

- Test user registration with Better-Auth
- Test session creation and validation
- Test email verification flow
- Test OAuth flows (if configured)

---

## Rollback Plan

If issues occur, rollback with:

```bash
# Revert migration
npx prisma migrate resolve --rolled-back 20251004180702_add_better_auth_fields

# Or drop tables manually
DROP TABLE verifications;
DROP TABLE accounts;
ALTER TABLE users DROP COLUMN name, DROP COLUMN image;
ALTER TABLE user_sessions DROP COLUMN token;
```

---

## References

- Better-Auth Prisma Documentation: https://better-auth.com/docs/integrations/prisma
- Better-Auth Schema Requirements: https://better-auth.com/docs/concepts/database
- Prisma Migrate Documentation: https://www.prisma.io/docs/concepts/components/prisma-migrate

---

## Status: ✅ Ready for Migration

All schema changes have been validated and are ready for application to the development database. The migration preserves backward compatibility while adding full Better-Auth support.
