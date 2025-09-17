/**
 * Core authentication types for the auth library
 * Defines the fundamental interfaces and types used throughout the system
 */
// ===================================================================
// ERROR TYPES
// ===================================================================
export class AuthError extends Error {
    code;
    statusCode;
    constructor(message, code, statusCode = 500) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = "AuthError";
    }
}
export class UnauthorizedError extends AuthError {
    constructor(message = "Unauthorized") {
        super(message, "UNAUTHORIZED", 401);
        this.name = "UnauthorizedError";
    }
}
export class ForbiddenError extends AuthError {
    constructor(message = "Forbidden") {
        super(message, "FORBIDDEN", 403);
        this.name = "ForbiddenError";
    }
}
export class ValidationError extends AuthError {
    field;
    constructor(message, field) {
        super(message, "VALIDATION_ERROR", 400);
        this.field = field;
        this.name = "ValidationError";
    }
}
//# sourceMappingURL=index.js.map