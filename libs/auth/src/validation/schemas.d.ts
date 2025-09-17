/**
 * Zod Validation Schemas
 * Provides type-safe input validation for all authentication operations
 * Ensures data integrity and prevents injection attacks
 */
import { z } from "zod";
/**
 * Email validation schema with comprehensive format checking
 */
export declare const EmailSchema: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
/**
 * Password validation schema (basic format check)
 * Note: Detailed password policy validation handled by PasswordPolicyService
 */
export declare const PasswordSchema: z.ZodString;
/**
 * User ID validation schema
 */
export declare const UserIdSchema: z.ZodString;
/**
 * Name validation schema
 */
export declare const NameSchema: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
/**
 * Role validation schema
 */
export declare const RoleSchema: z.ZodString;
/**
 * Permission validation schema
 */
export declare const PermissionSchema: z.ZodString;
/**
 * Device type validation
 */
export declare const DeviceTypeSchema: z.ZodEnum<{
    desktop: "desktop";
    mobile: "mobile";
    tablet: "tablet";
}>;
/**
 * Device info validation schema
 */
export declare const DeviceInfoSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<{
        desktop: "desktop";
        mobile: "mobile";
        tablet: "tablet";
    }>>;
    browser: z.ZodOptional<z.ZodString>;
    os: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/**
 * IP address validation schema (supports both IPv4 and IPv6)
 */
export declare const IpAddressSchema: z.ZodString;
/**
 * Login credentials validation schema
 */
export declare const LoginCredentialsSchema: z.ZodObject<{
    email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    password: z.ZodString;
    deviceInfo: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        type: z.ZodOptional<z.ZodEnum<{
            desktop: "desktop";
            mobile: "mobile";
            tablet: "tablet";
        }>>;
        browser: z.ZodOptional<z.ZodString>;
        os: z.ZodOptional<z.ZodString>;
        version: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/**
 * Registration data validation schema
 */
export declare const RegisterDataSchema: z.ZodObject<{
    email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    password: z.ZodString;
    name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
    roles: z.ZodOptional<z.ZodArray<z.ZodString>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strict>;
/**
 * User update validation schema
 */
export declare const UserUpdateSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
    roles: z.ZodOptional<z.ZodArray<z.ZodString>>;
    permissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    isActive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
/**
 * User creation validation schema (admin use)
 */
export declare const UserCreateSchema: z.ZodObject<{
    email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    password: z.ZodString;
    name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    roles: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
/**
 * Session creation validation schema
 */
export declare const SessionCreateSchema: z.ZodObject<{
    userId: z.ZodString;
    deviceInfo: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        type: z.ZodOptional<z.ZodEnum<{
            desktop: "desktop";
            mobile: "mobile";
            tablet: "tablet";
        }>>;
        browser: z.ZodOptional<z.ZodString>;
        os: z.ZodOptional<z.ZodString>;
        version: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    ipAddress: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/**
 * Session ID validation schema
 */
export declare const SessionIdSchema: z.ZodString;
/**
 * API key creation validation schema
 */
export declare const ApiKeyCreateSchema: z.ZodObject<{
    name: z.ZodString;
    permissions: z.ZodArray<z.ZodString>;
    expiresAt: z.ZodOptional<z.ZodDate>;
}, z.core.$strict>;
/**
 * API key update validation schema
 */
export declare const ApiKeyUpdateSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    permissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
    isActive: z.ZodOptional<z.ZodBoolean>;
    expiresAt: z.ZodOptional<z.ZodDate>;
}, z.core.$strict>;
/**
 * API key validation schema
 */
export declare const ApiKeySchema: z.ZodString;
/**
 * JWT token validation schema
 */
export declare const JWTTokenSchema: z.ZodString;
/**
 * Authorization header validation schema
 */
export declare const AuthorizationHeaderSchema: z.ZodString;
/**
 * Pagination validation schema
 */
export declare const PaginationSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
/**
 * Sort order validation schema
 */
export declare const SortOrderSchema: z.ZodEnum<{
    asc: "asc";
    desc: "desc";
}>;
/**
 * User filtering validation schema
 */
export declare const UserFilterSchema: z.ZodObject<{
    email: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodString>;
    isActive: z.ZodOptional<z.ZodBoolean>;
    createdAfter: z.ZodOptional<z.ZodDate>;
    createdBefore: z.ZodOptional<z.ZodDate>;
}, z.core.$strict>;
/**
 * Request ID validation schema
 */
export declare const RequestIdSchema: z.ZodString;
/**
 * Request context validation schema
 */
export declare const RequestContextSchema: z.ZodObject<{
    requestId: z.ZodString;
    userAgent: z.ZodOptional<z.ZodString>;
    ipAddress: z.ZodString;
    path: z.ZodString;
    method: z.ZodEnum<{
        GET: "GET";
        POST: "POST";
        PUT: "PUT";
        DELETE: "DELETE";
        OPTIONS: "OPTIONS";
        PATCH: "PATCH";
        HEAD: "HEAD";
    }>;
    timestamp: z.ZodDate;
}, z.core.$strict>;
/**
 * Bulk user creation validation schema
 */
export declare const BulkUserCreateSchema: z.ZodObject<{
    users: z.ZodArray<z.ZodObject<{
        email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
        password: z.ZodString;
        name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        roles: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/**
 * Bulk user update validation schema
 */
export declare const BulkUserUpdateSchema: z.ZodObject<{
    userIds: z.ZodArray<z.ZodString>;
    updates: z.ZodObject<{
        name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
        roles: z.ZodOptional<z.ZodArray<z.ZodString>>;
        permissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        isActive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * Create validation result type
 */
export type ValidationResult<T> = {
    success: true;
    data: T;
} | {
    success: false;
    errors: z.ZodError;
};
/**
 * Safe validation function that returns result with error handling
 */
export declare function safeValidate<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T>;
/**
 * Validate and throw on error (for use in service methods)
 */
export declare function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown, context?: string): T;
/**
 * Create validation middleware for request data
 */
export declare function createValidationMiddleware<T>(schema: z.ZodSchema<T>, dataExtractor?: (request: any) => unknown): (request: any) => T;
export declare const ValidationSchemas: {
    readonly Email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    readonly Password: z.ZodString;
    readonly UserId: z.ZodString;
    readonly Name: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    readonly Role: z.ZodString;
    readonly Permission: z.ZodString;
    readonly DeviceInfo: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        type: z.ZodOptional<z.ZodEnum<{
            desktop: "desktop";
            mobile: "mobile";
            tablet: "tablet";
        }>>;
        browser: z.ZodOptional<z.ZodString>;
        os: z.ZodOptional<z.ZodString>;
        version: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    readonly DeviceType: z.ZodEnum<{
        desktop: "desktop";
        mobile: "mobile";
        tablet: "tablet";
    }>;
    readonly LoginCredentials: z.ZodObject<{
        email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
        password: z.ZodString;
        deviceInfo: z.ZodOptional<z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            type: z.ZodOptional<z.ZodEnum<{
                desktop: "desktop";
                mobile: "mobile";
                tablet: "tablet";
            }>>;
            browser: z.ZodOptional<z.ZodString>;
            os: z.ZodOptional<z.ZodString>;
            version: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    readonly RegisterData: z.ZodObject<{
        email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
        password: z.ZodString;
        name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
        roles: z.ZodOptional<z.ZodArray<z.ZodString>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strict>;
    readonly UserUpdate: z.ZodObject<{
        name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
        roles: z.ZodOptional<z.ZodArray<z.ZodString>>;
        permissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        isActive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>;
    readonly UserCreate: z.ZodObject<{
        email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
        password: z.ZodString;
        name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        roles: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    readonly SessionCreate: z.ZodObject<{
        userId: z.ZodString;
        deviceInfo: z.ZodOptional<z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            type: z.ZodOptional<z.ZodEnum<{
                desktop: "desktop";
                mobile: "mobile";
                tablet: "tablet";
            }>>;
            browser: z.ZodOptional<z.ZodString>;
            os: z.ZodOptional<z.ZodString>;
            version: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        ipAddress: z.ZodOptional<z.ZodString>;
        userAgent: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>;
    readonly SessionId: z.ZodString;
    readonly ApiKeyCreate: z.ZodObject<{
        name: z.ZodString;
        permissions: z.ZodArray<z.ZodString>;
        expiresAt: z.ZodOptional<z.ZodDate>;
    }, z.core.$strict>;
    readonly ApiKeyUpdate: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        permissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
        isActive: z.ZodOptional<z.ZodBoolean>;
        expiresAt: z.ZodOptional<z.ZodDate>;
    }, z.core.$strict>;
    readonly ApiKey: z.ZodString;
    readonly JWTToken: z.ZodString;
    readonly AuthorizationHeader: z.ZodString;
    readonly Pagination: z.ZodObject<{
        page: z.ZodDefault<z.ZodNumber>;
        limit: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strict>;
    readonly SortOrder: z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>;
    readonly UserFilter: z.ZodObject<{
        email: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        role: z.ZodOptional<z.ZodString>;
        isActive: z.ZodOptional<z.ZodBoolean>;
        createdAfter: z.ZodOptional<z.ZodDate>;
        createdBefore: z.ZodOptional<z.ZodDate>;
    }, z.core.$strict>;
    readonly IpAddress: z.ZodString;
    readonly RequestId: z.ZodString;
    readonly RequestContext: z.ZodObject<{
        requestId: z.ZodString;
        userAgent: z.ZodOptional<z.ZodString>;
        ipAddress: z.ZodString;
        path: z.ZodString;
        method: z.ZodEnum<{
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
            DELETE: "DELETE";
            OPTIONS: "OPTIONS";
            PATCH: "PATCH";
            HEAD: "HEAD";
        }>;
        timestamp: z.ZodDate;
    }, z.core.$strict>;
    readonly BulkUserCreate: z.ZodObject<{
        users: z.ZodArray<z.ZodObject<{
            email: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
            password: z.ZodString;
            name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            roles: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    readonly BulkUserUpdate: z.ZodObject<{
        userIds: z.ZodArray<z.ZodString>;
        updates: z.ZodObject<{
            name: z.ZodOptional<z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>>;
            roles: z.ZodOptional<z.ZodArray<z.ZodString>>;
            permissions: z.ZodOptional<z.ZodArray<z.ZodString>>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            isActive: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>;
    }, z.core.$strict>;
};
export default ValidationSchemas;
//# sourceMappingURL=schemas.d.ts.map