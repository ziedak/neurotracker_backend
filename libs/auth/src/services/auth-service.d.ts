/**
 * Main Authentication Service
 * Orchestrates JWT, Keycloak, and Permission services for comprehensive authentication
 * Provides unified interface for all authentication operations
 */
import { User, AuthResult, LoginCredentials, RegisterData, AuthConfig, ServiceDependencies } from "../types";
import { JWTService } from "./jwt-service";
import { KeycloakService } from "./keycloak-service";
import { PermissionService } from "./permission-service";
import { SessionService } from "./session-service";
import { ApiKeyService } from "./api-key-service";
import { EnhancedMonitoringService } from "./enhanced-monitoring-service";
import { ConfigValidationService } from "./config-validation-service";
import { EnhancedPermissionCacheService } from "./enhanced-permission-cache-service";
import { AdvancedThreatDetectionService } from "./advanced-threat-detection-service";
export declare class AuthenticationService {
    private config;
    private deps;
    private jwtService;
    private keycloakService;
    private permissionService;
    private sessionService;
    private apiKeyService;
    private userAuthService;
    private tokenManagementService;
    private userManagementService;
    private monitoringService?;
    private configValidator?;
    private permissionCache?;
    private threatDetector?;
    private passwordPolicyService?;
    constructor(config: AuthConfig, deps: ServiceDependencies);
    /**
     * Initialize all authentication services
     */
    initialize(): Promise<void>;
    /**
     * Initialize enhanced services
     */
    initializeEnhancedServices(): Promise<void>;
    /**
     * Login user with email and password
     * Delegates to UserAuthenticationService for focused responsibility
     */
    login(credentials: LoginCredentials): Promise<AuthResult>;
    /**
     * Register new user
     * Delegates to UserAuthenticationService for focused responsibility
     */
    register(data: RegisterData): Promise<AuthResult>;
    /**
     * Refresh access token
     */
    /**
     * Refresh access token
     * Delegates to TokenManagementService for focused responsibility
     */
    refreshToken(refreshToken: string): Promise<AuthResult>;
    /**
     * Logout user (revoke tokens)
     */
    /**
     * Logout user and revoke tokens
     * Delegates to UserAuthenticationService for focused responsibility
     */
    logout(userId: string, token?: string): Promise<boolean>;
    /**
     * Verify JWT token and return user
     */
    /**
     * Verify JWT token and return user
     * Delegates to TokenManagementService for focused responsibility
     */
    verifyToken(token: string): Promise<User | null>;
    /**
     * Get user by ID
     */
    /**
     * Get user by ID
     * Delegates to UserManagementService for focused responsibility
     */
    getUserById(userId: string): Promise<User | null>;
    /**
     * Update user
     * Delegates to UserManagementService for focused responsibility
     */
    updateUser(userId: string, updates: Partial<User>): Promise<boolean>;
    /**
     * Delete user
     */
    deleteUser(userId: string): Promise<boolean>;
    /**
     * Check if user has permission
     */
    can(user: User, action: string, resource: string, subject?: any): boolean;
    /**
     * Get user's permissions
     */
    getUserPermissions(user: User): string[];
    /**
     * Get permission service instance
     */
    getPermissionService(): PermissionService;
    /**
     * Get JWT service instance
     */
    getJWTService(): JWTService;
    /**
     * Get Keycloak service instance
     */
    getKeycloakService(): KeycloakService;
    /**
     * Get Session service instance
     */
    getSessionService(): SessionService;
    /**
     * Get API Key service instance
     */
    getApiKeyService(): ApiKeyService;
    /**
     * Get Enhanced Monitoring service instance
     */
    getMonitoringService(): EnhancedMonitoringService | undefined;
    /**
     * Get Configuration Validation service instance
     */
    getConfigValidator(): ConfigValidationService | undefined;
    /**
     * Get Permission Cache service instance
     */
    getPermissionCache(): EnhancedPermissionCacheService | undefined;
    /**
     * Set Enhanced Monitoring service
     */
    setMonitoringService(service: EnhancedMonitoringService): void;
    /**
     * Set Configuration Validation service
     */
    setConfigValidator(service: ConfigValidationService): void;
    /**
     * Set Permission Cache service
     */
    setPermissionCache(service: EnhancedPermissionCacheService): void;
    /**
     * Set Threat Detection service
     */
    setThreatDetector(service: AdvancedThreatDetectionService): void;
    /**
     * Health check for all services
     */
    healthCheck(): Promise<{
        jwt: boolean;
        keycloak: boolean;
        permissions: boolean;
        overall: boolean;
        monitoring?: boolean | undefined;
        cache?: boolean | undefined;
        threatDetection?: boolean | undefined;
    }>;
    private enrichUserWithPermissions;
}
/**
 * Create authentication service instance
 */
export declare function createAuthenticationService(config: AuthConfig, deps: ServiceDependencies, enhancedServices?: {
    monitoring?: EnhancedMonitoringService;
    configValidator?: ConfigValidationService;
    permissionCache?: EnhancedPermissionCacheService;
    threatDetector?: AdvancedThreatDetectionService;
}): AuthenticationService;
/**
 * Initialize authentication service
 */
export declare function initializeAuthenticationService(service: AuthenticationService): Promise<void>;
//# sourceMappingURL=auth-service.d.ts.map