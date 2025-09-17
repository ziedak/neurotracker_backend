/**
 * Configuration Validation Service
 * Provides runtime validation for authentication configuration
 * Ensures all required settings are present and valid
 */
// ===================================================================
// CONFIGURATION VALIDATION SERVICE
// ===================================================================
export class ConfigValidationService {
    validationRules = [];
    constructor() {
        this.initializeValidationRules();
    }
    /**
     * Validate complete authentication configuration
     */
    validateConfig(config) {
        const errors = [];
        const warnings = [];
        // Validate each rule
        for (const rule of this.validationRules) {
            const error = rule.validator(this.getNestedValue(config, rule.field), config);
            if (error) {
                if (error.severity === "error") {
                    errors.push(error);
                }
                else {
                    warnings.push({
                        field: error.field,
                        message: error.message,
                        suggestion: error.suggestion,
                    });
                }
            }
        }
        // Additional cross-field validations
        this.validateCrossFieldRules(config, errors, warnings);
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }
    /**
     * Validate configuration and throw error if invalid
     */
    validateConfigStrict(config) {
        const result = this.validateConfig(config);
        if (!result.isValid) {
            const errorMessages = result.errors.map((err) => `${err.field}: ${err.message}`);
            throw new Error(`Configuration validation failed:\n${errorMessages.join("\n")}`);
        }
        if (result.warnings.length > 0) {
            const warningMessages = result.warnings.map((warn) => `${warn.field}: ${warn.message}`);
            console.warn("Configuration warnings:\n" + warningMessages.join("\n"));
        }
    }
    /**
     * Get validation rules
     */
    getValidationRules() {
        return [...this.validationRules];
    }
    /**
     * Add custom validation rule
     */
    addValidationRule(rule) {
        this.validationRules.push(rule);
    }
    /**
     * Remove validation rule
     */
    removeValidationRule(field) {
        this.validationRules = this.validationRules.filter((rule) => rule.field !== field);
    }
    /**
     * Get configuration template with defaults
     */
    getConfigTemplate() {
        return {
            jwt: {
                secret: "your-jwt-secret-key",
                expiresIn: "1h",
                refreshExpiresIn: "7d",
                issuer: "auth-service",
                audience: "your-app",
            },
            keycloak: {
                serverUrl: "https://your-keycloak-server.com",
                realm: "your-realm",
                clientId: "your-client-id",
                clientSecret: "your-client-secret",
            },
            redis: {
                host: "localhost",
                port: 6379,
                db: 0,
            },
            session: {
                ttl: 3600,
                refreshThreshold: 300,
            },
            apiKey: {
                prefix: "ak_",
                length: 32,
            },
        };
    }
    // ===================================================================
    // PRIVATE METHODS
    // ===================================================================
    initializeValidationRules() {
        this.validationRules = [
            // JWT Configuration
            {
                field: "jwt.secret",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "jwt.secret",
                            message: "JWT secret is required and must be a string",
                            severity: "error",
                            suggestion: "Set a strong, random secret key for JWT signing",
                        };
                    }
                    if (value.length < 32) {
                        return {
                            field: "jwt.secret",
                            message: "JWT secret should be at least 32 characters long",
                            severity: "warning",
                            suggestion: "Use a longer secret for better security",
                        };
                    }
                    return null;
                },
                description: "JWT signing secret key",
            },
            {
                field: "jwt.expiresIn",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "jwt.expiresIn",
                            message: "JWT expiration time is required and must be a string",
                            severity: "error",
                            suggestion: 'Set expiration time (e.g., "1h", "30m", "86400s")',
                        };
                    }
                    return null;
                },
                description: "JWT token expiration time",
            },
            {
                field: "jwt.refreshExpiresIn",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "jwt.refreshExpiresIn",
                            message: "Refresh token expiration time is required and must be a string",
                            severity: "error",
                            suggestion: 'Set refresh token expiration time (e.g., "7d", "30d")',
                        };
                    }
                    return null;
                },
                description: "Refresh token expiration time",
            },
            {
                field: "jwt.issuer",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "jwt.issuer",
                            message: "JWT issuer is required and must be a string",
                            severity: "error",
                            suggestion: "Set the JWT issuer identifier",
                        };
                    }
                    return null;
                },
                description: "JWT issuer identifier",
            },
            {
                field: "jwt.audience",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "jwt.audience",
                            message: "JWT audience is required and must be a string",
                            severity: "error",
                            suggestion: "Set the JWT audience identifier",
                        };
                    }
                    return null;
                },
                description: "JWT audience identifier",
            },
            // Keycloak Configuration
            {
                field: "keycloak.serverUrl",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "keycloak.serverUrl",
                            message: "Keycloak server URL is required and must be a string",
                            severity: "error",
                            suggestion: "Set the Keycloak server URL (e.g., https://keycloak.example.com)",
                        };
                    }
                    try {
                        new URL(value);
                    }
                    catch {
                        return {
                            field: "keycloak.serverUrl",
                            message: "Keycloak server URL must be a valid URL",
                            severity: "error",
                            suggestion: "Ensure the URL includes protocol (http/https)",
                        };
                    }
                    return null;
                },
                description: "Keycloak server base URL",
            },
            {
                field: "keycloak.realm",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "keycloak.realm",
                            message: "Keycloak realm is required and must be a string",
                            severity: "error",
                            suggestion: "Set the Keycloak realm name",
                        };
                    }
                    return null;
                },
                description: "Keycloak realm name",
            },
            {
                field: "keycloak.clientId",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "keycloak.clientId",
                            message: "Keycloak client ID is required and must be a string",
                            severity: "error",
                            suggestion: "Set the Keycloak client ID",
                        };
                    }
                    return null;
                },
                description: "Keycloak client identifier",
            },
            {
                field: "keycloak.clientSecret",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "keycloak.clientSecret",
                            message: "Keycloak client secret is required and must be a string",
                            severity: "error",
                            suggestion: "Set the Keycloak client secret",
                        };
                    }
                    if (value.length < 16) {
                        return {
                            field: "keycloak.clientSecret",
                            message: "Keycloak client secret should be at least 16 characters long",
                            severity: "warning",
                            suggestion: "Use a longer client secret for better security",
                        };
                    }
                    return null;
                },
                description: "Keycloak client secret",
            },
            // Redis Configuration
            {
                field: "redis.host",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "redis.host",
                            message: "Redis host is required and must be a string",
                            severity: "error",
                            suggestion: "Set the Redis server hostname or IP address",
                        };
                    }
                    return null;
                },
                description: "Redis server hostname",
            },
            {
                field: "redis.port",
                required: true,
                validator: (value) => {
                    if (typeof value !== "number" || value <= 0 || value > 65535) {
                        return {
                            field: "redis.port",
                            message: "Redis port must be a valid port number (1-65535)",
                            severity: "error",
                            suggestion: "Set a valid Redis port (default: 6379)",
                        };
                    }
                    return null;
                },
                description: "Redis server port",
            },
            {
                field: "redis.db",
                required: false,
                validator: (value) => {
                    if (value !== undefined && (typeof value !== "number" || value < 0)) {
                        return {
                            field: "redis.db",
                            message: "Redis database number must be a non-negative integer",
                            severity: "error",
                            suggestion: "Set a valid Redis database number (default: 0)",
                        };
                    }
                    return null;
                },
                description: "Redis database number",
            },
            // Session Configuration
            {
                field: "session.ttl",
                required: true,
                validator: (value) => {
                    if (typeof value !== "number" || value <= 0) {
                        return {
                            field: "session.ttl",
                            message: "Session TTL must be a positive number",
                            severity: "error",
                            suggestion: "Set session TTL in seconds (e.g., 3600 for 1 hour)",
                        };
                    }
                    if (value < 300) {
                        return {
                            field: "session.ttl",
                            message: "Session TTL is very short, consider increasing for better UX",
                            severity: "warning",
                            suggestion: "Consider TTL > 300 seconds (5 minutes)",
                        };
                    }
                    return null;
                },
                description: "Session time-to-live in seconds",
            },
            {
                field: "session.refreshThreshold",
                required: true,
                validator: (value) => {
                    if (typeof value !== "number" || value <= 0) {
                        return {
                            field: "session.refreshThreshold",
                            message: "Session refresh threshold must be a positive number",
                            severity: "error",
                            suggestion: "Set refresh threshold in seconds",
                        };
                    }
                    return null;
                },
                description: "Session refresh threshold in seconds",
            },
            // API Key Configuration
            {
                field: "apiKey.prefix",
                required: true,
                validator: (value) => {
                    if (!value || typeof value !== "string") {
                        return {
                            field: "apiKey.prefix",
                            message: "API key prefix is required and must be a string",
                            severity: "error",
                            suggestion: 'Set a prefix for API keys (e.g., "ak_", "api_")',
                        };
                    }
                    return null;
                },
                description: "API key prefix",
            },
            {
                field: "apiKey.length",
                required: true,
                validator: (value) => {
                    if (typeof value !== "number" || value < 16 || value > 128) {
                        return {
                            field: "apiKey.length",
                            message: "API key length must be between 16 and 128 characters",
                            severity: "error",
                            suggestion: "Set API key length (recommended: 32)",
                        };
                    }
                    return null;
                },
                description: "API key length",
            },
        ];
    }
    validateCrossFieldRules(config, errors, warnings) {
        // JWT expiration should be reasonable
        if (config.jwt.expiresIn && config.jwt.refreshExpiresIn) {
            const accessExpiry = this.parseDuration(config.jwt.expiresIn);
            const refreshExpiry = this.parseDuration(config.jwt.refreshExpiresIn);
            if (accessExpiry && refreshExpiry && accessExpiry >= refreshExpiry) {
                errors.push({
                    field: "jwt.expiresIn/jwt.refreshExpiresIn",
                    message: "Access token expiration should be shorter than refresh token expiration",
                    severity: "error",
                    suggestion: "Set access token expiry much shorter than refresh token expiry",
                });
            }
        }
        // Session TTL should be reasonable compared to JWT expiry
        if (config.session.ttl && config.jwt.expiresIn) {
            const sessionTtl = config.session.ttl;
            const jwtExpiry = this.parseDuration(config.jwt.expiresIn);
            if (jwtExpiry && sessionTtl > jwtExpiry * 2) {
                warnings.push({
                    field: "session.ttl",
                    message: "Session TTL is much longer than JWT expiry, consider aligning them",
                    suggestion: "Consider making session TTL closer to JWT expiry time",
                });
            }
        }
        // Redis database should be reasonable
        if (config.redis.db && config.redis.db > 15) {
            warnings.push({
                field: "redis.db",
                message: "Redis database number is high, consider using lower numbers",
                suggestion: "Use Redis database numbers 0-15 for better organization",
            });
        }
    }
    getNestedValue(obj, path) {
        return path.split(".").reduce((current, key) => current?.[key], obj);
    }
    parseDuration(duration) {
        const match = duration.match(/^(\d+)([smhd])$/);
        if (!match || !match[1])
            return null;
        const value = parseInt(match[1]);
        const unit = match[2];
        switch (unit) {
            case "s":
                return value;
            case "m":
                return value * 60;
            case "h":
                return value * 3600;
            case "d":
                return value * 86400;
            default:
                return null;
        }
    }
}
// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================
/**
 * Create configuration validation service instance
 */
export function createConfigValidationService() {
    return new ConfigValidationService();
}
/**
 * Quick configuration validation
 */
export function validateAuthConfig(config) {
    const validator = new ConfigValidationService();
    return validator.validateConfig(config);
}
/**
 * Validate and get configuration template
 */
export function getValidatedConfigTemplate() {
    const validator = new ConfigValidationService();
    const template = validator.getConfigTemplate();
    const validation = validator.validateConfig(template);
    return { template, validation };
}
export default ConfigValidationService;
//# sourceMappingURL=config-validation-service.js.map