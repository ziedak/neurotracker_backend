/**
 * UserFacade - Public API for User Management Operations
 *
 * Responsibilities:
 * - Coordinates user operations across Keycloak (authentication) and Local DB (user data)
 * - Maintains data consistency between systems
 * - Provides single entry point for user management
 * - Local DB is the source of truth for user data
 * - Keycloak is the source of truth for authentication/credentials
 *
 * Pattern: Facade Pattern (simplifies complex subsystem interactions)
 *
 * SOLID Principles:
 * - Single Responsibility: Bridges Keycloak auth with local user data
 * - Open/Closed: Extensible thr  /**
 * Validate user status for operations
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { PrismaClient } from "@libs/database";
import { UserRepository as LocalUserRepository } from "@libs/database";
import type { User, UserCreateInput, UserUpdateInput } from "@libs/database";
import { UserCreateInputSchema, UserUpdateInputSchema } from "@libs/database";
import { KeycloakUserService } from "./KeycloakUserService";
import type { KeycloakClient } from "../../client/KeycloakClient";
import type { CreateUserOptions, UpdateUserOptions } from "./interfaces";
import { KeycloakConverter } from "./converters";

/**
 * Registration data for new users
 */
export interface RegisterUserInput {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  storeId?: string;
  organizationId?: string;
  roleId?: string;
  realmRoles?: string[];
  clientRoles?: Record<string, string[]>;
}

/**
 * Authentication result with user data and tokens
 */
export interface AuthenticationResult {
  user: User;
  tokens: {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresIn: number;
  };
}

/**
 * User search options
 */
export interface SearchUsersOptions {
  storeId?: string;
  roleId?: string;
  status?: "ACTIVE" | "INACTIVE" | "BANNED" | "DELETED" | "PENDING";
  skip?: number;
  take?: number;
  includeDeleted?: boolean;
}

/**
 * UserFacade - Public API for User Management
 */
export class UserFacade {
  private readonly logger: ILogger = createLogger("UserFacade");

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly keycloakUserService: KeycloakUserService,
    private readonly localUserRepository: LocalUserRepository,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Factory method to create UserFacade with all dependencies
   */
  static create(
    keycloakClient: KeycloakClient,
    keycloakUserService: KeycloakUserService,
    prisma: PrismaClient,
    metrics?: IMetricsCollector
  ): UserFacade {
    const localUserRepository = new LocalUserRepository(prisma, metrics);

    return new UserFacade(
      keycloakClient,
      keycloakUserService,
      localUserRepository,
      metrics
    );
  }

  /**
   * Register new user
   * Creates user in BOTH Keycloak (for auth) and Local DB (for data)
   *
   * Flow:
   * 1. Create user in LOCAL DB first (source of truth for user data)
   * 2. Create user in Keycloak with same ID (for authentication)
   * 3. Rollback if Keycloak creation fails
   */
  async registerUser(data: RegisterUserInput): Promise<User> {
    const startTime = performance.now();

    try {
      this.logger.info("Starting user registration", {
        username: data.username,
        email: data.email,
      });

      // 1. Validate email/username uniqueness in both systems
      await this.validateUserUniqueness(data.username, data.email);

      // 2. Create user in LOCAL DB first (source of truth)
      const localUserData: UserCreateInput = {
        username: data.username,
        email: data.email,
        password: "", // Never store passwords locally - Keycloak handles this
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        phone: data.phone ?? null,
        emailVerified: false,
        phoneVerified: false,
        status: "ACTIVE",
        isDeleted: false,
        ...(data.storeId && {
          store: { connect: { id: data.storeId } },
        }),
        ...(data.organizationId && {
          organization: { connect: { id: data.organizationId } },
        }),
        ...(data.roleId && {
          role: { connect: { id: data.roleId } },
        }),
      };

      const localUser = await this.localUserRepository.create(localUserData);
      this.logger.info("User created in local DB", { userId: localUser.id });

      // 3. Create user in Keycloak with same ID for consistency
      // Uses KeycloakConverter internally for type-safe conversion
      try {
        const keycloakOptions: CreateUserOptions = {
          username: data.username,
          email: data.email,
          password: data.password,
          enabled: true,
          emailVerified: false,
        };

        if (data.firstName) keycloakOptions.firstName = data.firstName;
        if (data.lastName) keycloakOptions.lastName = data.lastName;
        if (data.realmRoles) keycloakOptions.realmRoles = data.realmRoles;
        if (data.clientRoles) keycloakOptions.clientRoles = data.clientRoles;

        await this.createKeycloakUserWithId(localUser.id, keycloakOptions);

        this.logger.info("User created in Keycloak", { userId: localUser.id });

        this.recordMetrics("register_user", performance.now() - startTime);
        this.recordCounter("register_user_success");

        return localUser;
      } catch (keycloakError) {
        // Rollback: Delete local user if Keycloak creation fails
        this.logger.error("Keycloak user creation failed, rolling back", {
          error: keycloakError,
          userId: localUser.id,
        });

        await this.localUserRepository.deleteById(localUser.id);
        this.recordCounter("register_user_rollback");

        throw new Error(
          `Failed to create user in Keycloak: ${
            keycloakError instanceof Error
              ? keycloakError.message
              : String(keycloakError)
          }`
        );
      }
    } catch (error) {
      this.recordCounter("register_user_failure");
      this.logger.error("User registration failed", { error });
      throw error;
    }
  }

  /**
   * Authenticate user
   * Verifies credentials with Keycloak, returns user from local DB
   *
   * Flow:
   * 1. Authenticate with Keycloak (verify credentials, get tokens)
   * 2. Get user from LOCAL DB (source of truth for user data)
   * 3. Validate user status
   * 4. Update last login timestamp
   */
  async authenticateUser(
    username: string,
    password: string
  ): Promise<AuthenticationResult> {
    const startTime = performance.now();

    try {
      this.logger.debug("Starting authentication", { username });

      // 1. Authenticate with Keycloak (verify credentials)
      const authResult = await this.keycloakClient.authenticateWithPassword(
        username,
        password
      );

      this.logger.debug("Keycloak authentication successful", { username });

      // 2. Get user from LOCAL DB (source of truth for user data)
      const user = await this.localUserRepository.findByUsername(username);

      if (!user) {
        this.logger.warn(
          "User authenticated in Keycloak but not found in local DB",
          {
            username,
          }
        );
        throw new Error("User not found in local database");
      }

      // 3. Validate user status
      this.validateUserStatus(user);

      // 4. Update last login timestamp in LOCAL DB
      await this.localUserRepository.updateLastLogin(user.id);

      this.recordMetrics("authenticate_user", performance.now() - startTime);
      this.recordCounter("authenticate_user_success");
      this.logger.info("User authenticated successfully", { userId: user.id });

      const tokens: AuthenticationResult["tokens"] = {
        accessToken: authResult.tokens?.access_token ?? "",
        expiresIn: authResult.tokens?.expires_in ?? 0,
      };

      if (authResult.tokens?.refresh_token) {
        tokens.refreshToken = authResult.tokens.refresh_token;
      }
      if (authResult.tokens?.id_token) {
        tokens.idToken = authResult.tokens.id_token;
      }

      return { user, tokens };
    } catch (error) {
      this.recordCounter("authenticate_user_failure");
      this.logger.error("Authentication failed", { error, username });
      throw error;
    }
  }

  /**
   * Get user by ID (from local DB)
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      return await this.localUserRepository.findById(userId);
    } catch (error) {
      this.logger.error("Failed to get user by ID", { error, userId });
      throw error;
    }
  }

  /**
   * Get user by email (from local DB)
   */
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      return await this.localUserRepository.findByEmail(email);
    } catch (error) {
      this.logger.error("Failed to get user by email", { error, email });
      throw error;
    }
  }

  /**
   * Get user by username (from local DB)
   */
  async getUserByUsername(username: string): Promise<User | null> {
    try {
      return await this.localUserRepository.findByUsername(username);
    } catch (error) {
      this.logger.error("Failed to get user by username", { error, username });
      throw error;
    }
  }

  /**
   * Update user
   * Updates in BOTH Keycloak and local DB
   *
   * Flow:
   * 1. Update in LOCAL DB (source of truth)
   * 2. Sync relevant changes to Keycloak (best effort)
   */
  async updateUser(userId: string, data: UserUpdateInput): Promise<User> {
    const startTime = performance.now();

    try {
      this.logger.debug("Updating user", { userId, data });

      // 1. Update in LOCAL DB (source of truth)
      const user = await this.localUserRepository.updateById(userId, data);

      // 2. Sync relevant changes to Keycloak (best effort)
      const keycloakUpdates: Partial<UpdateUserOptions> = {};

      if (typeof data.email === "string") keycloakUpdates.email = data.email;
      if (typeof data.firstName === "string")
        keycloakUpdates.firstName = data.firstName;
      if (typeof data.lastName === "string")
        keycloakUpdates.lastName = data.lastName;
      if (typeof data.status === "string")
        keycloakUpdates.enabled = data.status === "ACTIVE";

      if (Object.keys(keycloakUpdates).length > 0) {
        try {
          await this.keycloakUserService.updateUser(
            userId,
            keycloakUpdates as UpdateUserOptions
          );
          this.logger.debug("User synced to Keycloak", { userId });
        } catch (keycloakError) {
          this.logger.warn("Failed to sync update to Keycloak (non-critical)", {
            error: keycloakError,
            userId,
          });
          // Don't throw - local DB is source of truth
          this.recordCounter("sync_keycloak_warning");
        }
      }

      this.recordMetrics("update_user", performance.now() - startTime);
      this.recordCounter("update_user_success");
      this.logger.info("User updated", { userId });

      return user;
    } catch (error) {
      this.recordCounter("update_user_failure");
      this.logger.error("User update failed", { error, userId });
      throw error;
    }
  }

  /**
   * Update password (Keycloak only)
   * Passwords are ONLY stored in Keycloak, never in local DB
   */
  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const startTime = performance.now();

    try {
      await this.keycloakUserService.resetPassword(userId, {
        password: newPassword,
        temporary: false,
      });

      this.recordMetrics("update_password", performance.now() - startTime);
      this.recordCounter("update_password_success");
      this.logger.info("Password updated", { userId });
    } catch (error) {
      this.recordCounter("update_password_failure");
      this.logger.error("Password update failed", { error, userId });
      throw error;
    }
  }

  /**
   * Delete user
   * Soft delete in local DB, hard delete from Keycloak
   *
   * Flow:
   * 1. Soft delete in LOCAL DB (preserves data for audit)
   * 2. Hard delete from Keycloak (removes authentication)
   */
  async deleteUser(userId: string, deletedBy: string): Promise<void> {
    const startTime = performance.now();

    try {
      this.logger.info("Deleting user", { userId, deletedBy });

      // 1. Soft delete in LOCAL DB
      await this.localUserRepository.softDelete(userId, deletedBy);
      this.logger.debug("User soft deleted from local DB", { userId });

      // 2. Delete from Keycloak (best effort)
      try {
        await this.keycloakUserService.deleteUser(userId);
        this.logger.debug("User deleted from Keycloak", { userId });
      } catch (keycloakError) {
        this.logger.warn("Failed to delete from Keycloak (non-critical)", {
          error: keycloakError,
          userId,
        });
        // Don't throw - user is deleted from local DB (source of truth)
        this.recordCounter("delete_keycloak_warning");
      }

      this.recordMetrics("delete_user", performance.now() - startTime);
      this.recordCounter("delete_user_success");
      this.logger.info("User deleted", { userId });
    } catch (error) {
      this.recordCounter("delete_user_failure");
      this.logger.error("User deletion failed", { error, userId });
      throw error;
    }
  }

  /**
   * Restore soft-deleted user
   */
  async restoreUser(userId: string): Promise<User> {
    try {
      const user = await this.localUserRepository.restore(userId);
      this.recordCounter("restore_user_success");
      this.logger.info("User restored", { userId });
      return user;
    } catch (error) {
      this.recordCounter("restore_user_failure");
      this.logger.error("User restoration failed", { error, userId });
      throw error;
    }
  }

  /**
   * Search users (from local DB)
   */
  async searchUsers(options: SearchUsersOptions): Promise<User[]> {
    try {
      const where: any = {};

      if (options.storeId) where.storeId = options.storeId;
      if (options.roleId) where.roleId = options.roleId;
      if (options.status) where.status = options.status;
      if (!options.includeDeleted) where.isDeleted = false;

      const queryOptions: any = { where };
      if (options.skip !== undefined) queryOptions.skip = options.skip;
      if (options.take !== undefined) queryOptions.take = options.take;

      return await this.localUserRepository.findMany(queryOptions);
    } catch (error) {
      this.logger.error("User search failed", { error, options });
      throw error;
    }
  }

  /**
   * Get user statistics (from local DB)
   */
  async getUserStats() {
    try {
      return await this.localUserRepository.getUserStats();
    } catch (error) {
      this.logger.error("Failed to get user stats", { error });
      throw error;
    }
  }

  /**
   * Assign roles to user (Keycloak only)
   * Roles in Keycloak are for authentication/authorization
   * Roles in local DB are for business logic
   */
  async assignRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    try {
      await this.keycloakUserService.assignRealmRoles(userId, roleNames);
      this.recordCounter("assign_realm_roles_success");
      this.logger.info("Realm roles assigned", { userId, roles: roleNames });
    } catch (error) {
      this.recordCounter("assign_realm_roles_failure");
      this.logger.error("Failed to assign realm roles", { error, userId });
      throw error;
    }
  }

  /**
   * Remove roles from user (Keycloak only)
   */
  async removeRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    try {
      await this.keycloakUserService.removeRealmRoles(userId, roleNames);
      this.recordCounter("remove_realm_roles_success");
      this.logger.info("Realm roles removed", { userId, roles: roleNames });
    } catch (error) {
      this.recordCounter("remove_realm_roles_failure");
      this.logger.error("Failed to remove realm roles", { error, userId });
      throw error;
    }
  }

  /**
   * Refresh tokens (Keycloak only)
   */
  async refreshTokens(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresIn: number;
  }> {
    try {
      const tokenResponse = await this.keycloakClient.refreshToken(
        refreshToken
      );
      this.recordCounter("refresh_tokens_success");

      const tokens: {
        accessToken: string;
        refreshToken?: string;
        idToken?: string;
        expiresIn: number;
      } = {
        accessToken: tokenResponse.access_token,
        expiresIn: tokenResponse.expires_in,
      };

      if (tokenResponse.refresh_token) {
        tokens.refreshToken = tokenResponse.refresh_token;
      }
      if (tokenResponse.id_token) {
        tokens.idToken = tokenResponse.id_token;
      }

      return tokens;
    } catch (error) {
      this.recordCounter("refresh_tokens_failure");
      this.logger.error("Token refresh failed", { error });
      throw error;
    }
  }

  /**
   * Logout user (Keycloak session management)
   */
  async logout(refreshToken: string): Promise<void> {
    try {
      // Use logout endpoint instead of revokeToken
      await this.keycloakClient.logout(refreshToken);
      this.recordCounter("logout_success");
      this.logger.info("User logged out");
    } catch (error) {
      this.recordCounter("logout_failure");
      this.logger.error("Logout failed", { error });
      throw error;
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Validate that username and email are unique in both systems
   */
  private async validateUserUniqueness(
    username: string,
    email: string
  ): Promise<void> {
    // Check local DB
    const existingUserByUsername =
      await this.localUserRepository.findByUsername(username);
    if (existingUserByUsername) {
      throw new Error(`Username '${username}' already exists`);
    }

    const existingUserByEmail = await this.localUserRepository.findByEmail(
      email
    );
    if (existingUserByEmail) {
      throw new Error(`Email '${email}' already exists`);
    }

    // Check Keycloak
    const keycloakUserByUsername =
      await this.keycloakUserService.getUserByUsername(username);
    if (keycloakUserByUsername) {
      throw new Error(`Username '${username}' already exists in Keycloak`);
    }
  }

  /**
   * Validate user status for authentication
   */
  private validateUserStatus(user: User): void {
    if (user.status === "BANNED") {
      throw new Error("User account is banned");
    }
    if (user.status === "DELETED") {
      throw new Error("User account is deleted");
    }
    if (user.status === "INACTIVE") {
      throw new Error("User account is inactive");
    }
    if (user.isDeleted) {
      throw new Error("User account is deleted");
    }
  }

  /**
   * Create Keycloak user with specific ID
   * Keycloak allows setting ID during creation to match local DB
   *
   * Updated to use KeycloakConverter for type-safe conversions
   */
  private async createKeycloakUserWithId(
    userId: string,
    userData: CreateUserOptions
  ): Promise<void> {
    // Access the low-level API client from UserService
    const apiClient = (this.keycloakUserService as any).userRepository
      .apiClient;

    // Convert to database format for use with KeycloakConverter
    const userInput: UserCreateInput = {
      username: userData.username,
      email: userData.email ?? "",
      password: userData.password ?? "",
      firstName: userData.firstName ?? null,
      lastName: userData.lastName ?? null,
      status: userData.enabled === false ? "INACTIVE" : "ACTIVE",
      emailVerified: userData.emailVerified ?? false,
      phoneVerified: false,
      isDeleted: false,
    };

    // Use KeycloakConverter to create proper Keycloak format
    const keycloakUser = KeycloakConverter.toKeycloakCreate(userInput);

    // Override with specific ID to match local DB
    keycloakUser.id = userId;

    await apiClient.createUser(keycloakUser);

    // Assign roles if provided
    if (userData.realmRoles?.length) {
      await this.keycloakUserService.assignRealmRoles(
        userId,
        userData.realmRoles
      );
    }

    if (userData.clientRoles) {
      for (const [clientId, roles] of Object.entries(userData.clientRoles)) {
        if (roles.length > 0) {
          await this.keycloakUserService.assignClientRoles(
            userId,
            clientId,
            roles
          );
        }
      }
    }
  }

  /**
   * Record metrics
   */
  private recordMetrics(operation: string, duration?: number): void {
    if (duration !== undefined) {
      this.metrics?.recordTimer(
        `user_management.${operation}_duration`,
        duration
      );
    }
  }

  /**
   * Record counter
   */
  private recordCounter(metric: string): void {
    this.metrics?.recordCounter(`user_management.${metric}`, 1);
  }
}
