/**
 * @fileoverview User Service Implementation - Step 4.1
 * Enterprise-grade user management service with complete CRUD operations,
 * authentication integration, session management, and permission handling.
 *
 * Features:
 * - Complete user lifecycle management
 * - Secure authentication with password hashing
 * - Session and permission integration
 * - Performance optimization with caching
 * - Comprehensive audit trails
 * - Batch operations for high throughput
 * - User lockout and security features
 *
 * @version 2.3.0
 * @author Enterprise Auth Foundation
 */

import { Logger } from "../utils/logger";
import { DatabaseUtils } from "../utils/database-utils";
import { PasswordService } from "./password-service";
import { UnifiedSessionManager } from "./unified-session-manager";
import { PermissionService } from "./permission-service";
import {
  User,
  CreateUserData,
  UpdateUserData,
  UserStatus,
  UserSecurityProfile,
} from "../models/user-models";
import { Role } from "../models/permission-models";

// Re-export UserSecurityProfile for external use
export type { UserSecurityProfile } from "../models/user-models";

/**
 * User Service Interface
 * Defines the contract for user management operations
 */
export interface IUserService {
  // Core CRUD Operations
  createUser(userData: CreateUserData): Promise<User>;
  getUserById(userId: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  updateUser(userId: string, updates: UpdateUserData): Promise<User>;
  deleteUser(userId: string): Promise<void>;

  // Authentication Operations
  authenticateUser(email: string, password: string): Promise<User | null>;
  updateUserPassword(userId: string, newPassword: string): Promise<void>;
  lockoutUser(userId: string, reason: string): Promise<void>;
  unlockUser(userId: string): Promise<void>;

  // Batch Operations
  batchGetUsers(userIds: string[]): Promise<Map<string, User>>;
  batchCreateUsers(usersData: CreateUserData[]): Promise<User[]>;
  batchUpdateUsers(
    updates: Array<{ userId: string; data: UpdateUserData }>
  ): Promise<User[]>;

  // Security Operations
  getUserSecurityProfile(userId: string): Promise<UserSecurityProfile>;
  updateUserSecuritySettings(
    userId: string,
    settings: Partial<UserSecurityProfile>
  ): Promise<void>;
  logSecurityEvent(
    userId: string,
    event: string,
    metadata?: Record<string, any>
  ): Promise<void>;

  // Performance Operations
  preloadUserData(userIds: string[]): Promise<void>;
  warmUserCache(userId: string): Promise<void>;

  // Analytics Operations
  getUserLoginHistory(userId: string, limit?: number): Promise<any[]>;
  getUserActivitySummary(userId: string, days?: number): Promise<any>;
}

/**
 * User Service Error Types
 */
export class UserServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly userId?: string,
    public readonly metadata?: Record<string, any>
  ) {
    super(message);
    this.name = "UserServiceError";
  }
}

export class UserNotFoundError extends UserServiceError {
  constructor(identifier: string) {
    super(`User not found: ${identifier}`, "USER_NOT_FOUND", identifier);
  }
}

export class UserAlreadyExistsError extends UserServiceError {
  constructor(email: string) {
    super(
      `User already exists with email: ${email}`,
      "USER_ALREADY_EXISTS",
      undefined,
      { email }
    );
  }
}

export class AuthenticationFailedError extends UserServiceError {
  constructor(email: string, reason: string) {
    super(
      `Authentication failed for ${email}: ${reason}`,
      "AUTHENTICATION_FAILED",
      undefined,
      { email, reason }
    );
  }
}

export class UserLockedError extends UserServiceError {
  constructor(userId: string, lockReason: string) {
    super(`User account is locked: ${lockReason}`, "USER_LOCKED", userId, {
      lockReason,
    });
  }
}

/**
 * User Cache Manager
 * High-performance caching layer for user data
 */
class UserCacheManager {
  private readonly userCache = new Map<
    string,
    { user: User; timestamp: number }
  >();
  private readonly emailToIdCache = new Map<string, string>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 10000;

  /**
   * Get user from cache
   */
  getUser(userId: string): User | null {
    const cached = this.userCache.get(userId);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.CACHE_TTL) {
      this.userCache.delete(userId);
      return null;
    }

    return cached.user;
  }

  /**
   * Set user in cache
   */
  setUser(user: User): void {
    // Implement LRU eviction if cache is full
    if (this.userCache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.userCache.keys().next().value;
      if (oldestKey) {
        this.userCache.delete(oldestKey);
      }
    }

    this.userCache.set(user.id, {
      user: { ...user },
      timestamp: Date.now(),
    });

    this.emailToIdCache.set(user.email, user.id);
  }

  /**
   * Get user ID by email from cache
   */
  getUserIdByEmail(email: string): string | null {
    return this.emailToIdCache.get(email) || null;
  }

  /**
   * Invalidate user cache
   */
  invalidateUser(userId: string): void {
    const cached = this.userCache.get(userId);
    if (cached) {
      this.emailToIdCache.delete(cached.user.email);
    }
    this.userCache.delete(userId);
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.userCache.clear();
    this.emailToIdCache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.userCache.size,
      hitRate: 0, // Would be calculated with hit/miss tracking
      memoryUsage: this.userCache.size * 1024, // Rough estimate
    };
  }
}

/**
 * User Service Implementation
 * Enterprise-grade user management with comprehensive features
 */
export class UserService implements IUserService {
  private readonly logger: Logger;
  private readonly db: DatabaseUtils;
  private readonly passwordService: PasswordService;
  private readonly sessionManager: UnifiedSessionManager;
  private readonly permissionService: PermissionService;
  private readonly cache: UserCacheManager;
  private readonly metrics: Map<string, number> = new Map();

  constructor(
    db: DatabaseUtils,
    passwordService: PasswordService,
    sessionManager: UnifiedSessionManager,
    permissionService: PermissionService,
    logger: Logger
  ) {
    this.db = db;
    this.passwordService = passwordService;
    this.sessionManager = sessionManager;
    this.permissionService = permissionService;
    this.logger = logger;
    this.cache = new UserCacheManager();

    this.initializeMetrics();
    this.logger.info("UserService initialized", {
      version: "2.3.0",
      features: [
        "caching",
        "batch_operations",
        "security_profiles",
        "audit_trails",
      ],
    });
  }

  /**
   * Initialize performance metrics
   */
  private initializeMetrics(): void {
    this.metrics.set("users_created", 0);
    this.metrics.set("users_updated", 0);
    this.metrics.set("users_deleted", 0);
    this.metrics.set("authentication_attempts", 0);
    this.metrics.set("authentication_successes", 0);
    this.metrics.set("authentication_failures", 0);
    this.metrics.set("cache_hits", 0);
    this.metrics.set("cache_misses", 0);
  }

  /**
   * Convert error to string safely
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
  /**
   * Create a new user
   */
  async createUser(userData: CreateUserData): Promise<User> {
    const startTime = Date.now();

    try {
      this.logger.debug("Creating user", { email: userData.email });

      // Validate input data
      this.validateCreateUserData(userData);

      // Check if user already exists
      const existingUser = await this.getUserByEmail(userData.email);
      if (existingUser) {
        throw new UserAlreadyExistsError(userData.email);
      }

      // Hash password
      const hashedPassword = await this.passwordService.hashPassword(
        userData.password
      );

      // Generate user ID
      const userId = this.generateUserId();

      // Create user record
      const user: User = {
        id: userId,
        email: userData.email,
        username: userData.username,
        firstName: userData.firstName,
        lastName: userData.lastName,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        phoneVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLoginAt: null,
        loginCount: 0,
        role: await this.resolveRoleFromId(userData.role || "customer"), // Resolve role ID to Role object
        roleAssignedAt: new Date(), // Track when role was assigned
        roleRevokedAt: null, // Active role
        roleAssignedBy: null, // System assignment for new users
        roleRevokedBy: null,
        roleExpiresAt: null, // No expiration by default
        metadata: userData.metadata || {},
      };

      // Store in database (mock implementation)
      await this.storeUserInDatabase(user, hashedPassword);

      // Cache the user
      this.cache.setUser(user);

      // Update metrics
      this.metrics.set(
        "users_created",
        (this.metrics.get("users_created") || 0) + 1
      );

      // Log audit event
      await this.logSecurityEvent(userId, "user_created", {
        email: userData.email,
        role: userData.role,
        duration: Date.now() - startTime,
      });

      this.logger.info("User created successfully", {
        userId: user.id,
        email: user.email,
        duration: Date.now() - startTime,
      });

      return user;
    } catch (error) {
      this.logger.error("Failed to create user", {
        email: userData.email,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    const startTime = Date.now();

    try {
      // Check cache first
      const cachedUser = this.cache.getUser(userId);
      if (cachedUser) {
        this.metrics.set(
          "cache_hits",
          (this.metrics.get("cache_hits") || 0) + 1
        );
        this.logger.debug("User retrieved from cache", { userId });
        return cachedUser;
      }

      this.metrics.set(
        "cache_misses",
        (this.metrics.get("cache_misses") || 0) + 1
      );

      // Fetch from database
      const user = await this.fetchUserFromDatabase(userId);

      if (user) {
        this.cache.setUser(user);
        this.logger.debug("User retrieved from database", {
          userId,
          duration: Date.now() - startTime,
        });
      } else {
        this.logger.debug("User not found", { userId });
      }

      return user;
    } catch (error) {
      this.logger.error("Failed to get user by ID", {
        userId,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    const startTime = Date.now();

    try {
      // Check if we have the user ID cached
      const cachedUserId = this.cache.getUserIdByEmail(email);
      if (cachedUserId) {
        const cachedUser = this.cache.getUser(cachedUserId);
        if (cachedUser) {
          this.metrics.set(
            "cache_hits",
            (this.metrics.get("cache_hits") || 0) + 1
          );
          this.logger.debug("User retrieved from cache by email", { email });
          return cachedUser;
        }
      }

      this.metrics.set(
        "cache_misses",
        (this.metrics.get("cache_misses") || 0) + 1
      );

      // Fetch from database
      const user = await this.fetchUserByEmailFromDatabase(email);

      if (user) {
        this.cache.setUser(user);
        this.logger.debug("User retrieved from database by email", {
          email,
          userId: user.id,
          duration: Date.now() - startTime,
        });
      } else {
        this.logger.debug("User not found by email", { email });
      }

      return user;
    } catch (error) {
      this.logger.error("Failed to get user by email", {
        email,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Update user
   */
  async updateUser(userId: string, updates: UpdateUserData): Promise<User> {
    const startTime = Date.now();

    try {
      this.logger.debug("Updating user", {
        userId,
        updates: Object.keys(updates),
      });

      // Validate input
      this.validateUpdateUserData(updates);

      // Get current user
      const currentUser = await this.getUserById(userId);
      if (!currentUser) {
        throw new UserNotFoundError(userId);
      }

      // Check email uniqueness if email is being updated
      if (updates.email && updates.email !== currentUser.email) {
        const existingUser = await this.getUserByEmail(updates.email);
        if (existingUser) {
          throw new UserAlreadyExistsError(updates.email);
        }
      }

      // Create updated user object - handle role updates properly
      const { role: roleUpdate, ...otherUpdates } = updates;

      const updatedUser: User = {
        ...currentUser,
        ...otherUpdates,
        updatedAt: new Date(),
      };

      // If role is being updated, resolve role ID to Role object and track assignment
      if (roleUpdate && typeof roleUpdate === "string") {
        updatedUser.role = await this.resolveRoleFromId(roleUpdate);
        updatedUser.roleAssignedAt = new Date(); // Track when new role was assigned
        updatedUser.roleRevokedAt = null; // Clear any previous revocation
        // Note: roleAssignedBy should be set by the calling service with the current user's ID
      }

      // Update in database
      await this.updateUserInDatabase(updatedUser);

      // Invalidate cache
      this.cache.invalidateUser(userId);
      this.cache.setUser(updatedUser);

      // Update metrics
      this.metrics.set(
        "users_updated",
        (this.metrics.get("users_updated") || 0) + 1
      );

      // Log audit event
      await this.logSecurityEvent(userId, "user_updated", {
        changes: Object.keys(updates),
        duration: Date.now() - startTime,
      });

      this.logger.info("User updated successfully", {
        userId,
        changes: Object.keys(updates),
        duration: Date.now() - startTime,
      });

      return updatedUser;
    } catch (error) {
      this.logger.error("Failed to update user", {
        userId,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Delete user
   */
  async deleteUser(userId: string): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.debug("Deleting user", { userId });

      // Get user first
      const user = await this.getUserById(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      // Delete user in database
      // Delete user in database
      await this.deleteUserFromDatabase(userId);

      // Invalidate all user sessions by getting and deleting them
      try {
        const userSessions = await this.sessionManager.getUserSessions(userId);
        for (const sessionId of userSessions) {
          await this.sessionManager.deleteSession(sessionId);
        }
      } catch (sessionError) {
        this.logger.warn("Failed to invalidate user sessions during delete", {
          userId,
          error: sessionError,
        });
      }

      // Invalidate cache
      this.cache.invalidateUser(userId);

      // Update metrics
      this.metrics.set(
        "users_deleted",
        (this.metrics.get("users_deleted") || 0) + 1
      );

      // Log audit event
      await this.logSecurityEvent(userId, "user_deleted", {
        email: user.email,
        duration: Date.now() - startTime,
      });

      this.logger.info("User deleted successfully", {
        userId,
        email: user.email,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error("Failed to delete user", {
        userId,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Authenticate user
   */
  async authenticateUser(
    email: string,
    password: string
  ): Promise<User | null> {
    const startTime = Date.now();

    try {
      this.logger.debug("Authenticating user", { email });

      // Update metrics
      this.metrics.set(
        "authentication_attempts",
        (this.metrics.get("authentication_attempts") || 0) + 1
      );

      // Get user by email
      const user = await this.getUserByEmail(email);
      if (!user) {
        this.metrics.set(
          "authentication_failures",
          (this.metrics.get("authentication_failures") || 0) + 1
        );
        await this.logSecurityEvent("unknown", "authentication_failed", {
          email,
          reason: "user_not_found",
          duration: Date.now() - startTime,
        });
        throw new AuthenticationFailedError(email, "Invalid credentials");
      }

      // Check if user is locked
      if (user.status === UserStatus.LOCKED) {
        this.metrics.set(
          "authentication_failures",
          (this.metrics.get("authentication_failures") || 0) + 1
        );
        await this.logSecurityEvent(user.id, "authentication_failed", {
          email,
          reason: "account_locked",
          duration: Date.now() - startTime,
        });
        throw new UserLockedError(user.id, "Account is locked");
      }

      // Verify password
      const hashedPassword = await this.getHashedPassword(user.id);
      const isPasswordValid = await this.passwordService.verifyPassword(
        password,
        hashedPassword
      );

      if (!isPasswordValid) {
        this.metrics.set(
          "authentication_failures",
          (this.metrics.get("authentication_failures") || 0) + 1
        );
        await this.logSecurityEvent(user.id, "authentication_failed", {
          email,
          reason: "invalid_password",
          duration: Date.now() - startTime,
        });
        throw new AuthenticationFailedError(email, "Invalid credentials");
      }

      // Update login statistics
      const updatedUser = await this.updateUser(user.id, {
        lastLoginAt: new Date(),
        loginCount: user.loginCount + 1,
      });

      this.metrics.set(
        "authentication_successes",
        (this.metrics.get("authentication_successes") || 0) + 1
      );

      await this.logSecurityEvent(user.id, "authentication_success", {
        email,
        duration: Date.now() - startTime,
      });

      this.logger.info("User authenticated successfully", {
        userId: user.id,
        email,
        duration: Date.now() - startTime,
      });

      return updatedUser;
    } catch (error) {
      this.logger.error("Authentication failed", {
        email,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Update user password
   */
  async updateUserPassword(userId: string, newPassword: string): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.debug("Updating user password", { userId });

      // Validate password
      this.validatePassword(newPassword);

      // Get user
      const user = await this.getUserById(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      // Hash new password
      const hashedPassword = await this.passwordService.hashPassword(
        newPassword
      );

      // Update password in database
      await this.updatePasswordInDatabase(userId, hashedPassword);

      // Log audit event
      await this.logSecurityEvent(userId, "password_updated", {
        duration: Date.now() - startTime,
      });

      this.logger.info("User password updated successfully", {
        userId,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error("Failed to update user password", {
        userId,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Lock user account
   */
  async lockoutUser(userId: string, reason: string): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.debug("Locking user account", { userId, reason });

      await this.updateUser(userId, {
        status: UserStatus.LOCKED,
        metadata: { lockReason: reason, lockedAt: new Date().toISOString() },
      });

      // Invalidate all user sessions by getting and deleting them
      try {
        const userSessions = await this.sessionManager.getUserSessions(userId);
        for (const sessionId of userSessions) {
          await this.sessionManager.deleteSession(sessionId);
        }
      } catch (sessionError) {
        this.logger.warn("Failed to invalidate user sessions during lockout", {
          userId,
          error: sessionError,
        });
      }

      await this.logSecurityEvent(userId, "user_locked", {
        reason,
        duration: Date.now() - startTime,
      });

      this.logger.warn("User account locked", {
        userId,
        reason,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error("Failed to lock user account", {
        userId,
        reason,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Revoke user role for security purposes
   */
  async revokeUserRole(
    userId: string,
    revokedBy: string,
    reason?: string
  ): Promise<User> {
    const startTime = Date.now();

    try {
      this.logger.debug("Revoking user role", { userId, revokedBy, reason });

      const user = await this.getUserById(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      if (!user.role || user.roleRevokedAt) {
        throw new UserServiceError(
          "User has no active role to revoke",
          "NO_ACTIVE_ROLE",
          userId
        );
      }

      // Update user with revocation details
      const updatedUser = await this.updateUser(userId, {
        roleRevokedAt: new Date(),
        roleRevokedBy: revokedBy,
        metadata: {
          ...user.metadata,
          lastRoleRevocationReason: reason,
        },
      });

      // Invalidate all user sessions since access has been revoked
      try {
        const userSessions = await this.sessionManager.getUserSessions(userId);
        for (const sessionId of userSessions) {
          await this.sessionManager.deleteSession(sessionId);
        }
      } catch (sessionError) {
        this.logger.warn(
          "Failed to invalidate user sessions during role revocation",
          {
            userId,
            error: sessionError,
          }
        );
      }

      await this.logSecurityEvent(userId, "role_revoked", {
        roleId: user.role.id,
        roleName: user.role.name,
        revokedBy,
        reason,
        duration: Date.now() - startTime,
      });

      this.logger.warn("User role revoked", {
        userId,
        roleId: user.role.id,
        revokedBy,
        reason,
        duration: Date.now() - startTime,
      });

      return updatedUser;
    } catch (error) {
      this.logger.error("Failed to revoke user role", {
        userId,
        revokedBy,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Check if user has active (non-revoked) role
   */
  hasActiveRole(user: User): boolean {
    return !!(
      user.role &&
      !user.roleRevokedAt &&
      (!user.roleExpiresAt || user.roleExpiresAt > new Date())
    );
  }

  /**
   * Check if user role has expired
   */
  isRoleExpired(user: User): boolean {
    return !!(user.roleExpiresAt && user.roleExpiresAt <= new Date());
  }

  /**
   * Unlock user account
   */
  async unlockUser(userId: string): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.debug("Unlocking user account", { userId });

      const user = await this.getUserById(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      // Remove lock-related metadata
      const cleanedMetadata = { ...user.metadata };
      delete cleanedMetadata.lockReason;
      delete cleanedMetadata.lockedAt;

      await this.updateUser(userId, {
        status: UserStatus.ACTIVE,
        metadata: cleanedMetadata,
      });

      await this.logSecurityEvent(userId, "user_unlocked", {
        duration: Date.now() - startTime,
      });

      this.logger.info("User account unlocked", {
        userId,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error("Failed to unlock user account", {
        userId,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Batch get users
   */
  async batchGetUsers(userIds: string[]): Promise<Map<string, User>> {
    const startTime = Date.now();
    const result = new Map<string, User>();
    const uncachedIds: string[] = [];

    try {
      this.logger.debug("Batch getting users", { count: userIds.length });

      // Check cache first
      for (const userId of userIds) {
        const cachedUser = this.cache.getUser(userId);
        if (cachedUser) {
          result.set(userId, cachedUser);
          this.metrics.set(
            "cache_hits",
            (this.metrics.get("cache_hits") || 0) + 1
          );
        } else {
          uncachedIds.push(userId);
          this.metrics.set(
            "cache_misses",
            (this.metrics.get("cache_misses") || 0) + 1
          );
        }
      }

      // Fetch uncached users from database
      if (uncachedIds.length > 0) {
        const fetchedUsers = await this.batchFetchUsersFromDatabase(
          uncachedIds
        );

        for (const user of fetchedUsers) {
          result.set(user.id, user);
          this.cache.setUser(user);
        }
      }

      this.logger.debug("Batch get users completed", {
        requested: userIds.length,
        found: result.size,
        cached: userIds.length - uncachedIds.length,
        fetched: uncachedIds.length,
        duration: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      this.logger.error("Failed to batch get users", {
        userIds: userIds.length,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Batch create users
   */
  async batchCreateUsers(usersData: CreateUserData[]): Promise<User[]> {
    const startTime = Date.now();
    const createdUsers: User[] = [];

    try {
      this.logger.debug("Batch creating users", { count: usersData.length });

      // Process in batches to avoid overwhelming the system
      const BATCH_SIZE = 50;

      for (let i = 0; i < usersData.length; i += BATCH_SIZE) {
        const batch = usersData.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map((userData) => this.createUser(userData))
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            createdUsers.push(result.value);
          } else {
            this.logger.error("Failed to create user in batch", {
              error: result.reason.message,
            });
          }
        }
      }

      this.logger.info("Batch create users completed", {
        requested: usersData.length,
        created: createdUsers.length,
        failed: usersData.length - createdUsers.length,
        duration: Date.now() - startTime,
      });

      return createdUsers;
    } catch (error) {
      this.logger.error("Failed to batch create users", {
        count: usersData.length,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Batch update users
   */
  async batchUpdateUsers(
    updates: Array<{ userId: string; data: UpdateUserData }>
  ): Promise<User[]> {
    const startTime = Date.now();
    const updatedUsers: User[] = [];

    try {
      this.logger.debug("Batch updating users", { count: updates.length });

      // Process in batches
      const BATCH_SIZE = 50;

      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map((update) => this.updateUser(update.userId, update.data))
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            updatedUsers.push(result.value);
          } else {
            this.logger.error("Failed to update user in batch", {
              error: result.reason.message,
            });
          }
        }
      }

      this.logger.info("Batch update users completed", {
        requested: updates.length,
        updated: updatedUsers.length,
        failed: updates.length - updatedUsers.length,
        duration: Date.now() - startTime,
      });

      return updatedUsers;
    } catch (error) {
      this.logger.error("Failed to batch update users", {
        count: updates.length,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get user security profile
   */
  async getUserSecurityProfile(userId: string): Promise<UserSecurityProfile> {
    const startTime = Date.now();

    try {
      this.logger.debug("Getting user security profile", { userId });

      const user = await this.getUserById(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      // Build security profile from user data and additional security information
      const securityProfile: UserSecurityProfile = {
        userId: user.id,
        twoFactorEnabled: user.metadata?.twoFactorEnabled === true,
        lastPasswordChange: user.metadata?.lastPasswordChange
          ? new Date(user.metadata.lastPasswordChange)
          : user.updatedAt,
        failedLoginAttempts: user.metadata?.failedLoginAttempts || 0,
        accountLocked: user.status === UserStatus.LOCKED,
        lockReason: user.metadata?.lockReason,
        passwordExpiryDate: user.metadata?.passwordExpiryDate
          ? new Date(user.metadata.passwordExpiryDate)
          : null,
        securityQuestions: user.metadata?.securityQuestions || [],
        trustedDevices: user.metadata?.trustedDevices || [],
        loginNotifications: user.metadata?.loginNotifications !== false,
        apiKeysCount: 0, // Would be fetched from API key service
        activeSessions: 0, // Would be fetched from session manager
        lastSecurityAudit: user.metadata?.lastSecurityAudit
          ? new Date(user.metadata.lastSecurityAudit)
          : null,
      };

      this.logger.debug("User security profile retrieved", {
        userId,
        duration: Date.now() - startTime,
      });

      return securityProfile;
    } catch (error) {
      this.logger.error("Failed to get user security profile", {
        userId,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Update user security settings
   */
  async updateUserSecuritySettings(
    userId: string,
    settings: Partial<UserSecurityProfile>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.debug("Updating user security settings", { userId });

      const user = await this.getUserById(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      // Update user metadata with security settings
      const updatedMetadata = { ...user.metadata };

      if (settings.twoFactorEnabled !== undefined) {
        updatedMetadata.twoFactorEnabled = settings.twoFactorEnabled;
      }

      if (settings.loginNotifications !== undefined) {
        updatedMetadata.loginNotifications = settings.loginNotifications;
      }

      if (settings.securityQuestions !== undefined) {
        updatedMetadata.securityQuestions = settings.securityQuestions;
      }

      if (settings.trustedDevices !== undefined) {
        updatedMetadata.trustedDevices = settings.trustedDevices;
      }

      await this.updateUser(userId, { metadata: updatedMetadata });

      await this.logSecurityEvent(userId, "security_settings_updated", {
        changes: Object.keys(settings),
        duration: Date.now() - startTime,
      });

      this.logger.info("User security settings updated", {
        userId,
        changes: Object.keys(settings),
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error("Failed to update user security settings", {
        userId,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Log security event
   */
  async logSecurityEvent(
    userId: string,
    event: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    try {
      const securityEvent = {
        userId,
        event,
        timestamp: new Date().toISOString(),
        metadata: {
          ...metadata,
          userAgent: metadata.userAgent || "system",
          ipAddress: metadata.ipAddress || "127.0.0.1",
        },
      };

      // In a real implementation, this would go to a security audit log
      this.logger.info("Security event logged", securityEvent);
    } catch (error) {
      this.logger.error("Failed to log security event", {
        userId,
        event,
        error: this.getErrorMessage(error),
      });
    }
  }

  /**
   * Preload user data into cache
   */
  async preloadUserData(userIds: string[]): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.debug("Preloading user data", { count: userIds.length });

      const uncachedIds = userIds.filter((id) => !this.cache.getUser(id));

      if (uncachedIds.length > 0) {
        const users = await this.batchFetchUsersFromDatabase(uncachedIds);
        users.forEach((user) => this.cache.setUser(user));
      }

      this.logger.debug("User data preloaded", {
        requested: userIds.length,
        alreadyCached: userIds.length - uncachedIds.length,
        loaded: uncachedIds.length,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      this.logger.error("Failed to preload user data", {
        count: userIds.length,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Warm user cache
   */
  async warmUserCache(userId: string): Promise<void> {
    try {
      const user = await this.getUserById(userId);
      if (user) {
        this.cache.setUser(user);
        this.logger.debug("User cache warmed", { userId });
      }
    } catch (error) {
      this.logger.error("Failed to warm user cache", {
        userId,
        error: this.getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Get user login history
   */
  async getUserLoginHistory(
    userId: string,
    limit: number = 50
  ): Promise<any[]> {
    const startTime = Date.now();

    try {
      this.logger.debug("Getting user login history", { userId, limit });

      // In a real implementation, this would query a login history table
      const history = await this.fetchLoginHistoryFromDatabase(userId, limit);

      this.logger.debug("User login history retrieved", {
        userId,
        count: history.length,
        duration: Date.now() - startTime,
      });

      return history;
    } catch (error) {
      this.logger.error("Failed to get user login history", {
        userId,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get user activity summary
   */
  async getUserActivitySummary(
    userId: string,
    days: number = 30
  ): Promise<any> {
    const startTime = Date.now();

    try {
      this.logger.debug("Getting user activity summary", { userId, days });

      const user = await this.getUserById(userId);
      if (!user) {
        throw new UserNotFoundError(userId);
      }

      // In a real implementation, this would aggregate activity data
      const summary = {
        userId,
        period: `${days} days`,
        totalLogins: user.loginCount,
        lastLogin: user.lastLoginAt,
        averageLoginsPerDay: Math.round((user.loginCount / days) * 100) / 100,
        sessionsCreated: 0, // Would be fetched from session manager
        apiCallsCount: 0, // Would be fetched from API usage logs
        dataAccessCount: 0, // Would be fetched from audit logs
        securityEvents: 0, // Would be fetched from security logs
      };

      this.logger.debug("User activity summary retrieved", {
        userId,
        duration: Date.now() - startTime,
      });

      return summary;
    } catch (error) {
      this.logger.error("Failed to get user activity summary", {
        userId,
        error: this.getErrorMessage(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    return {
      ...Object.fromEntries(this.metrics),
      cacheStats: this.cache.getStats(),
    };
  }

  // Private helper methods

  private validateCreateUserData(userData: CreateUserData): void {
    if (!userData.email || !this.isValidEmail(userData.email)) {
      throw new UserServiceError("Invalid email address", "INVALID_EMAIL");
    }

    if (!userData.password || userData.password.length < 8) {
      throw new UserServiceError(
        "Password must be at least 8 characters",
        "INVALID_PASSWORD"
      );
    }

    if (!userData.firstName || userData.firstName.length < 1) {
      throw new UserServiceError(
        "First name is required",
        "INVALID_FIRST_NAME"
      );
    }

    if (!userData.lastName || userData.lastName.length < 1) {
      throw new UserServiceError("Last name is required", "INVALID_LAST_NAME");
    }
  }

  private validateUpdateUserData(updates: UpdateUserData): void {
    if (updates.email && !this.isValidEmail(updates.email)) {
      throw new UserServiceError("Invalid email address", "INVALID_EMAIL");
    }
  }

  private validatePassword(password: string): void {
    if (!password || password.length < 8) {
      throw new UserServiceError(
        "Password must be at least 8 characters",
        "INVALID_PASSWORD"
      );
    }

    // Additional password complexity checks would go here
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private generateUserId(): string {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Mock database operations - in real implementation these would use actual database

  private async storeUserInDatabase(
    user: User,
    hashedPassword: string
  ): Promise<void> {
    // Mock implementation - in production would use Prisma client
    try {
      // Example of how this would work with the new schema:
      // const db = PostgreSQLClient.getInstance();
      // await db.user.create({
      //   data: {
      //     id: user.id,
      //     email: user.email,
      //     password: hashedPassword,
      //     username: user.username,
      //     firstName: user.firstName,
      //     lastName: user.lastName,
      //     phone: user.phone,
      //     status: user.status,
      //     emailVerified: user.emailVerified,
      //     phoneVerified: user.phoneVerified,
      //     lastLoginAt: user.lastLoginAt,
      //     loginCount: user.loginCount,
      //     roleId: user.role.id, // Store role ID, role object populated on read
      //     metadata: user.metadata,
      //   }
      // });

      this.logger.debug("Storing user in database", { userId: user.id });
    } catch (error) {
      this.logger.error("Failed to store user in database", {
        userId: user.id,
        error: this.getErrorMessage(error),
      });
      throw error;
    }
  }

  private async fetchUserFromDatabase(userId: string): Promise<User | null> {
    // Mock implementation - in production would use Prisma client with role population
    try {
      // Example of how this would work with the new schema:
      // const db = PostgreSQLClient.getInstance();
      // const userData = await db.user.findUnique({
      //   where: { id: userId },
      //   include: {
      //     role: {
      //       include: {
      //         permissions: true
      //       }
      //     }
      //   }
      // });
      //
      // if (!userData) return null;
      //
      // return {
      //   id: userData.id,
      //   email: userData.email,
      //   username: userData.username,
      //   firstName: userData.firstName,
      //   lastName: userData.lastName,
      //   phone: userData.phone,
      //   status: userData.status,
      //   emailVerified: userData.emailVerified,
      //   phoneVerified: userData.phoneVerified,
      //   lastLoginAt: userData.lastLoginAt,
      //   loginCount: userData.loginCount,
      //   role: userData.role, // Full role object with permissions
      //   metadata: userData.metadata,
      //   createdAt: userData.createdAt,
      //   updatedAt: userData.updatedAt,
      // };

      this.logger.debug("Fetching user from database", { userId });
      return null; // Mock: user not found
    } catch (error) {
      this.logger.error("Failed to fetch user from database", {
        userId,
        error: this.getErrorMessage(error),
      });
      return null;
    }
  }

  private async fetchUserByEmailFromDatabase(
    email: string
  ): Promise<User | null> {
    // Mock implementation - would query actual database
    this.logger.debug("Fetching user by email from database", { email });
    return null; // Mock: user not found
  }

  private async updateUserInDatabase(user: User): Promise<void> {
    // Mock implementation - would update in actual database
    this.logger.debug("Updating user in database", { userId: user.id });
  }

  private async deleteUserFromDatabase(userId: string): Promise<void> {
    // Mock implementation - would soft delete in actual database
    this.logger.debug("Deleting user from database", { userId });
  }

  private async getHashedPassword(userId: string): Promise<string> {
    // Mock implementation - would fetch from password table
    this.logger.debug("Getting hashed password", { userId });
    return "mock_hashed_password";
  }

  private async updatePasswordInDatabase(
    userId: string,
    hashedPassword: string
  ): Promise<void> {
    // Mock implementation - would update password in database
    this.logger.debug("Updating password in database", { userId });
  }

  private async batchFetchUsersFromDatabase(
    userIds: string[]
  ): Promise<User[]> {
    // Mock implementation - would batch query database
    this.logger.debug("Batch fetching users from database", {
      count: userIds.length,
    });
    return []; // Mock: no users found
  }

  private async fetchLoginHistoryFromDatabase(
    userId: string,
    limit: number
  ): Promise<any[]> {
    // Mock implementation - would query login history table
    this.logger.debug("Fetching login history from database", {
      userId,
      limit,
    });
    return []; // Mock: no history found
  }

  /**
   * Resolve role ID to Role object
   * In production, this would query the role from database/service
   */
  private async resolveRoleFromId(roleId: string): Promise<Role> {
    try {
      // Mock implementation - in real system would query role service
      const mockRole: Role = {
        id: roleId,
        name: roleId,
        displayName: roleId.charAt(0).toUpperCase() + roleId.slice(1),
        description: `${roleId} role`,
        permissions: [], // Would be populated from actual role service
        parentRoles: [],
        childRoles: [],
        metadata: {
          category: "functional" as any,
          level: 5 as any,
          department: "general",
          owner: "system",
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: "1.0.0",
      };

      this.logger.debug("Role resolved", { roleId, role: mockRole.name });
      return mockRole;
    } catch (error) {
      this.logger.error("Failed to resolve role", { roleId, error });

      // Return default customer role on failure
      return {
        id: "customer",
        name: "customer",
        displayName: "Customer",
        description: "Default customer role",
        permissions: [],
        parentRoles: [],
        childRoles: [],
        metadata: {
          category: "functional" as any,
          level: 5 as any,
          department: "general",
          owner: "system",
        },
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: "1.0.0",
      };
    }
  }
}

// Export for dependency injection
export const createUserService = (
  db: DatabaseUtils,
  passwordService: PasswordService,
  sessionManager: UnifiedSessionManager,
  permissionService: PermissionService,
  logger: Logger
): UserService => {
  return new UserService(
    db,
    passwordService,
    sessionManager,
    permissionService,
    logger
  );
};
