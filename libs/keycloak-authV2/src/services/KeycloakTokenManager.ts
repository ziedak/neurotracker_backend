/**
 * Keycloak Token Manager Service
 * Handles JWT validation using Keycloak JWKS and introspection endpoints
 */

import { createLogger } from "@libs/utils";
import { CacheService } from "@libs/database";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult } from "../types";
import type { AuthV2Config } from "./config";
import { KeycloakClient } from "../client/KeycloakClient";

export class TokenManager {
  private readonly logger = createLogger("KeycloakTokenManager");
  private cacheService?: CacheService;

  constructor(
    private readonly keycloakClient: KeycloakClient,
    private readonly config: AuthV2Config,
    private readonly metrics?: IMetricsCollector
  ) {
    // Initialize cache if enabled
    if (this.config.cache.enabled && metrics) {
      this.cacheService = CacheService.create(metrics);
    }
  }

  /**
   * Validate JWT token using Keycloak JWKS
   */
  async validateJwt(token: string): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      // Check cache first if enabled
      if (this.cacheService) {
        const cacheKey = `jwt:${token.slice(0, 16)}:validation`;
        const cachedResult = await this.cacheService.get<AuthResult>(cacheKey);
        if (cachedResult.data && cachedResult.source !== "miss") {
          this.metrics?.recordCounter(
            "keycloak.token_manager.jwt_validation_cache_hit",
            1
          );
          return cachedResult.data;
        }
      }

      // Use Keycloak client for JWT validation
      const result = await this.keycloakClient.validateToken(token);

      // Cache successful validations for a short period
      if (this.cacheService && result.success) {
        const cacheKey = `jwt:${token.slice(0, 16)}:validation`;
        const cacheTTL = 300; // 5 minutes - short cache for security
        await this.cacheService.set(cacheKey, result, cacheTTL);
        this.metrics?.recordCounter(
          "keycloak.token_manager.jwt_validation_cache_set",
          1
        );
      }

      this.metrics?.recordCounter("keycloak.token_manager.jwt_validation", 1);
      this.metrics?.recordTimer(
        "keycloak.token_manager.jwt_validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("JWT validation failed", { error });
      this.metrics?.recordCounter(
        "keycloak.token_manager.jwt_validation_error",
        1
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : "JWT validation failed",
      };
    }
  }

  /**
   * Validate token using Keycloak introspection endpoint
   */
  async introspectToken(token: string): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      // Check cache first if enabled (shorter cache for introspection as it's typically for opaque tokens)
      if (this.cacheService) {
        const cacheKey = `introspect:${token.slice(0, 16)}:validation`;
        const cachedResult = await this.cacheService.get<AuthResult>(cacheKey);
        if (cachedResult.data && cachedResult.source !== "miss") {
          this.metrics?.recordCounter(
            "keycloak.token_manager.introspection_cache_hit",
            1
          );
          return cachedResult.data;
        }
      }

      // Use Keycloak client for token introspection
      const result = await this.keycloakClient.introspectToken(token);

      // Cache successful introspections for a shorter period (opaque tokens can be revoked)
      if (this.cacheService && result.success) {
        const cacheKey = `introspect:${token.slice(0, 16)}:validation`;
        const cacheTTL = 60; // 1 minute - very short cache for security
        await this.cacheService.set(cacheKey, result, cacheTTL);
        this.metrics?.recordCounter(
          "keycloak.token_manager.introspection_cache_set",
          1
        );
      }

      this.metrics?.recordCounter("keycloak.token_manager.introspection", 1);
      this.metrics?.recordTimer(
        "keycloak.token_manager.introspection_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("Token introspection failed", { error });
      this.metrics?.recordCounter(
        "keycloak.token_manager.introspection_error",
        1
      );

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Token introspection failed",
      };
    }
  }

  /**
   * Validate token with fallback strategy (JWT first, then introspection)
   */
  async validateToken(
    token: string,
    useIntrospection = false
  ): Promise<AuthResult> {
    const startTime = performance.now();

    try {
      let result: AuthResult;

      if (useIntrospection) {
        // Use introspection first (useful for opaque tokens)
        result = await this.introspectToken(token);

        // Fallback to JWT validation if introspection fails
        if (!result.success) {
          this.logger.debug(
            "Introspection failed, falling back to JWT validation"
          );
          result = await this.validateJwt(token);
        }
      } else {
        // Use JWT validation first (faster for JWT tokens)
        result = await this.validateJwt(token);

        // Fallback to introspection if JWT validation fails
        if (!result.success) {
          this.logger.debug(
            "JWT validation failed, falling back to introspection"
          );
          result = await this.introspectToken(token);
        }
      }

      this.metrics?.recordCounter("keycloak.token_manager.validation", 1);
      this.metrics?.recordTimer(
        "keycloak.token_manager.validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      this.logger.error("Token validation failed", { error });
      this.metrics?.recordCounter("keycloak.token_manager.validation_error", 1);

      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Token validation failed",
      };
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractBearerToken(authorizationHeader?: string): string | null {
    if (!authorizationHeader || typeof authorizationHeader !== "string") {
      return null;
    }

    const bearerPrefix = "Bearer ";
    if (!authorizationHeader.startsWith(bearerPrefix)) {
      return null;
    }

    const token = authorizationHeader.slice(bearerPrefix.length).trim();
    return token.length > 0 ? token : null;
  }

  /**
   * Check if a role is present in user roles
   */
  hasRole(authResult: AuthResult, role: string): boolean {
    if (!authResult.success || !authResult.user?.roles) {
      return false;
    }

    return (
      authResult.user.roles.includes(role) ||
      authResult.user.roles.includes(`realm:${role}`)
    );
  }

  /**
   * Check if any of the required roles are present
   */
  hasAnyRole(authResult: AuthResult, requiredRoles: string[]): boolean {
    return requiredRoles.some((role) => this.hasRole(authResult, role));
  }

  /**
   * Check if a permission is present
   */
  hasPermission(authResult: AuthResult, permission: string): boolean {
    if (!authResult.success || !authResult.user?.permissions) {
      return false;
    }

    return authResult.user.permissions.includes(permission);
  }

  /**
   * Check if any of the required permissions are present
   */
  hasAnyPermission(
    authResult: AuthResult,
    requiredPermissions: string[]
  ): boolean {
    return requiredPermissions.some((permission) =>
      this.hasPermission(authResult, permission)
    );
  }

  /**
   * Check if token is expired based on auth result
   */
  isTokenExpired(authResult: AuthResult): boolean {
    if (!authResult.success || !authResult.expiresAt) {
      return true;
    }

    return new Date() >= authResult.expiresAt;
  }

  /**
   * Get remaining token lifetime in seconds
   */
  getTokenLifetime(authResult: AuthResult): number {
    if (!authResult.success || !authResult.expiresAt) {
      return 0;
    }

    const remaining = Math.floor(
      (authResult.expiresAt.getTime() - Date.now()) / 1000
    );
    return Math.max(0, remaining);
  }
}
