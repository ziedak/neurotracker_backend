import { BaseMiddleware } from "../base";
/**
 * Default CORS configuration constants
 */
const DEFAULT_CORS_OPTIONS = {
    ORIGIN: "*",
    METHODS: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    ALLOWED_HEADERS: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-API-Key",
    ],
    EXPOSED_HEADERS: ["X-Total-Count", "X-Rate-Limit-Remaining"],
    CREDENTIALS: false, // Cannot use credentials with wildcard origin
    MAX_AGE: 86400, // 24 hours
    OPTIONS_SUCCESS_STATUS: 204,
    PRIORITY: 100, // High priority for CORS
};
/**
 * Production-grade CORS Middleware
 * Implements Cross-Origin Resource Sharing with comprehensive security controls
 *
 * Features:
 * - Strict type safety with readonly configurations
 * - Comprehensive origin validation with detailed logging
 * - Performance-optimized header setting
 * - Built-in security best practices
 * - Extensive monitoring and metrics
 *
 * @template CorsHttpMiddlewareConfig - CORS-specific configuration
 */
export class CorsHttpMiddleware extends BaseMiddleware {
    constructor(metrics, config = {}) {
        // Create complete configuration with validated defaults
        const completeConfig = {
            name: config.name || "cors",
            enabled: config.enabled ?? true,
            priority: config.priority ?? DEFAULT_CORS_OPTIONS.PRIORITY,
            skipPaths: config.skipPaths || [],
            allowedOrigins: config.allowedOrigins ?? DEFAULT_CORS_OPTIONS.ORIGIN,
            allowedMethods: config.allowedMethods ?? [...DEFAULT_CORS_OPTIONS.METHODS],
            allowedHeaders: config.allowedHeaders ?? [
                ...DEFAULT_CORS_OPTIONS.ALLOWED_HEADERS,
            ],
            exposedHeaders: config.exposedHeaders ?? [
                ...DEFAULT_CORS_OPTIONS.EXPOSED_HEADERS,
            ],
            credentials: config.credentials ?? DEFAULT_CORS_OPTIONS.CREDENTIALS,
            maxAge: config.maxAge ?? DEFAULT_CORS_OPTIONS.MAX_AGE,
            preflightContinue: config.preflightContinue ?? false,
            optionsSuccessStatus: config.optionsSuccessStatus ??
                DEFAULT_CORS_OPTIONS.OPTIONS_SUCCESS_STATUS,
        };
        super(metrics, completeConfig, completeConfig.name);
        this.validateConfiguration();
    }
    /**
     * Core CORS middleware execution logic
     * Handles both preflight and actual requests with comprehensive validation
     */
    async execute(context, next) {
        const startTime = performance.now();
        const origin = this.extractOrigin(context);
        const method = context.request.method.toUpperCase();
        try {
            this.logger.debug("Processing CORS request", {
                origin: origin || "null",
                method,
                path: context.request.url,
                requestId: this.getRequestId(context),
            });
            // Validate and set CORS headers
            const validationResult = this.validateOrigin(origin);
            // Check for invalid origin format
            if (origin && !this.isValidOriginFormat(origin)) {
                throw new Error("Invalid origin format");
            }
            // Throw error for disallowed origins if request has origin
            if (origin && !validationResult.allowed) {
                throw new Error("Origin not allowed");
            }
            this.setCorsHeaders(context, origin, validationResult);
            // Handle preflight requests
            if (method === "OPTIONS") {
                await this.handlePreflightRequest(context, origin, validationResult);
                return; // Early return for preflight
            }
            // Record successful CORS processing
            await this.recordCorsMetrics("request_processed", validationResult, {
                method,
                origin: origin || "null",
            });
            // Record headers added metric
            await this.recordMetric("cors_headers_added", 1, {
                origin: origin || "null",
            });
            // Record success metric
            await this.recordMetric("cors_request_success", 1, {
                origin: origin || "null",
            });
            // Continue to next middleware
            await next();
        }
        catch (error) {
            await this.handleCorsError(error, context, origin);
            throw error; // Re-throw to maintain error chain
        }
        finally {
            const executionTime = performance.now() - startTime;
            await this.recordTimer("cors_request_duration", executionTime, {
                method,
                origin: origin || "null",
            });
        }
    }
    /**
     * Handle CORS preflight requests with detailed validation
     */
    async handlePreflightRequest(context, origin, validationResult) {
        this.logger.debug("Handling CORS preflight request", {
            origin: origin || "null",
            allowed: validationResult.allowed,
            requestId: this.getRequestId(context),
        });
        // Validate requested method
        const requestedMethod = context.request.headers["access-control-request-method"];
        if (requestedMethod) {
            const methodAllowed = this.config.allowedMethods?.includes(requestedMethod.toUpperCase());
            if (!methodAllowed) {
                throw new Error("Method not allowed");
            }
        }
        // Validate requested headers
        const requestedHeaders = context.request.headers["access-control-request-headers"];
        if (requestedHeaders) {
            const headerNames = requestedHeaders
                .split(",")
                .map((h) => h.trim().toLowerCase());
            const allowedHeadersLower = this.config.allowedHeaders?.map((h) => h.toLowerCase()) || [];
            for (const headerName of headerNames) {
                if (!allowedHeadersLower.includes(headerName)) {
                    throw new Error("Header not allowed");
                }
            }
        }
        // Set preflight-specific headers
        this.setPreflightHeaders(context);
        // Set response status
        context.set.status = this.config.optionsSuccessStatus;
        await this.recordCorsMetrics("preflight_handled", validationResult, {
            origin: origin || "null",
        });
    }
    /**
     * Set CORS headers with type-safe mutations
     */
    setCorsHeaders(context, origin, validationResult) {
        // Ensure headers object exists
        if (!context.set.headers) {
            context.set.headers = {};
        }
        const { headers } = context.set;
        // Set origin header
        if (validationResult.allowed) {
            if (validationResult.matchedOrigin === "*") {
                headers["Access-Control-Allow-Origin"] = "*";
            }
            else if (origin) {
                headers["Access-Control-Allow-Origin"] =
                    validationResult.matchedOrigin || origin;
            }
        }
        // Set credentials
        if (this.config.credentials) {
            headers["Access-Control-Allow-Credentials"] = "true";
        }
        // Set allowed methods
        if (this.config.allowedMethods && this.config.allowedMethods.length > 0) {
            headers["Access-Control-Allow-Methods"] = this.config.allowedMethods.join(", ");
        }
        // Set allowed headers
        if (this.config.allowedHeaders && this.config.allowedHeaders.length > 0) {
            headers["Access-Control-Allow-Headers"] =
                this.config.allowedHeaders.join(", ");
        }
        // Set exposed headers
        if (this.config.exposedHeaders && this.config.exposedHeaders.length > 0) {
            headers["Access-Control-Expose-Headers"] =
                this.config.exposedHeaders.join(", ");
        }
    }
    /**
     * Set preflight-specific headers
     */
    setPreflightHeaders(context) {
        if (!context.set.headers) {
            context.set.headers = {};
        }
        const { headers } = context.set;
        // Set max age for preflight cache
        if (this.config.maxAge !== undefined) {
            headers["Access-Control-Max-Age"] = this.config.maxAge.toString();
        }
        // Add Vary header for proper caching
        headers["Vary"] =
            "Origin, Access-Control-Request-Method, Access-Control-Request-Headers";
    }
    /**
     * Extract origin from request with proper null handling
     */
    extractOrigin(context) {
        const { headers } = context.request;
        // HTTP headers are case-insensitive, so check multiple cases
        const origin = headers["origin"] || headers["Origin"] || headers["ORIGIN"];
        return typeof origin === "string" ? origin : null;
    }
    /**
     * Validate origin format
     */
    isValidOriginFormat(origin) {
        try {
            new URL(origin);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Validate origin against configuration with detailed result
     */
    validateOrigin(origin) {
        if (!origin) {
            const wildcardAllowed = this.config.allowedOrigins === "*" || this.config.allowedOrigins === true;
            return {
                allowed: wildcardAllowed,
                matchedOrigin: wildcardAllowed ? "*" : undefined,
                reason: "no_origin_header",
            };
        }
        try {
            const { allowedOrigins } = this.config;
            if (allowedOrigins === true || allowedOrigins === "*") {
                return { allowed: true, matchedOrigin: "*" };
            }
            if (typeof allowedOrigins === "string") {
                const allowed = origin === allowedOrigins;
                return {
                    allowed,
                    matchedOrigin: allowed ? allowedOrigins : undefined,
                    reason: allowed ? "exact_match" : "no_match",
                };
            }
            if (Array.isArray(allowedOrigins)) {
                const matchedOrigin = allowedOrigins.find((allowed) => allowed === origin);
                return {
                    allowed: !!matchedOrigin,
                    matchedOrigin,
                    reason: matchedOrigin ? "array_match" : "not_in_array",
                };
            }
            if (typeof allowedOrigins === "function") {
                const allowed = allowedOrigins(origin);
                return {
                    allowed,
                    matchedOrigin: allowed ? origin : undefined,
                    reason: allowed ? "function_approved" : "function_rejected",
                };
            }
            return { allowed: false, reason: "invalid_config" };
        }
        catch (error) {
            this.logger.error("Origin validation error", { origin, error });
            return { allowed: false, reason: "validation_error" };
        }
    }
    /**
     * Handle CORS-related errors
     */
    async handleCorsError(error, context, origin) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        this.logger.error("CORS middleware error", {
            error: errorMessage,
            origin: origin || "null",
            path: context.request.url,
            requestId: this.getRequestId(context),
        });
        // Record specific error metrics based on error type
        let metricName = "cors_request_failure"; // Default fallback
        if (errorMessage === "Origin not allowed") {
            metricName = "cors_origin_rejected";
        }
        else if (errorMessage === "Method not allowed") {
            metricName = "cors_method_rejected";
        }
        else if (errorMessage === "Header not allowed") {
            metricName = "cors_header_rejected";
        }
        else if (errorMessage === "Invalid origin format") {
            metricName = "cors_invalid_origin";
        }
        await this.recordMetric(metricName, 1, {
            error_type: error instanceof Error ? error.constructor.name : "unknown",
            origin: origin || "null",
        });
    }
    /**
     * Record CORS-specific metrics
     */
    async recordCorsMetrics(action, validationResult, additionalTags = {}) {
        await this.recordMetric(`cors_${action}`, 1, {
            allowed: validationResult.allowed.toString(),
            reason: validationResult.reason || "unknown",
            ...additionalTags,
        });
    }
    /**
     * Validate configuration on instantiation
     */
    validateConfiguration() {
        const { allowedMethods, allowedHeaders, exposedHeaders, maxAge, optionsSuccessStatus, credentials, allowedOrigins, } = this.config;
        if (allowedMethods && allowedMethods.length === 0) {
            throw new Error("CORS methods array cannot be empty");
        }
        if (allowedHeaders?.some((header) => !header.trim())) {
            throw new Error("CORS allowed headers cannot contain empty strings");
        }
        if (exposedHeaders?.some((header) => !header.trim())) {
            throw new Error("CORS exposed headers cannot contain empty strings");
        }
        if (maxAge !== undefined && (maxAge < 0 || !Number.isInteger(maxAge))) {
            throw new Error("CORS maxAge must be a non-negative integer");
        }
        if (optionsSuccessStatus !== undefined &&
            (optionsSuccessStatus < 200 || optionsSuccessStatus >= 300)) {
            throw new Error("CORS optionsSuccessStatus must be between 200 and 299");
        }
        // Validate credentials with wildcard origin
        if (credentials && (allowedOrigins === "*" || allowedOrigins === true)) {
            throw new Error("Cannot use credentials with wildcard origin");
        }
    }
    /**
     * Create development configuration preset
     */
    static createDevelopmentConfig() {
        return {
            name: "cors-dev",
            allowedOrigins: "*",
            credentials: true,
            allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
            allowedHeaders: ["*"],
            maxAge: 0, // Disable preflight caching in development
            enabled: true,
            priority: DEFAULT_CORS_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create production configuration preset
     */
    static createProductionConfig(allowedOrigins) {
        return {
            name: "cors-prod",
            allowedOrigins: [...allowedOrigins],
            credentials: true,
            allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
            allowedHeaders: [
                "Content-Type",
                "Authorization",
                "X-Requested-With",
                "X-API-Key",
            ],
            exposedHeaders: ["X-Total-Count", "X-Rate-Limit-Remaining"],
            maxAge: DEFAULT_CORS_OPTIONS.MAX_AGE,
            enabled: true,
            priority: DEFAULT_CORS_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create API-specific configuration preset
     */
    static createApiConfig() {
        return {
            name: "cors-api",
            allowedOrigins: true,
            credentials: false,
            allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
            allowedHeaders: ["Content-Type", "X-API-Key"],
            maxAge: DEFAULT_CORS_OPTIONS.MAX_AGE,
            enabled: true,
            priority: DEFAULT_CORS_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create strict security configuration preset
     */
    static createStrictConfig(allowedOrigins) {
        return {
            name: "cors-strict",
            allowedOrigins,
            credentials: true,
            allowedMethods: ["GET", "POST"], // Minimal methods
            allowedHeaders: ["Content-Type", "Authorization"],
            maxAge: 3600, // 1 hour cache
            enabled: true,
            priority: DEFAULT_CORS_OPTIONS.PRIORITY,
        };
    }
}
/**
 * Factory function for CORS middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export function createCorsHttpMiddleware(metrics, config) {
    return new CorsHttpMiddleware(metrics, config);
}
/**
 * Preset configurations for common CORS scenarios
 * Immutable configuration objects for different environments
 */
export const CORS_PRESETS = {
    development: () => CorsHttpMiddleware.createDevelopmentConfig(),
    production: (origins) => CorsHttpMiddleware.createProductionConfig(origins),
    api: () => CorsHttpMiddleware.createApiConfig(),
    strict: (origins) => CorsHttpMiddleware.createStrictConfig(origins),
    websocket: (origins) => ({
        name: "cors-websocket",
        allowedOrigins: [...origins],
        credentials: true,
        allowedMethods: ["GET"],
        allowedHeaders: ["Content-Type", "Authorization", "Upgrade", "Connection"],
        maxAge: DEFAULT_CORS_OPTIONS.MAX_AGE,
        enabled: true,
        priority: DEFAULT_CORS_OPTIONS.PRIORITY,
    }),
    graphql: (origins) => ({
        name: "cors-graphql",
        allowedOrigins: [...origins],
        credentials: true,
        allowedMethods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-Requested-With",
            "Apollo-Require-Preflight",
        ],
        exposedHeaders: ["X-Total-Count"],
        maxAge: DEFAULT_CORS_OPTIONS.MAX_AGE,
        enabled: true,
        priority: DEFAULT_CORS_OPTIONS.PRIORITY,
    }),
};
//# sourceMappingURL=cors.http.middleware.js.map