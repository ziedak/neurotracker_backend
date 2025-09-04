/**
 * Password Utilities for Authentication
 *
 * Provides secure password validation, strength checking,
 * and policy enforcement utilities.
 */

import { PasswordRequirements } from "./types";

/**
 * Default password requirements
 */
export const DEFAULT_PASSWORD_REQUIREMENTS: PasswordRequirements = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
};

/**
 * Password validation and utility functions
 */
export class PasswordUtils {
  /**
   * Validate password against requirements
   */
  public static validatePassword(
    password: string,
    requirements: PasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS
  ): {
    isValid: boolean;
    errors: string[];
    strength: "weak" | "medium" | "strong";
  } {
    const errors: string[] = [];

    // Check minimum length
    if (password.length < requirements.minLength) {
      errors.push(
        `Password must be at least ${requirements.minLength} characters long`
      );
    }

    // Check for uppercase letters
    if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }

    // Check for lowercase letters
    if (requirements.requireLowercase && !/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }

    // Check for numbers
    if (requirements.requireNumbers && !/\d/.test(password)) {
      errors.push("Password must contain at least one number");
    }

    // Check for special characters
    if (
      requirements.requireSpecialChars &&
      !/[!@#$%^&*(),.?":{}|<>]/.test(password)
    ) {
      errors.push("Password must contain at least one special character");
    }

    // Calculate strength
    const strength = this.calculatePasswordStrength(password);

    return {
      isValid: errors.length === 0,
      errors,
      strength,
    };
  }

  /**
   * Calculate password strength
   */
  public static calculatePasswordStrength(
    password: string
  ): "weak" | "medium" | "strong" {
    let score = 0;

    // Length scoring
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;

    // Character variety scoring
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;

    // Complexity patterns
    if (/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) score += 1;
    if (/(?=.*[!@#$%^&*(),.?":{}|<>])/.test(password)) score += 1;

    if (score >= 7) return "strong";
    if (score >= 4) return "medium";
    return "weak";
  }

  /**
   * Generate a secure random password
   */
  public static generateSecurePassword(
    length: number = 16,
    requirements: PasswordRequirements = DEFAULT_PASSWORD_REQUIREMENTS
  ): string {
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    const specialChars = '!@#$%^&*(),.?":{}|<>';

    let charset = "";
    let password = "";

    // Ensure at least one character from each required set
    if (requirements.requireLowercase) {
      charset += lowercase;
      password += lowercase[Math.floor(Math.random() * lowercase.length)];
    }

    if (requirements.requireUppercase) {
      charset += uppercase;
      password += uppercase[Math.floor(Math.random() * uppercase.length)];
    }

    if (requirements.requireNumbers) {
      charset += numbers;
      password += numbers[Math.floor(Math.random() * numbers.length)];
    }

    if (requirements.requireSpecialChars) {
      charset += specialChars;
      password += specialChars[Math.floor(Math.random() * specialChars.length)];
    }

    // Fill the rest randomly
    for (let i = password.length; i < length; i++) {
      password += charset[Math.floor(Math.random() * charset.length)];
    }

    // Shuffle the password to avoid predictable patterns
    return password
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");
  }

  /**
   * Check if password has been pwned (common passwords check)
   * This is a placeholder - in production, integrate with HaveIBeenPwned API
   */
  public static async checkPasswordBreach(password: string): Promise<{
    isPwned: boolean;
    count: number;
  }> {
    // Common weak passwords list (in production, use a more comprehensive list)
    const commonPasswords = [
      "123456",
      "password",
      "password123",
      "123456789",
      "12345678",
      "qwerty",
      "abc123",
      "password1",
      "1234567890",
      "123123",
    ];

    const isPwned = commonPasswords.includes(password.toLowerCase());

    return {
      isPwned,
      count: isPwned ? 1 : 0, // Placeholder count
    };
  }

  /**
   * Generate password reset token
   */
  public static generateResetToken(): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";

    for (let i = 0; i < 32; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }

    return token;
  }

  /**
   * Hash password reset token for secure storage
   */
  public static hashResetToken(token: string): string {
    // In production, use a proper hash function
    // This is a simple implementation for demonstration
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      const char = token.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}
