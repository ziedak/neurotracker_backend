/**
 * Token Management Service
 * Handles JWT token operations, refresh logic, and token lifecycle
 * Part of Phase 2 service refactoring for single responsibility principle
 */
import { User, AuthToken, AuthResult, ServiceDependencies } from "../types";
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
export declare class TokenManagementService implements ITokenManagementService {
    private deps;
    private jwtService;
    constructor(deps: ServiceDependencies, services: {
        jwtService: JWTService;
    });
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
    /**
     * Validate token format and basic structure
     */
    validateTokenFormat(token: string): boolean;
    /**
     * Get token expiration time (using basic JWT decode)
     */
    getTokenExpiration(token: string): Date | null;
    /**
     * Check if token is blacklisted (simplified implementation)
     */
    isTokenBlacklisted(token: string): Promise<boolean>;
}
//# sourceMappingURL=token-management-service.d.ts.map