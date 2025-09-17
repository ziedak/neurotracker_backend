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
/**
 * Common string validations
 */
export declare const CommonSchemas: {
    email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    password: z.ZodString;
    username: z.ZodString;
    url: z.ZodString;
    jwtToken: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    id: z.ZodString;
    nonEmptyString: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
};
/**
 * HTTP Headers validation
 */
export declare const HttpSchemas: {
    headers: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>;
    contentType: z.ZodEnum<{
        "text/plain": "text/plain";
        "application/json": "application/json";
        "application/x-www-form-urlencoded": "application/x-www-form-urlencoded";
        "multipart/form-data": "multipart/form-data";
        "text/html": "text/html";
    }>;
    userAgent: z.ZodOptional<z.ZodString>;
};
/**
 * WebSocket message validation
 */
export declare const WebSocketSchemas: {
    message: z.ZodObject<{
        type: z.ZodString;
        payload: z.ZodOptional<z.ZodUnknown>;
        id: z.ZodOptional<z.ZodString>;
        timestamp: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    connectionMetadata: z.ZodObject<{
        connectedAt: z.ZodNumber;
        lastActivity: z.ZodNumber;
        messageCount: z.ZodNumber;
        clientIp: z.ZodOptional<z.ZodString>;
        userAgent: z.ZodOptional<z.ZodString>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>>>;
        query: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>;
    roomOperation: z.ZodObject<{
        type: z.ZodEnum<{
            join_room: "join_room";
            leave_room: "leave_room";
        }>;
        roomId: z.ZodString;
    }, z.core.$strip>;
};
/**
 * Authentication-related validation schemas
 */
export declare const AuthSchemas: {
    loginCredentials: z.ZodObject<{
        email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
        password: z.ZodString;
    }, z.core.$strip>;
    registrationData: z.ZodObject<{
        email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
        password: z.ZodString;
        username: z.ZodOptional<z.ZodString>;
        firstName: z.ZodOptional<z.ZodString>;
        lastName: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    tokenValidation: z.ZodObject<{
        token: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
        type: z.ZodOptional<z.ZodEnum<{
            access: "access";
            refresh: "refresh";
            reset: "reset";
        }>>;
    }, z.core.$strip>;
    apiKey: z.ZodString;
};
/**
 * Unified Input Validator using Zod schemas
 * Replaces multiple scattered validation implementations
 */
export declare class UnifiedInputValidator {
    /**
     * Validate and parse data with a Zod schema
     */
    static validateAndParse<T>(schema: z.ZodSchema<T>, data: unknown): T;
    /**
     * Safe validation that returns success/error result
     */
    static safeValidate<T>(schema: z.ZodSchema<T>, data: unknown): {
        success: boolean;
        data?: T;
        error?: string;
    };
    /**
     * Validate JWT token
     */
    static validateToken(token: unknown): string;
    /**
     * Validate URL
     */
    static validateUrl(url: unknown): string;
    /**
     * Validate HTTP headers
     */
    static validateHeaders(headers: unknown): Record<string, string | string[]>;
    /**
     * Validate WebSocket message
     */
    static validateWebSocketMessage(message: unknown): {
        type: string;
        payload?: unknown;
        id?: string | undefined;
        timestamp?: number | undefined;
    };
    /**
     * Validate login credentials
     */
    static validateLoginCredentials(credentials: unknown): {
        email: string;
        password: string;
    };
    /**
     * Validate email
     */
    static validateEmail(email: unknown): string;
    /**
     * Validate ID
     */
    static validateId(id: unknown): string;
}
/**
 * Validation error class
 */
export declare class ValidationError extends Error {
    constructor(message: string);
}
export declare const EmailSchema: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
export declare const PasswordSchema: z.ZodString;
export declare const UsernameSchema: z.ZodString;
export default UnifiedInputValidator;
//# sourceMappingURL=UnifiedInputValidator.d.ts.map