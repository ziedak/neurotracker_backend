/**
 * @fileoverview Centralized data sanitization utilities
 * @description Production-grade data sanitization for logging, security, and compliance
 */
/**
 * Default sensitive field patterns
 */
export declare const DEFAULT_SENSITIVE_PATTERNS: readonly ["password", "passwd", "pwd", "token", "jwt", "auth", "authorization", "apikey", "api_key", "api-key", "x-api-key", "secret", "private", "key", "ssn", "social", "social_security", "credit", "card", "ccn", "cvv", "cvc", "phone", "mobile", "telephone", "email", "mail", "account", "routing", "iban", "swift", "bank", "payment", "session", "cookie", "csrf"];
/**
 * Sanitization configuration
 */
export interface SanitizationConfig {
    readonly sensitiveFields?: readonly string[];
    readonly redactValue?: string;
    readonly maskingStrategy?: MaskingStrategy;
    readonly maxDepth?: number;
    readonly preserveStructure?: boolean;
}
/**
 * Masking strategies for different data types
 */
export type MaskingStrategy = "redact" | "partial" | "asterisk" | "hash" | "remove";
/**
 * Default sanitization configuration
 */
export declare const DEFAULT_SANITIZATION_CONFIG: Required<SanitizationConfig>;
/**
 * Sanitization result with metadata
 */
export interface SanitizationResult<T = unknown> {
    readonly data: T;
    readonly fieldsRedacted: number;
    readonly patterns: string[];
    readonly warnings: string[];
}
/**
 * Advanced data sanitizer with multiple strategies
 */
export declare class DataSanitizer {
    private readonly config;
    private readonly circularRefs;
    private currentDepth;
    constructor(config?: SanitizationConfig);
    /**
     * Sanitize any data type with comprehensive tracking
     */
    sanitize<T>(data: T): SanitizationResult<T>;
    /**
     * Core sanitization logic
     */
    private sanitizeValue;
    /**
     * Sanitize array values
     */
    private sanitizeArray;
    /**
     * Sanitize object properties
     */
    private sanitizeObject;
    /**
     * Check if field name matches sensitive patterns
     */
    private isSensitiveField;
    /**
     * Apply masking strategy to sensitive values
     */
    private applyMasking;
    /**
     * Partial masking showing first and last characters
     */
    private maskPartial;
    /**
     * Simple hash for debugging (not cryptographic)
     */
    private simpleHash;
}
/**
 * Specialized sanitizers for common use cases
 */
export declare const sanitizers: {
    /**
     * Logging sanitizer - aggressive redaction
     */
    readonly logging: DataSanitizer;
    /**
     * Debugging sanitizer - partial masking for analysis
     */
    readonly debug: DataSanitizer;
    /**
     * API response sanitizer - preserve structure
     */
    readonly api: DataSanitizer;
    /**
     * Security audit sanitizer - hash values for tracking
     */
    readonly audit: DataSanitizer;
};
/**
 * Quick sanitization functions for common scenarios
 */
/**
 * Sanitize API keys, tokens, and secrets
 */
export declare function sanitizeSecret(secret: string): string;
/**
 * Sanitize HTTP headers
 */
export declare function sanitizeHeaders(headers: Record<string, string | string[]>): Record<string, string | string[]>;
/**
 * Sanitize request/response bodies
 */
export declare function sanitizePayload<T>(payload: T, customFields?: string[]): T;
/**
 * Sanitize connection metadata for WebSocket
 */
export declare function sanitizeConnectionMeta(meta: Record<string, unknown>): Record<string, unknown>;
/**
 * Factory for creating custom sanitizers
 */
export declare function createSanitizer(config: SanitizationConfig): DataSanitizer;
/**
 * Pre-configured sanitizers for specific middleware types
 */
export declare const middlewareSanitizers: {
    readonly cors: DataSanitizer;
    readonly auth: DataSanitizer;
    readonly rateLimit: DataSanitizer;
    readonly logging: DataSanitizer;
    readonly security: DataSanitizer;
};
//# sourceMappingURL=sanitization.utils.d.ts.map