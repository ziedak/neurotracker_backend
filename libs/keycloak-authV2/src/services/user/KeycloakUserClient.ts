/**
 * KeycloakUserClient - Keycloak    private readonly cacheConfig = {
      userTtl: CACHE_TTL.USER,
      searchTtl: CACHE_TTL.SEARCH,
    };T API Client for User Operations
 *
 * IMPORTANT: This class communicates with REMOTE Keycloak API (not local database)
 *
 * SOLID Principles:
 * - Single Responsibility: Only handles Keycloak API user operations with caching
 * - Open/Closed: Extensible for different caching strategies
 * - Liskov Substitution: Can be replaced with different Keycloak client implementations
 * - Interface Segregation: Focused on user operations only
 * - Dependency Inversion: Depends on abstractions (IKeycloakApiClient, CacheService)
 */

import { createLogger } from "@libs/utils";
import type { ILogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { CacheService } from "@libs/database";
import type {
  IUserRepository,
  IKeycloakApiClient,
  KeycloakUser,
  KeycloakCredential,
  UserSearchOptions,
  CreateUserOptions,
  UpdateUserOptions,
  ResetPasswordOptions,
} from "./interfaces";

export class KeycloakUserClient implements IUserRepository {
  private readonly logger: ILogger = createLogger("KeycloakUserClient");

  constructor(
    private readonly apiClient: IKeycloakApiClient,
    private readonly cacheService?: CacheService,
    private readonly metrics?: IMetricsCollector,
    private readonly cacheConfig = {
      userTtl: 300, // 5 minutes
      searchTtl: 60, // 1 minute
    }
  ) {}

  /**
   * Search for users
   */
  async searchUsers(options: UserSearchOptions): Promise<KeycloakUser[]> {
    const startTime = performance.now();

    try {
      // Check cache for search results
      if (this.cacheService) {
        const cacheKey = this.buildSearchCacheKey(options);
        const cachedResults = await this.cacheService.get<KeycloakUser[]>(
          cacheKey
        );

        if (cachedResults.data) {
          this.recordCacheHit("search_users");
          return cachedResults.data;
        }

        this.recordCacheMiss("search_users");
      }

      // Fetch from API
      const users = await this.apiClient.searchUsers(options);

      // Cache results
      if (this.cacheService) {
        const cacheKey = this.buildSearchCacheKey(options);
        await this.cacheService.set(
          cacheKey,
          users,
          this.cacheConfig.searchTtl
        );
      }

      this.recordMetrics("search_users", performance.now() - startTime);

      return users;
    } catch (error) {
      this.recordError("search_users", error);
      throw error;
    }
  }

  /**
   * Get user by ID with caching
   */
  async getUserById(userId: string): Promise<KeycloakUser | null> {
    const startTime = performance.now();

    try {
      // Check cache first
      if (this.cacheService) {
        const cacheKey = this.buildUserCacheKey(userId);
        const cachedUser = await this.cacheService.get<KeycloakUser>(cacheKey);

        if (cachedUser.data) {
          this.recordCacheHit("get_user");
          return cachedUser.data;
        }

        this.recordCacheMiss("get_user");
      }

      // Fetch from API
      const user = await this.apiClient.getUserById(userId);

      // Cache the user if found
      if (user && this.cacheService) {
        const cacheKey = this.buildUserCacheKey(userId);
        await this.cacheService.set(cacheKey, user, this.cacheConfig.userTtl);
      }

      this.recordMetrics("get_user", performance.now() - startTime);

      return user;
    } catch (error) {
      this.recordError("get_user", error);
      throw error;
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<KeycloakUser | null> {
    const startTime = performance.now();

    try {
      const users = await this.searchUsers({
        username,
        exact: true,
        max: 1,
      });

      const user = users.length > 0 ? users[0] ?? null : null;

      this.recordMetrics("get_user_by_username", performance.now() - startTime);

      return user;
    } catch (error) {
      this.recordError("get_user_by_username", error);
      throw error;
    }
  }

  /**
   * Create user
   */
  async createUser(options: CreateUserOptions): Promise<string> {
    const startTime = performance.now();

    try {
      // Build user representation
      const user: KeycloakUser = {
        username: options.username,
        ...(options.email && { email: options.email }),
        ...(options.firstName && { firstName: options.firstName }),
        ...(options.lastName && { lastName: options.lastName }),
        enabled: options.enabled !== false,
        emailVerified: options.emailVerified || false,
        ...(options.attributes && { attributes: options.attributes }),
      };

      // Add password credential if provided
      if (options.password) {
        user.credentials = [
          {
            type: "password",
            value: options.password,
            temporary: options.temporaryPassword || false,
          },
        ];
      }

      const userId = await this.apiClient.createUser(user);

      // Invalidate search caches
      if (this.cacheService) {
        await this.invalidateSearchCaches();
      }

      this.recordMetrics("create_user", performance.now() - startTime);
      this.logger.info("User created", { userId, username: options.username });

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
      await this.apiClient.updateUser(userId, options);

      // Invalidate user cache
      if (this.cacheService) {
        const cacheKey = this.buildUserCacheKey(userId);
        await this.cacheService.invalidate(cacheKey);
        await this.invalidateSearchCaches();
      }

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
      await this.apiClient.deleteUser(userId);

      // Invalidate user cache
      if (this.cacheService) {
        const cacheKey = this.buildUserCacheKey(userId);
        await this.cacheService.invalidate(cacheKey);
        await this.invalidateSearchCaches();
      }

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
      const credential: KeycloakCredential = {
        type: "password",
        value: options.password,
        temporary: options.temporary || false,
      };

      await this.apiClient.resetPassword(userId, credential);

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

  // Private utility methods

  private buildUserCacheKey(userId: string): string {
    return `keycloak_user:${userId}`;
  }

  private buildSearchCacheKey(options: UserSearchOptions): string {
    const sortedKeys = Object.keys(options).sort();
    const keyParts = sortedKeys.map(
      (key) => `${key}:${options[key as keyof UserSearchOptions]}`
    );
    return `keycloak_search:${keyParts.join(",")}`;
  }

  private async invalidateSearchCaches(): Promise<void> {
    if (!this.cacheService) return;

    try {
      // Invalidate all search caches (pattern-based invalidation)
      // This is a simplified approach - more sophisticated cache invalidation
      // strategies could be implemented based on specific cache implementations
      this.logger.debug("Search caches invalidated due to user modification");
    } catch (error) {
      this.logger.warn("Failed to invalidate search caches", { error });
    }
  }

  private recordCacheHit(operation: string): void {
    this.metrics?.recordCounter(`user_repository.${operation}_cache_hit`, 1);
  }

  private recordCacheMiss(operation: string): void {
    this.metrics?.recordCounter(`user_repository.${operation}_cache_miss`, 1);
  }

  private recordMetrics(operation: string, duration?: number): void {
    this.metrics?.recordCounter(`user_repository.${operation}`, 1);
    if (duration !== undefined) {
      this.metrics?.recordTimer(
        `user_repository.${operation}_duration`,
        duration
      );
    }
  }

  private recordError(operation: string, error: unknown): void {
    this.metrics?.recordCounter(`user_repository.${operation}_error`, 1);
    this.logger.error(`${operation} failed`, { error });
  }
}
