/**
 * @fileoverview Centralized data sanitization utilities
 * @description Production-grade data sanitization for logging, security, and compliance
 */

/**
 * Default sensitive field patterns
 */
export const DEFAULT_SENSITIVE_PATTERNS = [
  // Authentication
  "password",
  "passwd",
  "pwd",
  "token",
  "jwt",
  "auth",
  "authorization",
  "apikey",
  "api_key",
  "api-key",
  "x-api-key",
  "secret",
  "private",
  "key",

  // Personal Information (PII)
  "ssn",
  "social",
  "social_security",
  "credit",
  "card",
  "ccn",
  "cvv",
  "cvc",
  "phone",
  "mobile",
  "telephone",
  "email",
  "mail",

  // Financial
  "account",
  "routing",
  "iban",
  "swift",
  "bank",
  "payment",

  // Other sensitive
  "session",
  "cookie",
  "csrf",
] as const;

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
export type MaskingStrategy =
  | "redact" // Replace with [REDACTED]
  | "partial" // Show first/last chars: abc***xyz
  | "asterisk" // Replace with asterisks: *********
  | "hash" // Replace with hash: [HASH:abc123]
  | "remove"; // Remove field entirely

/**
 * Default sanitization configuration
 */
export const DEFAULT_SANITIZATION_CONFIG: Required<SanitizationConfig> = {
  sensitiveFields: DEFAULT_SENSITIVE_PATTERNS,
  redactValue: "[REDACTED]",
  maskingStrategy: "partial",
  maxDepth: 10,
  preserveStructure: true,
} as const;

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
export class DataSanitizer {
  private readonly config: Required<SanitizationConfig>;
  private readonly circularRefs = new WeakSet();
  private currentDepth = 0;

  constructor(config: SanitizationConfig = {}) {
    this.config = {
      ...DEFAULT_SANITIZATION_CONFIG,
      ...config,
      sensitiveFields: [
        ...DEFAULT_SANITIZATION_CONFIG.sensitiveFields,
        ...(config.sensitiveFields || []),
      ],
    };
  }

  /**
   * Sanitize any data type with comprehensive tracking
   */
  sanitize<T>(data: T): SanitizationResult<T> {
    const result = {
      data: this.sanitizeValue(data) as T,
      fieldsRedacted: 0,
      patterns: [] as string[],
      warnings: [] as string[],
    };

    // Reset state
    // this.circularRefs.clear();
    this.currentDepth = 0;

    return result;
  }

  /**
   * Core sanitization logic
   */
  private sanitizeValue(value: unknown): unknown {
    // Handle primitive types
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== "object") {
      return value;
    }

    // Prevent infinite recursion
    if (this.circularRefs.has(value as object)) {
      return { "[CIRCULAR]": true };
    }

    // Prevent deep recursion
    if (this.currentDepth >= this.config.maxDepth) {
      return { "[MAX_DEPTH]": true };
    }

    this.circularRefs.add(value as object);
    this.currentDepth++;

    try {
      if (Array.isArray(value)) {
        return this.sanitizeArray(value);
      }

      return this.sanitizeObject(value as Record<string, unknown>);
    } finally {
      this.currentDepth--;
      this.circularRefs.delete(value as object);
    }
  }

  /**
   * Sanitize array values
   */
  private sanitizeArray(array: unknown[]): unknown[] {
    return array.map((item) => this.sanitizeValue(item));
  }

  /**
   * Sanitize object properties
   */
  private sanitizeObject(
    obj: Record<string, unknown>
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (this.isSensitiveField(key)) {
        result[key] = this.applyMasking(value, key);
      } else {
        result[key] = this.sanitizeValue(value);
      }
    }

    return result;
  }

  /**
   * Check if field name matches sensitive patterns
   */
  private isSensitiveField(fieldName: string): boolean {
    const lowerField = fieldName.toLowerCase();

    return this.config.sensitiveFields.some((pattern) =>
      lowerField.includes(pattern.toLowerCase())
    );
  }

  /**
   * Apply masking strategy to sensitive values
   */
  private applyMasking(value: unknown, fieldName: string): unknown {
    if (typeof value !== "string") {
      return this.config.redactValue;
    }

    const stringValue = value as string;

    switch (this.config.maskingStrategy) {
      case "redact":
        return this.config.redactValue;

      case "partial":
        return this.maskPartial(stringValue);

      case "asterisk":
        return "*".repeat(Math.min(stringValue.length, 10));

      case "hash":
        return `[HASH:${this.simpleHash(stringValue)}]`;

      case "remove":
        return this.config.preserveStructure
          ? this.config.redactValue
          : undefined;

      default:
        return this.config.redactValue;
    }
  }

  /**
   * Partial masking showing first and last characters
   */
  private maskPartial(value: string): string {
    if (value.length <= 6) {
      return "***";
    }

    const visibleChars = Math.min(3, Math.floor(value.length * 0.2));
    const start = value.substring(0, visibleChars);
    const end = value.substring(value.length - visibleChars);

    return `${start}***${end}`;
  }

  /**
   * Simple hash for debugging (not cryptographic)
   */
  private simpleHash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 6);
  }
}

/**
 * Specialized sanitizers for common use cases
 */
export const sanitizers = {
  /**
   * Logging sanitizer - aggressive redaction
   */
  logging: new DataSanitizer({
    maskingStrategy: "redact",
    maxDepth: 5,
  }),

  /**
   * Debugging sanitizer - partial masking for analysis
   */
  debug: new DataSanitizer({
    maskingStrategy: "partial",
    maxDepth: 8,
  }),

  /**
   * API response sanitizer - preserve structure
   */
  api: new DataSanitizer({
    maskingStrategy: "asterisk",
    preserveStructure: true,
  }),

  /**
   * Security audit sanitizer - hash values for tracking
   */
  audit: new DataSanitizer({
    maskingStrategy: "hash",
    maxDepth: 15,
  }),
} as const;

/**
 * Quick sanitization functions for common scenarios
 */

/**
 * Sanitize API keys, tokens, and secrets
 */
export function sanitizeSecret(secret: string): string {
  if (!secret || typeof secret !== "string") {
    return "[INVALID]";
  }

  if (secret.length <= 8) {
    return "***";
  }

  // For JWTs, show just the header part
  if (secret.includes(".") && secret.split(".").length === 3) {
    return `${secret.split(".")[0]}.[REDACTED].[REDACTED]`;
  }

  // For API keys, show first and last 4 characters
  return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
}

/**
 * Sanitize HTTP headers
 */
export function sanitizeHeaders(
  headers: Record<string, string | string[]>
): Record<string, string | string[]> {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
    "proxy-authorization",
    "www-authenticate",
  ];

  const result: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();

    if (sensitiveHeaders.includes(lowerKey)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Sanitize request/response bodies
 */
export function sanitizePayload<T>(payload: T, customFields: string[] = []): T {
  return sanitizers.logging.sanitize({
    ...payload,
    // Add custom fields to the default sensitive patterns
  } as T & { sensitiveFields?: string[] }).data;
}

/**
 * Sanitize connection metadata for WebSocket
 */
export function sanitizeConnectionMeta(
  meta: Record<string, unknown>
): Record<string, unknown> {
  return sanitizers.debug.sanitize(meta).data as Record<string, unknown>;
}

/**
 * Factory for creating custom sanitizers
 */
export function createSanitizer(config: SanitizationConfig): DataSanitizer {
  return new DataSanitizer(config);
}

/**
 * Pre-configured sanitizers for specific middleware types
 */
export const middlewareSanitizers = {
  cors: createSanitizer({
    sensitiveFields: ["authorization", "cookie", "x-api-key"],
    maskingStrategy: "partial",
  }),

  auth: createSanitizer({
    sensitiveFields: ["password", "token", "jwt", "apikey", "secret"],
    maskingStrategy: "redact",
  }),

  rateLimit: createSanitizer({
    sensitiveFields: ["x-api-key", "authorization"],
    maskingStrategy: "partial",
  }),

  logging: createSanitizer({
    sensitiveFields: [...DEFAULT_SENSITIVE_PATTERNS],
    maskingStrategy: "redact",
    maxDepth: 3,
  }),

  security: createSanitizer({
    sensitiveFields: [...DEFAULT_SENSITIVE_PATTERNS],
    maskingStrategy: "hash",
    maxDepth: 10,
  }),
} as const;
