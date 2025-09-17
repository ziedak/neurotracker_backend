/**
 * JWT Token Service
 * Handles JWT token generation, validation, refresh, and revocation operations
 * Does NOT handle user authentication - all authentication flows go through Keycloak
 * Uses battle-tested libraries for security and performance
 */
import { SignJWT, jwtVerify } from "jose";
import { createHash } from "crypto";
import { AuthError, UnauthorizedError, } from "../types";
// ===================================================================
// JWT SERVICE CLASS
// ===================================================================
export class JWTService {
    config;
    deps;
    secret;
    constructor(config, deps) {
        this.config = config;
        this.deps = deps;
        // Convert secret to Uint8Array for jose library
        this.secret = new TextEncoder().encode(this.config.jwt.secret);
    }
    /**
     * Generate access and refresh tokens for user
     */
    async generateTokens(user) {
        const now = Math.floor(Date.now() / 1000);
        const accessTokenExpiry = now + this.parseTimeToSeconds(this.config.jwt.expiresIn);
        const refreshTokenExpiry = now + this.parseTimeToSeconds(this.config.jwt.refreshExpiresIn);
        // Create JWT payload
        const payload = {
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
    async verifyToken(token) {
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
            const user = {
                id: payload.sub,
                email: payload["email"],
                name: payload["name"],
                roles: payload["roles"] || [],
                permissions: payload["permissions"] || [],
                metadata: payload["metadata"],
                isActive: true,
                createdAt: new Date(payload.iat * 1000),
                updatedAt: new Date(),
            };
            return user;
        }
        catch (error) {
            if (error instanceof AuthError) {
                throw error;
            }
            throw new UnauthorizedError("Invalid token");
        }
    }
    /**
     * Refresh access token using refresh token
     */
    async refreshToken(refreshToken) {
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
            // Get user from Keycloak (as it's the only auth provider)
            const userId = payload.sub;
            // Note: We'll need to inject KeycloakService or get user data from the token itself
            // For now, reconstruct user from token payload since we have the data
            const user = {
                id: userId,
                email: payload["email"],
                name: payload["name"],
                roles: payload["roles"] || [],
                permissions: payload["permissions"] || [],
                metadata: payload["metadata"],
                isActive: true,
                createdAt: new Date(payload.iat * 1000),
                updatedAt: new Date(),
            };
            if (!user.email || !user.name) {
                throw new UnauthorizedError("Invalid token payload - missing user data");
            }
            // Generate new tokens
            return await this.generateTokens(user);
        }
        catch (error) {
            if (error instanceof AuthError) {
                throw error;
            }
            throw new UnauthorizedError("Invalid refresh token");
        }
    }
    /**
     * Revoke a specific token
     */
    async revokeToken(token) {
        try {
            const hash = this.hashToken(token);
            await this.deps.redis.setex(`revoked:${hash}`, 86400, "1"); // 24 hours
        }
        catch (error) {
            this.deps.monitoring.logger.error("Failed to revoke token", { error });
            throw new AuthError("Failed to revoke token", "TOKEN_REVOKE_FAILED");
        }
    }
    /**
     * Revoke all tokens for a user
     */
    async revokeAllUserTokens(userId) {
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
        }
        catch (error) {
            this.deps.monitoring.logger.error("Failed to revoke user tokens", {
                userId,
                error,
            });
            throw new AuthError("Failed to revoke user tokens", "USER_TOKENS_REVOKE_FAILED");
        }
    }
    /**
     * Extract token from Authorization header
     */
    extractTokenFromHeader(authHeader) {
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return null;
        }
        return authHeader.substring(7);
    }
    /**
     * Validate token format
     */
    validateTokenFormat(token) {
        // Basic JWT format validation
        const parts = token.split(".");
        return parts.length === 3 && parts.every((part) => part.length > 0);
    }
    // ===================================================================
    // PRIVATE METHODS
    // ===================================================================
    async cacheToken(token, userId, expiry) {
        try {
            const key = `token:${userId}:${this.hashToken(token)}`;
            await this.deps.redis.setex(key, expiry - Math.floor(Date.now() / 1000), token);
        }
        catch (error) {
            this.deps.monitoring.logger.warn("Failed to cache token", {
                userId,
                error,
            });
        }
    }
    async isTokenRevoked(token) {
        try {
            const hash = this.hashToken(token);
            const result = await this.deps.redis.get(`revoked:${hash}`);
            return result === "1";
        }
        catch (error) {
            this.deps.monitoring.logger.warn("Failed to check token revocation", {
                error,
            });
            return false;
        }
    }
    hashToken(token) {
        return createHash("sha256").update(token).digest("hex");
    }
    generateJti() {
        return createHash("sha256")
            .update(`${Date.now()}-${Math.random()}`)
            .digest("hex")
            .substring(0, 16);
    }
    parseTimeToSeconds(time) {
        const match = time.match(/^(\d+)([smhd])$/);
        if (!match || !match[1])
            return 3600; // Default 1 hour
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
}
// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================
/**
 * Create JWT service instance
 */
export function createJWTService(config, deps) {
    return new JWTService(config, deps);
}
/**
 * Decode JWT token without verification (for debugging)
 */
export async function decodeToken(token) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3 || !parts[1])
            return null;
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        return payload;
    }
    catch (error) {
        return null;
    }
}
//# sourceMappingURL=jwt-service.js.map