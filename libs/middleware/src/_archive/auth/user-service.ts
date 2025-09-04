/**
 * User Authentication Service Integration
 *
 * Provides integration with the database user service for
 * authentication operations.
 */

import { PostgreSQLClient, User, Role } from "@libs/database";
import { AuthService } from "./service";
import { PasswordUtils } from "./password-utils";
import { LoginCredentials } from "./types";

/**
 * User authentication integration service
 */
export class UserAuthService {
  private readonly prisma = PostgreSQLClient.getInstance();
  private readonly authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  /**
   * Authenticate user with email and password
   */
  public async authenticate(
    credentials: LoginCredentials
  ): Promise<(User & { role?: Role | null }) | null> {
    try {
      // Find user by email
      const user = await this.prisma.user.findUnique({
        where: {
          email: credentials.email.toLowerCase().trim(),
          isDeleted: false,
        },
        include: { role: true },
      });

      if (!user) {
        return null;
      }

      // Check if user is active
      if (user.status !== "ACTIVE") {
        return null;
      }

      // Verify password
      const isPasswordValid = await this.authService.verifyPassword(
        credentials.password,
        user.password
      );

      if (!isPasswordValid) {
        return null;
      }

      // Update last login
      await this.updateLastLogin(user.id);

      return user;
    } catch (error) {
      console.error("Authentication error:", error);
      return null;
    }
  }

  /**
   * Register a new user
   */
  public async register(userData: {
    email: string;
    password: string;
    username: string;
    firstName?: string;
    lastName?: string;
    storeId?: string;
  }): Promise<User | null> {
    try {
      // Validate password strength
      const passwordValidation = PasswordUtils.validatePassword(
        userData.password
      );
      if (!passwordValidation.isValid) {
        throw new Error(
          `Password validation failed: ${passwordValidation.errors.join(", ")}`
        );
      }

      // Check for existing user
      const existingUser = await this.prisma.user.findFirst({
        where: {
          OR: [
            { email: userData.email.toLowerCase().trim() },
            { username: userData.username.toLowerCase().trim() },
          ],
          isDeleted: false,
        },
      });

      if (existingUser) {
        throw new Error("User with this email or username already exists");
      }

      // Hash password
      const hashedPassword = await this.authService.hashPassword(
        userData.password
      );

      // Create user
      const user = await this.prisma.user.create({
        data: {
          email: userData.email.toLowerCase().trim(),
          username: userData.username.toLowerCase().trim(),
          password: hashedPassword,
          firstName: userData.firstName || null,
          lastName: userData.lastName || null,
          storeId: userData.storeId || null,
          status: "ACTIVE",
          emailVerified: false,
          phoneVerified: false,
          loginCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return user;
    } catch (error) {
      console.error("User registration error:", error);
      return null;
    }
  }

  /**
   * Change user password
   */
  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<boolean> {
    try {
      // Get user
      const user = await this.prisma.user.findUnique({
        where: { id: userId, isDeleted: false },
      });

      if (!user || user.status !== "ACTIVE") {
        return false;
      }

      // Verify current password
      const isCurrentPasswordValid = await this.authService.verifyPassword(
        currentPassword,
        user.password
      );

      if (!isCurrentPasswordValid) {
        return false;
      }

      // Validate new password
      const passwordValidation = PasswordUtils.validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        throw new Error(
          `New password validation failed: ${passwordValidation.errors.join(
            ", "
          )}`
        );
      }

      // Hash new password
      const hashedNewPassword = await this.authService.hashPassword(
        newPassword
      );

      // Update password
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedNewPassword,
          updatedAt: new Date(),
        },
      });

      // Invalidate all user sessions for security
      await this.authService.invalidateAllUserSessions(userId);

      return true;
    } catch (error) {
      console.error("Password change error:", error);
      return false;
    }
  }

  /**
   * Reset password with token
   */
  public async resetPassword(
    email: string,
    _resetToken: string,
    newPassword: string
  ): Promise<boolean> {
    try {
      // In a real implementation, you would:
      // 1. Verify the reset token from a secure store (Redis/DB)
      // 2. Check token expiration
      // 3. Validate the token against the user

      // This is a simplified implementation
      const user = await this.prisma.user.findUnique({
        where: {
          email: email.toLowerCase().trim(),
          isDeleted: false,
        },
      });

      if (!user || user.status !== "ACTIVE") {
        return false;
      }

      // Validate new password
      const passwordValidation = PasswordUtils.validatePassword(newPassword);
      if (!passwordValidation.isValid) {
        throw new Error(
          `Password validation failed: ${passwordValidation.errors.join(", ")}`
        );
      }

      // Hash new password
      const hashedPassword = await this.authService.hashPassword(newPassword);

      // Update password
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          updatedAt: new Date(),
        },
      });

      // Invalidate all user sessions
      await this.authService.invalidateAllUserSessions(user.id);

      return true;
    } catch (error) {
      console.error("Password reset error:", error);
      return false;
    }
  }

  /**
   * Update last login timestamp
   */
  private async updateLastLogin(userId: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          lastLoginAt: new Date(),
          loginCount: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Failed to update last login:", error);
    }
  }

  /**
   * Get user by ID with role
   */
  public async getUserById(
    userId: string
  ): Promise<(User & { role?: Role | null }) | null> {
    try {
      return await this.prisma.user.findUnique({
        where: {
          id: userId,
          isDeleted: false,
          status: "ACTIVE",
        },
        include: { role: true },
      });
    } catch (error) {
      console.error("Get user error:", error);
      return null;
    }
  }

  /**
   * Check if email is available
   */
  public async isEmailAvailable(email: string): Promise<boolean> {
    try {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          email: email.toLowerCase().trim(),
          isDeleted: false,
        },
      });

      return !existingUser;
    } catch (error) {
      console.error("Email availability check error:", error);
      return false;
    }
  }

  /**
   * Check if username is available
   */
  public async isUsernameAvailable(username: string): Promise<boolean> {
    try {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          username: username.toLowerCase().trim(),
          isDeleted: false,
        },
      });

      return !existingUser;
    } catch (error) {
      console.error("Username availability check error:", error);
      return false;
    }
  }
}
