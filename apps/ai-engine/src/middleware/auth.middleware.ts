import { Context } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";

/**
 * Type guard for JWT payload
 */
interface JwtPayload {
  userId?: string;
  permissions?: string[];
  exp?: number;
  [key: string]: any;
}

function isJwtPayload(obj: any): obj is JwtPayload {
  return (
    typeof obj === "object" &&
    (typeof obj.userId === "string" || typeof obj.userId === "undefined") &&
    (Array.isArray(obj.permissions) || typeof obj.permissions === "undefined")
  );
}

/**
 * Custom error for authentication failures
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Custom error for permission failures
 */
export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

interface AuthConfig {
  apiKeys: Set<string>;
  bypassRoutes: string[];
  rateLimitByUser: boolean;
}

interface AuthContext {
  userId?: string;
  apiKey?: string;
  permissions: string[];
  authenticated: boolean;
}

/**
 * Authentication Middleware for AI Engine
 * Handles API key validation, user authentication, and permission checking
 */
export class AuthMiddleware {
  /**
   * Route permission requirements (precomputed Map for O(1) lookup)
   */
  private static readonly ROUTE_PERMISSIONS_MAP: Map<string, string[]> =
    AuthMiddleware.initRoutePermissions();

  /**
   * Initialize route permission mapping as a Map for fast lookup
   */
  private static initRoutePermissions(): Map<string, string[]> {
    const routePermissions: Record<string, string[]> = {
      "POST /predict": ["predict"],
      "POST /batch-predict": ["batch_predict"],
      "GET /explain": ["explain"],
      "GET /models": ["admin", "models"],
      "POST /models": ["admin"],
      "DELETE /cache": ["admin", "cache_manage"],
      "GET /metrics": ["metrics", "admin"],
      "GET /health": [], // Public
    };
    return new Map(Object.entries(routePermissions));
  }

  /**
   * Mask API key for logging and error messages
   */
  private maskApiKey(apiKey?: string): string {
    if (!apiKey) return "(none)";
    // Show only first 4 chars, mask the rest
    return apiKey.length > 8
      ? apiKey.substring(0, 4) + "..." + apiKey.substring(apiKey.length - 2)
      : apiKey.substring(0, 2) + "...";
  }
  private readonly config: AuthConfig;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  // In production, these would be loaded from environment/database
  private readonly defaultConfig: AuthConfig = {
    apiKeys: new Set([
      "ai-engine-key-prod-2024",
      "ai-engine-key-dev-2024",
      "dashboard-service-key",
      "data-intelligence-key",
    ]),
    bypassRoutes: ["/health", "/metrics", "/docs", "/swagger"],
    rateLimitByUser: true,
  };

  constructor(
    logger: Logger,
    metrics: MetricsCollector,
    config?: Partial<AuthConfig>
  ) {
    this.logger = logger;
    this.metrics = metrics;
    this.config = {
      ...this.defaultConfig,
      ...config,
      apiKeys: new Set([
        ...this.defaultConfig.apiKeys,
        ...(config?.apiKeys || []),
      ]),
    };

    this.logger.info("Auth Middleware initialized", {
      apiKeyCount: this.config.apiKeys.size,
      bypassRoutes: this.config.bypassRoutes.length,
    });
  }

  /**
   * Main authentication middleware function
   */
  authenticate = async (context: Context): Promise<void> => {
    /**
     * Main authentication middleware function
     * Validates credentials, checks permissions, and records events
     */
    const startTime = performance.now();
    const { request, path } = context;

    try {
      if (this.shouldBypassAuth(path)) {
        const duration = performance.now() - startTime;
        await this.metrics.recordTimer("auth_bypass_duration", duration);
        this.logger.debug("Authentication bypassed", {
          path,
          duration: Math.round(duration),
        });
        return;
      }
      const authHeader = request.headers.get("authorization");
      const apiKeyHeader = request.headers.get("x-api-key");
      if (!authHeader && !apiKeyHeader) {
        await this.recordAuthEvent(
          "auth_missing_credentials",
          context,
          startTime
        );
        context.set.status = 401;
        throw new AuthError(
          "Authentication required - provide Authorization header or X-API-Key"
        );
      }
      let authContext: AuthContext;
      if (apiKeyHeader) {
        authContext = await this.authenticateApiKey(apiKeyHeader, context);
      } else if (authHeader) {
        authContext = await this.authenticateToken(authHeader, context);
      } else {
        await this.recordAuthEvent("auth_invalid_method", context, startTime);
        context.set.status = 401;
        throw new AuthError("Invalid authentication method");
      }
      await this.checkPermissions(authContext, context);
      (context as any).auth = authContext;
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("auth_success_duration", duration);
      await this.metrics.recordCounter("auth_success");
      this.logger.debug("Authentication successful", {
        path,
        userId: authContext.userId,
        apiKey: this.maskApiKey(authContext.apiKey),
        permissions: authContext.permissions.length,
        duration: Math.round(duration),
      });
      await this.recordAuthEvent(
        "auth_success",
        context,
        startTime,
        authContext
      );
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("auth_error_duration", duration);
      await this.metrics.recordCounter("auth_error");
      this.logger.error("Authentication failed", error as Error, {
        path,
        duration: Math.round(duration),
        userAgent: request.headers.get("user-agent"),
        clientIp: this.getClientIp(request),
      });
      await this.recordAuthEvent(
        "auth_failed",
        context,
        startTime,
        undefined,
        error
      );
      context.set.status =
        context.set.status || (error instanceof PermissionError ? 403 : 401);
      throw error;
    }
  };

  /**
   * Check if route should bypass authentication
   */
  private shouldBypassAuth(path: string): boolean {
    return this.config.bypassRoutes.some((route) => {
      if (route.endsWith("*")) {
        return path.startsWith(route.slice(0, -1));
      }
      return path === route || path.startsWith(route + "/");
    });
  }

  /**
   * Authenticate using API key
   */
  private async authenticateApiKey(
    apiKey: string,
    context: Context
  ): Promise<AuthContext> {
    const startTime = performance.now();

    try {
      if (!this.config.apiKeys.has(apiKey)) {
        context.set.status = 401;
        throw new AuthError(`Invalid API key: ${this.maskApiKey(apiKey)}`);
      }
      const permissions = this.getApiKeyPermissions(apiKey);
      const authContext: AuthContext = {
        apiKey,
        permissions,
        authenticated: true,
        userId: this.getApiKeyUserId(apiKey),
      };
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("auth_api_key_duration", duration);
      this.logger.debug("API key authentication successful", {
        apiKey: this.maskApiKey(apiKey),
        permissions: permissions.length,
        duration: Math.round(duration),
      });
      return authContext;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("auth_api_key_error_duration", duration);
      throw error;
    }
  }

  /**
   * Authenticate using JWT or other token
   */
  private async authenticateToken(
    authHeader: string,
    context: Context
  ): Promise<AuthContext> {
    const startTime = performance.now();

    try {
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!tokenMatch) {
        context.set.status = 401;
        throw new AuthError(
          'Invalid Authorization header format - expected "Bearer <token>"'
        );
      }
      const token = tokenMatch[1];
      if (token.length < 20) {
        context.set.status = 401;
        throw new AuthError("Invalid token format");
      }
      const authContext = await this.validateToken(token);
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("auth_token_duration", duration);
      this.logger.debug("Token authentication successful", {
        userId: authContext.userId,
        permissions: authContext.permissions.length,
        duration: Math.round(duration),
      });
      return authContext;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("auth_token_error_duration", duration);
      throw error;
    }
  }

  /**
   * Validate JWT token (simplified implementation)
   */
  private async validateToken(token: string): Promise<AuthContext> {
    // In production, this would:
    // 1. Verify JWT signature
    // 2. Check expiration
    // 3. Validate issuer
    // 4. Extract user claims
    // 5. Check user status in database

    // For demonstration, we'll simulate this
    try {
      // Basic token structure check
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new AuthError("Invalid JWT format");
      }
      // Simulate decoding (in production, use proper JWT library)
      const payload = this.decodeTokenPayload(token);
      if (!isJwtPayload(payload)) {
        throw new AuthError("Malformed JWT payload");
      }
      if (!payload.userId || !Array.isArray(payload.permissions)) {
        throw new AuthError("JWT payload missing required fields");
      }
      return {
        userId: payload.userId,
        permissions: payload.permissions,
        authenticated: true,
      };
    } catch (error) {
      throw new AuthError(
        "Token validation failed: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
    }
  }

  /**
   * Decode token payload (simplified)
   */
  private decodeTokenPayload(token: string): any {
    try {
      // In production, use proper JWT library for decoding and validation
      const parts = token.split(".");
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
      // Check expiration
      if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) {
        throw new AuthError("Token expired");
      }
      // Documented: expected payload structure is JwtPayload (userId: string, permissions: string[], exp?: number)
      return payload;
    } catch (error) {
      throw new AuthError("Failed to decode token");
    }
  }

  /**
   * Get permissions for an API key
   */
  private getApiKeyPermissions(apiKey: string): string[] {
    // In production, this would be stored in database
    const keyPermissions: Record<string, string[]> = {
      "ai-engine-key-prod-2024": [
        "predict",
        "batch_predict",
        "explain",
        "admin",
      ],
      "ai-engine-key-dev-2024": ["predict", "batch_predict", "explain"],
      "dashboard-service-key": ["predict", "explain", "metrics"],
      "data-intelligence-key": ["predict", "batch_predict", "features"],
    };

    return keyPermissions[apiKey] || ["predict"];
  }

  /**
   * Get user ID for an API key
   */
  private getApiKeyUserId(apiKey: string): string {
    const keyUsers: Record<string, string> = {
      "ai-engine-key-prod-2024": "ai-engine-prod",
      "ai-engine-key-dev-2024": "ai-engine-dev",
      "dashboard-service-key": "dashboard-service",
      "data-intelligence-key": "data-intelligence-service",
    };

    return keyUsers[apiKey] || "api-user";
  }

  /**
   * Check permissions for the requested resource
   */
  private async checkPermissions(
    authContext: AuthContext,
    context: Context
  ): Promise<void> {
    const { path, request } = context;
    const { permissions } = authContext;
    const method = request.method.toLowerCase();

    // Precompute routeKey for this request
    const routeKey: string = `${method.toUpperCase()} ${path}`;
    // Use precomputed Map for O(1) lookup
    const requiredPermissions: string[] | undefined =
      AuthMiddleware.ROUTE_PERMISSIONS_MAP.get(routeKey);

    // If no specific permissions required, allow
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return;
    }

    // Check if user has any of the required permissions
    const hasPermission: boolean = requiredPermissions.some(
      (permission: string) =>
        permissions.includes(permission) || permissions.includes("admin")
    );

    if (!hasPermission) {
      context.set.status = 403;
      throw new PermissionError(
        `Insufficient permissions. Required: ${requiredPermissions.join(
          " or "
        )}`
      );
    }

    // Documented for maintainability: permission check logic uses precomputed Map for fast lookup
    this.logger.debug("Permission check passed", {
      path,
      method,
      requiredPermissions,
      userPermissions: permissions,
    });
  }

  /**
   * Get client IP address
   */
  private getClientIp(request: Request): string {
    // Check various headers for client IP
    const xForwardedFor = request.headers.get("x-forwarded-for");
    const xRealIp = request.headers.get("x-real-ip");
    const cfConnectingIp = request.headers.get("cf-connecting-ip");

    if (xForwardedFor) {
      return xForwardedFor.split(",")[0].trim();
    }
    if (xRealIp) {
      return xRealIp;
    }
    if (cfConnectingIp) {
      return cfConnectingIp;
    }

    return "unknown";
  }

  /**
   * Record authentication event for monitoring
   */
  private async recordAuthEvent(
    eventType: string,
    context: Context,
    startTime: number,
    authContext?: AuthContext,
    error?: any
  ): Promise<void> {
    try {
      const duration = performance.now() - startTime;
      const { path, request } = context;

      const event = {
        type: eventType,
        path,
        method: request.method,
        timestamp: new Date().toISOString(),
        duration,
        clientIp: this.getClientIp(request),
        userAgent: request.headers.get("user-agent"),
        userId: authContext?.userId,
        apiKey: authContext?.apiKey
          ? this.maskApiKey(authContext.apiKey)
          : undefined,
        permissions: authContext?.permissions,
        error: error instanceof Error ? error.message : undefined,
      };

      // Batch metrics and logging for performance
      await Promise.all([
        this.metrics.recordCounter(`auth_event_${eventType}`),
        Promise.resolve(this.logger.debug("Auth event recorded", event)),
      ]);
    } catch (recordError) {
      this.logger.error("Failed to record auth event", recordError as Error);
    }
  }

  /**
   * Get authentication middleware health status
   */
  async getHealthStatus(): Promise<any> {
    /**
     * Get authentication middleware health status
     */
    return {
      status: "healthy",
      apiKeyCount: this.config.apiKeys.size,
      bypassRoutes: this.config.bypassRoutes.length,
    };
  }
}
