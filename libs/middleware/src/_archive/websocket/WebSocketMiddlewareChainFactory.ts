import { Logger, MetricsCollector } from "@libs/monitoring";
import {
  UnifiedSessionManager,
  PermissionService,
  DEFAULT_PERMISSION_SERVICE_CONFIG,
} from "@libs/auth";
import {
  WebSocketMiddlewareChain,
  MiddlewarePriority,
  MiddlewareConfig,
} from "./WebSocketMiddlewareChain";
import { WebSocketAuthMiddleware } from "./WebSocketAuthMiddleware";
import { BaseWebSocketMiddleware } from "./BaseWebSocketMiddleware";
import {
  WebSocketContext,
  WebSocketAuthConfig,
  WebSocketMiddlewareFunction,
  WebSocketMiddlewareOptions,
} from "../../types";

/**
 * Rate limiting configuration
 */
interface RateLimitConfig extends WebSocketMiddlewareOptions {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  keyGenerator?: (context: WebSocketContext) => string;
}

/**
 * Origin validation configuration
 */
interface OriginValidationConfig extends WebSocketMiddlewareOptions {
  allowedOrigins: string[];
  allowCredentials?: boolean;
  requireOrigin?: boolean;
}

/**
 * Comprehensive middleware chain factory configuration
 */
export interface WebSocketMiddlewareChainConfig {
  // Core authentication
  auth: WebSocketAuthConfig;

  // Rate limiting
  rateLimit?: RateLimitConfig;

  // Origin validation
  originValidation?: OriginValidationConfig;

  // Monitoring and metrics
  enableMetrics?: boolean;
  enableDetailedLogging?: boolean;

  // Circuit breaker defaults
  defaultCircuitBreaker?: {
    failureThreshold: number;
    recoveryTimeout: number;
    halfOpenMaxCalls: number;
  };

  // Retry defaults
  defaultRetry?: {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
  };
}

/**
 * Rate limiting middleware for WebSocket connections
 */
class WebSocketRateLimitMiddleware extends BaseWebSocketMiddleware<RateLimitConfig> {
  private readonly requestCounts = new Map<
    string,
    { count: number; resetTime: number }
  >();
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor(
    config: RateLimitConfig,
    logger: ILogger = Logger.getInstance("WebSocketRateLimit"),
    metrics?: MetricsCollector
  ) {
    super("rate-limit", config, logger, metrics);

    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.requestCounts) {
        if (now >= data.resetTime) {
          this.requestCounts.delete(key);
        }
      }
    }, 60000);
  }

  async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    const key = this.config.keyGenerator
      ? this.config.keyGenerator(context)
      : context.metadata.clientIp || context.connectionId;

    const now = Date.now();
    let requestData = this.requestCounts.get(key);

    // Initialize or reset if window expired
    if (!requestData || now >= requestData.resetTime) {
      requestData = {
        count: 0,
        resetTime: now + this.config.windowMs,
      };
      this.requestCounts.set(key, requestData);
    }

    // Check rate limit
    if (requestData.count >= this.config.maxRequests) {
      await this.recordMetric("rate_limit_exceeded");

      this.logger.warn("Rate limit exceeded", {
        key,
        count: requestData.count,
        maxRequests: this.config.maxRequests,
        connectionId: context.connectionId,
      });

      // Send rate limit error
      this.sendResponse(context, {
        type: "rate_limit_error",
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests",
          retryAfter: Math.ceil((requestData.resetTime - now) / 1000),
        },
      });

      // Close connection with policy violation code
      context.ws.close(1008, "Rate limit exceeded");
      return;
    }

    // Increment counter
    requestData.count++;

    try {
      await next();

      // If configured to skip successful requests, decrement counter
      if (this.config.skipSuccessfulRequests) {
        requestData.count = Math.max(0, requestData.count - 1);
      }
    } catch (error) {
      throw error;
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.requestCounts.clear();
  }
}

/**
 * Origin validation middleware for WebSocket connections
 */
class WebSocketOriginValidationMiddleware extends BaseWebSocketMiddleware<OriginValidationConfig> {
  constructor(
    config: OriginValidationConfig,
    logger: ILogger = Logger.getInstance("WebSocketOriginValidation"),
    metrics?: MetricsCollector
  ) {
    super("origin-validation", config, logger, metrics);
  }

  async execute(
    context: WebSocketContext,
    next: () => Promise<void>
  ): Promise<void> {
    const origin = context.metadata.headers["origin"];

    // Check if origin is required
    if (this.config.requireOrigin && !origin) {
      await this.recordMetric("origin_missing");

      this.logger.warn("Origin header missing", {
        connectionId: context.connectionId,
      });

      this.sendResponse(context, {
        type: "origin_error",
        error: {
          code: "ORIGIN_REQUIRED",
          message: "Origin header is required",
        },
      });

      context.ws.close(1008, "Origin header required");
      return;
    }

    // Validate origin if provided
    if (origin && !this.isOriginAllowed(origin)) {
      await this.recordMetric("origin_forbidden");

      this.logger.warn("Origin not allowed", {
        origin,
        allowedOrigins: this.config.allowedOrigins,
        connectionId: context.connectionId,
      });

      this.sendResponse(context, {
        type: "origin_error",
        error: {
          code: "ORIGIN_FORBIDDEN",
          message: "Origin not allowed",
        },
      });

      context.ws.close(1008, "Origin not allowed");
      return;
    }

    await next();
  }

  private isOriginAllowed(origin: string): boolean {
    return this.config.allowedOrigins.some((allowedOrigin) => {
      // Exact match
      if (allowedOrigin === origin) return true;

      // Wildcard matching
      if (allowedOrigin.includes("*")) {
        const pattern = allowedOrigin
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\\\*/g, ".*");
        return new RegExp(`^${pattern}$`).test(origin);
      }

      return false;
    });
  }
}

/**
 * Production-grade WebSocket Middleware Chain Factory
 * Creates optimized middleware chains with enterprise-grade features
 */
export class WebSocketMiddlewareChainFactory {
  private readonly logger: ILogger;
  private readonly metrics: MetricsCollector;

  constructor(
    logger: ILogger = Logger.getInstance("WebSocketMiddlewareChainFactory"),
    metrics?: MetricsCollector
  ) {
    this.logger = logger;
    this.metrics = metrics ?? MetricsCollector.getInstance();
  }

  /**
   * Create a complete WebSocket middleware chain with all essential middleware
   */
  createComplete(
    config: WebSocketMiddlewareChainConfig,
    sessionManager: UnifiedSessionManager,
    permissionService?: PermissionService
  ): WebSocketMiddlewareChain {
    const chain = new WebSocketMiddlewareChain(this.logger, this.metrics);

    // Initialize permission service if not provided
    const ps =
      permissionService ||
      new PermissionService(
        DEFAULT_PERMISSION_SERVICE_CONFIG,
        this.logger,
        this.metrics || MetricsCollector.getInstance()
      );

    // 1. Origin validation (highest priority - security)
    if (config.originValidation) {
      const originValidation = new WebSocketOriginValidationMiddleware(
        config.originValidation,
        this.logger,
        this.metrics
      );

      chain.register(
        {
          name: "origin-validation",
          priority: MiddlewarePriority.CRITICAL,
          circuitBreakerConfig: config.defaultCircuitBreaker,
        },
        originValidation.middleware()
      );
    }

    // 2. Rate limiting (critical priority)
    if (config.rateLimit) {
      const rateLimit = new WebSocketRateLimitMiddleware(
        config.rateLimit,
        this.logger,
        this.metrics
      );

      chain.register(
        {
          name: "rate-limit",
          priority: MiddlewarePriority.CRITICAL,
          circuitBreakerConfig: config.defaultCircuitBreaker,
          retryConfig: config.defaultRetry,
        },
        rateLimit.middleware()
      );
    }

    // 3. Authentication (critical priority)
    const auth = new WebSocketAuthMiddleware(
      config.auth,
      sessionManager,
      this.logger,
      this.metrics,
      ps
    );

    chain.register(
      {
        name: "authentication",
        priority: MiddlewarePriority.CRITICAL,
        dependencies: config.rateLimit ? ["rate-limit"] : undefined,
        circuitBreakerConfig: config.defaultCircuitBreaker,
        retryConfig: {
          maxRetries: 2,
          baseDelay: 100,
          maxDelay: 500,
          backoffMultiplier: 2,
        },
      },
      auth.middleware()
    );

    // 4. Metrics and monitoring (low priority)
    if (config.enableMetrics) {
      chain.register(
        {
          name: "metrics",
          priority: MiddlewarePriority.LOW,
          optional: true,
        },
        this.createMetricsMiddleware()
      );
    }

    // 5. Request logging (low priority)
    if (config.enableDetailedLogging) {
      chain.register(
        {
          name: "request-logging",
          priority: MiddlewarePriority.LOW,
          optional: true,
        },
        this.createLoggingMiddleware()
      );
    }

    this.logger.info("WebSocket middleware chain created", {
      middlewareCount: chain.getChainStats().middlewareCount,
      executionOrder: chain.getChainStats().executionOrder,
    });

    return chain;
  }

  /**
   * Create a minimal authentication-only chain
   */
  createMinimal(
    authConfig: WebSocketAuthConfig,
    sessionManager: UnifiedSessionManager,
    permissionService?: PermissionService
  ): WebSocketMiddlewareChain {
    const chain = new WebSocketMiddlewareChain(this.logger, this.metrics);

    const ps =
      permissionService ||
      new PermissionService(
        DEFAULT_PERMISSION_SERVICE_CONFIG,
        this.logger,
        this.metrics || MetricsCollector.getInstance()
      );

    const auth = new WebSocketAuthMiddleware(
      authConfig,
      sessionManager,
      this.logger,
      this.metrics,
      ps
    );

    chain.register(
      {
        name: "authentication",
        priority: MiddlewarePriority.CRITICAL,
      },
      auth.middleware()
    );

    return chain;
  }

  /**
   * Create a security-focused chain with all protection layers
   */
  createSecurityFocused(
    config: WebSocketMiddlewareChainConfig,
    sessionManager: UnifiedSessionManager,
    permissionService?: PermissionService
  ): WebSocketMiddlewareChain {
    // Ensure security configurations are present
    const securityConfig: WebSocketMiddlewareChainConfig = {
      ...config,
      originValidation: config.originValidation || {
        name: "origin-validation",
        allowedOrigins: ["https://localhost:*", "https://*.yourdomain.com"],
        requireOrigin: true,
        allowCredentials: true,
      },
      rateLimit: config.rateLimit || {
        name: "rate-limit",
        windowMs: 60000, // 1 minute
        maxRequests: 100,
        skipSuccessfulRequests: true,
      },
      defaultCircuitBreaker: config.defaultCircuitBreaker || {
        failureThreshold: 3,
        recoveryTimeout: 30000,
        halfOpenMaxCalls: 5,
      },
      defaultRetry: config.defaultRetry || {
        maxRetries: 2,
        baseDelay: 100,
        maxDelay: 1000,
        backoffMultiplier: 2,
      },
    };

    return this.createComplete(
      securityConfig,
      sessionManager,
      permissionService
    );
  }

  /**
   * Create performance-optimized chain for high-throughput scenarios
   */
  createPerformanceOptimized(
    authConfig: WebSocketAuthConfig,
    sessionManager: UnifiedSessionManager,
    permissionService?: PermissionService
  ): WebSocketMiddlewareChain {
    const config: WebSocketMiddlewareChainConfig = {
      auth: authConfig,
      enableMetrics: true,
      enableDetailedLogging: false, // Reduce logging overhead
      defaultCircuitBreaker: {
        failureThreshold: 5, // More tolerant
        recoveryTimeout: 10000, // Faster recovery
        halfOpenMaxCalls: 10,
      },
      defaultRetry: {
        maxRetries: 1, // Fewer retries
        baseDelay: 50,
        maxDelay: 200,
        backoffMultiplier: 2,
      },
    };

    return this.createComplete(config, sessionManager, permissionService);
  }

  /**
   * Create metrics middleware
   */
  private createMetricsMiddleware(): WebSocketMiddlewareFunction {
    return async (context: WebSocketContext, next: () => Promise<void>) => {
      const startTime = performance.now();

      try {
        await next();

        // Record success metrics
        if (this.metrics) {
          const duration = performance.now() - startTime;
          await Promise.all([
            this.metrics.recordCounter("websocket_message_processed", 1, {
              messageType: context.message.type,
              authenticated: context.authenticated ? "true" : "false",
            }),
            this.metrics.recordTimer("websocket_message_duration", duration, {
              messageType: context.message.type,
            }),
          ]);
        }
      } catch (error) {
        // Record failure metrics
        if (this.metrics) {
          await this.metrics.recordCounter("websocket_message_failed", 1, {
            messageType: context.message.type,
            error: (error as Error).message,
          });
        }
        throw error;
      }
    };
  }

  /**
   * Create request logging middleware
   */
  private createLoggingMiddleware(): WebSocketMiddlewareFunction {
    return async (context: WebSocketContext, next: () => Promise<void>) => {
      const startTime = Date.now();

      this.logger.debug("WebSocket message received", {
        connectionId: context.connectionId,
        messageType: context.message.type,
        authenticated: context.authenticated,
        userId: context.userId,
        timestamp: new Date().toISOString(),
      });

      try {
        await next();

        this.logger.debug("WebSocket message processed successfully", {
          connectionId: context.connectionId,
          messageType: context.message.type,
          processingTime: Date.now() - startTime,
        });
      } catch (error) {
        this.logger.warn("WebSocket message processing failed", {
          connectionId: context.connectionId,
          messageType: context.message.type,
          error: (error as Error).message,
          processingTime: Date.now() - startTime,
        });
        throw error;
      }
    };
  }
}

/**
 * Default factory configurations for common use cases
 */
export const WEBSOCKET_CHAIN_PRESETS = {
  /**
   * Development preset - minimal security, detailed logging
   */
  DEVELOPMENT: {
    auth: {
      requireAuth: false,
      skipAuthenticationForTypes: ["ping", "heartbeat"],
      closeOnAuthFailure: false,
    } as WebSocketAuthConfig,
    enableMetrics: true,
    enableDetailedLogging: true,
  } as WebSocketMiddlewareChainConfig,

  /**
   * Production preset - maximum security, optimized performance
   */
  PRODUCTION: {
    auth: {
      requireAuth: true,
      closeOnAuthFailure: true,
      apiKeyHeader: "x-api-key",
    } as WebSocketAuthConfig,
    originValidation: {
      allowedOrigins: ["https://*.yourdomain.com"],
      requireOrigin: true,
      allowCredentials: true,
    },
    rateLimit: {
      windowMs: 60000,
      maxRequests: 50,
      skipSuccessfulRequests: true,
    },
    enableMetrics: true,
    enableDetailedLogging: false,
    defaultCircuitBreaker: {
      failureThreshold: 3,
      recoveryTimeout: 30000,
      halfOpenMaxCalls: 5,
    },
    defaultRetry: {
      maxRetries: 2,
      baseDelay: 100,
      maxDelay: 1000,
      backoffMultiplier: 2,
    },
  } as WebSocketMiddlewareChainConfig,

  /**
   * High-throughput preset - optimized for performance
   */
  HIGH_THROUGHPUT: {
    auth: {
      requireAuth: true,
      closeOnAuthFailure: true,
    } as WebSocketAuthConfig,
    rateLimit: {
      windowMs: 60000,
      maxRequests: 200,
      skipSuccessfulRequests: true,
    },
    enableMetrics: true,
    enableDetailedLogging: false,
    defaultCircuitBreaker: {
      failureThreshold: 10,
      recoveryTimeout: 5000,
      halfOpenMaxCalls: 20,
    },
    defaultRetry: {
      maxRetries: 1,
      baseDelay: 25,
      maxDelay: 100,
      backoffMultiplier: 2,
    },
  } as WebSocketMiddlewareChainConfig,
};
