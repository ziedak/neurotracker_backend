import { BaseMiddleware } from "../base";
import { MiddlewareContext, MiddlewareOptions } from "../types";
import { type ILogger, type IMetricsCollector } from "@libs/monitoring";
import { inject } from "@libs/utils";

export interface SecurityConfig extends MiddlewareOptions {
  // Content Security Policy
  contentSecurityPolicy?: {
    enabled?: boolean;
    directives?: Record<string, string[]>;
  };
  // HTTP Strict Transport Security
  hsts?: {
    enabled?: boolean;
    maxAge?: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  // X-Frame-Options
  frameOptions?: "DENY" | "SAMEORIGIN" | string | false;
  // X-Content-Type-Options
  noSniff?: boolean;
  // X-XSS-Protection
  xssFilter?: boolean | { mode?: "block" | "report"; reportUri?: string };
  // Referrer Policy
  referrerPolicy?: string;
  // Feature Policy / Permissions Policy
  permissionsPolicy?: Record<string, string[]>;
  // Additional custom headers
  customHeaders?: Record<string, string>;
}

/**
 * Security Middleware
 * Implements various HTTP security headers following OWASP recommendations
 * Framework-agnostic implementation for comprehensive web security
 */
export class SecurityMiddleware extends BaseMiddleware<SecurityConfig> {
  private readonly defaultConfig: Omit<
    SecurityConfig,
    keyof MiddlewareOptions
  > = {
    contentSecurityPolicy: {
      enabled: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "https:"],
        "font-src": ["'self'"],
        "connect-src": ["'self'"],
        "frame-ancestors": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
    hsts: {
      enabled: true,
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    frameOptions: "DENY",
    noSniff: true,
    xssFilter: true,
    referrerPolicy: "strict-origin-when-cross-origin",
    permissionsPolicy: {
      camera: ["'none'"],
      microphone: ["'none'"],
      geolocation: ["'none'"],
      payment: ["'none'"],
    },
  };

  constructor(
    @inject("ILogger") logger: ILogger,
    @inject("IMetricsCollector") metrics: IMetricsCollector,
    config: SecurityConfig
  ) {
    super(logger, metrics, config, "security");
  }

  /**
   * Execute security middleware - adds security headers to response
   */
  protected override async execute(
    context: MiddlewareContext,
    next: () => Promise<void>
  ): Promise<void> {
    const startTime = performance.now();

    try {
      // Set security headers before processing request
      await this.setSecurityHeaders(context);

      // Record metrics
      await this.recordMetric("security_headers_applied");

      // Continue with next middleware/handler
      await next();
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.recordTimer("security_middleware_error_duration", duration);

      this.logger.error("Security middleware error", error as Error, {
        path: context.request.url,
        method: context.request.method,
        requestId: context.requestId,
      });

      throw error;
    } finally {
      await this.recordTimer(
        "security_middleware_duration",
        performance.now() - startTime
      );
    }
  }

  /**
   * Create new instance of this middleware with different config
   */
  protected override createInstance(
    config: SecurityConfig
  ): SecurityMiddleware {
    return new SecurityMiddleware(this.logger, this.metrics, config);
  }

  /**
   * Set security headers based on configuration
   */
  private async setSecurityHeaders(context: MiddlewareContext): Promise<void> {
    const config = this.mergeConfig(this.defaultConfig, this.config);
    const { set } = context;

    set.headers = set.headers || {};

    // Content Security Policy
    if (config.contentSecurityPolicy?.enabled) {
      const cspValue = this.buildCSPHeader(
        config.contentSecurityPolicy.directives || {}
      );
      if (cspValue) {
        set.headers["Content-Security-Policy"] = cspValue;
      }
    }

    // HTTP Strict Transport Security
    if (config.hsts?.enabled) {
      let hstsValue = `max-age=${config.hsts.maxAge}`;
      if (config.hsts.includeSubDomains) {
        hstsValue += "; includeSubDomains";
      }
      if (config.hsts.preload) {
        hstsValue += "; preload";
      }
      set.headers["Strict-Transport-Security"] = hstsValue;
    }

    // X-Frame-Options
    if (config.frameOptions !== false) {
      set.headers["X-Frame-Options"] = config.frameOptions || "DENY";
    }

    // X-Content-Type-Options
    if (config.noSniff) {
      set.headers["X-Content-Type-Options"] = "nosniff";
    }

    // X-XSS-Protection
    if (config.xssFilter !== false) {
      if (typeof config.xssFilter === "boolean") {
        set.headers["X-XSS-Protection"] = "1; mode=block";
      } else if (config.xssFilter?.mode) {
        let xssValue = "1";
        if (config.xssFilter.mode === "block") {
          xssValue += "; mode=block";
        } else if (
          config.xssFilter.mode === "report" &&
          config.xssFilter.reportUri
        ) {
          xssValue += `; report=${config.xssFilter.reportUri}`;
        }
        set.headers["X-XSS-Protection"] = xssValue;
      }
    }

    // Referrer Policy
    if (config.referrerPolicy) {
      set.headers["Referrer-Policy"] = config.referrerPolicy;
    }

    // Permissions Policy
    if (config.permissionsPolicy) {
      const permissionsValue = this.buildPermissionsPolicyHeader(
        config.permissionsPolicy
      );
      if (permissionsValue) {
        set.headers["Permissions-Policy"] = permissionsValue;
      }
    }

    // Custom headers
    if (config.customHeaders) {
      Object.entries(config.customHeaders).forEach(([key, value]) => {
        set.headers[key] = value;
      });
    }

    // Additional security headers
    set.headers["X-Powered-By"] = ""; // Remove server signature
    set.headers["Server"] = ""; // Remove server signature

    this.logger.debug("Security headers applied", {
      path: context.request.url,
      headersCount: Object.keys(set.headers).length,
      requestId: context.requestId,
    });
  }

  /**
   * Build Content Security Policy header value
   */
  private buildCSPHeader(directives: Record<string, string[]>): string {
    return Object.entries(directives)
      .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
      .join("; ");
  }

  /**
   * Build Permissions Policy header value
   */
  private buildPermissionsPolicyHeader(
    policies: Record<string, string[]>
  ): string {
    return Object.entries(policies)
      .map(([feature, allowlist]) => `${feature}=(${allowlist.join(" ")})`)
      .join(", ");
  }

  /**
   * Deep merge configurations
   */
  private mergeConfig(
    defaultConfig: Partial<SecurityConfig>,
    userConfig: SecurityConfig
  ): SecurityConfig {
    const result: SecurityConfig = { ...userConfig };

    // Merge default config
    Object.assign(result, defaultConfig, userConfig);

    // Deep merge nested objects
    if (defaultConfig.contentSecurityPolicy && result.contentSecurityPolicy) {
      result.contentSecurityPolicy = {
        ...defaultConfig.contentSecurityPolicy,
        ...result.contentSecurityPolicy,
        directives: {
          ...defaultConfig.contentSecurityPolicy.directives,
          ...result.contentSecurityPolicy.directives,
        },
      };
    }

    if (defaultConfig.hsts && result.hsts) {
      result.hsts = { ...defaultConfig.hsts, ...result.hsts };
    }

    if (defaultConfig.permissionsPolicy && result.permissionsPolicy) {
      result.permissionsPolicy = {
        ...defaultConfig.permissionsPolicy,
        ...result.permissionsPolicy,
      };
    }

    if (defaultConfig.customHeaders && result.customHeaders) {
      result.customHeaders = {
        ...defaultConfig.customHeaders,
        ...result.customHeaders,
      };
    }

    return result;
  }

  /**
   * Create preset configurations
   */
  static createDevelopmentConfig(): SecurityConfig {
    return {
      contentSecurityPolicy: {
        enabled: false, // Disable for development flexibility
      },
      hsts: {
        enabled: false, // Not needed for development
      },
      frameOptions: "SAMEORIGIN",
      noSniff: true,
      xssFilter: true,
      referrerPolicy: "no-referrer-when-downgrade",
    };
  }

  static createProductionConfig(): SecurityConfig {
    return {
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
        maxAge: 31536000, // 1 year
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
        "display-capture": ["'none'"],
      },
    };
  }

  static createApiConfig(): SecurityConfig {
    return {
      contentSecurityPolicy: {
        enabled: false, // APIs don't need CSP
      },
      hsts: {
        enabled: true,
        maxAge: 31536000,
        includeSubDomains: true,
      },
      frameOptions: "DENY",
      noSniff: true,
      xssFilter: false, // Not needed for APIs
      referrerPolicy: "no-referrer",
      customHeaders: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    };
  }

  static createStrictConfig(): SecurityConfig {
    return {
      contentSecurityPolicy: {
        enabled: true,
        directives: {
          "default-src": ["'none'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'none'"],
          "form-action": ["'none'"],
          "upgrade-insecure-requests": [],
        },
      },
      hsts: {
        enabled: true,
        maxAge: 63072000, // 2 years
        includeSubDomains: true,
        preload: true,
      },
      frameOptions: "DENY",
      noSniff: true,
      xssFilter: { mode: "block" },
      referrerPolicy: "no-referrer",
      permissionsPolicy: {
        camera: ["'none'"],
        microphone: ["'none'"],
        geolocation: ["'none'"],
        payment: ["'none'"],
        "display-capture": ["'none'"],
        "web-share": ["'none'"],
        "clipboard-read": ["'none'"],
        "clipboard-write": ["'none'"],
      },
    };
  }
  /**
   * Factory method for creating SecurityMiddleware with development config
   */
  static createDevelopment(
    logger: ILogger,
    metrics: IMetricsCollector,
    additionalConfig?: Partial<SecurityConfig>
  ): SecurityMiddleware {
    const devConfig = SecurityMiddleware.createDevelopmentConfig();
    const config: SecurityConfig = {
      ...devConfig,
      ...additionalConfig,
      enabled: true,
      name: "security-dev",
    };
    return new SecurityMiddleware(logger, metrics, config);
  }

  /**
   * Factory method for creating SecurityMiddleware with production config
   */
  static createProduction(
    logger: ILogger,
    metrics: IMetricsCollector,
    additionalConfig?: Partial<SecurityConfig>
  ): SecurityMiddleware {
    const prodConfig = SecurityMiddleware.createProductionConfig();
    const config: SecurityConfig = {
      ...prodConfig,
      ...additionalConfig,
      enabled: true,
      name: "security-prod",
    };
    return new SecurityMiddleware(logger, metrics, config);
  }

  /**
   * Factory method for creating SecurityMiddleware with API config
   */
  static createApi(
    logger: ILogger,
    metrics: IMetricsCollector,
    additionalConfig?: Partial<SecurityConfig>
  ): SecurityMiddleware {
    const apiConfig = SecurityMiddleware.createApiConfig();
    const config: SecurityConfig = {
      ...apiConfig,
      ...additionalConfig,
      enabled: true,
      name: "security-api",
    };
    return new SecurityMiddleware(logger, metrics, config);
  }

  /**
   * Factory method for creating SecurityMiddleware with strict config
   */
  static createStrict(
    logger: ILogger,
    metrics: IMetricsCollector,
    additionalConfig?: Partial<SecurityConfig>
  ): SecurityMiddleware {
    const strictConfig = SecurityMiddleware.createStrictConfig();
    const config: SecurityConfig = {
      ...strictConfig,
      ...additionalConfig,
      enabled: true,
      name: "security-strict",
    };
    return new SecurityMiddleware(logger, metrics, config);
  }
}

/**
 * Factory function for easy middleware creation
 * @deprecated Use SecurityMiddleware.createDevelopment, createProduction, createApi, or createStrict instead
 */
export function createSecurityMiddleware(
  logger: ILogger,
  metrics: IMetricsCollector,
  config?: SecurityConfig
) {
  const finalConfig: SecurityConfig = {
    enabled: true,
    name: "security",
    ...config,
  };
  const middleware = new SecurityMiddleware(logger, metrics, finalConfig);
  return middleware.elysia();
}
