# Implementation Guide: Using Existing UserRepository ✅

## 🎯 You Already Have Everything!

Your existing infrastructure is **perfect** for local DB as source of truth:

- ✅ `libs/database/src/models/user.ts` - Complete User model
- ✅ `libs/database/src/postgress/repositories/user.ts` - Full-featured UserRepository
- ✅ BaseRepository pattern with metrics, caching, transactions
- ✅ Zod validation schemas
- ✅ Comprehensive CRUD operations

**No need to reinvent the wheel!**

---

## 🏗️ Architecture: Leverage What You Have

```
┌──────────────────────────────────────────────────┐
│         Authentication Layer (New)                │
│  ┌────────────────────────────────────────────┐  │
│  │  KeycloakAuthService                       │  │
│  │  - authenticate()                          │  │
│  │  - createAuthUser()                        │  │
│  │  - refreshToken()                          │  │
│  │  - logout()                                │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────┐
│       User Management Layer (Existing!)           │
│  ┌────────────────────────────────────────────┐  │
│  │  UserRepository (from @libs/database)      │  │
│  │  - create(), findById(), findByEmail()     │  │
│  │  - update(), softDelete(), restore()       │  │
│  │  - updateLastLogin()                       │  │
│  │  - findByRole(), findByStatus()            │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                      ↓
┌──────────────────────────────────────────────────┐
│         Database Layer (Existing!)                │
│  PostgreSQL + Prisma + Cache                      │
└──────────────────────────────────────────────────┘
```

---

## 💻 Implementation

### Step 1: Create KeycloakAuthService (Thin Authentication Wrapper)

```typescript
// libs/keycloak-authV2/src/services/auth/KeycloakAuthService.ts

import { KeycloakClient } from "../../client/KeycloakClient";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
  refresh_expires_in?: number;
  session_state?: string;
}

/**
 * KeycloakAuthService - ONLY handles authentication
 * Does NOT manage user data (that's in UserRepository from @libs/database)
 */
export class KeycloakAuthService {
  private readonly logger = createLogger("KeycloakAuthService");

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Create auth user in Keycloak (credentials only)
   * Uses local DB user ID to keep them in sync
   */
  async createAuthUser(data: {
    id: string; // Use ID from UserRepository.create()
    username: string;
    email: string;
    password: string;
  }): Promise<void> {
    const startTime = performance.now();

    try {
      await this.keycloakClient.users.create({
        id: data.id,
        username: data.username,
        email: data.email,
        enabled: true,
        credentials: [
          {
            type: "password",
            value: data.password,
            temporary: false,
          },
        ],
      });

      this.metrics?.recordTimer(
        "keycloak_auth.create_auth_user",
        performance.now() - startTime
      );
      this.logger.info("Auth user created in Keycloak", { userId: data.id });
    } catch (error) {
      this.logger.error("Failed to create auth user", {
        error,
        userId: data.id,
      });
      throw error;
    }
  }

  /**
   * Authenticate user (verify credentials)
   */
  async authenticate(
    username: string,
    password: string
  ): Promise<TokenResponse> {
    const startTime = performance.now();

    try {
      const tokens = await this.keycloakClient.auth.passwordGrant(
        username,
        password
      );

      this.metrics?.recordTimer(
        "keycloak_auth.authenticate",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("keycloak_auth.authenticate_success", 1);
      this.logger.info("User authenticated", { username });

      return tokens;
    } catch (error) {
      this.metrics?.recordCounter("keycloak_auth.authenticate_failure", 1);
      this.logger.error("Authentication failed", { error, username });
      throw error;
    }
  }

  /**
   * Update auth user credentials in Keycloak
   */
  async updateAuthUser(
    id: string,
    data: {
      username?: string;
      email?: string;
      password?: string;
    }
  ): Promise<void> {
    try {
      await this.keycloakClient.users.update(id, {
        username: data.username,
        email: data.email,
        ...(data.password && {
          credentials: [
            {
              type: "password",
              value: data.password,
              temporary: false,
            },
          ],
        }),
      });

      this.logger.info("Auth user updated in Keycloak", { userId: id });
    } catch (error) {
      this.logger.error("Failed to update auth user", { error, userId: id });
      throw error;
    }
  }

  /**
   * Delete auth user from Keycloak
   */
  async deleteAuthUser(id: string): Promise<void> {
    try {
      await this.keycloakClient.users.delete(id);
      this.logger.info("Auth user deleted from Keycloak", { userId: id });
    } catch (error) {
      this.logger.error("Failed to delete auth user", { error, userId: id });
      // Don't throw - user is deleted from local DB, Keycloak cleanup is best-effort
    }
  }

  /**
   * Refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    try {
      return await this.keycloakClient.auth.refreshToken(refreshToken);
    } catch (error) {
      this.logger.error("Token refresh failed", { error });
      throw error;
    }
  }

  /**
   * Logout
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      await this.keycloakClient.auth.logout(refreshToken);
      this.logger.info("User logged out from Keycloak");
    } catch (error) {
      this.logger.error("Logout failed", { error });
      // Don't throw - logout should succeed even if Keycloak fails
    }
  }

  /**
   * Verify token
   */
  async verifyToken(accessToken: string): Promise<boolean> {
    try {
      const introspection = await this.keycloakClient.auth.introspect(
        accessToken
      );
      return introspection.active === true;
    } catch {
      return false;
    }
  }
}
```

### Step 2: Create Unified AuthService (Orchestrates Both)

```typescript
// libs/keycloak-authV2/src/services/auth/AuthService.ts

import { UserRepository } from "@libs/database/repositories";
import { KeycloakAuthService } from "./KeycloakAuthService";
import type { User, UserCreateInput } from "@libs/database/models";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";

/**
 * AuthService - Orchestrates user management and authentication
 * Uses existing UserRepository from @libs/database
 */
export class AuthService {
  private readonly logger = createLogger("AuthService");

  constructor(
    private readonly userRepository: UserRepository,
    private readonly keycloakAuth: KeycloakAuthService,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Register new user
   * 1. Create in local DB (source of truth) - using your existing UserRepository
   * 2. Sync credentials to Keycloak (for auth)
   */
  async register(data: {
    username: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    storeId?: string;
    organizationId?: string;
    roleId?: string;
  }): Promise<User> {
    const startTime = performance.now();

    try {
      // 1. Create user in LOCAL DB (source of truth) using YOUR UserRepository
      const userInput: UserCreateInput = {
        username: data.username,
        email: data.email,
        password: "", // Don't store password locally
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        phone: data.phone ?? null,
        emailVerified: false,
        phoneVerified: false,
        status: "PENDING", // or "ACTIVE" based on your flow
        storeId: data.storeId ?? null,
        organizationId: data.organizationId ?? null,
        roleId: data.roleId ?? null,
        isDeleted: false,
      };

      const user = await this.userRepository.create(userInput);
      this.logger.info("User created in local DB", { userId: user.id });

      // 2. Sync to Keycloak for authentication
      try {
        await this.keycloakAuth.createAuthUser({
          id: user.id, // Use same ID!
          username: user.username,
          email: user.email,
          password: data.password,
        });
      } catch (keycloakError) {
        // Rollback: Delete local user if Keycloak fails
        await this.userRepository.deleteById(user.id);
        throw new Error(`Failed to create auth user: ${keycloakError}`);
      }

      this.metrics?.recordTimer(
        "auth_service.register",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("auth_service.register_success", 1);

      return user;
    } catch (error) {
      this.metrics?.recordCounter("auth_service.register_failure", 1);
      this.logger.error("Registration failed", { error });
      throw error;
    }
  }

  /**
   * Login user
   * 1. Authenticate with Keycloak (verify credentials)
   * 2. Get user from local DB (source of truth) using YOUR UserRepository
   * 3. Update login tracking using YOUR UserRepository
   */
  async login(
    username: string,
    password: string
  ): Promise<{
    user: User;
    tokens: {
      accessToken: string;
      refreshToken: string;
      idToken?: string;
      expiresIn: number;
    };
  }> {
    const startTime = performance.now();

    try {
      // 1. Authenticate with Keycloak (verify credentials)
      const tokens = await this.keycloakAuth.authenticate(username, password);

      // 2. Get user from LOCAL DB (source of truth) - YOUR UserRepository!
      const user = await this.userRepository.findByUsername(username);

      if (!user) {
        throw new Error("User not found in local database");
      }

      // Check user status
      if (user.status === "BANNED") {
        throw new Error("User account is banned");
      }
      if (user.status === "DELETED") {
        throw new Error("User account is deleted");
      }

      // 3. Update login tracking - YOUR UserRepository has this method!
      await this.userRepository.updateLastLogin(user.id);

      this.metrics?.recordTimer(
        "auth_service.login",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("auth_service.login_success", 1);
      this.logger.info("User logged in", { userId: user.id });

      return {
        user,
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          idToken: tokens.id_token,
          expiresIn: tokens.expires_in,
        },
      };
    } catch (error) {
      this.metrics?.recordCounter("auth_service.login_failure", 1);
      this.logger.error("Login failed", { error, username });
      throw error;
    }
  }

  /**
   * Update user (using YOUR UserRepository)
   */
  async updateUser(
    userId: string,
    data: {
      username?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      status?: "ACTIVE" | "INACTIVE" | "BANNED" | "DELETED";
    }
  ): Promise<User> {
    try {
      // 1. Update in LOCAL DB using YOUR UserRepository
      const user = await this.userRepository.updateById(userId, data);

      // 2. Sync relevant changes to Keycloak
      if (data.username || data.email) {
        await this.keycloakAuth.updateAuthUser(userId, {
          username: data.username,
          email: data.email,
        });
      }

      this.logger.info("User updated", { userId });
      return user;
    } catch (error) {
      this.logger.error("Update failed", { error, userId });
      throw error;
    }
  }

  /**
   * Update password (Keycloak only, no local storage)
   */
  async updatePassword(userId: string, newPassword: string): Promise<void> {
    try {
      await this.keycloakAuth.updateAuthUser(userId, {
        password: newPassword,
      });
      this.logger.info("Password updated", { userId });
    } catch (error) {
      this.logger.error("Password update failed", { error, userId });
      throw error;
    }
  }

  /**
   * Delete user (using YOUR UserRepository's softDelete)
   */
  async deleteUser(userId: string, deletedBy: string): Promise<void> {
    try {
      // 1. Soft delete in LOCAL DB using YOUR UserRepository
      await this.userRepository.softDelete(userId, deletedBy);

      // 2. Delete from Keycloak (best effort)
      await this.keycloakAuth.deleteAuthUser(userId);

      this.logger.info("User deleted", { userId });
    } catch (error) {
      this.logger.error("Delete failed", { error, userId });
      throw error;
    }
  }

  /**
   * Logout
   */
  async logout(refreshToken: string): Promise<void> {
    await this.keycloakAuth.logout(refreshToken);
  }

  /**
   * Refresh tokens
   */
  async refreshToken(refreshToken: string) {
    return await this.keycloakAuth.refreshToken(refreshToken);
  }

  /**
   * Get user by ID (using YOUR UserRepository)
   */
  async getUserById(userId: string): Promise<User | null> {
    return await this.userRepository.findById(userId);
  }

  /**
   * Get user by email (using YOUR UserRepository)
   */
  async getUserByEmail(email: string): Promise<User | null> {
    return await this.userRepository.findByEmail(email);
  }

  /**
   * Search users (using YOUR UserRepository)
   */
  async searchUsers(options: {
    storeId?: string;
    roleId?: string;
    status?: "ACTIVE" | "INACTIVE" | "BANNED" | "DELETED";
    skip?: number;
    take?: number;
  }): Promise<User[]> {
    return await this.userRepository.findMany({
      where: options,
      skip: options.skip,
      take: options.take,
    });
  }
}
```

### Step 3: Usage Example

```typescript
// Example: Initialize in your API Gateway
import { UserRepository } from "@libs/database/repositories";
import { DatabaseClient } from "@libs/database";
import { KeycloakAuthService } from "@libs/keycloak-authV2/services/auth/KeycloakAuthService";
import { AuthService } from "@libs/keycloak-authV2/services/auth/AuthService";
import { KeycloakClient } from "@libs/keycloak-authV2/client/KeycloakClient";

// Your existing database client
const dbClient = new DatabaseClient();

// Your existing UserRepository (no changes needed!)
const userRepository = new UserRepository(
  dbClient,
  metricsCollector,
  cacheService
);

// New: Keycloak authentication service
const keycloakClient = new KeycloakClient(keycloakConfig);
const keycloakAuthService = new KeycloakAuthService(
  keycloakClient,
  metricsCollector
);

// New: Unified auth service
const authService = new AuthService(
  userRepository, // Your existing repo!
  keycloakAuthService,
  metricsCollector
);

// Usage in routes
app.post("/auth/register", async (req, res) => {
  const { username, email, password, firstName, lastName, storeId } = req.body;

  const user = await authService.register({
    username,
    email,
    password,
    firstName,
    lastName,
    storeId,
  });

  return res.json({ user });
});

app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;

  const { user, tokens } = await authService.login(username, password);

  return res.json({ user, tokens });
});

// All user queries use YOUR existing repository!
app.get("/users/:id", async (req, res) => {
  const user = await userRepository.findById(req.params.id);
  return res.json({ user });
});
```

---

## ✅ What This Gives You

### Using Your Existing Infrastructure:

✅ **UserRepository** - Already has all methods you need
✅ **User Model** - Already defined with proper types
✅ **Base Repository** - Already has metrics, caching, transactions
✅ **Zod Validation** - Already defined for User operations

### New Additions (Minimal):

✅ **KeycloakAuthService** - Thin wrapper for authentication only (~150 lines)
✅ **AuthService** - Orchestrates your UserRepository + Keycloak (~200 lines)

### Total New Code: ~350 lines

### Reused Code: ~500+ lines from your existing UserRepository

---

## 🎯 Architecture Benefits

1. **No Wheel Reinvention**: Use your existing, tested UserRepository
2. **Single Source of Truth**: Local DB via your UserRepository
3. **Minimal New Code**: Just authentication wrapper + orchestration
4. **Consistent Patterns**: Uses your BaseRepository, models, types
5. **Existing Features**: Metrics, caching, transactions all work!
6. **Clean Separation**: Keycloak = auth service, UserRepository = data management

---

## 📊 Summary

**Don't create UserRepositoryLocal.ts** - You already have a perfect UserRepository!

**What to do:**

1. ✅ Create `KeycloakAuthService` - handles auth only
2. ✅ Create `AuthService` - uses your existing `UserRepository`
3. ✅ Done! Everything else works with your existing models and repositories

**Your existing code provides:**

- User CRUD operations
- Soft delete, restore
- Login tracking
- Role management
- Store filtering
- Batch operations
- Metrics & caching
- Transactions

**You just need authentication wrapper - that's it!** 🎉
