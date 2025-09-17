/**
 * Unified Input Validation System
 * Consolidates multiple validation implementations using Zod
 *
 * CONSOLIDATES:
 * - libs/elysia-server/src/utils/InputValidator.ts (407 lines of custom validation)
 * - libs/auth/src/validation/schemas.ts (520 lines of Zod schemas)
 * - libs/_archive/authV2/src/utils/InputValidator.ts (660 lines of duplicate Zod)
 * - Various scattered validation logic across libs
 */
import { z } from "zod";
// ===================================================================
// BASE VALIDATION SCHEMAS
// ===================================================================
/**
 * Common string validations
 */
export const CommonSchemas = {
    // Email validation with comprehensive format checking
    email: z
        .string()
        .min(1, "Email is required")
        .max(254, "Email is too long")
        .email("Invalid email format")
        .toLowerCase()
        .transform((email) => email.trim()),
    // Password validation (basic format check)
    password: z
        .string()
        .min(1, "Password is required")
        .max(128, "Password is too long"),
    // Username validation
    username: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .max(50, "Username must not exceed 50 characters")
        .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, underscores, and hyphens"),
    // URL validation
    url: z
        .string()
        .min(1, "URL is required")
        .max(2048, "URL is too long")
        .url("Invalid URL format"),
    // JWT Token validation
    jwtToken: z
        .string()
        .min(16, "Token too short - minimum 16 characters")
        .max(2048, "Token too long - maximum 2048 characters")
        .regex(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/, "Invalid JWT format")
        .transform((token) => token.replace(/^Bearer\s+/i, "")),
    // ID validation (UUIDs, ObjectIds, etc.)
    id: z
        .string()
        .min(1, "ID is required")
        .max(50, "ID is too long")
        .regex(/^[a-zA-Z0-9_-]+$/, "Invalid ID format"),
    // Non-empty string
    nonEmptyString: z
        .string()
        .min(1, "Value is required")
        .transform((str) => str.trim()),
};
// ===================================================================
// HTTP VALIDATION SCHEMAS
// ===================================================================
/**
 * HTTP Headers validation
 */
export const HttpSchemas = {
    headers: z
        .record(z.string().max(200, "Header name too long"), z.union([
        z.string().max(8192, "Header value too long"),
        z.array(z.string().max(8192, "Header value too long")),
    ]))
        .refine((headers) => Object.keys(headers).length <= 100, "Too many headers"),
    // Content-Type validation
    contentType: z.enum([
        "application/json",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
        "text/plain",
        "text/html",
    ]),
    // User-Agent validation
    userAgent: z.string().max(512, "User-Agent too long").optional(),
};
// ===================================================================
// WEBSOCKET VALIDATION SCHEMAS
// ===================================================================
/**
 * WebSocket message validation
 */
export const WebSocketSchemas = {
    // Base WebSocket message structure
    message: z.object({
        type: z
            .string()
            .min(1, "Message type is required")
            .max(50, "Message type too long"),
        payload: z.unknown().optional(),
        id: z.string().optional(),
        timestamp: z.number().optional(),
    }),
    // Connection metadata
    connectionMetadata: z.object({
        connectedAt: z.number(),
        lastActivity: z.number(),
        messageCount: z.number().min(0),
        clientIp: z.string().optional(),
        userAgent: z.string().max(512).optional(),
        headers: HttpSchemas.headers.optional(),
        query: z.record(z.string(), z.string()).optional(),
    }),
    // Room operations
    roomOperation: z.object({
        type: z.enum(["join_room", "leave_room"]),
        roomId: z.string().min(1).max(100),
    }),
};
// ===================================================================
// AUTHENTICATION VALIDATION SCHEMAS
// ===================================================================
/**
 * Authentication-related validation schemas
 */
export const AuthSchemas = {
    // Login credentials
    loginCredentials: z.object({
        email: CommonSchemas.email,
        password: CommonSchemas.password,
    }),
    // Registration data
    registrationData: z.object({
        email: CommonSchemas.email,
        password: CommonSchemas.password,
        username: CommonSchemas.username.optional(),
        firstName: z.string().min(1).max(50).optional(),
        lastName: z.string().min(1).max(50).optional(),
    }),
    // Token validation
    tokenValidation: z.object({
        token: CommonSchemas.jwtToken,
        type: z.enum(["access", "refresh", "reset"]).optional(),
    }),
    // API Key validation
    apiKey: z
        .string()
        .min(32, "API key too short")
        .max(128, "API key too long")
        .regex(/^[a-zA-Z0-9_-]+$/, "Invalid API key format"),
};
// ===================================================================
// UNIFIED VALIDATOR CLASS
// ===================================================================
/**
 * Unified Input Validator using Zod schemas
 * Replaces multiple scattered validation implementations
 */
export class UnifiedInputValidator {
    /**
     * Validate and parse data with a Zod schema
     */
    static validateAndParse(schema, data) {
        try {
            return schema.parse(data);
        }
        catch (error) {
            if (error instanceof z.ZodError) {
                const issues = error.issues
                    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                    .join(", ");
                throw new ValidationError(`Validation failed: ${issues}`);
            }
            throw error;
        }
    }
    /**
     * Safe validation that returns success/error result
     */
    static safeValidate(schema, data) {
        const result = schema.safeParse(data);
        if (result.success) {
            return { success: true, data: result.data };
        }
        else {
            const issues = result.error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join(", ");
            return { success: false, error: `Validation failed: ${issues}` };
        }
    }
    // ===============================================================
    // CONVENIENCE METHODS (replacing old InputValidator methods)
    // ===============================================================
    /**
     * Validate JWT token
     */
    static validateToken(token) {
        return this.validateAndParse(CommonSchemas.jwtToken, token);
    }
    /**
     * Validate URL
     */
    static validateUrl(url) {
        return this.validateAndParse(CommonSchemas.url, url);
    }
    /**
     * Validate HTTP headers
     */
    static validateHeaders(headers) {
        return this.validateAndParse(HttpSchemas.headers, headers);
    }
    /**
     * Validate WebSocket message
     */
    static validateWebSocketMessage(message) {
        return this.validateAndParse(WebSocketSchemas.message, message);
    }
    /**
     * Validate login credentials
     */
    static validateLoginCredentials(credentials) {
        return this.validateAndParse(AuthSchemas.loginCredentials, credentials);
    }
    /**
     * Validate email
     */
    static validateEmail(email) {
        return this.validateAndParse(CommonSchemas.email, email);
    }
    /**
     * Validate ID
     */
    static validateId(id) {
        return this.validateAndParse(CommonSchemas.id, id);
    }
}
// ===================================================================
// CUSTOM ERROR CLASSES
// ===================================================================
/**
 * Validation error class
 */
export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}
// ===================================================================
// SCHEMA EXPORTS FOR DIRECT USE
// ===================================================================
// Legacy compatibility exports
export const EmailSchema = CommonSchemas.email;
export const PasswordSchema = CommonSchemas.password;
export const UsernameSchema = CommonSchemas.username;
// Default export for the validator
export default UnifiedInputValidator;
//# sourceMappingURL=UnifiedInputValidator.js.map