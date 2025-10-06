# Keycloak + Local Database Synchronization Guide

## 📋 Architecture Overview

### Two Database System

Your application uses a **dual-database architecture**:

1. **Keycloak Database (External IAM)**

   - Manages authentication and user credentials
   - Stores tokens, sessions, OAuth providers
   - Handles password hashing, MFA, SSO
   - **Source of truth for authentication**

2. **Application Database (PostgreSQL)**
   - Stores business logic data
   - User profiles with application-specific fields
   - Relationships (stores, carts, orders, etc.)
   - Application sessions with Keycloak references
   - **Source of truth for business data**

---

## 🔄 User Synchronization Flows

### Flow 1: User Registration (Sign Up)

```
┌─────────────┐
│   Sign Up   │
│  Form Data  │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│  1. Create User in Keycloak     │
│     - Username, email, password  │
│     - Returns: keycloakUserId    │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  2. Create User in Local DB     │
│     - Use keycloakUserId as PK  │
│     - Store application data     │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  Success: User Ready            │
│  Failure: Rollback Keycloak     │
└─────────────────────────────────┘
```

### Flow 2: User Authentication (Login)

```
┌─────────────┐
│    Login    │
│  Credentials│
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────┐
│  1. Authenticate with Keycloak  │
│     - Verify credentials         │
│     - Returns: tokens + user info│
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  2. Sync User to Local DB       │
│     - Upsert user data           │
│     - Update lastLoginAt         │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  3. Create Local Session        │
│     - Store tokens securely      │
│     - Link to Keycloak session   │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  Success: User Authenticated    │
└─────────────────────────────────┘
```

---

## 💻 Implementation

### 1. Registration Flow

```typescript
import { UserSyncService } from "@libs/keycloak-authV2/services/sync";
import { KeycloakIntegrationService } from "@libs/keycloak-authV2";
import { PrismaClient } from "@libs/database";

// Initialize services
const prisma = new PrismaClient();
const keycloakService = KeycloakIntegrationService.create(
  keycloakOptions,
  dbClient,
  metrics
);
const userSyncService = new UserSyncService(
  keycloakService.userRepository, // Access to Keycloak user operations
  prisma,
  metrics
);

// Registration endpoint
app.post("/auth/register", async (req, res) => {
  const { username, email, password, firstName, lastName, storeId } = req.body;

  try {
    // Register user (creates in both Keycloak + local DB)
    const result = await userSyncService.registerUser({
      username,
      email,
      password,
      firstName,
      lastName,
      storeId,
      emailVerified: false,
      enabled: true,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(201).json({
      message: "User registered successfully",
      userId: result.userId,
      user: result.localUser,
    });
  } catch (error) {
    console.error("Registration failed:", error);
    return res.status(500).json({ error: "Registration failed" });
  }
});
```

### 2. Authentication Flow

```typescript
// Login endpoint
app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const { ip, userAgent } = req;

  try {
    // Step 1: Authenticate with Keycloak
    const authResult = await keycloakService.authenticateWithPassword(
      username,
      password,
      {
        ipAddress: ip,
        userAgent: userAgent,
        sessionId: generateSessionId(), // Your session ID generator
      }
    );

    if (!authResult.success || !authResult.tokens) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Step 2: Sync user and create local session
    const { user, session } = await userSyncService.syncOnAuthentication({
      keycloakUserId: authResult.userId,
      email: authResult.email,
      username: authResult.username,
      firstName: authResult.firstName,
      lastName: authResult.lastName,
      emailVerified: authResult.emailVerified,
      storeId: req.body.storeId, // If applicable
      sessionData: {
        sessionId: authResult.sessionId,
        keycloakSessionId: authResult.tokens.session_state,
        accessToken: authResult.tokens.access_token,
        refreshToken: authResult.tokens.refresh_token,
        idToken: authResult.tokens.id_token,
        tokenExpiresAt: new Date(
          Date.now() + authResult.tokens.expires_in * 1000
        ),
        refreshExpiresAt: new Date(
          Date.now() + authResult.tokens.refresh_expires_in * 1000
        ),
        ipAddress: ip,
        userAgent: userAgent,
      },
    });

    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      tokens: authResult.tokens,
      sessionId: session.sessionId,
    });
  } catch (error) {
    console.error("Login failed:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});
```

### 3. Token Refresh Flow

```typescript
app.post("/auth/refresh", async (req, res) => {
  const { refreshToken, sessionId } = req.body;

  try {
    // Refresh tokens with Keycloak
    const newTokens = await keycloakService.refreshToken(refreshToken);

    // Update local session with new tokens
    await userSyncService.updateSessionTokens(sessionId, {
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token,
      idToken: newTokens.id_token,
      tokenExpiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
      refreshExpiresAt: new Date(
        Date.now() + newTokens.refresh_expires_in * 1000
      ),
    });

    return res.status(200).json({ tokens: newTokens });
  } catch (error) {
    console.error("Token refresh failed:", error);
    return res.status(401).json({ error: "Token refresh failed" });
  }
});
```

### 4. Logout Flow

```typescript
app.post("/auth/logout", async (req, res) => {
  const { sessionId, refreshToken } = req.body;

  try {
    // Logout from Keycloak
    await keycloakService.logout(refreshToken);

    // End local session
    await userSyncService.endSession(sessionId);

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout failed:", error);
    return res.status(500).json({ error: "Logout failed" });
  }
});
```

---

## 🔧 Migration: Sync Existing Users

If you already have users in Keycloak and need to sync them to your local database:

```typescript
import { UserSyncService } from "@libs/keycloak-authV2/services/sync";

async function migrateExistingUsers() {
  const userSyncService = new UserSyncService(
    keycloakUserRepository,
    prisma,
    metrics
  );

  // Get all Keycloak users
  const keycloakUsers = await keycloakUserRepository.searchUsers({
    max: 1000, // Adjust based on your needs
  });

  const userIds = keycloakUsers.map((user) => user.id!);

  // Bulk sync
  const result = await userSyncService.bulkSyncUsers(userIds);

  console.log(`Successfully synced: ${result.successful.length} users`);
  console.log(`Failed to sync: ${result.failed.length} users`);

  // Log failures
  result.failed.forEach(({ userId, error }) => {
    console.error(`Failed to sync user ${userId}:`, error);
  });
}

// Run migration
migrateExistingUsers().catch(console.error);
```

---

## 📊 Data Flow Summary

### What Keycloak Manages:

- ✅ User credentials (passwords)
- ✅ Authentication tokens (JWT)
- ✅ OAuth/SAML integration
- ✅ Password reset flows
- ✅ Email verification tokens
- ✅ Identity provider links

### What Your Local DB Manages:

- ✅ Application-specific user data (storeId, organizationId)
- ✅ Business relationships (user → cart, user → orders)
- ✅ Application sessions (with Keycloak token references)
- ✅ User activity logs
- ✅ Application-level roles and permissions
- ✅ Custom user metadata

### What Gets Synced:

- ✅ Basic user info (email, username, first/last name)
- ✅ Email verification status
- ✅ User enabled/disabled status
- ✅ Last login timestamp
- ✅ Login count

---

## 🎯 Best Practices

### 1. Use Keycloak User ID as Primary Key

```typescript
// Local user table uses Keycloak ID
id: keycloakUserId, // e.g., "f:12345678-1234-1234-1234-123456789012:johndoe"
```

### 2. Never Store Passwords Locally

```typescript
// Password field in local DB should always be empty or a placeholder
password: "", // Keycloak manages this
```

### 3. Encrypt Sensitive Tokens

```typescript
// Use encryption for storing tokens in local DB
accessToken: await encryptionService.encrypt(tokens.access_token),
refreshToken: await encryptionService.encrypt(tokens.refresh_token),
```

### 4. Handle Sync Failures Gracefully

```typescript
// Always rollback on failure
if (!localUserCreated) {
  await keycloakUserRepository.deleteUser(keycloakUserId);
}
```

### 5. Keep Sessions in Sync

```typescript
// Always update local session when tokens are refreshed
await userSyncService.updateSessionTokens(sessionId, newTokens);
```

---

## 🚀 Integration with Existing Services

### API Gateway Integration

```typescript
// apps/api-gateway/src/routes/auth.ts
import { UserSyncService } from "@libs/keycloak-authV2/services/sync";

const authRoutes = (app: Elysia) => {
  const userSyncService = new UserSyncService(
    keycloakUserRepo,
    prisma,
    metrics
  );

  return app.group("/auth", (auth) =>
    auth
      .post("/register", async ({ body }) => {
        // Use userSyncService.registerUser()
      })
      .post("/login", async ({ body }) => {
        // Use userSyncService.syncOnAuthentication()
      })
  );
};
```

---

## ✅ Summary

**Should you update your local DB?** → **YES, always!**

1. **On Registration**: Create in both Keycloak AND local DB
2. **On Login**: Sync user data from Keycloak to local DB + create session
3. **On Token Refresh**: Update session tokens in local DB
4. **On Logout**: Mark session as ended in local DB

This ensures your application has the data it needs for business logic while Keycloak handles all authentication concerns.

**The `UserSyncService` handles all of this automatically!** 🎉
