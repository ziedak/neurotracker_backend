/**
 * Production-ready AuthenticationService for Authentication Library
 * Orchestrates complete authentication flows with proper integration
 */

import { PostgreSQLClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { UserService } from "./user-service";
import { SessionManager } from "./session.service";
// import { PermissionService } from "./permission-service.ts.old";
import { PasswordService } from "../password";
import {
  EnhancedJWTService,
  type TokenGenerationResult,
} from "./enhanced-jwt-service-v2";
import { type JWTPayload } from "../types/jwt-types";
import { UserIdentity, UserRole, UserStatus } from "../unified-context";
import { Role } from "../models";

export interface LoginCredentials {
  email: string;
  password: string;
  deviceInfo?: {
    ipAddress?: string;
    userAgent?: string;
    deviceName?: string;
  };
}

export interface LoginResult {
  success: boolean;
  user?: UserIdentity;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  sessionId?: string;
  error?: string;
}

export interface RegisterUserData {
  email: string;
  password: string;
  name?: string;
  storeId?: string;
  role?: UserRole;
  metadata?: Record<string, unknown>;
}

export interface RegisterResult {
  success: boolean;
  user?: UserIdentity;
  error?: string;
}

export interface RefreshTokenResult {
  success: boolean;
  accessToken?: string;
  expiresIn?: number;
  error?: string;
}

/**
 * Production AuthenticationService implementation
 */
export class AuthenticationService {
  private readonly userService: UserService;
  private readonly sessionManager: SessionManager;
  // private readonly permissionService: PermissionService;
  private readonly jwtService: EnhancedJWTService;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(
    userService: UserService,
    sessionManager: SessionManager,
    // permissionService: PermissionService,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.userService = userService;
    this.sessionManager = sessionManager;
    // this.permissionService = permissionService;
    this.jwtService = EnhancedJWTService.getInstance();
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Authenticate user with email and password
   */
  async login(credentials: LoginCredentials): Promise<LoginResult> {
    try {
      if (!this.validateLoginCredentials(credentials)) {
        await this.metrics.recordCounter("auth_login_invalid_credentials");
        return {
          success: false,
          error: "Invalid credentials format",
        };
      }

      await this.metrics.recordCounter("auth_login_requests");

      // Get user by email
      const user = await this.userService.getUserByEmail(credentials.email);
      if (!user) {
        await this.metrics.recordCounter("auth_login_user_not_found");
        return {
          success: false,
          error: "Invalid email or password",
        };
      }

      // Check user status
      if (user.status !== "active") {
        await this.metrics.recordCounter("auth_login_user_inactive");
        return {
          success: false,
          error: "Account is not active",
        };
      }

      // Check if user has active role (not revoked or expired)
      if (!this.hasActiveRole(user)) {
        await this.metrics.recordCounter("auth_login_role_inactive");
        await this.logAuthEvent(user.id, "login_failed", {
          reason: "role_revoked_or_expired",
          roleRevokedAt: user.roleRevokedAt?.toISOString(),
          roleExpiresAt: user.roleExpiresAt?.toISOString(),
        });
        return {
          success: false,
          error: "Access has been revoked or expired",
        };
      }

      // Get user's password from database
      const userWithPassword = await this.getUserWithPassword(user.id);
      if (!userWithPassword?.password) {
        await this.metrics.recordCounter("auth_login_no_password");
        return {
          success: false,
          error: "Invalid email or password",
        };
      }

      // Verify password
      const passwordValid = await PasswordService.verify(
        credentials.password,
        userWithPassword.password
      );

      if (!passwordValid) {
        await this.metrics.recordCounter("auth_login_invalid_password");
        await this.logAuthEvent(user.id, "login_failed", {
          reason: "invalid_password",
          ipAddress: credentials.deviceInfo?.ipAddress,
        });
        return {
          success: false,
          error: "Invalid email or password",
        };
      }

      // Get user permissions
      // const permissions = await this.permissionService.getUserPermissions(
      //   user.id
      // );
      // const permissionStrings = permissions.map(
      //   (p) => `${p.resource}:${p.action}`
      // );

      // Generate JWT tokens
      const tokens = await this.jwtService.generateTokens({
        sub: user.id,
        email: user.email,
        storeId: user.metadata?.["storeId"] as string, // Extract from metadata
        role: this.getPrimaryRoleId(user.role), // Use role ID from single Role object
        // permissions: permissionStrings,
      });

      // Create session
      const session = await this.sessionManager.createSession(
        user.id,
        credentials.deviceInfo,
        {
          loginTime: new Date().toISOString(),
          loginMethod: "password",
        }
      );

      // Log successful login
      await this.logAuthEvent(user.id, "login_success", {
        sessionId: session.sessionId,
        ipAddress: credentials.deviceInfo?.ipAddress,
        userAgent: credentials.deviceInfo?.userAgent,
      });

      this.logger.info("User logged in successfully", {
        userId: user.id,
        email: user.email,
        sessionId: session.sessionId,
      });

      await this.metrics.recordCounter("auth_login_success");

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          storeId: user.metadata?.["storeId"] as string, // Extract from metadata
          role: this.getPrimaryRoleId(user.role), // Use role ID from single Role object
          status: user.status as any, // Map status
          metadata: user.metadata,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        sessionId: session.sessionId,
      };
    } catch (error) {
      this.logger.error("Login failed", error as Error, {
        email: credentials.email,
      });
      await this.metrics.recordCounter("auth_login_errors");
      return {
        success: false,
        error: "Authentication failed",
      };
    }
  }

  /**
   * Register new user
   */
  async register(userData: RegisterUserData): Promise<RegisterResult> {
    try {
      if (!this.validateRegisterData(userData)) {
        await this.metrics.recordCounter("auth_register_invalid_data");
        return {
          success: false,
          error: "Invalid registration data",
        };
      }

      await this.metrics.recordCounter("auth_register_requests");

      // Validate password strength
      const passwordValidation = PasswordService.validatePassword(
        userData.password
      );
      if (!passwordValidation.valid) {
        await this.metrics.recordCounter("auth_register_weak_password");
        return {
          success: false,
          error: passwordValidation.errors.join(", "),
        };
      }

      // Hash password
      const hashedPassword = await PasswordService.hash(userData.password);

      // Create user - map RegisterUserData to CreateUserData format
      const user = await this.userService.createUser({
        email: userData.email,
        password: hashedPassword,
        username: userData.email, // Use email as username if not provided
        firstName: userData.name?.split(" ")[0] || "",
        lastName: userData.name?.split(" ").slice(1).join(" ") || "",
        role: userData.role || "customer", // Single role assignment
        metadata: {
          ...userData.metadata,
          storeId: userData.storeId,
        },
      });

      // Log registration
      await this.logAuthEvent(user.id, "user_registered", {
        email: user.email,
        role: this.getPrimaryRoleId(user.role), // Use role ID from single Role object
      });

      this.logger.info("User registered successfully", {
        userId: user.id,
        email: user.email,
        role: this.getPrimaryRoleId(user.role), // Use role ID from single Role object
      });

      await this.metrics.recordCounter("auth_register_success");

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          storeId: user.metadata?.["storeId"] as string, // Extract from metadata
          role: this.getPrimaryRoleId(user.role), // Use role ID from single Role object
          status: user.status as any, // Map status
          metadata: user.metadata,
        },
      };
    } catch (error) {
      this.logger.error("Registration failed", error as Error, {
        email: userData.email,
      });
      await this.metrics.recordCounter("auth_register_errors");

      // Check for duplicate user error
      if ((error as Error).message.includes("already exists")) {
        return {
          success: false,
          error: "User with this email already exists",
        };
      }

      return {
        success: false,
        error: "Registration failed",
      };
    }
  }

  /**
   * Logout user and cleanup session
   */
  async logout(sessionId: string, userId?: string): Promise<void> {
    try {
      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      await this.metrics.recordCounter("auth_logout_requests");

      // Validate session exists
      const sessionValidation = await this.sessionManager.validateSession(
        sessionId
      );
      const actualUserId = userId || sessionValidation.session?.userId;

      // Destroy session
      await this.sessionManager.destroySession(sessionId);

      // Log logout
      if (actualUserId) {
        await this.logAuthEvent(actualUserId, "logout", {
          sessionId,
        });

        this.logger.info("User logged out successfully", {
          userId: actualUserId,
          sessionId,
        });
      }

      await this.metrics.recordCounter("auth_logout_success");
    } catch (error) {
      this.logger.error("Logout failed", error as Error, {
        sessionId,
        userId,
      });
      await this.metrics.recordCounter("auth_logout_errors");
      throw error;
    }
  }

  /**
   * Logout user from all sessions
   */
  async logoutFromAllSessions(userId: string): Promise<void> {
    try {
      if (!userId) {
        throw new Error("User ID is required");
      }

      await this.metrics.recordCounter("auth_logout_all_requests");

      // Destroy all user sessions
      await this.sessionManager.destroyUserSessions(userId);

      // Log logout from all sessions
      await this.logAuthEvent(userId, "logout_all_sessions", {});

      this.logger.info("User logged out from all sessions", { userId });

      await this.metrics.recordCounter("auth_logout_all_success");
    } catch (error) {
      this.logger.error("Logout from all sessions failed", error as Error, {
        userId,
      });
      await this.metrics.recordCounter("auth_logout_errors");
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResult> {
    try {
      if (!refreshToken || typeof refreshToken !== "string") {
        await this.metrics.recordCounter("auth_refresh_invalid_token");
        return {
          success: false,
          error: "Invalid refresh token",
        };
      }

      await this.metrics.recordCounter("auth_refresh_requests");

      // Refresh the access token
      const result = await this.jwtService.refreshAccessToken(
        refreshToken,
        this.userService
      );

      if (!result) {
        await this.metrics.recordCounter("auth_refresh_failed");
        return {
          success: false,
          error: "Invalid or expired refresh token",
        };
      }

      await this.metrics.recordCounter("auth_refresh_success");

      return {
        success: true,
        accessToken: result.newAccessToken,
        expiresIn: result.expiresIn,
      };
    } catch (error) {
      this.logger.error("Token refresh failed", error as Error);
      await this.metrics.recordCounter("auth_refresh_errors");
      return {
        success: false,
        error: "Token refresh failed",
      };
    }
  }

  /**
   * Validate user session
   */
  async validateSession(sessionId: string): Promise<{
    valid: boolean;
    user?: UserIdentity;
    session?: any;
  }> {
    try {
      if (!sessionId) {
        return { valid: false };
      }

      await this.metrics.recordCounter("auth_validate_session_requests");

      const validation = await this.sessionManager.validateSession(sessionId);

      if (!validation.valid || !validation.session) {
        await this.metrics.recordCounter("auth_validate_session_invalid");
        return { valid: false };
      }

      // Get user details
      const user = await this.userService.getUserById(
        validation.session.userId
      );

      if (!user) {
        await this.metrics.recordCounter(
          "auth_validate_session_user_not_found"
        );
        return { valid: false };
      }

      await this.metrics.recordCounter("auth_validate_session_success");

      return {
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          storeId: user.metadata?.["storeId"] as string, // Extract from metadata
          role: this.getPrimaryRoleId(user.role), // Use role ID from single Role object
          status: user.status as any, // Map status
          metadata: user.metadata,
        },
        session: validation.session,
      };
    } catch (error) {
      this.logger.error("Session validation failed", error as Error, {
        sessionId,
      });
      await this.metrics.recordCounter("auth_validate_session_errors");
      return { valid: false };
    }
  }

  /**
   * Change user password
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!userId || !currentPassword || !newPassword) {
        return {
          success: false,
          error: "All password fields are required",
        };
      }

      await this.metrics.recordCounter("auth_change_password_requests");

      // Get user with current password
      const userWithPassword = await this.getUserWithPassword(userId);
      if (!userWithPassword?.password) {
        await this.metrics.recordCounter("auth_change_password_user_not_found");
        return {
          success: false,
          error: "User not found",
        };
      }

      // Verify current password
      const currentPasswordValid = await PasswordService.verify(
        currentPassword,
        userWithPassword.password
      );

      if (!currentPasswordValid) {
        await this.metrics.recordCounter(
          "auth_change_password_invalid_current"
        );
        return {
          success: false,
          error: "Current password is incorrect",
        };
      }

      // Validate new password
      const passwordValidation = PasswordService.validatePassword(newPassword);
      if (!passwordValidation.valid) {
        await this.metrics.recordCounter("auth_change_password_weak_password");
        return {
          success: false,
          error: passwordValidation.errors.join(", "),
        };
      }

      // Hash new password
      const hashedNewPassword = await PasswordService.hash(newPassword);

      // Update password in database
      await this.updateUserPassword(userId, hashedNewPassword);

      // Log password change
      await this.logAuthEvent(userId, "password_changed", {});

      this.logger.info("Password changed successfully", { userId });

      await this.metrics.recordCounter("auth_change_password_success");

      return { success: true };
    } catch (error) {
      this.logger.error("Password change failed", error as Error, { userId });
      await this.metrics.recordCounter("auth_change_password_errors");
      return {
        success: false,
        error: "Password change failed",
      };
    }
  }

  // Private helper methods

  /**
   * Check if user has active (non-revoked, non-expired) role
   */
  private hasActiveRole(user: any): boolean {
    return !!(
      user.role &&
      !user.roleRevokedAt &&
      (!user.roleExpiresAt || new Date(user.roleExpiresAt) > new Date())
    );
  }

  /**
   * Get primary role from user role according to Phase 3A architecture
   * Now that users have a single Role object, just extract the role ID
   */
  private getPrimaryRoleId(role: Role): string {
    return role.id;
  }

  /**
   * Legacy support for role extraction from role arrays (for transition period)
   * TODO: Remove this method once database migration to single role is complete
   */
  // private getPrimaryRole(roles: string[]): string {
  //   if (!roles || roles.length === 0) {
  //     return "customer"; // Default role
  //   }

  //   // Phase 3A business logic: Priority order for role selection
  //   const rolePriority = ["admin", "store_owner", "api_user", "customer"];

  //   for (const priority of rolePriority) {
  //     if (roles.includes(priority)) {
  //       return priority;
  //     }
  //   }

  //   // Fallback: return first role if none match priority
  //   return roles[0];
  // }
  private validateLoginCredentials(credentials: LoginCredentials): boolean {
    if (!credentials || typeof credentials !== "object") {
      return false;
    }

    if (!credentials.email || typeof credentials.email !== "string") {
      return false;
    }

    if (!credentials.password || typeof credentials.password !== "string") {
      return false;
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(credentials.email)) {
      return false;
    }

    return true;
  }

  private validateRegisterData(userData: RegisterUserData): boolean {
    if (!userData || typeof userData !== "object") {
      return false;
    }

    if (!userData.email || typeof userData.email !== "string") {
      return false;
    }

    if (!userData.password || typeof userData.password !== "string") {
      return false;
    }

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userData.email)) {
      return false;
    }

    return true;
  }

  private async getUserWithPassword(
    userId: string
  ): Promise<{ password: string } | null> {
    try {
      const db = PostgreSQLClient.getInstance();
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { password: true },
      });

      return user;
    } catch (error) {
      this.logger.error("Failed to get user with password", error as Error, {
        userId,
      });
      return null;
    }
  }

  private async updateUserPassword(
    userId: string,
    hashedPassword: string
  ): Promise<void> {
    const db = PostgreSQLClient.getInstance();
    await db.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
  }

  private async logAuthEvent(
    userId: string,
    eventType: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      const db = PostgreSQLClient.getInstance();
      await db.userEvent.create({
        data: {
          userId,
          eventType,
          metadata: metadata as any, // Cast to any for JSON compatibility
        },
      });
    } catch (error) {
      // Log but don't throw - this is not critical for auth operation
      this.logger.debug("Failed to log auth event", { userId, eventType });
    }
  }
}
