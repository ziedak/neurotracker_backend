// Export all types
export * from "./types";

// Export base classes
export * from "./base";

// Export Casbin authorization middleware
export * from "./casbin";

// Export WebSocket middleware
export { BaseWebSocketMiddleware } from "./websocket/BaseWebSocketMiddleware";
export {
  WebSocketAuthMiddleware,
  type WebSocketSessionContext,
} from "./websocket/WebSocketAuthMiddleware";
export { WebSocketRateLimitMiddleware } from "./websocket/WebSocketRateLimitMiddleware";
export {
  WebSocketSessionSynchronizer,
  type SessionUpdateEvent,
  type SessionSyncEvents,
  type WebSocketConnection,
} from "./websocket/WebSocketSessionSynchronizer";
export {
  WebSocketMiddlewareChain,
  MiddlewarePriority,
  type MiddlewareConfig,
  type CircuitBreakerConfig,
  type RetryConfig,
} from "./websocket/WebSocketMiddlewareChain";
export {
  WebSocketMiddlewareChainFactory,
  type WebSocketMiddlewareChainConfig,
  WEBSOCKET_CHAIN_PRESETS,
} from "./websocket/WebSocketMiddlewareChainFactory";

// Export auth middleware (legacy)
export * from "./authv1";

// Export modern auth middleware (Oslo-based)
export {
  AuthService,
  UserAuthService,
  ElysiaAuthMiddleware,
  createAuthPlugin,
  authGuards,
  PasswordUtils,
  DEFAULT_PASSWORD_REQUIREMENTS,
  SessionInvalidReason,
  AuthEvent,
} from "./auth";

export type {
  AuthConfig as ModernAuthConfig,
  AuthUser as ModernAuthUser,
  AuthContext as ModernAuthContext,
  LoginCredentials,
  SessionCreateOptions,
  SessionValidationResult,
  SessionTokenPayload,
  AuthAuditEntry,
  PasswordRequirements,
  CookieOptions as ModernCookieOptions,
  RateLimitConfig as ModernRateLimitConfig,
  SecurityHeaders,
  MFAConfig,
  PermissionCheckResult,
  AuthMiddlewareConfig,
} from "./auth";

// Export rate limiting middleware
export * from "./rateLimit";

// Export validation middleware
export * from "./validation";

// Export CORS middleware
export * from "./cors/cors.middleware";

// Export security middleware
export * from "./security/security.middleware";

// Export Keycloak authentication middleware
export * from "./keycloak";

import { Logger, MetricsCollector } from "@libs/monitoring";
import { RedisClient, ClickHouseClient } from "@libs/database";
import {
  AuthConfig,
  RateLimitConfig,
  ValidationConfig,
  WebSocketAuthConfig,
  WebSocketRateLimitConfig,
} from "./types";
import { AuthMiddleware } from "./authv1";
import { RateLimitMiddleware } from "./rateLimit";
import { ValidationMiddleware } from "./validation";
import { LoggingMiddleware, LoggingConfig } from "./logging/logging.middleware";
import { ErrorMiddleware, ErrorConfig } from "./error/error.middleware";
import { AuditMiddleware, AuditConfig } from "./audit/audit.middleware";
import { CorsMiddleware, CorsConfig } from "./cors/cors.middleware";
import {
  SecurityMiddleware,
  SecurityConfig,
} from "./security/security.middleware";
import { WebSocketAuthMiddleware } from "./websocket/WebSocketAuthMiddleware";
import { WebSocketRateLimitMiddleware } from "./websocket/WebSocketRateLimitMiddleware";

/**
 * Factory functions for quick middleware creation
 */
export const createAuthMiddleware = (config: AuthConfig) => {
  const logger = Logger.getInstance("AuthMiddleware");
  const metrics = MetricsCollector.getInstance();
  return new AuthMiddleware(config, logger, metrics).elysia();
};

export const createRateLimitMiddleware = (config: RateLimitConfig) => {
  const logger = Logger.getInstance("RateLimitMiddleware");
  const metrics = MetricsCollector.getInstance();
  return new RateLimitMiddleware(config, logger, metrics).elysia();
};

export const createValidationMiddleware = (config: ValidationConfig) => {
  const logger = Logger.getInstance("ValidationMiddleware");
  const metrics = MetricsCollector.getInstance();
  return new ValidationMiddleware(config, logger, metrics).elysia();
};

export const createLoggingMiddleware = (config?: LoggingConfig) => {
  const logger = Logger.getInstance("Shared Logging Middleware");
  const middleware = new LoggingMiddleware(logger);
  return middleware.elysia(config);
};

export const createErrorMiddleware = (config?: ErrorConfig) => {
  const logger = Logger.getInstance("Shared Error Middleware");
  const middleware = new ErrorMiddleware(logger);
  return middleware.elysia(config);
};

export const createAuditMiddleware = (config?: AuditConfig) => {
  const redis = RedisClient.getInstance();
  const clickhouse = ClickHouseClient.getInstance();
  const logger = Logger.getInstance("Shared Audit Middleware");
  const metrics = MetricsCollector.getInstance();

  const middleware = new AuditMiddleware(redis, clickhouse, logger, metrics);
  return middleware.elysia(config);
};

export const createCorsMiddleware = (config?: CorsConfig) => {
  const middleware = new CorsMiddleware(config);
  return middleware.elysia();
};

export const createSecurityMiddleware = (config?: SecurityConfig) => {
  const middleware = new SecurityMiddleware(config);
  return middleware.elysia();
};

export const createKeycloakMiddleware = (config: import("./keycloak/types").KeycloakMiddlewareOptions) => {
  const logger = Logger.getInstance("KeycloakMiddleware");
  const metrics = MetricsCollector.getInstance();
  const { KeycloakMiddleware } = require("./keycloak/middleware");
  return new KeycloakMiddleware(config, logger, metrics).plugin();
};

/**
 * WebSocket middleware factory functions
 */
export const createWebSocketAuthMiddleware = (
  config: WebSocketAuthConfig,
  sessionManager?: any // Import type if needed, for now use any to avoid circular dependency
) => {
  if (!sessionManager) {
    throw new Error(
      "UnifiedSessionManager is required for WebSocket authentication middleware"
    );
  }

  const logger = Logger.getInstance("WSAuthMiddleware");
  const metrics = MetricsCollector.getInstance();
  return WebSocketAuthMiddleware.create(
    config,
    sessionManager,
    logger,
    metrics
  );
};

export const createWebSocketRateLimitMiddleware = (
  config: WebSocketRateLimitConfig
) => {
  const logger = Logger.getInstance("WSRateLimitMiddleware");
  const metrics = MetricsCollector.getInstance();
  return WebSocketRateLimitMiddleware.create(config, logger, metrics);
};

/**
 * Casbin middleware factory function
 */
export const createCasbinMiddleware = (
  config: Partial<import("./casbin/types").CasbinConfig>,
  prisma: any,
  redis?: any
) => {
  const logger = Logger.getInstance("CasbinMiddleware");
  const metrics = MetricsCollector.getInstance();

  return import("./casbin/factory").then(
    ({ createCasbinMiddleware: factory }) =>
      factory(config, prisma, logger, metrics, redis)
  );
};

/**
 * Common configurations for different services
 */
export const commonConfigs = {
  auth: {
    apiGateway: {
      allowAnonymous: true,
      bypassRoutes: ["/health", "/metrics", "/docs", "/swagger"],
      skipPaths: ["/health", "/metrics"],
    } as AuthConfig,

    aiEngine: {
      requiredPermissions: ["predict"],
      apiKeys: new Set(["ai-engine-key-prod-2024", "ai-engine-key-dev-2024"]),
      bypassRoutes: ["/health", "/metrics"],
    } as AuthConfig,

    dataIntelligence: {
      requiredRoles: ["user", "admin"],
      bypassRoutes: ["/health", "/metrics"],
    } as AuthConfig,

    eventPipeline: {
      requiredPermissions: ["event_ingest"],
      bypassRoutes: ["/health", "/metrics"],
      allowAnonymous: false,
    } as AuthConfig,
  },

  rateLimit: {
    general: {
      windowMs: 60000,
      maxRequests: 1000,
      keyStrategy: "ip" as const,
      standardHeaders: true,
    } as RateLimitConfig,

    strict: {
      windowMs: 60000,
      maxRequests: 100,
      keyStrategy: "user" as const,
      standardHeaders: true,
    } as RateLimitConfig,

    api: {
      windowMs: 60000,
      maxRequests: 5000,
      keyStrategy: "apiKey" as const,
      standardHeaders: true,
    } as RateLimitConfig,

    aiPrediction: {
      windowMs: 60000,
      maxRequests: 1000,
      keyStrategy: "user" as const,
      skipFailedRequests: true,
      standardHeaders: true,
    } as RateLimitConfig,

    dataExport: {
      windowMs: 300000, // 5 minutes
      maxRequests: 50,
      keyStrategy: "user" as const,
      standardHeaders: true,
    } as RateLimitConfig,
  },

  validation: {
    aiEngine: {
      engine: "zod" as const,
      strictMode: true,
      sanitizeInputs: true,
      maxRequestSize: 1024 * 1024,
      validateBody: true,
      validateQuery: true,
    } as ValidationConfig,

    dataIntelligence: {
      engine: "rules" as const,
      strictMode: true,
      sanitizeInputs: true,
      maxRequestSize: 10 * 1024 * 1024,
      validateBody: true,
      validateQuery: true,
      validateParams: true,
    } as ValidationConfig,

    eventPipeline: {
      engine: "zod" as const,
      strictMode: false,
      sanitizeInputs: false,
      maxRequestSize: 5 * 1024 * 1024,
      validateBody: true,
    } as ValidationConfig,

    apiGateway: {
      engine: "rules" as const,
      strictMode: false,
      sanitizeInputs: false,
      maxRequestSize: 2 * 1024 * 1024,
      validateQuery: true,
    } as ValidationConfig,
  },

  logging: {
    development: {
      logLevel: "debug" as const,
      logRequestBody: true,
      logResponseBody: true,
      logHeaders: true,
      excludePaths: ["/health"],
      maxBodySize: 1024 * 50, // 50KB
    } as LoggingConfig,

    production: {
      logLevel: "info" as const,
      logRequestBody: false,
      logResponseBody: false,
      logHeaders: false,
      excludePaths: ["/health", "/metrics", "/favicon.ico"],
      maxBodySize: 1024 * 5, // 5KB
    } as LoggingConfig,

    audit: {
      logLevel: "info" as const,
      logRequestBody: true,
      logResponseBody: true,
      logHeaders: true,
      excludePaths: [],
      maxBodySize: 1024 * 100, // 100KB
    } as LoggingConfig,
  },

  error: {
    development: {
      includeStackTrace: true,
      logErrors: true,
      customErrorMessages: {},
    } as ErrorConfig,

    production: {
      includeStackTrace: false,
      logErrors: true,
      customErrorMessages: {
        ValidationError: "Invalid request data",
        AuthenticationError: "Authentication required",
        AuthorizationError: "Access denied",
        NotFoundError: "Resource not found",
        RateLimitError: "Rate limit exceeded",
        DatabaseError: "Service temporarily unavailable",
        NetworkError: "Service temporarily unavailable",
      },
    } as ErrorConfig,
  },

  audit: {
    development: {
      includeBody: true,
      includeResponse: true,
      storageStrategy: "redis" as const,
      redisTtl: 3600, // 1 hour
      maxBodySize: 1024 * 50, // 50KB
    } as AuditConfig,

    production: {
      includeBody: false,
      includeResponse: false,
      storageStrategy: "both" as const,
      redisTtl: 7 * 24 * 3600, // 7 days
      maxBodySize: 1024 * 5, // 5KB
    } as AuditConfig,

    gdpr: {
      includeBody: true,
      includeResponse: true,
      storageStrategy: "both" as const,
      redisTtl: 30 * 24 * 3600, // 30 days
      maxBodySize: 1024 * 100, // 100KB
      skipRoutes: [], // Audit everything for GDPR
    } as AuditConfig,
  },

  cors: {
    development: {
      origin: "*",
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
      allowedHeaders: ["*"],
    } as CorsConfig,

    production: {
      origin: ["https://yourdomain.com", "https://api.yourdomain.com"],
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-API-Key",
      ],
      exposedHeaders: ["X-Total-Count", "X-Rate-Limit-Remaining"],
      maxAge: 86400,
    } as CorsConfig,

    api: {
      origin: true,
      credentials: false,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "X-API-Key"],
      maxAge: 86400,
    } as CorsConfig,
  },

  security: {
    development: {
      contentSecurityPolicy: { enabled: false },
      hsts: { enabled: false },
      frameOptions: "SAMEORIGIN",
      noSniff: true,
      xssFilter: true,
      referrerPolicy: "no-referrer-when-downgrade",
    } as SecurityConfig,

    production: {
      contentSecurityPolicy: {
        enabled: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https:"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "upgrade-insecure-requests": [],
        },
      },
      hsts: {
        enabled: true,
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      frameOptions: "DENY",
      noSniff: true,
      xssFilter: { mode: "block" },
      referrerPolicy: "strict-origin-when-cross-origin",
      permissionsPolicy: {
        camera: ["'none'"],
        microphone: ["'none'"],
        geolocation: ["'none'"],
        payment: ["'none'"],
      },
    } as SecurityConfig,

    api: {
      contentSecurityPolicy: { enabled: false },
      hsts: { enabled: true, maxAge: 31536000, includeSubDomains: true },
      frameOptions: "DENY",
      noSniff: true,
      xssFilter: false,
      referrerPolicy: "no-referrer",
      customHeaders: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    } as SecurityConfig,
  },
};

/**
 * Middleware presets for specific services
 */
export const servicePresets = {
  apiGateway: (overrides?: {
    auth?: Partial<AuthConfig>;
    rateLimit?: Partial<RateLimitConfig>;
    validation?: Partial<ValidationConfig>;
    logging?: Partial<LoggingConfig>;
    error?: Partial<ErrorConfig>;
    audit?: Partial<AuditConfig>;
    cors?: Partial<CorsConfig>;
    security?: Partial<SecurityConfig>;
  }) => ({
    cors: createCorsMiddleware({
      ...commonConfigs.cors.production,
      ...overrides?.cors,
    }),
    security: createSecurityMiddleware({
      ...commonConfigs.security.api,
      ...overrides?.security,
    }),
    auth: createAuthMiddleware({
      ...commonConfigs.auth.apiGateway,
      ...overrides?.auth,
    }),
    rateLimit: createRateLimitMiddleware({
      ...commonConfigs.rateLimit.general,
      ...overrides?.rateLimit,
    }),
    validation: createValidationMiddleware({
      ...commonConfigs.validation.apiGateway,
      ...overrides?.validation,
    }),
    logging: createLoggingMiddleware({
      ...commonConfigs.logging.production,
      ...overrides?.logging,
    }),
    error: createErrorMiddleware({
      ...commonConfigs.error.production,
      ...overrides?.error,
    }),
    audit: createAuditMiddleware({
      ...commonConfigs.audit.production,
      ...overrides?.audit,
    }),
  }),

  aiEngine: (overrides?: {
    auth?: Partial<AuthConfig>;
    rateLimit?: Partial<RateLimitConfig>;
    validation?: Partial<ValidationConfig>;
    logging?: Partial<LoggingConfig>;
    error?: Partial<ErrorConfig>;
    audit?: Partial<AuditConfig>;
    cors?: Partial<CorsConfig>;
    security?: Partial<SecurityConfig>;
  }) => ({
    cors: createCorsMiddleware({
      ...commonConfigs.cors.api,
      ...overrides?.cors,
    }),
    security: createSecurityMiddleware({
      ...commonConfigs.security.api,
      ...overrides?.security,
    }),
    auth: createAuthMiddleware({
      ...commonConfigs.auth.aiEngine,
      ...overrides?.auth,
    }),
    rateLimit: createRateLimitMiddleware({
      ...commonConfigs.rateLimit.aiPrediction,
      ...overrides?.rateLimit,
    }),
    validation: createValidationMiddleware({
      ...commonConfigs.validation.aiEngine,
      ...overrides?.validation,
    }),
    logging: createLoggingMiddleware({
      ...commonConfigs.logging.production,
      ...overrides?.logging,
    }),
    error: createErrorMiddleware({
      ...commonConfigs.error.production,
      ...overrides?.error,
    }),
    audit: createAuditMiddleware({
      ...commonConfigs.audit.production,
      ...overrides?.audit,
    }),
  }),

  dataIntelligence: (overrides?: {
    auth?: Partial<AuthConfig>;
    rateLimit?: Partial<RateLimitConfig>;
    validation?: Partial<ValidationConfig>;
    logging?: Partial<LoggingConfig>;
    error?: Partial<ErrorConfig>;
    audit?: Partial<AuditConfig>;
    cors?: Partial<CorsConfig>;
    security?: Partial<SecurityConfig>;
  }) => ({
    cors: createCorsMiddleware({
      ...commonConfigs.cors.production,
      ...overrides?.cors,
    }),
    security: createSecurityMiddleware({
      ...commonConfigs.security.production,
      ...overrides?.security,
    }),
    auth: createAuthMiddleware({
      ...commonConfigs.auth.dataIntelligence,
      ...overrides?.auth,
    }),
    rateLimit: createRateLimitMiddleware({
      ...commonConfigs.rateLimit.strict,
      ...overrides?.rateLimit,
    }),
    validation: createValidationMiddleware({
      ...commonConfigs.validation.dataIntelligence,
      ...overrides?.validation,
    }),
    logging: createLoggingMiddleware({
      ...commonConfigs.logging.audit,
      ...overrides?.logging,
    }),
    error: createErrorMiddleware({
      ...commonConfigs.error.production,
      ...overrides?.error,
    }),
    audit: createAuditMiddleware({
      ...commonConfigs.audit.gdpr,
      ...overrides?.audit,
    }),
  }),

  eventPipeline: (overrides?: {
    auth?: Partial<AuthConfig>;
    rateLimit?: Partial<RateLimitConfig>;
    validation?: Partial<ValidationConfig>;
    logging?: Partial<LoggingConfig>;
    error?: Partial<ErrorConfig>;
    audit?: Partial<AuditConfig>;
    cors?: Partial<CorsConfig>;
    security?: Partial<SecurityConfig>;
  }) => ({
    cors: createCorsMiddleware({
      ...commonConfigs.cors.api,
      ...overrides?.cors,
    }),
    security: createSecurityMiddleware({
      ...commonConfigs.security.api,
      ...overrides?.security,
    }),
    auth: createAuthMiddleware({
      ...commonConfigs.auth.eventPipeline,
      ...overrides?.auth,
    }),
    rateLimit: createRateLimitMiddleware({
      ...commonConfigs.rateLimit.general,
      ...overrides?.rateLimit,
    }),
    validation: createValidationMiddleware({
      ...commonConfigs.validation.eventPipeline,
      ...overrides?.validation,
    }),
    logging: createLoggingMiddleware({
      ...commonConfigs.logging.production,
      ...overrides?.logging,
    }),
    error: createErrorMiddleware({
      ...commonConfigs.error.production,
      ...overrides?.error,
    }),
    audit: createAuditMiddleware({
      ...commonConfigs.audit.production,
      ...overrides?.audit,
    }),
  }),
};

/**
 * Quick setup functions for common middleware combinations
 */
export const quickSetup = {
  /**
   * Basic setup with auth and rate limiting
   */
  basic: (service: keyof typeof servicePresets) => {
    const preset = servicePresets[service]();
    return [preset.auth, preset.rateLimit];
  },

  /**
   * Full setup with all middleware (recommended)
   */
  full: (service: keyof typeof servicePresets) => {
    const preset = servicePresets[service]();
    return [
      preset.cors,
      preset.security,
      preset.auth,
      preset.rateLimit,
      preset.validation,
      preset.logging,
      preset.error,
      preset.audit,
    ];
  },

  /**
   * Security-focused setup with strict settings and full audit
   */
  secure: (service: keyof typeof servicePresets) => {
    const preset = servicePresets[service]({
      auth: { allowAnonymous: false },
      rateLimit: { maxRequests: 100 },
      validation: { strictMode: true },
      logging: { logLevel: "warn", logRequestBody: false },
      error: { includeStackTrace: false },
      audit: { includeBody: true, includeResponse: true },
      cors: { origin: false, credentials: false },
      security: { ...commonConfigs.security.production },
    });
    return [
      preset.cors,
      preset.security,
      preset.auth,
      preset.rateLimit,
      preset.validation,
      preset.logging,
      preset.error,
      preset.audit,
    ];
  },

  /**
   * Development setup with relaxed settings and verbose logging
   */
  development: (service: keyof typeof servicePresets) => {
    const preset = servicePresets[service]({
      auth: { allowAnonymous: true },
      rateLimit: { maxRequests: 10000 },
      validation: { strictMode: false },
      logging: { ...commonConfigs.logging.development },
      error: { ...commonConfigs.error.development },
      audit: { ...commonConfigs.audit.development },
      cors: { ...commonConfigs.cors.development },
      security: { ...commonConfigs.security.development },
    });
    return [
      preset.cors,
      preset.security,
      preset.auth,
      preset.rateLimit,
      preset.validation,
      preset.logging,
      preset.error,
      preset.audit,
    ];
  },

  /**
   * Production setup with optimized settings
   */
  production: (service: keyof typeof servicePresets) => {
    const preset = servicePresets[service]({
      logging: { ...commonConfigs.logging.production },
      error: { ...commonConfigs.error.production },
      audit: { ...commonConfigs.audit.production },
      cors: { ...commonConfigs.cors.production },
      security: { ...commonConfigs.security.production },
    });
    return [
      preset.cors,
      preset.security,
      preset.auth,
      preset.rateLimit,
      preset.validation,
      preset.logging,
      preset.error,
      preset.audit,
    ];
  },

  /**
   * Minimal setup for high-performance scenarios
   */
  minimal: (service: keyof typeof servicePresets) => {
    const preset = servicePresets[service]({
      logging: {
        logLevel: "error",
        excludePaths: ["/health", "/metrics", "/static"],
      },
      error: { logErrors: false },
      audit: { storageStrategy: "redis", includeBody: false },
      cors: { origin: "*", credentials: false },
      security: {
        contentSecurityPolicy: { enabled: false },
        hsts: { enabled: false },
      },
    });
    return [preset.cors, preset.auth, preset.rateLimit, preset.error];
  },
};
