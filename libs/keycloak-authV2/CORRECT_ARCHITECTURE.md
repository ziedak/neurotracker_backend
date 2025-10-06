# Correct Architecture Understanding ✅

## 🎯 Your Current Architecture (Keycloak-focused)

```
libs/keycloak-authV2/src/services/user/
├── interfaces.ts                ← Interface definitions
├── AdminTokenManager.ts         ← Token management layer
├── KeycloakApiClient.ts         ← Low-level Keycloak API client
├── UserRepository.ts            ← Keycloak user CRUD with caching
├── RoleManager.ts               ← Keycloak role management
├── UserInfoConverter.ts         ← Data transformation
└── KeycloakUserService.ts       ← Facade (orchestration)
```

**This is for managing users IN KEYCLOAK, not local database!**

---

## 🏗️ Correct Solution: Bridge Pattern

You need a **bridge** between:

1. **Your existing Keycloak user management** (libs/keycloak-authV2)
2. **Your existing local DB management** (libs/database)

### Architecture:

```
┌────────────────────────────────────────────────────────┐
│         Application Layer (API Gateway)                 │
└────────────────────────────────────────────────────────┘
                      ↓
┌────────────────────────────────────────────────────────┐
│         NEW: UserManagementService (Bridge)             │
│  - Coordinates between Keycloak & Local DB              │
│  - Single entry point for user operations               │
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

---

## 💻 Implementation: Bridge Service

### Create UserManagementService (Bridge)

```typescript
// libs/keycloak-authV2/src/services/UserManagementService.ts

import { KeycloakUserService } from "./user/KeycloakUserService";
import { UserRepository as LocalUserRepository } from "@libs/database/repositories";
import type {
  User,
  UserCreateInput,
  UserUpdateInput,
} from "@libs/database/models";
import type { CreateUserOptions, UpdateUserOptions } from "./user/interfaces";
import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";

/**
 * UserManagementService - Bridge between Keycloak and Local Database
 *
 * Responsibilities:
 * - Coordinates user operations across Keycloak and local DB
 * - Maintains data consistency between systems
 * - Provides single entry point for user management
 *
 * Pattern: Bridge Pattern + Facade Pattern
 */
export class UserManagementService {
  private readonly logger = createLogger("UserManagementService");

  constructor(
    private readonly keycloakUserService: KeycloakUserService,
    private readonly localUserRepository: LocalUserRepository,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Register new user
   * Creates user in BOTH Keycloak (for auth) and Local DB (for data)
   */
  async registerUser(data: {
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
      this.logger.info("Starting user registration", {
        username: data.username,
        email: data.email,
      });

      // 1. Create user in LOCAL DB first (source of truth)
      const localUserData: UserCreateInput = {
        username: data.username,
        email: data.email,
        password: "", // Don't store password locally
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        phone: data.phone ?? null,
        emailVerified: false,
        phoneVerified: false,
        status: "PENDING",
        storeId: data.storeId ?? null,
        organizationId: data.organizationId ?? null,
        roleId: data.roleId ?? null,
        isDeleted: false,
      };

      const localUser = await this.localUserRepository.create(localUserData);
      this.logger.info("User created in local DB", { userId: localUser.id });

      // 2. Create user in Keycloak (use same ID for consistency!)
      try {
        const keycloakUserData: CreateUserOptions = {
          username: data.username,
          email: data.email,
          password: data.password,
          firstName: data.firstName,
          lastName: data.lastName,
          enabled: true,
          emailVerified: false,
        };

        // Use Keycloak's low-level API to create with specific ID
        await this.createKeycloakUserWithId(localUser.id, keycloakUserData);

        this.logger.info("User created in Keycloak", { userId: localUser.id });
      } catch (keycloakError) {
        // Rollback: Delete local user if Keycloak creation fails
        this.logger.error("Keycloak user creation failed, rolling back", {
          error: keycloakError,
          userId: localUser.id,
        });

        await this.localUserRepository.deleteById(localUser.id);
        throw new Error(`Failed to create Keycloak user: ${keycloakError}`);
      }

      this.metrics?.recordTimer(
        "user_management.register_user",
        performance.now() - startTime
      );
      this.metrics?.recordCounter("user_management.register_user_success", 1);

      return localUser;
    } catch (error) {
      this.metrics?.recordCounter("user_management.register_user_failure", 1);
      this.logger.error("User registration failed", { error });
      throw error;
    }
  }

  /**
   * Authenticate user
   * Verifies credentials with Keycloak, returns user from local DB
   */
  async authenticateUser(
    username: string,
    password: string
  ): Promise<{
    user: User;
    tokens: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };
  }> {
    const startTime = performance.now();

    try {
      // 1. Authenticate with Keycloak (verify credentials)
      // Note: You'll need to add authentication to KeycloakUserService
      // or use KeycloakClient directly
      const tokens = await this.authenticateWithKeycloak(username, password);

      // 2. Get user from LOCAL DB (source of truth for user data)
      const user = await this.localUserRepository.findByUsername(username);

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

      // 3. Update login tracking in LOCAL DB
      await this.localUserRepository.updateLastLogin(user.id);

      this.metrics?.recordTimer(
        "user_management.authenticate_user",
        performance.now() - startTime
      );
      this.metrics?.recordCounter(
        "user_management.authenticate_user_success",
        1
      );
      this.logger.info("User authenticated successfully", { userId: user.id });

      return {
        user,
        tokens: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresIn: tokens.expires_in,
        },
      };
    } catch (error) {
      this.metrics?.recordCounter(
        "user_management.authenticate_user_failure",
        1
      );
      this.logger.error("Authentication failed", { error, username });
      throw error;
    }
  }

  /**
   * Get user by ID (from local DB)
   */
  async getUserById(userId: string): Promise<User | null> {
    return await this.localUserRepository.findById(userId);
  }

  /**
   * Get user by email (from local DB)
   */
  async getUserByEmail(email: string): Promise<User | null> {
    return await this.localUserRepository.findByEmail(email);
  }

  /**
   * Get user by username (from local DB)
   */
  async getUserByUsername(username: string): Promise<User | null> {
    return await this.localUserRepository.findByUsername(username);
  }

  /**
   * Update user
   * Updates in BOTH Keycloak and local DB
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
    const startTime = performance.now();

    try {
      // 1. Update in LOCAL DB (source of truth)
      const user = await this.localUserRepository.updateById(userId, data);

      // 2. Sync relevant changes to Keycloak
      if (data.username || data.email || data.firstName || data.lastName) {
        const keycloakUpdates: UpdateUserOptions = {
          username: data.username,
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName,
          enabled: data.status === "ACTIVE",
        };

        try {
          await this.keycloakUserService.updateUser(userId, keycloakUpdates);
        } catch (keycloakError) {
          this.logger.warn("Failed to sync update to Keycloak", {
            error: keycloakError,
            userId,
          });
          // Don't throw - local DB is source of truth
        }
      }

      this.metrics?.recordTimer(
        "user_management.update_user",
        performance.now() - startTime
      );
      this.logger.info("User updated", { userId });

      return user;
    } catch (error) {
      this.logger.error("User update failed", { error, userId });
      throw error;
    }
  }

  /**
   * Update password (Keycloak only)
   */
  async updatePassword(userId: string, newPassword: string): Promise<void> {
    try {
      await this.keycloakUserService.resetPassword(userId, {
        password: newPassword,
        temporary: false,
      });

      this.logger.info("Password updated", { userId });
    } catch (error) {
      this.logger.error("Password update failed", { error, userId });
      throw error;
    }
  }

  /**
   * Delete user (soft delete in local DB, remove from Keycloak)
   */
  async deleteUser(userId: string, deletedBy: string): Promise<void> {
    const startTime = performance.now();

    try {
      // 1. Soft delete in LOCAL DB
      await this.localUserRepository.softDelete(userId, deletedBy);

      // 2. Delete from Keycloak (best effort)
      try {
        await this.keycloakUserService.deleteUser(userId);
      } catch (keycloakError) {
        this.logger.warn("Failed to delete from Keycloak", {
          error: keycloakError,
          userId,
        });
        // Don't throw - user is deleted from local DB (source of truth)
      }

      this.metrics?.recordTimer(
        "user_management.delete_user",
        performance.now() - startTime
      );
      this.logger.info("User deleted", { userId });
    } catch (error) {
      this.logger.error("User deletion failed", { error, userId });
      throw error;
    }
  }

  /**
   * Search users (from local DB)
   */
  async searchUsers(options: {
    storeId?: string;
    roleId?: string;
    status?: "ACTIVE" | "INACTIVE" | "BANNED" | "DELETED";
    skip?: number;
    take?: number;
  }): Promise<User[]> {
    return await this.localUserRepository.findMany({
      where: options,
      skip: options.skip,
      take: options.take,
    });
  }

  /**
   * Get user statistics (from local DB)
   */
  async getUserStats() {
    return await this.localUserRepository.getUserStats();
  }

  // Private helper methods

  /**
   * Create Keycloak user with specific ID
   * (Keycloak allows setting ID during creation)
   */
  private async createKeycloakUserWithId(
    userId: string,
    userData: CreateUserOptions
  ): Promise<void> {
    // Use the low-level API client to create user with specific ID
    const keycloakApiClient = (this.keycloakUserService as any).userRepository
      .apiClient;

    const keycloakUser = {
      id: userId, // Use local DB ID
      username: userData.username,
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      enabled: userData.enabled ?? true,
      emailVerified: userData.emailVerified ?? false,
      credentials: userData.password
        ? [
            {
              type: "password",
              value: userData.password,
              temporary: userData.temporaryPassword ?? false,
            },
          ]
        : undefined,
    };

    await keycloakApiClient.createUser(keycloakUser);
  }

  /**
   * Authenticate with Keycloak
   * (This needs to be added to your KeycloakClient or use directly)
   */
  private async authenticateWithKeycloak(
    username: string,
    password: string
  ): Promise<{
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
  }> {
    // You'll need to access KeycloakClient from KeycloakUserService
    // or pass it as a separate dependency
    // For now, this is a placeholder that shows the interface
    throw new Error("Authentication method needs to be implemented");

    // Implementation would be something like:
    // return await this.keycloakClient.auth.passwordGrant(username, password);
  }
}
```

---

## 🎯 Summary: Correct Understanding

### Your Current Structure (Keycloak Management):

- ✅ `KeycloakUserService` - Facade for Keycloak operations
- ✅ `UserRepository` - Keycloak user CRUD with caching
- ✅ `KeycloakApiClient` - Low-level Keycloak API
- ✅ `RoleManager` - Keycloak role management
- ✅ `AdminTokenManager` - Token management

### What You Need (Bridge):

- ✅ `UserManagementService` - **NEW** bridge service
  - Uses `KeycloakUserService` for auth operations
  - Uses `LocalUserRepository` (from @libs/database) for data operations
  - Coordinates between both systems
  - Single entry point for application

### Data Flow:

```
API Request
    ↓
UserManagementService (bridge)
    ↓                    ↓
KeycloakUserService   LocalUserRepository
    ↓                    ↓
Keycloak API         PostgreSQL
```

**I apologize for the confusion - I now understand your architecture correctly!** 🙏
