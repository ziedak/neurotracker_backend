# Implementation: Local DB as Source of Truth ⭐

## 🎯 This is the RECOMMENDED solution!

Based on your feedback, this implementation makes Local DB the source of truth with:

- ✅ UserRepository works with local Prisma database
- ✅ Single User model across the entire module
- ✅ Fast local queries (no external API calls)
- ✅ Keycloak used ONLY for authentication
- ✅ Simple, maintainable code

---

## 📁 Files Created

### 1. **UserRepositoryLocal.ts** - Main Repository

```
libs/keycloak-authV2/src/services/user/UserRepositoryLocal.ts
```

**Features:**

- Works directly with Prisma Client
- Standard repository pattern (create, update, delete, search)
- Fast local queries
- Comprehensive search and filtering
- Login tracking
- Soft/hard delete support

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────┐
│              Application Layer                    │
├──────────────────────────────────────────────────┤
│  UserService                                      │
│    ↓                                              │
│  UserRepository ← SOURCE OF TRUTH                 │
│    ↓                                              │
│  Local PostgreSQL Database                        │
│    ↓                                              │
│  Keycloak (only for auth) ← SYNCED               │
└──────────────────────────────────────────────────┘
```

---

## 💻 Complete Implementation

### Step 1: Create KeycloakAuthService (Thin Wrapper)

```typescript
// libs/keycloak-authV2/src/services/auth/KeycloakAuthService.ts

import { KeycloakClient } from "../../client/KeycloakClient";

/**
 * Keycloak Auth Service - ONLY handles authentication
 * Does NOT manage user data (that's in UserRepository)
 */
export class KeycloakAuthService {
  constructor(private readonly keycloakClient: KeycloakClient) {}

  /**
   * Create auth user in Keycloak (credentials only)
   */
  async createAuthUser(data: {
    id: string; // Use local DB ID
    username: string;
    email: string;
    password: string;
  }): Promise<void> {
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
  }

  /**
   * Authenticate user (verify credentials)
   */
  async authenticate(
    username: string,
    password: string
  ): Promise<{
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
    session_state?: string;
  }> {
    return await this.keycloakClient.auth.passwordGrant(username, password);
  }

  /**
   * Update auth user credentials
   */
  async updateAuthUser(
    id: string,
    data: {
      username?: string;
      email?: string;
      password?: string;
    }
  ): Promise<void> {
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
  }

  /**
   * Delete auth user
   */
  async deleteAuthUser(id: string): Promise<void> {
    await this.keycloakClient.users.delete(id);
  }

  /**
   * Refresh token
   */
  async refreshToken(refreshToken: string) {
    return await this.keycloakClient.auth.refreshToken(refreshToken);
  }

  /**
   * Logout
   */
  async logout(refreshToken: string): Promise<void> {
    await this.keycloakClient.auth.logout(refreshToken);
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

### Step 2: Create UserService (Business Logic)

```typescript
// libs/keycloak-authV2/src/services/user/UserService.ts

import { UserRepository } from "./UserRepositoryLocal";
import { KeycloakAuthService } from "../auth/KeycloakAuthService";
import type { User } from "@libs/database";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";

/**
 * UserService - Business logic for user management
 * Local DB is source of truth, Keycloak is synced for auth
 */
export class UserService {
  private readonly logger = createLogger("UserService");

  constructor(
    private readonly userRepository: UserRepository,
    private readonly keycloakAuth: KeycloakAuthService,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Register new user
   */
  async register(data: {
    username: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    storeId?: string;
  }): Promise<User> {
    const startTime = performance.now();

    try {
      // 1. Create user in LOCAL DB (source of truth)
      const user = await this.userRepository.create({
        username: data.username,
        email: data.email,
        password: "", // Don't store password locally
        firstName: data.firstName,
        lastName: data.lastName,
        storeId: data.storeId,
        emailVerified: false,
        status: "ACTIVE",
      });

      // 2. Sync to Keycloak for authentication
      try {
        await this.keycloakAuth.createAuthUser({
          id: user.id, // Use local DB ID
          username: user.username,
          email: user.email,
          password: data.password,
        });
      } catch (keycloakError) {
        // Rollback local user if Keycloak fails
        await this.userRepository.hardDelete(user.id);
        throw new Error(`Failed to create auth user: ${keycloakError}`);
      }

      this.metrics?.recordTimer(
        "user_service.register",
        performance.now() - startTime
      );
      this.logger.info("User registered successfully", { userId: user.id });

      return user;
    } catch (error) {
      this.logger.error("Registration failed", { error });
      throw error;
    }
  }

  /**
   * Get user by ID (from local DB)
   */
  async getById(id: string): Promise<User | null> {
    return await this.userRepository.findById(id);
  }

  /**
   * Get user by username (from local DB)
   */
  async getByUsername(username: string): Promise<User | null> {
    return await this.userRepository.findByUsername(username);
  }

  /**
   * Update user
   */
  async update(
    id: string,
    data: {
      username?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      status?: "ACTIVE" | "INACTIVE" | "BANNED" | "DELETED";
    }
  ): Promise<User> {
    const startTime = performance.now();

    try {
      // 1. Update in LOCAL DB (source of truth)
      const user = await this.userRepository.update(id, data);

      // 2. Sync relevant changes to Keycloak
      if (data.username || data.email) {
        await this.keycloakAuth.updateAuthUser(id, {
          username: data.username,
          email: data.email,
        });
      }

      this.metrics?.recordTimer(
        "user_service.update",
        performance.now() - startTime
      );
      this.logger.info("User updated", { userId: id });

      return user;
    } catch (error) {
      this.logger.error("Update failed", { error, userId: id });
      throw error;
    }
  }

  /**
   * Delete user
   */
  async delete(id: string): Promise<void> {
    const startTime = performance.now();

    try {
      // 1. Soft delete in LOCAL DB
      await this.userRepository.softDelete(id);

      // 2. Delete from Keycloak
      await this.keycloakAuth.deleteAuthUser(id);

      this.metrics?.recordTimer(
        "user_service.delete",
        performance.now() - startTime
      );
      this.logger.info("User deleted", { userId: id });
    } catch (error) {
      this.logger.error("Delete failed", { error, userId: id });
      throw error;
    }
  }

  /**
   * Search users (from local DB - fast!)
   */
  async search(options: {
    search?: string;
    storeId?: string;
    status?: string;
    skip?: number;
    take?: number;
  }) {
    return await this.userRepository.search(options as any);
  }

  /**
   * Update password
   */
  async updatePassword(id: string, newPassword: string): Promise<void> {
    // Update in Keycloak only (we don't store passwords locally)
    await this.keycloakAuth.updateAuthUser(id, {
      password: newPassword,
    });

    this.logger.info("Password updated", { userId: id });
  }
}
```

### Step 3: Create AuthService (Login/Logout)

```typescript
// libs/keycloak-authV2/src/services/auth/AuthService.ts

import { UserRepository } from "../user/UserRepositoryLocal";
import { KeycloakAuthService } from "./KeycloakAuthService";
import type { User } from "@libs/database";
import { createLogger } from "@libs/utils";

/**
 * AuthService - Handles authentication flow
 */
export class AuthService {
  private readonly logger = createLogger("AuthService");

  constructor(
    private readonly userRepository: UserRepository,
    private readonly keycloakAuth: KeycloakAuthService
  ) {}

  /**
   * Login user
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
    try {
      // 1. Authenticate with Keycloak (verify credentials)
      const tokens = await this.keycloakAuth.authenticate(username, password);

      // 2. Get user from LOCAL DB (source of truth)
      const user = await this.userRepository.findByUsername(username);

      if (!user) {
        throw new Error("User not found in local database");
      }

      // 3. Update login tracking in LOCAL DB
      await this.userRepository.updateLoginTracking(user.id);

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
      this.logger.error("Login failed", { error, username });
      throw error;
    }
  }

  /**
   * Logout user
   */
  async logout(refreshToken: string): Promise<void> {
    await this.keycloakAuth.logout(refreshToken);
    this.logger.info("User logged out");
  }

  /**
   * Refresh tokens
   */
  async refreshToken(refreshToken: string) {
    return await this.keycloakAuth.refreshToken(refreshToken);
  }

  /**
   * Verify token
   */
  async verifyToken(accessToken: string): Promise<boolean> {
    return await this.keycloakAuth.verifyToken(accessToken);
  }
}
```

---

## 🚀 Usage Examples

### Registration

```typescript
const userService = new UserService(userRepository, keycloakAuth, metrics);

const user = await userService.register({
  username: "john.doe",
  email: "john@example.com",
  password: "securePassword123",
  firstName: "John",
  lastName: "Doe",
  storeId: "store-123",
});

// user is from LOCAL DB (source of truth)
// Keycloak has credentials for authentication
```

### Login

```typescript
const authService = new AuthService(userRepository, keycloakAuth);

const { user, tokens } = await authService.login(
  "john.doe",
  "securePassword123"
);

// user is from LOCAL DB (fast!)
// tokens are from Keycloak (for auth)
```

### Query Users

```typescript
// All queries hit LOCAL DB (fast!)
const user = await userService.getById("user-id");
const userByEmail = await userRepository.findByEmail("john@example.com");
const users = await userService.search({ storeId: "store-123" });
```

---

## ✅ Benefits of This Approach

1. **Single Source of Truth**: Local DB has all user data
2. **Fast Queries**: No external API calls for user data
3. **Simple Code**: Standard repository pattern
4. **Consistent Model**: Same User model everywhere
5. **Clear Separation**: Keycloak = auth service, DB = data store
6. **Easy Testing**: Mock PrismaClient instead of Keycloak API
7. **Better Performance**: Local queries vs external API
8. **Offline Capable**: Can read users even if Keycloak is down

---

## 🎯 Summary

This implementation:

- ✅ Uses Local DB as source of truth
- ✅ UserRepository works with Prisma (consistent across module)
- ✅ Keycloak is ONLY used for authentication (thin wrapper)
- ✅ Simple, maintainable, performant

**This is the recommended architecture for your project!** 🎉
