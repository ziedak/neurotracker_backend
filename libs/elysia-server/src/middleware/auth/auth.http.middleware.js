/**
 * HTTP Authentication Middleware
 * Production-grade authentication middleware following AbstractMiddleware patterns
 * Integrates with @libs/auth for comprehensive authentication and authorization
 */
import { BaseMiddleware } from "../base";
import { UnauthorizedError, ForbiddenError, } from "@libs/auth";
/**
 * Default authentication middleware configuration constants
 */
const DEFAULT_AUTH_OPTIONS = {
    REQUIRE_AUTH: false,
    ALLOW_ANONYMOUS: true,
    BYPASS_ROUTES: ["/health", "/metrics", "/docs"],
    API_KEY_AUTH: true,
    JWT_AUTH: true,
    SESSION_AUTH: false,
    STRICT_MODE: false,
    EXTRACT_USER_INFO: true,
    PRIORITY: 10, // High priority for auth
};
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
export class AuthHttpMiddleware extends BaseMiddleware {
    authService;
    constructor(metrics, authService, config = {}) {
        // Create complete configuration with validated defaults
        const completeConfig = {
            name: config.name ?? "auth",
            enabled: config.enabled ?? true,
            priority: config.priority ?? DEFAULT_AUTH_OPTIONS.PRIORITY,
            requireAuth: config.requireAuth ?? DEFAULT_AUTH_OPTIONS.REQUIRE_AUTH,
            roles: config.roles ?? [],
            permissions: config.permissions ?? [],
            action: config.action,
            resource: config.resource,
            allowAnonymous: config.allowAnonymous ?? DEFAULT_AUTH_OPTIONS.ALLOW_ANONYMOUS,
            bypassRoutes: config.bypassRoutes ?? DEFAULT_AUTH_OPTIONS.BYPASS_ROUTES,
            skipPaths: [...(config.skipPaths ?? []), ...(config.bypassRoutes ?? [])],
            apiKeyAuth: config.apiKeyAuth ?? DEFAULT_AUTH_OPTIONS.API_KEY_AUTH,
            jwtAuth: config.jwtAuth ?? DEFAULT_AUTH_OPTIONS.JWT_AUTH,
            sessionAuth: config.sessionAuth ?? DEFAULT_AUTH_OPTIONS.SESSION_AUTH,
            strictMode: config.strictMode ?? DEFAULT_AUTH_OPTIONS.STRICT_MODE,
            extractUserInfo: config.extractUserInfo ?? DEFAULT_AUTH_OPTIONS.EXTRACT_USER_INFO,
        };
        super(metrics, completeConfig);
        this.authService = authService;
        this.validateConfiguration();
    }
    /**
     * Core authentication middleware execution logic
     * Handles multiple authentication methods and authorization checks
     */
    async execute(context, next) {
        const startTime = performance.now();
        const requestId = this.generateRequestId();
        try {
            // Attempt authentication through multiple methods
            const authResult = await this.authenticateRequest(context, requestId);
            // Enrich context with authentication information
            this.enrichContext(context, authResult);
            // Perform authorization checks if authentication succeeded or is required
            if (authResult.user ?? this.config.requireAuth) {
                await this.authorizeRequest(context, authResult, requestId);
            }
            // Continue to next middleware
            await next();
            // Record successful request metrics
            await this.recordAuthMetrics("auth_success", {
                method: authResult.method,
                userId: authResult.user?.id ?? "anonymous",
                hasUser: authResult.user ? "true" : "false",
                path: context.request.url,
            });
        }
        catch (error) {
            const duration = performance.now() - startTime;
            await this.recordMetric("auth_error_duration", duration, {
                error_type: error instanceof Error ? error.constructor.name : "unknown",
                path: context.request.url,
            });
            this.logger.error("Authentication middleware error", error, {
                requestId,
                path: context.request.url,
                method: context.request.method,
                duration: Math.round(duration),
            });
            throw error;
        }
        finally {
            const executionTime = performance.now() - startTime;
            await this.recordTimer("auth_execution_time", executionTime, {
                path: context.request.url,
                method: context.request.method,
            });
        }
    }
    /**
     * Attempt authentication using multiple methods
     */
    async authenticateRequest(context, requestId) {
        const results = [];
        // Try JWT authentication
        if (this.config.jwtAuth) {
            const jwtResult = await this.tryJWTAuthentication(context, requestId);
            if (jwtResult.user) {
                return jwtResult;
            }
            results.push(jwtResult);
        }
        // Try API key authentication
        if (this.config.apiKeyAuth) {
            const apiKeyResult = await this.tryApiKeyAuthentication(context, requestId);
            if (apiKeyResult.user) {
                return apiKeyResult;
            }
            results.push(apiKeyResult);
        }
        // Try session authentication
        if (this.config.sessionAuth) {
            const sessionResult = await this.trySessionAuthentication(context, requestId);
            if (sessionResult.user) {
                return sessionResult;
            }
            results.push(sessionResult);
        }
        // If strict mode and no authentication succeeded, handle accordingly
        if (this.config.strictMode && !results.some((r) => r.user)) {
            return {
                user: null,
                authContext: null,
                method: "none",
                error: "No valid authentication found",
            };
        }
        // Return the first attempted result or anonymous result
        return (results[0] ?? {
            user: null,
            authContext: null,
            method: "anonymous",
            error: null,
        });
    }
    async tryJWTAuthentication(context, requestId) {
        try {
            const authHeader = context.request.headers["authorization"];
            if (!authHeader) {
                return {
                    user: null,
                    authContext: null,
                    method: "jwt",
                    error: "Missing authorization header",
                };
            }
            const token = this.authService
                .getJWTService()
                .extractTokenFromHeader(authHeader);
            if (!token) {
                return {
                    user: null,
                    authContext: null,
                    method: "jwt",
                    error: "Invalid token format",
                };
            }
            const user = await this.authService.verifyToken(token);
            if (!user) {
                return {
                    user: null,
                    authContext: null,
                    method: "jwt",
                    error: "Invalid user data",
                };
            }
            const authContext = this.authService
                .getPermissionService()
                .createAuthContext(user);
            this.logger.debug("JWT authentication successful", {
                requestId,
                userId: user.id,
                roles: user.roles,
            });
            return {
                user,
                authContext,
                method: "jwt",
                error: null,
            };
        }
        catch (error) {
            // Check if token is expiring and attempt refresh
            if (error instanceof Error && error.message.includes("expiring soon")) {
                try {
                    this.logger.debug("Token expiring soon, attempting refresh", {
                        requestId,
                    });
                    const authHeader = context.request.headers["authorization"];
                    const token = authHeader
                        ? this.authService
                            .getJWTService()
                            .extractTokenFromHeader(authHeader)
                        : null;
                    if (token) {
                        const refreshResult = await this.authService.refreshToken(token);
                        if (refreshResult.success && refreshResult.user) {
                            const authContext = this.authService
                                .getPermissionService()
                                .createAuthContext(refreshResult.user);
                            // Add refreshed token to response headers if available
                            if (context.response && refreshResult.tokens?.accessToken) {
                                context.response.headers = {
                                    ...context.response.headers,
                                    "x-refreshed-token": refreshResult.tokens.accessToken,
                                };
                            }
                            this.logger.debug("Token refresh successful", {
                                requestId,
                                userId: refreshResult.user.id,
                            });
                            return {
                                user: refreshResult.user,
                                authContext,
                                method: "jwt",
                                error: null,
                            };
                        }
                    }
                }
                catch (refreshError) {
                    this.logger.warn("Token refresh failed", {
                        error: refreshError instanceof Error ? refreshError.message : "unknown",
                        requestId,
                    });
                }
            }
            this.logger.warn("JWT authentication failed", {
                error: error instanceof Error ? error.message : "unknown",
                requestId,
            });
            // Map specific error messages
            let errorMessage = "JWT authentication failed";
            if (error instanceof Error) {
                if (error.message.includes("Redis")) {
                    errorMessage = "Redis connection failed";
                }
                else if (error.message.includes("expiring soon")) {
                    errorMessage = "Token expiring soon";
                }
                else {
                    errorMessage = error.message;
                }
            }
            return {
                user: null,
                authContext: null,
                method: "jwt",
                error: errorMessage,
            };
        }
    }
    /**
     * Try API key authentication
     */
    async tryApiKeyAuthentication(context, requestId) {
        try {
            const apiKey = context.request.headers["x-api-key"];
            if (!apiKey) {
                return {
                    user: null,
                    authContext: null,
                    method: "api_key",
                    error: "No API key found",
                };
            }
            const validationResult = await this.authService
                .getApiKeyService()
                .validateApiKey(apiKey);
            if (!validationResult) {
                return {
                    user: null,
                    authContext: null,
                    method: "api_key",
                    error: "Invalid API key",
                };
            }
            const user = await this.authService.getUserById(validationResult.userId);
            if (!user) {
                return {
                    user: null,
                    authContext: null,
                    method: "api_key",
                    error: "User not found for API key",
                };
            }
            const authContext = this.authService
                .getPermissionService()
                .createAuthContext(user);
            this.logger.debug("API key authentication successful", {
                requestId,
                userId: user.id,
            });
            return {
                user,
                authContext,
                method: "api_key",
                error: null,
            };
        }
        catch (error) {
            this.logger.warn("API key authentication failed", {
                error: error instanceof Error ? error.message : "unknown",
                requestId,
            });
            return {
                user: null,
                authContext: null,
                method: "api_key",
                error: error instanceof Error
                    ? error.message
                    : "API key authentication failed",
            };
        }
    }
    /**
     * Try session-based authentication
     */
    async trySessionAuthentication(context, requestId) {
        try {
            // Extract session ID from cookies or headers
            const sessionId = this.extractSessionId(context);
            if (!sessionId) {
                return {
                    user: null,
                    authContext: null,
                    method: "session",
                    error: "No session ID found",
                };
            }
            // Validate session and get user
            const session = await this.authService
                .getSessionService()
                .getSession(sessionId);
            if (!session?.isActive) {
                return {
                    user: null,
                    authContext: null,
                    method: "session",
                    error: "Invalid or expired session",
                };
            }
            const user = await this.authService.getUserById(session.userId);
            if (!user) {
                return {
                    user: null,
                    authContext: null,
                    method: "session",
                    error: "User not found for session",
                };
            }
            const authContext = this.authService
                .getPermissionService()
                .createAuthContext(user);
            this.logger.debug("Session authentication successful", {
                requestId,
                userId: user.id,
                sessionId,
            });
            return {
                user,
                authContext,
                session,
                method: "session",
                error: null,
            };
        }
        catch (error) {
            this.logger.warn("Session authentication failed", {
                error: error instanceof Error ? error.message : "unknown",
                requestId,
            });
            return {
                user: null,
                authContext: null,
                method: "session",
                error: error instanceof Error
                    ? error.message
                    : "Session authentication failed",
            };
        }
    }
    /**
     * Perform authorization checks
     */
    async authorizeRequest(context, authResult, requestId) {
        // Check if authentication is required but missing
        if (this.config.requireAuth && !authResult.user) {
            await this.recordAuthMetrics("auth_failure", {
                reason: "authentication_required",
                path: context.request.url,
            });
            // Throw the specific error from authentication if available, otherwise generic error
            const errorMessage = authResult.error || "Authentication required";
            throw new UnauthorizedError(errorMessage);
        }
        // If no user, skip authorization checks (assuming allowAnonymous is true)
        if (!authResult.user && !authResult.authContext) {
            if (this.config.requireAuth) {
                throw new UnauthorizedError("Authentication required");
            }
            return;
        }
        const { user } = authResult;
        if (!user) {
            throw new UnauthorizedError("Authentication required");
        }
        // Check role requirements
        if (this.config.roles && this.config.roles.length > 0) {
            const hasRequiredRole = this.config.roles.some((role) => user?.roles.includes(role));
            if (!hasRequiredRole) {
                await this.recordAuthMetrics("auth_failure", {
                    reason: "insufficient_roles",
                    userId: user?.id ?? "unknown",
                    requiredRoles: this.config.roles.join(","),
                    userRoles: user?.roles.join(",") ?? "unknown",
                });
                throw new ForbiddenError("Insufficient role permissions");
            }
        }
        // Check permission requirements
        if (this.config.permissions && this.config.permissions.length > 0) {
            const hasRequiredPermission = this.config.permissions.some((permission) => user?.permissions.includes(permission));
            if (!hasRequiredPermission) {
                await this.recordAuthMetrics("auth_failure", {
                    reason: "insufficient_permissions",
                    userId: user?.id ?? "unknown",
                    requiredPermissions: this.config.permissions.join(","),
                });
                throw new ForbiddenError("Insufficient permissions");
            }
        }
        // Check CASL ability requirements
        if (this.config.action && this.config.resource) {
            const canPerform = this.authService.can(user, this.config.action, this.config.resource);
            if (!canPerform) {
                await this.recordAuthMetrics("auth_failure", {
                    reason: "insufficient_ability",
                    userId: user?.id ?? "unknown",
                    action: this.config.action,
                    resource: this.config.resource,
                });
                throw new ForbiddenError("Insufficient permissions for this action");
            }
        }
        // Check HTTP method/path based permissions if no specific action/resource configured
        if (!this.config.action && !this.config.resource) {
            const canPerform = this.authService.can(user, context.request.method, context.request.url);
            if (!canPerform) {
                await this.recordAuthMetrics("auth_failure", {
                    reason: "insufficient_permissions",
                    userId: user?.id ?? "unknown",
                    method: context.request.method,
                    path: context.request.url,
                });
                throw new ForbiddenError("Insufficient permissions");
            }
        }
        // Log successful authorization
        this.logger.debug("Authorization successful", {
            requestId,
            userId: user.id,
            path: context.request.url,
            method: context.request.method,
            roles: user.roles,
            permissions: user.permissions,
        });
    }
    /**
     * Enrich context with authentication information
     */
    enrichContext(context, authResult) {
        if (this.config.extractUserInfo) {
            if (authResult.user) {
                context.user = {
                    id: authResult.user.id,
                    roles: authResult.user.roles || [],
                    permissions: authResult.user.permissions || [],
                    authenticated: true,
                    anonymous: false,
                    ...authResult.user,
                };
            }
            context["authContext"] = authResult.authContext;
            context["isAuthenticated"] = !!authResult.user;
            context["authMethod"] = authResult.method;
            // Set session information if available
            if (authResult.session) {
                context["session"] = authResult.session;
            }
        }
    }
    /**
     * Extract session ID from cookies or headers
     */
    extractSessionId(context) {
        // Check header first
        const sessionHeader = context.request.headers["x-session-id"];
        if (sessionHeader) {
            return sessionHeader;
        }
        // Check cookies
        const cookies = context.request.headers["cookie"];
        if (cookies) {
            const sessionCookieMatch = cookies.match(/sessionid=([^;]+)/);
            if (sessionCookieMatch?.[1]) {
                return sessionCookieMatch[1];
            }
        }
        return null;
    }
    /**
     * Generate unique request ID
     */
    generateRequestId() {
        return `auth_req_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 15)}`;
    }
    /**
     * Record authentication-specific metrics
     */
    async recordAuthMetrics(action, additionalTags = {}) {
        await this.recordMetric(`auth_${action}`, 1, additionalTags);
    }
    /**
     * Validate configuration on instantiation
     */
    validateConfiguration() {
        if (!this.config.jwtAuth &&
            !this.config.apiKeyAuth &&
            !this.config.sessionAuth) {
            throw new Error("At least one authentication method must be enabled");
        }
        if (this.config.action && !this.config.resource) {
            throw new Error("Resource must be specified when action is provided");
        }
        if (this.config.resource && !this.config.action) {
            throw new Error("Action must be specified when resource is provided");
        }
    }
    /**
     * Create require authentication configuration preset
     */
    static createRequireAuthConfig() {
        return {
            name: "auth-required",
            requireAuth: true,
            allowAnonymous: false,
            enabled: true,
            priority: DEFAULT_AUTH_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create optional authentication configuration preset
     */
    static createOptionalAuthConfig() {
        return {
            name: "auth-optional",
            requireAuth: false,
            allowAnonymous: true,
            enabled: true,
            priority: DEFAULT_AUTH_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create role-based authentication configuration preset
     */
    static createRoleBasedConfig(roles) {
        return {
            name: "auth-role-based",
            requireAuth: true,
            roles,
            allowAnonymous: false,
            enabled: true,
            priority: DEFAULT_AUTH_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create permission-based authentication configuration preset
     */
    static createPermissionBasedConfig(permissions) {
        return {
            name: "auth-permission-based",
            requireAuth: true,
            permissions,
            allowAnonymous: false,
            enabled: true,
            priority: DEFAULT_AUTH_OPTIONS.PRIORITY,
        };
    }
    /**
     * Create ability-based authentication configuration preset
     */
    static createAbilityBasedConfig(action, resource) {
        return {
            name: "auth-ability-based",
            requireAuth: true,
            action,
            resource,
            allowAnonymous: false,
            enabled: true,
            priority: DEFAULT_AUTH_OPTIONS.PRIORITY,
        };
    }
}
/**
 * Factory function for authentication middleware creation
 * Provides type-safe instantiation with optional configuration
 */
export function createAuthHttpMiddleware(metrics, authService, config) {
    return new AuthHttpMiddleware(metrics, authService, config);
}
/**
 * Preset configurations for common authentication scenarios
 * Immutable configuration objects for different environments and use cases
 */
export const AUTH_PRESETS = {
    requireAuth: () => AuthHttpMiddleware.createRequireAuthConfig(),
    optionalAuth: () => AuthHttpMiddleware.createOptionalAuthConfig(),
    adminOnly: () => AuthHttpMiddleware.createRoleBasedConfig(["admin"]),
    userOrAdmin: () => AuthHttpMiddleware.createRoleBasedConfig(["user", "admin"]),
    apiAccess: () => ({
        name: "auth-api-access",
        requireAuth: true,
        apiKeyAuth: true,
        jwtAuth: false,
        sessionAuth: false,
        allowAnonymous: false,
        enabled: true,
        priority: DEFAULT_AUTH_OPTIONS.PRIORITY,
    }),
    webApp: () => ({
        name: "auth-webapp",
        requireAuth: false,
        jwtAuth: true,
        sessionAuth: true,
        apiKeyAuth: false,
        allowAnonymous: true,
        bypassRoutes: ["/health", "/metrics", "/docs", "/static", "/favicon.ico"],
        enabled: true,
        priority: DEFAULT_AUTH_OPTIONS.PRIORITY,
    }),
    development: () => ({
        name: "auth-development",
        requireAuth: false,
        allowAnonymous: true,
        strictMode: false,
        bypassRoutes: ["/health", "/metrics", "/docs", "/static", "/test"],
        enabled: true,
        priority: DEFAULT_AUTH_OPTIONS.PRIORITY,
    }),
    production: () => ({
        name: "auth-production",
        requireAuth: true,
        allowAnonymous: false,
        strictMode: true,
        bypassRoutes: ["/health", "/metrics"],
        enabled: true,
        priority: DEFAULT_AUTH_OPTIONS.PRIORITY,
    }),
};
//# sourceMappingURL=auth.http.middleware.js.map