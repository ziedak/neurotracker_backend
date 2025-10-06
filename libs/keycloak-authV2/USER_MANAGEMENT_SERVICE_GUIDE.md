# UserManagementService Usage Guide

## Overview

The `UserManagementService` is a **bridge pattern** that coordinates user operations across **Keycloak** (authentication) and **Local PostgreSQL** (user data), providing a single, unified interface for user management.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│         Application Layer (API Gateway)                 │
└────────────────────────────────────────────────────────┘
                      ↓
┌────────────────────────────────────────────────────────┐
│         UserManagementService (Bridge)                  │
│  - Coordinates between Keycloak & Local DB              │
│  - Single entry point for user operations               │
│  - Local DB = Source of truth for user data            │
│  - Keycloak = Source of truth for authentication       │
└────────────────────────────────────────────────────────┘
         ↓                                  ↓
┌────────────────────┐         ┌───────────────────────┐
│   Keycloak Side    │         │    Local DB Side      │
│  (Authentication)  │         │   (User Data)         │
├────────────────────┤         ├───────────────────────┤
│ KeycloakUserService│         │ UserRepository        │
│ UserRepository     │         │ (from @libs/database) │
│ (Keycloak ops)     │         │                       │
└────────────────────┘         └───────────────────────┘
```

## Key Principles

✅ **Local DB is source of truth for user data** (profile, status, relationships)
✅ **Keycloak is source of truth for authentication** (credentials, tokens, sessions)
✅ **IDs are synchronized** (Keycloak user ID = Local DB user ID)
✅ **Best-effort sync** (Local DB operations succeed even if Keycloak sync fails)
✅ **Rollback on failure** (If Keycloak creation fails, local DB user is deleted)

---

## Setup

### 1. Initialize Dependencies

```typescript
import { PrismaClient } from "@prisma/client";
import { KeycloakClient } from "@libs/keycloak-authV2";
import {
  UserManagementService,
  KeycloakUserService,
} from "@libs/keycloak-authV2/services";
import { createMetricsCollector } from "@libs/monitoring";

// Initialize Prisma
const prisma = new PrismaClient();

// Initialize Keycloak
const keycloakClient = new KeycloakClient({
  serverUrl: process.env.KEYCLOAK_SERVER_URL!,
  realm: process.env.KEYCLOAK_REALM!,
  clientId: process.env.KEYCLOAK_CLIENT_ID!,
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
  scopes: ["openid", "profile", "email"],
});

// Initialize Keycloak User Service
const keycloakUserService = KeycloakUserService.create(
  keycloakClient,
  config,
  cacheService,
  metrics
);

// Initialize User Management Service
const userManagementService = UserManagementService.create(
  keycloakClient,
  keycloakUserService,
  prisma,
  metrics
);
```

---

## Usage Examples

### 1. Register New User

Creates user in **both** Keycloak and Local DB:

```typescript
try {
  const user = await userManagementService.registerUser({
    username: "john.doe",
    email: "john@example.com",
    password: "SecurePassword123!", // Stored only in Keycloak
    firstName: "John",
    lastName: "Doe",
    phone: "+1234567890",
    storeId: "store-123", // Local DB relationship
    roleId: "role-456", // Local DB relationship
    realmRoles: ["user", "customer"], // Keycloak roles
  });

  console.log("User registered:", user.id);
  console.log("User status:", user.status); // "ACTIVE"
} catch (error) {
  console.error("Registration failed:", error.message);
  // Rollback is automatic if Keycloak creation fails
}
```

**Flow:**

1. Validates username/email uniqueness
2. Creates user in **Local DB** (status: PENDING)
3. Creates user in **Keycloak** with same ID
4. Updates user status to **ACTIVE**
5. **Rollback**: Deletes local user if Keycloak creation fails

---

### 2. Authenticate User

Verifies credentials with Keycloak, returns user from Local DB:

```typescript
try {
  const result = await userManagementService.authenticateUser(
    "john.doe",
    "SecurePassword123!"
  );

  console.log("User authenticated:", result.user.id);
  console.log("Access token:", result.tokens.accessToken);
  console.log("Expires in:", result.tokens.expiresIn);

  // Use user data from local DB
  console.log("User store:", result.user.storeId);
  console.log("User role:", result.user.roleId);
} catch (error) {
  console.error("Authentication failed:", error.message);
  // Possible reasons:
  // - Invalid credentials (Keycloak)
  // - User not found in local DB
  // - User status is BANNED/DELETED/INACTIVE
}
```

**Flow:**

1. Authenticates with **Keycloak** (verifies credentials)
2. Gets user from **Local DB** (source of truth for user data)
3. Validates user status (ACTIVE check)
4. Updates last login timestamp in Local DB
5. Returns user + tokens

---

### 3. Get User by ID/Email/Username

```typescript
// Get by ID
const user = await userManagementService.getUserById("user-123");

// Get by email
const user = await userManagementService.getUserByEmail("john@example.com");

// Get by username
const user = await userManagementService.getUserByUsername("john.doe");

if (user) {
  console.log("User found:", user.username);
  console.log("Store:", user.storeId);
  console.log("Status:", user.status);
}
```

**Note:** All queries run against **Local DB** (source of truth).

---

### 4. Update User

Updates in **both** Keycloak and Local DB:

```typescript
try {
  const updatedUser = await userManagementService.updateUser("user-123", {
    firstName: "Jonathan",
    lastName: "Doe-Smith",
    email: "jonathan@example.com",
    phone: "+9876543210",
    status: "ACTIVE",
  });

  console.log("User updated:", updatedUser.id);
} catch (error) {
  console.error("Update failed:", error.message);
}
```

**Flow:**

1. Updates in **Local DB** (source of truth)
2. Syncs relevant fields to **Keycloak** (best effort)
3. **Non-blocking**: If Keycloak sync fails, logs warning but doesn't throw

**Fields synced to Keycloak:**

- `username`
- `email`
- `firstName`
- `lastName`
- `status` → `enabled` (ACTIVE = true)

---

### 5. Update Password

Updates password **only** in Keycloak (passwords never stored in Local DB):

```typescript
try {
  await userManagementService.updatePassword("user-123", "NewPassword456!");
  console.log("Password updated successfully");
} catch (error) {
  console.error("Password update failed:", error.message);
}
```

---

### 6. Delete User

Soft delete in Local DB, hard delete from Keycloak:

```typescript
try {
  await userManagementService.deleteUser("user-123", "admin-id");
  console.log("User deleted");
} catch (error) {
  console.error("Deletion failed:", error.message);
}
```

**Flow:**

1. **Soft deletes** from Local DB (sets `isDeleted: true`, keeps data for audit)
2. **Hard deletes** from Keycloak (removes authentication)
3. **Non-blocking**: If Keycloak deletion fails, logs warning but doesn't throw

---

### 7. Restore Deleted User

Restores soft-deleted user:

```typescript
try {
  const restoredUser = await userManagementService.restoreUser(
    "user-123",
    "admin-id"
  );
  console.log("User restored:", restoredUser.status);
} catch (error) {
  console.error("Restoration failed:", error.message);
}
```

**Note:** You'll need to manually recreate the user in Keycloak if needed.

---

### 8. Search Users

Searches in **Local DB**:

```typescript
const users = await userManagementService.searchUsers({
  storeId: "store-123",
  status: "ACTIVE",
  skip: 0,
  take: 10,
  includeDeleted: false,
});

console.log(`Found ${users.length} users`);
users.forEach((user) => {
  console.log(`- ${user.username} (${user.email})`);
});
```

---

### 9. Get User Statistics

```typescript
const stats = await userManagementService.getUserStats();

console.log("Total users:", stats.totalUsers);
console.log("Active users:", stats.activeUsers);
console.log("Deleted users:", stats.deletedUsers);
```

---

### 10. Manage Keycloak Roles

Assigns/removes roles in **Keycloak** (for authorization):

```typescript
// Assign realm roles
await userManagementService.assignRealmRoles("user-123", [
  "customer",
  "premium",
]);

// Remove realm roles
await userManagementService.removeRealmRoles("user-123", ["premium"]);
```

**Note:** These are **Keycloak roles** for authentication/authorization. **Local DB roles** (via `roleId`) are for business logic.

---

### 11. Token Management

```typescript
// Refresh tokens
const newTokens = await userManagementService.refreshTokens(refreshToken);
console.log("New access token:", newTokens.tokens.accessToken);

// Logout (revoke tokens)
await userManagementService.logout(refreshToken);
console.log("User logged out");
```

---

## API Gateway Integration

### Example: Registration Endpoint

```typescript
import { Elysia } from "elysia";
import { userManagementService } from "./services";

const app = new Elysia()
  .post("/auth/register", async ({ body }) => {
    try {
      const user = await userManagementService.registerUser({
        username: body.username,
        email: body.email,
        password: body.password,
        firstName: body.firstName,
        lastName: body.lastName,
        storeId: body.storeId,
      });

      return {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          status: user.status,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  })
  .listen(3000);
```

### Example: Login Endpoint

```typescript
app.post("/auth/login", async ({ body }) => {
  try {
    const result = await userManagementService.authenticateUser(
      body.username,
      body.password
    );

    return {
      success: true,
      user: {
        id: result.user.id,
        username: result.user.username,
        email: result.user.email,
        storeId: result.user.storeId,
      },
      tokens: {
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresIn: result.tokens.expiresIn,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});
```

---

## Error Handling

### Common Errors

```typescript
try {
  await userManagementService.registerUser(data);
} catch (error) {
  if (error.message.includes("already exists")) {
    // Username or email already taken
    return { error: "User already exists", code: "USER_EXISTS" };
  } else if (error.message.includes("Keycloak")) {
    // Keycloak integration issue
    return {
      error: "Authentication service error",
      code: "AUTH_SERVICE_ERROR",
    };
  } else {
    // Other error
    return { error: "Registration failed", code: "REGISTRATION_ERROR" };
  }
}
```

---

## Best Practices

### ✅ DO:

- Use `UserManagementService` as single entry point for user operations
- Handle authentication errors gracefully
- Validate user status before allowing operations
- Use local DB queries for user data lookups
- Leverage Keycloak for authentication/authorization
- Monitor metrics for performance tracking

### ❌ DON'T:

- Store passwords in local DB (always use Keycloak)
- Query Keycloak directly for user data (use local DB)
- Assume Keycloak sync always succeeds (best-effort pattern)
- Mix Keycloak roles with local DB roles (separate concerns)
- Bypass UserManagementService for user operations

---

## Metrics

The service automatically records metrics:

- `user_management.register_user_success`
- `user_management.register_user_failure`
- `user_management.register_user_rollback`
- `user_management.authenticate_user_success`
- `user_management.authenticate_user_failure`
- `user_management.update_user_success`
- `user_management.delete_user_success`
- `user_management.sync_keycloak_warning`

---

## Conclusion

The `UserManagementService` provides a **clean, unified interface** for managing users across Keycloak and your local database, following the **Bridge Pattern** to coordinate between authentication (Keycloak) and user data (Local DB).

**Key Takeaways:**

- 🎯 Single entry point for all user operations
- 🔄 Automatic synchronization between Keycloak and Local DB
- 🛡️ Rollback protection on failures
- 📊 Built-in metrics and logging
- ✅ SOLID principles and clean architecture
