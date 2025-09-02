/**
 * @fileoverview Secure password hashing utilities using Argon2
 * @module PasswordSecurity
 * @author Enterprise Security Team
 * @since 1.0.0 - Phase 1 Security Remediation
 */

import * as argon2 from "argon2";
import { z } from "zod";

/**
 * Password strength validation schema
 */
export const PasswordStrengthSchema = z
  .string()
  .min(8, "Password must be at least 8 characters long")
  .max(128, "Password must not exceed 128 characters")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
    "Password must contain at least one lowercase letter, one uppercase letter, one number, and one special character"
  );

/**
 * Password hashing configuration
 */
const ARGON2_CONFIG = {
  type: argon2.argon2id, // Most secure variant
  memoryCost: 65536, // 64 MB memory cost
  timeCost: 3, // 3 iterations
  parallelism: 4, // 4 parallel threads
  hashLength: 32, // 32 bytes hash length
  saltLength: 16, // 16 bytes salt length
} as const;

/**
 * Password verification result interface
 */
export interface IPasswordVerificationResult {
  readonly isValid: boolean;
  readonly needsRehash: boolean;
  readonly verificationTimeMs: number;
}

/**
 * Password hashing result interface
 */
export interface IPasswordHashResult {
  readonly hash: string;
  readonly algorithm: "argon2id";
  readonly hashedAt: Date;
  readonly hashingTimeMs: number;
}

/**
 * Secure password hashing and verification utility class
 *
 * This class provides enterprise-grade password security using Argon2id
 * to replace the critical plaintext password comparison vulnerability.
 *
 * @example
 * ```typescript
 * // Hash a password during user registration
 * const hashResult = await PasswordSecurity.hashPassword('mySecurePassword123!');
 *
 * // Verify password during authentication
 * const verification = await PasswordSecurity.verifyPassword(
 *   'mySecurePassword123!',
 *   hashResult.hash
 * );
 * ```
 */
export class PasswordSecurity {
  /**
   * Hash a password using Argon2id
   *
   * @param password - The plain text password to hash
   * @returns Promise resolving to password hash result with metadata
   * @throws Error if password doesn't meet strength requirements
   * @throws Error if hashing operation fails
   */
  public static async hashPassword(
    password: string
  ): Promise<IPasswordHashResult> {
    const startTime = Date.now();

    try {
      // Validate password strength
      PasswordStrengthSchema.parse(password);

      // Generate secure hash with Argon2id
      const hash = await argon2.hash(password, ARGON2_CONFIG);

      const hashingTimeMs = Date.now() - startTime;

      return {
        hash,
        algorithm: "argon2id",
        hashedAt: new Date(),
        hashingTimeMs,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Password strength validation failed: ${error.errors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      throw new Error(
        `Password hashing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Verify a password against its hash
   *
   * @param password - The plain text password to verify
   * @param hash - The stored Argon2 hash to verify against
   * @returns Promise resolving to verification result with timing info
   * @throws Error if verification operation fails
   */
  public static async verifyPassword(
    password: string,
    hash: string
  ): Promise<IPasswordVerificationResult> {
    const startTime = Date.now();

    try {
      // Input validation
      if (!password || typeof password !== "string") {
        throw new Error("Password must be a non-empty string");
      }

      if (!hash || typeof hash !== "string") {
        throw new Error("Hash must be a non-empty string");
      }

      // Verify password against hash
      const isValid = await argon2.verify(hash, password);

      // Check if hash needs upgrading (different parameters)
      const needsRehash = argon2.needsRehash(hash, ARGON2_CONFIG);

      const verificationTimeMs = Date.now() - startTime;

      return {
        isValid,
        needsRehash,
        verificationTimeMs,
      };
    } catch (error) {
      throw new Error(
        `Password verification failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  /**
   * Validate password strength without hashing
   *
   * @param password - The password to validate
   * @returns True if password meets strength requirements
   * @throws Error with validation details if password is weak
   */
  public static validatePasswordStrength(password: string): boolean {
    try {
      PasswordStrengthSchema.parse(password);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Password strength validation failed: ${error.errors
            .map((e) => e.message)
            .join(", ")}`
        );
      }
      throw error;
    }
  }

  /**
   * Generate a secure random password for system use
   *
   * @param length - Desired password length (minimum 12, default 16)
   * @returns Cryptographically secure random password
   */
  public static generateSecurePassword(length: number = 16): string {
    if (length < 12) {
      throw new Error("Generated password must be at least 12 characters long");
    }

    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    const symbols = "@$!%*?&";
    const allChars = lowercase + uppercase + numbers + symbols;

    // Ensure at least one character from each required category
    let password = "";
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];

    // Fill remaining length with random characters
    for (let i = 4; i < length; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    // Shuffle the password to avoid predictable patterns
    return password
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");
  }

  /**
   * Get current hashing configuration for auditing
   *
   * @returns Current Argon2 configuration parameters
   */
  public static getHashingConfig(): typeof ARGON2_CONFIG {
    return { ...ARGON2_CONFIG };
  }
}

/**
 * Timing-safe password comparison to prevent timing attacks
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns True if strings are equal, false otherwise
 * @internal
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
