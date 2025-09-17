/**
 * Main Authentication Service
 * Orchestrates JWT, Keycloak, and Permission services for comprehensive authentication
 * Provides unified interface for all authentication operations
 */
import { AuthError, } from "../types";
import { JWTService } from "./jwt-service";
import { KeycloakService } from "./keycloak-service";
import { PermissionService } from "./permission-service";
import { SessionService } from "./session-service";
import { ApiKeyService } from "./api-key-service";
import { PasswordPolicyService } from "./password-policy-service";
// Phase 2: Focused Services Integration
import { UserAuthenticationService, } from "./user-authentication-service";
import { TokenManagementService, } from "./token-management-service";
import { UserManagementService, } from "./user-management-service";
// ===================================================================
// AUTHENTICATION SERVICE CLASS
// ===================================================================
export class AuthenticationService {
    config;
    deps;
    jwtService;
    keycloakService;
    permissionService;
    sessionService;
    apiKeyService;
    // Phase 2: Focused Services (Single Responsibility Principle)
    userAuthService;
    tokenManagementService;
    userManagementService;
    // Enhanced Services (optional)
    monitoringService;
    configValidator;
    permissionCache;
    threatDetector;
    passwordPolicyService;
    constructor(config, deps) {
        this.config = config;
        this.deps = deps;
        this.jwtService = new JWTService(this.config, deps);
        this.keycloakService = new KeycloakService(this.config, deps);
        this.permissionService = new PermissionService(deps);
        this.sessionService = new SessionService(this.config, deps);
        this.apiKeyService = new ApiKeyService(this.config, deps);
        // Initialize password policy service if configuration is provided
        if (this.config.passwordPolicy) {
            this.passwordPolicyService = new PasswordPolicyService(this.config, deps);
        }
        // Initialize Phase 2 focused services
        this.userAuthService = new UserAuthenticationService(deps, {
            keycloakService: this.keycloakService,
            jwtService: this.jwtService,
            sessionService: this.sessionService,
            ...(this.passwordPolicyService && {
                passwordPolicyService: this.passwordPolicyService,
            }),
        });
        this.tokenManagementService = new TokenManagementService(deps, {
            jwtService: this.jwtService,
        });
        this.userManagementService = new UserManagementService(deps, {
            keycloakService: this.keycloakService,
            sessionService: this.sessionService,
        });
    }
    /**
     * Initialize all authentication services
     */
    async initialize() {
        try {
            await this.keycloakService.initialize();
            // Validate configuration if validator is available
            if (this.configValidator) {
                const validation = this.configValidator.validateConfig(this.config);
                if (!validation.isValid) {
                    throw new Error(`Configuration validation failed: ${validation.errors
                        .map((e) => e.message)
                        .join(", ")}`);
                }
            }
            this.deps.monitoring.logger.info("Authentication service initialized successfully");
        }
        catch (error) {
            this.deps.monitoring.logger.error("Failed to initialize authentication service", { error });
            throw new AuthError("Authentication service initialization failed", "AUTH_INIT_FAILED");
        }
    }
    /**
     * Initialize enhanced services
     */
    async initializeEnhancedServices() {
        // Services are initialized as optional dependencies
        this.deps.monitoring.logger.info("Enhanced authentication services initialized");
    }
    /**
     * Login user with email and password
     * Delegates to UserAuthenticationService for focused responsibility
     */
    async login(credentials) {
        try {
            // Delegate to focused UserAuthenticationService
            const result = await this.userAuthService.login(credentials);
            // Enrich with permissions if successful
            if (result.success && result.user) {
                const userWithPermissions = await this.enrichUserWithPermissions(result.user);
                return {
                    ...result,
                    user: userWithPermissions,
                };
            }
            return result;
        }
        catch (error) {
            this.deps.monitoring.logger.error("Login delegation failed", {
                email: credentials.email,
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                success: false,
                error: "Login failed",
                code: "LOGIN_FAILED",
            };
        }
    }
    /**
     * Register new user
     * Delegates to UserAuthenticationService for focused responsibility
     */
    async register(data) {
        try {
            // Delegate to focused UserAuthenticationService
            const result = await this.userAuthService.register(data);
            // Enrich with permissions if successful
            if (result.success && result.user) {
                const userWithPermissions = await this.enrichUserWithPermissions(result.user);
                return {
                    ...result,
                    user: userWithPermissions,
                };
            }
            return result;
        }
        catch (error) {
            this.deps.monitoring.logger.error("Registration delegation failed", {
                email: data.email,
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                success: false,
                error: "Registration failed",
                code: "REGISTRATION_FAILED",
            };
        }
    }
    /**
     * Refresh access token
     */
    /**
     * Refresh access token
     * Delegates to TokenManagementService for focused responsibility
     */
    async refreshToken(refreshToken) {
        try {
            // Delegate to focused TokenManagementService
            const result = await this.tokenManagementService.refreshToken(refreshToken);
            // Enrich with permissions if successful
            if (result.success && result.user) {
                const userWithPermissions = await this.enrichUserWithPermissions(result.user);
                return {
                    ...result,
                    user: userWithPermissions,
                };
            }
            return result;
        }
        catch (error) {
            this.deps.monitoring.logger.error("Token refresh delegation failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            return {
                success: false,
                error: "Token refresh failed",
                code: "TOKEN_REFRESH_FAILED",
            };
        }
    }
    /**
     * Logout user (revoke tokens)
     */
    /**
     * Logout user and revoke tokens
     * Delegates to UserAuthenticationService for focused responsibility
     */
    async logout(userId, token) {
        try {
            // Delegate to focused UserAuthenticationService
            return await this.userAuthService.logout(userId, token);
        }
        catch (error) {
            this.deps.monitoring.logger.error("Logout delegation failed", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }
    /**
     * Verify JWT token and return user
     */
    /**
     * Verify JWT token and return user
     * Delegates to TokenManagementService for focused responsibility
     */
    async verifyToken(token) {
        try {
            // Delegate to focused TokenManagementService
            const user = await this.tokenManagementService.verifyToken(token);
            if (user) {
                return await this.enrichUserWithPermissions(user);
            }
            return null;
        }
        catch (error) {
            this.deps.monitoring.logger.error("Token verification delegation failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
    /**
     * Get user by ID
     */
    /**
     * Get user by ID
     * Delegates to UserManagementService for focused responsibility
     */
    async getUserById(userId) {
        try {
            // Delegate to focused UserManagementService
            const user = await this.userManagementService.getUserById(userId);
            if (user) {
                return await this.enrichUserWithPermissions(user);
            }
            return null;
        }
        catch (error) {
            this.deps.monitoring.logger.error("Get user delegation failed", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
    /**
     * Update user
     * Delegates to UserManagementService for focused responsibility
     */
    async updateUser(userId, updates) {
        try {
            // Delegate to focused UserManagementService
            return await this.userManagementService.updateUser(userId, updates);
        }
        catch (error) {
            this.deps.monitoring.logger.error("Update user delegation failed", {
                userId,
                error: error instanceof Error ? error.message : String(error),
            });
            return false;
        }
    }
    /**
     * Delete user
     */
    async deleteUser(userId) {
        try {
            // Revoke all tokens first
            await this.jwtService.revokeAllUserTokens(userId);
            // Delete from Keycloak
            return await this.keycloakService.deleteUser(userId);
        }
        catch (error) {
            this.deps.monitoring.logger.error("Failed to delete user", {
                userId,
                error,
            });
            return false;
        }
    }
    /**
     * Check if user has permission
     */
    can(user, action, resource, subject) {
        return this.permissionService.can(user, action, resource, subject);
    }
    /**
     * Get user's permissions
     */
    getUserPermissions(user) {
        return this.permissionService.getUserPermissions(user);
    }
    /**
     * Get permission service instance
     */
    getPermissionService() {
        return this.permissionService;
    }
    /**
     * Get JWT service instance
     */
    getJWTService() {
        return this.jwtService;
    }
    /**
     * Get Keycloak service instance
     */
    getKeycloakService() {
        return this.keycloakService;
    }
    /**
     * Get Session service instance
     */
    getSessionService() {
        return this.sessionService;
    }
    /**
     * Get API Key service instance
     */
    getApiKeyService() {
        return this.apiKeyService;
    }
    /**
     * Get Enhanced Monitoring service instance
     */
    getMonitoringService() {
        return this.monitoringService;
    }
    /**
     * Get Configuration Validation service instance
     */
    getConfigValidator() {
        return this.configValidator;
    }
    /**
     * Get Permission Cache service instance
     */
    getPermissionCache() {
        return this.permissionCache;
    }
    /**
     * Set Enhanced Monitoring service
     */
    setMonitoringService(service) {
        this.monitoringService = service;
    }
    /**
     * Set Configuration Validation service
     */
    setConfigValidator(service) {
        this.configValidator = service;
    }
    /**
     * Set Permission Cache service
     */
    setPermissionCache(service) {
        this.permissionCache = service;
    }
    /**
     * Set Threat Detection service
     */
    setThreatDetector(service) {
        this.threatDetector = service;
    }
    /**
     * Health check for all services
     */
    async healthCheck() {
        try {
            const jwtHealth = true; // JWT service doesn't have external dependencies
            const keycloakHealth = await this.keycloakService.healthCheck();
            const permissionsHealth = true; // Permission service is internal
            const monitoringHealth = this.monitoringService ? true : undefined;
            const cacheHealth = this.permissionCache ? true : undefined;
            const threatDetectionHealth = this.threatDetector ? true : undefined;
            const overall = jwtHealth && keycloakHealth && permissionsHealth;
            return {
                jwt: jwtHealth,
                keycloak: keycloakHealth,
                permissions: permissionsHealth,
                monitoring: monitoringHealth,
                cache: cacheHealth,
                threatDetection: threatDetectionHealth,
                overall,
            };
        }
        catch (error) {
            this.deps.monitoring.logger.error("Health check failed", { error });
            return {
                jwt: false,
                keycloak: false,
                permissions: false,
                monitoring: false,
                cache: false,
                threatDetection: false,
                overall: false,
            };
        }
    }
    // ===================================================================
    // PRIVATE METHODS
    // ===================================================================
    async enrichUserWithPermissions(user) {
        try {
            // Try to get from cache first
            if (this.permissionCache) {
                const cachedPermissions = await this.permissionCache.getUserPermissions(user.id);
                if (cachedPermissions) {
                    return {
                        ...user,
                        permissions: cachedPermissions,
                    };
                }
            }
            // Get permissions from permission service
            const permissions = this.permissionService.getUserPermissions(user);
            // Cache the permissions
            if (this.permissionCache) {
                await this.permissionCache.setUserPermissions(user.id, permissions, user.roles);
            }
            return {
                ...user,
                permissions,
            };
        }
        catch (error) {
            this.deps.monitoring.logger.warn("Failed to enrich user with permissions", {
                userId: user.id,
                error,
            });
            return user;
        }
    }
}
// ===================================================================
// UTILITY FUNCTIONS
// ===================================================================
/**
 * Create authentication service instance
 */
export function createAuthenticationService(config, deps, enhancedServices) {
    const service = new AuthenticationService(config, deps);
    // Attach enhanced services if provided
    if (enhancedServices?.monitoring) {
        service.setMonitoringService(enhancedServices.monitoring);
    }
    if (enhancedServices?.configValidator) {
        service.setConfigValidator(enhancedServices.configValidator);
    }
    if (enhancedServices?.permissionCache) {
        service.setPermissionCache(enhancedServices.permissionCache);
    }
    if (enhancedServices?.threatDetector) {
        service.setThreatDetector(enhancedServices.threatDetector);
    }
    return service;
}
/**
 * Initialize authentication service
 */
export async function initializeAuthenticationService(service) {
    await service.initialize();
}
//# sourceMappingURL=auth-service.js.map