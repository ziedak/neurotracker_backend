/**
 * Base configuration for all middleware
 */
export interface MiddlewareOptions {
    enabled?: boolean;
    priority?: number;
    skipPaths?: string[];
    name?: string;
}
/**
 * Authentication configuration
 */
export interface AuthConfig extends MiddlewareOptions {
    apiKeys?: Set<string>;
    jwtSecret?: string;
    requiredRoles?: string[];
    requiredPermissions?: string[];
    allowAnonymous?: boolean;
    bypassRoutes?: string[];
    tokenExpiry?: number;
}
/**
 * Rate limiting configuration
 */
/**
 * Validation configuration with strict typing
 */
export interface ValidationConfig extends MiddlewareOptions {
    engine: "zod" | "rules";
    schemas?: Record<string, unknown>;
    maxRequestSize?: number;
    sanitizeInputs?: boolean;
    strictMode?: boolean;
    validateBody?: boolean;
    validateQuery?: boolean;
    validateParams?: boolean;
}
/**
 * Audit configuration with strict storage typing
 */
export interface AuditConfig extends MiddlewareOptions {
    enableDetailedLogging?: boolean;
    logRequestBodies?: boolean;
    logResponseBodies?: boolean;
    maxEventHistory?: number;
    sensitiveFields?: string[];
    storage?: {
        redis?: {
            enabled: boolean;
            ttl?: number;
        };
        clickhouse?: {
            enabled: boolean;
            table?: string;
        };
        memory?: {
            enabled: boolean;
            maxEvents?: number;
        };
    };
}
/**
 * Request logging configuration
 */
export interface LoggingConfig extends MiddlewareOptions {
    logLevel: "debug" | "info" | "warn" | "error";
    logRequestBody?: boolean;
    logResponseBody?: boolean;
    logHeaders?: boolean;
    maskSensitiveFields?: boolean;
    sensitiveFields?: string[];
    includeUserInfo?: boolean;
}
/**
 * Error handling configuration with proper error mapping
 */
export interface ErrorConfig extends MiddlewareOptions {
    includeStack?: boolean;
    logErrors?: boolean;
    exposeInternalErrors?: boolean;
    customErrorMapper?: (error: Error) => unknown;
}
/**
 * CORS configuration
 */
export interface CorsConfig extends MiddlewareOptions {
    origin?: string | string[] | boolean;
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    credentials?: boolean;
    maxAge?: number;
    optionsSuccessStatus?: number;
}
/**
 * Security configuration with proper CSP typing
 */
export interface SecurityConfig extends MiddlewareOptions {
    enableHelmet?: boolean;
    rateLimiting?: boolean;
    contentSecurityPolicy?: Record<string, unknown>;
    xssProtection?: boolean;
    noSniff?: boolean;
    frameguard?: boolean;
}
/**
 * Prometheus/Metrics configuration
 */
export interface PrometheusConfig extends MiddlewareOptions {
    enableHistogram?: boolean;
    enableCounter?: boolean;
    enableGauge?: boolean;
    customLabels?: Record<string, string>;
    buckets?: number[];
}
/**
 * Advanced middleware configuration for the server with strict typing
 */
export interface AdvancedMiddlewareConfig {
    http?: {
        enabled?: boolean;
        factoryPattern?: "PRODUCTION_HTTP" | "BASIC_HTTP_SECURITY" | "DEVELOPMENT";
    };
    websocket?: {
        enabled?: boolean;
        factoryPattern?: "PRODUCTION_WS" | "BASIC_WS_SECURITY" | "DEVELOPMENT";
    };
    customHttpChain?: unknown[];
    customWsChain?: unknown[];
    auth?: AuthConfig & {
        config?: Record<string, unknown>;
    };
    cors?: CorsConfig & {
        config?: Record<string, unknown>;
    };
    rateLimit?: MiddlewareOptions & {
        config?: Record<string, unknown>;
    };
    security?: SecurityConfig & {
        config?: Record<string, unknown>;
    };
    logging?: LoggingConfig & {
        config?: Record<string, unknown>;
    };
    prometheus?: PrometheusConfig & {
        config?: Record<string, unknown>;
    };
    metrics?: PrometheusConfig & {
        config?: Record<string, unknown>;
    };
    error?: ErrorConfig & {
        config?: Record<string, unknown>;
    };
    audit?: AuditConfig & {
        config?: Record<string, unknown>;
    };
    validation?: ValidationConfig & {
        config?: Record<string, unknown>;
    };
}
//# sourceMappingURL=config.types.d.ts.map