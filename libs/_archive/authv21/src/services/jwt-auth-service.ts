import {
  EnhancedJWTService,
  TokenGenerationResult,
  TokenVerificationResult,
  TokenRotationResult,
} from "@libs/auth/src/services/jwt/enhanced-jwt-service-v2";
import {
  JWTPayload,
  RefreshTokenPayload,
} from "@libs/auth/src/types/jwt-types";
import { Logger, ILogger } from "@libs/monitoring";
import { IAuthUser, IAuthConfig } from "../types/index";
import { AuthError, AuthErrorCode } from "../types/errors";
import { sanitizeInput } from "../utils/index";

/**
 * JWT Authentication Service for AuthV2
 * Provides JWT token generation, validation, and refresh functionality
 * Integrates with existing EnhancedJWTService from libs/auth
 */
export class JWTAuthService {
  private readonly jwtService: EnhancedJWTService;
  private readonly logger: ILogger;

  constructor(config: IAuthConfig) {
    this.jwtService = EnhancedJWTService.getInstance();
    this.logger = new Logger({
      service: "JWTAuthService",
      level: "info",
      transports: ["console"],
    });
  }

  /**
   * Generate JWT tokens for authenticated user
   */
  async generateTokens(user: IAuthUser): Promise<TokenGenerationResult> {
    try {
      this.logger.info("Generating JWT tokens", { userId: user.id });

      // Validate user data
      if (!user.id || !user.email) {
        throw new AuthError(
          "INVALID_CREDENTIALS" as AuthErrorCode,
          "Invalid user data for token generation"
        );
      }

      // Sanitize user data
      const sanitizedUser = this.sanitizeUserData(user);

      // Prepare payload for EnhancedJWTService
      const payload: Omit<JWTPayload, "iat" | "exp"> = {
        sub: sanitizedUser.id,
        email: sanitizedUser.email,
        role: sanitizedUser.roles[0] || "user", // Use first role as primary role
        permissions: sanitizedUser.permissions,
        // Add additional fields that EnhancedJWTService expects
        userId: sanitizedUser.id,
        storeId: "default", // Default store ID since IAuthUser doesn't have storeId
      };

      // Generate tokens using EnhancedJWTService
      const result = await this.jwtService.generateTokens(payload);

      this.logger.info("JWT tokens generated successfully", {
        userId: user.id,
        tokenId: result.tokenId,
      });

      return result;
    } catch (error) {
      this.logger.error("Failed to generate JWT tokens", error as Error, {
        userId: user.id,
      });

      if (error instanceof AuthError) {
        throw error;
      }

      throw new AuthError(
        "TOKEN_INVALID" as AuthErrorCode,
        "Failed to generate authentication tokens"
      );
    }
  }

  /**
   * Validate JWT access token
   */
  async validateToken(token: string): Promise<TokenVerificationResult> {
    try {
      this.logger.debug("Validating JWT token");

      if (!token || typeof token !== "string") {
        return {
          valid: false,
          error: "Invalid token format",
          errorCode: "MALFORMED_TOKEN",
        };
      }

      // Use EnhancedJWTService to verify token
      const result = await this.jwtService.verifyAccessToken(token);

      if (result.valid) {
        this.logger.debug("JWT token validated successfully", {
          userId: result.payload?.sub,
        });
      } else {
        this.logger.warn("JWT token validation failed", {
          error: result.error,
          errorCode: result.errorCode,
        });
      }

      return result;
    } catch (error) {
      this.logger.error("Token validation error", error as Error);

      return {
        valid: false,
        error: (error as Error).message,
        errorCode: "VALIDATION_ERROR",
      };
    }
  }

  /**
   * Refresh JWT access token using refresh token
   */
  async refreshToken(
    refreshToken: string,
    userService: any
  ): Promise<TokenRotationResult | null> {
    try {
      this.logger.info("Refreshing JWT token");

      if (!refreshToken || typeof refreshToken !== "string") {
        throw new AuthError(
          "TOKEN_INVALID" as AuthErrorCode,
          "Invalid refresh token format"
        );
      }

      // Use EnhancedJWTService to refresh token
      const result = await this.jwtService.refreshAccessToken(
        refreshToken,
        userService
      );

      if (result) {
        this.logger.info("JWT token refreshed successfully", {
          rotatedAt: result.rotatedAt,
        });
      } else {
        this.logger.warn("JWT token refresh failed");
      }

      return result;
    } catch (error) {
      this.logger.error("Token refresh error", error as Error);

      if (error instanceof AuthError) {
        throw error;
      }

      throw new AuthError(
        "TOKEN_INVALID" as AuthErrorCode,
        "Failed to refresh authentication token"
      );
    }
  }

  /**
   * Revoke a specific JWT token
   */
  async revokeToken(
    token: string,
    reason?: string,
    revokedBy?: string
  ): Promise<boolean> {
    try {
      this.logger.info("Revoking JWT token", { revokedBy });

      // Use EnhancedJWTService to revoke token
      const success = await this.jwtService.revokeToken(
        token,
        reason as any,
        revokedBy
      );

      if (success) {
        this.logger.info("JWT token revoked successfully");
      } else {
        this.logger.warn("JWT token revocation failed");
      }

      return success;
    } catch (error) {
      this.logger.error("Token revocation error", error as Error);
      return false;
    }
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeUserTokens(
    userId: string,
    reason?: string,
    revokedBy?: string
  ): Promise<boolean> {
    try {
      this.logger.info("Revoking all tokens for user", { userId, revokedBy });

      // Use EnhancedJWTService to revoke user tokens
      const success = await this.jwtService.revokeUserTokens(
        userId,
        reason as any,
        revokedBy
      );

      if (success) {
        this.logger.info("User tokens revoked successfully", { userId });
      } else {
        this.logger.warn("User token revocation failed", { userId });
      }

      return success;
    } catch (error) {
      this.logger.error("User token revocation error", error as Error, {
        userId,
      });
      return false;
    }
  }

  /**
   * Check if a token is revoked
   */
  async isTokenRevoked(tokenId: string): Promise<boolean> {
    try {
      return await this.jwtService.isTokenRevoked(tokenId);
    } catch (error) {
      this.logger.error("Token revocation check error", error as Error, {
        tokenId,
      });
      return false; // Fail-safe: assume not revoked if check fails
    }
  }

  /**
   * Extract user information from validated token
   */
  extractUserFromToken(
    verificationResult: TokenVerificationResult
  ): IAuthUser | null {
    if (!verificationResult.valid || !verificationResult.payload) {
      return null;
    }

    const payload = verificationResult.payload;

    return {
      id: payload.sub,
      username: payload.sub, // Use sub as username fallback
      email: payload.email || "",
      roles: payload.role ? [payload.role] : ["user"],
      permissions: payload.permissions || [],
      provider: "local" as any, // Default provider
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Get service health status
   */
  async getHealthStatus() {
    try {
      return await this.jwtService.getHealthStatus();
    } catch (error) {
      this.logger.error("Health check error", error as Error);
      return {
        status: "critical" as const,
        components: {
          circuitBreaker: "UNKNOWN",
          cache: "UNKNOWN",
          redis: "UNKNOWN",
        },
        metrics: {
          totalTokensGenerated: 0,
          totalVerifications: 0,
          cacheHitRate: 0,
          errorRate: 100,
        },
        uptime: 0,
      };
    }
  }

  /**
   * Sanitize user data for token generation
   */
  private sanitizeUserData(user: IAuthUser): IAuthUser {
    return {
      ...user,
      email: sanitizeInput(user.email),
      firstName: user.firstName ? sanitizeInput(user.firstName) : undefined,
      lastName: user.lastName ? sanitizeInput(user.lastName) : undefined,
      username: sanitizeInput(user.username),
    };
  }
}
