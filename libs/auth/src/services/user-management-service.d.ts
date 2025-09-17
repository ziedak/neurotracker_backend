/**
 * User Management Service
 * Handles user CRUD operations (Create, Read, Update, Delete)
 * Part of Phase 2 service refactoring for single responsibility principle
 */
import { User, ServiceDependencies } from "../types";
import { KeycloakService } from "./keycloak-service";
import { SessionService } from "./session-service";
/**
 * Interface for User Management Service
 */
export interface IUserManagementService {
    /**
     * Get user by ID
     */
    getUserById(userId: string): Promise<User | null>;
    /**
     * Update user information
     */
    updateUser(userId: string, updates: Partial<User>): Promise<boolean>;
    /**
     * Delete user account
     */
    deleteUser(userId: string): Promise<boolean>;
    /**
     * Search users (admin function)
     */
    searchUsers(query: string, limit?: number): Promise<User[]>;
    /**
     * Get user's active sessions
     */
    getUserSessions(userId: string): Promise<any[]>;
    /**
     * Validate user update data
     */
    validateUserUpdate(updates: Partial<User>): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
}
/**
 * User Management Service Implementation
 *
 * Responsible for:
 * - User profile management (CRUD operations)
 * - User data validation
 * - User search and filtering
 * - User session management coordination
 */
export declare class UserManagementService implements IUserManagementService {
    private deps;
    private keycloakService;
    private sessionService;
    constructor(deps: ServiceDependencies, services: {
        keycloakService: KeycloakService;
        sessionService: SessionService;
    });
    /**
     * Get user by ID from Keycloak
     */
    getUserById(userId: string): Promise<User | null>;
    /**
     * Update user information
     */
    updateUser(userId: string, updates: Partial<User>): Promise<boolean>;
    /**
     * Delete user account and all associated data
     */
    deleteUser(userId: string): Promise<boolean>;
    /**
     * Search users by email, name, or other criteria
     */
    searchUsers(query: string, limit?: number): Promise<User[]>;
    /**
     * Get user's active sessions
     */
    getUserSessions(userId: string): Promise<any[]>;
    /**
     * Validate user update data
     */
    validateUserUpdate(updates: Partial<User>): Promise<{
        valid: boolean;
        errors?: string[];
    }>;
    /**
     * Enrich user data with additional information
     */
    private enrichUserData;
    /**
     * Validate email format
     */
    private isValidEmail;
    /**
     * Get user statistics (admin function)
     */
    getUserStats(userId: string): Promise<{
        sessionCount: number;
        lastLogin?: Date;
        accountAge: number;
    } | null>;
}
//# sourceMappingURL=user-management-service.d.ts.map