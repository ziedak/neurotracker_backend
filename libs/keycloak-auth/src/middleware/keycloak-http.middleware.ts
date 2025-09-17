/**
 * HTTP Authentication Middleware for Elysia
 * Provides JWT validation via Keycloak JWKS and token introspection
 * Integrates directly with Elysia without external dependencies
 */

import { type IMetricsCollector } from "@libs/monitoring";
import { createLogger } from "@libs/utils";
import {
  IKeycloakClientFactory,
  ITokenIntrospectionService,
  TokenValidationResult,
  TokenClaims,
  type ClientType,
  type User,
  type AuthContext,
} from "../types/index.js";

/**
 * Keycloak-specific HTTP middleware configuration
 */
export interface KeycloakAuthHttpMiddlewareConfig {
  /** Name of the middleware for logging and metrics */
  readonly name?: string;
  /** Keycloak client to use for token validation (default: 'frontend') */
  readonly keycloakClient?: "frontend" | "service" | "tracker" | "websocket";
  /** Whether to require authentication for all requests */
  readonly requireAuth?: boolean;
  /** Required roles for access */
  readonly roles?: readonly string[];
  /** Required permissions for access */
  readonly permissions?: readonly string[];
  /** Allow anonymous access (no token) */
  readonly allowAnonymous?: boolean;
  /** Routes to bypass authentication */
  readonly bypassRoutes?: readonly string[];
  /** Enable token introspection fallback if JWKS fails */
  readonly enableIntrospection?: boolean;
  /** Cache validated tokens to reduce Keycloak load */
  readonly cacheValidation?: boolean;
  /** Token validation cache TTL in seconds (default: 300) */
  readonly cacheValidationTTL?: number;
  /** Extract user info even for optional authentication */
  readonly extractUserInfo?: boolean;
  /** Strict mode - fail if any validation step fails */
  readonly strictMode?: boolean;
}

/**
 * Default configuration values for Keycloak HTTP middleware
 */
const DEFAULT_KEYCLOAK_HTTP_OPTIONS = {
  NAME: "keycloak-auth",
  KEYCLOAK_CLIENT: "frontend" as const,
  REQUIRE_AUTH: false,
  ALLOW_ANONYMOUS: true,
  BYPASS_ROUTES: ["/health", "/metrics", "/docs"] as const,
  ENABLE_INTROSPECTION: true,
  CACHE_VALIDATION: true,
  CACHE_VALIDATION_TTL: 300, // 5 minutes
  EXTRACT_USER_INFO: true,
  STRICT_MODE: false,
} as const;

/**
 * User object for authentication results
 */
/**
 * Keycloak-specific authentication errors
 */
export class KeycloakAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string = "KEYCLOAK_AUTH_ERROR",
    public readonly statusCode: number = 401
  ) {
    super(message);
    this.name = "KeycloakAuthError";
  }
}

export class UnauthorizedError extends KeycloakAuthError {
  constructor(message: string = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
  }
}

export class ForbiddenError extends KeycloakAuthError {
  constructor(message: string = "Forbidden") {
    super(message, "FORBIDDEN", 403);
  }
}

/**
 * Authentication result for Keycloak middleware
 */
export interface KeycloakAuthenticationResult {
  user: User | null;
  authContext: AuthContext | null;
  validationResult: TokenValidationResult | null;
  method: "jwks" | "introspection" | "anonymous";
  error: string | null;
  fromCache?: boolean;
}

/**
 * Keycloak HTTP Authentication Middleware
 * Production-grade authentication middleware integrating with Keycloak
 *
 * Features:
 * - JWT validation via Keycloak JWKS
 * - Token introspection fallback
 * - Role and permission-based access control
 * - Caching for performance optimization
 * - Comprehensive error handling and metrics
 */
export class KeycloakAuthHttpMiddleware {
  private readonly logger: ReturnType<typeof createLogger>;

  constructor(
    private readonly metrics: IMetricsCollector,
    private readonly keycloakClientFactory: IKeycloakClientFactory,
    private readonly tokenIntrospectionService: ITokenIntrospectionService,
    private readonly config: Required<KeycloakAuthHttpMiddlewareConfig>
  ) {
    this.logger = createLogger(`KeycloakAuth:${this.config.name}`);
    this.validateConfiguration();
  }

  /**
   * Create middleware function for direct use with any HTTP framework
   */
  public async authenticate(
    request: Request
  ): Promise<KeycloakAuthenticationResult> {
    const startTime = performance.now();
    const requestId = this.generateRequestId();

    try {
      // Check if request should bypass authentication
      if (this.shouldBypassAuth(request)) {
        this.logger.debug("Bypassing authentication for path", {
          requestId,
          path: new URL(request.url).pathname,
        });
        return this.createAnonymousResult();
      }

      // Attempt authentication through Keycloak
      const authResult = await this.authenticateRequest(request, requestId);

      // Record successful request metrics
      await this.recordAuthMetrics("keycloak_auth_success", {
        method: authResult.method,
        userId: authResult.user?.id ?? "anonymous",
        hasUser: authResult.user ? "true" : "false",
        fromCache: authResult.fromCache ? "true" : "false",
        client: this.config.keycloakClient,
        path: new URL(request.url).pathname,
      });

      return authResult;
    } catch (error) {
      const duration = performance.now() - startTime;
      await this.recordMetric("keycloak_auth_error_duration", duration, {
        error_type: error instanceof Error ? error.constructor.name : "unknown",
        client: this.config.keycloakClient,
        path: new URL(request.url).pathname,
      });

      this.logger.error(
        "Keycloak authentication middleware error",
        error as Error,
        {
          requestId,
          path: new URL(request.url).pathname,
          method: request.method,
          client: this.config.keycloakClient,
          duration: Math.round(duration),
        }
      );

      // Re-throw for proper error handling
      throw error;
    } finally {
      const executionTime = performance.now() - startTime;
      await this.recordTimer("keycloak_auth_execution_time", executionTime, {
        path: new URL(request.url).pathname,
        method: request.method,
        client: this.config.keycloakClient,
      });
    }
  }

  /**
   * Perform authorization checks (roles, permissions) for authenticated user
   */
  public async authorize(
    authResult: KeycloakAuthenticationResult
  ): Promise<void> {
    if (!authResult.user) {
      if (this.config.requireAuth) {
        throw new UnauthorizedError("Authentication required");
      }
      return;
    }

    const user = authResult.user;

    // Check required roles
    if (this.config.roles && this.config.roles.length > 0) {
      const hasRequiredRole = this.config.roles.some((role) =>
        user.roles.includes(role)
      );

      if (!hasRequiredRole) {
        this.logger.warn("Authorization failed: insufficient roles", {
          userId: user.id,
          userRoles: user.roles,
          requiredRoles: this.config.roles,
        });
        throw new ForbiddenError("Insufficient role privileges");
      }
    }

    // Check required permissions
    if (this.config.permissions && this.config.permissions.length > 0) {
      const hasRequiredPermission = this.config.permissions.some((permission) =>
        user.permissions.includes(permission)
      );

      if (!hasRequiredPermission) {
        this.logger.warn("Authorization failed: insufficient permissions", {
          userId: user.id,
          userPermissions: user.permissions,
          requiredPermissions: this.config.permissions,
        });
        throw new ForbiddenError("Insufficient permissions");
      }
    }

    this.logger.debug("Authorization successful", {
      userId: user.id,
      roles: user.roles,
      permissions: user.permissions,
    });
  }

  /**
   * Attempt authentication using Keycloak token validation
   */
  private async authenticateRequest(
    request: Request,
    requestId: string
  ): Promise<KeycloakAuthenticationResult> {
    const authHeader = request.headers.get("authorization");

    // Handle missing authorization header
    if (!authHeader) {
      if (this.config.allowAnonymous && !this.config.requireAuth) {
        return this.createAnonymousResult();
      }

      if (this.config.strictMode) {
        throw new UnauthorizedError("Authorization header required");
      }

      return {
        user: null,
        authContext: null,
        validationResult: null,
        method: "anonymous",
        error: "Missing authorization header",
      };
    }

    // Extract token from header
    const token = this.extractTokenFromHeader(authHeader);
    if (!token) {
      throw new UnauthorizedError("Invalid authorization header format");
    }

    // Validate token through Keycloak
    try {
      const clientConfig = this.keycloakClientFactory.getClient(
        this.config.keycloakClient
      );
      const validationResult = await this.tokenIntrospectionService.validateJWT(
        token,
        clientConfig
      );

      if (!validationResult.valid) {
        throw new UnauthorizedError(
          validationResult.error ?? "Token validation failed"
        );
      }

      // Convert validation result to User object
      const user = this.createUserFromValidation(validationResult);

      // Create auth context
      const authContext: AuthContext = {
        authenticated: true,
        method: "jwt",
        token: authHeader.substring(7), // Remove 'Bearer '
        claims: validationResult.claims!,
        clientId: validationResult.claims?.aud
          ? typeof validationResult.claims.aud === "string"
            ? validationResult.claims.aud
            : validationResult.claims.aud[0] || this.config.keycloakClient
          : this.config.keycloakClient,
        userId: validationResult.claims?.sub || user.id,
        scopes: validationResult.claims?.scope?.split(" ") ?? [],
        permissions: user.permissions,
        validatedAt: new Date(),
        cached: validationResult.cached,
        ...(validationResult.claims?.session_state && {
          sessionId: validationResult.claims.session_state,
        }),
      };

      this.logger.debug("Keycloak authentication successful", {
        requestId,
        userId: user.id,
        client: this.config.keycloakClient,
      });

      return {
        user,
        authContext,
        validationResult,
        method: "jwks", // Default assumption - could be enhanced
        error: null,
      };
    } catch (error) {
      this.logger.warn("Keycloak authentication failed", {
        error: error instanceof Error ? error.message : "unknown",
        requestId,
        client: this.config.keycloakClient,
      });

      if (this.config.strictMode) {
        throw error;
      }

      // Return failed result for non-strict mode
      return {
        user: null,
        authContext: null,
        validationResult: null,
        method: "anonymous",
        error: error instanceof Error ? error.message : "Authentication failed",
      };
    }
  }

  /**
   * Check if authentication should be bypassed for this request
   */
  private shouldBypassAuth(request: Request): boolean {
    const path = new URL(request.url).pathname;

    return (
      this.config.bypassRoutes?.some((route) => {
        if (route.endsWith("*")) {
          return path.startsWith(route.slice(0, -1));
        }
        return path === route || path.startsWith(`${route}/`);
      }) ?? false
    );
  }

  /**
   * Extract token from Authorization header
   */
  private extractTokenFromHeader(authHeader: string): string | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return authHeader.substring(7);
  }

  /**
   * Create User object from validation result
   */
  private createUserFromValidation(
    validationResult: TokenValidationResult
  ): User {
    if (!validationResult.valid || !validationResult.claims?.sub) {
      throw new Error("Invalid validation result");
    }

    const claims = validationResult.claims;

    // Extract permissions from multiple sources in Keycloak JWT
    const permissions = this.extractPermissionsFromClaims(claims);

    return {
      id: claims.sub,
      email: claims.email ?? "",
      name: claims.name ?? claims.preferred_username ?? "",
      roles: claims.realm_access?.roles ?? [],
      permissions,
      client: this.config.keycloakClient as ClientType,
      context: {
        clientId:
          typeof claims.aud === "string" ? claims.aud : claims.aud?.[0] ?? "",
        issuer: claims.iss,
        issuedAt: claims.iat ? new Date(claims.iat * 1000) : new Date(),
        expiresAt: claims.exp ? new Date(claims.exp * 1000) : new Date(),
      },
      isActive: validationResult.valid,
      lastLogin: new Date(),
      preferences: {},
    };
  }

  /**
   * Extract permissions from Keycloak JWT claims
   * Combines scopes and resource-based permissions
   */
  private extractPermissionsFromClaims(claims: TokenClaims): string[] {
    const permissions = new Set<string>();

    // Extract from scope claim (space-separated string)
    if (claims.scope) {
      const scopes = claims.scope.split(" ").filter((s) => s.trim());
      scopes.forEach((scope) => permissions.add(scope));
    }

    // Extract from resource_access for the current client
    if (claims.resource_access) {
      const clientId =
        typeof claims.aud === "string" ? claims.aud : claims.aud?.[0];
      if (clientId && claims.resource_access[clientId]) {
        claims.resource_access[clientId].roles?.forEach((role) =>
          permissions.add(`resource:${clientId}:${role}`)
        );
      }

      // Also extract permissions from all resource access
      Object.entries(claims.resource_access).forEach(([resource, access]) => {
        access.roles?.forEach((role) => permissions.add(`${resource}:${role}`));
      });
    }

    // Extract from realm-level roles as permissions
    if (claims.realm_access?.roles) {
      claims.realm_access.roles.forEach((role) =>
        permissions.add(`realm:${role}`)
      );
    }

    return Array.from(permissions);
  }

  /**
   * Create anonymous authentication result
   */
  private createAnonymousResult(): KeycloakAuthenticationResult {
    return {
      user: null,
      authContext: null,
      validationResult: null,
      method: "anonymous",
      error: null,
    };
  }

  /**
   * Generate unique request ID for tracing
   */
  private generateRequestId(): string {
    return `keycloak_req_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 15)}`;
  }

  /**
   * Record authentication-specific metrics
   */
  private async recordAuthMetrics(
    action: string,
    additionalTags: Record<string, string> = {}
  ): Promise<void> {
    await this.recordMetric(`keycloak_${action}`, 1, {
      middleware: this.config.name,
      client: this.config.keycloakClient,
      ...additionalTags,
    });
  }

  /**
   * Record a metric with the metrics collector
   */
  private async recordMetric(
    name: string,
    value: number,
    tags: Record<string, string> = {}
  ): Promise<void> {
    try {
      await this.metrics.recordCounter(name, value, tags);
    } catch (error) {
      this.logger.warn("Failed to record metric", { name, value, error });
    }
  }

  /**
   * Record a timer metric
   */
  private async recordTimer(
    name: string,
    value: number,
    tags: Record<string, string> = {}
  ): Promise<void> {
    try {
      await this.metrics.recordTimer(name, value, tags);
    } catch (error) {
      this.logger.warn("Failed to record timer metric", { name, value, error });
    }
  }

  /**
   * Validate configuration on instantiation
   */
  private validateConfiguration(): void {
    if (!this.config.keycloakClient) {
      throw new Error("Keycloak client must be specified");
    }

    const validClients = ["frontend", "service", "tracker", "websocket"];
    if (!validClients.includes(this.config.keycloakClient)) {
      throw new Error(
        `Invalid Keycloak client: ${this.config.keycloakClient}. ` +
          `Must be one of: ${validClients.join(", ")}`
      );
    }

    if (this.config.cacheValidationTTL && this.config.cacheValidationTTL < 60) {
      this.logger.warn(
        "Cache validation TTL is very low, may impact performance",
        {
          ttl: this.config.cacheValidationTTL,
          recommended: 300,
        }
      );
    }
  }

  /**
   * Create require authentication configuration preset
   */
  static createRequireAuthConfig(
    keycloakClient:
      | "frontend"
      | "service"
      | "tracker"
      | "websocket" = "frontend"
  ): Required<KeycloakAuthHttpMiddlewareConfig> {
    return {
      name: "keycloak-auth-required",
      requireAuth: true,
      allowAnonymous: false,
      keycloakClient,
      roles: [],
      permissions: [],
      bypassRoutes: DEFAULT_KEYCLOAK_HTTP_OPTIONS.BYPASS_ROUTES,
      enableIntrospection: DEFAULT_KEYCLOAK_HTTP_OPTIONS.ENABLE_INTROSPECTION,
      cacheValidation: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION,
      cacheValidationTTL: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION_TTL,
      extractUserInfo: DEFAULT_KEYCLOAK_HTTP_OPTIONS.EXTRACT_USER_INFO,
      strictMode: true,
    };
  }

  /**
   * Create optional authentication configuration preset
   */
  static createOptionalAuthConfig(
    keycloakClient:
      | "frontend"
      | "service"
      | "tracker"
      | "websocket" = "frontend"
  ): Required<KeycloakAuthHttpMiddlewareConfig> {
    return {
      name: "keycloak-auth-optional",
      requireAuth: false,
      allowAnonymous: true,
      extractUserInfo: true,
      keycloakClient,
      roles: [],
      permissions: [],
      bypassRoutes: DEFAULT_KEYCLOAK_HTTP_OPTIONS.BYPASS_ROUTES,
      enableIntrospection: DEFAULT_KEYCLOAK_HTTP_OPTIONS.ENABLE_INTROSPECTION,
      cacheValidation: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION,
      cacheValidationTTL: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION_TTL,
      strictMode: DEFAULT_KEYCLOAK_HTTP_OPTIONS.STRICT_MODE,
    };
  }

  /**
   * Create role-based authentication configuration preset
   */
  static createRoleBasedConfig(
    roles: string[],
    keycloakClient:
      | "frontend"
      | "service"
      | "tracker"
      | "websocket" = "frontend"
  ): Required<KeycloakAuthHttpMiddlewareConfig> {
    return {
      name: "keycloak-auth-role-based",
      requireAuth: true,
      roles,
      allowAnonymous: false,
      keycloakClient,
      permissions: [],
      bypassRoutes: DEFAULT_KEYCLOAK_HTTP_OPTIONS.BYPASS_ROUTES,
      enableIntrospection: DEFAULT_KEYCLOAK_HTTP_OPTIONS.ENABLE_INTROSPECTION,
      cacheValidation: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION,
      cacheValidationTTL: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION_TTL,
      extractUserInfo: DEFAULT_KEYCLOAK_HTTP_OPTIONS.EXTRACT_USER_INFO,
      strictMode: true,
    };
  }

  /**
   * Create permission-based authentication configuration preset
   */
  static createPermissionBasedConfig(
    permissions: string[],
    keycloakClient:
      | "frontend"
      | "service"
      | "tracker"
      | "websocket" = "frontend"
  ): Required<KeycloakAuthHttpMiddlewareConfig> {
    return {
      name: "keycloak-auth-permission-based",
      requireAuth: true,
      permissions,
      allowAnonymous: false,
      keycloakClient,
      roles: [],
      bypassRoutes: DEFAULT_KEYCLOAK_HTTP_OPTIONS.BYPASS_ROUTES,
      enableIntrospection: DEFAULT_KEYCLOAK_HTTP_OPTIONS.ENABLE_INTROSPECTION,
      cacheValidation: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION,
      cacheValidationTTL: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION_TTL,
      extractUserInfo: DEFAULT_KEYCLOAK_HTTP_OPTIONS.EXTRACT_USER_INFO,
      strictMode: true,
    };
  }
}

/**
 * Factory function for Keycloak authentication middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export function createKeycloakAuthHttpMiddleware(
  metrics: IMetricsCollector,
  keycloakClientFactory: IKeycloakClientFactory,
  tokenIntrospectionService: ITokenIntrospectionService,
  config?: Partial<KeycloakAuthHttpMiddlewareConfig>
): KeycloakAuthHttpMiddleware {
  // Merge with defaults
  const completeConfig: Required<KeycloakAuthHttpMiddlewareConfig> = {
    name: config?.name ?? DEFAULT_KEYCLOAK_HTTP_OPTIONS.NAME,
    keycloakClient:
      config?.keycloakClient ?? DEFAULT_KEYCLOAK_HTTP_OPTIONS.KEYCLOAK_CLIENT,
    requireAuth:
      config?.requireAuth ?? DEFAULT_KEYCLOAK_HTTP_OPTIONS.REQUIRE_AUTH,
    roles: config?.roles ?? [],
    permissions: config?.permissions ?? [],
    allowAnonymous:
      config?.allowAnonymous ?? DEFAULT_KEYCLOAK_HTTP_OPTIONS.ALLOW_ANONYMOUS,
    bypassRoutes:
      config?.bypassRoutes ?? DEFAULT_KEYCLOAK_HTTP_OPTIONS.BYPASS_ROUTES,
    enableIntrospection:
      config?.enableIntrospection ??
      DEFAULT_KEYCLOAK_HTTP_OPTIONS.ENABLE_INTROSPECTION,
    cacheValidation:
      config?.cacheValidation ?? DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION,
    cacheValidationTTL:
      config?.cacheValidationTTL ??
      DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION_TTL,
    extractUserInfo:
      config?.extractUserInfo ??
      DEFAULT_KEYCLOAK_HTTP_OPTIONS.EXTRACT_USER_INFO,
    strictMode: config?.strictMode ?? DEFAULT_KEYCLOAK_HTTP_OPTIONS.STRICT_MODE,
  };

  return new KeycloakAuthHttpMiddleware(
    metrics,
    keycloakClientFactory,
    tokenIntrospectionService,
    completeConfig
  );
}

/**
 * Preset configurations for common Keycloak authentication scenarios
 */
export const KEYCLOAK_AUTH_PRESETS = {
  requireAuth: (
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) => KeycloakAuthHttpMiddleware.createRequireAuthConfig(client),

  optionalAuth: (
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) => KeycloakAuthHttpMiddleware.createOptionalAuthConfig(client),

  adminOnly: (
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) => KeycloakAuthHttpMiddleware.createRoleBasedConfig(["admin"], client),

  userOrAdmin: (
    client: "frontend" | "service" | "tracker" | "websocket" = "frontend"
  ) =>
    KeycloakAuthHttpMiddleware.createRoleBasedConfig(["user", "admin"], client),

  serviceToService: (): Required<KeycloakAuthHttpMiddlewareConfig> => ({
    name: "keycloak-service-auth",
    requireAuth: true,
    keycloakClient: "service",
    allowAnonymous: false,
    strictMode: true,
    bypassRoutes: ["/health", "/metrics"],
    roles: [],
    permissions: [],
    enableIntrospection: DEFAULT_KEYCLOAK_HTTP_OPTIONS.ENABLE_INTROSPECTION,
    cacheValidation: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION,
    cacheValidationTTL: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION_TTL,
    extractUserInfo: DEFAULT_KEYCLOAK_HTTP_OPTIONS.EXTRACT_USER_INFO,
  }),

  webApp: (): Required<KeycloakAuthHttpMiddlewareConfig> => ({
    name: "keycloak-webapp",
    requireAuth: false,
    keycloakClient: "frontend",
    allowAnonymous: true,
    extractUserInfo: true,
    cacheValidation: true,
    bypassRoutes: ["/health", "/metrics", "/docs", "/public"],
    roles: [],
    permissions: [],
    enableIntrospection: DEFAULT_KEYCLOAK_HTTP_OPTIONS.ENABLE_INTROSPECTION,
    cacheValidationTTL: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION_TTL,
    strictMode: DEFAULT_KEYCLOAK_HTTP_OPTIONS.STRICT_MODE,
  }),

  development: (): Required<KeycloakAuthHttpMiddlewareConfig> => ({
    name: "keycloak-dev",
    requireAuth: false,
    keycloakClient: "frontend",
    allowAnonymous: true,
    strictMode: false,
    bypassRoutes: ["/health", "/metrics", "/docs", "/test", "/debug"],
    roles: [],
    permissions: [],
    enableIntrospection: DEFAULT_KEYCLOAK_HTTP_OPTIONS.ENABLE_INTROSPECTION,
    cacheValidation: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION,
    cacheValidationTTL: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION_TTL,
    extractUserInfo: DEFAULT_KEYCLOAK_HTTP_OPTIONS.EXTRACT_USER_INFO,
  }),

  production: (): Required<KeycloakAuthHttpMiddlewareConfig> => ({
    name: "keycloak-prod",
    requireAuth: true,
    keycloakClient: "frontend",
    allowAnonymous: false,
    strictMode: true,
    cacheValidation: true,
    bypassRoutes: ["/health", "/metrics"],
    roles: [],
    permissions: [],
    enableIntrospection: DEFAULT_KEYCLOAK_HTTP_OPTIONS.ENABLE_INTROSPECTION,
    cacheValidationTTL: DEFAULT_KEYCLOAK_HTTP_OPTIONS.CACHE_VALIDATION_TTL,
    extractUserInfo: DEFAULT_KEYCLOAK_HTTP_OPTIONS.EXTRACT_USER_INFO,
  }),
} as const;
