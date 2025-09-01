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
 * Validation configuration
 */
export interface ValidationConfig extends MiddlewareOptions {
  engine: "zod" | "rules";
  schemas?: Record<string, any>;
  maxRequestSize?: number;
  sanitizeInputs?: boolean;
  strictMode?: boolean;
  validateBody?: boolean;
  validateQuery?: boolean;
  validateParams?: boolean;
}

/**
 * Audit configuration
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
 * Error handling configuration
 */
export interface ErrorConfig extends MiddlewareOptions {
  includeStack?: boolean;
  logErrors?: boolean;
  exposeInternalErrors?: boolean;
  customErrorMapper?: (error: Error) => any;
}
