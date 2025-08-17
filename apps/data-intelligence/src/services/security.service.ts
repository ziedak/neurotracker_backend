import { RedisClient, PostgreSQLClient } from "@libs/database";
import { Logger, MetricsCollector } from "@libs/monitoring";
import { PasswordService, JWTService } from "@libs/auth";
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
  /**
   * Register a new user
   * Uses PostgreSQL (Prisma) for user storage, checks for duplicates, hashes password
   */
  async registerUser({
    email,
    password,
    name,
  }: {
    email: string;
    password: string;
    name: string;
  }) {
    const prisma = PostgreSQLClient.getInstance();
    try {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing)
        return { success: false, error: "Email already registered" };
      const passwordValidation = PasswordService.validatePassword(password);
      if (!passwordValidation.valid)
        return { success: false, error: passwordValidation.errors.join(", ") };
      const hashed = await PasswordService.hash(password);
      const user = await prisma.user.create({
        data: { email, password: hashed, name },
      });
      this.logger.info("User registered", { userId: user.id, email });
      await this.metrics.recordCounter("user_registered");
      return { success: true, userId: user.id };
    } catch (error) {
      this.logger.error("User registration failed", error as Error, { email });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Initiate password reset (send token via email, store in Redis)
   */
  async initiatePasswordReset(email: string) {
    const prisma = PostgreSQLClient.getInstance();
    const redis = RedisClient.getInstance();
    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return { success: false, error: "User not found" };
      const token = `reset_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 16)}`;
      await redis.setex(`password_reset:${token}`, 3600, user.id.toString());
      // TODO: Send email with token
      this.logger.info("Password reset initiated", { userId: user.id, email });
      await this.metrics.recordCounter("password_reset_initiated");
      return { success: true };
    } catch (error) {
      this.logger.error("Password reset failed", error as Error, { email });
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Refresh authentication token (validate refresh token, issue new JWT)
   */
  async refreshToken(refreshToken: string) {
    const redis = RedisClient.getInstance();
    try {
      const jwtService = JWTService.getInstance();
      const payload = await jwtService.verifyRefreshToken(refreshToken);
      if (!payload) return { success: false, error: "Invalid refresh token" };
      const revoked = await redis.get(`revoked_token:${refreshToken}`);
      if (revoked) return { success: false, error: "Token revoked" };
      const prisma = PostgreSQLClient.getInstance();
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) return { success: false, error: "User not found" };
      // Fetch roles from UserRole relation
      const roles = await prisma.userRole.findMany({
        where: { userId: user.id },
      });
      const roleNames = roles.map((r) => r.role);
      // Derive permissions from roles using your mapping

      const tokens = await jwtService.generateTokens({
        sub: user.id,
        email: user.email,
        role: this.mapRoleToJwt(roleNames[0]),
        permissions: this.getUserPermissionsFromRoles(roleNames),
      });
      this.logger.info("Token refreshed", { userId: user.id });
      await this.metrics.recordCounter("token_refreshed");
      return {
        success: true,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error) {
      this.logger.error("Token refresh failed", error as Error);
      return { success: false, error: (error as Error).message };
    }
  }
  private mapRoleToJwt(
    role?: string
  ): "admin" | "store_owner" | "api_user" | "customer" {
    switch ((role || "").toLowerCase()) {
      case "admin":
        return "admin";
      case "store_owner":
      case "owner":
        return "store_owner";
      case "api_user":
      case "user":
        return "api_user";
      case "customer":
      case "viewer":
        return "customer";
      default:
        return "customer";
    }
  }
  /**
   * Maps an array of role names to a deduplicated array of permissions.
   * @param roleNames Array of role names assigned to the user
   * @returns Array of permissions (deduplicated)
   */
  getUserPermissionsFromRoles(roleNames: string[]): string[] {
    const permissions = new Set<string>();
    for (const roleName of roleNames) {
      const rolePerm = this.rolePermissions.find((rp) => rp.role === roleName);
      if (rolePerm) {
        rolePerm.permissions.forEach((perm) => permissions.add(perm));
      }
    }
    return Array.from(permissions);
  }
  /**
   * Logout (invalidate token in Redis)
   */
  async logout(token: string) {
    const redis = RedisClient.getInstance();
    try {
      await redis.setex(`revoked_token:${token}`, 86400, "1");
      this.logger.info("User logged out", { token });
      await this.metrics.recordCounter("user_logged_out");
      return { success: true };
    } catch (error) {
      this.logger.error("Logout failed", error as Error);
      return { success: false, error: (error as Error).message };
    }
  }
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
      const redisClient = RedisClient.getInstance();
      const isRevoked = await redisClient.get(`revoked_token:${token}`);
      if (isRevoked) {
        return { authenticated: false, error: "Token has been revoked" };
      }
      const jwtService = JWTService.getInstance();
      // Use the actual method name from your JWTService
      const payload = await jwtService.verifyToken(token);
      if (!payload || !payload.sub) {
        return { authenticated: false, error: "Invalid or expired token" };
      }
      const userId = payload.sub;
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
      // Query roles from database
      const prisma = PostgreSQLClient.getInstance();
      const roles = await prisma.userRole.findMany({ where: { userId } });
      const roleNames = roles.map((r) => r.role);
      // Cache for 5 minutes
      await redisClient.setex(
        `user_roles:${userId}`,
        300,
        JSON.stringify(roleNames)
      );
      return roleNames.length > 0 ? roleNames : ["viewer"];
    } catch (error) {
      this.logger.error("Failed to get user roles", error as Error, { userId });
      return ["viewer"];
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
    /**
     * Maps endpoint and HTTP method to required permission string.
     * @param endpoint API endpoint path (e.g., '/v1/features/list')
     * @param method HTTP method (GET, POST, PUT, DELETE)
     * @returns Permission string (e.g., 'features:read')
     */
    const pathSegments = endpoint.split("/").filter((s) => s);
    if (pathSegments.length < 2) return "unknown";
    const resource = pathSegments[1]; // e.g., 'features', 'reports', etc.
    let action: string;
    switch (method.toLowerCase()) {
      case "get":
        action = "read";
        break;
      case "post":
      case "put":
        action = "write";
        break;
      case "delete":
        action = "delete";
        break;
      default:
        action = "unknown";
    }
    return `${resource}:${action}`;
  }
}
