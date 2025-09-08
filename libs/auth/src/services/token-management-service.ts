/**
 * Token Management Service
 * Handles JWT token operations, refresh logic, and token lifecycle
 * Part of Phase 2 service refactoring for single responsibility principle
 */

import {
  User,
  AuthToken,
  AuthResult,
  ServiceDependencies,
  AuthError,
} from "../types";
import { JWTService } from "./jwt-service";

/**
 * Interface for Token Management Service
 */
export interface ITokenManagementService {
  /**
   * Generate access and refresh tokens for user
   */
  generateTokens(user: User): Promise<AuthToken>;

  /**
   * Refresh access token using refresh token
   */
  refreshToken(refreshToken: string): Promise<AuthResult>;

  /**
   * Verify and validate access token
   */
  verifyToken(token: string): Promise<User | null>;

  /**
   * Revoke/blacklist a token
   */
  revokeToken(token: string): Promise<boolean>;

  /**
   * Revoke all tokens for a user
   */
  revokeAllUserTokens(userId: string): Promise<boolean>;
}

/**
 * Token Management Service Implementation
 *
 * Responsible for:
 * - JWT token generation and validation
 * - Token refresh logic
 * - Token revocation and blacklisting
 * - Token lifecycle management
 */
export class TokenManagementService implements ITokenManagementService {
  private jwtService: JWTService;

  constructor(
    private deps: ServiceDependencies,
    services: {
      jwtService: JWTService;
    }
  ) {
    this.jwtService = services.jwtService;
  }

  /**
   * Generate access and refresh tokens for user
   */
  async generateTokens(user: User): Promise<AuthToken> {
    try {
      return await this.jwtService.generateTokens(user);
    } catch (error) {
      const authError = error as AuthError;
      this.deps.monitoring.logger.error("Token generation failed", {
        userId: user.id,
        error: authError.message,
      });
      throw new AuthError(
        "Failed to generate authentication tokens",
        "TOKEN_GENERATION_FAILED"
      );
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<AuthResult> {
    try {
      const tokens = await this.jwtService.refreshToken(refreshToken);

      // Need to extract user info from the new access token
      const user = await this.jwtService.verifyToken(tokens.accessToken);

      return {
        success: true,
        user,
        tokens,
      };
    } catch (error) {
      const authError = error as AuthError;
      this.deps.monitoring.logger.error("Token refresh failed", {
        error: authError.message,
      });

      return {
        success: false,
        error: "Token refresh failed",
        code: "REFRESH_FAILED",
      };
    }
  }

  /**
   * Verify and validate access token
   */
  async verifyToken(token: string): Promise<User | null> {
    try {
      const user = await this.jwtService.verifyToken(token);
      return user;
    } catch (error) {
      const authError = error as AuthError;
      this.deps.monitoring.logger.warn("Token verification failed", {
        error: authError.message,
      });
      return null;
    }
  }

  /**
   * Revoke/blacklist a token
   */
  async revokeToken(token: string): Promise<boolean> {
    try {
      await this.jwtService.revokeToken(token);
      return true;
    } catch (error) {
      const authError = error as AuthError;
      this.deps.monitoring.logger.error("Token revocation failed", {
        error: authError.message,
      });
      return false;
    }
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<boolean> {
    try {
      await this.jwtService.revokeAllUserTokens(userId);

      this.deps.monitoring.logger.info("All user tokens revoked", {
        userId,
      });

      return true;
    } catch (error) {
      const authError = error as AuthError;
      this.deps.monitoring.logger.error("Failed to revoke all user tokens", {
        userId,
        error: authError.message,
      });
      return false;
    }
  }

  /**
   * Validate token format and basic structure
   */
  validateTokenFormat(token: string): boolean {
    try {
      return this.jwtService.validateTokenFormat(token);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get token expiration time (using basic JWT decode)
   */
  getTokenExpiration(token: string): Date | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3 || !parts[1]) return null;

      const payload = JSON.parse(atob(parts[1]));
      return payload.exp ? new Date(payload.exp * 1000) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if token is blacklisted (simplified implementation)
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      // Try to verify the token - if it fails, it might be blacklisted
      await this.jwtService.verifyToken(token);
      return false; // Token is valid, not blacklisted
    } catch (error) {
      // Token verification failed - could be expired, invalid, or blacklisted
      return true;
    }
  }
}
