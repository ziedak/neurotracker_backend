/**
 * HTTP Authentication Middleware
 * Production-grade authentication middleware following AbstractMiddleware patterns
 * Integrates with @libs/auth for comprehensive authentication and authorization
 */
import { type IMetricsCollector } from "@libs/monitoring";
import { BaseMiddleware, type HttpMiddlewareConfig } from "../base";
import type { MiddlewareContext } from "../types";
import { type AuthenticationService, type Action, type Resource } from "@libs/auth";
/**
 * Authentication middleware configuration interface
 * Extends HttpMiddlewareConfig with authentication-specific options
 */
export interface AuthHttpMiddlewareConfig extends HttpMiddlewareConfig {
    readonly requireAuth?: boolean;
    readonly roles?: readonly string[];
    readonly permissions?: readonly string[];
    readonly action?: Action;
    readonly resource?: Resource;
    readonly allowAnonymous?: boolean;
    readonly bypassRoutes?: readonly string[];
    readonly apiKeyAuth?: boolean;
    readonly jwtAuth?: boolean;
    readonly sessionAuth?: boolean;
    readonly strictMode?: boolean;
    readonly extractUserInfo?: boolean;
}
/**
 * Production-grade HTTP Authentication Middleware
 * Framework-agnostic implementation with comprehensive authentication support
 *
 * Features:
 * - JWT token authentication
 * - API key authentication
 * - Session-based authentication
 * - Role-based access control (RBAC)
 * - Permission-based access control
 * - CASL ability-based authorization
 * - Comprehensive error handling
 * - Metrics and monitoring integration
 * - Path-based bypass rules
 * - Configurable authentication modes
 *
 * @template AuthHttpMiddlewareConfig - Authentication-specific configuration
 */
export declare class AuthHttpMiddleware extends BaseMiddleware<AuthHttpMiddlewareConfig> {
    private readonly authService;
    constructor(metrics: IMetricsCollector, authService: AuthenticationService, config?: Partial<AuthHttpMiddlewareConfig>);
    /**
     * Core authentication middleware execution logic
     * Handles multiple authentication methods and authorization checks
     */
    protected execute(context: MiddlewareContext, next: () => Promise<void>): Promise<void>;
    /**
     * Attempt authentication using multiple methods
     */
    private authenticateRequest;
    private tryJWTAuthentication;
    /**
     * Try API key authentication
     */
    private tryApiKeyAuthentication;
    /**
     * Try session-based authentication
     */
    private trySessionAuthentication;
    /**
     * Perform authorization checks
     */
    private authorizeRequest;
    /**
     * Enrich context with authentication information
     */
    private enrichContext;
    /**
     * Extract session ID from cookies or headers
     */
    private extractSessionId;
    /**
     * Generate unique request ID
     */
    private generateRequestId;
    /**
     * Record authentication-specific metrics
     */
    private recordAuthMetrics;
    /**
     * Validate configuration on instantiation
     */
    private validateConfiguration;
    /**
     * Create require authentication configuration preset
     */
    static createRequireAuthConfig(): Partial<AuthHttpMiddlewareConfig>;
    /**
     * Create optional authentication configuration preset
     */
    static createOptionalAuthConfig(): Partial<AuthHttpMiddlewareConfig>;
    /**
     * Create role-based authentication configuration preset
     */
    static createRoleBasedConfig(roles: string[]): Partial<AuthHttpMiddlewareConfig>;
    /**
     * Create permission-based authentication configuration preset
     */
    static createPermissionBasedConfig(permissions: string[]): Partial<AuthHttpMiddlewareConfig>;
    /**
     * Create ability-based authentication configuration preset
     */
    static createAbilityBasedConfig(action: Action, resource: Resource): Partial<AuthHttpMiddlewareConfig>;
}
/**
 * Factory function for authentication middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export declare function createAuthHttpMiddleware(metrics: IMetricsCollector, authService: AuthenticationService, config?: Partial<AuthHttpMiddlewareConfig>): AuthHttpMiddleware;
/**
 * Preset configurations for common authentication scenarios
 * Immutable configuration objects for different environments and use cases
 */
export declare const AUTH_PRESETS: {
    readonly requireAuth: () => Partial<AuthHttpMiddlewareConfig>;
    readonly optionalAuth: () => Partial<AuthHttpMiddlewareConfig>;
    readonly adminOnly: () => Partial<AuthHttpMiddlewareConfig>;
    readonly userOrAdmin: () => Partial<AuthHttpMiddlewareConfig>;
    readonly apiAccess: () => Partial<AuthHttpMiddlewareConfig>;
    readonly webApp: () => Partial<AuthHttpMiddlewareConfig>;
    readonly development: () => Partial<AuthHttpMiddlewareConfig>;
    readonly production: () => Partial<AuthHttpMiddlewareConfig>;
};
//# sourceMappingURL=auth.http.middleware.d.ts.map