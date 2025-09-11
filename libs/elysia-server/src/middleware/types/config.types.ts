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
 * Security configuration
 */
export interface SecurityConfig extends MiddlewareOptions {
  enableHelmet?: boolean;
  rateLimiting?: boolean;
  contentSecurityPolicy?: Record<string, any>;
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
 * Advanced middleware configuration for the server
 */
export interface AdvancedMiddlewareConfig {
  // HTTP/WebSocket chain enablement
  http?: {
    enabled?: boolean;
    factoryPattern?: "PRODUCTION_HTTP" | "BASIC_HTTP_SECURITY" | "DEVELOPMENT";
  };
  websocket?: {
    enabled?: boolean;
    factoryPattern?: "PRODUCTION_WS" | "BASIC_WS_SECURITY" | "DEVELOPMENT";
  };

  // Custom middleware chains
  customHttpChain?: any[]; // HttpChainItem[] - avoiding circular dependency
  customWsChain?: any[]; // WebSocketChainItem[] - avoiding circular dependency

  // Individual middleware configs with config property
  auth?: AuthConfig & { config?: any };
  cors?: CorsConfig & { config?: any };
  rateLimit?: MiddlewareOptions & { config?: any };
  security?: SecurityConfig & { config?: any };
  logging?: LoggingConfig & { config?: any };
  prometheus?: PrometheusConfig & { config?: any };
  metrics?: PrometheusConfig & { config?: any }; // alias for prometheus
  error?: ErrorConfig & { config?: any };
  audit?: AuditConfig & { config?: any };
  validation?: ValidationConfig & { config?: any };
}
