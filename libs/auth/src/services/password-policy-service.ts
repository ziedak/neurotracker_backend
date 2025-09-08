/**
 * Password Policy Service
 * Handles password strength    // Initialize password policy configuration with defaults
    this.config = {
      minLength: authConfig.passwordPolicy?.minLength || 8,
      maxLength: authConfig.passwordPolicy?.maxLength || 128,
      requireUppercase: authConfig.passwordPolicy?.requireUppercase ?? true,
      requireLowercase: authConfig.passwordPolicy?.requireLowercase ?? true,
      requireNumbers: authConfig.passwordPolicy?.requireNumbers ?? true,
      requireSpecialChars: authConfig.passwordPolicy?.requireSpecialChars ?? true,
      specialChars:
        authConfig.passwordPolicy?.specialChars || "!@#$%^&*()_+-=[]{}|;:,.<>?",
      blacklistedPasswords: authConfig.passwordPolicy?.blacklistedPasswords || [],
      enableCommonPasswordCheck:
        authConfig.passwordPolicy?.enableCommonPasswordCheck ?? true,
      enableCompromisedPasswordCheck:
        authConfig.passwordPolicy?.enableCompromisedPasswordCheck ?? false,
    };policy enforcement
 * Provides configurable password requirements for enhanced security
 */

import {
  AuthConfig,
  ServiceDependencies,
  PasswordPolicyConfig,
  PasswordValidationResult,
  PasswordComplexityRequirements,
} from "../types";

// ===================================================================
// COMMON WEAK PASSWORDS
// ===================================================================

const COMMON_PASSWORDS = [
  "password",
  "123456",
  "password123",
  "admin",
  "qwerty",
  "letmein",
  "welcome",
  "monkey",
  "dragon",
  "passw0rd",
  "master",
  "hello",
  "freedom",
  "access",
  "123456789",
  "12345678",
  "1234567890",
  "1234567",
  "123123",
  "abc123",
  "password1",
  "admin123",
  "root",
  "guest",
  "test",
  "user",
  "demo",
  "123",
  "111111",
  "000000",
];

// ===================================================================
// PASSWORD POLICY SERVICE CLASS
// ===================================================================

export class PasswordPolicyService {
  private readonly config: PasswordPolicyConfig;

  constructor(authConfig: AuthConfig, private deps: ServiceDependencies) {
    // Initialize password policy configuration with defaults
    this.config = {
      minLength: authConfig.passwordPolicy?.minLength || 8,
      maxLength: authConfig.passwordPolicy?.maxLength || 128,
      requireUppercase: authConfig.passwordPolicy?.requireUppercase ?? true,
      requireLowercase: authConfig.passwordPolicy?.requireLowercase ?? true,
      requireNumbers: authConfig.passwordPolicy?.requireNumbers ?? true,
      requireSpecialChars:
        authConfig.passwordPolicy?.requireSpecialChars ?? true,
      specialChars:
        authConfig.passwordPolicy?.specialChars || "!@#$%^&*()_+-=[]{}|;:,.<>?",
      blacklistedPasswords:
        authConfig.passwordPolicy?.blacklistedPasswords || [],
      enableCommonPasswordCheck:
        authConfig.passwordPolicy?.enableCommonPasswordCheck ?? true,
      enableCompromisedPasswordCheck:
        authConfig.passwordPolicy?.enableCompromisedPasswordCheck ?? false,
    };
  }

  /**
   * Validate password against all policy requirements
   */
  async validatePassword(
    password: string,
    userContext?: { email?: string; name?: string }
  ): Promise<PasswordValidationResult> {
    const errors: string[] = [];
    const suggestions: string[] = [];
    let score = 0;

    // Basic length validation
    if (password.length < this.config.minLength) {
      errors.push(
        `Password must be at least ${this.config.minLength} characters long`
      );
    } else if (password.length >= this.config.minLength) {
      score += 20; // Base score for meeting minimum length
    }

    if (password.length > this.config.maxLength) {
      errors.push(
        `Password must be no more than ${this.config.maxLength} characters long`
      );
    }

    // Character requirement validations
    const requirements = this.checkComplexityRequirements(password);

    if (this.config.requireUppercase && !requirements.uppercase) {
      errors.push("Password must contain at least one uppercase letter");
      suggestions.push("Add uppercase letters (A-Z)");
    } else if (requirements.uppercase) {
      score += 15;
    }

    if (this.config.requireLowercase && !requirements.lowercase) {
      errors.push("Password must contain at least one lowercase letter");
      suggestions.push("Add lowercase letters (a-z)");
    } else if (requirements.lowercase) {
      score += 15;
    }

    if (this.config.requireNumbers && !requirements.numbers) {
      errors.push("Password must contain at least one number");
      suggestions.push("Add numbers (0-9)");
    } else if (requirements.numbers) {
      score += 15;
    }

    if (this.config.requireSpecialChars && !requirements.specialChars) {
      errors.push(
        `Password must contain at least one special character (${this.config.specialChars})`
      );
      suggestions.push("Add special characters (!@#$%^&* etc.)");
    } else if (requirements.specialChars) {
      score += 15;
    }

    // Length bonus scoring
    if (password.length >= 12) score += 10;
    if (password.length >= 16) score += 10;
    if (password.length >= 20) score += 10;

    // Common password check
    if (
      this.config.enableCommonPasswordCheck &&
      this.isCommonPassword(password)
    ) {
      errors.push("Password is too common and easily guessable");
      suggestions.push("Use a unique password that's not commonly used");
      score = Math.max(0, score - 20);
    }

    // Personal information check
    if (userContext && this.containsPersonalInfo(password, userContext)) {
      errors.push("Password should not contain personal information");
      suggestions.push(
        "Avoid using your email, name, or other personal details"
      );
      score = Math.max(0, score - 15);
    }

    // Custom blacklist check
    if (this.isBlacklistedPassword(password)) {
      errors.push("Password is not allowed by security policy");
      score = Math.max(0, score - 30);
    }

    // Pattern strength analysis
    const patternBonus = this.analyzePatternStrength(password);
    score += patternBonus;

    // Determine overall strength
    const strength = this.calculateStrength(score);
    const isValid = errors.length === 0 && strength !== "weak";

    this.deps.monitoring.logger.info("Password validation completed", {
      isValid,
      strength,
      score,
      errorCount: errors.length,
      userEmail: userContext?.email
        ? this.maskEmail(userContext.email)
        : undefined,
    });

    return {
      isValid,
      strength,
      score: Math.min(100, score),
      errors,
      suggestions: suggestions.slice(0, 3), // Limit suggestions to avoid overwhelming users
    };
  }

  /**
   * Check if password meets complexity requirements
   */
  checkComplexityRequirements(
    password: string
  ): PasswordComplexityRequirements {
    return {
      length: password.length >= this.config.minLength,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      numbers: /[0-9]/.test(password),
      specialChars: new RegExp(
        `[${this.escapeRegex(this.config.specialChars)}]`
      ).test(password),
      notCommon: !this.isCommonPassword(password),
      notCompromised: true, // TODO: Implement compromised password check via API
    };
  }

  /**
   * Generate password strength suggestions
   */
  generatePasswordSuggestions(): string[] {
    return [
      `Use at least ${this.config.minLength} characters`,
      "Mix uppercase and lowercase letters",
      "Include numbers and special characters",
      "Avoid common words and personal information",
      "Consider using a passphrase with multiple words",
      "Use a password manager to generate strong passwords",
    ];
  }

  /**
   * Get current password policy configuration
   */
  getPolicyConfiguration(): PasswordPolicyConfig {
    return { ...this.config };
  }

  /**
   * Validate multiple passwords (for batch operations)
   */
  async validatePasswords(
    passwords: Array<{
      password: string;
      userContext?: { email?: string; name?: string };
    }>
  ): Promise<PasswordValidationResult[]> {
    const results: PasswordValidationResult[] = [];

    for (const { password, userContext } of passwords) {
      try {
        const result = await this.validatePassword(password, userContext);
        results.push(result);
      } catch (error) {
        this.deps.monitoring.logger.error("Password validation failed", {
          error: error instanceof Error ? error.message : String(error),
          userEmail: userContext?.email
            ? this.maskEmail(userContext.email)
            : undefined,
        });

        results.push({
          isValid: false,
          strength: "weak",
          score: 0,
          errors: ["Password validation failed"],
          suggestions: ["Please try again"],
        });
      }
    }

    return results;
  }

  // ===================================================================
  // PRIVATE METHODS
  // ===================================================================

  private isCommonPassword(password: string): boolean {
    const lowerPassword = password.toLowerCase();
    return (
      COMMON_PASSWORDS.includes(lowerPassword) ||
      this.isSequentialPattern(password) ||
      this.isRepeatingPattern(password)
    );
  }

  private isSequentialPattern(password: string): boolean {
    // Check for sequential patterns like "123456", "abcdef", "qwerty"
    const sequential = [
      "123456789",
      "abcdefghijklmnopqrstuvwxyz",
      "qwertyuiop",
    ];
    const lowerPassword = password.toLowerCase();

    return sequential.some(
      (seq) => seq.includes(lowerPassword) && lowerPassword.length >= 4
    );
  }

  private isRepeatingPattern(password: string): boolean {
    // Check for repeating patterns like "aaaa", "1111"
    if (password.length < 3) return false;

    const firstChar = password[0];
    return password.split("").every((char) => char === firstChar);
  }

  private isBlacklistedPassword(password: string): boolean {
    const lowerPassword = password.toLowerCase();
    return this.config.blacklistedPasswords.some(
      (blacklisted) => lowerPassword === blacklisted.toLowerCase()
    );
  }

  private containsPersonalInfo(
    password: string,
    userContext: { email?: string; name?: string }
  ): boolean {
    const lowerPassword = password.toLowerCase();

    if (userContext.email) {
      const emailParts = userContext.email.toLowerCase().split("@");
      if (emailParts[0] && lowerPassword.includes(emailParts[0])) {
        return true;
      }
    }

    if (userContext.name) {
      const nameParts = userContext.name.toLowerCase().split(" ");
      return nameParts.some(
        (part) => part.length > 2 && lowerPassword.includes(part)
      );
    }

    return false;
  }

  private analyzePatternStrength(password: string): number {
    let bonus = 0;

    // Character diversity bonus
    const uniqueChars = new Set(password).size;
    bonus += Math.min(15, uniqueChars);

    // Mixed case bonus
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) {
      bonus += 5;
    }

    // Number placement bonus (not just at the end)
    if (/[0-9]/.test(password) && !/[0-9]+$/.test(password)) {
      bonus += 5;
    }

    // Special character variety bonus
    const specialMatches = password.match(
      new RegExp(`[${this.escapeRegex(this.config.specialChars)}]`, "g")
    );
    if (specialMatches) {
      const uniqueSpecials = new Set(specialMatches).size;
      bonus += Math.min(10, uniqueSpecials * 2);
    }

    return bonus;
  }

  private calculateStrength(
    score: number
  ): "weak" | "medium" | "strong" | "very-strong" {
    if (score < 30) return "weak";
    if (score < 60) return "medium";
    if (score < 80) return "strong";
    return "very-strong";
  }

  private escapeRegex(str: string): string {
    // For character classes, we need to escape - at the beginning or end, or escape it
    return str.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  }

  private maskEmail(email: string): string {
    const [username, domain] = email.split("@");
    if (!username || !domain) return "[invalid-email]";

    const maskedUsername =
      username.length > 2
        ? username[0] +
          "*".repeat(username.length - 2) +
          username[username.length - 1]
        : "*".repeat(username.length);

    return `${maskedUsername}@${domain}`;
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create password policy service instance
 */
export function createPasswordPolicyService(
  config: AuthConfig,
  deps: ServiceDependencies
): PasswordPolicyService {
  return new PasswordPolicyService(config, deps);
}

/**
 * Quick password strength check (without full validation)
 */
export function getPasswordStrength(
  password: string
): "weak" | "medium" | "strong" | "very-strong" {
  let score = 0;

  if (password.length >= 8) score += 20;
  if (password.length >= 12) score += 10;
  if (/[a-z]/.test(password)) score += 15;
  if (/[A-Z]/.test(password)) score += 15;
  if (/[0-9]/.test(password)) score += 15;
  if (/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) score += 15;
  if (new Set(password).size >= password.length * 0.7) score += 10;

  if (score < 30) return "weak";
  if (score < 60) return "medium";
  if (score < 80) return "strong";
  return "very-strong";
}

export default PasswordPolicyService;
