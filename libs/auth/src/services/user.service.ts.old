/**
 * Production-ready UserService for Authentication Library
 * Implements UserService interface with proper database integration
 */

import { PostgreSQLClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { UserIdentity, UserRole, UserStatus } from "../unified-context";

export interface User {
  id: string;
  email: string;
  name?: string;
  storeId?: string;
  role: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  password?: string; // Only for internal operations
  metadata?: Record<string, unknown>;
}

export interface UserWithRoles extends User {
  roles: UserRole[];
}

/**
 * Production UserService implementation
 */
export class UserService {
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(logger: Logger, metrics: MetricsCollector) {
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Get user by ID with proper error handling and logging
   */
  async getUserById(userId: string): Promise<UserIdentity | null> {
    try {
      if (!userId || typeof userId !== "string") {
        throw new Error("Invalid user ID provided");
      }

      await this.metrics.recordCounter("auth_user_service_get_by_id_requests");

      const db = PostgreSQLClient.getInstance();
      const user = await db.user.findUnique({
        where: { id: userId },
        include: {
          roles: {
            select: {
              role: true,
            },
          },
        },
      });

      if (!user) {
        this.logger.debug("User not found", { userId });
        return null;
      }

      await this.metrics.recordCounter("auth_user_service_get_by_id_success");

      return this.mapToUserIdentity(user);
    } catch (error) {
      this.logger.error("Failed to get user by ID", error as Error, { userId });
      await this.metrics.recordCounter("auth_user_service_errors");
      throw error;
    }
  }

  /**
   * Get user by email with proper error handling
   */
  async getUserByEmail(email: string): Promise<UserIdentity | null> {
    try {
      if (!email || typeof email !== "string" || !this.isValidEmail(email)) {
        throw new Error("Invalid email provided");
      }

      await this.metrics.recordCounter(
        "auth_user_service_get_by_email_requests"
      );

      const db = PostgreSQLClient.getInstance();
      const user = await db.user.findUnique({
        where: { email: email.toLowerCase() },
        include: {
          roles: {
            select: {
              role: true,
            },
          },
        },
      });

      if (!user) {
        this.logger.debug("User not found by email", { email });
        return null;
      }

      await this.metrics.recordCounter(
        "auth_user_service_get_by_email_success"
      );

      return this.mapToUserIdentity(user);
    } catch (error) {
      this.logger.error("Failed to get user by email", error as Error, {
        email,
      });
      await this.metrics.recordCounter("auth_user_service_errors");
      throw error;
    }
  }

  /**
   * Create user with proper validation and error handling
   */
  async createUser(userData: {
    email: string;
    name?: string;
    storeId?: string;
    role?: UserRole;
    status?: UserStatus;
    password?: string;
    metadata?: Record<string, unknown>;
  }): Promise<UserIdentity> {
    try {
      if (!userData.email || !this.isValidEmail(userData.email)) {
        throw new Error("Valid email is required");
      }

      await this.metrics.recordCounter("auth_user_service_create_requests");

      // Check if user already exists
      const existingUser = await this.getUserByEmail(userData.email);
      if (existingUser) {
        throw new Error("User with this email already exists");
      }

      const db = PostgreSQLClient.getInstance();
      const user = await db.user.create({
        data: {
          email: userData.email.toLowerCase(),
          name: userData.name,
          storeId: userData.storeId,
          password: userData.password || "", // Provide empty string fallback
          status: this.mapUserStatus(userData.status || "active") as any, // Cast to avoid enum typing issues
          auditLog: (userData.metadata || {}) as any, // Cast for JSON compatibility
        },
        include: {
          roles: {
            select: {
              role: true,
            },
          },
        },
      });

      // Create default role if specified
      if (userData.role && userData.role !== "customer") {
        await db.userRole.create({
          data: {
            userId: user.id,
            role: userData.role,
          },
        });
      }

      this.logger.info("User created successfully", {
        userId: user.id,
        email: user.email,
        role: userData.role,
      });

      await this.metrics.recordCounter("auth_user_service_create_success");

      return this.mapToUserIdentity(user);
    } catch (error) {
      this.logger.error("Failed to create user", error as Error, { userData });
      await this.metrics.recordCounter("auth_user_service_errors");
      throw error;
    }
  }

  /**
   * Update user status (activate, deactivate, suspend)
   */
  async updateUserStatus(userId: string, status: UserStatus): Promise<void> {
    try {
      if (!userId || !status) {
        throw new Error("User ID and status are required");
      }

      if (!["active", "inactive", "suspended", "pending"].includes(status)) {
        throw new Error("Invalid user status");
      }

      await this.metrics.recordCounter(
        "auth_user_service_update_status_requests"
      );

      const db = PostgreSQLClient.getInstance();
      await db.user.update({
        where: { id: userId },
        data: {
          status: this.mapUserStatus(status) as any, // Cast to avoid enum typing issues
          auditLog: {
            status,
            statusUpdatedAt: new Date().toISOString(),
          } as any,
        },
      });

      this.logger.info("User status updated", { userId, status });
      await this.metrics.recordCounter(
        "auth_user_service_update_status_success"
      );
    } catch (error) {
      this.logger.error("Failed to update user status", error as Error, {
        userId,
        status,
      });
      await this.metrics.recordCounter("auth_user_service_errors");
      throw error;
    }
  }

  /**
   * Get user roles
   */
  async getUserRoles(userId: string): Promise<string[]> {
    try {
      if (!userId) {
        throw new Error("User ID is required");
      }

      await this.metrics.recordCounter("auth_user_service_get_roles_requests");

      const db = PostgreSQLClient.getInstance();
      const userRoles = await db.userRole.findMany({
        where: { userId },
        select: { role: true },
      });

      const roles = userRoles.map((ur: { role: string }) => ur.role);

      // Default role if none assigned
      if (roles.length === 0) {
        return ["customer"];
      }

      await this.metrics.recordCounter("auth_user_service_get_roles_success");

      return roles;
    } catch (error) {
      this.logger.error("Failed to get user roles", error as Error, { userId });
      await this.metrics.recordCounter("auth_user_service_errors");
      throw error;
    }
  }

  /**
   * Add role to user
   */
  async addUserRole(userId: string, role: UserRole): Promise<void> {
    try {
      if (!userId || !role) {
        throw new Error("User ID and role are required");
      }

      await this.metrics.recordCounter("auth_user_service_add_role_requests");

      // Check if user exists
      const user = await this.getUserById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      const db = PostgreSQLClient.getInstance();
      // Check if role already exists
      const existingRole = await db.userRole.findFirst({
        where: { userId, role },
      });

      if (existingRole) {
        this.logger.debug("Role already exists for user", { userId, role });
        return;
      }

      await db.userRole.create({
        data: { userId, role },
      });

      this.logger.info("Role added to user", { userId, role });
      await this.metrics.recordCounter("auth_user_service_add_role_success");
    } catch (error) {
      this.logger.error("Failed to add user role", error as Error, {
        userId,
        role,
      });
      await this.metrics.recordCounter("auth_user_service_errors");
      throw error;
    }
  }

  /**
   * Remove role from user
   */
  async removeUserRole(userId: string, role: UserRole): Promise<void> {
    try {
      if (!userId || !role) {
        throw new Error("User ID and role are required");
      }

      await this.metrics.recordCounter(
        "auth_user_service_remove_role_requests"
      );

      const db = PostgreSQLClient.getInstance();
      await db.userRole.deleteMany({
        where: { userId, role },
      });

      this.logger.info("Role removed from user", { userId, role });
      await this.metrics.recordCounter("auth_user_service_remove_role_success");
    } catch (error) {
      this.logger.error("Failed to remove user role", error as Error, {
        userId,
        role,
      });
      await this.metrics.recordCounter("auth_user_service_errors");
      throw error;
    }
  }

  /**
   * Delete user and all related data
   */
  async deleteUser(userId: string): Promise<void> {
    try {
      if (!userId) {
        throw new Error("User ID is required");
      }

      await this.metrics.recordCounter("auth_user_service_delete_requests");

      const db = PostgreSQLClient.getInstance();
      // Use transaction to ensure data consistency
      await db.$transaction(async (tx) => {
        // Delete user roles
        await tx.userRole.deleteMany({
          where: { userId },
        });

        // Delete user sessions
        await tx.userSession.deleteMany({
          where: { userId },
        });

        // Delete user events
        await tx.userEvent.deleteMany({
          where: { userId },
        });

        // Finally delete user
        await tx.user.delete({
          where: { id: userId },
        });
      });

      this.logger.info("User deleted successfully", { userId });
      await this.metrics.recordCounter("auth_user_service_delete_success");
    } catch (error) {
      this.logger.error("Failed to delete user", error as Error, { userId });
      await this.metrics.recordCounter("auth_user_service_errors");
      throw error;
    }
  }

  /**
   * Check if user exists
   */
  async userExists(userId: string): Promise<boolean> {
    try {
      const db = PostgreSQLClient.getInstance();
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });

      return !!user;
    } catch (error) {
      this.logger.error("Failed to check user existence", error as Error, {
        userId,
      });
      return false;
    }
  }

  /**
   * Get user count for metrics
   */
  async getUserCount(): Promise<number> {
    try {
      const db = PostgreSQLClient.getInstance();
      return await db.user.count();
    } catch (error) {
      this.logger.error("Failed to get user count", error as Error);
      return 0;
    }
  }

  // Private helper methods

  private mapToUserIdentity(user: any): UserIdentity {
    const roles = user.roles?.map((r: any) => r.role) || ["customer"];
    const primaryRole = this.mapToPrimaryRole(roles);
    const status = this.extractUserStatus(user.status);

    return {
      id: user.id,
      email: user.email,
      storeId: user.storeId || undefined,
      role: primaryRole,
      status: status,
      metadata: user.auditLog || {},
    };
  }

  private mapToPrimaryRole(roles: string[]): UserRole {
    // Priority order for roles
    const rolePriority: Record<string, number> = {
      admin: 4,
      store_owner: 3,
      api_user: 2,
      customer: 1,
    };

    let primaryRole: UserRole = "customer";
    let maxPriority = 0;

    for (const role of roles) {
      const priority = rolePriority[role] || 1;
      if (priority > maxPriority) {
        maxPriority = priority;
        primaryRole = role as UserRole;
      }
    }

    return primaryRole;
  }

  private extractUserStatus(status: string): UserStatus {
    // Map Prisma enum to our UserStatus
    const statusMap: Record<string, UserStatus> = {
      ACTIVE: "active",
      INACTIVE: "inactive",
      BANNED: "suspended",
      DELETED: "inactive",
    };

    return statusMap[status] || "active";
  }

  private mapUserStatus(status: UserStatus): string {
    // Map our UserStatus to Prisma enum
    const statusMap: Record<UserStatus, string> = {
      active: "ACTIVE",
      inactive: "INACTIVE",
      suspended: "BANNED",
      pending: "INACTIVE",
    };

    return statusMap[status] || "ACTIVE";
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}
