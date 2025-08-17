export interface SecurityConfig {
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
export class SecurityMiddleware {
  private readonly defaultConfig: SecurityConfig = {
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

  constructor(private config: SecurityConfig = {}) {}

  /**
   * Create Elysia middleware for security headers
   */
  elysia(config?: Partial<SecurityConfig>) {
    const finalConfig = this.mergeConfig(this.defaultConfig, this.config, config);

    return (app: any) => {
      return app.onBeforeHandle(async (context: any) => {
        const { set } = context;
        
        this.setSecurityHeaders(set, finalConfig);
        
        return context;
      });
    };
  }

  /**
   * Set security headers based on configuration
   */
  private setSecurityHeaders(set: any, config: SecurityConfig): void {
    set.headers = set.headers || {};

    // Content Security Policy
    if (config.contentSecurityPolicy?.enabled) {
      const cspValue = this.buildCSPHeader(config.contentSecurityPolicy.directives || {});
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
        } else if (config.xssFilter.mode === "report" && config.xssFilter.reportUri) {
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
      const permissionsValue = this.buildPermissionsPolicyHeader(config.permissionsPolicy);
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
  private buildPermissionsPolicyHeader(policies: Record<string, string[]>): string {
    return Object.entries(policies)
      .map(([feature, allowlist]) => `${feature}=(${allowlist.join(" ")})`)
      .join(", ");
  }

  /**
   * Deep merge configurations
   */
  private mergeConfig(...configs: Partial<SecurityConfig>[]): SecurityConfig {
    const result: SecurityConfig = {};
    
    for (const config of configs) {
      if (config) {
        Object.assign(result, config);
        
        // Deep merge nested objects
        if (config.contentSecurityPolicy && result.contentSecurityPolicy) {
          result.contentSecurityPolicy = {
            ...result.contentSecurityPolicy,
            ...config.contentSecurityPolicy,
            directives: {
              ...result.contentSecurityPolicy.directives,
              ...config.contentSecurityPolicy.directives,
            },
          };
        }
        
        if (config.hsts && result.hsts) {
          result.hsts = { ...result.hsts, ...config.hsts };
        }
        
        if (config.permissionsPolicy && result.permissionsPolicy) {
          result.permissionsPolicy = { ...result.permissionsPolicy, ...config.permissionsPolicy };
        }
        
        if (config.customHeaders && result.customHeaders) {
          result.customHeaders = { ...result.customHeaders, ...config.customHeaders };
        }
      }
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
        "Pragma": "no-cache",
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
}

/**
 * Factory function for easy middleware creation
 */
export function createSecurityMiddleware(config?: SecurityConfig) {
  const middleware = new SecurityMiddleware(config);
  return middleware.elysia();
}