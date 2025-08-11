import { Context } from "@libs/elysia-server";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";

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
    const startTime = performance.now();
    const { request, path } = context;

    try {
      // Check if route should bypass authentication
      if (this.shouldBypassAuth(path)) {
        const duration = performance.now() - startTime;
        await this.metrics.recordTimer("auth_bypass_duration", duration);

        this.logger.debug("Authentication bypassed", {
          path,
          duration: Math.round(duration),
        });
        return;
      }

      // Extract authentication credentials
      const authHeader = request.headers.get("authorization");
      const apiKeyHeader = request.headers.get("x-api-key");

      if (!authHeader && !apiKeyHeader) {
        await this.recordAuthEvent(
          "auth_missing_credentials",
          context,
          startTime
        );
        context.set.status = 401;
        throw new Error(
          "Authentication required - provide Authorization header or X-API-Key"
        );
      }

      let authContext: AuthContext;

      if (apiKeyHeader) {
        // API key authentication
        authContext = await this.authenticateApiKey(apiKeyHeader, context);
      } else if (authHeader) {
        // JWT or other token authentication
        authContext = await this.authenticateToken(authHeader, context);
      } else {
        await this.recordAuthEvent("auth_invalid_method", context, startTime);
        context.set.status = 401;
        throw new Error("Invalid authentication method");
      }

      // Check permissions for the requested resource
      await this.checkPermissions(authContext, context);

      // Add auth context to request for downstream use
      (context as any).auth = authContext;

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("auth_success_duration", duration);
      await this.metrics.recordCounter("auth_success");

      this.logger.debug("Authentication successful", {
        path,
        userId: authContext.userId,
        apiKey: authContext.apiKey?.substring(0, 8) + "...",
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

      // Set appropriate error response
      context.set.status = context.set.status || 401;
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
        throw new Error("Invalid API key");
      }

      // Determine permissions based on API key
      const permissions = this.getApiKeyPermissions(apiKey);

      const authContext: AuthContext = {
        apiKey,
        permissions,
        authenticated: true,
        // For API keys, we might derive userId from the key or set to service name
        userId: this.getApiKeyUserId(apiKey),
      };

      const duration = performance.now() - startTime;
      await this.metrics.recordTimer("auth_api_key_duration", duration);

      this.logger.debug("API key authentication successful", {
        apiKey: apiKey.substring(0, 8) + "...",
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
      // Extract token from "Bearer <token>" format
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!tokenMatch) {
        context.set.status = 401;
        throw new Error(
          'Invalid Authorization header format - expected "Bearer <token>"'
        );
      }

      const token = tokenMatch[1];

      // In a real implementation, this would validate JWT tokens
      // For now, we'll do basic validation
      if (token.length < 20) {
        context.set.status = 401;
        throw new Error("Invalid token format");
      }

      // Simulate token validation and user extraction
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
        throw new Error("Invalid JWT format");
      }

      // Simulate decoding (in production, use proper JWT library)
      const payload = this.decodeTokenPayload(token);

      return {
        userId: payload.userId || "user-" + Date.now(),
        permissions: payload.permissions || ["predict", "explain"],
        authenticated: true,
      };
    } catch (error) {
      throw new Error(
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
      if (payload.exp && payload.exp < Date.now() / 1000) {
        throw new Error("Token expired");
      }

      return payload;
    } catch (error) {
      throw new Error("Failed to decode token");
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

    // Define route permission requirements
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

    const routeKey = `${method.toUpperCase()} ${path}`;
    const requiredPermissions = routePermissions[routeKey];

    // If no specific permissions required, allow
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return;
    }

    // Check if user has any of the required permissions
    const hasPermission = requiredPermissions.some(
      (permission) =>
        permissions.includes(permission) || permissions.includes("admin")
    );

    if (!hasPermission) {
      context.set.status = 403;
      throw new Error(
        `Insufficient permissions. Required: ${requiredPermissions.join(
          " or "
        )}`
      );
    }

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
        permissions: authContext?.permissions,
        error: error instanceof Error ? error.message : undefined,
      };

      // Record in metrics
      await this.metrics.recordCounter(`auth_event_${eventType}`);

      this.logger.debug("Auth event recorded", event);
    } catch (recordError) {
      this.logger.error("Failed to record auth event", recordError as Error);
    }
  }

  /**
   * Get authentication middleware health status
   */
  async getHealthStatus(): Promise<any> {
    return {
      status: "healthy",
      apiKeyCount: this.config.apiKeys.size,
      bypassRoutes: this.config.bypassRoutes.length,
    };
  }
}
