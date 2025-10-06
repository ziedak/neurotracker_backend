# ✅ Keycloak + Local DB: Quick Answer

## 🎯 Your Questions Answered

### Q: Does Keycloak have its own DB for users?

**A: YES** - Keycloak has its own database that stores:

- User credentials (usernames, passwords)
- Authentication tokens
- OAuth/SAML provider data
- Roles and permissions (Keycloak's RBAC)

### Q: Should I update my local DB?

**A: YES, ABSOLUTELY!** - You need to sync users to your local database because:

1. Your application logic needs user data (store relationships, carts, orders)
2. You need to track application-specific information
3. You need fast local queries without hitting Keycloak every time

### Q: But isn't it only about authentication?

**A: NO, it's about BOTH authentication AND registration!**

---

## 🔑 The Complete Picture

### Two Scenarios Where You Update Local DB:

#### 1. **Registration (Sign Up)** ✨

```
User Signs Up
    ↓
Create in Keycloak ← (stores password, handles auth)
    ↓
Create in Local DB ← (stores app data, relationships)
    ↓
User Ready!
```

#### 2. **Authentication (Login)** 🔐

```
User Logs In
    ↓
Verify with Keycloak ← (checks password, issues tokens)
    ↓
Sync to Local DB ← (update last login, create session)
    ↓
User Authenticated!
```

---

## 💡 Solution: UserSyncService

I've created `UserSyncService` that handles BOTH flows automatically:

### ✅ What It Does:

1. **Registration**: Creates user in **both** Keycloak and local DB atomically
2. **Login**: Syncs user data from Keycloak to local DB + creates session
3. **Rollback**: If local DB fails, it removes the Keycloak user (data consistency)
4. **Session Management**: Keeps sessions in sync with Keycloak tokens

### 📁 Files Created:

```
libs/keycloak-authV2/src/services/sync/
├── UserSyncService.ts          ← Main sync service
├── index.ts                    ← Exports
└── USER_SYNC_GUIDE.md          ← Complete documentation
```

---

## 🚀 Quick Start

### 1. Initialize the Service

```typescript
import { UserSyncService } from "@libs/keycloak-authV2/services/sync";
import { PrismaClient } from "@libs/database";

const userSyncService = new UserSyncService(
  keycloakUserRepository, // Your Keycloak user repo
  new PrismaClient(), // Your Prisma client
  metricsCollector // Optional metrics
);
```

### 2. Handle Registration

```typescript
// When user signs up
const result = await userSyncService.registerUser({
  username: "john.doe",
  email: "john@example.com",
  password: "securePassword123",
  firstName: "John",
  lastName: "Doe",
  storeId: "store-123",
});

// result.success = true
// result.userId = "keycloak-user-id"
// result.localUser = { ...user data from your DB }
```

### 3. Handle Login

```typescript
// When user logs in (after Keycloak authentication)
const { user, session } = await userSyncService.syncOnAuthentication({
  keycloakUserId: authResult.userId,
  email: authResult.email,
  username: authResult.username,
  sessionData: {
    sessionId: "unique-session-id",
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    // ... other session data
  },
});

// user = updated user from your local DB
// session = new session record in your DB
```

---

## 📊 Data Architecture

### Keycloak Database (External)

```
Users Table:
- id (UUID)
- username
- email
- password_hash ← ONLY Keycloak knows this!
- enabled
- email_verified
```

### Your Local Database (PostgreSQL)

```
users Table:
- id (same as Keycloak id!) ← KEY POINT
- email
- username
- firstName
- lastName
- storeId ← Your business data
- lastLoginAt
- loginCount
- ... your custom fields

user_sessions Table:
- id
- userId (references users)
- keycloakSessionId ← Link to Keycloak
- accessToken
- refreshToken
- tokenExpiresAt
- isActive
```

---

## 🎯 Key Principles

1. **Use Keycloak User ID as your local user ID** → No mapping table needed!
2. **Never store passwords locally** → Keycloak manages that
3. **Sync on every login** → Keep data fresh
4. **Create session locally** → Track application sessions
5. **Handle failures atomically** → Rollback if anything fails

---

## 📖 Next Steps

1. **Read**: `/libs/keycloak-authV2/USER_SYNC_GUIDE.md` for complete documentation
2. **Review**: `UserSyncService.ts` for implementation details
3. **Example**: `AuthService.example.ts` for integration patterns
4. **Integrate**: Add to your API Gateway authentication routes

---

## 🎉 Summary

**YES**, you need to update your local DB for **BOTH**:

- ✅ **Registration** (create user in both systems)
- ✅ **Authentication** (sync user data + create session)

The `UserSyncService` I created handles all of this automatically with:

- Atomic operations (rollback on failure)
- Proper error handling
- Metrics tracking
- Session management
- Token synchronization

**You're now ready to implement complete authentication! 🚀**
