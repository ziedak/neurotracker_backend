/**
 * Industry-Standard Keycloak Middleware
 * Following dependency injection, interface segregation, and clean architecture principles
 */

import { BaseMiddleware } from "../base/BaseMiddleware";
import { ILogger, IMetricsCollector } from "@libs/monitoring";
import {
  IKeycloakService,
  IKeycloakMiddlewareDependencies,
  IKeycloakMiddlewareOptions,
} from "./interfaces";
import {
  KeycloakTokenVerification,
  KeycloakError,
  KeycloakErrorType,
} from "./types";
import { MiddlewareContext } from "../types";

/**
 * Enhanced context with Keycloak authentication data
 */
export interface KeycloakAuthenticatedContext extends MiddlewareContext {
  keycloak: {
    authenticated: boolean;
    user?: any;
    token?: any;
    roles: string[];
    scopes: string[];
    clientRoles: Record<string, string[]>;
    hasRole: (role: string) => boolean;
    hasScope: (scope: string) => boolean;
    hasAnyRole: (roles: string[]) => boolean;
    hasAllRoles: (roles: string[]) => boolean;
  };
}

/**
 * Industry-standard Keycloak middleware implementation
 * Follows dependency injection and clean architecture principles
 */
export class IndustryStandardKeycloakMiddleware extends BaseMiddleware<IKeycloakMiddlewareOptions> {
  private readonly keycloakService: IKeycloakService;
  private readonly dependencies: IKeycloakMiddlewareDependencies;

  constructor(
    logger: ILogger,
    metrics: IMetricsCollector,
    options: IKeycloakMiddlewareOptions
  ) {
    super(logger, metrics, options, options.name || "keycloak-auth");

    this.dependencies = options.dependencies;
    this.keycloakService = this.dependencies.keycloakService;

    this.logger.info("Industry-standard Keycloak middleware initialized", {
      name: this.config.name,
      enabled: this.config.enabled,
      serverUrl: this.config.config.serverUrl,
      realm: this.config.config.realm,
      clientId: this.config.config.clientId,
    });
  }

  /**
   * Execute Keycloak authentication
   */
  async execute(context: KeycloakAuthenticatedContext): Promise<void> {
    const startTime = performance.now();

    try {
      // Initialize Keycloak context
      this.initializeKeycloakContext(context);

      // Skip authentication for certain paths if configured
      if (this.shouldSkipAuthentication(context)) {
        await this.recordMetric("keycloak_auth_skipped", 1, {
          path: context.request.url,
          method: context.request.method,
        });
        return;
      }

      // Extract token from request
      const token = this.extractToken(context);

      if (!token) {
        await this.handleMissingToken(context);
        return;
      }

      // Verify token with Keycloak service
      const verification = await this.keycloakService.verifyToken(token);

      if (!verification.valid) {
        await this.handleInvalidToken(context, verification);
        return;
      }

      // Set authenticated context
      await this.setAuthenticatedContext(context, verification);

      // Record successful authentication
      await this.recordMetric("keycloak_auth_success", 1, {
        source: verification.source || "unknown",
        realm: this.config.config.realm,
      });
    } catch (error) {
      await this.handleAuthenticationError(context, error as Error);
      throw error;
    } finally {
      const duration = performance.now() - startTime;
      await this.recordTimer("keycloak_auth_duration", duration, {
        authenticated: context.keycloak.authenticated.toString(),
        realm: this.config.config.realm,
      });
    }
  }

  /**
   * Create instance with different configuration
   */
  protected override createInstance(
    options: IKeycloakMiddlewareOptions
  ): BaseMiddleware<IKeycloakMiddlewareOptions> {
    return new IndustryStandardKeycloakMiddleware(this.metrics, options);
  }

  /**
   * Initialize Keycloak context
   */
  private initializeKeycloakContext(
    context: KeycloakAuthenticatedContext
  ): void {
    context.keycloak = {
      authenticated: false,
      roles: [],
      scopes: [],
      clientRoles: {},
      hasRole: (role: string) => context.keycloak.roles.includes(role),
      hasScope: (scope: string) => context.keycloak.scopes.includes(scope),
      hasAnyRole: (roles: string[]) =>
        roles.some((role) => context.keycloak.roles.includes(role)),
      hasAllRoles: (roles: string[]) =>
        roles.every((role) => context.keycloak.roles.includes(role)),
    };
  }

  /**
   * Check if authentication should be skipped
   */
  private shouldSkipAuthentication(
    context: KeycloakAuthenticatedContext
  ): boolean {
    const path = context.request.url;
    const skipPaths = this.config.config.skipPaths || [];

    return skipPaths.some((skipPath) => {
      if (skipPath.includes("*")) {
        const pattern = skipPath.replace(/\*/g, ".*");
        return new RegExp(pattern).test(path);
      }
      return path === skipPath || path.startsWith(skipPath);
    });
  }

  /**
   * Extract JWT token from request headers
   */
  private extractToken(context: KeycloakAuthenticatedContext): string | null {
    const headers = context.request.headers;

    // Try Authorization header
    const authHeader = headers["authorization"] || headers["Authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    // Try x-access-token header
    const accessToken = headers["x-access-token"] || headers["X-Access-Token"];
    if (accessToken) {
      return accessToken;
    }

    return null;
  }

  /**
   * Handle missing token scenario
   */
  private async handleMissingToken(
    context: KeycloakAuthenticatedContext
  ): Promise<void> {
    if (!this.config.config.requireAuth) {
      // Allow anonymous access
      await this.recordMetric("keycloak_anonymous_access", 1, {
        path: context.request.url,
        method: context.request.method,
      });
      return;
    }

    await this.recordMetric("keycloak_missing_token", 1, {
      path: context.request.url,
      method: context.request.method,
    });

    throw new KeycloakError(
      "Authentication required - no token provided",
      KeycloakErrorType.INVALID_TOKEN
    );
  }

  /**
   * Handle invalid token scenario
   */
  private async handleInvalidToken(
    _context: KeycloakAuthenticatedContext,
    verification: KeycloakTokenVerification
  ): Promise<void> {
    await this.recordMetric("keycloak_invalid_token", 1, {
      error_type: this.getErrorTypeFromVerification(verification),
      source: verification.source || "unknown",
      realm: this.config.config.realm,
    });

    throw new KeycloakError(
      verification.error || "Token verification failed",
      this.getErrorTypeFromVerification(verification)
    );
  }

  /**
   * Set authenticated context with user information
   */
  private async setAuthenticatedContext(
    context: KeycloakAuthenticatedContext,
    verification: KeycloakTokenVerification
  ): Promise<void> {
    const userInfo = verification.userInfo;
    const payload = verification.payload;

    if (!userInfo || !payload) {
      throw new KeycloakError(
        "Invalid verification result - missing user info or payload",
        KeycloakErrorType.INVALID_TOKEN
      );
    }

    context.keycloak = {
      ...context.keycloak,
      authenticated: true,
      user: userInfo,
      token: payload,
      roles: userInfo.roles || [],
      scopes: this.extractScopes(payload),
      clientRoles: userInfo.clientRoles || {},
    };

    // Set standard context properties
    context["authenticated"] = true;
    context["userId"] = userInfo.sub;
    context["userRole"] = userInfo.roles?.[0] || "user";
    context["userPermissions"] = userInfo.roles || [];

    this.logger.debug("Keycloak authentication successful", {
      userId: userInfo.sub,
      username: userInfo.preferredUsername,
      roles: userInfo.roles?.length || 0,
      source: verification.source,
    });
  }

  /**
   * Extract scopes from JWT payload
   */
  private extractScopes(payload: any): string[] {
    if (payload.scope && typeof payload.scope === "string") {
      return payload.scope.split(" ");
    }
    if (Array.isArray(payload.scope)) {
      return payload.scope;
    }
    return [];
  }

  /**
   * Handle authentication errors
   */
  private async handleAuthenticationError(
    context: KeycloakAuthenticatedContext,
    error: Error
  ): Promise<void> {
    const errorType = error instanceof KeycloakError ? error.type : "unknown";

    await this.recordMetric("keycloak_auth_error", 1, {
      error_type: errorType,
      path: context.request.url,
      method: context.request.method,
      realm: this.config.config.realm,
    });

    this.logger.warn("Keycloak authentication error", {
      error: error.message,
      type: errorType,
      path: context.request.url,
      userId: context["userId"],
    });
  }

  /**
   * Get error type from verification result
   */
  private getErrorTypeFromVerification(
    verification: KeycloakTokenVerification
  ): KeycloakErrorType {
    const error = verification.error?.toLowerCase() || "";

    if (error.includes("expired")) return KeycloakErrorType.TOKEN_EXPIRED;
    if (error.includes("signature")) return KeycloakErrorType.INVALID_SIGNATURE;
    if (error.includes("issuer")) return KeycloakErrorType.INVALID_ISSUER;
    if (error.includes("audience")) return KeycloakErrorType.INVALID_AUDIENCE;

    return KeycloakErrorType.INVALID_TOKEN;
  }

  /**
   * Get service health status
   */
  public async getHealthStatus() {
    return this.keycloakService.getHealthStatus();
  }

  /**
   * Get cache statistics
   */
  public async getCacheStats() {
    return this.keycloakService.getCacheStats();
  }

  /**
   * Clear caches
   */
  public async clearCache() {
    return this.keycloakService.clearCache();
  }
}
