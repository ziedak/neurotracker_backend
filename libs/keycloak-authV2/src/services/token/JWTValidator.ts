/**
 * JWT Validator Service
 * Handles JWT signature verification using JWKS
 */

import { createLogger } from "@libs/utils";
import type { IMetricsCollector } from "@libs/monitoring";
import type { AuthResult } from "../../types";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { z } from "zod";
import type { SecureCacheManager } from "./SecureCacheManager";
import { RolePermissionExtractor } from "./RolePermissionExtractor";

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
  private initializationMutex = false;

  constructor(
    private readonly jwksEndpoint: string,
    private readonly issuer: string,
    private readonly audience?: string,
    private readonly metrics?: IMetricsCollector,
    private readonly cacheManager?: SecureCacheManager
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
    } catch (error) {
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
    if (this.remoteJWKS) return;

    if (this.initializationMutex) {
      // Wait for ongoing initialization
      while (this.initializationMutex && !this.remoteJWKS) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return;
    }

    this.initializationMutex = true;
    try {
      if (!this.remoteJWKS) {
        // Double-check after acquiring lock
        await this.initializeJWKS();
      }
    } finally {
      this.initializationMutex = false;
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
   * Validate token replay protection using jti and iat claims
   */
  private async validateTokenReplay(payload: any): Promise<boolean> {
    const jti = payload.jti;
    const iat = payload.iat;
    const exp = payload.exp;

    if (!jti || !iat) {
      this.logger.warn(
        "Token missing jti or iat claims - replay protection disabled"
      );
      return true; // Allow tokens without jti/iat for compatibility
    }

    // If cache is not available, skip replay protection
    if (!this.cacheManager?.isEnabled) {
      this.logger.debug("Cache disabled - replay protection skipped");
      return true;
    }

    const tokenId = `${jti}:${iat}`;

    // Check if token was already processed
    const cachedResult = await this.cacheManager.get("jwt_replay", tokenId);
    if (cachedResult.hit) {
      this.logger.error("Token replay detected", { jti, iat });
      return false;
    }

    // Mark token as processed with TTL based on token expiration
    const ttl = exp ? Math.max(60, exp - Math.floor(Date.now() / 1000)) : 3600; // Default 1 hour

    // Store a minimal AuthResult to mark token as processed
    const replayMarker: AuthResult = {
      success: true,
      user: {
        id: "replay_marker",
        username: "replay_marker",
        email: "",
        name: "",
        roles: [],
        permissions: [],
      },
    };
    await this.cacheManager.set("jwt_replay", tokenId, replayMarker, ttl);

    this.logger.debug("Token marked as processed for replay protection", {
      jti,
      iat,
      ttl,
    });

    return true;
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

      // Validate token replay protection
      if (!(await this.validateTokenReplay(claims))) {
        return {
          success: false,
          error: "Token replay detected",
        };
      }

      const result: AuthResult = {
        success: true,
        user: {
          id: claims["sub"] as string,
          username: claims["preferred_username"] as string,
          email: claims["email"] as string,
          name: claims["name"] as string,
          roles: RolePermissionExtractor.extractRolesFromJWT(claims),
          permissions:
            RolePermissionExtractor.extractPermissionsFromJWT(claims),
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
