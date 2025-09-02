/**
 * JWT Authentication Service
 * Handles JWT token generation, validation, and refresh operations
 * Uses battle-tested libraries for security and performance
 */

import { SignJWT, jwtVerify, JWTPayload } from "jose";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import {
  User,
  AuthToken,
  AuthConfig,
  ServiceDependencies,
  AuthError,
  UnauthorizedError,
} from "../types";

// ===================================================================
// JWT SERVICE CLASS
// ===================================================================

export class JWTService {
  private readonly secret: Uint8Array;

  constructor(private config: AuthConfig, private deps: ServiceDependencies) {
    // Convert secret to Uint8Array for jose library
    this.secret = new TextEncoder().encode(this.config.jwt.secret);
  }

  /**
   * Generate access and refresh tokens for user
   */
  async generateTokens(user: User): Promise<AuthToken> {
    const now = Math.floor(Date.now() / 1000);
    const accessTokenExpiry =
      now + this.parseTimeToSeconds(this.config.jwt.expiresIn);
    const refreshTokenExpiry =
      now + this.parseTimeToSeconds(this.config.jwt.refreshExpiresIn);

    // Create JWT payload
    const payload: JWTPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
      permissions: user.permissions,
      iat: now,
      exp: accessTokenExpiry,
      iss: this.config.jwt.issuer,
      aud: this.config.jwt.audience,
      jti: this.generateJti(),
    };

    // Generate access token
    const accessToken = await new SignJWT(payload)
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(accessTokenExpiry)
      .setIssuedAt(now)
      .setIssuer(this.config.jwt.issuer)
      .setAudience(this.config.jwt.audience)
      .setJti(payload.jti || this.generateJti())
      .sign(this.secret);

    // Generate refresh token
    const refreshToken = await new SignJWT({
      sub: user.id,
      type: "refresh",
      jti: this.generateJti(),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(refreshTokenExpiry)
      .setIssuedAt(now)
      .setIssuer(this.config.jwt.issuer)
      .setAudience(this.config.jwt.audience)
      .sign(this.secret);

    // Cache tokens for revocation capability
    await this.cacheToken(accessToken, user.id, accessTokenExpiry);
    await this.cacheToken(refreshToken, user.id, refreshTokenExpiry);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTokenExpiry - now,
      tokenType: "Bearer",
    };
  }

  /**
   * Verify and decode JWT token
   */
  async verifyToken(token: string): Promise<User> {
    try {
      // Check if token is revoked
      const isRevoked = await this.isTokenRevoked(token);
      if (isRevoked) {
        throw new UnauthorizedError("Token has been revoked");
      }

      // Verify token
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
      });

      // Extract user information from payload
      const user: User = {
        id: payload.sub as string,
        email: payload["email"] as string,
        name: payload["name"] as string,
        roles: (payload["roles"] as string[]) || [],
        permissions: (payload["permissions"] as string[]) || [],
        metadata: payload["metadata"] as Record<string, unknown>,
        isActive: true,
        createdAt: new Date((payload.iat as number) * 1000),
        updatedAt: new Date(),
      };

      return user;
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw new UnauthorizedError("Invalid token");
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<AuthToken> {
    try {
      // Verify refresh token
      const { payload } = await jwtVerify(refreshToken, this.secret, {
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
      });

      if (payload["type"] !== "refresh") {
        throw new UnauthorizedError("Invalid refresh token");
      }

      // Check if refresh token is revoked
      const isRevoked = await this.isTokenRevoked(refreshToken);
      if (isRevoked) {
        throw new UnauthorizedError("Refresh token has been revoked");
      }

      // Get user from database
      const userId = payload.sub as string;
      const user = await this.getUserById(userId);
      if (!user) {
        throw new UnauthorizedError("User not found");
      }

      // Generate new tokens
      return await this.generateTokens(user);
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw new UnauthorizedError("Invalid refresh token");
    }
  }

  /**
   * Revoke a specific token
   */
  async revokeToken(token: string): Promise<void> {
    try {
      const hash = this.hashToken(token);
      await this.deps.redis.setex(`revoked:${hash}`, 86400, "1"); // 24 hours
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to revoke token", { error });
      throw new AuthError("Failed to revoke token", "TOKEN_REVOKE_FAILED");
    }
  }

  /**
   * Revoke all tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    try {
      // Get all user tokens from cache
      const pattern = `token:${userId}:*`;
      const keys = await this.deps.redis.keys(pattern);

      if (keys.length > 0) {
        // Mark all tokens as revoked
        const pipeline = this.deps.redis.pipeline();
        for (const key of keys) {
          const token = await this.deps.redis.get(key);
          if (token) {
            const hash = this.hashToken(token);
            pipeline.setex(`revoked:${hash}`, 86400, "1");
          }
          pipeline.del(key);
        }
        await pipeline.exec();
      }
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to revoke user tokens", {
        userId,
        error,
      });
      throw new AuthError(
        "Failed to revoke user tokens",
        "USER_TOKENS_REVOKE_FAILED"
      );
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader: string): string | null {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return null;
    }
    return authHeader.substring(7);
  }

  /**
   * Validate token format
   */
  validateTokenFormat(token: string): boolean {
    // Basic JWT format validation
    const parts = token.split(".");
    return parts.length === 3 && parts.every((part) => part.length > 0);
  }

  // ===================================================================
  // PRIVATE METHODS
  // ===================================================================

  private async cacheToken(
    token: string,
    userId: string,
    expiry: number
  ): Promise<void> {
    try {
      const key = `token:${userId}:${this.hashToken(token)}`;
      await this.deps.redis.setex(
        key,
        expiry - Math.floor(Date.now() / 1000),
        token
      );
    } catch (error) {
      this.deps.monitoring.logger.warn("Failed to cache token", {
        userId,
        error,
      });
    }
  }

  private async isTokenRevoked(token: string): Promise<boolean> {
    try {
      const hash = this.hashToken(token);
      const result = await this.deps.redis.get(`revoked:${hash}`);
      return result === "1";
    } catch (error) {
      this.deps.monitoring.logger.warn("Failed to check token revocation", {
        error,
      });
      return false;
    }
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private generateJti(): string {
    return createHash("sha256")
      .update(`${Date.now()}-${Math.random()}`)
      .digest("hex")
      .substring(0, 16);
  }

  private parseTimeToSeconds(time: string): number {
    const match = time.match(/^(\d+)([smhd])$/);
    if (!match || !match[1]) return 3600; // Default 1 hour

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 3600;
      case "d":
        return value * 86400;
      default:
        return 3600;
    }
  }

  /**
   * Authenticate user by email and password
   * Returns user object if credentials are valid, null otherwise
   */
  async authenticateUser(
    email: string,
    password: string
  ): Promise<User | null> {
    try {
      // Get user from database by email
      const connection = await this.deps.database.getConnectionPrisma();

      try {
        const userRecord = await connection.prisma.user.findFirst({
          where: {
            email: email,
            isDeleted: false,
            status: "ACTIVE",
          },
          select: {
            id: true,
            email: true,
            password: true, // Need password for verification
            username: true,
            firstName: true,
            lastName: true,
            roleId: true,
            role: {
              select: {
                name: true,
                permissions: {
                  select: {
                    name: true,
                    resource: true,
                    action: true,
                  },
                },
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!userRecord) {
          // User not found
          this.deps.monitoring.logger.warn(
            "User authentication failed - user not found",
            { email }
          );
          return null;
        }

        // Verify password using bcrypt
        const isPasswordValid = await bcrypt.compare(
          password,
          userRecord.password
        );

        if (!isPasswordValid) {
          // Invalid password
          this.deps.monitoring.logger.warn(
            "User authentication failed - invalid password",
            {
              email,
              userId: userRecord.id,
            }
          );
          return null;
        }

        // Authentication successful - transform to auth User type
        return {
          id: userRecord.id,
          email: userRecord.email,
          name:
            userRecord.firstName && userRecord.lastName
              ? `${userRecord.firstName} ${userRecord.lastName}`
              : userRecord.username,
          roles: userRecord.role ? [userRecord.role.name] : ["user"],
          permissions:
            userRecord.role?.permissions.map(
              (p: any) => `${p.action}:${p.resource}`
            ) || [],
          isActive: true,
          createdAt: userRecord.createdAt,
          updatedAt: userRecord.updatedAt,
        };
      } finally {
        connection.release();
      }
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to authenticate user", {
        email,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async getUserById(userId: string): Promise<User | null> {
    try {
      // Use existing database dependency from dependency injection
      const connection = await this.deps.database.getConnectionPrisma();

      try {
        const userRecord = await connection.prisma.user.findFirst({
          where: {
            id: userId,
            isDeleted: false,
            status: "ACTIVE",
          },
          select: {
            id: true,
            email: true,
            username: true,
            firstName: true,
            lastName: true,
            roleId: true,
            role: {
              select: {
                name: true,
                permissions: {
                  select: {
                    name: true,
                    resource: true,
                    action: true,
                  },
                },
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        });

        if (!userRecord) {
          return null;
        }

        // Transform database user to auth User type
        return {
          id: userRecord.id,
          email: userRecord.email,
          name:
            userRecord.firstName && userRecord.lastName
              ? `${userRecord.firstName} ${userRecord.lastName}`
              : userRecord.username,
          roles: userRecord.role ? [userRecord.role.name] : ["user"],
          permissions:
            userRecord.role?.permissions.map(
              (p: any) => `${p.action}:${p.resource}`
            ) || [],
          isActive: true,
          createdAt: userRecord.createdAt,
          updatedAt: userRecord.updatedAt,
        };
      } finally {
        connection.release();
      }
    } catch (error) {
      this.deps.monitoring.logger.error("Failed to get user by ID", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================

/**
 * Create JWT service instance
 */
export function createJWTService(
  config: AuthConfig,
  deps: ServiceDependencies
): JWTService {
  return new JWTService(config, deps);
}

/**
 * Decode JWT token without verification (for debugging)
 */
export async function decodeToken(token: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;

    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    return payload;
  } catch (error) {
    return null;
  }
}
