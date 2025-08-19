export interface CorsConfig {
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
 * Framework-agnostic implementation with comprehensive security options
 */
export class CorsMiddleware {
  private readonly defaultConfig: CorsConfig = {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-API-Key"],
    exposedHeaders: ["X-Total-Count", "X-Rate-Limit-Remaining"],
    credentials: true,
    maxAge: 86400, // 24 hours
    optionsSuccessStatus: 204,
  };

  constructor(private config: CorsConfig = {}) {}

  /**
   * Create Elysia middleware for CORS
   */
  elysia(config?: Partial<CorsConfig>) {
    const finalConfig = { ...this.defaultConfig, ...this.config, ...config };

    return (app: any) => {
      return app
        .onBeforeHandle(async (context: any) => {
          const { request, set } = context;
          const origin = request.headers?.origin;

          // Set CORS headers
          this.setCorsHeaders(set, origin, finalConfig);

          // Handle preflight requests
          if (request.method === "OPTIONS") {
            set.status = finalConfig.optionsSuccessStatus || 204;
            return new Response(null, { status: finalConfig.optionsSuccessStatus || 204 });
          }

          return context;
        });
    };
  }

  /**
   * Set CORS headers based on configuration
   */
  private setCorsHeaders(set: any, origin: string, config: CorsConfig): void {
    // Handle origin
    if (this.isOriginAllowed(origin, config.origin)) {
      set.headers = set.headers || {};
      set.headers["Access-Control-Allow-Origin"] = origin || "*";
    }

    // Allow credentials
    if (config.credentials) {
      set.headers = set.headers || {};
      set.headers["Access-Control-Allow-Credentials"] = "true";
    }

    // Allow methods
    if (config.methods && config.methods.length > 0) {
      set.headers = set.headers || {};
      set.headers["Access-Control-Allow-Methods"] = config.methods.join(", ");
    }

    // Allow headers
    if (config.allowedHeaders && config.allowedHeaders.length > 0) {
      set.headers = set.headers || {};
      set.headers["Access-Control-Allow-Headers"] = config.allowedHeaders.join(", ");
    }

    // Expose headers
    if (config.exposedHeaders && config.exposedHeaders.length > 0) {
      set.headers = set.headers || {};
      set.headers["Access-Control-Expose-Headers"] = config.exposedHeaders.join(", ");
    }

    // Max age for preflight
    if (config.maxAge) {
      set.headers = set.headers || {};
      set.headers["Access-Control-Max-Age"] = config.maxAge.toString();
    }
  }

  /**
   * Check if origin is allowed
   */
  private isOriginAllowed(origin: string, allowedOrigin: CorsConfig["origin"]): boolean {
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
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-API-Key"],
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
export function createCorsMiddleware(config?: CorsConfig) {
  const middleware = new CorsMiddleware(config);
  return middleware.elysia();
}