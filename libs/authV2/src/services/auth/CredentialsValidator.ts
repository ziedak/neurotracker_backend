/**
 * @fileoverview CredentialsValidator - Enterprise credentials validation service
 * @module services/auth/CredentialsValidator
 * @version 1.0.0
 * @author Enterprise Development Team
 * @description Specialized service for validating authentication credentials and registration data
 */

import type {
  IAuthenticationCredentials,
  IRegistrationData,
  IPasswordChangeData,
} from "../../contracts/services";
import { ValidationError } from "../../errors/core";

/**
 * Password strength requirements
 */
interface IPasswordRequirements {
  readonly minLength: number;
  readonly requireUppercase: boolean;
  readonly requireLowercase: boolean;
  readonly requireNumbers: boolean;
  readonly requireSpecialChars: boolean;
  readonly specialChars: string;
}

/**
 * Default password requirements for enterprise security
 */
const DEFAULT_PASSWORD_REQUIREMENTS: IPasswordRequirements = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  specialChars: "!@#$%^&*()_+-=[]{}|;:,.<>?",
};

/**
 * Enterprise credentials validation service
 *
 * Provides comprehensive validation for:
 * - Authentication credentials (email, username, API key)
 * - Registration data with security requirements
 * - Password strength and complexity
 * - Input sanitization and security checks
 */
export class CredentialsValidator {
  private readonly passwordRequirements: IPasswordRequirements;

  constructor(
    passwordRequirements: IPasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS
  ) {
    this.passwordRequirements = passwordRequirements;
  }

  /**
   * Validate authentication credentials structure and content
   */
  validateAuthenticationCredentials(
    credentials: IAuthenticationCredentials
  ): void {
    if (!credentials.type || !credentials.identifier) {
      throw new ValidationError("Missing authentication type or identifier", [
        { field: "type", message: "Authentication type is required" },
        {
          field: "identifier",
          message: "Authentication identifier is required",
        },
      ]);
    }

    // Validate based on authentication type
    switch (credentials.type) {
      case "email":
        this.validateEmail(credentials.identifier);
        if (!credentials.password) {
          throw new ValidationError(
            "Password required for email authentication",
            [
              {
                field: "password",
                message: "Password is required for email authentication",
              },
            ]
          );
        }
        break;

      case "username":
        this.validateUsername(credentials.identifier);
        if (!credentials.password) {
          throw new ValidationError(
            "Password required for username authentication",
            [
              {
                field: "password",
                message: "Password is required for username authentication",
              },
            ]
          );
        }
        break;

      case "api_key":
        if (!credentials.apiKey) {
          throw new ValidationError(
            "API key required for API key authentication",
            [
              {
                field: "apiKey",
                message: "API key is required for API key authentication",
              },
            ]
          );
        }
        this.validateAPIKeyFormat(credentials.apiKey);
        break;

      default:
        throw new ValidationError("Unsupported authentication type", [
          {
            field: "type",
            message: `Authentication type '${credentials.type}' is not supported`,
          },
        ]);
    }

    // Validate device info if provided
    if (credentials.deviceInfo) {
      this.validateDeviceInfo(credentials.deviceInfo);
    }
  }

  /**
   * Validate user registration data with comprehensive checks
   */
  validateRegistrationData(data: IRegistrationData): void {
    const errors: Array<{ field: string; message: string }> = [];

    // Validate required fields
    if (!data.email) {
      errors.push({ field: "email", message: "Email is required" });
    } else {
      try {
        this.validateEmail(data.email);
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.push({ field: "email", message: error.message });
        }
      }
    }

    if (!data.username) {
      errors.push({ field: "username", message: "Username is required" });
    } else {
      try {
        this.validateUsername(data.username);
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.push({ field: "username", message: error.message });
        }
      }
    }

    if (!data.password) {
      errors.push({ field: "password", message: "Password is required" });
    } else {
      try {
        this.validatePasswordStrength(data.password);
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.push({ field: "password", message: error.message });
        }
      }
    }

    if (!data.acceptedTerms) {
      errors.push({
        field: "acceptedTerms",
        message: "Terms and conditions must be accepted",
      });
    }

    // Validate optional fields if provided
    if (data.firstName && data.firstName.length < 2) {
      errors.push({
        field: "firstName",
        message: "First name must be at least 2 characters",
      });
    }

    if (data.lastName && data.lastName.length < 2) {
      errors.push({
        field: "lastName",
        message: "Last name must be at least 2 characters",
      });
    }

    if (data.deviceInfo) {
      try {
        this.validateDeviceInfo(data.deviceInfo);
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.push({ field: "deviceInfo", message: error.message });
        }
      }
    }

    if (errors.length > 0) {
      throw new ValidationError("Registration data validation failed", errors);
    }
  }

  /**
   * Validate password change data
   */
  validatePasswordChangeData(data: IPasswordChangeData): void {
    const errors: Array<{ field: string; message: string }> = [];

    if (!data.currentPassword) {
      errors.push({
        field: "currentPassword",
        message: "Current password is required",
      });
    }

    if (!data.newPassword) {
      errors.push({
        field: "newPassword",
        message: "New password is required",
      });
    } else {
      try {
        this.validatePasswordStrength(data.newPassword);
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.push({ field: "newPassword", message: error.message });
        }
      }
    }

    if (!data.confirmNewPassword) {
      errors.push({
        field: "confirmNewPassword",
        message: "Password confirmation is required",
      });
    } else if (data.newPassword !== data.confirmNewPassword) {
      errors.push({
        field: "confirmNewPassword",
        message: "Password confirmation does not match new password",
      });
    }

    if (data.currentPassword === data.newPassword) {
      errors.push({
        field: "newPassword",
        message: "New password must be different from current password",
      });
    }

    if (errors.length > 0) {
      throw new ValidationError(
        "Password change data validation failed",
        errors
      );
    }
  }

  /**
   * Validate email format and security requirements
   */
  validateEmail(email: string): void {
    if (!email || typeof email !== "string") {
      throw new ValidationError("Invalid email format");
    }

    // Basic format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError("Invalid email format");
    }

    // Length validation
    if (email.length > 254) {
      throw new ValidationError("Email address too long");
    }

    // Domain validation
    const domain = email.split("@")[1];
    if (domain.length > 253) {
      throw new ValidationError("Email domain too long");
    }

    // Check for dangerous patterns
    if (this.containsDangerousPatterns(email)) {
      throw new ValidationError("Email contains invalid characters");
    }
  }

  /**
   * Validate username format and security requirements
   */
  validateUsername(username: string): void {
    if (!username || typeof username !== "string") {
      throw new ValidationError("Username is required");
    }

    // Length validation
    if (username.length < 3) {
      throw new ValidationError("Username must be at least 3 characters");
    }

    if (username.length > 50) {
      throw new ValidationError("Username must be less than 50 characters");
    }

    // Character validation
    const usernameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!usernameRegex.test(username)) {
      throw new ValidationError(
        "Username can only contain letters, numbers, underscores, and hyphens"
      );
    }

    // Reserved username validation
    if (this.isReservedUsername(username)) {
      throw new ValidationError("Username is reserved and cannot be used");
    }

    // Security pattern validation
    if (this.containsDangerousPatterns(username)) {
      throw new ValidationError("Username contains invalid patterns");
    }
  }

  /**
   * Validate password strength according to enterprise requirements
   */
  validatePasswordStrength(password: string): void {
    if (!password || typeof password !== "string") {
      throw new ValidationError("Password is required");
    }

    const errors: string[] = [];

    // Length requirement
    if (password.length < this.passwordRequirements.minLength) {
      errors.push(
        `Password must be at least ${this.passwordRequirements.minLength} characters`
      );
    }

    // Uppercase requirement
    if (this.passwordRequirements.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }

    // Lowercase requirement
    if (this.passwordRequirements.requireLowercase && !/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }

    // Number requirement
    if (this.passwordRequirements.requireNumbers && !/\d/.test(password)) {
      errors.push("Password must contain at least one number");
    }

    // Special character requirement
    if (this.passwordRequirements.requireSpecialChars) {
      const specialCharRegex = new RegExp(
        `[${this.escapeRegexChars(this.passwordRequirements.specialChars)}]`
      );
      if (!specialCharRegex.test(password)) {
        errors.push(
          `Password must contain at least one special character (${this.passwordRequirements.specialChars})`
        );
      }
    }

    // Common password validation
    if (this.isCommonPassword(password)) {
      errors.push("Password is too common and easily guessable");
    }

    // Sequential character validation
    if (this.hasSequentialCharacters(password)) {
      errors.push(
        "Password cannot contain sequential characters (abc, 123, etc.)"
      );
    }

    if (errors.length > 0) {
      throw new ValidationError(
        "Password does not meet security requirements",
        errors.map((message) => ({ field: "password", message }))
      );
    }
  }

  /**
   * Validate API key format
   */
  private validateAPIKeyFormat(apiKey: string): void {
    if (!apiKey || typeof apiKey !== "string") {
      throw new ValidationError("Invalid API key format");
    }

    // Basic format validation - expecting base64 or hex format
    if (apiKey.length < 32) {
      throw new ValidationError("API key too short");
    }

    if (apiKey.length > 512) {
      throw new ValidationError("API key too long");
    }

    // Check for valid characters
    const apiKeyRegex = /^[A-Za-z0-9+/=_-]+$/;
    if (!apiKeyRegex.test(apiKey)) {
      throw new ValidationError("API key contains invalid characters");
    }
  }

  /**
   * Validate device information
   */
  private validateDeviceInfo(deviceInfo: any): void {
    if (!deviceInfo || typeof deviceInfo !== "object") {
      throw new ValidationError("Invalid device information");
    }

    // Validate required device info fields
    const requiredFields = ["deviceId", "platform", "browser"];
    for (const field of requiredFields) {
      if (!deviceInfo[field] || typeof deviceInfo[field] !== "string") {
        throw new ValidationError(`Device ${field} is required`);
      }
    }

    // Validate device ID format
    if (deviceInfo.deviceId.length < 10 || deviceInfo.deviceId.length > 100) {
      throw new ValidationError("Invalid device ID format");
    }

    // Validate platform
    const validPlatforms = ["web", "ios", "android", "desktop", "mobile"];
    if (!validPlatforms.includes(deviceInfo.platform.toLowerCase())) {
      throw new ValidationError("Invalid platform specified");
    }
  }

  /**
   * Check if username is reserved
   */
  private isReservedUsername(username: string): boolean {
    const reservedUsernames = [
      "admin",
      "administrator",
      "root",
      "system",
      "user",
      "guest",
      "test",
      "api",
      "service",
      "support",
      "help",
      "info",
      "contact",
      "sales",
      "marketing",
      "security",
      "auth",
      "login",
      "register",
      "signup",
      "null",
      "undefined",
      "void",
      "delete",
      "remove",
      "banned",
    ];

    return reservedUsernames.includes(username.toLowerCase());
  }

  /**
   * Check for common/weak passwords
   */
  private isCommonPassword(password: string): boolean {
    const commonPasswords = [
      "password",
      "123456",
      "password123",
      "admin",
      "qwerty",
      "letmein",
      "welcome",
      "monkey",
      "1234567890",
      "password1",
      "abc123",
      "Password123",
    ];

    return commonPasswords.some((common) =>
      password.toLowerCase().includes(common.toLowerCase())
    );
  }

  /**
   * Check for sequential characters in password
   */
  private hasSequentialCharacters(password: string): boolean {
    const sequences = [
      "abcdefghijklmnopqrstuvwxyz",
      "0123456789",
      "qwertyuiopasdfghjklzxcvbnm",
    ];

    for (const sequence of sequences) {
      for (let i = 0; i <= sequence.length - 3; i++) {
        const subseq = sequence.substring(i, i + 3);
        if (password.toLowerCase().includes(subseq)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check for dangerous patterns that could indicate injection attempts
   */
  private containsDangerousPatterns(input: string): boolean {
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+=/i,
      /'.*union.*select/i,
      /drop\s+table/i,
      /delete\s+from/i,
      /insert\s+into/i,
      /update\s+.*set/i,
      /../, // Directory traversal
      /\0/, // Null bytes
      /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/, // Control characters
    ];

    return dangerousPatterns.some((pattern) => pattern.test(input));
  }

  /**
   * Escape regex special characters
   */
  private escapeRegexChars(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Get password requirements for client-side validation
   */
  getPasswordRequirements(): IPasswordRequirements {
    return { ...this.passwordRequirements };
  }

  /**
   * Test password strength and return score (0-100)
   */
  testPasswordStrength(password: string): {
    score: number;
    feedback: string[];
    requirements: { [key: string]: boolean };
  } {
    const requirements = {
      length: password.length >= this.passwordRequirements.minLength,
      uppercase:
        !this.passwordRequirements.requireUppercase || /[A-Z]/.test(password),
      lowercase:
        !this.passwordRequirements.requireLowercase || /[a-z]/.test(password),
      numbers: !this.passwordRequirements.requireNumbers || /\d/.test(password),
      specialChars:
        !this.passwordRequirements.requireSpecialChars ||
        new RegExp(
          `[${this.escapeRegexChars(this.passwordRequirements.specialChars)}]`
        ).test(password),
      notCommon: !this.isCommonPassword(password),
      noSequential: !this.hasSequentialCharacters(password),
    };

    const metRequirements = Object.values(requirements).filter(Boolean).length;
    const totalRequirements = Object.keys(requirements).length;
    const score = Math.round((metRequirements / totalRequirements) * 100);

    const feedback = [];
    if (!requirements.length)
      feedback.push(
        `Password must be at least ${this.passwordRequirements.minLength} characters`
      );
    if (!requirements.uppercase) feedback.push("Add uppercase letters");
    if (!requirements.lowercase) feedback.push("Add lowercase letters");
    if (!requirements.numbers) feedback.push("Add numbers");
    if (!requirements.specialChars) feedback.push("Add special characters");
    if (!requirements.notCommon) feedback.push("Avoid common passwords");
    if (!requirements.noSequential)
      feedback.push("Avoid sequential characters");

    return { score, feedback, requirements };
  }
}
