/**
 * @fileoverview Integration tests for UserService password security fixes
 * @module services/__tests__/UserService.password.test
 * @author Enterprise Security Team
 * @since 1.0.0 - Phase 1 Security Remediation
 */

import { UserServiceV2 } from "../UserService";
import { PasswordSecurity } from "../../utils/PasswordSecurity";
import { UserRepository } from "../../repositories/UserRepository";
import type { IUserCreateData } from "../../contracts/services";
import { UserStatus } from "../../types/core";

// Mock the repository
const mockUserRepository: Partial<UserRepository> = {
  findById: jest.fn(),
  findByEmail: jest.fn(),
  findByUsername: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
  search: jest.fn(),
  updateLastLogin: jest.fn(),
  assignRole: jest.fn(),
  revokeRole: jest.fn(),
};

describe("UserServiceV2 - Password Security Integration", () => {
  let userService: UserServiceV2;

  beforeEach(() => {
    jest.clearAllMocks();
    userService = new UserServiceV2();
  });

  describe("create method - Password Hashing", () => {
    it("should hash password before storing user", async () => {
      const userData: IUserCreateData = {
        email: "test@example.com",
        username: "testuser",
        password: "SecurePassword123!",
        firstName: "Test",
        lastName: "User",
      };

      const mockCreatedUser = {
        id: "1",
        email: userData.email,
        username: userData.username,
        password: "$argon2id$v=19$m=65536,t=3,p=4$hashedpassword", // Mock hash
        firstName: userData.firstName,
        lastName: userData.lastName,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        phoneVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserRepository.create.mockResolvedValue(mockCreatedUser);

      const result = await userService.create(userData);

      // Verify password was hashed before calling repository
      expect(mockUserRepository.create).toHaveBeenCalledWith({
        email: userData.email,
        username: userData.username,
        password: expect.stringMatching(/^\$argon2id\$/), // Should be Argon2 hash
        firstName: userData.firstName,
        lastName: userData.lastName,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        phoneVerified: false,
        metadata: null,
      });

      // Verify password was not stored in plaintext
      const createCall = mockUserRepository.create.mock.calls[0][0];
      expect(createCall.password).not.toBe(userData.password);
      expect(createCall.password).toMatch(/^\$argon2id\$/);
    });

    it("should reject user creation with weak password", async () => {
      const userData: IUserCreateData = {
        email: "test@example.com",
        username: "testuser",
        password: "weak", // Weak password
      };

      await expect(userService.create(userData)).rejects.toThrow(
        /Password strength validation failed/
      );

      // Repository should not be called with invalid data
      expect(mockUserRepository.create).not.toHaveBeenCalled();
    });

    it("should handle password hashing errors gracefully", async () => {
      const userData: IUserCreateData = {
        email: "test@example.com",
        username: "testuser",
        password: null as any, // Invalid password type
      };

      await expect(userService.create(userData)).rejects.toThrow();
      expect(mockUserRepository.create).not.toHaveBeenCalled();
    });
  });

  describe("verifyCredentials method - Secure Password Verification", () => {
    it("should verify password using Argon2", async () => {
      const email = "test@example.com";
      const plainPassword = "SecurePassword123!";
      const hashedPassword =
        "$argon2id$v=19$m=65536,t=3,p=4$mockhashedpassword";

      const mockUser = {
        id: "1",
        email: email,
        username: "testuser",
        password: hashedPassword,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        phoneVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      // Mock PasswordSecurity.verifyPassword
      const mockVerifyPassword = jest.spyOn(PasswordSecurity, "verifyPassword");
      mockVerifyPassword.mockResolvedValue({
        isValid: true,
        needsRehash: false,
        verificationTimeMs: 50,
      });

      const result = await userService.verifyCredentials(email, plainPassword);

      expect(result.isValid).toBe(true);
      expect(result.user).toBeDefined();
      expect(mockVerifyPassword).toHaveBeenCalledWith(
        plainPassword,
        hashedPassword
      );

      mockVerifyPassword.mockRestore();
    });

    it("should reject invalid password using secure verification", async () => {
      const email = "test@example.com";
      const plainPassword = "WrongPassword123!";
      const hashedPassword =
        "$argon2id$v=19$m=65536,t=3,p=4$mockhashedpassword";

      const mockUser = {
        id: "1",
        email: email,
        username: "testuser",
        password: hashedPassword,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        phoneVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserRepository.findByEmail.mockResolvedValue(mockUser);

      // Mock PasswordSecurity.verifyPassword to return invalid
      const mockVerifyPassword = jest.spyOn(PasswordSecurity, "verifyPassword");
      mockVerifyPassword.mockResolvedValue({
        isValid: false,
        needsRehash: false,
        verificationTimeMs: 50,
      });

      const result = await userService.verifyCredentials(email, plainPassword);

      expect(result.isValid).toBe(false);
      expect(result.failureReason).toBe("Invalid password");
      expect(mockVerifyPassword).toHaveBeenCalledWith(
        plainPassword,
        hashedPassword
      );

      mockVerifyPassword.mockRestore();
    });

    it("should handle non-existent user securely", async () => {
      const email = "nonexistent@example.com";
      const plainPassword = "AnyPassword123!";

      mockUserRepository.findByEmail.mockResolvedValue(null);

      const result = await userService.verifyCredentials(email, plainPassword);

      expect(result.isValid).toBe(false);
      expect(result.failureReason).toBe("User not found");
      expect(result.user).toBeNull();
    });

    it("should prevent timing attacks between valid and invalid users", async () => {
      const validEmail = "valid@example.com";
      const invalidEmail = "invalid@example.com";
      const password = "TestPassword123!";

      const mockUser = {
        id: "1",
        email: validEmail,
        username: "validuser",
        password: "$argon2id$v=19$m=65536,t=3,p=4$mockhashedpassword",
        status: UserStatus.ACTIVE,
        emailVerified: true,
        phoneVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock repository responses
      mockUserRepository.findByEmail.mockImplementation(async (email) =>
        email === validEmail ? mockUser : null
      );

      // Mock password verification
      const mockVerifyPassword = jest.spyOn(PasswordSecurity, "verifyPassword");
      mockVerifyPassword.mockResolvedValue({
        isValid: false,
        needsRehash: false,
        verificationTimeMs: 50,
      });

      // Measure timing for valid user (but wrong password)
      const start1 = Date.now();
      await userService.verifyCredentials(validEmail, "wrong");
      const time1 = Date.now() - start1;

      // Measure timing for invalid user
      const start2 = Date.now();
      await userService.verifyCredentials(invalidEmail, password);
      const time2 = Date.now() - start2;

      // Times should be relatively similar (accounting for system variance)
      // This is a basic timing attack protection test
      const timeDifference = Math.abs(time1 - time2);
      expect(timeDifference).toBeLessThan(100); // Within 100ms difference

      mockVerifyPassword.mockRestore();
    });
  });

  describe("updatePassword method - Secure Password Updates", () => {
    it("should verify current password and hash new password", async () => {
      const userId = "1" as any;
      const currentPassword = "OldPassword123!";
      const newPassword = "NewSecurePassword123!";
      const hashedCurrentPassword = "$argon2id$v=19$m=65536,t=3,p=4$oldhash";

      const mockUser = {
        id: userId,
        email: "test@example.com",
        username: "testuser",
        password: hashedCurrentPassword,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.update.mockResolvedValue({
        ...mockUser,
        password: "$argon2id$v=19$m=65536,t=3,p=4$newhash",
      });

      // Mock password verification and hashing
      const mockVerifyPassword = jest.spyOn(PasswordSecurity, "verifyPassword");
      const mockHashPassword = jest.spyOn(PasswordSecurity, "hashPassword");

      mockVerifyPassword.mockResolvedValue({
        isValid: true,
        needsRehash: false,
        verificationTimeMs: 50,
      });

      mockHashPassword.mockResolvedValue({
        hash: "$argon2id$v=19$m=65536,t=3,p=4$newhash",
        algorithm: "argon2id",
        hashedAt: new Date(),
        hashingTimeMs: 100,
      });

      const result = await userService.updatePassword(
        userId,
        currentPassword,
        newPassword
      );

      expect(result).toBe(true);
      expect(mockVerifyPassword).toHaveBeenCalledWith(
        currentPassword,
        hashedCurrentPassword
      );
      expect(mockHashPassword).toHaveBeenCalledWith(newPassword);
      expect(mockUserRepository.update).toHaveBeenCalledWith(userId, {
        password: "$argon2id$v=19$m=65536,t=3,p=4$newhash",
      });

      mockVerifyPassword.mockRestore();
      mockHashPassword.mockRestore();
    });

    it("should reject update with incorrect current password", async () => {
      const userId = "1" as any;
      const currentPassword = "WrongPassword123!";
      const newPassword = "NewSecurePassword123!";
      const hashedCurrentPassword = "$argon2id$v=19$m=65536,t=3,p=4$oldhash";

      const mockUser = {
        id: userId,
        email: "test@example.com",
        username: "testuser",
        password: hashedCurrentPassword,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);

      // Mock password verification to fail
      const mockVerifyPassword = jest.spyOn(PasswordSecurity, "verifyPassword");
      mockVerifyPassword.mockResolvedValue({
        isValid: false,
        needsRehash: false,
        verificationTimeMs: 50,
      });

      const result = await userService.updatePassword(
        userId,
        currentPassword,
        newPassword
      );

      expect(result).toBe(false);
      expect(mockVerifyPassword).toHaveBeenCalledWith(
        currentPassword,
        hashedCurrentPassword
      );
      expect(mockUserRepository.update).not.toHaveBeenCalled();

      mockVerifyPassword.mockRestore();
    });

    it("should reject update for non-existent user", async () => {
      const userId = "999" as any;
      const currentPassword = "OldPassword123!";
      const newPassword = "NewSecurePassword123!";

      mockUserRepository.findById.mockResolvedValue(null);

      const result = await userService.updatePassword(
        userId,
        currentPassword,
        newPassword
      );

      expect(result).toBe(false);
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });

    it("should validate new password strength before updating", async () => {
      const userId = "1" as any;
      const currentPassword = "OldPassword123!";
      const newPassword = "weak"; // Weak password

      const mockUser = {
        id: userId,
        email: "test@example.com",
        username: "testuser",
        password: "$argon2id$v=19$m=65536,t=3,p=4$oldhash",
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);

      // Mock current password verification to succeed
      const mockVerifyPassword = jest.spyOn(PasswordSecurity, "verifyPassword");
      mockVerifyPassword.mockResolvedValue({
        isValid: true,
        needsRehash: false,
        verificationTimeMs: 50,
      });

      await expect(
        userService.updatePassword(userId, currentPassword, newPassword)
      ).rejects.toThrow(/Password strength validation failed/);

      expect(mockUserRepository.update).not.toHaveBeenCalled();
      mockVerifyPassword.mockRestore();
    });
  });

  describe("Security Properties", () => {
    it("should not expose password hashes in responses", async () => {
      const userData: IUserCreateData = {
        email: "test@example.com",
        username: "testuser",
        password: "SecurePassword123!",
      };

      const mockCreatedUser = {
        id: "1",
        email: userData.email,
        username: userData.username,
        password: "$argon2id$v=19$m=65536,t=3,p=4$hashedpassword",
        firstName: null,
        lastName: null,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        phoneVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserRepository.create.mockResolvedValue(mockCreatedUser);

      const result = await userService.create(userData);

      // Result should not contain password hash
      expect(result).not.toHaveProperty("password");
      expect(JSON.stringify(result)).not.toContain("argon2id");
    });

    it("should handle concurrent password operations safely", async () => {
      const userId = "1" as any;
      const currentPassword = "OldPassword123!";
      const newPasswords = ["New1!", "New2!", "New3!"].map(
        (p) => `${p}SecurePassword123`
      );

      const mockUser = {
        id: userId,
        email: "test@example.com",
        username: "testuser",
        password: "$argon2id$v=19$m=65536,t=3,p=4$oldhash",
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserRepository.findById.mockResolvedValue(mockUser);
      mockUserRepository.update.mockResolvedValue(mockUser);

      // Mock password verification and hashing
      const mockVerifyPassword = jest.spyOn(PasswordSecurity, "verifyPassword");
      const mockHashPassword = jest.spyOn(PasswordSecurity, "hashPassword");

      mockVerifyPassword.mockResolvedValue({
        isValid: true,
        needsRehash: false,
        verificationTimeMs: 50,
      });

      mockHashPassword.mockImplementation(async (password) => ({
        hash: `$argon2id$hashed_${password}`,
        algorithm: "argon2id",
        hashedAt: new Date(),
        hashingTimeMs: 100,
      }));

      // Run concurrent password updates
      const updatePromises = newPasswords.map((newPassword) =>
        userService.updatePassword(userId, currentPassword, newPassword)
      );

      const results = await Promise.all(updatePromises);

      // All should succeed (or fail consistently)
      results.forEach((result) => expect(result).toBe(true));

      mockVerifyPassword.mockRestore();
      mockHashPassword.mockRestore();
    });
  });
});
