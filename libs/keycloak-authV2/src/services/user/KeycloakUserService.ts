/**
 * KeycloakUserService - Orchestrates Keycloak User Operations
 *
 * IMPORTANT: This service manages REMOTE Keycloak user operations (not local database)
 *
 * SOLID Principles:
 * - Single Responsibility: Orchestrates Keycloak user management operations
 * - Open/Closed: Extensible through component composition
 * - Liskov Substitution: Components can be substituted via interfaces
 * - Interface Segregation: Uses focused component interfaces
 * - Dependency Inversion: Depends on abstractions, not concretions
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { CacheService } from "@libs/database";
import type { UserInfo } from "../../types";
import type { AuthV2Config } from "../token/config";
import type { KeycloakClient } from "../../client/KeycloakClient";
import { keycloakUserToUserInfo } from "./converters/user-converters";
import type {
  IUserService,
  IUserRepository,
  IRoleManager,
  UserSearchOptions,
  CreateUserOptions,
  UpdateUserOptions,
  ResetPasswordOptions,
  KeycloakUser,
} from "./interfaces";
import { ClientCredentialsTokenProvider } from "./ClientCredentialsTokenProvider";
import { KeycloakAdminClient } from "../../client/KeycloakAdminClient";
import { KeycloakUserClient } from "./KeycloakUserClient";
import { RoleManager } from "./RoleManager";

export class KeycloakUserService implements IUserService {
  private readonly logger: ILogger = createLogger("KeycloakUserService");

  constructor(
    private readonly userRepository: IUserRepository,
    private readonly roleManager: IRoleManager,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Create a complete KeycloakUserService with all dependencies
   * Factory method following Dependency Injection pattern
   */
  static create(
    keycloakClient: KeycloakClient,
    _config: AuthV2Config,
    cacheService?: CacheService,
    metrics?: IMetricsCollector
  ): KeycloakUserService {
    // Import components (static imports for better tree-shaking)

    // Build dependency chain with new ClientCredentialsTokenProvider
    const tokenProvider = new ClientCredentialsTokenProvider(
      keycloakClient,
      undefined,
      metrics
    );
    const apiClient = new KeycloakAdminClient(
      keycloakClient,
      tokenProvider,
      {},
      metrics
    );
    const userRepository = new KeycloakUserClient(
      apiClient,
      cacheService,
      metrics
    );
    const roleManager = new RoleManager(apiClient, metrics);

    return new KeycloakUserService(userRepository, roleManager, metrics);
  }

  /**
   * Search for users
   */
  async searchUsers(options: UserSearchOptions): Promise<KeycloakUser[]> {
    const startTime = performance.now();

    try {
      const users = await this.userRepository.searchUsers(options);

      this.recordMetrics("search_users", performance.now() - startTime);
      this.logger.debug("Users searched", { count: users.length, options });

      return users;
    } catch (error) {
      this.recordError("search_users", error);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<KeycloakUser | null> {
    const startTime = performance.now();

    try {
      const user = await this.userRepository.getUserById(userId);

      this.recordMetrics("get_user_by_id", performance.now() - startTime);

      return user;
    } catch (error) {
      this.recordError("get_user_by_id", error);
      throw error;
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<KeycloakUser | null> {
    const startTime = performance.now();

    try {
      const user = await this.userRepository.getUserByUsername(username);

      this.recordMetrics("get_user_by_username", performance.now() - startTime);

      return user;
    } catch (error) {
      this.recordError("get_user_by_username", error);
      throw error;
    }
  }

  /**
   * Create user with role assignment
   */
  async createUser(options: CreateUserOptions): Promise<string> {
    const startTime = performance.now();

    try {
      // Create user (without roles to keep UserRepository focused)
      const userOptions = { ...options };
      delete userOptions.realmRoles;
      delete userOptions.clientRoles;

      const userId = await this.userRepository.createUser(userOptions);

      // Assign roles separately
      if (options.realmRoles?.length) {
        await this.roleManager.assignRealmRoles(userId, options.realmRoles);
      }

      if (options.clientRoles) {
        for (const [clientId, roles] of Object.entries(options.clientRoles)) {
          if (roles.length > 0) {
            await this.roleManager.assignClientRoles(userId, clientId, roles);
          }
        }
      }

      this.recordMetrics("create_user", performance.now() - startTime);
      this.logger.info("User created with roles", {
        userId,
        username: options.username,
        realmRoles: options.realmRoles,
        clientRoles: options.clientRoles,
      });

      return userId;
    } catch (error) {
      this.recordError("create_user", error);
      throw error;
    }
  }

  /**
   * Update user
   */
  async updateUser(userId: string, options: UpdateUserOptions): Promise<void> {
    const startTime = performance.now();

    try {
      await this.userRepository.updateUser(userId, options);

      this.recordMetrics("update_user", performance.now() - startTime);
      this.logger.info("User updated", { userId });
    } catch (error) {
      this.recordError("update_user", error);
      throw error;
    }
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<void> {
    const startTime = performance.now();

    try {
      await this.userRepository.deleteUser(userId);

      this.recordMetrics("delete_user", performance.now() - startTime);
      this.logger.info("User deleted", { userId });
    } catch (error) {
      this.recordError("delete_user", error);
      throw error;
    }
  }

  /**
   * Reset user password
   */
  async resetPassword(
    userId: string,
    options: ResetPasswordOptions
  ): Promise<void> {
    const startTime = performance.now();

    try {
      await this.userRepository.resetPassword(userId, options);

      this.recordMetrics("reset_password", performance.now() - startTime);
      this.logger.info("Password reset", {
        userId,
        temporary: options.temporary,
      });
    } catch (error) {
      this.recordError("reset_password", error);
      throw error;
    }
  }

  /**
   * Assign realm roles to user
   */
  async assignRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    const startTime = performance.now();

    try {
      await this.roleManager.assignRealmRoles(userId, roleNames);

      this.recordMetrics("assign_realm_roles", performance.now() - startTime);
      this.logger.info("Realm roles assigned", { userId, roles: roleNames });
    } catch (error) {
      this.recordError("assign_realm_roles", error);
      throw error;
    }
  }

  /**
   * Remove realm roles from user
   */
  async removeRealmRoles(userId: string, roleNames: string[]): Promise<void> {
    const startTime = performance.now();

    try {
      await this.roleManager.removeRealmRoles(userId, roleNames);

      this.recordMetrics("remove_realm_roles", performance.now() - startTime);
      this.logger.info("Realm roles removed", { userId, roles: roleNames });
    } catch (error) {
      this.recordError("remove_realm_roles", error);
      throw error;
    }
  }

  /**
   * Assign client roles to user
   */
  async assignClientRoles(
    userId: string,
    clientId: string,
    roleNames: string[]
  ): Promise<void> {
    const startTime = performance.now();

    try {
      await this.roleManager.assignClientRoles(userId, clientId, roleNames);

      this.recordMetrics("assign_client_roles", performance.now() - startTime);
      this.logger.info("Client roles assigned", {
        userId,
        clientId,
        roles: roleNames,
      });
    } catch (error) {
      this.recordError("assign_client_roles", error);
      throw error;
    }
  }

  /**
   * Get complete user info with roles and permissions
   */
  async getCompleteUserInfo(userId: string): Promise<UserInfo | null> {
    const startTime = performance.now();

    try {
      // Get user data
      const user = await this.userRepository.getUserById(userId);
      if (!user) {
        return null;
      }

      // Get user's roles
      const realmRoles = await this.roleManager.getUserRealmRoles(userId);
      const roles = realmRoles.map((role) => `realm:${role.name}`);

      // Convert to UserInfo format using utility function
      // Note: Permissions would need additional logic based on your business rules
      const permissions: string[] = []; // Could be derived from roles or fetched separately

      const userInfo = keycloakUserToUserInfo(user, roles, permissions);

      this.recordMetrics(
        "get_complete_user_info",
        performance.now() - startTime
      );

      return userInfo;
    } catch (error) {
      this.recordError("get_complete_user_info", error);
      throw error;
    }
  }

  /**
   * Batch operations for efficiency
   */
  async batchCreateUsers(usersData: CreateUserOptions[]): Promise<
    Array<{
      success: boolean;
      userId?: string;
      username: string;
      error?: string;
    }>
  > {
    const results = [];

    for (const userData of usersData) {
      try {
        const userId = await this.createUser(userData);
        results.push({
          success: true,
          userId,
          username: userData.username,
        });
      } catch (error) {
        results.push({
          success: false,
          username: userData.username,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.info("Batch user creation completed", {
      total: usersData.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });

    return results;
  }

  /**
   * Search users with complete info (including roles)
   */
  async searchUsersWithInfo(options: UserSearchOptions): Promise<UserInfo[]> {
    const startTime = performance.now();

    try {
      const users = await this.searchUsers(options);

      // Get roles for all users (could be optimized with batch operations)
      const userInfos: UserInfo[] = [];

      for (const user of users) {
        if (user.id) {
          try {
            const userInfo = await this.getCompleteUserInfo(user.id);
            if (userInfo) {
              userInfos.push(userInfo);
            }
          } catch (error) {
            this.logger.warn("Failed to get complete info for user", {
              userId: user.id,
              username: user.username,
              error,
            });

            // Fallback to basic conversion using utility function
            const basicUserInfo = keycloakUserToUserInfo(user);
            userInfos.push(basicUserInfo);
          }
        }
      }

      this.recordMetrics(
        "search_users_with_info",
        performance.now() - startTime
      );

      return userInfos;
    } catch (error) {
      this.recordError("search_users_with_info", error);
      throw error;
    }
  }

  // Private utility methods

  private recordMetrics(operation: string, duration?: number): void {
    this.metrics?.recordCounter(`keycloak_user_service.${operation}`, 1);
    if (duration !== undefined) {
      this.metrics?.recordTimer(
        `keycloak_user_service.${operation}_duration`,
        duration
      );
    }
  }

  private recordError(operation: string, error: unknown): void {
    this.metrics?.recordCounter(`keycloak_user_service.${operation}_error`, 1);
    this.logger.error(`${operation} failed`, { error });
  }
}
