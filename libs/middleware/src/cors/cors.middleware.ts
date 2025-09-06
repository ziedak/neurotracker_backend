import { type ILogger, type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware } from "../base";
import type { MiddlewareContext, MiddlewareOptions } from "../types";

export interface CorsConfig extends MiddlewareOptions {
  origin?: string | string[] | boolean | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
}

/**
 * CORS Middleware
 * Cross-Origin Resource Sharing configuration for secure cross-domain requests
 * Production-ready implementation with comprehensive security options and monitoring
 */
export class CorsMiddleware extends BaseMiddleware<CorsConfig> {
  private readonly corsConfig: CorsConfig;

  constructor(
    logger: ILogger,
    metrics: IMetricsCollector,
    config: CorsConfig,
    name: string = "cors"
  ) {
    const defaultConfig: Partial<CorsConfig> = {
      origin: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-API-Key",
      ],
      exposedHeaders: ["X-Total-Count", "X-Rate-Limit-Remaining"],
      credentials: true,
      maxAge: 86400, // 24 hours
      optionsSuccessStatus: 204,
      enabled: true,
      priority: 0,
      skipPaths: [],
    };

    // Merge configs and pass to parent
    const finalConfig = { ...defaultConfig, ...config } as CorsConfig;
    super(logger, metrics, finalConfig, name);

    // Store merged config for CORS-specific operations
    this.corsConfig = finalConfig;
  }

  /**
   * Core CORS middleware execution logic
   */
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    const origin = context.request.headers["origin"];
    const method = context.request.method;

    this.logger.debug("Processing CORS request", {
      origin,
      method,
      path: context.request.url,
      requestId: context.requestId,
    });

    // Set CORS headers
    this.setCorsHeaders(context, origin);

    // Handle preflight requests
    if (method === "OPTIONS") {
      this.logger.debug("Handling CORS preflight request", {
        origin,
        requestId: context.requestId,
      });

      context.set.status = this.corsConfig.optionsSuccessStatus || 204;

      await this.recordMetric("cors_preflight_handled", 1, {
        origin: origin || "unknown",
        allowed: this.isOriginAllowed(
          origin || "",
          this.corsConfig.origin
        ).toString(),
      });

      // Don't call next() for preflight - return early
      return;
    }

    // Record CORS metrics
    await this.recordMetric("cors_request_processed", 1, {
      origin: origin || "unknown",
      method,
      allowed: this.isOriginAllowed(
        origin || "",
        this.corsConfig.origin
      ).toString(),
    });

    // Continue to next middleware/handler
    await next();
  }

  /**
   * Create new instance with different configuration
   */
  protected override createInstance(config: CorsConfig): CorsMiddleware {
    return new CorsMiddleware(this.metrics, config, this.name);
  }

  /**
   * Set CORS headers based on configuration
   */
  private setCorsHeaders(context: MiddlewareContext, origin?: string): void {
    // Handle origin
    if (this.isOriginAllowed(origin || "", this.corsConfig.origin)) {
      context.set.headers = context.set.headers || {};
      context.set.headers["Access-Control-Allow-Origin"] = origin || "*";
    }

    // Allow credentials
    if (this.corsConfig.credentials) {
      context.set.headers = context.set.headers || {};
      context.set.headers["Access-Control-Allow-Credentials"] = "true";
    }

    // Allow methods
    if (this.corsConfig.methods && this.corsConfig.methods.length > 0) {
      context.set.headers = context.set.headers || {};
      context.set.headers["Access-Control-Allow-Methods"] =
        this.corsConfig.methods.join(", ");
    }

    // Allow headers
    if (
      this.corsConfig.allowedHeaders &&
      this.corsConfig.allowedHeaders.length > 0
    ) {
      context.set.headers = context.set.headers || {};
      context.set.headers["Access-Control-Allow-Headers"] =
        this.corsConfig.allowedHeaders.join(", ");
    }

    // Expose headers
    if (
      this.corsConfig.exposedHeaders &&
      this.corsConfig.exposedHeaders.length > 0
    ) {
      context.set.headers = context.set.headers || {};
      context.set.headers["Access-Control-Expose-Headers"] =
        this.corsConfig.exposedHeaders.join(", ");
    }

    // Max age for preflight
    if (this.corsConfig.maxAge) {
      context.set.headers = context.set.headers || {};
      context.set.headers["Access-Control-Max-Age"] =
        this.corsConfig.maxAge.toString();
    }
  }

  /**
   * Check if origin is allowed
   */
  private isOriginAllowed(
    origin: string,
    allowedOrigin: CorsConfig["origin"]
  ): boolean {
    if (!origin || !allowedOrigin) return false;

    if (allowedOrigin === true || allowedOrigin === "*") {
      return true;
    }

    if (typeof allowedOrigin === "string") {
      return origin === allowedOrigin;
    }

    if (Array.isArray(allowedOrigin)) {
      return allowedOrigin.includes(origin);
    }

    if (typeof allowedOrigin === "function") {
      return allowedOrigin(origin);
    }

    return false;
  }

  /**
   * Create preset configurations
   */
  static createDevelopmentConfig(): CorsConfig {
    return {
      origin: "*",
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
      allowedHeaders: ["*"],
    };
  }

  static createProductionConfig(allowedOrigins: string[]): CorsConfig {
    return {
      origin: allowedOrigins,
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
    };
  }

  static createApiConfig(): CorsConfig {
    return {
      origin: true,
      credentials: false,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "X-API-Key"],
      maxAge: 86400,
    };
  }

  static createStrictConfig(allowedOrigins: string[]): CorsConfig {
    return {
      origin: allowedOrigins,
      credentials: true,
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 3600, // 1 hour
    };
  }
}

/**
 * Factory function for easy middleware creation
 */
export function createCorsMiddleware(config: CorsConfig = {}) {
  const { Logger, MetricsCollector } = require("@libs/monitoring");
  const logger = Logger.getInstance("CorsMiddleware");
  const metrics = MetricsCollector.getInstance();

  const middleware = new CorsMiddleware(logger, metrics, config);
  return middleware.elysia();
}

/**
 * Alternative factory function that returns the middleware instance
 * Useful when you need access to the middleware methods
 */
export function createCorsMiddlewareInstance(config: CorsConfig = {}) {
  const { Logger, MetricsCollector } = require("@libs/monitoring");
  const logger = Logger.getInstance("CorsMiddleware");
  const metrics = MetricsCollector.getInstance();

  return new CorsMiddleware(logger, metrics, config);
}

/**
 * Preset configurations for common use cases
 */
export const corsPresets = {
  /**
   * Development configuration - permissive settings for local development
   */
  development: (): CorsConfig => CorsMiddleware.createDevelopmentConfig(),

  /**
   * Production configuration - secure settings for production environments
   */
  production: (allowedOrigins: string[]): CorsConfig =>
    CorsMiddleware.createProductionConfig(allowedOrigins),

  /**
   * API configuration - settings optimized for REST APIs
   */
  api: (): CorsConfig => CorsMiddleware.createApiConfig(),

  /**
   * Strict configuration - highly restrictive settings for sensitive applications
   */
  strict: (allowedOrigins: string[]): CorsConfig =>
    CorsMiddleware.createStrictConfig(allowedOrigins),

  /**
   * WebSocket configuration - settings for WebSocket applications
   */
  websocket: (allowedOrigins: string[]): CorsConfig => ({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "Authorization", "Upgrade", "Connection"],
    maxAge: 86400,
  }),

  /**
   * GraphQL configuration - settings optimized for GraphQL endpoints
   */
  graphql: (allowedOrigins: string[]): CorsConfig => ({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Apollo-Require-Preflight",
    ],
    exposedHeaders: ["X-Total-Count"],
    maxAge: 86400,
  }),
};

/**
 * Usage examples for the CORS middleware
 */
export const corsExamples = {
  /**
   * Basic usage with Elysia
   */
  basic: `
import { Elysia } from 'elysia';
import { createCorsMiddleware } from '@libs/middleware';

const app = new Elysia()
  .use(createCorsMiddleware({
    origin: ["https://myapp.com", "https://admin.myapp.com"],
    credentials: true
  }))
  .get('/', () => 'Hello World');
  `,

  /**
   * Using presets for different environments
   */
  presets: `
import { Elysia } from 'elysia';
import { createCorsMiddlewareInstance, corsPresets } from '@libs/middleware';

// Development
const devCors = createCorsMiddlewareInstance(corsPresets.development());
app.use(devCors.elysia());

// Production
const prodCors = createCorsMiddlewareInstance(
  corsPresets.production(["https://myapp.com"])
);
app.use(prodCors.elysia());

// API-specific
const apiCors = createCorsMiddlewareInstance(corsPresets.api());
app.use(apiCors.elysia());
  `,

  /**
   * Advanced usage with custom origin validation
   */
  advanced: `
import { Elysia } from 'elysia';
import { createCorsMiddlewareInstance } from '@libs/middleware';

const cors = createCorsMiddlewareInstance({
  origin: (origin) => {
    // Custom origin validation logic
    const allowedDomains = ['.mycompany.com', '.myapp.io'];
    return allowedDomains.some(domain => origin.endsWith(domain));
  },
  credentials: true,
  skipPaths: ['/health', '/metrics'],
  exposedHeaders: ['X-Rate-Limit-Remaining', 'X-Total-Count']
});

const app = new Elysia()
  .use(cors.plugin()) // Use advanced plugin with decorators
  .get('/', ({ cors }) => {
    return {
      message: 'Hello World',
      corsConfig: cors.config
    };
  });
  `,

  /**
   * Framework-agnostic usage
   */
  frameworkAgnostic: `
import { createCorsMiddlewareInstance } from '@libs/middleware';

const cors = createCorsMiddlewareInstance({
  origin: "*",
  methods: ["GET", "POST"]
});

const middlewareFunction = cors.middleware();
// Use with any framework that supports standard middleware functions
export { middlewareFunction };
  `,
};
