/**
 * JWT Token Service
 * Handles JWT token generation, validation, refresh, and revocation operations
 * Does NOT handle user authentication - all authentication flows go through Keycloak
 * Uses battle-tested libraries for security and performance
 */
import { JWTPayload } from "jose";
import { User, AuthToken, AuthConfig, ServiceDependencies } from "../types";
export declare class JWTService {
    private config;
    private deps;
    private readonly secret;
    constructor(config: AuthConfig, deps: ServiceDependencies);
    /**
     * Generate access and refresh tokens for user
     */
    generateTokens(user: User): Promise<AuthToken>;
    /**
     * Verify and decode JWT token
     */
    verifyToken(token: string): Promise<User>;
    /**
     * Refresh access token using refresh token
     */
    refreshToken(refreshToken: string): Promise<AuthToken>;
    /**
     * Revoke a specific token
     */
    revokeToken(token: string): Promise<void>;
    /**
     * Revoke all tokens for a user
     */
    revokeAllUserTokens(userId: string): Promise<void>;
    /**
     * Extract token from Authorization header
     */
    extractTokenFromHeader(authHeader: string): string | null;
    /**
     * Validate token format
     */
    validateTokenFormat(token: string): boolean;
    private cacheToken;
    private isTokenRevoked;
    private hashToken;
    private generateJti;
    private parseTimeToSeconds;
}
/**
 * Create JWT service instance
 */
export declare function createJWTService(config: AuthConfig, deps: ServiceDependencies): JWTService;
/**
 * Decode JWT token without verification (for debugging)
 */
export declare function decodeToken(token: string): Promise<JWTPayload | null>;
//# sourceMappingURL=jwt-service.d.ts.map