/**
 * JWT Validator Service
 * Handles JWT signature verification using JWKS
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult } from "../types";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { z } from "zod";

// Token validation schema
const TokenSchema = z
  .string()
  .min(1, "Token cannot be empty")
  .max(8192, "Token too large (max 8192 characters)")
  .regex(
    /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/,
    "Invalid JWT format - must be a valid JSON Web Token"
  );

export class JWTValidator {
  private readonly logger = createLogger("JWTValidator");
  private remoteJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
  private jwksInitPromise: Promise<void> | null = null;

  constructor(
    private readonly jwksEndpoint: string,
    private readonly issuer: string,
    private readonly audience?: string,
    private readonly metrics?: IMetricsCollector
  ) {}

  /**
   * Initialize JWKS for JWT signature verification
   */
  private async initializeJWKS(): Promise<void> {
    try {
      this.remoteJWKS = createRemoteJWKSet(new URL(this.jwksEndpoint));
      this.logger.debug("JWKS initialized successfully", {
        jwksEndpoint: this.jwksEndpoint,
      });
      this.jwksInitPromise = null;
    } catch (error) {
      this.jwksInitPromise = null;
      this.logger.error("Failed to initialize JWKS", {
        error: error instanceof Error ? error.message : String(error),
        jwksEndpoint: this.jwksEndpoint,
      });
      throw new Error(
        `Failed to initialize JWT verification: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Ensure JWKS is initialized (thread-safe)
   */
  private async ensureJWKSInitialized(): Promise<void> {
    if (!this.remoteJWKS) {
      if (!this.jwksInitPromise) {
        this.jwksInitPromise = this.initializeJWKS();
      }
      await this.jwksInitPromise;
    }
  }

  /**
   * Validate token format using Zod schema
   */
  private validateTokenFormat(token: string): {
    valid: boolean;
    error?: string;
  } {
    const result = TokenSchema.safeParse(token);
    if (!result.success) {
      return {
        valid: false,
        error: result.error.errors[0]?.message || "Invalid token format",
      };
    }
    return { valid: true };
  }

  /**
   * Extract roles from JWT claims
   */
  private extractRoles(claims: Record<string, unknown>): string[] {
    const roles: string[] = [];

    // Extract realm roles
    if (claims["realm_access"] && typeof claims["realm_access"] === "object") {
      const realmAccess = claims["realm_access"] as Record<string, unknown>;
      if (Array.isArray(realmAccess["roles"])) {
        roles.push(
          ...(realmAccess["roles"] as string[]).map((role) => `realm:${role}`)
        );
      }
    }

    // Extract resource/client roles
    if (
      claims["resource_access"] &&
      typeof claims["resource_access"] === "object"
    ) {
      const resourceAccess = claims["resource_access"] as Record<
        string,
        unknown
      >;
      for (const [resource, access] of Object.entries(resourceAccess)) {
        if (access && typeof access === "object") {
          const resourceRoles = (access as Record<string, unknown>)["roles"];
          if (Array.isArray(resourceRoles)) {
            roles.push(
              ...(resourceRoles as string[]).map(
                (role) => `${resource}:${role}`
              )
            );
          }
        }
      }
    }

    return roles;
  }

  /**
   * Extract permissions from JWT claims
   */
  private extractPermissions(claims: Record<string, unknown>): string[] {
    const permissions: string[] = [];

    // Extract from authorization claim (UMA permissions)
    if (
      claims["authorization"] &&
      typeof claims["authorization"] === "object"
    ) {
      const auth = claims["authorization"] as Record<string, unknown>;
      if (Array.isArray(auth["permissions"])) {
        permissions.push(...(auth["permissions"] as string[]));
      }
    }

    // Extract from scope claim
    if (claims["scope"] && typeof claims["scope"] === "string") {
      permissions.push(...(claims["scope"] as string).split(" "));
    }

    return permissions;
  }

  /**
   * Validate JWT token using proper signature verification
   */
  async validateJWT(token: string): Promise<AuthResult> {
    const startTime = performance.now();

    // Fast input validation first
    const tokenValidation = this.validateTokenFormat(token);
    if (!tokenValidation.valid) {
      this.logger.error("Token format validation failed", {
        error: tokenValidation.error,
        tokenLength: token.length,
      });
      return {
        success: false,
        error: tokenValidation.error || "Token format validation failed",
      };
    }

    try {
      // Initialize JWKS if needed
      await this.ensureJWKSInitialized();

      if (!this.remoteJWKS) {
        return {
          success: false,
          error: "JWKS not initialized",
        };
      }

      const { payload } = await jwtVerify(token, this.remoteJWKS, {
        issuer: this.issuer,
        ...(this.audience && { audience: this.audience }),
      });

      // Extract user information from JWT claims
      const claims = payload as Record<string, unknown>;
      const result: AuthResult = {
        success: true,
        user: {
          id: claims["sub"] as string,
          username: claims["preferred_username"] as string,
          email: claims["email"] as string,
          name: claims["name"] as string,
          roles: this.extractRoles(claims),
          permissions: this.extractPermissions(claims),
        },
        expiresAt: claims["exp"]
          ? new Date((claims["exp"] as number) * 1000)
          : undefined,
      };

      this.logger.debug("JWT signature verification successful", {
        userId: result.user?.id,
        username: result.user?.username,
        expiresAt: result.expiresAt,
      });

      this.metrics?.recordCounter("jwt_validator.validation_success", 1);
      this.metrics?.recordTimer(
        "jwt_validator.validation_duration",
        performance.now() - startTime
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error("JWT validation failed", {
        error: errorMessage,
        tokenLength: token.length,
      });

      this.metrics?.recordCounter("jwt_validator.validation_error", 1);

      return {
        success: false,
        error: errorMessage || "JWT token validation failed",
      };
    }
  }
}
