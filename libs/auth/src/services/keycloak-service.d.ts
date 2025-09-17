/**
 * Keycloak Integration Service
 * Handles authentication and user management with Keycloak server
 * Uses the official Keycloak admin client for comprehensive integration
 */
import { User, AuthResult, RegisterData, AuthConfig, ServiceDependencies } from "../types";
export declare class KeycloakService {
    private config;
    private deps;
    private client;
    private initialized;
    constructor(config: AuthConfig, deps: ServiceDependencies);
    /**
     * Initialize Keycloak client connection
     */
    initialize(): Promise<void>;
    /**
     * Enhanced user authentication with comprehensive validation
     * SECURITY FIX: Now properly validates passwords via Keycloak Direct Grant
     */
    authenticateUserEnhanced(email: string, password: string, options?: {
        validateAccountStatus?: boolean;
        recordLoginAttempt?: boolean;
        ipAddress?: string;
        userAgent?: string;
    }): Promise<AuthResult>;
    /**
     * Register new user in Keycloak
     */
    registerUser(data: RegisterData): Promise<AuthResult>;
    /**
     * Get user by ID from Keycloak
     */
    getUserById(userId: string): Promise<User | null>;
    /**
     * Update user in Keycloak
     */
    updateUser(userId: string, updates: Partial<User>): Promise<boolean>;
    /**
     * Delete user from Keycloak
     */
    deleteUser(userId: string): Promise<boolean>;
    /**
     * Get user permissions from Keycloak (derived from roles)
     */
    getUserPermissions(userId: string): Promise<string[]>;
    /**
     * Get user roles from Keycloak
     */
    getUserRoles(userId: string): Promise<any[]>;
    /**
     * Build user display name from Keycloak user data
     */
    private buildUserDisplayName;
    /**
     * Assign roles to user
     */
    assignUserRoles(userId: string, roleNames: string[]): Promise<void>;
    /**
     * Verify Keycloak connection
     */
    healthCheck(): Promise<boolean>;
    /**
     * Perform Direct Grant authentication with Keycloak
     * This method validates user credentials against Keycloak server
     */
    private performDirectGrantAuthentication;
}
/**
 * Create Keycloak service instance
 */
export declare function createKeycloakService(config: AuthConfig, deps: ServiceDependencies): KeycloakService;
/**
 * Initialize Keycloak service
 */
export declare function initializeKeycloakService(service: KeycloakService): Promise<void>;
//# sourceMappingURL=keycloak-service.d.ts.map