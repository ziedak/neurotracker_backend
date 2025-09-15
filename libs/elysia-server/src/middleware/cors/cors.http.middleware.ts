import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base";
import type { MiddlewareContext } from "../types";

/**
 * CORS middleware configuration interface
 * Extends HttpMiddlewareConfig with CORS-specific options
 */
export interface CorsHttpMiddlewareConfig extends HttpMiddlewareConfig {
  readonly origin?:
    | string
    | readonly string[]
    | boolean
    | ((origin: string) => boolean);
  readonly methods?: readonly string[];
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly credentials?: boolean;
  readonly maxAge?: number;
  readonly preflightContinue?: boolean;
  readonly optionsSuccessStatus?: number;
}

/**
 * Default CORS configuration constants
 */
const DEFAULT_CORS_OPTIONS = {
  ORIGIN: "*" as const,
  METHODS: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as const,
  ALLOWED_HEADERS: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-API-Key",
  ] as const,
  EXPOSED_HEADERS: ["X-Total-Count", "X-Rate-Limit-Remaining"] as const,
  CREDENTIALS: false, // Cannot use credentials with wildcard origin
  MAX_AGE: 86400, // 24 hours
  OPTIONS_SUCCESS_STATUS: 204,
  PRIORITY: 100, // High priority for CORS
} as const;

/**
 * CORS origin validation result
 */
interface OriginValidationResult {
  readonly allowed: boolean;
  readonly matchedOrigin?: string | undefined;
  readonly reason?: string;
}

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
export class CorsHttpMiddleware extends BaseMiddleware<CorsHttpMiddlewareConfig> {
  constructor(
    metrics: IMetricsCollector,
    config: Partial<CorsHttpMiddlewareConfig> = {}
  ) {
    // Create complete configuration with validated defaults
    const completeConfig: CorsHttpMiddlewareConfig = {
      name: config.name || "cors",
      enabled: config.enabled ?? true,
      priority: config.priority ?? DEFAULT_CORS_OPTIONS.PRIORITY,
      skipPaths: config.skipPaths || [],
      origin: config.origin ?? DEFAULT_CORS_OPTIONS.ORIGIN,
      methods: config.methods ?? [...DEFAULT_CORS_OPTIONS.METHODS],
      allowedHeaders: config.allowedHeaders ?? [
        ...DEFAULT_CORS_OPTIONS.ALLOWED_HEADERS,
      ],
      exposedHeaders: config.exposedHeaders ?? [
        ...DEFAULT_CORS_OPTIONS.EXPOSED_HEADERS,
      ],
      credentials: config.credentials ?? DEFAULT_CORS_OPTIONS.CREDENTIALS,
      maxAge: config.maxAge ?? DEFAULT_CORS_OPTIONS.MAX_AGE,
      preflightContinue: config.preflightContinue ?? false,
      optionsSuccessStatus:
        config.optionsSuccessStatus ??
        DEFAULT_CORS_OPTIONS.OPTIONS_SUCCESS_STATUS,
    };

    super(metrics, completeConfig, completeConfig.name);

    this.validateConfiguration();
  }

  /**
   * Core CORS middleware execution logic
   * Handles both preflight and actual requests with comprehensive validation
   */
  protected async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
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
    } catch (error) {
      await this.handleCorsError(error, context, origin);
      throw error; // Re-throw to maintain error chain
    } finally {
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
  private async handlePreflightRequest(
    context: MiddlewareContext,
    origin: string | null,
    validationResult: OriginValidationResult
  ): Promise<void> {
    this.logger.debug("Handling CORS preflight request", {
      origin: origin || "null",
      allowed: validationResult.allowed,
      requestId: this.getRequestId(context),
    });

    // Validate requested method
    const requestedMethod =
      context.request.headers["access-control-request-method"];
    if (requestedMethod) {
      const methodAllowed = this.config.methods?.includes(
        requestedMethod.toUpperCase()
      );
      if (!methodAllowed) {
        throw new Error("Method not allowed");
      }
    }

    // Validate requested headers
    const requestedHeaders =
      context.request.headers["access-control-request-headers"];
    if (requestedHeaders) {
      const headerNames = requestedHeaders
        .split(",")
        .map((h) => h.trim().toLowerCase());
      const allowedHeadersLower =
        this.config.allowedHeaders?.map((h) => h.toLowerCase()) || [];

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
  private setCorsHeaders(
    context: MiddlewareContext,
    origin: string | null,
    validationResult: OriginValidationResult
  ): void {
    // Ensure headers object exists
    if (!context.set.headers) {
      context.set.headers = {};
    }

    const { headers } = context.set;

    // Set origin header
    if (validationResult.allowed) {
      if (validationResult.matchedOrigin === "*") {
        headers["Access-Control-Allow-Origin"] = "*";
      } else if (origin) {
        headers["Access-Control-Allow-Origin"] =
          validationResult.matchedOrigin || origin;
      }
    }

    // Set credentials
    if (this.config.credentials) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }

    // Set allowed methods
    if (this.config.methods && this.config.methods.length > 0) {
      headers["Access-Control-Allow-Methods"] = this.config.methods.join(", ");
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
  private setPreflightHeaders(context: MiddlewareContext): void {
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
  private extractOrigin(context: MiddlewareContext): string | null {
    const { origin } = context.request.headers;
    return typeof origin === "string" ? origin : null;
  }

  /**
   * Validate origin format
   */
  private isValidOriginFormat(origin: string): boolean {
    try {
      new URL(origin);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate origin against configuration with detailed result
   */
  private validateOrigin(origin: string | null): OriginValidationResult {
    if (!origin) {
      return {
        allowed: this.config.origin === "*" || this.config.origin === true,
        reason: "no_origin_header",
      };
    }

    try {
      const { origin: allowedOrigin } = this.config;

      if (allowedOrigin === true || allowedOrigin === "*") {
        return { allowed: true, matchedOrigin: "*" };
      }

      if (typeof allowedOrigin === "string") {
        const allowed = origin === allowedOrigin;
        return {
          allowed,
          matchedOrigin: allowed ? allowedOrigin : undefined,
          reason: allowed ? "exact_match" : "no_match",
        };
      }

      if (Array.isArray(allowedOrigin)) {
        const matchedOrigin = allowedOrigin.find(
          (allowed) => allowed === origin
        );
        return {
          allowed: !!matchedOrigin,
          matchedOrigin,
          reason: matchedOrigin ? "array_match" : "not_in_array",
        };
      }

      if (typeof allowedOrigin === "function") {
        const allowed = allowedOrigin(origin);
        return {
          allowed,
          matchedOrigin: allowed ? origin : undefined,
          reason: allowed ? "function_approved" : "function_rejected",
        };
      }

      return { allowed: false, reason: "invalid_config" };
    } catch (error) {
      this.logger.error("Origin validation error", { origin, error });
      return { allowed: false, reason: "validation_error" };
    }
  }

  /**
   * Handle CORS-related errors
   */
  private async handleCorsError(
    error: unknown,
    context: MiddlewareContext,
    origin: string | null
  ): Promise<void> {
    this.logger.error("CORS middleware error", {
      error: error instanceof Error ? error.message : "Unknown error",
      origin: origin || "null",
      path: context.request.url,
      requestId: this.getRequestId(context),
    });

    await this.recordMetric("cors_origin_rejected", 1, {
      error_type: error instanceof Error ? error.constructor.name : "unknown",
      origin: origin || "null",
    });
  }

  /**
   * Record CORS-specific metrics
   */
  private async recordCorsMetrics(
    action: string,
    validationResult: OriginValidationResult,
    additionalTags: Record<string, string> = {}
  ): Promise<void> {
    await this.recordMetric(`cors_${action}`, 1, {
      allowed: validationResult.allowed.toString(),
      reason: validationResult.reason || "unknown",
      ...additionalTags,
    });
  }

  /**
   * Validate configuration on instantiation
   */
  private validateConfiguration(): void {
    const {
      methods,
      allowedHeaders,
      exposedHeaders,
      maxAge,
      optionsSuccessStatus,
      credentials,
      origin,
    } = this.config;

    if (methods && methods.length === 0) {
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

    if (
      optionsSuccessStatus !== undefined &&
      (optionsSuccessStatus < 200 || optionsSuccessStatus >= 300)
    ) {
      throw new Error("CORS optionsSuccessStatus must be between 200 and 299");
    }

    // Validate credentials with wildcard origin
    if (credentials && (origin === "*" || origin === true)) {
      throw new Error("Cannot use credentials with wildcard origin");
    }
  }

  /**
   * Create development configuration preset
   */
  static createDevelopmentConfig(): Partial<CorsHttpMiddlewareConfig> {
    return {
      name: "cors-dev",
      origin: "*",
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
      allowedHeaders: ["*"],
      maxAge: 0, // Disable preflight caching in development
      enabled: true,
      priority: DEFAULT_CORS_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create production configuration preset
   */
  static createProductionConfig(
    allowedOrigins: readonly string[]
  ): Partial<CorsHttpMiddlewareConfig> {
    return {
      name: "cors-prod",
      origin: [...allowedOrigins],
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
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
  static createApiConfig(): Partial<CorsHttpMiddlewareConfig> {
    return {
      name: "cors-api",
      origin: true,
      credentials: false,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
      allowedHeaders: ["Content-Type", "X-API-Key"],
      maxAge: DEFAULT_CORS_OPTIONS.MAX_AGE,
      enabled: true,
      priority: DEFAULT_CORS_OPTIONS.PRIORITY,
    };
  }

  /**
   * Create strict security configuration preset
   */
  static createStrictConfig(
    allowedOrigins: readonly string[]
  ): Partial<CorsHttpMiddlewareConfig> {
    return {
      name: "cors-strict",
      origin: [...allowedOrigins],
      credentials: true,
      methods: ["GET", "POST"], // Minimal methods
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
export function createCorsHttpMiddleware(
  metrics: IMetricsCollector,
  config?: Partial<CorsHttpMiddlewareConfig>
): CorsHttpMiddleware {
  return new CorsHttpMiddleware(metrics, config);
}

/**
 * Preset configurations for common CORS scenarios
 * Immutable configuration objects for different environments
 */
export const CORS_PRESETS = {
  development: (): Partial<CorsHttpMiddlewareConfig> =>
    CorsHttpMiddleware.createDevelopmentConfig(),

  production: (origins: readonly string[]): Partial<CorsHttpMiddlewareConfig> =>
    CorsHttpMiddleware.createProductionConfig(origins),

  api: (): Partial<CorsHttpMiddlewareConfig> =>
    CorsHttpMiddleware.createApiConfig(),

  strict: (origins: readonly string[]): Partial<CorsHttpMiddlewareConfig> =>
    CorsHttpMiddleware.createStrictConfig(origins),

  websocket: (
    origins: readonly string[]
  ): Partial<CorsHttpMiddlewareConfig> => ({
    name: "cors-websocket",
    origin: [...origins],
    credentials: true,
    methods: ["GET"],
    allowedHeaders: ["Content-Type", "Authorization", "Upgrade", "Connection"],
    maxAge: DEFAULT_CORS_OPTIONS.MAX_AGE,
    enabled: true,
    priority: DEFAULT_CORS_OPTIONS.PRIORITY,
  }),

  graphql: (origins: readonly string[]): Partial<CorsHttpMiddlewareConfig> => ({
    name: "cors-graphql",
    origin: [...origins],
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
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
} as const;
