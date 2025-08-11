import { RedisClient, PostgreSQLClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { performance } from "perf_hooks";

export interface AuthRequest {
  token?: string;
  apiKey?: string;
  userId?: string;
  endpoint: string;
  method: string;
}

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  roles?: string[];
  permissions?: string[];
  rateLimitRemaining?: number;
  error?: string;
}

export interface RolePermission {
  role: string;
  permissions: string[];
}

export interface RateLimit {
  userId: string;
  endpoint: string;
  requests: number;
  windowStart: number;
  limit: number;
  windowMs: number;
}

/**
 * Security Service
 * Handles authentication, authorization, and rate limiting
 */
export class SecurityService {
  private readonly redis: RedisClient;
  private readonly postgres: PostgreSQLClient;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  // Default rate limits per endpoint
  private readonly defaultRateLimits = {
    "/v1/features/*": { requests: 1000, windowMs: 60000 }, // 1000/min
    "/v1/export/*": { requests: 100, windowMs: 60000 }, // 100/min
    "/v1/reports/*": { requests: 200, windowMs: 60000 }, // 200/min
    "/v1/gdpr/*": { requests: 10, windowMs: 60000 }, // 10/min
    "/v1/quality/*": { requests: 50, windowMs: 60000 }, // 50/min
    "/v1/reconciliation/*": { requests: 20, windowMs: 60000 }, // 20/min
    default: { requests: 100, windowMs: 60000 },
  };

  // Role-based permissions
  private readonly rolePermissions: RolePermission[] = [
    {
      role: "admin",
      permissions: ["*"], // Full access
    },
    {
      role: "analyst",
      permissions: [
        "features:read",
        "reports:read",
        "reports:generate",
        "analytics:read",
        "export:read",
      ],
    },
    {
      role: "operator",
      permissions: [
        "features:read",
        "features:compute",
        "quality:read",
        "reconciliation:read",
        "reconciliation:execute",
      ],
    },
    {
      role: "viewer",
      permissions: ["features:read", "reports:read", "analytics:read"],
    },
  ];

  constructor(
    redis: RedisClient,
    postgres: PostgreSQLClient,
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.redis = redis;
    this.postgres = postgres;
    this.logger = logger;
    this.metrics = metrics;
  }

  /**
   * Authenticate and authorize a request
   */
  async authenticate(request: AuthRequest): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      // Check API key authentication
      if (request.apiKey) {
        const apiKeyResult = await this.validateApiKey(request.apiKey);
        if (!apiKeyResult.authenticated) {
          await this.metrics.recordCounter("auth_api_key_failed");
          return apiKeyResult;
        }

        // Check rate limiting
        const rateLimitResult = await this.checkRateLimit(
          apiKeyResult.userId!,
          request.endpoint,
          request.method
        );

        if (rateLimitResult.exceeded) {
          await this.metrics.recordCounter("auth_rate_limit_exceeded");
          return {
            authenticated: false,
            error: "Rate limit exceeded",
            rateLimitRemaining: rateLimitResult.remaining,
          };
        }

        // Check permissions
        const hasPermission = await this.checkPermission(
          apiKeyResult.userId!,
          request.endpoint,
          request.method
        );

        if (!hasPermission) {
          await this.metrics.recordCounter("auth_permission_denied");
          return {
            authenticated: false,
            error: "Permission denied",
          };
        }

        await this.metrics.recordCounter("auth_success");
        await this.metrics.recordTimer(
          "auth_duration",
          performance.now() - startTime
        );

        return {
          authenticated: true,
          userId: apiKeyResult.userId,
          roles: apiKeyResult.roles,
          permissions: await this.getUserPermissions(apiKeyResult.userId!),
          rateLimitRemaining: rateLimitResult.remaining,
        };
      }

      // Check JWT token authentication
      if (request.token) {
        const tokenResult = await this.validateJwtToken(request.token);
        if (!tokenResult.authenticated) {
          await this.metrics.recordCounter("auth_jwt_failed");
          return tokenResult;
        }

        // Similar rate limiting and permission checks for JWT
        const rateLimitResult = await this.checkRateLimit(
          tokenResult.userId!,
          request.endpoint,
          request.method
        );

        if (rateLimitResult.exceeded) {
          await this.metrics.recordCounter("auth_rate_limit_exceeded");
          return {
            authenticated: false,
            error: "Rate limit exceeded",
            rateLimitRemaining: rateLimitResult.remaining,
          };
        }

        const hasPermission = await this.checkPermission(
          tokenResult.userId!,
          request.endpoint,
          request.method
        );

        if (!hasPermission) {
          await this.metrics.recordCounter("auth_permission_denied");
          return {
            authenticated: false,
            error: "Permission denied",
          };
        }

        await this.metrics.recordCounter("auth_success");
        await this.metrics.recordTimer(
          "auth_duration",
          performance.now() - startTime
        );

        return {
          authenticated: true,
          userId: tokenResult.userId,
          roles: tokenResult.roles,
          permissions: await this.getUserPermissions(tokenResult.userId!),
          rateLimitRemaining: rateLimitResult.remaining,
        };
      }

      // No authentication provided
      await this.metrics.recordCounter("auth_no_credentials");
      return {
        authenticated: false,
        error: "No authentication credentials provided",
      };
    } catch (error) {
      await this.metrics.recordCounter("auth_error");
      this.logger.error("Authentication error", error as Error, {
        endpoint: request.endpoint,
        method: request.method,
      });

      return {
        authenticated: false,
        error: "Authentication service error",
      };
    }
  }

  /**
   * Create a new API key for a user
   */
  async createApiKey(
    userId: string,
    name: string,
    expiresInDays?: number
  ): Promise<{ apiKey: string }> {
    try {
      const apiKey = `dai_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 32)}`;
      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      // Store in cache for fast access
      const redisClient = RedisClient.getInstance();
      const keyData = {
        userId,
        name,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt?.toISOString() || null,
        active: true,
      };

      await redisClient.setex(
        `api_key:${apiKey}`,
        86400 * 30,
        JSON.stringify(keyData)
      ); // 30 days cache

      await this.metrics.recordCounter("api_key_created");
      this.logger.info("API key created", { userId, name, expiresAt });

      return { apiKey };
    } catch (error) {
      this.logger.error("Failed to create API key", error as Error, {
        userId,
        name,
      });
      throw new Error(`Failed to create API key: ${(error as Error).message}`);
    }
  }

  /**
   * Validate API key
   */
  private async validateApiKey(apiKey: string): Promise<AuthResult> {
    try {
      const redisClient = RedisClient.getInstance();
      const keyData = await redisClient.get(`api_key:${apiKey}`);

      if (!keyData) {
        return { authenticated: false, error: "Invalid API key" };
      }

      const parsedData = JSON.parse(keyData);

      // Check if key is active
      if (!parsedData.active) {
        return { authenticated: false, error: "API key is disabled" };
      }

      // Check expiration
      if (parsedData.expiresAt && new Date(parsedData.expiresAt) < new Date()) {
        return { authenticated: false, error: "API key has expired" };
      }

      // Get user roles
      const userRoles = await this.getUserRoles(parsedData.userId);

      return {
        authenticated: true,
        userId: parsedData.userId,
        roles: userRoles,
      };
    } catch (error) {
      this.logger.error("API key validation error", error as Error, {
        apiKey: apiKey.substring(0, 10) + "...",
      });
      return { authenticated: false, error: "API key validation failed" };
    }
  }

  /**
   * Validate JWT token (simplified implementation)
   */
  private async validateJwtToken(token: string): Promise<AuthResult> {
    try {
      // In a real implementation, you would validate JWT signature, expiration, etc.
      // For now, this is a simplified version

      // Check if token exists in cache (for revoked tokens check)
      const redisClient = RedisClient.getInstance();
      const isRevoked = await redisClient.get(`revoked_token:${token}`);

      if (isRevoked) {
        return { authenticated: false, error: "Token has been revoked" };
      }

      // For demo purposes, extract userId from token (in real scenario, decode JWT)
      const tokenParts = token.split(".");
      if (tokenParts.length !== 3) {
        return { authenticated: false, error: "Invalid token format" };
      }

      // Simulate token validation - in reality you'd decode and verify
      const userId = "demo_user"; // Would be extracted from decoded JWT
      const userRoles = await this.getUserRoles(userId);

      return {
        authenticated: true,
        userId,
        roles: userRoles,
      };
    } catch (error) {
      this.logger.error("JWT validation error", error as Error);
      return { authenticated: false, error: "Token validation failed" };
    }
  }

  /**
   * Check rate limits for a user
   */
  private async checkRateLimit(
    userId: string,
    endpoint: string,
    method: string
  ): Promise<{
    exceeded: boolean;
    remaining: number;
  }> {
    try {
      const redisClient = RedisClient.getInstance();
      const rateLimitKey = `rate_limit:${userId}:${endpoint}:${method}`;

      // Get rate limit configuration for endpoint
      const config = this.getRateLimitConfig(endpoint);
      const now = Date.now();
      const windowStart = Math.floor(now / config.windowMs) * config.windowMs;

      // Get current count
      const currentData = await redisClient.get(rateLimitKey);
      let requests = 0;
      let storedWindowStart = windowStart;

      if (currentData) {
        const parsed = JSON.parse(currentData);
        if (parsed.windowStart === windowStart) {
          requests = parsed.requests;
          storedWindowStart = parsed.windowStart;
        }
      }

      // Check if limit exceeded
      if (requests >= config.requests) {
        return { exceeded: true, remaining: 0 };
      }

      // Increment counter
      const newData = {
        requests: requests + 1,
        windowStart: storedWindowStart,
      };

      await redisClient.setex(
        rateLimitKey,
        Math.ceil(config.windowMs / 1000),
        JSON.stringify(newData)
      );

      return {
        exceeded: false,
        remaining: config.requests - requests - 1,
      };
    } catch (error) {
      this.logger.error("Rate limit check error", error as Error, {
        userId,
        endpoint,
      });
      // On error, allow the request (fail open)
      return { exceeded: false, remaining: 100 };
    }
  }

  /**
   * Check if user has permission for endpoint/method
   */
  private async checkPermission(
    userId: string,
    endpoint: string,
    method: string
  ): Promise<boolean> {
    try {
      const userRoles = await this.getUserRoles(userId);
      const requiredPermission = this.getRequiredPermission(endpoint, method);

      for (const role of userRoles) {
        const rolePerms = this.rolePermissions.find((rp) => rp.role === role);
        if (rolePerms) {
          // Check for admin access
          if (rolePerms.permissions.includes("*")) {
            return true;
          }
          // Check for specific permission
          if (rolePerms.permissions.includes(requiredPermission)) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      this.logger.error("Permission check error", error as Error, {
        userId,
        endpoint,
      });
      // On error, deny access (fail closed)
      return false;
    }
  }

  /**
   * Get user roles from cache or database
   */
  private async getUserRoles(userId: string): Promise<string[]> {
    try {
      const redisClient = RedisClient.getInstance();
      const cached = await redisClient.get(`user_roles:${userId}`);

      if (cached) {
        return JSON.parse(cached);
      }

      // Default roles for demo - in reality would query database
      const defaultRoles = ["viewer"]; // Most restrictive default

      // Cache for 5 minutes
      await redisClient.setex(
        `user_roles:${userId}`,
        300,
        JSON.stringify(defaultRoles)
      );

      return defaultRoles;
    } catch (error) {
      this.logger.error("Failed to get user roles", error as Error, { userId });
      return ["viewer"]; // Safe default
    }
  }

  /**
   * Get user permissions
   */
  private async getUserPermissions(userId: string): Promise<string[]> {
    const roles = await this.getUserRoles(userId);
    const permissions = new Set<string>();

    for (const role of roles) {
      const rolePerms = this.rolePermissions.find((rp) => rp.role === role);
      if (rolePerms) {
        rolePerms.permissions.forEach((perm) => permissions.add(perm));
      }
    }

    return Array.from(permissions);
  }

  /**
   * Get rate limit configuration for endpoint
   */
  private getRateLimitConfig(endpoint: string): {
    requests: number;
    windowMs: number;
  } {
    // Find matching pattern
    for (const pattern in this.defaultRateLimits) {
      if (pattern === "default") continue;

      // Simple pattern matching (could be enhanced with regex)
      if (endpoint.startsWith(pattern.replace("*", ""))) {
        return this.defaultRateLimits[
          pattern as keyof typeof this.defaultRateLimits
        ];
      }
    }

    return this.defaultRateLimits.default;
  }

  /**
   * Map endpoint and method to required permission
   */
  private getRequiredPermission(endpoint: string, method: string): string {
    const pathSegments = endpoint.split("/").filter((s) => s);

    if (pathSegments.length < 2) return "unknown";

    const resource = pathSegments[1]; // e.g., 'features', 'reports', etc.
    const action =
      method.toLowerCase() === "get"
        ? "read"
        : method.toLowerCase() === "post"
        ? "write"
        : method.toLowerCase() === "put"
        ? "write"
        : method.toLowerCase() === "delete"
        ? "delete"
        : "read";

    return `${resource}:${action}`;
  }

  /**
   * Get security status and metrics
   */
  async getSecurityStatus(): Promise<{
    activeApiKeys: number;
    rateLimitViolations24h: number;
    authFailures24h: number;
    securityHealth: "healthy" | "warning" | "critical";
  }> {
    try {
      const redisClient = RedisClient.getInstance();

      // Count active API keys (simplified)
      const apiKeyKeys = await redisClient.keys("api_key:*");
      const activeApiKeys = apiKeyKeys.length;

      // Get metrics from the last 24 hours (simplified)
      const rateLimitViolations24h = 0; // Would query metrics
      const authFailures24h = 0; // Would query metrics

      let securityHealth: "healthy" | "warning" | "critical" = "healthy";

      if (authFailures24h > 100) {
        securityHealth = "critical";
      } else if (authFailures24h > 20 || rateLimitViolations24h > 50) {
        securityHealth = "warning";
      }

      return {
        activeApiKeys,
        rateLimitViolations24h,
        authFailures24h,
        securityHealth,
      };
    } catch (error) {
      this.logger.error("Failed to get security status", error as Error);
      throw new Error(
        `Failed to get security status: ${(error as Error).message}`
      );
    }
  }
}
