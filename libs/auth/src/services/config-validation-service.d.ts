/**
 * Configuration Validation Service
 * Provides runtime validation for authentication configuration
 * Ensures all required settings are present and valid
 */
import { AuthConfig } from "../types";
export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}
export interface ValidationError {
    field: string;
    message: string;
    severity: "error" | "warning";
    suggestion?: string;
}
export interface ValidationWarning {
    field: string;
    message: string;
    suggestion?: string | undefined;
}
export interface ConfigValidationRule {
    field: string;
    required: boolean;
    validator: (value: any, config: AuthConfig) => ValidationError | null;
    description: string;
}
export declare class ConfigValidationService {
    private validationRules;
    constructor();
    /**
     * Validate complete authentication configuration
     */
    validateConfig(config: AuthConfig): ValidationResult;
    /**
     * Validate configuration and throw error if invalid
     */
    validateConfigStrict(config: AuthConfig): void;
    /**
     * Get validation rules
     */
    getValidationRules(): ConfigValidationRule[];
    /**
     * Add custom validation rule
     */
    addValidationRule(rule: ConfigValidationRule): void;
    /**
     * Remove validation rule
     */
    removeValidationRule(field: string): void;
    /**
     * Get configuration template with defaults
     */
    getConfigTemplate(): AuthConfig;
    private initializeValidationRules;
    private validateCrossFieldRules;
    private getNestedValue;
    private parseDuration;
}
/**
 * Create configuration validation service instance
 */
export declare function createConfigValidationService(): ConfigValidationService;
/**
 * Quick configuration validation
 */
export declare function validateAuthConfig(config: AuthConfig): ValidationResult;
/**
 * Validate and get configuration template
 */
export declare function getValidatedConfigTemplate(): {
    template: AuthConfig;
    validation: ValidationResult;
};
export default ConfigValidationService;
//# sourceMappingURL=config-validation-service.d.ts.map