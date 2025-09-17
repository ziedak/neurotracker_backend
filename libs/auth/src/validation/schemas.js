/**
 * Zod Validation Schemas
 * Provides type-safe input validation for all authentication operations
 * Ensures data integrity and prevents injection attacks
 */
import { z } from "zod";
// ===================================================================
// BASE VALIDATION SCHEMAS
// ===================================================================
/**
 * Email validation schema with comprehensive format checking
 */
export const EmailSchema = z
    .string()
    .min(1, "Email is required")
    .max(254, "Email is too long")
    .email("Invalid email format")
    .toLowerCase()
    .transform((email) => email.trim());
/**
 * Password validation schema (basic format check)
 * Note: Detailed password policy validation handled by PasswordPolicyService
 */
export const PasswordSchema = z
    .string()
    .min(1, "Password is required")
    .max(128, "Password is too long");
/**
 * User ID validation schema
 */
export const UserIdSchema = z
    .string()
    .min(1, "User ID is required")
    .max(255, "User ID is too long")
    .regex(/^[a-zA-Z0-9_-]+$/, "User ID contains invalid characters");
/**
 * Name validation schema
 */
export const NameSchema = z
    .string()
    .min(1, "Name is required")
    .max(100, "Name is too long")
    .regex(/^[a-zA-Z\s\-'\.]+$/, "Name contains invalid characters")
    .transform((name) => name.trim());
/**
 * Role validation schema
 */
export const RoleSchema = z
    .string()
    .min(1, "Role is required")
    .max(50, "Role name is too long")
    .regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/, "Invalid role format");
/**
 * Permission validation schema
 */
export const PermissionSchema = z
    .string()
    .min(1, "Permission is required")
    .max(100, "Permission is too long")
    .regex(/^[a-zA-Z_][a-zA-Z0-9_:-]*$/, "Invalid permission format");
// ===================================================================
// DEVICE INFO VALIDATION
// ===================================================================
/**
 * Device type validation
 */
export const DeviceTypeSchema = z.enum(["desktop", "mobile", "tablet"]);
/**
 * Device info validation schema
 */
export const DeviceInfoSchema = z
    .object({
    name: z.string().max(200, "Device name is too long").optional(),
    type: DeviceTypeSchema.optional(),
    browser: z.string().max(100, "Browser name is too long").optional(),
    os: z.string().max(100, "OS name is too long").optional(),
    version: z.string().max(50, "Version is too long").optional(),
})
    .strict();
// ===================================================================
// IP ADDRESS VALIDATION
// ===================================================================
/**
 * IP address validation schema (supports both IPv4 and IPv6)
 */
export const IpAddressSchema = z
    .string()
    .min(1, "IP address is required")
    .refine((ip) => {
    // IPv4 regex
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    // IPv6 regex (simplified)
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}, "Invalid IP address format");
// ===================================================================
// AUTHENTICATION SCHEMAS
// ===================================================================
/**
 * Login credentials validation schema
 */
export const LoginCredentialsSchema = z
    .object({
    email: EmailSchema,
    password: PasswordSchema,
    deviceInfo: DeviceInfoSchema.optional(),
})
    .strict();
/**
 * Registration data validation schema
 */
export const RegisterDataSchema = z
    .object({
    email: EmailSchema,
    password: PasswordSchema,
    name: NameSchema.optional(),
    roles: z.array(RoleSchema).max(10, "Too many roles").optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
})
    .strict();
/**
 * User update validation schema
 */
export const UserUpdateSchema = z
    .object({
    name: NameSchema.optional(),
    roles: z.array(RoleSchema).max(10, "Too many roles").optional(),
    permissions: z
        .array(PermissionSchema)
        .max(50, "Too many permissions")
        .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
})
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
});
/**
 * User creation validation schema (admin use)
 */
export const UserCreateSchema = RegisterDataSchema.extend({
    roles: z
        .array(RoleSchema)
        .min(1, "At least one role is required")
        .max(10, "Too many roles"),
}).strict();
// ===================================================================
// SESSION VALIDATION
// ===================================================================
/**
 * Session creation validation schema
 */
export const SessionCreateSchema = z
    .object({
    userId: UserIdSchema,
    deviceInfo: DeviceInfoSchema.optional(),
    ipAddress: IpAddressSchema.optional(),
    userAgent: z.string().max(500, "User agent is too long").optional(),
})
    .strict();
/**
 * Session ID validation schema
 */
export const SessionIdSchema = z
    .string()
    .min(1, "Session ID is required")
    .uuid("Invalid session ID format");
// ===================================================================
// API KEY VALIDATION
// ===================================================================
/**
 * API key creation validation schema
 */
export const ApiKeyCreateSchema = z
    .object({
    name: z
        .string()
        .min(1, "API key name is required")
        .max(100, "API key name is too long")
        .regex(/^[a-zA-Z0-9\s\-_\.]+$/, "API key name contains invalid characters"),
    permissions: z
        .array(PermissionSchema)
        .min(1, "At least one permission is required")
        .max(20, "Too many permissions"),
    expiresAt: z
        .date()
        .min(new Date(), "Expiration date must be in the future")
        .optional(),
})
    .strict();
/**
 * API key update validation schema
 */
export const ApiKeyUpdateSchema = z
    .object({
    name: z
        .string()
        .min(1, "API key name is required")
        .max(100, "API key name is too long")
        .regex(/^[a-zA-Z0-9\s\-_\.]+$/, "API key name contains invalid characters")
        .optional(),
    permissions: z
        .array(PermissionSchema)
        .min(1, "At least one permission is required")
        .max(20, "Too many permissions")
        .optional(),
    isActive: z.boolean().optional(),
    expiresAt: z
        .date()
        .min(new Date(), "Expiration date must be in the future")
        .optional(),
})
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update",
});
/**
 * API key validation schema
 */
export const ApiKeySchema = z
    .string()
    .min(1, "API key is required")
    .max(100, "API key is too long")
    .regex(/^[a-zA-Z0-9_-]+$/, "Invalid API key format");
// ===================================================================
// TOKEN VALIDATION
// ===================================================================
/**
 * JWT token validation schema
 */
export const JWTTokenSchema = z
    .string()
    .min(1, "Token is required")
    .regex(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/, "Invalid JWT format");
/**
 * Authorization header validation schema
 */
export const AuthorizationHeaderSchema = z
    .string()
    .min(1, "Authorization header is required")
    .regex(/^Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/, "Invalid Bearer token format");
// ===================================================================
// PAGINATION & FILTERING
// ===================================================================
/**
 * Pagination validation schema
 */
export const PaginationSchema = z
    .object({
    page: z.number().int().min(1, "Page must be at least 1").default(1),
    limit: z
        .number()
        .int()
        .min(1, "Limit must be at least 1")
        .max(100, "Limit cannot exceed 100")
        .default(20),
})
    .strict();
/**
 * Sort order validation schema
 */
export const SortOrderSchema = z.enum(["asc", "desc"]);
/**
 * User filtering validation schema
 */
export const UserFilterSchema = z
    .object({
    email: z.string().optional(),
    name: z.string().optional(),
    role: RoleSchema.optional(),
    isActive: z.boolean().optional(),
    createdAfter: z.date().optional(),
    createdBefore: z.date().optional(),
})
    .strict();
// ===================================================================
// REQUEST CONTEXT VALIDATION
// ===================================================================
/**
 * Request ID validation schema
 */
export const RequestIdSchema = z
    .string()
    .min(1, "Request ID is required")
    .uuid("Invalid request ID format");
/**
 * Request context validation schema
 */
export const RequestContextSchema = z
    .object({
    requestId: RequestIdSchema,
    userAgent: z.string().max(500, "User agent is too long").optional(),
    ipAddress: IpAddressSchema,
    path: z.string().max(500, "Path is too long"),
    method: z.enum([
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH",
        "OPTIONS",
        "HEAD",
    ]),
    timestamp: z.date(),
})
    .strict();
// ===================================================================
// BULK OPERATIONS VALIDATION
// ===================================================================
/**
 * Bulk user creation validation schema
 */
export const BulkUserCreateSchema = z
    .object({
    users: z
        .array(UserCreateSchema)
        .min(1, "At least one user is required")
        .max(100, "Cannot create more than 100 users at once"),
})
    .strict();
/**
 * Bulk user update validation schema
 */
export const BulkUserUpdateSchema = z
    .object({
    userIds: z
        .array(UserIdSchema)
        .min(1, "At least one user ID is required")
        .max(100, "Cannot update more than 100 users at once"),
    updates: UserUpdateSchema,
})
    .strict();
/**
 * Safe validation function that returns result with error handling
 */
export function safeValidate(schema, data) {
    const result = schema.safeParse(data);
    if (result.success) {
        return { success: true, data: result.data };
    }
    else {
        return { success: false, errors: result.error };
    }
}
/**
 * Validate and throw on error (for use in service methods)
 */
export function validateOrThrow(schema, data, context = "input") {
    try {
        return schema.parse(data);
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.issues
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join(", ");
            throw new Error(`Invalid ${context}: ${errorMessages}`);
        }
        throw error;
    }
}
/**
 * Create validation middleware for request data
 */
export function createValidationMiddleware(schema, dataExtractor = (req) => req.body) {
    return (request) => {
        const data = dataExtractor(request);
        const result = safeValidate(schema, data);
        if (!result.success) {
            const errorMessages = result.errors.issues.map((err) => `${err.path.join(".")}: ${err.message}`);
            throw new Error(`Validation failed: ${errorMessages.join(", ")}`);
        }
        // Replace the original data with validated and transformed data
        if (dataExtractor === ((req) => req.body)) {
            request.body = result.data;
        }
        return result.data;
    };
}
// ===================================================================
// EXPORT ALL SCHEMAS
// ===================================================================
export const ValidationSchemas = {
    // Base types
    Email: EmailSchema,
    Password: PasswordSchema,
    UserId: UserIdSchema,
    Name: NameSchema,
    Role: RoleSchema,
    Permission: PermissionSchema,
    // Device info
    DeviceInfo: DeviceInfoSchema,
    DeviceType: DeviceTypeSchema,
    // Authentication
    LoginCredentials: LoginCredentialsSchema,
    RegisterData: RegisterDataSchema,
    UserUpdate: UserUpdateSchema,
    UserCreate: UserCreateSchema,
    // Sessions
    SessionCreate: SessionCreateSchema,
    SessionId: SessionIdSchema,
    // API Keys
    ApiKeyCreate: ApiKeyCreateSchema,
    ApiKeyUpdate: ApiKeyUpdateSchema,
    ApiKey: ApiKeySchema,
    // Tokens
    JWTToken: JWTTokenSchema,
    AuthorizationHeader: AuthorizationHeaderSchema,
    // Pagination
    Pagination: PaginationSchema,
    SortOrder: SortOrderSchema,
    UserFilter: UserFilterSchema,
    // Request context
    IpAddress: IpAddressSchema,
    RequestId: RequestIdSchema,
    RequestContext: RequestContextSchema,
    // Bulk operations
    BulkUserCreate: BulkUserCreateSchema,
    BulkUserUpdate: BulkUserUpdateSchema,
};
export default ValidationSchemas;
//# sourceMappingURL=schemas.js.map