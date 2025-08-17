import bcrypt from "bcrypt";

/**
 * PasswordService: Secure password hashing, validation, and generation
 */

export class PasswordService {
  private static readonly SALT_ROUNDS = 12;

  /**
   * Hash a plain text password using bcrypt
   * @param password Plain text password
   * @returns Promise resolving to hashed password
   */
  static async hash(password: string): Promise<string> {
    if (!password || typeof password !== "string") {
      throw new Error("Password must be a non-empty string");
    }
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Verify a plain text password against a hash
   * @param password Plain text password
   * @param hash Hashed password
   * @returns Promise resolving to boolean
   */
  static async verify(password: string, hash: string): Promise<boolean> {
    if (!password || !hash) {
      throw new Error("Password and hash are required");
    }
    return bcrypt.compare(password, hash);
  }

  /**
   * Validate password against security requirements
   * @param password Plain text password
   * @returns Object with validity and error messages
   */
  static validatePassword(password: string): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    if (typeof password !== "string" || password.length < 8) {
      errors.push("Password must be at least 8 characters long");
    }
    if (password.length > 128) {
      errors.push("Password cannot be longer than 128 characters");
    }
    if (!/[a-z]/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }
    if (!/[A-Z]/.test(password)) {
      errors.push("Password must contain at least one uppercase letter");
    }
    if (!/\d/.test(password)) {
      errors.push("Password must contain at least one number");
    }
    if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
      errors.push("Password must contain at least one special character");
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate a secure random password
   * @param length Desired password length (default: 16)
   * @returns Generated password string
   */
  static generatePassword(length: number = 16): string {
    if (length < 8) {
      throw new Error("Password length must be at least 8 characters");
    }
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    const special = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    const allChars = lowercase + uppercase + numbers + special;
    let password = [
      lowercase[Math.floor(Math.random() * lowercase.length)],
      uppercase[Math.floor(Math.random() * uppercase.length)],
      numbers[Math.floor(Math.random() * numbers.length)],
      special[Math.floor(Math.random() * special.length)],
    ];
    for (let i = 4; i < length; i++) {
      password.push(allChars[Math.floor(Math.random() * allChars.length)]);
    }
    // Fisher-Yates shuffle for better entropy
    for (let i = password.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [password[i], password[j]] = [password[j], password[i]];
    }
    return password.join("");
  }
}
