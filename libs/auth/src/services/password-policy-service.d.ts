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
import { AuthConfig, ServiceDependencies, PasswordPolicyConfig, PasswordValidationResult, PasswordComplexityRequirements } from "../types";
export declare class PasswordPolicyService {
    private deps;
    private readonly config;
    constructor(authConfig: AuthConfig, deps: ServiceDependencies);
    /**
     * Validate password against all policy requirements
     */
    validatePassword(password: string, userContext?: {
        email?: string;
        name?: string;
    }): Promise<PasswordValidationResult>;
    /**
     * Check if password meets complexity requirements
     */
    checkComplexityRequirements(password: string): PasswordComplexityRequirements;
    /**
     * Generate password strength suggestions
     */
    generatePasswordSuggestions(): string[];
    /**
     * Get current password policy configuration
     */
    getPolicyConfiguration(): PasswordPolicyConfig;
    /**
     * Validate multiple passwords (for batch operations)
     */
    validatePasswords(passwords: Array<{
        password: string;
        userContext?: {
            email?: string;
            name?: string;
        };
    }>): Promise<PasswordValidationResult[]>;
    private isCommonPassword;
    private isSequentialPattern;
    private isRepeatingPattern;
    private isBlacklistedPassword;
    private containsPersonalInfo;
    private analyzePatternStrength;
    private calculateStrength;
    private escapeRegex;
    private maskEmail;
}
/**
 * Create password policy service instance
 */
export declare function createPasswordPolicyService(config: AuthConfig, deps: ServiceDependencies): PasswordPolicyService;
/**
 * Quick password strength check (without full validation)
 */
export declare function getPasswordStrength(password: string): "weak" | "medium" | "strong" | "very-strong";
export default PasswordPolicyService;
//# sourceMappingURL=password-policy-service.d.ts.map